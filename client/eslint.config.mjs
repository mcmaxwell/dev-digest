import tseslint from 'typescript-eslint';
import importPlugin from 'eslint-plugin-import';
import reactHooks from 'eslint-plugin-react-hooks';

/**
 * Frontend architecture boundaries (see .claude/skills/frontend-ui-architecture/).
 *
 * These rules exist because the layering here was previously convention-only:
 * feature isolation, the shared-layer direction, and the absence of cycles were
 * enforced by nothing. Run: pnpm lint
 *
 * Layers, outermost first:
 *   src/app/**      routes + colocated feature code (_components/)
 *   src/components/ shared presentational components
 *   src/lib/        data hooks, api client, pure utils
 *   src/vendor/     vendored UI kit + the shared Zod contracts copy
 * An inner layer must never import an outer one, and one feature must never
 * reach into another feature's `_components/`.
 *
 * NOTE: deliberately does NOT extend `eslint-config-next` — it still ships the
 * @rushstack ESLint patch, which throws "Failed to patch ESLint" on ESLint 9
 * flat config. Next's own rules are covered by `next build`; this config exists
 * for the architecture boundaries, so it stays dependency-light on purpose.
 */
export default [
  {
    ignores: ['src/vendor/**', '.next/**', 'node_modules/**', 'next-env.d.ts'],
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { ecmaFeatures: { jsx: true }, sourceType: 'module' },
    },
    plugins: { import: importPlugin, 'react-hooks': reactHooks },
    settings: {
      'import/resolver': {
        typescript: { project: './tsconfig.json' },
      },
    },
    rules: {
      // Hook correctness — also what the existing `eslint-disable
      // react-hooks/exhaustive-deps` comments in this codebase refer to.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',

      // Import cycles are the failure mode barrels invite; catch them early.
      'import/no-cycle': ['error', { maxDepth: 10, ignoreExternal: true }],

      'import/no-restricted-paths': [
        'error',
        {
          zones: [
            {
              target: './src/lib',
              from: './src/app',
              message:
                'lib/ is the innermost shared layer — it must not depend on routes. Move the shared piece down into lib/ instead.',
            },
            {
              target: './src/lib',
              from: './src/components',
              message: 'lib/ must not depend on components/. Invert the dependency.',
            },
            {
              target: './src/components',
              from: './src/app',
              message:
                'A shared component must not import route code. If only one route needs it, colocate it under that route instead.',
            },
            {
              target: './src/vendor',
              from: './src/app',
              message: 'vendor/ is vendored code — it must never depend on app code.',
            },
            {
              target: './src/vendor',
              from: './src/lib',
              message: 'vendor/ is vendored code — it must never depend on app code.',
            },
          ],
        },
      ],
    },
  },
  {
    // One feature must not reach into a SIBLING feature's colocated internals.
    //
    // The regex matches a named path segment immediately before `_components`,
    // which is exactly the sibling case (`../OtherFeature/_components/X`,
    // `@/app/agents/_components/X`). Own-feature (`./_components/X`) and
    // ancestor-segment (`../../../_components/X`) imports have only `.`/`..`
    // there, so they stay allowed — promoting a shared piece UP to the common
    // ancestor segment is the sanctioned way to share between features.
    files: ['src/app/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '(^|/)(?!\\.\\.?/)[^/]+/_components/',
              message:
                "Don't import a sibling feature's _components. Promote the shared piece to the nearest common ancestor segment, or to src/components/.",
            },
          ],
        },
      ],
    },
  },
];
