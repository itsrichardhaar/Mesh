import { describe, it, expect, vi } from 'vitest'
import { PtyManager, type PtyLike, type PtySpawn } from '@main/pty/manager'

interface FakePty extends PtyLike {
  emitData(data: string): void
  emitExit(exitCode: number): void
  /** Captured calls so tests can assert. */
  writes: string[]
  resizes: Array<[number, number]>
  kills: string[]
}

function makeFakePty(): FakePty {
  const dataListeners: Array<(data: string) => void> = []
  const exitListeners: Array<(e: { exitCode: number }) => void> = []
  const writes: string[] = []
  const resizes: Array<[number, number]> = []
  const kills: string[] = []
  return {
    onData(cb) {
      dataListeners.push(cb)
      return {
        dispose() {
          const i = dataListeners.indexOf(cb)
          if (i >= 0) dataListeners.splice(i, 1)
        }
      }
    },
    onExit(cb) {
      exitListeners.push(cb)
      return {
        dispose() {
          const i = exitListeners.indexOf(cb)
          if (i >= 0) exitListeners.splice(i, 1)
        }
      }
    },
    write(data) {
      writes.push(data)
    },
    resize(cols, rows) {
      resizes.push([cols, rows])
    },
    kill(signal) {
      kills.push(signal ?? 'default')
    },
    emitData(data) {
      for (const cb of [...dataListeners]) cb(data)
    },
    emitExit(exitCode) {
      for (const cb of [...exitListeners]) cb({ exitCode })
    },
    writes,
    resizes,
    kills
  }
}

function makeManager(): { mgr: PtyManager; spawn: ReturnType<typeof vi.fn>; created: FakePty[] } {
  const created: FakePty[] = []
  const spawn: PtySpawn = (_cmd, _args, _opts) => {
    const p = makeFakePty()
    created.push(p)
    return p
  }
  const spy = vi.fn(spawn)
  const mgr = new PtyManager(spy as unknown as PtySpawn)
  return { mgr, spawn: spy, created }
}

describe('PtyManager', () => {
  it('spawns with the given command/args/cwd and dimensions', () => {
    const { mgr, spawn } = makeManager()
    const onData = vi.fn()
    const onExit = vi.fn()
    mgr.create({
      command: '/bin/claude',
      args: ['--resume', 'abc'],
      cwd: '/repo',
      cols: 100,
      rows: 30,
      onData,
      onExit
    })
    expect(spawn).toHaveBeenCalledTimes(1)
    const [cmd, args, opts] = spawn.mock.calls[0]!
    expect(cmd).toBe('/bin/claude')
    expect(args).toEqual(['--resume', 'abc'])
    expect(opts.cwd).toBe('/repo')
    expect(opts.cols).toBe(100)
    expect(opts.rows).toBe(30)
  })

  it('routes data events to the onData callback with the assigned ptyId', () => {
    const { mgr, created } = makeManager()
    const onData = vi.fn()
    const id = mgr.create({
      ptyId: 'fixed-id',
      command: 'x',
      args: [],
      cwd: '/',
      cols: 80,
      rows: 24,
      onData,
      onExit: vi.fn()
    })
    expect(id).toBe('fixed-id')
    created[0]!.emitData('hello\n')
    created[0]!.emitData('world\n')
    expect(onData).toHaveBeenCalledTimes(2)
    expect(onData).toHaveBeenNthCalledWith(1, 'fixed-id', 'hello\n')
    expect(onData).toHaveBeenNthCalledWith(2, 'fixed-id', 'world\n')
  })

  it('write/resize/kill route to the live pty by ptyId', () => {
    const { mgr, created } = makeManager()
    const id = mgr.create({
      command: 'x', args: [], cwd: '/', cols: 80, rows: 24,
      onData: vi.fn(), onExit: vi.fn()
    })
    expect(mgr.write(id, 'ls\n')).toBe(true)
    expect(mgr.resize(id, 120, 40)).toBe(true)
    expect(mgr.kill(id)).toBe(true)
    expect(created[0]!.writes).toEqual(['ls\n'])
    expect(created[0]!.resizes).toEqual([[120, 40]])
    expect(created[0]!.kills).toEqual(['SIGTERM'])
  })

  it('returns false for write/resize/kill against an unknown ptyId', () => {
    const { mgr } = makeManager()
    expect(mgr.write('nope', 'x')).toBe(false)
    expect(mgr.resize('nope', 80, 24)).toBe(false)
    expect(mgr.kill('nope')).toBe(false)
  })

  it('rejects non-positive resize dimensions', () => {
    const { mgr } = makeManager()
    const id = mgr.create({
      command: 'x', args: [], cwd: '/', cols: 80, rows: 24,
      onData: vi.fn(), onExit: vi.fn()
    })
    expect(mgr.resize(id, 0, 24)).toBe(false)
    expect(mgr.resize(id, 80, -1)).toBe(false)
    expect(mgr.resize(id, Number.NaN, 24)).toBe(false)
  })

  it('fires onExit and auto-removes the pty from the registry', () => {
    const { mgr, created } = makeManager()
    const onExit = vi.fn()
    const id = mgr.create({
      command: 'x', args: [], cwd: '/', cols: 80, rows: 24,
      onData: vi.fn(), onExit
    })
    expect(mgr.list()).toEqual([id])
    created[0]!.emitExit(0)
    expect(onExit).toHaveBeenCalledWith(id, 0)
    expect(mgr.list()).toEqual([])
    // Subsequent write should report "no such pty".
    expect(mgr.write(id, 'x')).toBe(false)
  })

  it('closeAll kills every live pty and empties the registry', () => {
    const { mgr, created } = makeManager()
    const ids = [0, 1, 2].map(() =>
      mgr.create({
        command: 'x', args: [], cwd: '/', cols: 80, rows: 24,
        onData: vi.fn(), onExit: vi.fn()
      })
    )
    expect(mgr.list()).toHaveLength(3)
    mgr.closeAll()
    expect(mgr.list()).toEqual([])
    for (const fake of created) {
      expect(fake.kills).toContain('SIGTERM')
    }
    expect(ids).toHaveLength(3)
  })

  it('assigns unique ptyIds when caller does not supply one', () => {
    const { mgr } = makeManager()
    const a = mgr.create({
      command: 'x', args: [], cwd: '/', cols: 80, rows: 24,
      onData: vi.fn(), onExit: vi.fn()
    })
    const b = mgr.create({
      command: 'x', args: [], cwd: '/', cols: 80, rows: 24,
      onData: vi.fn(), onExit: vi.fn()
    })
    expect(a).not.toEqual(b)
    expect(a.length).toBeGreaterThan(8)
  })
})
