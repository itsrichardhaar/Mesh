import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { detect } from '@main/projects/metadata-detector'

/**
 * Each case writes a small fixture directory and asks the detector
 * what subtitle it derives. Cases follow the priority list in the
 * Slice 4 acceptance criteria and the PRD's Project metadata section.
 */
describe('metadata detector', () => {
  let tmpRoot: string

  beforeEach(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), 'mesh-detector-'))
  })

  afterEach(async () => {
    await rm(tmpRoot, { recursive: true, force: true })
  })

  describe('autoName', () => {
    it('humanizes dashes to spaces', async () => {
      const dir = await mkProject('AI-OS-Dashboard')
      const meta = await detect(dir)
      expect(meta.autoName).toBe('AI OS Dashboard')
    })

    it('humanizes underscores to spaces', async () => {
      const dir = await mkProject('my_great_repo')
      const meta = await detect(dir)
      expect(meta.autoName).toBe('my great repo')
    })

    it('leaves already-spaced names alone', async () => {
      const dir = await mkProject('JTA Tool')
      const meta = await detect(dir)
      expect(meta.autoName).toBe('JTA Tool')
    })

    it('returns a humanized name even when the source path does not exist', async () => {
      const meta = await detect('/nope/Some-Missing-Folder')
      expect(meta.autoName).toBe('Some Missing Folder')
      expect(meta.autoSubtitle).toBeNull()
    })
  })

  describe('autoSubtitle priority list', () => {
    it('Next.js wins when `next` is in dependencies', async () => {
      const dir = await mkProject('next-app')
      await writePackageJson(dir, {
        dependencies: { next: '^15.0.0', react: '^18.0.0' }
      })
      const meta = await detect(dir)
      expect(meta.autoSubtitle).toBe('Next.js')
    })

    it('React · TypeScript when `react` + `typescript` are present', async () => {
      const dir = await mkProject('react-ts')
      await writePackageJson(dir, {
        dependencies: { react: '^18.0.0' },
        devDependencies: { typescript: '^5.0.0' }
      })
      const meta = await detect(dir)
      expect(meta.autoSubtitle).toBe('React · TypeScript')
    })

    it('React · TypeScript when a tsconfig.json is present (no explicit dep)', async () => {
      const dir = await mkProject('react-tsconfig')
      await writePackageJson(dir, { dependencies: { react: '^18.0.0' } })
      await writeFile(join(dir, 'tsconfig.json'), '{}', 'utf-8')
      const meta = await detect(dir)
      expect(meta.autoSubtitle).toBe('React · TypeScript')
    })

    it('plain React when no TypeScript signal is present', async () => {
      const dir = await mkProject('react-only')
      await writePackageJson(dir, { dependencies: { react: '^18.0.0' } })
      const meta = await detect(dir)
      expect(meta.autoSubtitle).toBe('React')
    })

    it('plain TypeScript when typescript is present but no react/next', async () => {
      const dir = await mkProject('lib-ts')
      await writePackageJson(dir, {
        devDependencies: { typescript: '^5.0.0' }
      })
      const meta = await detect(dir)
      expect(meta.autoSubtitle).toBe('TypeScript')
    })

    it('Node.js when package.json has no React/Next/TypeScript signals', async () => {
      const dir = await mkProject('node-cli')
      await writePackageJson(dir, { dependencies: { chalk: '^5.0.0' } })
      const meta = await detect(dir)
      expect(meta.autoSubtitle).toBe('Node.js')
    })

    it('Node.js when package.json is malformed (still a Node project)', async () => {
      const dir = await mkProject('broken-pkg')
      await writeFile(join(dir, 'package.json'), '{ not valid json', 'utf-8')
      const meta = await detect(dir)
      expect(meta.autoSubtitle).toBe('Node.js')
    })

    it('Rust when Cargo.toml is present', async () => {
      const dir = await mkProject('rusty')
      await writeFile(join(dir, 'Cargo.toml'), '[package]\nname = "x"\n', 'utf-8')
      const meta = await detect(dir)
      expect(meta.autoSubtitle).toBe('Rust')
    })

    it('Go when go.mod is present', async () => {
      const dir = await mkProject('go-service')
      await writeFile(join(dir, 'go.mod'), 'module example.com/x\n', 'utf-8')
      const meta = await detect(dir)
      expect(meta.autoSubtitle).toBe('Go')
    })

    it('Python via pyproject.toml', async () => {
      const dir = await mkProject('py-pyproject')
      await writeFile(join(dir, 'pyproject.toml'), '[project]\nname = "x"\n', 'utf-8')
      const meta = await detect(dir)
      expect(meta.autoSubtitle).toBe('Python')
    })

    it('Python via requirements.txt', async () => {
      const dir = await mkProject('py-reqs')
      await writeFile(join(dir, 'requirements.txt'), 'requests==2.0\n', 'utf-8')
      const meta = await detect(dir)
      expect(meta.autoSubtitle).toBe('Python')
    })

    it('Swift via Package.swift', async () => {
      const dir = await mkProject('swift-pkg')
      await writeFile(join(dir, 'Package.swift'), '// swift-tools-version:5.9\n', 'utf-8')
      const meta = await detect(dir)
      expect(meta.autoSubtitle).toBe('Swift')
    })

    it('package.json wins over Cargo.toml when both exist', async () => {
      const dir = await mkProject('mixed')
      await writePackageJson(dir, { dependencies: { react: '^18.0.0' } })
      await writeFile(join(dir, 'Cargo.toml'), '[package]\n', 'utf-8')
      const meta = await detect(dir)
      expect(meta.autoSubtitle).toBe('React')
    })

    it('falls back to dominant top-level extension', async () => {
      const dir = await mkProject('notes')
      await writeFile(join(dir, 'a.md'), '# a\n', 'utf-8')
      await writeFile(join(dir, 'b.md'), '# b\n', 'utf-8')
      await writeFile(join(dir, 'c.txt'), 'c\n', 'utf-8')
      const meta = await detect(dir)
      expect(meta.autoSubtitle).toBe('Markdown')
    })

    it('uppercases unknown extensions in the fallback', async () => {
      const dir = await mkProject('weird')
      await writeFile(join(dir, 'a.zzz'), 'a\n', 'utf-8')
      await writeFile(join(dir, 'b.zzz'), 'b\n', 'utf-8')
      const meta = await detect(dir)
      expect(meta.autoSubtitle).toBe('ZZZ')
    })

    it('ignores dotfiles and directories in the extension count', async () => {
      const dir = await mkProject('mostly-empty')
      await mkdir(join(dir, 'src'), { recursive: true })
      await writeFile(join(dir, '.gitignore'), 'node_modules\n', 'utf-8')
      const meta = await detect(dir)
      expect(meta.autoSubtitle).toBeNull()
    })

    it('returns null when the source path does not exist', async () => {
      const meta = await detect(join(tmpRoot, 'absent'))
      expect(meta.autoSubtitle).toBeNull()
    })
  })

  // --- helpers --------------------------------------------------------------

  async function mkProject(name: string): Promise<string> {
    const dir = join(tmpRoot, name)
    await mkdir(dir, { recursive: true })
    return dir
  }

  async function writePackageJson(
    dir: string,
    pkg: Record<string, unknown>
  ): Promise<void> {
    await writeFile(join(dir, 'package.json'), JSON.stringify(pkg, null, 2), 'utf-8')
  }
})
