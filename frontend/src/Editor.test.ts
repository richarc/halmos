// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, unmount, flushSync } from 'svelte'
import { EditorView, type Command } from '@codemirror/view'
import { foldCode, forceParsing } from '@codemirror/language'
import { undo } from '@codemirror/commands'
import { setSearchQuery, SearchQuery } from '@codemirror/search'
import { startCompletion, completionStatus, closeCompletion, acceptCompletion } from '@codemirror/autocomplete'
import Editor from './Editor.svelte'
import { toggleBold } from './lib/markdownCommands'
import { collectTargets } from './lib/crossrefTargets'
import type { CrossrefTarget } from './lib/crossrefs'

interface ChartBlock {
  from: number
  to: number
  spec: string
  info: string
}

interface EditorApi {
  setContent(text: string, cursor?: 'start' | 'end' | { from: number; to: number }): void
  reloadContent(text: string, undoable: boolean): void
  insertAtCursor(text: string): void
  insertBlockAtCursor(text: string): void
  insertCodeBlockAtCursor(language: string): void
  runCommand(cmd: Command): void
  lineCount(): number
  topVisibleLine(): number
  enclosingChartBlock(): ChartBlock | null
  enclosingTable(): {
    from: number
    to: number
    tableTo: number
    text: string
    caption: { caption: string; label: string | null } | null
  } | null
  replaceRange(from: number, to: number, text: string): void
  find(cmd: 'open' | 'replace' | 'next' | 'previous'): boolean
  refreshCitations(): void
  openCrossrefList(): boolean
  applyReference(target: CrossrefTarget, from: number, to: number, eqName?: string): string
}

/**
 * Mounts the editor and reports the document text back through onchange,
 * which is more precise than reading CodeMirror's rendered DOM.
 */
function mountEditor(extra: Record<string, unknown> = {}) {
  const target = document.createElement('div')
  document.body.appendChild(target)
  let latest = ''
  const cmp = mount(Editor, {
    target,
    props: { onchange: (text: string) => (latest = text), ...extra },
  }) as unknown as EditorApi
  flushSync() // Svelte 5 runs onMount in a microtask; without this the editor does not exist yet
  return {
    target,
    editor: cmp,
    text: () => latest,
    // The target is removed as well as unmounted. Leaving it behind lets a
    // finished test's .cm-editor linger in document.body, which is what made
    // the document-wide queries below pick up the wrong editor.
    cleanup: () => {
      unmount(cmp as never)
      target.remove()
    },
  }
}

describe('Editor.reloadContent', () => {
  const cursorOf = (editor: EditorApi) => {
    let head = -1
    editor.runCommand((v) => ((head = v.state.selection.main.head), true))
    return head
  }

  it('keeps the cursor where it was when lines are appended after it', () => {
    const { editor, cleanup } = mountEditor()
    editor.setContent('one\ntwo\n')
    flushSync()
    editor.runCommand((v) => (v.dispatch({ selection: { anchor: 5 } }), true))
    editor.reloadContent('one\ntwo\nthree\n', false)
    flushSync()
    expect(cursorOf(editor)).toBe(5)
    cleanup()
  })

  it('moves the cursor forward when a line is inserted above it', () => {
    const { editor, cleanup } = mountEditor()
    editor.setContent('one\ntwo\n')
    flushSync()
    editor.runCommand((v) => (v.dispatch({ selection: { anchor: 5 } }), true))
    editor.reloadContent('zero\none\ntwo\n', false)
    flushSync()
    expect(cursorOf(editor)).toBe(10)
    cleanup()
  })

  it('leaves the user\'s own edits on the undo stack when the reload is not undoable', () => {
    const { editor, text, cleanup } = mountEditor()
    editor.setContent('a\n')
    flushSync()
    editor.insertAtCursor('X')
    flushSync()
    editor.reloadContent('Xa\nb\n', false)
    flushSync()
    editor.runCommand(undo)
    flushSync()
    expect(text()).toBe('a\nb\n')
    cleanup()
  })

  it('can be undone when asked to be undoable', () => {
    const { editor, text, cleanup } = mountEditor()
    editor.setContent('before\n')
    flushSync()
    editor.reloadContent('after\n', true)
    flushSync()
    expect(text()).toBe('after\n')
    editor.runCommand(undo)
    flushSync()
    expect(text()).toBe('before\n')
    cleanup()
  })

  it('reports the new text through onchange', () => {
    const { editor, text, cleanup } = mountEditor()
    editor.setContent('a')
    flushSync()
    editor.reloadContent('ab', false)
    flushSync()
    expect(text()).toBe('ab')
    cleanup()
  })
})

describe('Editor.setContent', () => {
  it('defaults the cursor to the start, so opening a file does not relocate it', () => {
    const { editor, text, cleanup } = mountEditor()
    editor.setContent('---\n# csl: apa\n---\n')
    flushSync()

    editor.insertAtCursor('BODY')
    flushSync()

    expect(text()).toBe('BODY---\n# csl: apa\n---\n')
    cleanup()
  })

  it("leaves the cursor at the end when asked, so typing after File → New continues below the text", () => {
    const { editor, text, cleanup } = mountEditor()
    editor.setContent('---\n# csl: apa\n---\n', 'end')
    flushSync()

    editor.insertAtCursor('BODY')
    flushSync()

    expect(text()).toBe('---\n# csl: apa\n---\nBODY')
    cleanup()
  })

  it('selects a range when asked, so typing replaces a placeholder', () => {
    const { editor, text, cleanup } = mountEditor()
    editor.setContent('---\ntitle: "T"\n---\n', { from: 12, to: 13 })
    flushSync()
    let range = { from: -1, to: -1 }
    editor.runCommand((v) => ((range = { from: v.state.selection.main.from, to: v.state.selection.main.to }), true))
    expect(range).toEqual({ from: 12, to: 13 })

    editor.insertAtCursor('Wheat')
    flushSync()
    expect(text()).toBe('---\ntitle: "Wheat"\n---\n')
    cleanup()
  })

  it('does not let undo resurrect the previous document after selecting a range', () => {
    const { editor, text, cleanup } = mountEditor()
    editor.setContent('first document')
    flushSync()
    editor.setContent('---\ntitle: "T"\n---\n', { from: 12, to: 13 })
    flushSync()
    editor.runCommand(undo)
    flushSync()
    expect(text()).toBe('---\ntitle: "T"\n---\n')
    cleanup()
  })

  it('does not let undo resurrect the document it replaced', () => {
    // The bug this pins: setContent used to dispatch an ordinary transaction,
    // and basicSetup bundles history(), so ⌘Z after File → New restored the
    // PREVIOUS document's text while App.svelte's `path` was already null —
    // and the next ⌘S then wrote that old content into a brand new file.
    // Replacing the document has to replace its undo history with it.
    const { editor, text, cleanup } = mountEditor()
    editor.setContent('first document')
    flushSync()
    editor.setContent('second document')
    flushSync()

    editor.runCommand(undo)
    flushSync()

    expect(text()).toBe('second document')
    cleanup()
  })

  it('still reports the new text through onchange', () => {
    // Guards the contract the fix must not break: every caller and every test
    // above learns the document text from this callback, not from the DOM.
    const { editor, text, cleanup } = mountEditor()
    editor.setContent('reported')
    flushSync()

    expect(text()).toBe('reported')
    cleanup()
  })

  it('replaces the whole document rather than appending to it', () => {
    const { editor, text, cleanup } = mountEditor()
    editor.setContent('first')
    flushSync()
    editor.setContent('second')
    flushSync()

    expect(text()).toBe('second')
    cleanup()
  })
})

describe('Editor.insertBlockAtCursor', () => {
  // Critical finding: commitChart used insertAtCursor (a bare
  // replaceSelection) for a fresh insert, so a chart placed after prose on
  // the same line landed mid-line — not a fence at all, so markdown rendered
  // the raw JSON as prose and the syntax tree could never recognise it well
  // enough to reopen. insertBlockAtCursor exists specifically to guarantee a
  // fresh line.
  it('starts the block on a fresh line when the cursor is mid-line, leaving the original prose intact', () => {
    const { editor, text, cleanup } = mountEditor()
    editor.setContent('Some prose here.', 'end')
    flushSync()

    editor.insertBlockAtCursor('```vega-lite\n{}\n```')
    flushSync()

    const doc = text()
    expect(doc).toMatch(/(^|\n)```vega-lite/)
    // The original sentence survives whole, on its own line, not merged
    // into the fence.
    const lines = doc.split('\n')
    expect(lines[0]).toBe('Some prose here.')
    cleanup()
  })

  it('does not add a spurious blank line when the cursor is already at column 0', () => {
    const { editor, text, cleanup } = mountEditor()
    editor.setContent('') // cursor defaults to the start
    flushSync()

    editor.insertBlockAtCursor('```vega-lite\n{}\n```')
    flushSync()

    expect(text()).toBe('```vega-lite\n{}\n```')
    cleanup()
  })

  // Deferred review finding, v0.8: this was built on replaceSelection, so
  // selecting a paragraph and inserting a chart DELETED the paragraph, with
  // no prompt and no undo the author would think to reach for. Insert means
  // insert. The block now lands after the selection and the prose stays.
  it('leaves a selection intact and writes the block after it', () => {
    const { editor, target, text, cleanup } = mountEditor()
    editor.setContent('Figure 2 shows the trend.\n')
    flushSync()

    const view = EditorView.findFromDOM(target.querySelector('.cm-editor')!)!
    view.dispatch({ selection: { anchor: 0, head: 'Figure 2 shows the trend.'.length } })
    flushSync()

    editor.insertBlockAtCursor('```vega-lite\n{}\n```\n')
    flushSync()

    expect(text()).toBe('Figure 2 shows the trend.\n\n```vega-lite\n{}\n```\n\n')
    cleanup()
  })

  // The fresh-line guarantee has to key off the end of the selection, which
  // for a BACKWARD selection (anchor > head) is the anchor, not the head. A
  // head-keyed check reads this one as column 0 and merges the fence into the
  // line the selection ends in the middle of.
  it('keys off the selection end, not its head, for a backward selection', () => {
    const { editor, target, text, cleanup } = mountEditor()
    editor.setContent('Just prose.\nsecond line\n')
    flushSync()

    const view = EditorView.findFromDOM(target.querySelector('.cm-editor')!)!
    const lineTwo = 'Just prose.\n'.length
    // head at the start of line two, anchor mid-way along it.
    view.dispatch({
      selection: { anchor: lineTwo + 'second'.length, head: lineTwo },
    })
    flushSync()

    editor.insertBlockAtCursor('```vega-lite\n{}\n```\n')
    flushSync()

    const doc = text()
    expect(doc).toMatch(/\n```vega-lite/)
    // 'second' is not swallowed by the fence, and ' line' is not orphaned
    // above it.
    expect(doc.split('\n')[1]).toBe('second')
    cleanup()
  })

  // The cursor lands after the inserted block in both cases, so typing
  // continues below the chart rather than inside it or back in the prose.
  it('leaves the cursor after the block, not on the selection it kept', () => {
    const { editor, target, text, cleanup } = mountEditor()
    editor.setContent('prose\n')
    flushSync()

    const view = EditorView.findFromDOM(target.querySelector('.cm-editor')!)!
    view.dispatch({ selection: { anchor: 0, head: 'prose'.length } })
    flushSync()

    editor.insertBlockAtCursor('```vega-lite\n{}\n```\n')
    flushSync()
    editor.insertAtCursor('after')
    flushSync()

    expect(text()).toBe('prose\n\n```vega-lite\n{}\n```\nafter\n')
    cleanup()
  })
})

describe('Editor.insertCodeBlockAtCursor', () => {
  // The whole point of the feature. insertBlockAtCursor leaves the cursor
  // *after* what it inserted, which would strand the author below a fence
  // they have to arrow back into — barely better than typing the backticks.
  it('leaves the cursor on the empty line between the fences, so typing goes into the block', () => {
    const { editor, text, cleanup } = mountEditor()
    editor.setContent('') // cursor defaults to the start
    flushSync()

    editor.insertCodeBlockAtCursor('python')
    flushSync()
    // Typing at wherever the cursor was left is the honest test of placement.
    editor.insertAtCursor('print(1)')
    flushSync()

    expect(text()).toBe('```python\nprint(1)\n```\n')
    cleanup()
  })

  it('writes a bare fence when given no language', () => {
    const { editor, text, cleanup } = mountEditor()
    editor.setContent('')
    flushSync()

    editor.insertCodeBlockAtCursor('')
    flushSync()

    expect(text()).toBe('```\n\n```\n')
    cleanup()
  })

  // insertBlockAtCursor is built on replaceSelection, which DELETES the
  // selection and puts the block in its place. For a code block the
  // obviously-correct behaviour is the opposite: an author who selected three
  // lines and reached for this menu means "wrap these".
  it('wraps a selection in the fence rather than destroying it', () => {
    const { editor, target, text, cleanup } = mountEditor()
    editor.setContent('alpha\nbeta\n')
    flushSync()

    const view = EditorView.findFromDOM(target.querySelector('.cm-editor')!)!
    view.dispatch({ selection: { anchor: 0, head: 'alpha\nbeta'.length } })
    flushSync()

    editor.insertCodeBlockAtCursor('shell')
    flushSync()

    expect(text()).toBe('```shell\nalpha\nbeta\n```\n\n')
    cleanup()
  })

  it('leaves the wrapped text selected, so it can be retyped in one keystroke', () => {
    const { editor, target, text, cleanup } = mountEditor()
    editor.setContent('alpha\n')
    flushSync()

    const view = EditorView.findFromDOM(target.querySelector('.cm-editor')!)!
    view.dispatch({ selection: { anchor: 0, head: 'alpha'.length } })
    flushSync()

    editor.insertCodeBlockAtCursor('shell')
    flushSync()
    // Replacing the selection proves it covers exactly the wrapped text and
    // neither fence line.
    editor.insertAtCursor('ls')
    flushSync()

    expect(text()).toBe('```shell\nls\n```\n\n')
    cleanup()
  })

  // Same hazard insertBlockAtCursor exists to avoid: written at a column
  // other than 0 it is not a fence at all, and markdown renders its contents
  // as prose.
  it('starts the fence on a fresh line when the cursor is mid-line', () => {
    const { editor, text, cleanup } = mountEditor()
    editor.setContent('Some prose here.', 'end')
    flushSync()

    editor.insertCodeBlockAtCursor('go')
    flushSync()

    const doc = text()
    expect(doc).toMatch(/(^|\n)```go/)
    expect(doc.split('\n')[0]).toBe('Some prose here.')
    cleanup()
  })
})

describe('Editor scroll reporting', () => {
  it('reports the document line count', () => {
    const { editor, cleanup } = mountEditor()
    editor.setContent('a\nb\nc\nd\n')
    flushSync()
    expect(editor.lineCount()).toBe(5) // four lines plus the trailing empty one
    cleanup()
  })

  it('calls onscroll when the editor scroller scrolls', () => {
    const scrolls: number[] = []
    const target = document.createElement('div')
    document.body.appendChild(target)
    const cmp = mount(Editor, {
      target,
      props: { onchange: () => {}, onscroll: () => scrolls.push(1) },
    }) as unknown as { setContent(t: string): void }
    flushSync()

    const scroller = target.querySelector('.cm-scroller') as HTMLElement
    scroller.dispatchEvent(new Event('scroll'))
    expect(scrolls.length).toBe(1)

    unmount(cmp as never)
  })
})

describe('Editor theme', () => {
  it('styles itself with CSS variables, never literal colours', () => {
    const { cleanup } = mountEditor()

    const css = [...document.querySelectorAll('style')]
      .map((s) => s.textContent ?? '')
      .join('\n')
    // Our theme's rules — the ones carrying var(--editor-*) — must exist.
    expect(css).toContain('var(--editor-bg)')
    expect(css).toContain('var(--editor-selection)')
    expect(css).toContain('var(--editor-gutter-bg)')
    expect(css).toContain('var(--syn-heading)')

    cleanup()
  })

  it('themes the search/replace panel that ⌘F opens, not just the document', () => {
    // basicSetup's searchKeymap self-installs a panel (.cm-panels, with a
    // .cm-textfield and .cm-button inside it) that nothing else intercepts,
    // so it must follow the palette like every other editor rule instead of
    // staying on CodeMirror's light base theme.
    const { cleanup } = mountEditor()

    const css = [...document.querySelectorAll('style')]
      .map((s) => s.textContent ?? '')
      .join('\n')
    expect(css).toMatch(/\.cm-panels\s*\{[^}]*var\(--/)
    expect(css).toMatch(/\.cm-textfield\s*\{[^}]*var\(--/)

    cleanup()
  })

  it('emits our theme after the base theme, so ours wins the specificity tie', () => {
    const { cleanup } = mountEditor()

    const css = [...document.querySelectorAll('style')]
      .map((s) => s.textContent ?? '')
      .join('\n')
    const lines = css.split('\n')
    const base = lines.findIndex((l) => /\.\S+ \.cm-selectionBackground \{background: #/.test(l))
    const ours = lines.findIndex((l) => l.includes('var(--editor-selection)'))
    // CodeMirror's `&light` base rule and ours have equal specificity — one
    // class each — so source order decides. If a future CodeMirror raised base
    // specificity this would break, and the symptom would be a light selection
    // highlight in dark mode rather than an error.
    expect(base).toBeGreaterThanOrEqual(0)
    expect(ours).toBeGreaterThan(base)

    cleanup()
  })
})

describe('Editor folding', () => {
  it('themes the folded placeholder from the palette', () => {
    const { cleanup } = mountEditor()

    const css = [...document.querySelectorAll('style')]
      .map((s) => s.textContent ?? '')
      .join('\n')
    // CodeMirror's base theme hardcodes #eee/#ddd/#888 here, which is a light
    // pill on a dark page. Ours must come from the palette instead.
    expect(css).toMatch(/\.cm-foldPlaceholder[^}]*var\(--/)

    cleanup()
  })
})

describe('Editor.runCommand', () => {
  it('runs a StateCommand (toggleBold) through the mounted view', () => {
    // markdownCommands.test.ts calls toggleBold with a hand-built
    // {state, dispatch} pair, never through Editor.svelte — it proves the
    // command works in isolation, not that runCommand's `cmd(view)` call
    // still drives a StateCommand correctly. This exercises that path for
    // real: EditorView.findFromDOM gets the actual view instance so we can
    // select "hello" the way a user would, then runCommand invokes toggleBold
    // with the view itself, exactly as App.svelte does.
    const { target, editor, text, cleanup } = mountEditor()
    editor.setContent('hello')
    flushSync()

    const view = EditorView.findFromDOM(target)
    expect(view).not.toBeNull()
    view?.dispatch({ selection: { anchor: 0, head: 5 } })

    editor.runCommand(toggleBold)
    flushSync()

    expect(text()).toBe('**hello**')
    cleanup()
  })

  it('runs a view-taking Command (foldCode) through the same method', () => {
    // The other half of the widening: CodeMirror's fold commands are typed
    // Command, not StateCommand, and need the view rather than a
    // {state, dispatch} pair. A folded block renders a .cm-foldPlaceholder
    // element, so its presence proves runCommand drove foldCode correctly.
    const { target, editor, cleanup } = mountEditor()
    editor.setContent('```js\nconst x = 1\n```\n')
    flushSync() // cursor defaults to the document start, on the fence's opening line

    editor.runCommand(foldCode)
    flushSync()

    expect(target.querySelector('.cm-foldPlaceholder')).not.toBeNull()
    cleanup()
  })
})

describe('chart block lookup', () => {
  const DOC = [
    '# Results',
    '',
    '```vega-lite',
    '{"mark": "line"}',
    '```',
    '',
    'After.',
    '',
    '```js',
    'const x = 1',
    '```',
    '',
  ].join('\n')

  /** Mounts with DOC loaded and the cursor at `pos`. */
  function atPosition(pos: number, doc = DOC) {
    const { editor, target, cleanup } = mountEditor()
    editor.setContent(doc)
    // Scoped to this test's own target. `document.querySelector` returned
    // whichever editor happened to be first in the body, so these tests were
    // passing on the incidental fact that no earlier one had outlived its
    // cleanup — adding any test above them broke seven at once.
    const view = EditorView.findFromDOM(target.querySelector('.cm-editor')!)!
    view.dispatch({ selection: { anchor: pos } })
    return { editor, view, cleanup }
  }

  it('finds the block when the cursor is in the spec body', () => {
    const { editor, cleanup } = atPosition(DOC.indexOf('"mark"'))
    const block = editor.enclosingChartBlock()
    expect(block).not.toBeNull()
    expect(block!.spec).toBe('{"mark": "line"}')
    cleanup()
  })

  it('finds a labelled block and returns the whole info string', () => {
    const doc = DOC.replace('```vega-lite', '```vega-lite {#fig:yield}')
    const { editor, cleanup } = atPosition(doc.indexOf('"mark"'), doc)
    expect(editor.enclosingChartBlock()!.info).toBe('vega-lite {#fig:yield}')
    cleanup()
  })

  it('finds the block from the very start of the opening fence', () => {
    // side=0 misses this position entirely; the implementation tries side=1.
    const { editor, cleanup } = atPosition(DOC.indexOf('```vega-lite'))
    expect(editor.enclosingChartBlock()).not.toBeNull()
    cleanup()
  })

  it('finds the block from the end of the closing fence', () => {
    // The mirror case: only side=-1 reaches this one.
    const end = DOC.indexOf('```\n\nAfter') + 3
    const { editor, cleanup } = atPosition(end)
    expect(editor.enclosingChartBlock()).not.toBeNull()
    cleanup()
  })

  it('returns null in ordinary prose', () => {
    const { editor, cleanup } = atPosition(DOC.indexOf('After.') + 2)
    expect(editor.enclosingChartBlock()).toBeNull()
    cleanup()
  })

  it('returns null inside a non-vega fenced block', () => {
    const { editor, cleanup } = atPosition(DOC.indexOf('const x'))
    expect(editor.enclosingChartBlock()).toBeNull()
    cleanup()
  })

  it('reports an empty body for an empty chart block', () => {
    const { editor, target, cleanup } = mountEditor()
    editor.setContent('```vega-lite\n```\n')
    const view = EditorView.findFromDOM(target.querySelector('.cm-editor')!)!
    view.dispatch({ selection: { anchor: 13 } })
    expect(editor.enclosingChartBlock()!.spec).toBe('')
    cleanup()
  })

  it('replaces a range and leaves the cursor after the new text', () => {
    const { editor, view, cleanup } = atPosition(0)
    const block = (() => {
      view.dispatch({ selection: { anchor: DOC.indexOf('"mark"') } })
      return editor.enclosingChartBlock()!
    })()
    editor.replaceRange(block.from, block.to, '```vega-lite\n{"mark": "bar"}\n```')
    expect(view.state.doc.toString()).toContain('"mark": "bar"')
    expect(view.state.doc.toString()).not.toContain('"mark": "line"')
    expect(view.state.selection.main.head).toBe(block.from + 32)
    cleanup()
  })
})

describe('Editor.enclosingTable', () => {
  const TABLE = '| a | b |\n| --- | --- |\n| 1 | 2 |'
  const DOC = `# Results\n\n${TABLE}\n\nAfter.\n`

  function atPosition(pos: number) {
    const { target, editor, cleanup } = mountEditor()
    editor.setContent(DOC)
    const view = EditorView.findFromDOM(target.querySelector('.cm-editor')!)!
    view.dispatch({ selection: { anchor: pos } })
    return { editor, cleanup }
  }

  it('finds the table from a body cell, with its exact text', () => {
    const { editor, cleanup } = atPosition(DOC.indexOf('| 1'))
    const block = editor.enclosingTable()
    expect(block).not.toBeNull()
    expect(block!.text).toBe(TABLE)
    expect(DOC.slice(block!.from, block!.to)).toBe(TABLE)
    cleanup()
  })

  it('finds the table from the very start of the header row', () => {
    const { editor, cleanup } = atPosition(DOC.indexOf('| a'))
    expect(editor.enclosingTable()).not.toBeNull()
    cleanup()
  })

  it('finds the table from the end of the last row', () => {
    const { editor, cleanup } = atPosition(DOC.indexOf('| 2 |') + '| 2 |'.length)
    expect(editor.enclosingTable()).not.toBeNull()
    cleanup()
  })

  it('finds nothing in prose', () => {
    const { editor, cleanup } = atPosition(DOC.indexOf('After'))
    expect(editor.enclosingTable()).toBeNull()
    cleanup()
  })

  it('has no caption when none follows', () => {
    const { editor, cleanup } = atPosition(DOC.indexOf('| 1'))
    expect(editor.enclosingTable()!.caption).toBeNull()
    cleanup()
  })

  describe('with a caption', () => {
    const CAPTION = ': Yield {#tbl:y}'
    const CDOC = `# Results\n\n${TABLE}\n\n${CAPTION}\n\nAfter.\n`

    function at(doc: string, pos: number) {
      const { target, editor, cleanup } = mountEditor()
      editor.setContent(doc)
      const view = EditorView.findFromDOM(target.querySelector('.cm-editor')!)!
      view.dispatch({ selection: { anchor: pos } })
      return { editor, cleanup }
    }

    it('extends over the caption from a cursor in the table', () => {
      const { editor, cleanup } = at(CDOC, CDOC.indexOf('| 1'))
      const block = editor.enclosingTable()!
      expect(block.caption).toEqual({ caption: 'Yield', label: 'tbl:y' })
      expect(block.text).toBe(`${TABLE}\n\n${CAPTION}`)
      expect(CDOC.slice(block.from, block.to)).toBe(block.text)
      cleanup()
    })

    it('finds the table from a cursor on the caption line', () => {
      const { editor, cleanup } = at(CDOC, CDOC.indexOf('Yield'))
      const block = editor.enclosingTable()!
      expect(block.caption).toEqual({ caption: 'Yield', label: 'tbl:y' })
      expect(block.from).toBe(CDOC.indexOf('| a'))
      expect(block.to).toBe(CDOC.indexOf(CAPTION) + CAPTION.length)
      cleanup()
    })

    it('joins a wrapped caption and reads the label from its last line', () => {
      const doc = `${TABLE}\n\n: Yield by\ngroup {#tbl:y}\n\nAfter.\n`
      const { editor, cleanup } = at(doc, doc.indexOf('group'))
      const block = editor.enclosingTable()!
      expect(block.caption).toEqual({ caption: 'Yield by group', label: 'tbl:y' })
      expect(block.to).toBe(doc.indexOf('{#tbl:y}') + '{#tbl:y}'.length)
      cleanup()
    })

    it('stops the range at the caption paragraph when a heading follows it', () => {
      const doc = `${TABLE}\n\n${CAPTION}\n## Methods\n`
      const { editor, cleanup } = at(doc, doc.indexOf('| 1'))
      const block = editor.enclosingTable()!
      expect(block.to).toBe(doc.indexOf(CAPTION) + CAPTION.length)
      expect(block.tableTo).toBe(doc.indexOf(TABLE) + TABLE.length)
      cleanup()
    })

    it('ignores a caption line that is not after a table', () => {
      const doc = 'Some prose.\n\n: Not a caption\n'
      const { editor, cleanup } = at(doc, doc.indexOf('Not'))
      expect(editor.enclosingTable()).toBeNull()
      cleanup()
    })

    it('ignores a caption separated from the table by two blank lines', () => {
      const doc = `${TABLE}\n\n\n${CAPTION}\n`
      const { editor, cleanup } = at(doc, doc.indexOf('Yield'))
      expect(editor.enclosingTable()).toBeNull()
      cleanup()
    })
  })
})

describe('spell checking', () => {
  it('is on by default: the content element says spellcheck="true"', () => {
    const { target, cleanup } = mountEditor()
    expect(target.querySelector('.cm-content')!.getAttribute('spellcheck')).toBe('true')
    cleanup()
  })

  it('protects code and maths inside the editor', () => {
    const { editor, target, cleanup } = mountEditor()
    editor.setContent('Prose `code` and $x$.\n')
    const view = EditorView.findFromDOM(target.querySelector('.cm-editor')!)!
    forceParsing(view)
    const off = [...target.querySelectorAll('.cm-content [spellcheck="false"]')].map((el) => el.textContent)
    expect(off).toEqual(['`code`', '$x$'])
    cleanup()
  })

  it('rebuilds spellcheck state from the live prop on setContent', () => {
    // setContent replaces the editor state via editorExtensions(), which
    // must read the current spellcheck prop rather than a stale closure —
    // otherwise a rebuilt document would silently regain checking.
    const { editor, target, cleanup } = mountEditor({ spellcheck: false })
    editor.setContent('Prose `code`.\n')
    const view = EditorView.findFromDOM(target.querySelector('.cm-editor')!)!
    forceParsing(view)
    const content = target.querySelector('.cm-content')!
    expect(content.getAttribute('spellcheck')).toBe('false')
    expect(content.querySelectorAll('[spellcheck="false"]')).toHaveLength(0)
    cleanup()
  })
})

// #18: Edit → Find routes here through App's menu:find handler.
describe('Editor.find', () => {
  it('opens the search panel', () => {
    const { target, editor, cleanup } = mountEditor()
    editor.setContent('a b a')
    flushSync()

    expect(editor.find('open')).toBe(true)

    expect(target.querySelector('.cm-search')).not.toBeNull()
    cleanup()
  })

  it('focuses the replace field for Find and Replace', () => {
    const { target, editor, cleanup } = mountEditor()
    editor.setContent('a b a')
    flushSync()

    editor.find('replace')

    expect(document.activeElement).toBe(target.querySelector('.cm-search [name=replace]'))
    cleanup()
  })

  it('steps forward and back through matches', () => {
    const { target, editor, cleanup } = mountEditor()
    editor.setContent('a b a')
    flushSync()
    editor.find('open')
    const view = EditorView.findFromDOM(target.querySelector('.cm-editor') as HTMLElement)!
    view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: 'a' })) })

    // From an empty cursor at 0, the first match is the a at 0 itself.
    editor.find('next')
    expect(view.state.selection.main.from).toBe(0)
    editor.find('next')
    expect(view.state.selection.main.from).toBe(4)
    editor.find('previous')
    expect(view.state.selection.main.from).toBe(0)
    cleanup()
  })
})

describe('Editor citation completion', () => {
  const ctx = {
    entries: [{ id: 'smith2020', type: 'book', title: 'T', author: [{ family: 'Smith' }] }],
    has: (k: string) => k === 'smith2020',
    reference: () => null,
    bibName: 'refs.bib',
  }

  async function typeAndComplete(citations: () => typeof ctx | null) {
    const { editor, target, cleanup } = mountEditor({ citations })
    editor.setContent('[@sm', 'end')
    const view = EditorView.findFromDOM(target.querySelector('.cm-editor') as HTMLElement)!
    startCompletion(view)
    await new Promise((r) => setTimeout(r, 50))
    const status = completionStatus(view.state)
    cleanup()
    return status
  }

  it('opens the completion list for a key prefix', async () => {
    expect(await typeAndComplete(() => ctx)).toBe('active')
  })

  it('offers nothing when no bibliography is loaded', async () => {
    expect(await typeAndComplete(() => null)).toBeNull()
  })

  it('shows each suggestion on two lines: key and author, then title', async () => {
    const { editor, target, cleanup } = mountEditor({ citations: () => ctx })
    editor.setContent('[@sm', 'end')
    const view = EditorView.findFromDOM(target.querySelector('.cm-editor') as HTMLElement)!
    startCompletion(view)
    await vi.waitFor(() => expect(document.querySelector('li.cm-citation-option')).not.toBeNull())
    const row = document.querySelector('li.cm-citation-option')!
    expect(row.querySelector('.cm-completionLabel')?.textContent).toBe('smith2020')
    expect(row.querySelector('.cm-completionDetail')?.textContent).toBe('Smith')
    expect(row.querySelector('.cm-citation-title')?.textContent).toBe('T')
    expect(document.querySelector('.cm-completionInfo')).toBeNull()
    cleanup()
  })

  // #20: inside the editor pane (overflow: auto) the list was cut off at the
  // pane's edge, because WebKit makes CodeMirror fall back to absolute
  // positioning. Drawn from document.body, it shows over the preview.
  it('draws the list outside the editor pane, and removes it with the editor', async () => {
    const { editor, target, cleanup } = mountEditor({ citations: () => ctx })
    editor.setContent('[@sm', 'end')
    const view = EditorView.findFromDOM(target.querySelector('.cm-editor') as HTMLElement)!
    startCompletion(view)
    await vi.waitFor(() => expect(document.querySelector('.cm-tooltip-autocomplete')).not.toBeNull())
    expect(target.querySelector('.cm-tooltip-autocomplete')).toBeNull()
    cleanup()
    expect(document.querySelector('.cm-tooltip-autocomplete')).toBeNull()
  })
})

describe('Editor unknown citation keys', () => {
  const entries = [{ id: 'a', type: 'book', title: 'T', author: [{ family: 'A' }] }]
  const marks = (target: HTMLElement) =>
    [...target.querySelectorAll('.cm-cite-unknown')].map((e) => e.textContent)

  it('marks keys missing from the bibliography', () => {
    const citations = () => ({ entries, has: (k: string) => k === 'a', reference: () => null, bibName: 'refs.bib' })
    const { editor, target, cleanup } = mountEditor({ citations })
    editor.setContent('[@a; @b]')
    expect(marks(target)).toEqual(['b'])
    cleanup()
  })

  it('marks nothing without a bibliography', () => {
    const { editor, target, cleanup } = mountEditor({ citations: () => null })
    editor.setContent('[@a; @b]')
    expect(marks(target)).toEqual([])
    cleanup()
  })

  it('does not mark keys in code or frontmatter', () => {
    const citations = () => ({ entries, has: () => false, reference: () => null, bibName: 'refs.bib' })
    const { editor, target, cleanup } = mountEditor({ citations })
    editor.setContent('---\nnote: [@fm]\n---\n\n`[@code]` and [@real]')
    expect(marks(target)).toEqual(['real'])
    cleanup()
  })

  it('refreshCitations re-evaluates after the bibliography changes', () => {
    let known = false
    const citations = () => ({ entries, has: () => known, reference: () => null, bibName: 'refs.bib' })
    const { editor, target, cleanup } = mountEditor({ citations })
    editor.setContent('[@b]')
    expect(marks(target)).toEqual(['b'])
    known = true
    editor.refreshCitations()
    expect(marks(target)).toEqual([])
    cleanup()
  })
})

// CodeMirror ignores accept and move keys for interactionDelay (75 ms)
// after the list opens, so a test waits that out the way a person would.
const listReady = () => new Promise((r) => setTimeout(r, 100))

describe('Editor cross-references', () => {
  // jsdom's Range has no geometry; CodeMirror measures the list's position with it.
  beforeEach(() => {
    Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList
    Range.prototype.getBoundingClientRect = () => new DOMRect()
  })

  const DOC = 'See @fig:\n\n![Yield](a.png)\n\n![Rain](b.png){#fig:rain}\n'

  function viewOf(target: HTMLElement) {
    return EditorView.findFromDOM(target.querySelector('.cm-editor') as HTMLElement)!
  }

  it('applyReference writes the label and the reference as one undo step', () => {
    const { editor, target, text, cleanup } = mountEditor()
    editor.setContent(DOC)
    const from = DOC.indexOf('@fig:')
    const fig = collectTargets(DOC)[0]
    expect(editor.applyReference(fig, from, from + 5)).toBe('ok')
    expect(text()).toBe('See @fig:yield\n\n![Yield](a.png){#fig:yield}\n\n![Rain](b.png){#fig:rain}\n')
    const view = viewOf(target)
    // The caret follows the reference, not the label.
    expect(view.state.selection.main.head).toBe(from + '@fig:yield'.length)
    undo(view)
    expect(view.state.doc.toString()).toBe(DOC)
    cleanup()
  })

  it('applyReference reports a target that is gone and writes nothing', () => {
    const { editor, target, cleanup } = mountEditor()
    editor.setContent('See @fig:\n\nNo figure here.\n')
    const gone = collectTargets(DOC)[0]
    expect(editor.applyReference(gone, 4, 9)).toBe('moved')
    expect(viewOf(target).state.doc.toString()).toBe('See @fig:\n\nNo figure here.\n')
    cleanup()
  })

  it('applyReference passes on a bad equation name', () => {
    const { editor, cleanup } = mountEditor()
    const doc = 'See @eq:\n\n$$ x $$\n'
    editor.setContent(doc)
    expect(editor.applyReference(collectTargets(doc)[0], 4, 8, 'a b')).toBe('invalid')
    cleanup()
  })

  it('typing @fig: opens a list of figures', async () => {
    let targets: CrossrefTarget[] = []
    const { editor, target, cleanup } = mountEditor({ crossrefs: () => targets })
    editor.setContent(DOC, 'end')
    targets = collectTargets(DOC)
    const view = viewOf(target)
    view.dispatch({ selection: { anchor: DOC.indexOf('@fig:') + 5 } })
    startCompletion(view)
    await vi.waitFor(() => expect(document.querySelector('li.cm-crossref-option')).not.toBeNull())
    const labels = [...document.querySelectorAll('li.cm-crossref-option .cm-completionLabel')].map((e) => e.textContent)
    expect(labels).toEqual(['Figure 1', 'Figure 2'])
    cleanup()
  })

  it('openCrossrefList lists every kind at the cursor, once', async () => {
    const doc = 'See \n\n![Yield](a.png)\n\n$$ x $$\n'
    const { editor, target, cleanup } = mountEditor({ crossrefs: () => collectTargets(doc) })
    editor.setContent(doc)
    const view = viewOf(target)
    view.dispatch({ selection: { anchor: 4 } })
    editor.openCrossrefList()
    await vi.waitFor(() => expect(completionStatus(view.state)).toBe('active'))
    const labels = [...document.querySelectorAll('li.cm-crossref-option .cm-completionLabel')].map((e) => e.textContent)
    expect(labels).toEqual(['Figure 1', 'Unnamed equation'])
    // Closing the list ends the all-kinds mode: an explicit request at a
    // plain word offers nothing.
    closeCompletion(view)
    startCompletion(view)
    await new Promise((r) => setTimeout(r, 50))
    expect(completionStatus(view.state)).toBeNull()
    cleanup()
  })

  // The list cannot open in code; the all-kinds mode must not outlive that
  // and turn a later Ctrl-Space at a plain word into the cross-reference list.
  it.each([
    ['code', 'code'],
    ['frontmatter', 'title'],
    ['maths', 'x + y'],
  ])('openCrossrefList in %s leaves no all-kinds mode behind', async (_, at) => {
    const doc = '---\ntitle: T\n---\nSee \n\n```js\ncode\n```\n\n$x + y$\n\n![Yield](a.png)\n'
    const { editor, target, cleanup } = mountEditor({ crossrefs: () => collectTargets(doc) })
    editor.setContent(doc)
    const view = viewOf(target)
    view.dispatch({ selection: { anchor: doc.indexOf(at) + 1 } })
    editor.openCrossrefList()
    await new Promise((r) => setTimeout(r, 50))
    expect(completionStatus(view.state)).toBeNull()
    view.dispatch({ selection: { anchor: doc.indexOf('See ') + 4 } })
    startCompletion(view)
    await new Promise((r) => setTimeout(r, 50))
    expect(completionStatus(view.state)).toBeNull()
    cleanup()
  })

  it('from the menu, a reference chosen right after a word is spaced off it', async () => {
    const doc = 'see\n\n![Yield](a.png){#fig:yield}\n'
    const { editor, target, text, cleanup } = mountEditor({ crossrefs: () => collectTargets(doc) })
    editor.setContent(doc)
    const view = viewOf(target)
    view.dispatch({ selection: { anchor: 3 } })
    editor.openCrossrefList()
    await vi.waitFor(() => expect(completionStatus(view.state)).toBe('active'))
    await listReady()
    acceptCompletion(view)
    expect(text()).toBe('see @fig:yield\n\n![Yield](a.png){#fig:yield}\n')
    cleanup()
  })

  it('choosing an unlabelled figure from the list hands it to onpickcrossref', async () => {
    const doc = 'See @fig:\n\n![Yield](a.png)\n'
    const onpickcrossref = vi.fn()
    const { editor, target, cleanup } = mountEditor({ crossrefs: () => collectTargets(doc), onpickcrossref })
    editor.setContent(doc)
    const view = viewOf(target)
    view.dispatch({ selection: { anchor: 9 } })
    startCompletion(view)
    await vi.waitFor(() => expect(completionStatus(view.state)).toBe('active'))
    await listReady()
    acceptCompletion(view)
    expect(onpickcrossref).toHaveBeenCalledWith(expect.objectContaining({ kind: 'fig', number: 1 }), 4, 9)
    cleanup()
  })
})
