#!/usr/bin/env python3
"""
Grade dependency-audit eval runs against the report's machine summary.

Every assertion is a query over structured data, not a search through prose.
That is the whole point: a keyword grader cannot tell "react-dom is a defect"
from "react-dom is fine", because both sentences contain the same words. Three
successive regex graders each invented a different set of failures on the same
thirty reports before this file replaced them.

Usage:
    python3 grade.py <iteration-dir>          # e.g. iteration-3/eval-7-full-audit
"""

import json
import pathlib
import re
import sys

# arms are discovered from the iteration directory, so a run can drop or
# rename one without editing this file.
FENCE = re.compile(r"```json\s*\n(.*?)\n```", re.S)


def norm(s: str) -> str:
    return (s or "").lower().lstrip("@").strip("`'\" ")


def block(report: pathlib.Path):
    """The machine summary, or None when the report has none / it is broken."""
    if not report.is_file():
        return None
    hits = FENCE.findall(report.read_text(errors="ignore"))
    for raw in reversed(hits):
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            continue
        if isinstance(data, dict) and data.get("schema") == "dependency-audit/1":
            return data
    return None


def subjects(data, key):
    return {norm(e.get("subject")) for e in data.get(key, [])}


def matches(pool, needle):
    n = norm(needle)
    return any(n in s or s in n for s in pool if s)


def pkg(data, name):
    for p in data.get("packages", []):
        if norm(p.get("name")).rstrip("/") == name:
            return p
    return None


ASSERTIONS = [
    ("A1 autoload reported",
     lambda d, t: matches(subjects(d, "findings"), "fastify/autoload")),
    ("A2 e2e lockfiles reported",
     lambda d, t: any("lock" in norm(f.get("id")) + norm(f.get("subject"))
                      and "e2e" in norm(f.get("package")) + norm(f.get("subject")) + norm(f.get("id"))
                      for f in d.get("findings", []))),
    # The trap is "was it wrongly called an unused dependency", which lives in
    # the hygiene dimension. A supply-chain finding about the same package (a
    # native binary on a caret range) is correct and must not count against it -
    # an earlier version of these two assertions penalised exactly that.
    ("A3 react-dom not called unused",
     lambda d, t: not any(matches({norm(f.get("subject"))}, "react-dom")
                          and f.get("dimension") == "hygiene" for f in d.get("findings", []))),
    ("A4 ripgrep not called unused",
     lambda d, t: not any(matches({norm(f.get("subject"))}, "vscode/ripgrep")
                          and f.get("dimension") == "hygiene" for f in d.get("findings", []))),
    ("A5 zod drift not a defect",
     lambda d, t: not any(norm(f.get("subject")) == "zod" for f in d.get("findings", []))),
    ("A6 disk+ships per package",
     lambda d, t: bool(d.get("packages"))
                  and all(isinstance(p.get("disk_mb"), (int, float)) and isinstance(p.get("ships"), int)
                          for p in d["packages"])),
    ("A7 mcp size accurate",
     lambda d, t: (lambda p: p is not None and 100 <= p.get("disk_mb", 0) <= 130)(pkg(d, "mcp"))),
    ("A8 prose structure",
     lambda d, t: all(re.search(p, t, re.I | re.M) for p in
                      [r"```mermaid|graph (LR|TD)",
                       r"^#{1,3}.*(summary|overview)",
                       r"^#{1,3}.*(finding|issue|problem|what is wrong)",
                       r"^#{1,3}.*(priorit|action|recommend|do first|ranked|fix first)"])),
    ("A9 not_run declared",
     lambda d, t: isinstance(d.get("not_run"), list)),
]


def main() -> None:
    root = pathlib.Path(sys.argv[1])
    arms = sorted(d.name for d in root.iterdir() if d.is_dir() and any(d.glob("run-*")))
    res: dict[str, list] = {}
    for arm in arms:
        rows = []
        for r in range(1, 6):
            report = root / arm / f"run-{r}" / "outputs" / "report.md"
            data = block(report)
            if data is None:
                rows.append(None if report.is_file() else "absent")
                continue
            text = report.read_text(errors="ignore")
            rows.append([fn(data, text) for _, fn in ASSERTIONS])
        res[arm] = rows

    print(f"{'':26}" + "".join(f"{a[:13]:>15}" for a in arms))
    for i, (label, _) in enumerate(ASSERTIONS):
        line = f"{label:<26}"
        for arm in arms:
            ok = sum(1 for g in res[arm] if isinstance(g, list) and g[i])
            n = sum(1 for g in res[arm] if isinstance(g, list))
            line += f"{ok:>12}/{n} "
        print(line)
    print()
    for arm in arms:
        graded = [g for g in res[arm] if isinstance(g, list)]
        broken = [i + 1 for i, g in enumerate(res[arm]) if g is None]
        missing = [i + 1 for i, g in enumerate(res[arm]) if g == "absent"]
        cells = len(ASSERTIONS) * len(graded)
        tot = sum(sum(g) for g in graded)
        note = ""
        if broken:
            note += f"  [no valid machine block: run-{', run-'.join(map(str, broken))}]"
        if missing:
            note += f"  [no report: run-{', run-'.join(map(str, missing))}]"
        print(f"  {arm:<14} {tot}/{cells}" + (f" = {tot/cells:.0%}" if cells else "") + note)


if __name__ == "__main__":
    main()
