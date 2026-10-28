import { describe, it, expect } from 'vitest'
import type { Command } from '../../bindings/hermes/models'
import { commandText, formatAccelerator, rankCommands } from './commandPalette'

// A slice of the real menu (menu.go), in menu order, with its ids, accelerators
// in Wails' display form, and which items need an open document.
function cmd(path: string[], label: string, accelerator = '', needsDocument = true): Command {
  return {
    id: [...path, label].join(' › '),
    path,
    label,
    accelerator,
    checked: false,
    needsDocument,
    detail: '',
  }
}

const FIXTURE: Command[] = [
  cmd(['Insert'], 'Citation…', 'Cmd+Shift+C'),
  cmd(['Insert'], 'Cross-reference…', 'Cmd+Shift+R'),
  cmd(['Insert'], 'Chart…'),
  cmd(['Insert'], 'Table…', 'Cmd+Shift+T'),
  cmd(['Format', 'Heading'], 'Heading 1', 'Cmd+1'),
  cmd(['Format'], 'Bold', 'Cmd+B'),
  cmd(['Format'], 'Italic', 'Cmd+I'),
  cmd(['Format'], 'Strikethrough', 'Cmd+Shift+X'),
  cmd(['Export'], 'Export LaTeX…'),
  cmd(['View'], 'Autosave', '', false),
]

const texts = (q: string, recent: string[] = [], welcome = false) =>
  rankCommands(FIXTURE, q, recent, { welcome }).map((m) => m.text)

describe('commandText', () => {
  it('joins the menu name and the label', () => {
    expect(commandText({ path: ['Insert'], label: 'Table…' })).toBe('Insert: Table…')
  })

  it('puts submenus between the menu name and the label', () => {
    expect(commandText({ path: ['Insert', 'Code Block'], label: 'Python' })).toBe('Insert: Code Block › Python')
  })
})

describe('formatAccelerator', () => {
  it('writes modifiers as macOS symbols in their order', () => {
    expect(formatAccelerator('Cmd+Shift+T')).toBe('⇧⌘T')
    expect(formatAccelerator('Cmd+Option+O')).toBe('⌥⌘O')
    expect(formatAccelerator('Cmd+Option+[')).toBe('⌥⌘[')
    expect(formatAccelerator('Cmd+0')).toBe('⌘0')
  })

  it('leaves no accelerator empty', () => {
    expect(formatAccelerator('')).toBe('')
  })
})

describe('rankCommands', () => {
  it('ranks a word-start match first', () => {
    expect(texts('tab')[0]).toBe('Insert: Table…')
  })

  it('ranks a match in the label above one in the menu name', () => {
    expect(texts('i')[0]).toBe('Format: Italic')
  })

  it('ranks fewer gaps first', () => {
    // The same word starts in both; only the gap differs, and the unbroken
    // one wins although it comes second.
    const got = rankCommands([cmd(['M'], 'Txb'), cmd(['M'], 'Tb')], 'tb', [], { welcome: false })
    expect(got.map((m) => m.text)).toEqual(['M: Tb', 'M: Txb'])
  })

  it('keeps menu order on a tie', () => {
    const got = rankCommands([cmd(['M'], 'Tb'), cmd(['N'], 'Tb')], 'tb', [], { welcome: false })
    expect(got.map((m) => m.text)).toEqual(['M: Tb', 'N: Tb'])
  })

  it('finds Bold', () => {
    expect(texts('bold')[0]).toBe('Format: Bold')
  })

  it('matches across the menu name and the label, ignoring spaces', () => {
    expect(texts('itab')).toContain('Insert: Table…')
    expect(texts('ins tab')).toContain('Insert: Table…')
  })

  it('ignores case', () => {
    expect(texts('TAB')).toEqual(texts('tab'))
  })

  it('returns nothing when nothing matches', () => {
    expect(texts('zzz')).toEqual([])
  })

  it('reports the matched spans', () => {
    const m = rankCommands(FIXTURE, 'tab', [], { welcome: false }).find((m) => m.text === 'Insert: Table…')
    expect(m?.ranges).toEqual([[8, 11]])
    expect(m!.text.slice(8, 11)).toBe('Tab')
  })

  it('lists recent commands first for an empty query, skipping unknown ids', () => {
    const got = texts('', ['Format › Bold', 'Gone › Item'])
    expect(got[0]).toBe('Format: Bold')
    expect(got.some((t) => t.startsWith('Gone'))).toBe(false)
    expect(got.slice(1)).toEqual(FIXTURE.map(commandText).filter((t) => t !== 'Format: Bold'))
  })

  it('drops commands that need a document in the welcome window', () => {
    const got = rankCommands(FIXTURE, '', [], { welcome: true })
    expect(got.map((m) => m.text)).toEqual(['View: Autosave'])
    expect(rankCommands(FIXTURE, 'a', [], { welcome: true }).every((m) => !m.command.needsDocument)).toBe(true)
  })
})
