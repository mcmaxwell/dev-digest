#!/usr/bin/env python3
"""
Validate the machine summary at the end of a dependency-audit report.

Extracts the last fenced `json` block, checks its shape, and prints a compact
digest. Exits non-zero when the block is missing or malformed, so it works as
both a self-check before finishing a report and a CI gate.

Usage:
    python3 scripts/check_report.py <report.md> [--json]
"""

import json
import re
import sys

DIMENSIONS = {"hygiene", "weight", "supply-chain", "boundaries"}
SEVERITIES = {"critical", "high", "medium", "low"}
FENCE = re.compile(r"```json\s*\n(.*?)\n```", re.S)


def extract(text: str) -> dict:
    blocks = FENCE.findall(text)
    if not blocks:
        raise SystemExit("FAIL: no fenced ```json block found - the report has no machine summary")
    # the machine summary is the last one; earlier blocks may be illustrative
    try:
        return json.loads(blocks[-1])
    except json.JSONDecodeError as exc:
        raise SystemExit(f"FAIL: the last json block does not parse: {exc}")


def check(data: dict) -> list[str]:
    errs: list[str] = []
    if data.get("schema") != "dependency-audit/1":
        errs.append(f"schema is {data.get('schema')!r}, expected 'dependency-audit/1'")

    for key in ("packages", "findings", "cleared", "not_run"):
        if key not in data:
            errs.append(f"missing required key {key!r}")
        elif not isinstance(data[key], list):
            errs.append(f"{key!r} must be a list")

    for i, pkg in enumerate(data.get("packages", [])):
        if not pkg.get("name"):
            errs.append(f"packages[{i}] has no name")
        mb = pkg.get("disk_mb")
        if not isinstance(mb, (int, float)):
            errs.append(f"packages[{i}] ({pkg.get('name')}) disk_mb must be a number, got {mb!r}")
        elif mb <= 0:
            errs.append(f"packages[{i}] ({pkg.get('name')}) disk_mb is {mb} - a measured tree is never 0")
        ships, declared = pkg.get("ships"), pkg.get("declared")
        if not isinstance(ships, int):
            errs.append(f"packages[{i}] ({pkg.get('name')}) needs an integer 'ships' count")
        elif isinstance(declared, int) and ships > declared:
            errs.append(f"packages[{i}] ({pkg.get('name')}) ships={ships} exceeds declared={declared}")

    seen: set[str] = set()
    for i, f in enumerate(data.get("findings", [])):
        fid = f.get("id")
        if not fid:
            errs.append(f"findings[{i}] has no id")
        elif fid in seen:
            errs.append(f"findings[{i}] duplicate id {fid!r}")
        else:
            seen.add(fid)
        if f.get("dimension") not in DIMENSIONS:
            errs.append(f"findings[{i}] ({fid}) dimension {f.get('dimension')!r} not in {sorted(DIMENSIONS)}")
        if f.get("severity") not in SEVERITIES:
            errs.append(f"findings[{i}] ({fid}) severity {f.get('severity')!r} not in {sorted(SEVERITIES)}")

    # A subject cannot be both asserted and cleared - that is the one
    # contradiction a reader cannot resolve.
    accused = {f.get("subject") for f in data.get("findings", [])}
    for c in data.get("cleared", []):
        if not c.get("why"):
            errs.append(f"cleared entry {c.get('subject')!r} has no 'why' - a cleared candidate must say why")
        if c.get("subject") in accused:
            errs.append(f"{c.get('subject')!r} appears in BOTH findings and cleared")
    return errs


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    text = open(sys.argv[1], encoding="utf-8", errors="ignore").read()
    data = extract(text)
    errs = check(data)

    if "--json" in sys.argv:
        json.dump({"ok": not errs, "errors": errs, "data": data}, sys.stdout, indent=2)
        print()
    else:
        for e in errs:
            print(f"  - {e}")
        sev: dict[str, int] = {}
        for f in data.get("findings", []):
            sev[f.get("severity", "?")] = sev.get(f.get("severity", "?"), 0) + 1
        order = [s for s in ("critical", "high", "medium", "low") if s in sev]
        print(f"{'FAIL' if errs else 'OK'}: "
              f"{len(data.get('packages', []))} packages, "
              f"{len(data.get('findings', []))} findings "
              f"({', '.join(f'{sev[s]} {s}' for s in order) or 'none'}), "
              f"{len(data.get('cleared', []))} cleared, "
              f"{len(data.get('not_run', []))} checks not run")
    sys.exit(1 if errs else 0)


if __name__ == "__main__":
    main()
