# Dependency audits

One file per run, `deps-<YYYY-MM-DD>.md`, produced by `/deps`.

These are kept rather than regenerated because the interesting question is not
"what is wrong today" but "what has been wrong since March and nobody fixed
it". A finding that survives four audits is a decision, not a backlog item.

Each report ends with a `## Machine summary` JSON block. That block, not the
prose, is what a comparison reads: prose mentions a package both when accusing
it and when clearing it, and no text search can tell those apart.

Two things you can run on these files without Claude:

```sh
# is a report well-formed?
python3 .claude/skills/dependency-audit/scripts/check_report.py docs/audits/deps-2026-08-27.md

# what does the collector see right now?
python3 .claude/skills/dependency-audit/scripts/collect.py . > /tmp/deps.json
```

Both are plain Python, offline and deterministic, so they work as CI steps with
no API key.
