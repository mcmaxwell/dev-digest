/* SkillsTab — attach/detach workspace skills to this agent and order them.
   Checkbox = attached (order = position of the block in the assembled prompt);
   drag an attached row to reorder. Every change persists immediately via
   POST /agents/:id/skills (which versions the agent's config). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Checkbox, Icon } from "@devdigest/ui";
import type { Agent, Skill } from "@devdigest/shared";
import { useAgentSkills, useSetAgentSkills } from "@/lib/hooks/agents";
import { useSkills } from "@/lib/hooks/skills";
import { s } from "./styles";

/** Badge colour per skill type (same accents as the Skills page). */
function typeColor(type: Skill["type"]): string {
  switch (type) {
    case "rubric":
      return "var(--accent)";
    case "convention":
      return "var(--ok)";
    case "security":
      return "var(--crit)";
    default:
      return "var(--text-secondary)";
  }
}

export function SkillsTab({ agent }: { agent: Agent }) {
  const t = useTranslations("agents");
  const { data: skills } = useSkills();
  const { data: links } = useAgentSkills(agent.id);
  const setSkills = useSetAgentSkills();
  const [filter, setFilter] = React.useState("");
  const [dragIndex, setDragIndex] = React.useState<number | null>(null);

  const linkedIds = React.useMemo(() => (links ?? []).map((l) => l.skill_id), [links]);
  const byId = React.useMemo(() => new Map((skills ?? []).map((sk) => [sk.id, sk])), [skills]);

  // Attached first (link order), then the rest alphabetically.
  const rows: Skill[] = React.useMemo(() => {
    const linked = linkedIds.map((id) => byId.get(id)).filter((sk): sk is Skill => !!sk);
    const rest = (skills ?? [])
      .filter((sk) => !linkedIds.includes(sk.id))
      .sort((a, b) => a.name.localeCompare(b.name));
    return [...linked, ...rest];
  }, [linkedIds, byId, skills]);

  const q = filter.trim().toLowerCase();
  const visible = q ? rows.filter((sk) => sk.name.toLowerCase().includes(q)) : rows;

  const persist = (ids: string[]) => setSkills.mutate({ agentId: agent.id, skillIds: ids });

  const toggle = (skill: Skill, attach: boolean) =>
    persist(attach ? [...linkedIds, skill.id] : linkedIds.filter((id) => id !== skill.id));

  // Reorder within the ATTACHED prefix only (drag handles are linked-rows-only).
  const drop = (targetLinkedIndex: number) => {
    if (dragIndex === null || dragIndex === targetLinkedIndex) return;
    const next = [...linkedIds];
    const [moved] = next.splice(dragIndex, 1);
    next.splice(targetLinkedIndex, 0, moved!);
    setDragIndex(null);
    persist(next);
  };

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <h2 style={s.h2}>{t("skills.title")}</h2>
        <Badge color="var(--accent)" bg="var(--accent-bg)">
          {t("skills.enabledCount", { linked: linkedIds.length, total: (skills ?? []).length })}
        </Badge>
        <div style={s.filter}>
          <Icon.Search size={13} style={s.filterIcon} />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t("skills.filterPlaceholder")}
            style={s.filterInput}
          />
        </div>
      </div>
      <p style={s.orderHint}>{t("skills.orderHint")}</p>

      <div style={s.list}>
        {visible.map((skill) => {
          const linkedIndex = linkedIds.indexOf(skill.id);
          const attached = linkedIndex >= 0;
          const draggable = attached && !q;
          return (
            <div
              key={skill.id}
              draggable={draggable}
              onDragStart={() => setDragIndex(linkedIndex)}
              onDragOver={(e) => {
                if (attached && dragIndex !== null) e.preventDefault();
              }}
              onDrop={() => attached && drop(linkedIndex)}
              onDragEnd={() => setDragIndex(null)}
              style={s.row(attached, !skill.enabled)}
            >
              <span style={s.dragHandle(draggable)} aria-hidden>
                <Icon.Menu size={13} />
              </span>
              <Checkbox
                checked={attached}
                onChange={(v) => toggle(skill, v)}
                label={
                  <span className="mono" style={s.rowName}>
                    {skill.name}
                  </span>
                }
              />
              {!skill.enabled && (
                <Badge color="var(--text-muted)">{t("skills.globallyDisabled")}</Badge>
              )}
              <span style={s.rowSpacer} />
              <Badge color={typeColor(skill.type)}>{skill.type}</Badge>
            </div>
          );
        })}
      </div>
    </div>
  );
}
