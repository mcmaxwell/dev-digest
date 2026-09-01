import type { IconName } from "@devdigest/ui";

/** Editor tab descriptor. `labelKey` resolves under the `agents` namespace. */
export interface EditorTab {
  key: string;
  labelKey: string;
  icon: IconName;
}

/** Editor tabs. L02 adds Skills; L06 adds Evals and CI; L07 adds Runs; a later
    lesson adds Stats. Every entry here needs ONE more edit to actually open:
    the branch in `AgentEditor.tsx`. The `?tab=` allowlist used to be a third
    edit, hand-written in the route page, and missing it there rendered the tab,
    set `?tab=`, and silently showed Config anyway. `VALID_TABS` below is now
    derived from this list, so that failure mode is gone. */
export const TABS: readonly EditorTab[] = [
  { key: "config", labelKey: "editor.tabs.config", icon: "Settings" },
  { key: "skills", labelKey: "editor.tabs.skills", icon: "Sparkles" },
  { key: "context", labelKey: "editor.tabs.context", icon: "FileText" },
  { key: "evals", labelKey: "editor.tabs.evals", icon: "FlaskConical" },
  { key: "runs", labelKey: "editor.tabs.runs", icon: "History" },
  { key: "ci", labelKey: "editor.tabs.ci", icon: "Workflow" },
];

/**
 * The `?tab=` values the route accepts, derived from TABS so the two cannot
 * drift. This was once a hand-written list in `page.tsx`: a key missing there
 * is silently normalised back to "config", so the tab strip shows the tab, the
 * URL says `?tab=<key>`, and the Config panel renders anyway. That is exactly
 * how the CI tab shipped unreachable. It lives here rather than in `page.tsx`
 * because a Next App Router page may export only the route contract.
 */
export const VALID_TABS: readonly string[] = TABS.map((t) => t.key);
