import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'shared'),
      '@main': resolve(__dirname, 'src/main')
    }
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      include: ['src/main/**', 'shared/**'],
      exclude: ['**/*.d.ts', '**/index.ts']
    }
  }
})
