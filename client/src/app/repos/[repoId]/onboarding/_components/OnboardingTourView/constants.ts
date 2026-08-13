import type { OnboardingSectionKind } from "@/lib/types";

/** Below this width the "on this page" list collapses to one jump control. */
export const NARROW_VIEWPORT_PX = 900;

/** The five sections, in the fixed order the page renders and navigates them. */
export const SECTION_KINDS: readonly OnboardingSectionKind[] = [
  "architecture",
  "critical_paths",
  "run_locally",
  "reading_path",
  "first_tasks",
] as const;

/** DOM id of a section heading, so the page nav can move focus to it. */
export const sectionDomId = (kind: OnboardingSectionKind) => `onboarding-section-${kind}`;

/** How long a copy confirmation stays on screen and in the live region. */
export const COPY_FEEDBACK_MS = 2000;

/** Longest path rendered whole before the directory part is middle-truncated. */
export const MAX_PATH_CHARS = 48;
