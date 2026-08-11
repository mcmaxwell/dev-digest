import type { SkillType } from "@devdigest/shared";

/** Badge colour per skill type (matches the trace/legend accents). */
export function typeColor(type: SkillType): string {
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
