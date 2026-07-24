// Regenerate the SYNTHETIC pattern-matcher fixtures:  node _synthetic.mjs
//
// These are hand-authored placeholders that model the STRUCTURE of
// Claude Code's TUI frames (numbered permission menu; ready input prompt;
// in-progress spinner) with real ANSI colour codes and box-drawing, so
// the ScreenModel + matcher tests exercise ANSI stripping and structural
// anchoring end-to-end. They are NOT recordings of a live session.
//
// Replace/augment with real captures via `record.mjs` (see README.md).
// A `.cap` file dropped into this directory is picked up by the tests the
// same way. Re-record when Claude Code changes its TUI — see README.md.

import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const ESC = '\x1b'
const clr = (code, s) => `${ESC}[${code}m${s}${ESC}[0m`
const CLEAR = `${ESC}[2J${ESC}[H` // clear + cursor home, as Ink emits on repaint

const fixtures = {
  // --- positives ---------------------------------------------------------
  'approval-bash.cap':
    CLEAR +
    clr('1', 'Bash command') + '\r\n' +
    '  npm run build\r\n' +
    clr('2', '  Build the project') + '\r\n' +
    '\r\n' +
    'Do you want to proceed?\r\n' +
    clr('36', '❯ 1. Yes') + '\r\n' +
    "  2. Yes, and don't ask again for npm run commands in this project\r\n" +
    '  3. No, and tell Claude what to do differently ' + clr('2', '(esc)') + '\r\n',

  'approval-write.cap':
    CLEAR +
    clr('1', 'Edit file') + '  src/main/index.ts\r\n' +
    '\r\n' +
    clr('32', '+  idleDetector?.onPtyData(id, data)') + '\r\n' +
    clr('31', '-  idleDetector?.onPtyData(id)') + '\r\n' +
    '\r\n' +
    'Do you want to proceed?\r\n' +
    clr('36', '❯ 1. Yes') + '\r\n' +
    '  2. No, and tell Claude what to do differently ' + clr('2', '(esc)') + '\r\n',

  'complete-ready.cap':
    CLEAR +
    clr('35', '⏺') + " I've finished wiring the detector and the tests pass.\r\n" +
    '\r\n' +
    '╭──────────────────────────────────────────────────╮\r\n' +
    '│ ' + clr('2', '>') + '                                                  │\r\n' +
    '╰──────────────────────────────────────────────────╯\r\n' +
    '  ' + clr('2', '? for shortcuts') + '\r\n',

  // --- negatives (must classify to null) ---------------------------------
  // In-progress spinner: the interrupt hint is present, and the prose even
  // contains a question mark — neither should fire a match.
  'negative-working-spinner.cap':
    CLEAR +
    clr('35', '✻') + ' Baking… ' + clr('2', '(12s · ↑ 1.2k tokens · esc to interrupt)') + '\r\n' +
    'Considering whether to handle the empty-input case?\r\n',

  // Mid-tool: Claude prints a numbered list and a question while still
  // working. Has digits and "?", but no ❯ selector and no ready prompt.
  'negative-midtool-question.cap':
    CLEAR +
    'Here is the plan:\r\n' +
    '  1. Add the screen model\r\n' +
    '  2. Add the matchers\r\n' +
    'What edge cases should we cover?\r\n' +
    clr('2', '  esc to interrupt') + '\r\n',

  // Raw command output containing prompt-ish characters (">", "1.", "?")
  // mid-stream, with no menu and no ready-prompt affordance.
  'negative-code-output.cap':
    CLEAR +
    '$ git log --oneline\r\n' +
    '> 4c35b0f docs: PRD-v9 slice numbering\r\n' +
    '1. is this the right ref?  see line > here\r\n'
}

for (const [name, body] of Object.entries(fixtures)) {
  writeFileSync(join(HERE, name), body, 'utf8')
}
console.log(`Wrote ${Object.keys(fixtures).length} synthetic fixtures to ${HERE}`)
