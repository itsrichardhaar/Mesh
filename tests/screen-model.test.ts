import { describe, it, expect } from 'vitest'
import { ScreenModel } from '@main/notifications/screen-model'

const ESC = '\x1b'

describe('ScreenModel', () => {
  it('strips ANSI escape sequences from the snapshot', async () => {
    const sm = new ScreenModel()
    await sm.write(`${ESC}[33mDo you want to proceed?${ESC}[0m\r\n${ESC}[36m❯ 1. Yes${ESC}[0m\r\n`)
    const snap = sm.snapshot()
    expect(snap).toContain('Do you want to proceed?')
    expect(snap).toContain('❯ 1. Yes')
    expect(snap).not.toContain(ESC)
    expect(snap).not.toMatch(/\[\d+m/) // no leftover colour codes
    sm.dispose()
  })

  it('reflects the latest frame when the screen repaints in place', async () => {
    const sm = new ScreenModel()
    // First frame: selector on option 1.
    await sm.write(`${ESC}[2J${ESC}[HDo you want to proceed?\r\n❯ 1. Yes\r\n  2. No\r\n`)
    // Repaint (cursor home + rewrite): selector moves to option 2.
    await sm.write(`${ESC}[HDo you want to proceed?\r\n  1. Yes\r\n❯ 2. No\r\n`)
    const snap = sm.snapshot()
    expect(snap).toContain('❯ 2. No')
    expect(snap).not.toContain('❯ 1. Yes')
    sm.dispose()
  })

  it('trims leading and trailing blank rows but keeps interior structure', async () => {
    const sm = new ScreenModel()
    await sm.write('\r\n\r\nfirst\r\n\r\nsecond\r\n\r\n')
    expect(sm.snapshot()).toBe('first\n\nsecond')
    sm.dispose()
  })

  it('excludes scrolled-off history so only the current frame is visible', async () => {
    const sm = new ScreenModel({ rows: 4 })
    // Write more lines than the viewport holds; early lines scroll off.
    await sm.write('old-1\r\nold-2\r\nold-3\r\nold-4\r\nold-5\r\nrecent\r\n')
    const snap = sm.snapshot()
    expect(snap).toContain('recent')
    expect(snap).not.toContain('old-1')
    sm.dispose()
  })
})
