#!/usr/bin/env python3
"""
Collect dependency facts for every package in the repo and print them as JSON.

Measurement only - no judgement. The skill reads this output and decides what
matters. Everything here is deterministic and offline: no network, no installs.

Usage:
    python3 scripts/collect.py [repo_root] > deps.json
"""

import json
import os
import re
import subprocess
import sys
from pathlib import Path

# A package folder is one with a package.json and no parent package.json.
SKIP_DIRS = {"node_modules", ".git", "dist", "build", ".next", "clones", ".claude"}


def find_packages(root: Path) -> list[Path]:
    found = []
    for entry in sorted(root.iterdir()):
        if entry.is_dir() and entry.name not in SKIP_DIRS and (entry / "package.json").is_file():
            found.append(entry)
    if (root / "package.json").is_file():
        found.insert(0, root)
    return found


def du_kb(path: Path) -> int:
    """
    Size in KB, never following symlinks.

    `du -L` looks like the right answer for pnpm's isolated layout, where every
    `node_modules/<pkg>` is a link into `node_modules/.pnpm`. It is not: it
    re-counts the shared store once per link and inflated `mcp` from 110M to
    288M. Measuring without -L counts `.pnpm` once, as the real directory it
    is, and the links as the few bytes they actually occupy.

    For a single package's own size, resolve the link first (see `dep_size_kb`)
    rather than turning -L back on.
    """
    if not path.exists():
        return 0
    try:
        out = subprocess.run(
            ["du", "-sk", str(path)], capture_output=True, text=True, timeout=120
        ).stdout
        return int(out.split()[0])
    except Exception:
        return 0


def dep_size_kb(path: Path) -> int:
    """One dependency's own files, in either install layout."""
    if not path.exists():
        return 0
    target = Path(os.path.realpath(path)) if path.is_symlink() else path
    return du_kb(target)


def detect_layout(nm: Path) -> str:
    """
    'hoisted'  - node_modules/<pkg> are real directories (du -sh works)
    'isolated' - node_modules/<pkg> are symlinks into .pnpm (du -sh reports 0)
    'none'     - not installed
    """
    if not nm.is_dir():
        return "none"
    for entry in nm.iterdir():
        if entry.name.startswith("."):
            continue
        if entry.is_symlink():
            return "isolated"
        if entry.is_dir():
            return "hoisted"
    return "none"


def package_managers(pkg: Path) -> list[str]:
    found = []
    if (pkg / "pnpm-lock.yaml").is_file():
        found.append("pnpm")
    if (pkg / "package-lock.json").is_file():
        found.append("npm")
    if (pkg / "yarn.lock").is_file():
        found.append("yarn")
    return found


def resolve_dep_dir(nm: Path, name: str) -> Path:
    return nm / name


def bin_owner(nm: Path, binary: str) -> str | None:
    """
    Which package provides `node_modules/.bin/<binary>`.

    The bin entry is a symlink into the owning package, so resolving it and
    reading the segment after the last `node_modules/` gives the real owner.
    This is what separates "tsc is undeclared" (wrong - `typescript` declares it)
    from a genuinely missing declaration.
    """
    link = nm / ".bin" / binary
    if not link.exists():
        return None
    try:
        target = os.path.realpath(link)
    except OSError:
        return None

    # pnpm's isolated layout writes a real shim script instead of a symlink, so
    # realpath stops at .bin itself. The shim spells out the .pnpm path inside.
    if Path(target).parent.name == ".bin":
        try:
            text = link.read_text(errors="ignore")
        except OSError:
            return None
        hit = re.search(r"\.pnpm/([^/]+)/node_modules/((?:@[^/]+/)?[^/\s:\"\']+)", text)
        return hit.group(2) if hit else None
    parts = Path(target).parts
    if "node_modules" not in parts:
        return None
    idx = len(parts) - 1 - parts[::-1].index("node_modules")
    rest = parts[idx + 1:]
    if not rest:
        return None
    if rest[0].startswith("@") and len(rest) > 1:
        return f"{rest[0]}/{rest[1]}"
    return rest[0]


def script_binaries(scripts: dict) -> set[str]:
    """First executable token of each npm script, minus shell/node builtins."""
    builtin = {
        "node", "npm", "npx", "pnpm", "yarn", "cd", "rm", "cp", "mv", "mkdir",
        "echo", "cat", "sh", "bash", "zsh", "true", "false", "wait", "set", "export",
    }
    bins = set()
    for body in scripts.values():
        for segment in re.split(r"&&|\|\||;|\|", body):
            tokens = segment.strip().split()
            if not tokens:
                continue
            first = tokens[0]
            if first in builtin or first.startswith(("./", "../", "/", "$", "-")):
                continue
            bins.add(first)
    return bins


SOURCE_DIRS = ("src", "app", "lib", "test", "tests", "scripts")
SOURCE_EXT = {".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"}


def imported_names(pkg: Path) -> set[str]:
    """Every bare module specifier imported or required anywhere in the source."""
    names: set[str] = set()
    # `from 'x'`, `require('x')`, `import('x')` AND the side-effect form
    # `import 'x'` - dotenv/config is imported that way and would look unused.
    pattern = re.compile(
        r"""(?:from\s+|require\(\s*|import\(\s*|import\s+)['"]([^'".][^'"]*)['"]"""
    )
    roots = [pkg / d for d in SOURCE_DIRS if (pkg / d).is_dir()]
    roots += [f for f in pkg.glob("*") if f.suffix in SOURCE_EXT and f.is_file()]
    for root in roots:
        files = root.rglob("*") if root.is_dir() else [root]
        for f in files:
            if not f.is_file() or f.suffix not in SOURCE_EXT:
                continue
            try:
                text = f.read_text(errors="ignore")
            except OSError:
                continue
            for spec in pattern.findall(text):
                parts = spec.split("/")
                names.add("/".join(parts[:2]) if spec.startswith("@") else parts[0])
    return names


def collect_package(pkg: Path) -> dict:
    meta = json.loads((pkg / "package.json").read_text())
    deps = meta.get("dependencies", {}) or {}
    dev = meta.get("devDependencies", {}) or {}
    scripts = meta.get("scripts", {}) or {}
    nm = pkg / "node_modules"
    layout = detect_layout(nm)

    entries = []
    if layout != "none":
        for name, spec in sorted({**deps, **dev}.items()):
            path = resolve_dep_dir(nm, name)
            entries.append(
                {
                    "name": name,
                    "spec": spec,
                    # `ships` is a proxy: a runtime dependency reaches production,
                    # a devDependency does not. Bundlers narrow this further.
                    "ships": name in deps,
                    "installed": path.exists(),
                    "size_kb": dep_size_kb(path),
                }
            )

    imported = imported_names(pkg)
    used_in_scripts = script_binaries(scripts)
    for entry in entries:
        entry["imported_in_source"] = entry["name"] in imported

    # A runtime dependency that no source file imports is either dead weight or
    # a build-time tool filed in the wrong section - both ship to production.
    misplaced = [
        {
            "name": e["name"],
            "reason": "in dependencies but never imported from source"
            + (" (used by an npm script)" if any(
                bin_owner(nm, b) == e["name"] for b in used_in_scripts
            ) else ""),
        }
        for e in entries
        if e["ships"] and not e["imported_in_source"]
    ]

    top_level = 0
    if layout != "none":
        top_level = len([e for e in nm.iterdir() if not e.name.startswith(".")])

    declared = set(deps) | set(dev)
    undeclared = []
    for binary in sorted(script_binaries(scripts)):
        owner = bin_owner(nm, binary)
        if owner is None or owner in declared:
            continue
        undeclared.append({"binary": binary, "provided_by": owner})

    return {
        "name": meta.get("name", pkg.name),
        "path": pkg.name,
        "lockfiles": package_managers(pkg),
        "layout": layout,
        "node_modules_kb": du_kb(nm) if layout != "none" else 0,
        "counts": {
            "dependencies": len(deps),
            "devDependencies": len(dev),
            "declared": len(deps) + len(dev),
            "top_level_installed": top_level,
        },
        "scripts": scripts,
        "undeclared_binaries": undeclared,
        "runtime_deps_not_imported": misplaced,
        "dependencies": entries,
    }


def version_drift(packages: list[dict]) -> list[dict]:
    seen: dict[str, list] = {}
    for p in packages:
        for entry in p["dependencies"]:
            seen.setdefault(entry["name"], []).append((p["path"], entry["spec"]))
    drift = []
    for name, uses in sorted(seen.items()):
        if len({spec for _, spec in uses}) > 1:
            drift.append({"name": name, "uses": [{"package": p, "spec": s} for p, s in uses]})
    return drift


def main() -> None:
    root = Path(sys.argv[1] if len(sys.argv) > 1 else ".").resolve()
    packages = [collect_package(p) for p in find_packages(root)]
    report = {
        "root": str(root),
        "packages": packages,
        "version_drift": version_drift(packages),
        "notes": [
            "size_kb is the package's OWN files, not its dependency subtree - "
            "in a hoisted layout the subtree sits flat at the top level.",
            "ships is dependencies-vs-devDependencies; a bundler narrows it further.",
            "du never follows symlinks: in an isolated layout that would re-count "
            "the shared .pnpm store once per link. Per-dependency sizes resolve "
            "the link first instead.",
            "In a hoisted layout pnpm hardlinks into its global store, so summing "
            "per-dependency sizes can exceed the tree total. Compare a package "
            "against itself over time, not against another package's sum.",
        ],
    }
    json.dump(report, sys.stdout, indent=2)
    print()


if __name__ == "__main__":
    main()
