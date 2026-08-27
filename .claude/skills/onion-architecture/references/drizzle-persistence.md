# Drizzle persistence — repositories as driven adapters

Drizzle is infrastructure. The repository is the adapter that hides it; the
service programs against the repository's methods, never against the query
builder. ("Repository mediates between domain and data mapping" — Fowler,
via Stemmler/Sentry.)

## The canonical shape (`modules/repos/repository.ts`)

```ts
export class RepoRepository {
  constructor(private db: Db) {}

  async getById(workspaceId: string, id: string): Promise<RepoRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.repos)
      .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.id, id)));
    return row;
  }
}
```

## Rules

1. **One table, one owner.** Exactly one repository class owns each table.
   Another module that needs the data uses the owning repository via the
   container (`container.reviewRepo`, `container.agentsRepo`) — never a
   second query against a foreign table. (Atomic repositories — Sentry;
   granularity per aggregate, not per convenience.)
2. **Every query is workspace-scoped.** `where(and(eq(workspaceId, …), …))`
   is the tenancy guard. An unscoped query needs a comment explaining why the
   caller's trust chain makes it safe (see `workspaceIdFor` in
   RepoRepository).
3. **Repositories take `Db` (or `Tx`), not `Container`.** They are leaf
   adapters — giving them the container would let persistence reach ports
   and invert the onion.
4. **Return rows or narrow projections, not DTOs, with one named exception.**
   `$inferSelect` types (`RepoRow`) cross into the service; the service maps to
   wire DTOs via `helpers.ts` (`toRepoDto`).
   Wire format is not persistence's business.

   The exception is a *read model*: a joined or aggregated projection that has
   no row form of its own and exists only to be read.
   `reviews/repository/run.repo.ts` `listRunsForPull` is the in-repo precedent -
   it joins `agent_runs` with `agents.name` and returns the shared `RunSummary`
   contract, because no `$inferSelect` row describes that shape.

   **Decision test - does a `$inferSelect` row already describe this shape?**
   If yes, return the row and let the service map it; a repository that mixes
   rows and DTOs makes the service guess which it is holding.
   If no, and the shape only exists because of the join or the aggregate, the
   projection IS the return type, and naming it with the shared contract beats
   inventing a duplicate type that has to be kept in step by hand.
5. **Methods are named after intent**, not SQL: `findByFullName`,
   `updateClonePath` — a use-case vocabulary, so the service reads as
   business language (Muyiwa; repository-pattern-with-Drizzle write-ups).

## Transactions

The **service** owns the transaction boundary, because only it knows the
business operation's scope; repositories accept the transaction handle and
stay composable (Silva, pt. 2):

```ts
// service.ts — owns the boundary
await this.container.db.transaction(async (tx) => {
  await this.runs.markCompleted(tx, runId, verdict);
  await this.findings.insertMany(tx, runId, findings);
});

// repository — accepts Db OR Tx, never opens one
async insertMany(db: Db | Tx, runId: string, rows: NewFinding[]) { … }
```

Open a transaction inside a repository only for an indivisible persistence
primitive (SKILL.md rule 6's decision test), and never let a transaction
span an LLM/network call — ports are slow and failable; keep tx scopes to
DB writes only.

## Schema changes

`db/schema*.ts` is the only hand-edited source; `pnpm db:generate` produces
migrations; never hand-edit `db/migrations/`. The schema already contains
every table for all course lessons — empty tables are by design.
