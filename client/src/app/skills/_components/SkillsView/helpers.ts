import type { Skill, SkillType } from "@devdigest/shared";

/** Case-insensitive name/description/type filter for the skills grid. */
export function filterSkills(skills: Skill[], query: string): Skill[] {
  const q = query.trim().toLowerCase();
  if (!q) return skills;
  return skills.filter(
    (s) =>
      s.name.toLowerCase().includes(q) ||
      s.description.toLowerCase().includes(q) ||
      s.type.toLowerCase().includes(q),
  );
}

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

/** A skill from a non-manual source that is still disabled needs vetting. */
export function needsVetting(skill: Skill): boolean {
  return skill.source !== "manual" && !skill.enabled;
}
