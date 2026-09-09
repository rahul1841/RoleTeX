/**
 * Every TanStack Query key in the app, in one place.
 *
 * Centralizing them makes invalidation auditable: when a mutation changes
 * server state, you can see exactly which keys it must invalidate rather than
 * guessing at string arrays scattered through components.
 *
 * Keys are hierarchical, so `queryClient.invalidateQueries({ queryKey:
 * queryKeys.resumes.all })` clears the list and every individual resume.
 */
export const queryKeys = {
  health: ["health"] as const,

  session: {
    all: ["session"] as const,
    me: ["session", "me"] as const,
    list: ["session", "list"] as const,
  },

  providers: ["providers"] as const,
  keys: ["keys"] as const,

  resumes: {
    all: ["resumes"] as const,
    list: ["resumes", "list"] as const,
    detail: (id: string) => ["resumes", "detail", id] as const,
    versions: (id: string) => ["resumes", "versions", id] as const,
    versionSource: (id: string, version: number) =>
      ["resumes", "versions", id, version, "source"] as const,
  },

  jds: {
    all: ["jds"] as const,
    list: ["jds", "list"] as const,
    detail: (id: string) => ["jds", "detail", id] as const,
    versions: (id: string) => ["jds", "versions", id] as const,
  },

  runs: {
    all: ["runs"] as const,
    list: ["runs", "list"] as const,
    detail: (id: string) => ["runs", "detail", id] as const,
  },
} as const;
