<script lang="ts">
  import { onMount } from 'svelte'
  import { EditorView, basicSetup } from 'codemirror'
  import { markdown } from '@codemirror/lang-markdown'
  import { Table } from '@lezer/markdown'
  import { languages } from '@codemirror/language-data'
  import { keymap, type Command } from '@codemirror/view'
  import { EditorState, Prec, Compartment, Transaction } from '@codemirror/state'
  import { HighlightStyle, syntaxHighlighting, syntaxTree, forceParsing } from '@codemirror/language'
  import { tags } from '@lezer/highlight'
  import type { SyntaxNode } from '@lezer/common'
  import { codeHighlightStyleSpecs } from './lib/syntaxTags'
  import { spellcheckExtension } from './lib/spellcheck'
  import { minimalChange } from './lib/textDiff'
  import { parseCaptionLine } from './lib/tableCaptions'
  import { fenceLanguage } from './lib/figures'
  import { citationCompletionSource, citationOptionClass, citationOptionTitle, type CitationContext } from './lib/citationCompletion'
  import { autocompletion, startCompletion, completionStatus } from '@codemirror/autocomplete'
  import { crossrefCompletionSource, crossrefOptionClass, crossrefOptionFormula, planReference, type ReferenceError } from './lib/crossrefCompletion'
  import type { CrossrefTarget } from './lib/crossrefs'
  import { citationHover, unknownKeyMarks, refreshCitationsEffect } from './lib/citationEditor'
  import { openSearchPanel, findNext, findPrevious } from '@codemirror/search'

  let {
    onchange,
    onformat,
    onscroll,
    onpasteimage,
    spellcheck = true,
    citations,
    crossrefs,
    onpickcrossref,
  }: {
    onchange: (text: string) => void
    onformat?: (name: string) => void
    onscroll?: () => void
    onpasteimage?: (file: Blob, type: string) => void
    spellcheck?: boolean
    citations?: () => CitationContext | null
    /** The targets of the last render, for the cross-reference list. */
    crossrefs?: () => CrossrefTarget[]
    /** A target without a label was chosen from the list; `[from, to)` is what it replaces. */
    onpickcrossref?: (target: CrossrefTarget, from: number, to: number) => void
  } = $props()

  // Menu accelerators normally win, because AppKit dispatches them before the
  // webview — but not for chords CodeMirror's defaultKeymap already claims with
  // preventDefault. basicSetup binds Mod-i (selectParentSyntax) and Shift-Mod-k
  // (deleteLine), so those two never reach menu.go and must be caught here.
  // Routed through onformat rather than the commands directly, so the welcome
  // screen guard in App.svelte stays the single decision point.
  const stolenChords = Prec.highest(
    keymap.of([
      {
        key: 'Mod-i',
        run: () => {
          if (!onformat) return false
          onformat('italic')
          return true
        },
      },
      {
        key: 'Mod-Shift-k',
        run: () => {
          if (!onformat) return false
          onformat('code')
          return true
        },
      },
    ]),
  )

  // Every colour is a CSS variable, so switching the app theme restyles the
  // editor with no reconfiguration — no Compartment, no dispatch, nothing to
  // get out of step. Verified: var() survives into the stylesheet CodeMirror
  // generates, and our rules are emitted after the base theme's, which is what
  // wins the specificity tie. `dark: true` is deliberately omitted; it only
  // adds a class for base `&dark` rules, all of which we override below.
  //
  // The win over the base theme is a precedence guarantee, not accidental
  // source order: EditorView.baseTheme wraps its style module in Prec.lowest,
  // and mountStyles mounts base themes first by contract, so an ordinary
  // EditorView.theme() like this one always lands after it. `&light` also
  // does not compile to a single class — e.g. `.ͼ2 .cm-selectionBackground`,
  // two classes, same as ours — so the two have equal specificity and this
  // precedence guarantee is what decides the tie, not source order per se.
  //
  // The live residual risk is not a future CodeMirror raising base-theme
  // specificity; the precedence guarantee makes that a non-issue. It is a
  // future extension listed after hermesTheme below that itself calls
  // EditorView.theme() — that would land after ours at equal precedence and
  // win. None of today's extensions do; watch for it if one is added.
  const hermesTheme = EditorView.theme({
    '&': { backgroundColor: 'var(--editor-bg)', color: 'var(--editor-fg)' },
    '.cm-content': { caretColor: 'var(--editor-caret)' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--editor-caret)' },
    '.cm-selectionBackground, &.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground':
      { backgroundColor: 'var(--editor-selection)' },
    '.cm-activeLine': { backgroundColor: 'var(--editor-active-line)' },
    '.cm-gutters': {
      backgroundColor: 'var(--editor-gutter-bg)',
      color: 'var(--editor-gutter-fg)',
      border: 'none',
    },
    '.cm-activeLineGutter': { backgroundColor: 'var(--editor-active-line)' },
    // basicSetup's searchKeymap installs a find/replace panel, opened by ⌘F
    // and by Edit → Find (see find() below), so the panel and its controls
    // need the same var() treatment as the document — otherwise they stay on the base theme's
    // `&light` rules and read as a light bar pinned to a dark editor.
    '.cm-panels': { backgroundColor: 'var(--editor-gutter-bg)', color: 'var(--editor-fg)' },
    '.cm-panels-top': { borderBottom: '1px solid var(--border)' },
    '.cm-panels-bottom': { borderTop: '1px solid var(--border)' },
    '.cm-textfield': {
      backgroundColor: 'var(--editor-bg)',
      color: 'var(--editor-fg)',
      border: '1px solid var(--border-strong)',
    },
    '.cm-button': {
      backgroundImage: 'none',
      backgroundColor: 'var(--editor-gutter-bg)',
      color: 'var(--editor-fg)',
      border: '1px solid var(--border-strong)',
    },
    '.cm-tooltip': {
      backgroundColor: 'var(--editor-gutter-bg)',
      color: 'var(--editor-fg)',
      border: '1px solid var(--border)',
    },
    '.cm-citation-tooltip': { maxWidth: '32em', padding: '4px 8px' },
    // The suggestion list. CodeMirror's base draws it in monospace with 1px
    // rows and a fixed blue selection; here it takes the app's font, room to
    // breathe and the palette's accent, for code completions too.
    '.cm-tooltip.cm-tooltip-autocomplete': { borderRadius: '6px', padding: '4px' },
    '.cm-tooltip.cm-tooltip-autocomplete > ul': {
      fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
      fontSize: '13px',
      minWidth: '320px',
      maxWidth: 'min(480px, 95vw)',
      maxHeight: '20em',
    },
    '.cm-tooltip-autocomplete > ul > li': { padding: '4px 8px', lineHeight: 1.4, borderRadius: '6px' },
    '.cm-tooltip-autocomplete ul li[aria-selected]': { background: 'var(--accent)', color: 'var(--on-accent)' },
    // A citation suggestion is two lines: the key and its author-year, then
    // the title. The type icon carries nothing here, so it is hidden.
    '.cm-tooltip-autocomplete > ul > li.cm-citation-option': {
      display: 'grid',
      gridTemplateColumns: 'auto minmax(0, 1fr)',
      columnGap: '12px',
      rowGap: '2px',
    },
    '.cm-citation-option .cm-completionIcon': { display: 'none' },
    '.cm-citation-option .cm-completionLabel': {
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      fontSize: '13px',
    },
    '.cm-citation-option .cm-completionDetail': {
      marginLeft: 0,
      fontStyle: 'normal',
      fontSize: '12px',
      textAlign: 'right',
      color: 'var(--muted)',
    },
    '.cm-citation-title': {
      gridColumn: '1 / -1',
      fontSize: '12px',
      color: 'var(--muted)',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
    },
    // A cross-reference suggestion: `Figure 2` and its caption, or an
    // equation's formula drawn small after it.
    '.cm-crossref-option .cm-completionIcon': { display: 'none' },
    '.cm-crossref-option .cm-completionDetail': { fontStyle: 'normal', color: 'var(--muted)' },
    '.cm-crossref-formula': { marginLeft: '12px', fontSize: '12px' },
    '.cm-tooltip-autocomplete ul li[aria-selected] .cm-completionDetail, .cm-tooltip-autocomplete ul li[aria-selected] .cm-citation-title':
      { color: 'var(--on-accent)' },
    '.cm-cite-unknown': { textDecoration: 'underline wavy var(--cite-error-fg)' },
    '.cm-specialChar': { color: 'var(--editor-gutter-fg)' },
    // CodeMirror's base theme hardcodes this pill as #eee on #ddd with #888
    // text — a light chip on a dark page. Same class of gap as the search
    // panel: a base rule the theme has to override to follow the palette.
    '.cm-foldPlaceholder': {
      backgroundColor: 'var(--surface)',
      border: '1px solid var(--border)',
      color: 'var(--muted)',
    },
  })

  // Markdown highlighting is modest by design — this is a writing tool.
  const hermesHighlight = HighlightStyle.define([
    { tag: tags.heading, color: 'var(--syn-heading)', fontWeight: 'bold' },
    { tag: tags.emphasis, color: 'var(--syn-emphasis)', fontStyle: 'italic' },
    { tag: tags.strong, color: 'var(--syn-emphasis)', fontWeight: 'bold' },
    { tag: tags.monospace, color: 'var(--syn-code)' },
    { tag: tags.link, color: 'var(--syn-link)' },
    { tag: tags.url, color: 'var(--syn-link)' },
    { tag: tags.quote, color: 'var(--syn-quote)' },
    { tag: tags.meta, color: 'var(--syn-meta)' },
    // Code tokens, from the table both panes share. Comments arrive through
    // it too, carrying the --syn-meta colour above.
    ...codeHighlightStyleSpecs(),
  ])

  // The one Compartment in this editor. The theme needs none (see above);
  // spell checking does, because it is a facet value and a decoration set,
  // not a stylesheet, and View → Check Spelling flips it at runtime.
  const spellcheckCompartment = new Compartment()
  const spellcheckFor = (on: boolean) => (on ? spellcheckExtension() : [])

  let host: HTMLElement
  let view: EditorView

  // The two callers need different cursor placement, not one compromise:
  // File → New wants the cursor at the end so typing continues below the
  // frontmatter, but opening an existing file must leave it at the start —
  // anywhere else silently relocates where ⌘⇧C and the Format-menu commands
  // act on a freshly opened document. Do not "simplify" this back to one
  // behaviour; 'start' is also the default so every other/future caller gets
  // the safe behaviour without having to know about this distinction.
  export function setContent(text: string, cursor: 'start' | 'end' = 'start'): void {
    // A fresh state, not a transaction. basicSetup bundles history(), so
    // dispatching the replacement left it sitting on the undo stack: ⌘Z after
    // File → New restored the PREVIOUS document's text while App.svelte's
    // `path` was already null, and the next ⌘S wrote that old content into a
    // brand new file. A new state has no history to undo into — which is the
    // honest model regardless, since this is a different document rather than
    // an edit to the current one. It also discards the scroll position and
    // any open find panel, both of which belonged to the old document.
    view.setState(
      EditorState.create({
        doc: text,
        selection: { anchor: cursor === 'end' ? text.length : 0 },
        extensions: editorExtensions(),
      }),
    )
    // setState swaps the state wholesale instead of applying a transaction,
    // so the updateListener never sees docChanged and no caller would learn
    // the document had changed. Report it here instead.
    onchange(text)
    // Only the end-of-document placement (File → New) should steal focus:
    // that is the path where the user is about to type. Opening a file must
    // not steal focus, since that is not current behaviour and was not asked
    // for.
    if (cursor === 'end') view.focus()
  }

  /**
   * Applies new text for the SAME document (the file changed on disk) as one
   * minimal change, so the cursor, scroll position, find panel and undo
   * history survive; `setContent` is for a different document. `undoable`
   * says whether ⌘Z may take the reload back: true when the user's own edits
   * were replaced, false when the reload only brings in what they never had.
   * Does not scroll or focus. `onchange` fires through the update listener.
   */
  export function reloadContent(text: string, undoable: boolean): void {
    const change = minimalChange(view.state.doc.toString(), text)
    if (!change) return
    view.dispatch({ changes: change, annotations: Transaction.addToHistory.of(undoable) })
  }

  export function insertAtCursor(text: string): void {
    view.dispatch(view.state.replaceSelection(text))
    view.focus()
  }

  /**
   * Inserts an image link for a file already written beside the document and
   * leaves the cursor between the brackets, ready for the alt text.
   */
  export function insertImageLink(relPath: string): void {
    const from = view.state.selection.main.from
    view.dispatch({
      ...view.state.replaceSelection(`![](${relPath})`),
      selection: { anchor: from + 2 },
    })
    view.focus()
  }

  /**
   * Inserts text as its own block, guaranteeing it starts on a fresh line.
   *
   * insertAtCursor is deliberately raw — a citation belongs mid-sentence. A
   * fenced block does not: written at a column other than 0 it is not a fence
   * at all, markdown renders its contents as prose, and the syntax tree will
   * not recognise it, so the builder cannot reopen what it just wrote.
   *
   * A selection is kept and the block goes after it. This was built on
   * replaceSelection, which deletes the selection — so selecting a paragraph
   * and inserting a chart silently destroyed the paragraph. Unlike
   * insertCodeBlockAtCursor there is no wrapping to be done instead: a
   * vega-lite fence holds JSON, and prose inside it is a broken chart, not a
   * captioned one. So the selection is simply not the target.
   */
  export function insertBlockAtCursor(text: string): void {
    // The end of the selection, not its start: that is where the block is
    // going, and the fresh-line check has to be asked about the same position
    // the insertion happens at. (Not `head` either — for a backward selection
    // the head is the start.)
    const at = view.state.selection.main.to
    const line = view.state.doc.lineAt(at)
    const prefix = at === line.from ? '' : '\n\n'
    view.dispatch({
      changes: { from: at, insert: prefix + text },
      // Explicit, because a bare `changes` maps the existing selection through
      // the insertion and would leave the author's prose selected — one
      // keystroke from deleting what this fix exists to preserve.
      selection: { anchor: at + prefix.length + text.length },
    })
    view.focus()
  }

  /**
   * Writes a fenced code block and leaves the cursor *inside* it.
   *
   * insertBlockAtCursor leaves the cursor after the text it inserted, which
   * for a fence strands the author below it needing two arrow keys to get in
   * — barely better than typing the backticks. This one places the selection
   * on the body line instead, which is the part that makes the menu route
   * worth having.
   *
   * A selection is wrapped, not replaced. replaceSelection (what
   * insertBlockAtCursor uses) would delete it, and an author who selected
   * three lines and reached for this menu means "wrap these". The selected
   * text is reused verbatim — no trimming, no re-indentation — and stays
   * selected afterwards.
   */
  export function insertCodeBlockAtCursor(language: string): void {
    const { from, to } = view.state.selection.main
    const line = view.state.doc.lineAt(from)
    // Same fresh-line guarantee, and the same reason, as insertBlockAtCursor:
    // at a column other than 0 this is not a fence at all.
    const prefix = from === line.from ? '' : '\n\n'
    const body = view.state.doc.sliceString(from, to)
    const open = '```' + language + '\n'
    // The trailing newline keeps whatever followed the insertion point off
    // the closing fence's line, which would otherwise break the fence.
    const text = prefix + open + body + '\n```\n'
    const bodyFrom = from + prefix.length + open.length
    view.dispatch({
      changes: { from, to, insert: text },
      // Collapsed onto the empty line when there was no selection; spanning
      // the wrapped text when there was.
      selection: { anchor: bodyFrom, head: bodyFrom + body.length },
    })
    view.focus()
  }

  /**
   * Whether the document, right after the cursor, is already blank there — an
   * empty document tail or a line break followed by nothing but whitespace
   * before the next non-blank line, treated loosely here as "starts with a
   * newline" since that is the only case callers need to distinguish.
   *
   * This exists for callers inserting a block that, unlike a fenced code
   * block, does not terminate itself: a table's last row keeps absorbing
   * whatever text follows it until a blank line breaks the block, so a caller
   * that always appends a blind `'\n\n'` separator would triple up against an
   * existing blank line, and one that always appends a single `'\n'` would
   * fuse the table into the next paragraph (see insertBlockAtCursor's
   * commitTable caller in App.svelte). Checking first lets the caller pick.
   */
  export function isFollowedByBlankLine(): boolean {
    const at = view.state.selection.main.to
    const rest = view.state.doc.sliceString(at, view.state.doc.length)
    return rest.length === 0 || rest.startsWith('\n')
  }

  /**
   * Runs an editor command. Typed `Command` rather than `StateCommand` because
   * CodeMirror's fold commands need the view — and a `StateCommand` works when
   * handed a view too, so this one signature serves both kinds.
   */
  export function runCommand(cmd: Command): void {
    cmd(view)
    view.focus()
  }

  /**
   * Edit → Find (#18). The panel is basicSetup's own, the one ⌘F already
   * opens with the editor focused; the menu makes it reachable from anywhere
   * in the window. Focus moves to the editor first because the commands act
   * on, and the panel opens in, the focused view.
   */
  export function find(cmd: 'open' | 'replace' | 'next' | 'previous'): boolean {
    view.focus()
    if (cmd === 'next') return findNext(view)
    if (cmd === 'previous') return findPrevious(view)
    const opened = openSearchPanel(view)
    if (cmd === 'replace') {
      view.dom.querySelector<HTMLInputElement>('.cm-search [name=replace]')?.focus()
    }
    return opened
  }

  /** Re-evaluate citation marks after the bibliography changed. */
  export function refreshCitations(): void {
    view?.dispatch({ effects: refreshCitationsEffect.of(null) })
  }

  /** Total lines in the document, for mapping against the preview's extent. */
  export function lineCount(): number {
    return view.state.doc.lines
  }

  /**
   * Put the cursor at the start of a 1-based line, scroll it into view and
   * take focus — what clicking an outline entry does. Out-of-range lines
   * clamp rather than throw: the outline was built from a render that may be
   * a keystroke behind the document.
   */
  export function goToLine(line: number): void {
    const n = Math.min(Math.max(1, line), view.state.doc.lines)
    const pos = view.state.doc.line(n).from
    view.dispatch({
      selection: { anchor: pos },
      effects: EditorView.scrollIntoView(pos, { y: 'start', yMargin: 24 }),
    })
    view.focus()
  }

  /**
   * The 1-based line at the top of the visible editor area.
   *
   * Resolved through posAtCoords at the scroller's top-left corner rather than
   * arithmetic on scrollTop, which keeps everything in one coordinate space
   * instead of reconciling documentTop against documentPadding. A null result
   * means the point is outside the content — treat that as the top.
   */
  export function topVisibleLine(): number {
    const rect = view.scrollDOM.getBoundingClientRect()
    const pos = view.posAtCoords({ x: rect.left + 1, y: rect.top + 1 })
    if (pos == null) return 1
    return view.state.doc.lineAt(pos).number
  }

  export interface ChartBlock {
    from: number
    to: number
    spec: string
    /** The opening fence's whole info string, trimmed: `vega-lite {#fig:id}` when labelled. */
    info: string
  }

  /**
   * The `vega-lite` fenced block containing the cursor, or null.
   *
   * Two things here are load-bearing and were established by measurement:
   *
   * 1. forceParsing first. CodeMirror parses only the first ~3000 characters
   *    synchronously, so a chart late in a long paper is invisible to the tree
   *    until parsing is forced — the same trap that made late fences fail to
   *    fold in v0.5.
   * 2. Both sides. resolveInner(pos, 0) misses BOTH the exact start of the
   *    opening fence and the exact end of the closing fence, and each is an
   *    ordinary place to leave a cursor. side=1 reaches the first, side=-1 the
   *    second, so try them in that order.
   */
  export function enclosingChartBlock(): ChartBlock | null {
    forceParsing(view, view.state.doc.length, 5000)
    const tree = syntaxTree(view.state)
    const pos = view.state.selection.main.head

    for (const side of [1, -1] as const) {
      let node: SyntaxNode | null = tree.resolveInner(pos, side)
      while (node && node.name !== 'FencedCode') node = node.parent
      if (!node) continue

      let info = ''
      let bodyFrom = -1
      let bodyTo = -1
      for (let c = node.firstChild; c; c = c.nextSibling) {
        if (c.name === 'CodeInfo') info = view.state.doc.sliceString(c.from, c.to)
        // An empty block has no CodeText child at all, hence the -1 default.
        if (c.name === 'CodeText') {
          bodyFrom = c.from
          bodyTo = c.to
        }
      }
      if (fenceLanguage(info.trim()) !== 'vega-lite') continue

      return {
        from: node.from,
        to: node.to,
        spec: bodyFrom >= 0 ? view.state.doc.sliceString(bodyFrom, bodyTo) : '',
        info: info.trim(),
      }
    }
    return null
  }

  export interface TableBlock {
    from: number
    to: number
    /** Where the table itself ends, before any caption. */
    tableTo: number
    text: string
    /** The `: Caption {#tbl:id}` paragraph after the table, whose text `to` and `text` include. */
    caption: { caption: string; label: string | null } | null
  }

  /**
   * The GFM table containing the cursor, or null. A table's caption is the
   * paragraph `: Caption {#tbl:id}` one blank line after it; when there is
   * one, `to` and `text` run on to the end of it, and a cursor on the caption
   * counts as being in the table.
   *
   * Same two load-bearing details as enclosingChartBlock, for the same
   * reasons: forceParsing first, because a table late in a long paper is not
   * in the tree until parsing is forced; and resolveInner on both sides, so
   * a cursor at the exact start or exact end of the table still counts.
   * `markdown()` defaults to plain CommonMark, which has no table syntax at
   * all — `Table` only exists in the tree because editorExtensions() passes
   * `extensions: [Table]` (from `@lezer/markdown`) to `markdown()` below.
   */
  export function enclosingTable(): TableBlock | null {
    forceParsing(view, view.state.doc.length, 5000)
    const tree = syntaxTree(view.state)
    const doc = view.state.doc
    const pos = view.state.selection.main.head

    let table: SyntaxNode | null = null
    for (const side of [1, -1] as const) {
      let node: SyntaxNode | null = tree.resolveInner(pos, side)
      while (node && node.name !== 'Table') node = node.parent
      if (node) {
        table = node
        break
      }
    }
    if (!table) table = tableCaptionedAt(pos)
    if (!table) return null

    let to = table.to
    let caption: TableBlock['caption'] = null
    // The caption is the Paragraph node after the table with at most one
    // blank line between, the preview's own rule: a heading, fence, list or
    // quote on the next line ends the paragraph, and stays outside the range.
    const para = table.nextSibling
    if (para?.name === 'Paragraph' && doc.lineAt(para.from).number - doc.lineAt(table.to).number <= 2) {
      const lines = doc.sliceString(para.from, para.to).split('\n').map((l) => l.trim())
      if (parseCaptionLine(lines[0])) {
        caption = parseCaptionLine(lines.join(' '))
        if (caption) to = para.to
      }
    }
    return { from: table.from, to, tableTo: table.to, text: doc.sliceString(table.from, to), caption }
  }

  /**
   * The Table node whose caption paragraph holds `pos`, or null: walk up to
   * the paragraph's first line, which must be a caption line, and look past
   * at most one blank line for the table that ends there.
   */
  function tableCaptionedAt(pos: number): SyntaxNode | null {
    const doc = view.state.doc
    let line = doc.lineAt(pos)
    if (line.text.trim() === '') return null
    while (line.number > 1 && doc.line(line.number - 1).text.trim() !== '') line = doc.line(line.number - 1)
    if (!parseCaptionLine(line.text)) return null
    let above = line.number - 1
    if (above >= 1 && doc.line(above).text.trim() === '') above--
    if (above < 1) return null
    let node: SyntaxNode | null = syntaxTree(view.state).resolveInner(doc.line(above).to, -1)
    while (node && node.name !== 'Table') node = node.parent
    // Directly above the caption: a table that ends earlier is not its table.
    return node && node.to === doc.line(above).to ? node : null
  }

  /**
   * The document text between two positions, or '' if the range does not fit
   * inside the current document. Callers use the empty result as "this range
   * is no longer meaningful" rather than risking an out-of-bounds exception —
   * a range captured before the document changed underneath it (e.g. a chart
   * block's position, stashed while a modal was open) cannot be trusted to
   * still be in bounds.
   */
  export function textInRange(from: number, to: number): string {
    const len = view.state.doc.length
    if (from < 0 || to > len || from > to) return ''
    return view.state.doc.sliceString(from, to)
  }

  /**
   * Applies an edit without touching focus; the selection is mapped through
   * it, so a writer's caret stays in their text. One undo step.
   */
  export function applyChange(from: number, to: number, text: string): void {
    view.dispatch({ changes: { from, to, insert: text } })
  }

  /** Replaces a document range, leaving the cursor after the inserted text. */
  export function replaceRange(from: number, to: number, text: string): void {
    view.dispatch({
      changes: { from, to, insert: text },
      selection: { anchor: from + text.length },
    })
    view.focus()
  }

  // True from Insert → Cross-reference… until its list closes: the source then
  // lists every kind at the cursor rather than waiting for `@fig:`.
  let crossrefAllKinds = false

  /** Opens the cross-reference list at the cursor, every kind in it. */
  export function openCrossrefList(): void {
    crossrefAllKinds = true
    view.focus()
    startCompletion(view)
  }

  /**
   * Refers to `target` from `[from, to)`, writing its label first if it has
   * none (an equation's from `eqName`). One transaction, so one undo step;
   * the caret ends after the reference. Anything but 'ok' changed nothing.
   */
  export function applyReference(
    target: CrossrefTarget,
    from: number,
    to: number,
    eqName?: string,
  ): 'ok' | ReferenceError {
    const len = view.state.doc.length
    if (from < 0 || to > len || from > to) return 'moved'
    const plan = planReference(view.state.doc.toString(), target, from, to, eqName)
    if ('error' in plan) return plan.error
    const changes = view.state.changes(plan.changes)
    view.dispatch({
      changes,
      selection: { anchor: changes.mapPos(to, 1) },
      userEvent: 'input.complete',
      scrollIntoView: true,
    })
    view.focus()
    return 'ok'
  }

  /**
   * The editor's full extension set.
   *
   * A function rather than an inline array because `setContent` rebuilds the
   * state from scratch to drop the undo history, and needs the same
   * extensions to build it with.
   */
  const citationSource = citationCompletionSource(() => citations?.() ?? null)
  const crossrefSource = crossrefCompletionSource(
    () => crossrefs?.() ?? [],
    () => crossrefAllKinds,
    (t, from, to) => onpickcrossref?.(t, from, to),
  )

  function editorExtensions() {
    return [
      stolenChords,
      basicSetup,
      hermesTheme,
      syntaxHighlighting(hermesHighlight),
      markdown({ codeLanguages: languages, extensions: [Table] }),
      EditorView.lineWrapping,
      spellcheckCompartment.of(spellcheckFor(spellcheck)),
      // basicSetup already installs autocompletion() and its keymap; a source
      // is added through language data so there is only one of each.
      // One object per source: an array under one `autocomplete` key would be
      // read as a list of completions, not of sources.
      EditorState.languageData.of(() => [{ autocomplete: citationSource }, { autocomplete: crossrefSource }]),
      // Extra options for that same autocompletion() (its config facet
      // merges): citation rows get a class and a title line of their own,
      // cross-reference rows a class and an equation's formula.
      autocompletion({
        optionClass: (c) => citationOptionClass(c) || crossrefOptionClass(c),
        addToOptions: [citationOptionTitle, crossrefOptionFormula],
      }),
      // The menu's list is over once it closes, however it closed.
      EditorView.updateListener.of((u) => {
        if (crossrefAllKinds && completionStatus(u.state) === null && completionStatus(u.startState) !== null) {
          crossrefAllKinds = false
        }
      }),
      citationHover(() => citations?.() ?? null),
      unknownKeyMarks(() => citations?.() ?? null),
      // A clipboard holding an image and no text is a screenshot or a copied
      // picture. With text alongside (a copy from a web page or Word) the
      // normal text paste is what the user wants, so it is left alone.
      EditorView.domEventHandlers({
        paste(event) {
          const data = event.clipboardData
          if (!onpasteimage || !data || data.types.includes('text/plain')) return false
          for (const item of Array.from(data.items)) {
            if (item.kind !== 'file' || !item.type.startsWith('image/')) continue
            const file = item.getAsFile()
            if (!file) continue
            event.preventDefault()
            onpasteimage(file, item.type)
            return true
          }
          return false
        },
      }),
      EditorView.updateListener.of((u) => {
        if (u.docChanged) onchange(u.state.doc.toString())
      }),
    ]
  }

  onMount(() => {
    view = new EditorView({
      parent: host,
      extensions: editorExtensions(),
    })
    const onScrollDOM = () => onscroll?.()
    view.scrollDOM.addEventListener('scroll', onScrollDOM, { passive: true })
    return () => {
      view.scrollDOM.removeEventListener('scroll', onScrollDOM)
      view.destroy()
    }
  })

  $effect(() => {
    const on = spellcheck
    if (!view) return
    view.dispatch({ effects: spellcheckCompartment.reconfigure(spellcheckFor(on)) })
  })
</script>

<div class="editor-host" bind:this={host}></div>
