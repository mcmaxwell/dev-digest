import type { CiTarget, CiTrigger } from "@devdigest/shared";
import type { IconName } from "@devdigest/ui";

/** A target tile. Only `gha` is buildable today; the rest are shown so the
 *  roadmap is visible, and disabled so it is not mistaken for a choice. */
export interface TargetOption {
  key: CiTarget;
  icon: IconName;
  enabled: boolean;
}

export const TARGETS: readonly TargetOption[] = [
  { key: "gha", icon: "Workflow", enabled: true },
  { key: "circle", icon: "RefreshCw", enabled: false },
  { key: "jenkins", icon: "Settings", enabled: false },
  { key: "cli", icon: "Command", enabled: false },
];

/** Canonical trigger order - the same order the server emits (bundle.ts). */
export const TRIGGERS: readonly CiTrigger[] = ["opened", "synchronize", "reopened"];

export const POST_AS = ["github_review", "pr_comment", "none"] as const;

/** Message keys for `POST_AS`, which are camelCase where the values are snake. */
export const POST_AS_KEY: Record<(typeof POST_AS)[number], string> = {
  github_review: "githubReview",
  pr_comment: "prComment",
  none: "none",
};
