import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'shared'),
      '@main': resolve(__dirname, 'src/main'),
      '@renderer': resolve(__dirname, 'src/renderer/src')
    }
  },
  // Shared base for the two workspace projects (vitest.workspace.ts).
  // `include` lives in each project — defining it here would merge into
  // both projects and cross-contaminate their file sets.
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      include: ['src/main/**', 'shared/**'],
      exclude: ['**/*.d.ts', '**/index.ts']
    }
  }
})
