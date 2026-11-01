import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  applyElections,
  checkOverrides,
  collectNpm,
  goEntries,
  missingFrom,
  npmEntry,
  overrideFileName,
  packageOf,
  renderText,
  type Notices,
} from './notices'

const MIT = (who: string) => `MIT License

Copyright (c) 2020 ${who}

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software.`

let root: string
let nm: string
let overrides: string
let licences: string

function pkg(dir: string, json: Record<string, unknown>, files: Record<string, string> = {}): string {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify(json))
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text)
  return dir
}

const at = (name: string) => join(nm, name)

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'notices-'))
  nm = join(root, 'node_modules')
  overrides = join(root, 'overrides')
  licences = join(root, 'licences')
  mkdirSync(overrides, { recursive: true })
  mkdirSync(licences, { recursive: true })
  writeFileSync(join(licences, 'CPAL-1.0.txt'), 'Common Public Attribution License Version 1.0 (CPAL)\n')
  writeFileSync(join(licences, 'EPL-2.0.txt'), 'Eclipse Public License - v 2.0\n')

  pkg(at('plain-license'), { name: 'plain-license', version: '1.0.0', license: 'MIT' }, { LICENSE: MIT('Fixture Author') })
  pkg(at('licence-md'), { name: 'licence-md', version: '1.0.0', license: 'MIT' }, { 'LICENCE.md': MIT('A') })
  pkg(at('copying'), { name: 'copying', version: '1.0.0', license: 'MIT' }, { COPYING: MIT('B') })
  pkg(at('license-mit'), { name: 'license-mit', version: '1.0.0', license: 'MIT' }, { 'LICENSE-MIT': MIT('C') })
  pkg(at('lower'), { name: 'lower', version: '1.0.0', license: 'MIT' }, { license: MIT('D') })
  pkg(at('no-file'), { name: 'no-file', version: '1.0.0', license: 'ISC' })
  pkg(at('code-named-license'), { name: 'code-named-license', version: '1.0.0', license: 'MIT' }, { 'license-update.mjs': 'export const x = 1', 'license.js': 'module.exports = 1', 'LICENSE.txt': MIT('Real') })
  pkg(at('only-code'), { name: 'only-code', version: '1.0.0', license: 'MIT' }, { 'license.js': 'module.exports = 1' })
  mkdirSync(join(at('only-code'), 'licenses'), { recursive: true })
  pkg(at('no-licence-field'), { name: 'no-licence-field', version: '1.0.0' }, { license: MIT('Unlabelled') })
  pkg(at('no-file-newer'), { name: 'no-file-newer', version: '2.0.0', license: 'ISC' })
  writeFileSync(join(overrides, 'no-file@1.0.0.txt'), 'Source: https://example.com/LICENSE\n\nISC License\n\nCopyright (c) Someone\n')
  pkg(at('@scope/name'), { name: '@scope/name', version: '3.1.0', license: 'MIT' }, { LICENSE: MIT('Scoped') })
  pkg(at('dup'), { name: 'dup', version: '1.0.0', license: 'MIT' }, { LICENSE: MIT('Dup One') })
  pkg(join(at('a'), 'node_modules', 'dup'), { name: 'dup', version: '2.0.0', license: 'MIT' }, { LICENSE: MIT('Dup Two') })
  pkg(at('a'), { name: 'a', version: '1.0.0', license: 'MIT' }, { LICENSE: MIT('A') })
  pkg(
    at('citeproc'),
    { name: 'citeproc', version: '2.4.63', license: 'CPAL-1.0 OR AGPL-1.0', repository: { type: 'git', url: 'git+https://github.com/Juris-M/citeproc-js.git' } },
    { LICENSE: 'Copyright (c) 2009-2019 Frank Bennett\n\nEITHER CPAL OR AGPL' },
  )
  pkg(
    at('elkjs'),
    { name: 'elkjs', version: '0.9.3', license: 'EPL-2.0', repository: 'https://github.com/kieler/elkjs' },
    { 'LICENSE.md': '# Eclipse Public License - v 2.0\n' },
  )
  pkg(at('dompurify'), { name: 'dompurify', version: '3.2.7', license: '(MPL-2.0 OR Apache-2.0)' }, { LICENSE: 'Copyright 2025 Dr.-Ing. Mario Heiderich, Cure53\n\nApache or MPL' })

  mkdirSync(join(root, 'gomod'), { recursive: true })
  writeFileSync(join(root, 'gomod', 'LICENSE'), 'Copyright 2009 The Go Authors.\n\nRedistribution and use in source and binary forms, with or without\nmodification, are permitted provided that the following conditions are\nmet:\n')
  mkdirSync(join(root, 'goroot'), { recursive: true })
  writeFileSync(join(root, 'goroot', 'LICENSE'), 'Copyright 2009 The Go Authors.\n\nRedistribution and use in source and binary forms\n')
  mkdirSync(join(root, 'gonolicence'), { recursive: true })
})

afterAll(() => rmSync(root, { recursive: true, force: true }))

describe('packageOf', () => {
  test('finds scoped, nested and plain packages', () => {
    expect(packageOf('/r/node_modules/@scope/name/dist/x.js')).toEqual({ name: '@scope/name', dir: '/r/node_modules/@scope/name' })
    expect(packageOf('/r/node_modules/a/node_modules/b/index.js')?.name).toBe('b')
    expect(packageOf('/r/node_modules/a/index.js?worker')?.name).toBe('a')
    expect(packageOf('/r/node_modules/a/index.js?inline&url')?.dir).toBe('/r/node_modules/a')
  })
  test('skips virtual modules and the app’s own files', () => {
    expect(packageOf('\0vite/preload-helper')).toBeNull()
    expect(packageOf('\0commonjsHelpers.js')).toBeNull()
    expect(packageOf('/r/frontend/src/App.svelte')).toBeNull()
  })
})

describe('npmEntry', () => {
  test('reads the licence file whatever it is called', () => {
    for (const name of ['plain-license', 'licence-md', 'copying', 'license-mit', 'lower']) {
      expect(npmEntry(at(name), overrides).text).toContain('Permission is hereby granted')
    }
  })
  test('never takes a code file or a folder for the licence', () => {
    expect(npmEntry(at('code-named-license'), overrides).text).toContain('Copyright (c) 2020 Real')
    expect(() => npmEntry(at('only-code'), overrides)).toThrow(/only-code@1\.0\.0/)
  })
  test('reads the licence from the text when package.json does not name one', () => {
    expect(npmEntry(at('no-licence-field'), overrides).licence).toBe('MIT')
  })
  test('takes copyright lines from the text', () => {
    expect(npmEntry(at('plain-license'), overrides).copyright).toEqual(['Copyright (c) 2020 Fixture Author'])
  })
  test('carries name, version, licence and origin', () => {
    const e = npmEntry(at('@scope/name'), overrides)
    expect([e.name, e.version, e.licence, e.origin]).toEqual(['@scope/name', '3.1.0', 'MIT', 'npm'])
  })
  test('uses an override for the exact version, without its Source line', () => {
    const e = npmEntry(at('no-file'), overrides)
    expect(e.text.startsWith('ISC License')).toBe(true)
    expect(e.override).toBe('no-file@1.0.0.txt')
  })
  test('fails, naming the package and version, with no file and no override', () => {
    expect(() => npmEntry(at('no-file-newer'), overrides)).toThrow(/no-file-newer@2\.0\.0/)
  })
})

test('overrideFileName writes a scope separator as __', () => {
  expect(overrideFileName('@unified-latex/unified-latex-types', '1.8.4')).toBe('@unified-latex__unified-latex-types@1.8.4.txt')
})

describe('checkOverrides', () => {
  test('fails on an override that is not used', () => {
    expect(() => checkOverrides(new Set(), overrides, new Set())).toThrow(/no-file@1\.0\.0/)
  })
  test('fails on an override for a package with its own licence file', () => {
    expect(() => checkOverrides(new Set(['no-file@1.0.0.txt']), overrides, new Set(['no-file@1.0.0']))).toThrow(/has its own licence file/)
  })
  test('passes when every override is used', () => {
    expect(() => checkOverrides(new Set(['no-file@1.0.0.txt']), overrides, new Set())).not.toThrow()
  })
})

describe('collectNpm', () => {
  test('two versions of one package are two entries, and a nested path is the inner package', () => {
    const entries = collectNpm(
      [join(at('dup'), 'index.js'), join(at('a'), 'node_modules', 'dup', 'index.js'), join(at('a'), 'index.js')],
      overrides,
    )
    expect(entries.map((e) => `${e.name}@${e.version}`)).toEqual(['a@1.0.0', 'dup@1.0.0', 'dup@2.0.0'])
    expect(entries[2].copyright).toEqual(['Copyright (c) 2020 Dup Two'])
  })
  test('one package reached by several files is one entry', () => {
    const entries = collectNpm([join(at('a'), 'index.js'), join(at('a'), 'lib', 'x.js'), '\0vite/preload-helper'], overrides)
    expect(entries).toHaveLength(1)
  })
})

describe('applyElections', () => {
  test('citeproc-js: CPAL election, the CPAL text and where the source is', () => {
    const c = applyElections(npmEntry(at('citeproc'), overrides), licences)
    expect(c.election).toBe('Halmos elects the CPAL-1.0 option.')
    expect(c.licence).toBe('CPAL-1.0 OR AGPL-3.0')
    expect(c.extraText).toContain('Common Public Attribution License')
    expect(c.source).toBe('Source code for this version: https://github.com/Juris-M/citeproc-js, version 2.4.63.')
  })
  test('elkjs: the EPL text and where the source is', () => {
    const e = applyElections(npmEntry(at('elkjs'), overrides), licences)
    expect(e.extraText).toContain('Eclipse Public License')
    expect(e.source).toBe('Source code for this version: https://github.com/kieler/elkjs, version 0.9.3.')
  })
  test('DOMPurify: Apache-2.0 election', () => {
    expect(applyElections(npmEntry(at('dompurify'), overrides), licences).election).toBe('Halmos elects the Apache-2.0 option.')
  })
  test('anything else is unchanged', () => {
    const e = npmEntry(at('a'), overrides)
    expect(applyElections(e, licences)).toEqual(e)
  })
})

describe('goEntries', () => {
  test('adds the standard library after the modules', () => {
    const e = goEntries([{ path: 'golang.org/x/sys', version: 'v0.1.0', dir: join(root, 'gomod') }], join(root, 'goroot'), 'go1.26.10')
    expect(e.map((x) => x.name)).toEqual(['golang.org/x/sys', 'Go standard library and runtime'])
    expect(e[0]).toMatchObject({ version: 'v0.1.0', origin: 'go', licence: 'BSD-3-Clause', copyright: ['Copyright 2009 The Go Authors.'] })
    expect(e[1].version).toBe('go1.26.10')
  })
  test('fails on a module with no licence file', () => {
    expect(() => goEntries([{ path: 'example.com/x', version: 'v1.0.0', dir: join(root, 'gonolicence') }], join(root, 'goroot'), 'go1')).toThrow(
      /example\.com\/x@v1\.0\.0/,
    )
  })
})

describe('renderText', () => {
  test('a header, then one section per entry in the order given', () => {
    const n: Notices = {
      generatedBy: 'halmos-notices',
      entries: [
        { ...npmEntry(at('a'), overrides) },
        applyElections(npmEntry(at('citeproc'), overrides), licences),
      ],
    }
    const t = renderText(n)
    expect(t.startsWith('Third-party software in Halmos Editor')).toBe(true)
    const a = t.indexOf('=== a 1.0.0 ===')
    const c = t.indexOf('=== citeproc 2.4.63 ===')
    expect(a).toBeGreaterThan(0)
    expect(c).toBeGreaterThan(a)
    expect(t).toContain('Halmos elects the CPAL-1.0 option.')
    expect(t).toContain('Common Public Attribution License')
    expect(t.match(/^=== /gm)).toHaveLength(2)
  })
})

test('missingFrom reports a package and version not in the notices', () => {
  const n: Notices = { generatedBy: 'halmos-notices', entries: [npmEntry(at('a'), overrides)] }
  expect(missingFrom(n, [{ name: 'a', version: '1.0.0' }, { name: 'b', version: '2.0.0' }])).toEqual(['b@2.0.0'])
})
