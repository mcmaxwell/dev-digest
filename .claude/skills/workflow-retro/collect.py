#!/usr/bin/env python3
"""Extract measured facts about a multi-agent session from the Claude Code transcripts.

Reads, never writes. Everything it prints comes from
  ~/.claude/projects/<cwd-slug>/<session-id>.jsonl              (main loop)
  ~/.claude/projects/<cwd-slug>/<session-id>/subagents/*.jsonl  (each subagent)
  ~/.claude/projects/<cwd-slug>/<session-id>/journal.jsonl      (Workflow runs, if any)

The numbers are authoritative: agent token counts, durations and tool stats are
read from the `toolUseResult` the harness itself recorded for each Agent call,
not re-derived.

Usage:
  python3 collect.py                      # newest session for the current repo
  python3 collect.py --session <uuid>
  python3 collect.py --json               # machine-readable
  python3 collect.py --since 2026-08-13T09:00:00Z
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path

PROJECTS = Path.home() / ".claude" / "projects"
AGENT_TOOLS = ("Agent", "Task")
READ_TOOLS = ("Read", "Grep", "Glob", "NotebookRead")


def slug_for(cwd: Path) -> str:
    return str(cwd.resolve()).replace("/", "-")


def load_jsonl(path: Path):
    if not path.exists():
        return
    with path.open(encoding="utf-8", errors="replace") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                yield json.loads(line)
            except json.JSONDecodeError:
                continue


def ts(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def blocks(entry: dict):
    message = entry.get("message")
    if not isinstance(message, dict):
        return []
    content = message.get("content")
    return content if isinstance(content, list) else []


def add_usage(total: dict, usage: dict) -> None:
    for key in ("input_tokens", "output_tokens", "cache_read_input_tokens",
                "cache_creation_input_tokens"):
        total[key] = total.get(key, 0) + (usage.get(key) or 0)


def read_targets(entry: dict) -> set[str]:
    """Files this tool call pulled into a context window."""
    found = set()
    for block in blocks(entry):
        if not isinstance(block, dict) or block.get("type") != "tool_use":
            continue
        if block.get("name") not in READ_TOOLS:
            continue
        args = block.get("input") or {}
        target = args.get("file_path") or args.get("path") or args.get("pattern")
        if target:
            found.add(str(target))
    return found


def result_of(entry: dict) -> str | None:
    """The tool_use id a tool_result entry answers."""
    for block in blocks(entry):
        if isinstance(block, dict) and block.get("type") == "tool_result":
            return block.get("tool_use_id")
    return None


def scan_subagent(path: Path) -> dict:
    """Token usage, tool histogram, turns and read targets from one agent's own transcript.

    This is the only source of truth for agents launched in the background: the
    harness records their stats in the task notification, not in the tool result.
    """
    usage: dict = {}
    tools: Counter = Counter()
    reads: set[str] = set()
    turns = 0
    first = last = None
    for entry in load_jsonl(path):
        when = ts(entry.get("timestamp"))
        if when:
            first = when if first is None else min(first, when)
            last = when if last is None else max(last, when)
        message = entry.get("message")
        if entry.get("type") == "assistant" and isinstance(message, dict):
            turns += 1
            if isinstance(message.get("usage"), dict):
                add_usage(usage, message["usage"])
        for block in blocks(entry):
            if isinstance(block, dict) and block.get("type") == "tool_use":
                tools.update([block.get("name")])
        reads |= read_targets(entry)
    return {
        "usage": usage,
        "tools": dict(tools.most_common()),
        "tool_uses": sum(tools.values()),
        "assistant_turns": turns,
        "duration_ms": round((last - first).total_seconds() * 1000) if first and last else None,
        "reads": reads,
    }


def collect(session_file: Path, since: datetime | None) -> dict:
    session_dir = session_file.with_suffix("")
    main_usage: dict = {}
    main_tools: Counter = Counter()
    launches: list[dict] = []
    results: dict[str, dict] = {}
    resumes: list[dict] = []
    workflows: list[dict] = []
    batches: dict[str, list[str]] = defaultdict(list)
    first_ts = last_ts = None
    model = None

    for entry in load_jsonl(session_file):
        when = ts(entry.get("timestamp"))
        if since and when and when < since:
            continue
        if when:
            first_ts = when if first_ts is None else min(first_ts, when)
            last_ts = when if last_ts is None else max(last_ts, when)

        message = entry.get("message")
        if entry.get("type") == "assistant" and isinstance(message, dict):
            model = message.get("model") or model
            if isinstance(message.get("usage"), dict):
                add_usage(main_usage, message["usage"])

        for block in blocks(entry):
            if not isinstance(block, dict) or block.get("type") != "tool_use":
                continue
            name = block.get("name")
            main_tools.update([name])
            args = block.get("input") or {}
            if name in AGENT_TOOLS:
                launches.append({
                    "tool_use_id": block.get("id"),
                    "turn": entry.get("uuid"),
                    "at": entry.get("timestamp"),
                    "type": args.get("subagent_type") or "general-purpose",
                    "description": args.get("description"),
                    "model_override": args.get("model"),
                    "background": args.get("run_in_background"),
                    "isolation": args.get("isolation"),
                    "prompt_chars": len(args.get("prompt") or ""),
                })
                batches[entry.get("uuid")].append(block.get("id"))
            elif name == "SendMessage":
                resumes.append({"at": entry.get("timestamp"), "to": args.get("to"),
                                "chars": len(args.get("message") or "")})
            elif name == "Workflow":
                workflows.append({"at": entry.get("timestamp"),
                                  "name": args.get("name") or args.get("scriptPath")})

        result = entry.get("toolUseResult")
        if isinstance(result, dict) and "agentId" in result:
            results[result_of(entry) or result["agentId"]] = {
                "agent_id": result.get("agentId"),
                "type": result.get("agentType"),
                "model": result.get("resolvedModel"),
                "status": result.get("status"),
                "async": bool(result.get("isAsync")),
                "tokens": result.get("totalTokens"),
                "tool_uses": result.get("totalToolUseCount"),
                "duration_ms": result.get("totalDurationMs"),
                "tool_stats": result.get("toolStats") or {},
                "usage": result.get("usage") or {},
                "result_chars": len(result.get("content") or ""),
            }

    # Match each launch to its outcome by tool_use id, then fill anything the
    # harness did not record (background agents) from the agent's own transcript.
    subagents_dir = session_dir / "subagents"
    per_agent_reads: dict[str, set[str]] = {}
    for launch in launches:
        record = results.get(launch["tool_use_id"])
        if record:
            # A background launch records only agentId/status, so never let its
            # empty fields overwrite what the launch call already told us.
            launch.update({k: v for k, v in record.items() if v not in (None, {}, "")})
        agent_id = launch.get("agent_id")
        if not agent_id:
            continue
        scan = scan_subagent(subagents_dir / f"agent-{agent_id}.jsonl")
        launch["assistant_turns"] = scan["assistant_turns"]
        launch["tool_histogram"] = scan["tools"]
        if not launch.get("usage"):
            launch["usage"] = scan["usage"]
            launch["tokens"] = sum(scan["usage"].get(key, 0) for key in (
                "output_tokens", "input_tokens",
                "cache_creation_input_tokens", "cache_read_input_tokens"))
            launch["measured_from"] = "subagent transcript"
        if not launch.get("tool_uses"):
            launch["tool_uses"] = scan["tool_uses"]
        if not launch.get("duration_ms"):
            launch["duration_ms"] = scan["duration_ms"]
        if scan["reads"]:
            per_agent_reads[agent_id] = scan["reads"]

    overlap: Counter = Counter()
    for reads in per_agent_reads.values():
        overlap.update(reads)
    duplicated = {target: count for target, count in overlap.items() if count > 1}

    journal = [entry for entry in load_jsonl(session_dir / "journal.jsonl")]

    return {
        "session": session_file.stem,
        "model": model,
        "span": {
            "from": first_ts.isoformat() if first_ts else None,
            "to": last_ts.isoformat() if last_ts else None,
            "minutes": round((last_ts - first_ts).total_seconds() / 60, 1)
            if first_ts and last_ts else None,
        },
        "main_loop": {"usage": main_usage, "tools": dict(main_tools.most_common())},
        "agents": launches,
        "batches": [ids for ids in batches.values() if len(ids) > 1],
        "resumes": resumes,
        "workflows": workflows,
        "workflow_journal_entries": len(journal),
        "duplicated_reads": dict(sorted(duplicated.items(), key=lambda kv: -kv[1])),
        "agent_read_counts": {k: len(v) for k, v in per_agent_reads.items()},
    }


def thousands(value) -> str:
    return f"{value:,}" if isinstance(value, int) else "-"


def render(data: dict) -> str:
    out: list[str] = []
    usage = data["main_loop"]["usage"]
    agents = data["agents"]
    agent_out = sum(a.get("usage", {}).get("output_tokens") or 0 for a in agents)
    agent_total = sum(a.get("tokens") or 0 for a in agents)

    out.append(f"# Session {data['session']}")
    out.append("")
    out.append(f"- Model: `{data['model']}`")
    out.append(f"- Wall clock: {data['span']['minutes']} min "
               f"({data['span']['from']} to {data['span']['to']})")
    out.append(f"- Agents launched: {len(agents)}"
               + (f" · parallel batches: {len(data['batches'])}" if data["batches"] else "")
               + (f" · resumed via SendMessage: {len(data['resumes'])}" if data["resumes"] else ""))
    if data["workflows"]:
        out.append(f"- Workflow runs: {len(data['workflows'])} "
                   f"({data['workflow_journal_entries']} journal entries)")
    out.append("")
    out.append("## Tokens")
    out.append("")
    out.append("| Scope | Output | Cache read | Cache write | Input |")
    out.append("| --- | ---: | ---: | ---: | ---: |")
    out.append(f"| Main loop | {thousands(usage.get('output_tokens', 0))} | "
               f"{thousands(usage.get('cache_read_input_tokens', 0))} | "
               f"{thousands(usage.get('cache_creation_input_tokens', 0))} | "
               f"{thousands(usage.get('input_tokens', 0))} |")
    for agent in agents:
        agent_usage = agent.get("usage") or {}
        label = agent.get("description") or agent.get("type")
        out.append(f"| {agent.get('type')}: {label} | "
                   f"{thousands(agent_usage.get('output_tokens', 0))} | "
                   f"{thousands(agent_usage.get('cache_read_input_tokens', 0))} | "
                   f"{thousands(agent_usage.get('cache_creation_input_tokens', 0))} | "
                   f"{thousands(agent_usage.get('input_tokens', 0))} |")
    out.append("")
    out.append(f"Generated tokens: main loop {thousands(usage.get('output_tokens', 0))}, "
               f"agents {thousands(agent_out)}. "
               f"Total processed by agents including cache reads: {thousands(agent_total)}.")
    out.append("")
    out.append("Cache-read is context re-processed per request, so it sums far above the "
               "context window and is not a second copy of the work. Output tokens are the "
               "honest measure of what each agent produced.")
    out.append("")
    out.append("## Launch order")
    out.append("")
    out.append("| # | At | Agent | Task | Model | Status | Tokens | Tools | Duration |")
    out.append("| ---: | --- | --- | --- | --- | --- | ---: | ---: | ---: |")
    for index, agent in enumerate(agents, start=1):
        duration = agent.get("duration_ms")
        out.append(
            f"| {index} | {(agent.get('at') or '')[11:19]} | `{agent.get('type')}` | "
            f"{agent.get('description') or '-'} | {agent.get('model') or '-'} | "
            f"{agent.get('status') or 'no result recorded'} | "
            f"{thousands(agent.get('tokens'))} | {agent.get('tool_uses') or '-'} | "
            f"{round(duration / 1000) if duration else '-'}s |")
    if data["batches"]:
        out.append("")
        out.append(f"Parallel batches (agents launched in one turn): "
                   f"{', '.join(str(len(ids)) for ids in data['batches'])} agents each.")
    out.append("")
    out.append("## Main-loop tool calls")
    out.append("")
    out.append(", ".join(f"{name} x{count}"
                         for name, count in data["main_loop"]["tools"].items()) or "none")
    out.append("")
    out.append("## Files pulled in by more than one agent")
    out.append("")
    if data["duplicated_reads"]:
        for target, count in list(data["duplicated_reads"].items())[:25]:
            out.append(f"- `{target}` - {count} agents")
        out.append("")
        out.append("Each repeat is a file paid for once per agent. If two agents on the same "
                   "chain both needed it, the earlier one's report should have carried it.")
    else:
        out.append("None - no file was read by two different agents.")
    return "\n".join(out)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--session", help="session id (default: newest for this repo)")
    parser.add_argument("--cwd", default=os.getcwd(), help="repo root (default: cwd)")
    parser.add_argument("--since", help="ignore transcript entries before this ISO timestamp")
    parser.add_argument("--json", action="store_true", help="emit JSON instead of markdown")
    args = parser.parse_args()

    project_dir = PROJECTS / slug_for(Path(args.cwd))
    if not project_dir.is_dir():
        print(f"No transcripts for {args.cwd} at {project_dir}", file=sys.stderr)
        return 1

    if args.session:
        session_file = project_dir / f"{args.session}.jsonl"
    else:
        candidates = sorted(project_dir.glob("*.jsonl"), key=lambda p: p.stat().st_mtime)
        if not candidates:
            print(f"No session transcripts in {project_dir}", file=sys.stderr)
            return 1
        session_file = candidates[-1]

    if not session_file.exists():
        print(f"No such session transcript: {session_file}", file=sys.stderr)
        return 1

    data = collect(session_file, ts(args.since))
    print(json.dumps(data, indent=2) if args.json else render(data))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
