// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderDocument } from './renderer'
import { CHECKS } from './tutorialTasks'
import { parseBib } from './bibliography'
import { parseDelimited } from './dataTable'

// The tutorial in docs/tutorial/ as a user first opens it: the portal
// serves it and the app bundles it, so a mistake here reaches every new user.
const DIR = join(__dirname, '../../../docs/tutorial')
const MD = readFileSync(join(DIR, 'getting-started.md'), 'utf8')

describe('the Getting Started tutorial', () => {
  const { html, crossrefs } = renderDocument(MD)
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const markers = [...MD.matchAll(/<!--\s*check:\s*([a-z-]*)\s*-->/g)].map((m) => m[1])

  it('uses every check, and only known ones', () => {
    for (const m of markers) expect(CHECKS).toContain(m)
    expect(new Set(markers)).toEqual(new Set(CHECKS))
  })

  it('has no task done before the user starts', () => {
    expect(doc.querySelectorAll('li.task-list-item').length).toBe(markers.length)
    expect(doc.querySelectorAll('li.tutorial-task-done').length).toBe(0)
  })

  it("resolves every example's cross-reference", () => {
    expect(crossrefs.missing).toEqual([])
    expect(crossrefs.duplicates).toEqual([])
  })

  it('names a bibliography that has every key it cites', () => {
    expect(MD).toMatch(/^bibliography: getting-started\.bib$/m)
    const keys = new Set(parseBib(readFileSync(join(DIR, 'getting-started.bib'), 'utf8')).entries.map((e) => e.id))
    const cited = [...MD.matchAll(/@([a-z]+\d{4}[a-z]+)/g)].map((m) => m[1])
    expect(cited.length).toBeGreaterThan(0)
    for (const k of cited) expect(keys).toContain(k)
  })

  it('has a data set the chart builder can read', () => {
    const result = parseDelimited(readFileSync(join(DIR, 'rainfall.csv'), 'utf8'))
    expect(result.ok).toBe(true)
  })
})
