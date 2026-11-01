/**
 * Third-party licence notices: one entry per component the app ships, each
 * with the licence text from the component's own licence file.
 *
 * Pure Node, no Vite: plugin.ts feeds it the module ids Rollup bundled and
 * the Go modules `go list` reports. A component whose licence cannot be
 * found fails the build rather than shipping without its notice. See
 * docs/superpowers/specs/2026-11-01-third-party-notices-design.md.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export type NoticeEntry = {
  name: string
  version: string
  /** The SPDX identifier the component declares, or what its text shows. */
  licence: string
  copyright: string[]
  /** The licence text, from the component's own file or its override. */
  text: string
  /** Which option Halmos takes, for a component offered under a choice. */
  election?: string
  /** Where the source of the shipped version is, when the licence asks. */
  source?: string
  /** A full licence text the component does not carry itself. */
  extraText?: string
  /** The repository URL, from package.json. */
  repository?: string
  /** The override file used, under licenses/overrides/, if any. */
  override?: string
  origin: 'npm' | 'go'
}

export type Notices = { generatedBy: 'halmos-notices'; entries: NoticeEntry[] }

const LICENCE_FILE = /^(licen[cs]e|copying)([-.].*)?$/i
const COPYRIGHT_LINE = /^\s*(copyright|\(c\)|©)/i

/** The package a bundled module belongs to, or null for the app's own files. */
export function packageOf(moduleId: string): { name: string; dir: string } | null {
  if (moduleId.startsWith('\0')) return null
  const path = moduleId.split('?')[0].replace(/\\/g, '/')
  const marker = '/node_modules/'
  const at = path.lastIndexOf(marker)
  if (at < 0) return null
  const rest = path.slice(at + marker.length).split('/')
  const segments = rest[0].startsWith('@') ? 2 : 1
  if (rest.length < segments || !rest[segments - 1]) return null
  const name = rest.slice(0, segments).join('/')
  return { name, dir: path.slice(0, at + marker.length) + name }
}

export function overrideFileName(name: string, version: string): string {
  return `${name.replace('/', '__')}@${version}.txt`
}

function licenceFile(dir: string): string | null {
  if (!existsSync(dir)) return null
  const match = readdirSync(dir)
    .filter((f) => LICENCE_FILE.test(f))
    .sort()[0]
  return match ? join(dir, match) : null
}

function copyrightLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .filter((l) => COPYRIGHT_LINE.test(l))
    .map((l) => l.trim())
}

function declaredLicence(pkg: Record<string, unknown>): string {
  const l = pkg.license
  if (typeof l === 'string') return l
  if (l && typeof l === 'object' && typeof (l as { type?: unknown }).type === 'string') return (l as { type: string }).type
  const ls = pkg.licenses
  if (Array.isArray(ls)) {
    const types = ls.map((x) => (x as { type?: unknown }).type).filter((t): t is string => typeof t === 'string')
    if (types.length) return types.join(' OR ')
  }
  return 'see text'
}

function repositoryURL(pkg: Record<string, unknown>): string | undefined {
  const r = pkg.repository
  const raw = typeof r === 'string' ? r : r && typeof r === 'object' ? (r as { url?: unknown }).url : undefined
  if (typeof raw !== 'string') return undefined
  let url = raw.replace(/^git\+/, '').replace(/\.git$/, '')
  url = url.replace(/^git:\/\//, 'https://').replace(/^git@github\.com:/, 'https://github.com/')
  if (/^[\w.-]+\/[\w.-]+$/.test(url)) url = `https://github.com/${url}`
  return url
}

/** A licence identifier for a Go module, read from its text. */
function detectLicence(text: string): string {
  if (/Apache License,?\s+Version 2\.0/i.test(text)) return 'Apache-2.0'
  if (/Permission is hereby granted, free of charge/i.test(text)) return 'MIT'
  if (/Permission to use, copy, modify, and\/or distribute/i.test(text)) return 'ISC'
  if (/Redistribution and use in source and binary forms/i.test(text)) {
    return /Neither the name|names of its\s+contributors/i.test(text) || !/2\.\s/.test(text) ? 'BSD-3-Clause' : 'BSD-2-Clause'
  }
  return 'see text'
}

/**
 * The entry for the npm package in dir. Its own licence file wins; without
 * one, the override for its exact name and version; without that, an error.
 */
export function npmEntry(dir: string, overridesDir: string): NoticeEntry {
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as Record<string, unknown>
  const name = String(pkg.name)
  const version = String(pkg.version)
  const base = { name, version, licence: declaredLicence(pkg), repository: repositoryURL(pkg), origin: 'npm' as const }
  const own = licenceFile(dir)
  if (own) {
    const text = readFileSync(own, 'utf8').trim()
    return { ...base, copyright: copyrightLines(text), text }
  }
  const file = overrideFileName(name, version)
  const path = join(overridesDir, file)
  if (!existsSync(path)) {
    throw new Error(
      `${name}@${version} ships no licence file and has no override. Add licenses/overrides/${file}, ` +
        'starting "Source: <URL of the upstream licence file at that version>", then a blank line, then the text.',
    )
  }
  // Drop the Source line and the blank line after it: they say where the
  // text came from, and are not part of it.
  const text = readFileSync(path, 'utf8').replace(/^Source:.*\r?\n(\r?\n)?/, '').trim()
  return { ...base, copyright: copyrightLines(text), text, override: file }
}

/** One entry per package and version, for every module id that is in one. */
export function collectNpm(moduleIds: Iterable<string>, overridesDir: string): NoticeEntry[] {
  const dirs = new Set<string>()
  for (const id of moduleIds) {
    const p = packageOf(id)
    if (p) dirs.add(p.dir)
  }
  const byKey = new Map<string, NoticeEntry>()
  for (const dir of dirs) {
    const e = npmEntry(dir, overridesDir)
    const key = `${e.name}@${e.version}`
    if (!byKey.has(key)) byKey.set(key, e)
  }
  return sortEntries([...byKey.values()])
}

export function sortEntries(entries: NoticeEntry[]): NoticeEntry[] {
  return [...entries].sort((a, b) => a.name.localeCompare(b.name, 'en') || a.version.localeCompare(b.version, 'en'))
}

/**
 * Fails on an override nothing used (the package no longer ships, or moved
 * to another version) and on one for a package that has its own licence
 * file, so the list cannot go stale. used holds override file names;
 * ownFile holds name@version of packages read from their own file.
 */
export function checkOverrides(used: Set<string>, overridesDir: string, ownFile: Set<string>): void {
  const files = existsSync(overridesDir) ? readdirSync(overridesDir).filter((f) => f.endsWith('.txt')) : []
  const problems: string[] = []
  for (const f of files) {
    const key = f.replace(/\.txt$/, '').replace('__', '/')
    if (ownFile.has(key)) problems.push(`licenses/overrides/${f}: ${key} has its own licence file now; delete the override`)
    else if (!used.has(f)) problems.push(`licenses/overrides/${f}: ${key} is not in the build; delete the override, or rename it for the version that ships`)
  }
  if (problems.length) throw new Error(problems.join('\n'))
}

const sourceStatement = (e: NoticeEntry) =>
  e.repository ? `Source code for this version: ${e.repository}, version ${e.version}.` : undefined

/** The choices Halmos makes, and the texts and statements two licences ask for. */
export function applyElections(e: NoticeEntry, licencesDir: string): NoticeEntry {
  const read = (f: string) => readFileSync(join(licencesDir, f), 'utf8').trim()
  switch (e.name) {
    case 'citeproc':
      return { ...e, election: 'Halmos elects the CPAL-1.0 option.', extraText: read('CPAL-1.0.txt'), source: sourceStatement(e) }
    case 'elkjs':
      return { ...e, extraText: read('EPL-2.0.txt'), source: sourceStatement(e) }
    case 'dompurify':
      return { ...e, election: 'Halmos elects the Apache-2.0 option.' }
    default:
      return e
  }
}

/** Entries for the Go modules linked into the binary, then the standard library. */
export function goEntries(modules: { path: string; version: string; dir: string }[], goroot: string, goVersion: string): NoticeEntry[] {
  const entry = (name: string, version: string, dir: string): NoticeEntry => {
    const file = licenceFile(dir)
    if (!file) throw new Error(`${name}@${version} has no licence file in ${dir}`)
    const text = readFileSync(file, 'utf8').trim()
    return { name, version, licence: detectLicence(text), copyright: copyrightLines(text), text, origin: 'go' }
  }
  return [
    ...modules.map((m) => entry(m.path, m.version, m.dir)),
    { ...entry('Go standard library and runtime', goVersion, goroot), repository: 'https://go.dev' },
  ]
}

const HEADER = `Third-party software in Halmos Editor
=====================================

Halmos Editor includes the open-source software listed below. Each
component is used under the licence shown with it, whose full text
follows its name.

citeproc-js is offered under CPAL-1.0 or AGPL-3.0; Halmos elects CPAL-1.0.
DOMPurify is offered under MPL-2.0 or Apache-2.0; Halmos elects Apache-2.0.
`

export function renderText(n: Notices): string {
  const sections = n.entries.map((e) =>
    [
      `=== ${e.name} ${e.version} ===`,
      `Licence: ${e.licence}`,
      e.election,
      e.source,
      e.copyright.length ? e.copyright.join('\n') : undefined,
      '',
      e.text,
      e.extraText ? `\n--- Full licence text ---\n\n${e.extraText}` : undefined,
    ]
      .filter((x) => x !== undefined)
      .join('\n'),
  )
  return `${HEADER}\n${sections.join('\n\n\n')}\n`
}

/** name@version of each id the notices do not list. */
export function missingFrom(n: Notices, ids: { name: string; version: string }[]): string[] {
  const have = new Set(n.entries.map((e) => `${e.name}@${e.version}`))
  return ids.map((i) => `${i.name}@${i.version}`).filter((k) => !have.has(k))
}
