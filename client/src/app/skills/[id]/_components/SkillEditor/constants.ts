import type { IconName } from "@devdigest/ui";

/** Editor tab descriptor. `labelKey` resolves under the `skills` namespace. */
export interface EditorTab {
  key: string;
  labelKey: string;
  icon: IconName;
}

/** Skill editor tabs: config form, usage statistics, immutable body history. */
export const TABS: readonly EditorTab[] = [
  { key: "config", labelKey: "detail.tabs.config", icon: "Settings" },
  { key: "stats", labelKey: "detail.tabs.stats", icon: "BarChart" },
  { key: "history", labelKey: "detail.tabs.history", icon: "History" },
  { key: "context", labelKey: "detail.tabs.context", icon: "FileText" },
];
