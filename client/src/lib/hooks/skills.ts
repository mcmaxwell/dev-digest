/* hooks/skills.ts — React Query hooks for the L02 Skills page + skill editor. */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type {
  Skill,
  SkillImportPreview,
  SkillSource,
  SkillStats,
  SkillType,
  SkillVersion,
} from "@devdigest/shared";

/** Query keys for skills — never hand-write these in a component. */
export const skillsKeys = {
  all: ["skills"] as const,
  one: (id: string | null | undefined) => ["skill", id] as const,
  versions: (id: string | null | undefined) => ["skill", id, "versions"] as const,
  stats: (id: string | null | undefined) => ["skill", id, "stats"] as const,
};

export function useSkills() {
  return useQuery({
    queryKey: skillsKeys.all,
    queryFn: () => api.get<Skill[]>("/skills"),
  });
}

export function useSkill(id: string | null | undefined) {
  return useQuery({
    queryKey: skillsKeys.one(id),
    queryFn: () => api.get<Skill>(`/skills/${id}`),
    enabled: !!id,
  });
}

export interface CreateSkillInput {
  name: string;
  description?: string;
  type: SkillType;
  body: string;
  source?: SkillSource;
  enabled?: boolean;
}

export function useCreateSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateSkillInput) => api.post<Skill>("/skills", input),
    onSuccess: () => qc.invalidateQueries({ queryKey: skillsKeys.all }),
  });
}

export interface UpdateSkillInput {
  id: string;
  patch: Partial<Pick<Skill, "name" | "description" | "type" | "body" | "enabled">>;
}

export function useUpdateSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: UpdateSkillInput) => api.put<Skill>(`/skills/${id}`, patch),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: skillsKeys.all });
      qc.setQueryData(skillsKeys.one(data.id), data);
      // a body edit snapshots a new immutable version
      qc.invalidateQueries({ queryKey: skillsKeys.versions(data.id) });
    },
  });
}

/** Immutable body-version history for one skill, newest first. */
export function useSkillVersions(id: string | null | undefined) {
  return useQuery({
    queryKey: skillsKeys.versions(id),
    queryFn: () => api.get<SkillVersion[]>(`/skills/${id}/versions`),
    enabled: !!id,
  });
}

/** Usage stats: attached agents + their runs/findings (attribution by linkage). */
export function useSkillStats(id: string | null | undefined) {
  return useQuery({
    queryKey: skillsKeys.stats(id),
    queryFn: () => api.get<SkillStats>(`/skills/${id}/stats`),
    enabled: !!id,
  });
}

/** Restore an old body — the server saves it as a NEW version (history intact). */
export function useRollbackSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, version }: { id: string; version: number }) =>
      api.post<Skill>(`/skills/${id}/rollback`, { version }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: skillsKeys.all });
      qc.setQueryData(skillsKeys.one(data.id), data);
      qc.invalidateQueries({ queryKey: skillsKeys.versions(data.id) });
    },
  });
}

export function useDeleteSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<{ ok: boolean }>(`/skills/${id}`),
    onSuccess: (_d, id) => {
      qc.invalidateQueries({ queryKey: skillsKeys.all });
      qc.removeQueries({ queryKey: skillsKeys.one(id) });
      // deleting a skill cascades out of agent_skills → agents' skill counts change
      qc.invalidateQueries({ queryKey: ["agents"] });
      qc.invalidateQueries({ queryKey: ["agent-skills"] });
    },
  });
}

/** Upload a .md/.zip and get the parsed PREVIEW back — persists nothing. */
export function useImportSkillPreview() {
  return useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append("file", file);
      return api.postForm<SkillImportPreview>("/skills/import", form);
    },
  });
}
