// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderDocument } from './renderer'
import { CHECKS } from './tutorialTasks'
import { parseBib } from './bibliography'
import { parseDelimited } from './dataTable'
import { EditorState, EditorSelection, type StateCommand } from '@codemirror/state'
import { markdown } from '@codemirror/lang-markdown'
import { ensureSyntaxTree } from '@codemirror/language'
import { toggleHeading, toggleBold, toggleItalic, toggleBulletList, toggleOrderedList } from './markdownCommands'

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

  it('says where to do every task', () => {
    for (const section of MD.split(/^# /m).filter((x) => x.includes('<!-- check:'))) {
      expect(section, section.slice(0, 40)).toMatch(/below the tasks/i)
    }
  })

  it('leads the citation task with typing [@, which lists the bibliography', () => {
    const cite = MD.split(/^# /m).find((x) => x.startsWith('Citations'))!
    expect(cite.indexOf('`[@`')).toBeGreaterThan(-1)
    expect(cite.indexOf('`[@`')).toBeLessThan(cite.indexOf('Insert: Citation…'))
  })

  it('work typed on the line under a your-turn prompt ticks, outside the prompt', () => {
    const lines = MD.split('\n')
    const rule = lines.findIndex((l, i) => i > lines.findIndex((x) => x.startsWith('# Equations')) && l === '***')
    expect(rule).toBeGreaterThan(-1)
    lines.splice(rule + 1, 1, 'The area is $x$.')
    const typed = new DOMParser().parseFromString(renderDocument(lines.join('\n')).html, 'text/html')
    const done = [...typed.querySelectorAll('li.tutorial-task-done')].map((li) => li.textContent)
    expect(done.some((t) => t?.includes('inside a sentence'))).toBe(true)
    const p = [...typed.querySelectorAll('p')].find((x) => x.textContent?.includes('The area is'))!
    expect(p.closest('blockquote, .markdown-alert')).toBeNull()
  })

  it('names a bibliography that has every key it cites', () => {
    expect(MD).toMatch(/^bibliography: getting-started\.bib$/m)
    const keys = new Set(parseBib(readFileSync(join(DIR, 'getting-started.bib'), 'utf8')).entries.map((e) => e.id))
    const cited = [...MD.matchAll(/@([a-z]+\d{4}[a-z]+)/g)].map((m) => m[1])
    expect(cited.length).toBeGreaterThan(0)
    for (const k of cited) expect(keys).toContain(k)
  })

  it('comes first, after Welcome', () => {
    expect([...MD.matchAll(/^# (.*)$/gm)].map((m) => m[1]).slice(0, 2)).toEqual(['Welcome', 'Formatting'])
  })

  // Each formatting exercise is a line to change in place with a shortcut.
  // Running the shortcut's command on it must change what the preview shows.
  describe('the formatting exercises', () => {
    let state = EditorState.create({ doc: MD, extensions: [markdown()] })
    ensureSyntaxTree(state, state.doc.length, 5000)
    const run = (cmd: StateCommand, from: number, to = from) => {
      state = state.update({ selection: EditorSelection.single(from, to) }).state
      expect(cmd({ state, dispatch: (tr) => (state = tr.state) })).toBe(true)
      return new DOMParser().parseFromString(renderDocument(state.doc.toString()).html, 'text/html')
    }
    const lineOf = (text: string) => {
      const at = state.doc.toString().indexOf('\n' + text + '\n')
      expect(at, text).toBeGreaterThan(-1)
      return state.doc.lineAt(at + 1)
    }
    const wordIn = (text: string, word: string) => {
      const line = lineOf(text)
      const at = line.from + line.text.search(new RegExp(`\\b${word}\\b`))
      return [at, at + word.length] as const
    }

    it('⌘2 makes the practice line a heading', () => {
      const html = run(toggleHeading(2), lineOf('Make this line a heading').from + 3)
      expect([...html.querySelectorAll('h2')].map((h) => h.textContent)).toContain('Make this line a heading')
    })

    it('⌘B and ⌘I make the practice words bold and italic', () => {
      const text = 'This word is bold and this one is italic.'
      expect([...run(toggleBold, ...wordIn(text, 'bold')).querySelectorAll('strong')].map((b) => b.textContent)).toContain('bold')
      const html = run(toggleItalic, ...wordIn(text.replace('bold', '**bold**'), 'italic'))
      expect([...html.querySelectorAll('em')].map((e) => e.textContent)).toContain('italic')
    })

    it('⇧⌘8 then ⇧⌘7 make the practice lines a list, then a numbered one', () => {
      const from = lineOf('Apples').from
      const to = lineOf('Plums').to
      const items = (html: Document, tag: string) =>
        [...html.querySelectorAll(`${tag} > li`)].map((li) => li.textContent).filter((t) => ['Apples', 'Pears', 'Plums'].includes(t!))
      expect(items(run(toggleBulletList, from, to), 'ul')).toEqual(['Apples', 'Pears', 'Plums'])
      const sel = state.selection.main
      expect(items(run(toggleOrderedList, sel.from, sel.to), 'ol')).toEqual(['Apples', 'Pears', 'Plums'])
    })
  })

  it('has a data set the chart builder can read', () => {
    const result = parseDelimited(readFileSync(join(DIR, 'rainfall.csv'), 'utf8'))
    expect(result.ok).toBe(true)
  })
})
