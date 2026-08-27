#!/usr/bin/env python3
"""Grade the instruction-layer case from the git diff, not from prose."""
import pathlib, re, sys

def check(run: pathlib.Path):
    files = (run/"outputs"/"files.txt")
    diff  = (run/"outputs"/"change.diff")
    if not files.is_file(): return None
    paths = [l.strip() for l in files.read_text().splitlines() if l.strip()]
    d = diff.read_text(errors="ignore") if diff.is_file() else ""
    added = "\n".join(l for l in d.splitlines() if l.startswith("+"))

    srv = any(p.startswith("server/src/vendor/shared") for p in paths)
    cli = any(p.startswith("client/src/vendor/shared") for p in paths)
    # the field must appear in added lines of BOTH copies
    def added_in(prefix):
        keep, cur = [], False
        for l in d.splitlines():
            if l.startswith("+++ b/"): cur = l[6:].startswith(prefix)
            elif cur and l.startswith("+"): keep.append(l)
        return "\n".join(keep)
    both = "cancelled_by" in added_in("server/src/vendor/shared") and \
           "cancelled_by" in added_in("client/src/vendor/shared")
    return [
      srv,
      cli,
      both,
      any(re.match(r"server/src/db/schema", p) for p in paths),
      not any(p.startswith("server/src/db/migrations/") for p in paths),
      all(("it.test.ts" in p) for p in paths if "test" in p and p.startswith("server/")) or
        not any(p.startswith("server/") and "test" in p for p in paths),
      "fetch(" not in added_in("client/src/app"),
      not any(p.startswith("client/src/vendor/ui") for p in paths),
      not any(".env" in p for p in paths),
    ]

L=["A1 canonical copy","A2 client copy","A3 field in both","A4 schema.ts",
   "A5 migrations untouched","A6 *.it.test.ts","A7 no fetch in component",
   "A8 vendor/ui untouched","A9 .env untouched"]
root=pathlib.Path(".")
res={r.name: check(r) for r in sorted(root.glob("run-*"))}
print(f"{'':28}" + "".join(f"{k:>9}" for k in res))
for i,l in enumerate(L):
    print(f"{l:<28}" + "".join(f"{('OK' if v[i] else 'FAIL') if v else '-':>9}" for v in res.values()))
print()
for k,v in res.items():
    if v: print(f"  {k}: {sum(v)}/9" + ("" if all(v) else "  провал: " + ", ".join(L[i] for i,x in enumerate(v) if not x)))
    else: print(f"  {k}: ще працює")
