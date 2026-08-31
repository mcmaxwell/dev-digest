/* MultiAgentConfigureView - pick a pull request, tick the agents, run them.

   Two rejected mockup lines are load-bearing here:
   - an agent row shows ONLY its icon, its name and its own description. The
     duration, cost and verdict sentence in the mockup are leakage from the
     results screen; before a run those numbers do not exist for this pull
     request (AC-6).
   - the run control reads the LIVE selection count, so it reads (0) with
     nothing selected rather than the mockup's (4) (AC-7). */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Checkbox, EmptyState, Icon, SearchableSelect } from "@devdigest/ui";
import type { Agent } from "@devdigest/shared";
import { useAgents } from "@/lib/hooks/agents";
import { usePulls } from "@/lib/hooks";
import { useAgentRunEstimates, useStartMultiAgentRun } from "@/lib/hooks/multi-agent";
import { ApiError } from "@/lib/api";
import { formatUsd } from "@/lib/format";
import { agentColor } from "../../../_components/agent-colors";
import { estimateSelection } from "./helpers";
import { s } from "./styles";

/** A multi-agent run compares agents, so one agent is not a run. */
const MIN_AGENTS = 2;

export function MultiAgentConfigureView({ repoId }: { repoId: string }) {
  const t = useTranslations("runs");
  const router = useRouter();
  const { data: pulls, isLoading: pullsLoading } = usePulls(repoId);
  const { data: agents, isLoading: agentsLoading } = useAgents();
  const { data: estimates } = useAgentRunEstimates();
  const start = useStartMultiAgentRun();

  const [prId, setPrId] = React.useState("");
  const [selected, setSelected] = React.useState<string[]>([]);

  // Agent order is a decision, not an accident: `GET /agents` has no ordering
  // contract, so the list establishes one itself (name ascending).
  const enabled: Agent[] = React.useMemo(
    () => (agents ?? []).filter((a) => a.enabled).sort((a, b) => a.name.localeCompare(b.name)),
    [agents],
  );

  const prOptions = React.useMemo(
    () =>
      (pulls ?? [])
        .filter((p) => !!p.id)
        .map((p) => ({
          value: p.id!,
          label: t("page.prItem", { number: p.number, title: p.title }),
        })),
    [pulls, t],
  );

  const estimate = estimateSelection(selected, estimates);
  const canRun = !!prId && selected.length >= MIN_AGENTS && !start.isPending;

  const toggle = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const run = () => {
    if (!canRun) return;
    start.mutate(
      { prId, agentIds: selected },
      // Land on the new run's results, so going BACK reaches the landing list
      // rather than a half-filled form.
      { onSuccess: (created) => router.replace(`/repos/${repoId}/multi-agent/${created.id}`) },
    );
  };

  return (
    <div style={s.wrap}>
      <h1 style={s.title}>{t("page.configureTitle")}</h1>
      <p style={s.subtitle}>{t("page.subtitle")}</p>

      <section style={s.step}>
        <div style={s.stepHead}>
          <span style={s.stepNum}>1</span>
          <span style={s.stepLabel}>{t("page.step.pull")}</span>
        </div>
        <div style={s.picker}>
          {pullsLoading ? (
            <div style={s.note}>{t("page.recent.loading")}</div>
          ) : prOptions.length === 0 ? (
            <div style={s.note}>{t("page.noPulls")}</div>
          ) : (
            <SearchableSelect
              value={prId}
              onChange={setPrId}
              options={[{ value: "", label: t("page.selectPrPlaceholder") }, ...prOptions]}
              placeholder={t("page.selectPrPlaceholder")}
              mono={false}
            />
          )}
        </div>
      </section>

      <section style={s.step}>
        <div style={s.stepHead}>
          <span style={s.stepNum}>2</span>
          <span style={s.stepLabel}>{t("page.step.agents")}</span>
          {prId && enabled.length > 0 && (
            <div style={s.stepAction}>
              <Button
                kind="ghost"
                size="sm"
                onClick={() =>
                  setSelected(
                    selected.length === enabled.length ? [] : enabled.map((a) => a.id),
                  )
                }
              >
                {selected.length === enabled.length ? t("page.clearAll") : t("page.selectAll")}
              </Button>
            </div>
          )}
        </div>

        <AgentStep
          prChosen={!!prId}
          loading={agentsLoading}
          agents={enabled}
          selected={selected}
          onToggle={toggle}
        />
      </section>

      <div style={s.runBar}>
        <Button kind="primary" icon="Users" disabled={!canRun} onClick={run}>
          {start.isPending
            ? t("page.running")
            : t("page.run", { count: selected.length })}
        </Button>

        {/* The reason sits BESIDE the disabled control, so a user who cannot
            press it is told why rather than left guessing. */}
        {!!prId && selected.length < MIN_AGENTS && (
          <span style={s.reason}>{t("page.needTwo")}</span>
        )}

        {/* The estimate is the only pre-run number on this screen, and it is
            computed from recorded history rather than invented. With no selected
            agent that has ever succeeded, the area is simply empty (AC-14). */}
        {estimate && (
          <span style={s.estimate}>
            {t(estimate.partial ? "page.estimatePartial" : "page.estimate", {
              duration: `${(estimate.duration_ms / 1000).toFixed(1)}s`,
              cost: formatUsd(estimate.cost_usd),
            })}
          </span>
        )}
      </div>

      {start.isError && (
        <div style={s.error}>
          {t("page.startError", {
            message:
              start.error instanceof ApiError ? start.error.message : String(start.error),
          })}
        </div>
      )}
    </div>
  );
}

/** Explicit early return per state; step 2 does not exist until a PR is chosen. */
function AgentStep({
  prChosen,
  loading,
  agents,
  selected,
  onToggle,
}: {
  prChosen: boolean;
  loading: boolean;
  agents: Agent[];
  selected: string[];
  onToggle: (id: string) => void;
}) {
  const t = useTranslations("runs");

  if (!prChosen) {
    return (
      <div style={s.placeholder}>
        <div style={s.placeholderTitle}>{t("page.pickPrFirst.title")}</div>
        <div style={s.placeholderBody}>{t("page.pickPrFirst.body")}</div>
      </div>
    );
  }
  if (loading) return <div style={s.note}>{t("page.recent.loading")}</div>;
  if (agents.length === 0) {
    return (
      <EmptyState icon="Cpu" title={t("page.noAgents.title")} body={t("page.noAgents.body")} />
    );
  }

  return (
    <div style={s.list}>
      {/* Colour BY INDEX in this list's stable order (name ascending), which is
          the same order the results screen's columns arrive in. */}
      {agents.map((a, i) => (
        <div key={a.id} style={s.row(selected.includes(a.id), agentColor(i))}>
          <Checkbox checked={selected.includes(a.id)} onChange={() => onToggle(a.id)} />
          <div data-testid="agent-swatch" style={s.iconBox(agentColor(i))}>
            <Icon.Cpu size={15} />
          </div>
          <div style={s.rowMain}>
            <div style={s.name}>{a.name}</div>
            {/* The agent's OWN description, and nothing else. */}
            <div style={s.description}>{a.description}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
