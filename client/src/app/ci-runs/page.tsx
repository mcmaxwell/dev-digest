import type { Metadata } from "next";
import { CiRunsView } from "./_components/CiRunsView";

/* Route: /ci-runs (L06 CI Runs). Thin route entry - the view, its constants
   and its styles are colocated under _components, because a page.tsx may
   export nothing but the route contract. */
export const metadata: Metadata = {
  title: "CI Runs · DevDigest",
};

export default function CiRunsPage() {
  return <CiRunsView />;
}
