import type { ConventionCategory, SkillType } from "@devdigest/shared";

/** Display order for the category groups — most actionable first. */
export const CATEGORY_ORDER: ConventionCategory[] = [
  "api-contract",
  "structure",
  "error-handling",
  "types",
  "async",
  "imports",
  "naming",
  "testing",
  "logging",
  "config",
];

export const SKILL_TYPES: SkillType[] = ["rubric", "convention", "security", "custom"];

export const CREATE_MODAL_WIDTH = 720;

/** Evidence sites shown before the card collapses the rest behind a counter. */
export const VISIBLE_EVIDENCE = 2;
