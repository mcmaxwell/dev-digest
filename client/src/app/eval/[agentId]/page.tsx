import type { Metadata } from "next";
import { AgentEvalView } from "./_components/AgentEvalView";

/* Route: /eval/:agentId (L06). One agent's harness: metrics, trend, run history
   and the paired comparison. Thin route entry — everything else is colocated. */
export const metadata: Metadata = {
  title: "Agent evals · DevDigest",
};

export default async function AgentEvalPage({
  params,
}: {
  params: Promise<{ agentId: string }>;
}) {
  const { agentId } = await params;
  return <AgentEvalView agentId={agentId} />;
}
