#!/usr/bin/env python3
"""
Trigger evaluation: does a skill's description make the model reach for it?

This is the one LLM eval that runs in CI today. It needs no agent harness -
one call per query, the answer is a skill name, and grading is exact-match
against a declared expectation. The agent-quality evals still need a runner
that does not exist yet, and pretending otherwise would produce a green job
that measures nothing.

    python3 scripts/eval-trigger.py --skill onion-architecture
    python3 scripts/eval-trigger.py --skill onion-architecture --dry-run
    python3 scripts/eval-trigger.py --all --runs 3 --model deepseek/deepseek-v4-flash

Reads .claude/skills/<name>/evals/trigger.json:

    {"queries": [{"q": "...", "should_trigger": true}, ...]}

Exits non-zero when accuracy is below --threshold. A skill with no
trigger.json is skipped by name, never failed.
"""

import argparse
import json
import os
import pathlib
import sys
import urllib.error
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
SKILLS = ROOT / ".claude" / "skills"
ENDPOINT = "https://openrouter.ai/api/v1/chat/completions"


def skill_catalogue() -> list[tuple[str, str]]:
    """(name, description) for every skill, so the model chooses among all."""
    out = []
    for d in sorted(SKILLS.iterdir()):
        f = d / "SKILL.md"
        if not f.is_file():
            continue
        text = f.read_text(errors="ignore")
        desc = ""
        for line in text.splitlines():
            if line.startswith("description:"):
                desc = line.split(":", 1)[1].strip()
                break
        out.append((d.name, desc))
    return out


def ask(query: str, catalogue, model: str, key: str) -> str:
    listing = "\n".join(f"- {n}: {d}" for n, d in catalogue)
    body = {
        "model": model,
        "temperature": 0,
        "messages": [
            {"role": "system", "content":
             "You route a developer request to at most one skill.\n"
             "Answer with the skill name alone, or the word none.\n"
             "Choose a skill only when its description actually covers the "
             "request; a request the assistant can handle unaided is none.\n\n"
             f"Skills:\n{listing}"},
            {"role": "user", "content": query},
        ],
    }
    req = urllib.request.Request(
        ENDPOINT, data=json.dumps(body).encode(),
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=120) as r:
        data = json.load(r)
    return data["choices"][0]["message"]["content"].strip().strip(".`").lower()


def run_skill(name: str, args, catalogue, key) -> tuple[int, int, list[str]]:
    path = SKILLS / name / "evals" / "trigger.json"
    if not path.is_file():
        print(f"SKIP {name}: no evals/trigger.json")
        return (0, 0, [])
    spec = json.loads(path.read_text())
    queries = spec.get("queries", [])
    if not queries:
        print(f"SKIP {name}: trigger.json has no queries")
        return (0, 0, [])

    if args.dry_run:
        for i, q in enumerate(queries):
            if "q" not in q or "should_trigger" not in q:
                print(f"FAIL {name}: queries[{i}] needs both 'q' and 'should_trigger'")
                return (0, len(queries), [f"queries[{i}] malformed"])
        pos = sum(1 for q in queries if q["should_trigger"])
        print(f"ok   {name}: {len(queries)} queries ({pos} should trigger, "
              f"{len(queries)-pos} should not) - file valid, nothing measured")
        # deliberately (0, 0): a dry run calls no model, so it must not report
        # an accuracy. Printing 100% here would be the exact false green this
        # harness exists to catch.
        return (0, 0, [])

    hits = total = 0
    misses = []
    for q in queries:
        for _ in range(args.runs):
            total += 1
            try:
                answer = ask(q["q"], catalogue, args.model, key)
            except urllib.error.HTTPError as e:
                print(f"  http {e.code} on: {q['q'][:60]}")
                misses.append(f"http {e.code}")
                continue
            chose = answer == name
            if chose == bool(q["should_trigger"]):
                hits += 1
            else:
                misses.append(
                    f"{'missed' if q['should_trigger'] else 'false trigger'}: "
                    f"{q['q'][:70]} -> {answer}")
    return (hits, total, misses)


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--skill")
    p.add_argument("--all", action="store_true")
    p.add_argument("--model", default=os.environ.get("EVAL_MODEL", "deepseek/deepseek-v4-flash"))
    p.add_argument("--runs", type=int, default=1)
    p.add_argument("--threshold", type=float, default=0.8)
    p.add_argument("--dry-run", action="store_true")
    args = p.parse_args()

    key = os.environ.get("OPENROUTER_API_KEY", "")
    if not key and not args.dry_run:
        sys.exit("OPENROUTER_API_KEY is not set (use --dry-run to validate the eval files only)")

    catalogue = skill_catalogue()
    names = ([d.name for d in sorted(SKILLS.iterdir()) if (d / "SKILL.md").is_file()]
             if args.all else [args.skill])
    if not names or names == [None]:
        sys.exit("pass --skill <name> or --all")

    failed = False
    for name in names:
        hits, total, misses = run_skill(name, args, catalogue, key)
        if total == 0:
            continue
        acc = hits / total
        mark = "ok  " if acc >= args.threshold else "FAIL"
        print(f"{mark} {name}: {hits}/{total} = {acc:.0%} "
              f"(model {args.model}, {args.runs} run(s) per query)")
        for m in misses[:8]:
            print(f"       {m}")
        if acc < args.threshold:
            failed = True
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
