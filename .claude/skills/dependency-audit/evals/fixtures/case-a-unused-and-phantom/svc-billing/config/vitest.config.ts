import { defineConfig } from 'vitest/config';
// dayjs is also referenced from config; it is a real runtime dependency.
export default defineConfig({ test: { globals: true, environment: 'node' } });
