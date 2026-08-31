import type { IconName } from "@devdigest/ui";

/** Editor tab descriptor. `labelKey` resolves under the `agents` namespace. */
export interface EditorTab {
  key: string;
  labelKey: string;
  icon: IconName;
}

/** Editor tabs. L02 adds Skills; L06 adds Evals; L07 adds Runs; later lessons
    add Stats/CI. Every entry here needs TWO more edits to actually open: the
    branch in `AgentEditor.tsx` and the `VALID_TABS` allowlist in the route page
    (`app/agents/[id]/page.tsx`). Miss the third and the tab renders, sets
    `?tab=`, and silently shows Config. */
export const TABS: readonly EditorTab[] = [
  { key: "config", labelKey: "editor.tabs.config", icon: "Settings" },
  { key: "skills", labelKey: "editor.tabs.skills", icon: "Sparkles" },
  { key: "context", labelKey: "editor.tabs.context", icon: "FileText" },
  { key: "evals", labelKey: "editor.tabs.evals", icon: "FlaskConical" },
  { key: "runs", labelKey: "editor.tabs.runs", icon: "History" },
];
