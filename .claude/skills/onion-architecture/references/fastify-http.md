# Fastify HTTP layer — routes as driving adapters

The route file is a *driving adapter*: it translates HTTP into a use-case
call and the result back into HTTP. Nothing else.

## The canonical shape (`modules/repos/routes.ts`)

```ts
export default async function reposRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new RepoService(app.container);

  app.post('/repos', { schema: { body: RepoInput } }, async (req, reply) => {
    const { workspaceId, userId } = await getContext(app.container, req);
    const { repo, created } = await service.add(workspaceId, userId, req.body.url);
    reply.status(created ? 201 : 200);
    return repo;
  });
}
```

Everything a route handler is allowed to do is visible here:

1. **Declare zod schemas** (`body`/`params`/`querystring`) from
   `@devdigest/shared` or `modules/_shared/schemas.ts`. Invalid input 422s
   *before* the handler runs — never `Schema.parse(req.body)` by hand
   (project convention; "parse, don't validate" — the type provider IS the
   parser at the trust boundary).
2. **Resolve context** via `getContext(app.container, req)` — tenancy comes
   from the auth port, not from the request body.
3. **Call one service method** with plain typed arguments (not `req`).
4. **Map the result to HTTP**: status code, envelope. Domain errors surface
   as `AppError` subclasses and are translated by the shared error handler —
   handlers don't try/catch business errors.

## What routes must NOT do

- Import `drizzle-orm`, `src/db/*`, or any repository directly — enforced by
  `arch:check` (legacy exceptions listed in `references/layers.md`).
- Branch on business conditions (dedupe, state machines, retries). If a
  handler has an `if` that isn't about HTTP (status code choice, header),
  the logic belongs in the service.
- Reach into ports (`container.git`, `container.github()`) — only services
  touch ports. The route's dependency is the service.
- Build DTOs field-by-field — mapping rows to DTOs is `helpers.ts` work,
  called from the service.

## Why this strictness pays

- The service is callable from any driver: HTTP today, the polling loop, a
  JobRunner job, or a CI runner tomorrow — same use case, zero duplication
  (hexagonal symmetry: one port, many adapters).
- Handler tests become service tests (hermetic, mock ports) plus a thin
  route test via `app.inject()` — no HTTP server needed to test business
  rules.
- Fastify concerns (rate-limit, helmet, CORS, SSE) stay in plugins
  registered before modules; modules inherit them and stay clean.
