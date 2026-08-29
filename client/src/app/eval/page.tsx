import type { Metadata } from "next";
import { EvalDashboardView } from "./_components/EvalDashboardView";

/* Route: /eval (L06 Eval Dashboard). Thin route entry — the view, its styles
   and helpers are colocated under _components. */
export const metadata: Metadata = {
  title: "Eval Dashboard · DevDigest",
};

export default function EvalDashboardPage() {
  return <EvalDashboardView />;
}
