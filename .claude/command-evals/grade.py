#!/usr/bin/env python3
"""Grade the /deps command cases. Facts only: file paths, validator exit code, section presence."""
import pathlib, re, subprocess, sys, datetime
CHECK = "/Users/maximliutsko/projects/dev-digest/.claude/skills/dependency-audit/scripts/check_report.py"
TODAY = subprocess.run(["date","+%F"],capture_output=True,text=True).stdout.strip()

EXPECT = {   # case -> (needs "Since the last audit"?, must mention no baseline?)
 "1-no-baseline":   (False, True),
 "2-with-baseline": (True,  False),
 "3-finding-fixed": (True,  False),
 "4-legacy-report": (False, True),
 "5-scoped-arg":    (None,  False),
 "6-unknown-arg":   (None,  False),
}

def grade(case: pathlib.Path):
    want_diff, want_nobase = EXPECT[case.name]
    reports = sorted(case.glob(f"audits/deps-{TODAY}.md"))
    if not reports: return None
    rep = reports[0]; t = rep.read_text(errors="ignore")
    valid = subprocess.run([sys.executable, CHECK, str(rep)], capture_output=True).returncode == 0
    has_diff = bool(re.search(r"^#{2,3}\s*Since the last audit", t, re.I|re.M))
    says_nobase = bool(re.search(r"first audit|no baseline|no earlier|unreadable|no machine summary", t, re.I))
    scoped = bool(re.search(r"\bmcp\b", t, re.I)) and bool(re.search(r"only|scope|narrow", t, re.I))
    rows = [("report at deps-<today>.md", True), ("validator exit 0", valid), ("scope stated", scoped)]
    if want_diff is True:  rows.append(("has 'Since the last audit'", has_diff))
    if want_diff is False: rows.append(("no invented comparison", not has_diff or says_nobase))
    if want_nobase:        rows.append(("says baseline missing/unusable", says_nobase))
    return rows

for case in sorted(pathlib.Path(".").glob("[0-9]-*")):
    r = grade(case)
    if r is None:
        print(f"{case.name:<18} ще немає звіту за {TODAY}")
        continue
    ok = sum(1 for _,v in r if v)
    print(f"{case.name:<18} {ok}/{len(r)}   " + " · ".join(f"{n}:{'OK' if v else 'FAIL'}" for n,v in r))
