import type { SmartDiffRole } from "@devdigest/shared";

/**
 * Per-role presentation. The label/description keys resolve against the
 * `prReview.smartDiff` namespace; the colour is the group's square in the
 * section header — a quiet hue ladder from "read this" to "skim this".
 */
export const ROLE_META: Record<
  SmartDiffRole,
  { labelKey: string; descKey: string; color: string }
> = {
  core: { labelKey: "coreLabel", descKey: "coreDesc", color: "var(--accent)" },
  wiring: { labelKey: "wiringLabel", descKey: "wiringDesc", color: "var(--warn)" },
  boilerplate: {
    labelKey: "boilerplateLabel",
    descKey: "boilerplateDesc",
    color: "var(--text-muted)",
  },
};

/**
 * Roles whose files open by default. Wiring and boilerplate stay collapsed
 * unless they carry a finding — that exception lives in `SmartDiffViewer`,
 * because it depends on the file, not on the role.
 */
export const AUTO_OPEN_ROLES: readonly SmartDiffRole[] = ["core"];
