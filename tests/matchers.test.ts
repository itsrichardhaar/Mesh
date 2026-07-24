import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { ScreenModel } from '@main/notifications/screen-model'
import { classify, matchApproval, matchComplete } from '@main/notifications/matchers'
import type { NotificationKind } from '@shared/types'

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), 'fixtures/pty-captures')

/**
 * Replay harness: feed a recorded byte-stream fixture through a
 * ScreenModel exactly as production would, then classify the settled
 * frame. This is the shape every future pattern test takes — record a
 * `.cap`, assert the kind.
 */
async function classifyFixture(name: string): Promise<NotificationKind | null> {
  const bytes = readFileSync(join(FIXTURE_DIR, `${name}.cap`), 'utf8')
  const sm = new ScreenModel()
  await sm.write(bytes)
  const kind = classify(sm.snapshot())
  sm.dispose()
  return kind
}

describe('pattern matchers — fixture replay', () => {
  it.each([
    ['approval-bash', 'approval'],
    ['approval-write', 'approval'],
    ['complete-ready', 'complete']
  ])('classifies %s as %s', async (fixture, expected) => {
    expect(await classifyFixture(fixture)).toBe(expected)
  })

  it.each([
    ['negative-working-spinner'],
    ['negative-midtool-question'],
    ['negative-code-output']
  ])('classifies %s as null (falls through to the idle floor)', async (fixture) => {
    expect(await classifyFixture(fixture)).toBeNull()
  })

  it('every committed .cap fixture is covered by an assertion above', () => {
    const caps = readdirSync(FIXTURE_DIR)
      .filter((f) => f.endsWith('.cap'))
      .map((f) => f.replace(/\.cap$/, ''))
      .sort()
    const asserted = [
      'approval-bash',
      'approval-write',
      'complete-ready',
      'negative-working-spinner',
      'negative-midtool-question',
      'negative-code-output'
    ].sort()
    expect(caps).toEqual(asserted)
  })
})

describe('pattern matchers — units', () => {
  it('matchApproval requires BOTH a numbered selector and a prompt phrase', () => {
    // Selector but no prompt phrase → not an approval (arbitrary list).
    expect(matchApproval('❯ 1. Yes\n  2. No')).toBeNull()
    // Prompt phrase but no selector → not yet a live menu.
    expect(matchApproval('Do you want to proceed?')).toBeNull()
    // Both present → approval.
    expect(matchApproval('Do you want to proceed?\n❯ 1. Yes\n  2. No')).toBe('approval')
  })

  it('matchComplete fires at the ready prompt but not while working', () => {
    expect(matchComplete('done\n  ? for shortcuts')).toBe('complete')
    // Ready affordance present but still working → not complete.
    expect(matchComplete('? for shortcuts\n✻ Baking… (esc to interrupt)')).toBeNull()
    // No ready affordance at all → not complete.
    expect(matchComplete('just some output')).toBeNull()
  })

  it('classify applies approval-over-complete precedence', () => {
    // A frame carrying both signals resolves to the higher-urgency kind.
    const both = 'Do you want to proceed?\n❯ 1. Yes\n  ? for shortcuts'
    expect(classify(both)).toBe('approval')
  })
})
