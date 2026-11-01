import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build, type Rollup } from 'vite'
import { noticesCheck, noticesCollector } from './plugin'
import type { Notices } from './notices'

const MIT = (who: string) => `MIT License\n\nCopyright (c) 2020 ${who}\n\nPermission is hereby granted, free of charge.`

let root: string

function write(path: string, text: string) {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, text)
}

function pkg(name: string, files: Record<string, string>, version = '1.0.0') {
  const dir = join(root, 'node_modules', name)
  write(join(dir, 'package.json'), JSON.stringify({ name, version, license: 'MIT', type: 'module', main: 'index.js' }))
  for (const [f, t] of Object.entries(files)) write(join(dir, f), t)
}

const goStub = {
  goModules: () => [{ path: 'golang.org/x/sys', version: 'v0.1.0', dir: join(root, 'gomod') }],
  goroot: () => join(root, 'goroot'),
  goVersion: () => 'go1.26.10',
}

async function appBuild(entry: string, extra: Partial<Parameters<typeof noticesCollector>[0]> = {}) {
  const c = noticesCollector({ overridesDir: join(root, 'overrides'), licencesDir: join(root, 'licences'), ...goStub, ...extra })
  const out = (await build({
    root,
    configFile: false,
    logLevel: 'silent',
    plugins: [c.plugin()],
    worker: { format: 'es', plugins: () => [c.worker()] },
    build: { write: false, outDir: join(root, 'dist'), rollupOptions: { input: join(root, entry) } },
  })) as Rollup.RollupOutput
  return out.output
}

const asset = (output: Rollup.RollupOutput['output'], name: string) => {
  const a = output.find((o) => o.fileName === name)
  if (!a || a.type !== 'asset') throw new Error(`no ${name} in the build`)
  return String(a.source)
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'notices-plugin-'))
  mkdirSync(join(root, 'overrides'), { recursive: true })
  write(join(root, 'licences', 'CPAL-1.0.txt'), 'CPAL\n')
  write(join(root, 'licences', 'EPL-2.0.txt'), 'EPL\n')
  write(join(root, 'gomod', 'LICENSE'), 'Copyright 2009 The Go Authors.\n\nRedistribution and use in source and binary forms. Neither the name')
  write(join(root, 'goroot', 'LICENSE'), 'Copyright 2009 The Go Authors.\n\nRedistribution and use in source and binary forms. Neither the name')
  pkg('main-dep', { 'index.js': 'export const hello = () => "main"', LICENSE: MIT('Main') })
  pkg('worker-dep', { 'index.js': 'export const work = () => "worker"', LICENSE: MIT('Worker') })
  pkg('unused-dep', { 'index.js': 'export const never = () => "never"', LICENSE: MIT('Unused') })
  pkg('nolicence-dep', { 'index.js': 'export const bad = () => "bad"' })
  write(join(root, 'w.js'), 'import { work } from "worker-dep"\nself.postMessage(work())\n')
  write(join(root, 'bad-worker.js'), 'import { bad } from "nolicence-dep"\nself.postMessage(bad())\n')
  write(
    join(root, 'main.js'),
    'import { hello } from "main-dep"\nimport "unused-dep"\nconsole.log(hello())\nnew Worker(new URL("./w.js", import.meta.url), { type: "module" })\n',
  )
  write(join(root, 'bad.js'), 'new Worker(new URL("./bad-worker.js", import.meta.url), { type: "module" })\n')
})

afterAll(() => rmSync(root, { recursive: true, force: true }))

describe('noticesCollector', () => {
  test('lists the main and worker packages, the Go modules and the standard library, and nothing tree-shaken away', async () => {
    const output = await appBuild('main.js')
    const n = JSON.parse(asset(output, 'acknowledgements.json')) as Notices
    const names = n.entries.map((e) => e.name)
    expect(names).toEqual(['Go standard library and runtime', 'golang.org/x/sys', 'main-dep', 'worker-dep'])
    expect(asset(output, 'THIRD-PARTY-NOTICES.txt')).toContain('=== worker-dep 1.0.0 ===')
  })

  test('fails, naming the package, when a worker bundles one with no licence', async () => {
    await expect(appBuild('bad.js')).rejects.toThrow(/nolicence-dep@1\.0\.0/)
  })

  test('fails on an override for a package that is not in the build', async () => {
    const overrides = join(root, 'stale-overrides')
    write(join(overrides, 'gone@1.0.0.txt'), 'Source: x\n\ntext\n')
    await expect(appBuild('main.js', { overridesDir: overrides })).rejects.toThrow(/gone@1\.0\.0/)
  })
})

describe('noticesCheck', () => {
  test('fails on a package the app notices do not list, and passes otherwise', async () => {
    const dist = join(root, 'appdist')
    const listed = (names: string[]): Notices => ({
      generatedBy: 'halmos-notices',
      entries: names.map((name) => ({ name, version: '1.0.0', licence: 'MIT', copyright: [], text: '', origin: 'npm' as const })),
    })
    const run = async (names: string[]) => {
      write(join(dist, 'acknowledgements.json'), JSON.stringify(listed(names)))
      await build({
        root,
        configFile: false,
        logLevel: 'silent',
        plugins: [noticesCheck(dist)],
        build: { write: false, rollupOptions: { input: join(root, 'w.js') } },
      })
    }
    await expect(run(['main-dep'])).rejects.toThrow(/worker-dep@1\.0\.0/)
    await expect(run(['worker-dep'])).resolves.toBeUndefined()
  })
})
