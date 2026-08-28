# acme monorepo

Three packages: `svc-api`, `svc-worker`, `tooling`.

## Rules

- `tooling/` is the only package on **zod 4**. It is a standalone code generator
  that shares no schema with the services, and the v4 rewrite of `z.record` is
  what its generator needs. The services stay on zod 3 until the shared
  contracts are ported. This split is deliberate and documented here; do not
  "unify" it.
- Everything else should agree on a version across packages.
