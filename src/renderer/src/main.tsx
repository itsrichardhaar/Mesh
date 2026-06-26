import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
// Self-hosted variable fonts. Fontsource registers `@font-face` rules
// for `Inter Variable` and `JetBrains Mono Variable` — referenced by the
// `--font-sans` / `--font-mono` tokens in `styles.css`.
import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import './styles.css'
// xterm ships its own stylesheet for the terminal viewport — imported
// once globally so Slice 16's `PtyView` renders correctly.
import '@xterm/xterm/css/xterm.css'

// Best-guess paint before React mounts: assume `system` and read the OS
// preference now so the first frame uses the right palette. If the user
// has an explicit stored choice that differs, ThemeProvider corrects it
// once the persisted setting hydrates.
const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light')

// UI Mode default before UiModeProvider hydrates — v2 default is `sans`
// (matches existing visual; no jolt for current users). UiModeProvider
// overwrites this if the stored preference differs.
document.documentElement.setAttribute('data-ui-mode', 'sans')

const container = document.getElementById('root')
if (!container) throw new Error('Root container not found')

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>
)
