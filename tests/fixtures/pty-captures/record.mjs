// Record a REAL Claude Code PTY byte-stream fixture.
//
//   node record.mjs <name>            # e.g. node record.mjs approval-bash
//
// Spawns `claude` in a pseudo-terminal, mirrors it to your terminal so
// you can drive it interactively, and tees every raw output byte to
// <name>.cap in this directory. Drive Claude to the state you want to
// capture (e.g. a tool-permission prompt), let the frame settle, then
// press Ctrl-] to stop recording. The raw bytes — ANSI and all — are
// exactly what ScreenModel.write() receives in production.
//
// Requires a TTY (run it in a real terminal, not through a pipe). Uses
// the project's existing node-pty dependency.

import * as nodePty from 'node-pty'
import { createWriteStream } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const name = process.argv[2]
if (!name) {
  console.error('usage: node record.mjs <fixture-name>   (writes <name>.cap)')
  process.exit(1)
}
if (!process.stdin.isTTY) {
  console.error('record.mjs must run in an interactive terminal (needs a TTY).')
  process.exit(1)
}

const HERE = dirname(fileURLToPath(import.meta.url))
const outPath = join(HERE, `${name}.cap`)
const out = createWriteStream(outPath)

const shell = process.env.CLAUDE_BIN || 'claude'
const term = nodePty.spawn(shell, process.argv.slice(3), {
  name: 'xterm-256color',
  cols: process.stdout.columns || 80,
  rows: process.stdout.rows || 40,
  cwd: process.cwd(),
  env: process.env
})

term.onData((data) => {
  out.write(data)
  process.stdout.write(data)
})

process.stdin.setRawMode(true)
process.stdin.resume()
process.stdin.on('data', (buf) => {
  // Ctrl-] (0x1d) stops the recording.
  if (buf.length === 1 && buf[0] === 0x1d) {
    term.kill()
    return
  }
  term.write(buf.toString('utf8'))
})

const finish = () => {
  try {
    process.stdin.setRawMode(false)
  } catch {
    /* stdin may already be closed */
  }
  out.end()
  console.error(`\n[record] saved ${outPath}`)
  process.exit(0)
}
term.onExit(finish)
