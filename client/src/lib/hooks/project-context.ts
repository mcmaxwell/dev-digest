/* hooks/project-context.ts — React Query hooks for L05 Project Context: the
   repository's document tree/viewer and the agent/skill Context tabs. */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type {
  AgentContext,
  ProjectDocBody,
  ProjectDocList,
  SkillContext,
} from "@/lib/types";

/** Query keys for project context — never hand-write these in a component. */
export const projectContextKeys = {
  list: (repoId: string | null | undefined) => ["project-context", repoId] as const,
  doc: (repoId: string | null | undefined, path: string | null | undefined) =>
    ["project-context", repoId, "doc", path] as const,
  agent: (agentId: string | null | undefined, repoId: string | null | undefined) =>
    ["project-context", "agent", agentId, repoId] as const,
  skill: (skillId: string | null | undefined) => ["project-context", "skill", skillId] as const,
};

/** A repository's document list plus its scan status (metadata only). */
export function useProjectDocs(repoId: string | null | undefined) {
  return useQuery({
    queryKey: projectContextKeys.list(repoId),
    queryFn: () => api.get<ProjectDocList>(`/repos/${repoId}/context`),
    enabled: !!repoId,
  });
}

/** One document's body. Fails per document — the tree selection is unaffected. */
export function useProjectDoc(repoId: string | null | undefined, path: string | null | undefined) {
  return useQuery({
    queryKey: projectContextKeys.doc(repoId, path),
    queryFn: () =>
      api.get<ProjectDocBody>(
        `/repos/${repoId}/context/doc?path=${encodeURIComponent(path ?? "")}`,
      ),
    enabled: !!repoId && !!path,
    retry: false,
  });
}

/** Re-run discovery. The only action the tree toolbar carries. */
export function useRefreshProjectDocs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (repoId: string) => api.post<ProjectDocList>(`/repos/${repoId}/context/refresh`),
    onSuccess: (data, repoId) => {
      qc.setQueryData(projectContextKeys.list(repoId), data);
      // Attachment rows carry a `missing` status derived from this scan.
      qc.invalidateQueries({ queryKey: ["project-context", "agent"] });
      qc.invalidateQueries({ queryKey: ["project-context", "skill"] });
    },
  });
}

export function useAgentContext(
  agentId: string | null | undefined,
  repoId: string | null | undefined,
) {
  return useQuery({
    queryKey: projectContextKeys.agent(agentId, repoId),
    queryFn: () =>
      api.get<AgentContext>(
        `/agents/${agentId}/context${repoId ? `?repo_id=${repoId}` : ""}`,
      ),
    enabled: !!agentId,
  });
}

export interface SetContextDocsInput {
  docs: { repo_id: string; path: string }[];
}

/** Full replace of an agent's attachment set; array position IS the order. */
export function useSetAgentContextDocs(
  agentId: string | null | undefined,
  repoId: string | null | undefined,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SetContextDocsInput) =>
      api.put<AgentContext>(
        `/agents/${agentId}/context${repoId ? `?repo_id=${repoId}` : ""}`,
        input,
      ),
    onSuccess: (data) => {
      qc.setQueryData(projectContextKeys.agent(agentId, repoId), data);
      // "Used by N agents" on the Project Context page just moved.
      qc.invalidateQueries({ queryKey: projectContextKeys.list(repoId) });
    },
  });
}

export function useSkillContext(skillId: string | null | undefined) {
  return useQuery({
    queryKey: projectContextKeys.skill(skillId),
    queryFn: () => api.get<SkillContext>(`/skills/${skillId}/context`),
    enabled: !!skillId,
  });
}

export function useSetSkillContextDocs(skillId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SetContextDocsInput) =>
      api.put<SkillContext>(`/skills/${skillId}/context`, input),
    onSuccess: (data) => {
      qc.setQueryData(projectContextKeys.skill(skillId), data);
      // A skill's documents are inherited by every agent that links it.
      qc.invalidateQueries({ queryKey: ["project-context", "agent"] });
      qc.invalidateQueries({ queryKey: ["project-context"] });
    },
  });
}
