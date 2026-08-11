import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // The hermetic lane is `pnpm test` (which passes --exclude '**/*.it.test.ts');
    // `pnpm test:it` selects the `.it.test` files and needs a live stack.
    environment: 'node',
  },
});
