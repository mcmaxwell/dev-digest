import type { Skill } from "@devdigest/shared";

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

/** A skill from a non-manual source that is still disabled needs vetting. */
export function needsVetting(skill: Skill): boolean {
  return skill.source !== "manual" && !skill.enabled;
}
