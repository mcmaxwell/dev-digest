import type { Metadata } from "next";
import { SkillsView } from "./_components/SkillsView";

/* Route: /skills (L02 Skills page). Thin route entry — the view, its drawers,
   styles, constants, helpers and i18n are colocated under _components/SkillsView. */
export const metadata: Metadata = {
  title: "Skills · DevDigest",
};

export default function SkillsPage() {
  return <SkillsView />;
}
