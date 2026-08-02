# Constants, utils, types, imports & enforcement

## Constants

- Default: **colocate**. A constant used by one feature lives in that feature
  (`features/x/constants.ts` or inline in the component folder). Promote only
  on second consumer.
- A single small app-wide `constants.ts` or `config/` is legitimate for
  genuinely global values: env-derived config, design tokens (breakpoints,
  z-indices), public keys, route paths (Comeau keeps exactly one
  `src/constants.ts`). FSD variant: `shared/config` (env, flags) +
  `shared/routes`.
- Avoid the giant `constants.ts` dumping ground for the same reason as the
  junk-drawer `utils/` — technical-layer folders accumulate unrelated code.
- Naming (Google TS Style Guide): UPPER_SNAKE_CASE only for module-level,
  deeply-immutable constants (`MAX_USERS`); ordinary local `const` bindings
  stay camelCase.
- Enums (official TS handbook): "you may not need an enum when an object with
  `as const` could suffice." Pattern:
  `const Direction = { Up: 0, ... } as const` +
  `type Direction = typeof Direction[keyof typeof Direction]`.
  Counterpoint: enums still win for reverse mapping, member iteration, and
  nominal typing — choose per use case, don't mass-convert.

## utils vs helpers vs lib

- **utils** (Comeau's distinction, the most-cited): generic, abstract,
  project-agnostic pure functions (`clamp()`, `sampleOne()`). Stateless, no
  I/O, no framework imports.
- **helpers**: project/domain-specific functions that wouldn't make sense in
  another codebase. Litmus test: if it needs domain knowledge to name, or
  only one feature uses it → it's feature code, put it in the feature.
- **lib** (bulletproof-react): preconfigured adapters/re-exports of
  third-party libraries — the axios instance, the query client, the auth
  client. The seam to external deps.
- FSD is stricter still: `shared/lib` is a set of focused internal
  mini-libraries (dates, colors, text), each with one documented area of
  focus; a grab-bag utils folder is an explicit anti-pattern.
- Features mirror the shared folder set internally (feature-local `utils/`,
  `types/`, `api/`) — include only the folders the feature needs.

## Types

- Colocate with usage: component props next to the component, feature types
  in `features/x/types/`. Global `types/` folder only for truly cross-cutting
  base types (bulletproof-react's split).
- API contracts: **zod schema as single source of truth**, derive types with
  `z.infer` — no duplicate hand-written types. `z.input` for pre-parse shapes
  (form state), `z.infer`/`z.output` for validated results. Colocate schema +
  fetcher + hook (bulletproof-react `features/*/api` pattern).
- dev-digest note: `@devdigest/shared` follows schemas-as-contract, but has
  two physical copies (server + client vendor dirs) — updating BOTH is
  mandatory or contracts drift (see CLAUDE.md).

## Path aliases

- One alias: `@/* → ./src/*` (`~/` is the Remix-ecosystem alternative — pick
  one, not several). Kills `../../../` climbing and distinguishes source from
  node_modules.

```jsonc
// tsconfig.json
{ "compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["./src/*"] } } }
```

## Enforcing architecture with ESLint

bulletproof-react's actual config (from its `.eslintrc.cjs`), via
`import/no-restricted-paths` zones:

```js
'import/no-restricted-paths': ['error', {
  zones: [
    // 1. No cross-feature imports (one zone per feature):
    { target: './src/features/auth', from: './src/features',
      except: ['./auth'] },
    // ...repeat for each feature

    // 2. Unidirectional: app may not be imported by features,
    //    features/app may not be imported by the shared layer:
    { target: './src/features', from: './src/app' },
    { target: ['./src/components','./src/hooks','./src/lib',
               './src/types','./src/utils'],
      from: ['./src/features','./src/app'] },
  ],
}],
'import/no-cycle': 'error',   // guards barrel-induced cycles
```

- Heavier-duty: `eslint-plugin-boundaries` — declare element types
  (shared/feature/app or FSD layers) via file patterns, then an
  allow/deny matrix between them; suits monorepos and custom layerings.
- FSD ecosystem: `steiger` linter enforces the layer import rules.
- File naming: `eslint-plugin-check-file` to mandate kebab-case files/folders
  (bulletproof-react standard).
