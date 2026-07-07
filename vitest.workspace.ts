import { defineWorkspace } from 'vitest/config'

/**
 * Two test projects, split by environment (Slice 45 / v6):
 *
 *  - `main` — the existing node-environment suite over src/main + shared.
 *    Unchanged from the pre-workspace setup.
 *  - `renderer` — jsdom + React Testing Library over src/renderer, living
 *    under tests/renderer/. Its setup file installs a fresh typed
 *    `window.api` fake before every test (see tests/renderer/test-utils.tsx).
 *
 * One `pnpm test` runs both; environments never mix.
 */
export default defineWorkspace([
  {
    extends: './vitest.config.ts',
    test: {
      name: 'main',
      environment: 'node',
      include: ['tests/**/*.test.ts'],
      exclude: ['tests/renderer/**']
    }
  },
  {
    extends: './vitest.config.ts',
    test: {
      name: 'renderer',
      environment: 'jsdom',
      include: ['tests/renderer/**/*.test.ts', 'tests/renderer/**/*.test.tsx'],
      setupFiles: ['tests/renderer/setup.ts']
    }
  }
])
