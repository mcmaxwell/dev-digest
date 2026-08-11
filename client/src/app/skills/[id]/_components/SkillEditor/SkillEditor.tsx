/* SkillEditor — tabbed editor for one skill: Configuration (form),
   Statistics (usage via linked agents), Version history (immutable body
   snapshots + rollback). Tab state lives in ?tab= (owned by the page). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Tabs } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { ConfigTab } from "./_components/ConfigTab";
import { StatsTab } from "./_components/StatsTab";
import { HistoryTab } from "./_components/HistoryTab";
import { TABS } from "./constants";
import { s } from "./styles";

export function SkillEditor({
  skill,
  tab,
  onTab,
}: {
  skill: Skill;
  tab: string;
  onTab: (t: string) => void;
}) {
  const t = useTranslations("skills");
  const tabs = TABS.map((tb) => ({ key: tb.key, label: t(tb.labelKey), icon: tb.icon }));
  return (
    <div style={s.wrap}>
      <div style={s.tabsBar}>
        <Tabs tabs={tabs} value={tab} onChange={onTab} pad="0 24px" />
      </div>
      <div style={s.body}>
        {/* key={skill.id}: remount on skill switch instead of resetting form
           state via an effect (same pattern as AgentEditor). */}
        {tab === "stats" ? (
          <StatsTab key={skill.id} skill={skill} />
        ) : tab === "history" ? (
          <HistoryTab key={skill.id} skill={skill} />
        ) : (
          <ConfigTab key={skill.id} skill={skill} />
        )}
      </div>
    </div>
  );
}
