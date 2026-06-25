import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './styles.css'

// Best-guess paint before React mounts: assume `system` and read the OS
// preference now so the first frame uses the right palette. If the user
// has an explicit stored choice that differs, ThemeProvider corrects it
// once the persisted setting hydrates.
const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light')

const container = document.getElementById('root')
if (!container) throw new Error('Root container not found')

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>
)
