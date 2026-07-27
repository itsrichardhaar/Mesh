import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    // Bundle @xterm/headless into the main output rather than leaving it
    // external: it's a CommonJS module, and an external ESM `import
    // { Terminal }` against it fails Node's ESM loader at boot. Rollup
    // handles the CJS→ESM interop when it's bundled. Pure JS (no native
    // bindings), so bundling is safe — unlike node-pty / better-sqlite3.
    plugins: [externalizeDepsPlugin({ exclude: ['@xterm/headless'] })],
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'shared'),
        '@main': resolve(__dirname, 'src/main'),
        // @xterm/headless's package.json `module` field points at a
        // non-existent lib/xterm.mjs, so vite's bundler can't resolve the
        // entry. Alias straight to the real ESM build it actually ships.
        '@xterm/headless': resolve(
          __dirname,
          'node_modules/@xterm/headless/lib-headless/xterm-headless.mjs'
        )
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'shared')
      }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'src/renderer/index.html')
      }
    },
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'shared'),
        '@renderer': resolve(__dirname, 'src/renderer/src')
      }
    },
    plugins: [react()]
  }
})
