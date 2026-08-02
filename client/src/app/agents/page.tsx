import type { Metadata } from "next";
import { AgentsListView } from "./_components/AgentsListView";

/* Route: /agents (Agents list). Thin route entry — the view, its create modal,
   styles, constants, helpers and i18n are colocated under _components/AgentsListView. */
export const metadata: Metadata = {
  title: "Agents · DevDigest",
};

export default function AgentsPage() {
  return <AgentsListView />;
}
