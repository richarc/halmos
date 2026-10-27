<script lang="ts">
  import { onMount, untrack, flushSync } from 'svelte'
  import { Events, Browser } from '@wailsio/runtime'
  import { DocumentService, DemoService, PortalService } from '../bindings/hermes'
  import type {
    Settings, Draft, UpdateResult, WelcomeInfo, AccountInfo, PortalError, ConvertRequest,
  } from '../bindings/hermes/models'
  import ConnectDialog, { type ConnectState } from './ConnectDialog.svelte'
  import AccountDialog from './AccountDialog.svelte'
  import {
    planImages, finalizeImages, checkRequest, buildBibliography, withReferencesHeading,
    type ExportFormat, type ResolvedImage, type ConvertBody,
  } from './lib/exportRequest'
  import { diagramImages, replaceDiagramFences } from './lib/exportDiagrams'
  import { abstractReferencesForExport, labelForExport } from './lib/exportCrossrefs'
  import { authorsForExport } from './lib/exportMetadata'
  import { toPng } from './lib/rasterise'
  import { messageFor, problemMessage } from './lib/portalMessages'
  import Editor from './Editor.svelte'
  import Preview from './Preview.svelte'
  import { bodyFontStack } from './lib/bodyFont'
  import { renderDocument, type RenderOptions } from './lib/renderer'
  import { timed } from './lib/perf'
  import { type OutlineEntry } from './lib/outline'
  import Outline from './Outline.svelte'
  import { debounce } from './lib/debounce'
  import { splitRecent } from './lib/recentPath'
  import { createAdaptiveWait } from './lib/adaptiveWait'
  import { runDemo, type DemoActions } from './lib/demo'
  import { createDraftKeeper, DRAFT_DEBOUNCE_MS } from './lib/recoveryDraft'
  import {
    NEW_DOCUMENT_TEMPLATE,
    BIBLIOGRAPHY_SEED,
    newDocumentText,
    titleSelection,
    type StarterId,
    bibliographyReference,
  } from './lib/documentTemplate'
  import NewDocument, { type BibliographyChoice } from './NewDocument.svelte'
  import { parseFrontmatter, frontmatterKeyChange } from './lib/frontmatter'
  import { pageFurniture } from './lib/pageFurniture'
  import { type CSLEntry } from './lib/bibliography'
  import { createBibParser } from './lib/bibLoader'
  import type { CitationContext } from './lib/citationCompletion'
  import { resolveTheme, applyTheme, type ThemeSetting } from './lib/theme'
  import { createCitationFormatter, isStyleFile, loadStyleXml, STYLE_IDS, type CitationFormatter } from './lib/citations'
  import {
    unresolvedInsertionMessage,
    unsavedBibliographyMessage,
  } from './lib/citationFeedback'
  import type { StateCommand } from '@codemirror/state'
  import {
    toggleHeading,
    toggleBulletList,
    toggleOrderedList,
    toggleBlockquote,
    toggleBold,
    toggleItalic,
    toggleInlineCode,
    toggleStrikethrough,
  } from './lib/markdownCommands'
  import { foldCode, unfoldCode, unfoldAll } from '@codemirror/language'
  import type { Command } from '@codemirror/view'
  import { foldAllCodeBlocks } from './lib/foldCommands'
  import ChartBuilder from './ChartBuilder.svelte'
  import TableBuilder from './TableBuilder.svelte'
  import { parsePipeTable, serializePipeTable, type PipeTable } from './lib/pipeTable'
  import Dialog from './Dialog.svelte'
  import UnknownCitations from './UnknownCitations.svelte'
  import EquationName, { type NameError } from './EquationName.svelte'
  import { KIND_WORD, type CrossrefTarget } from './lib/crossrefs'
  import { pickable } from './lib/crossrefCompletion'
  import { shadowedKeys } from './lib/citationCompletion'
  import { unknownCitations } from './lib/citationKeys'
  import { readSpec, type BuilderState } from './lib/chartSpec'
  import { refusalMessage } from './lib/chartLabels'
  import type { ChartWidth, FigureAlignment } from './lib/figures'
  import {
    DEFAULT_PAPER_SIZE,
    DEFAULT_ORIENTATION,
    type PaperSize,
    type PageOrientation,
  } from './lib/paper'

  let path = $state<string | null>(null)
  let content = $state('')
  let savedContent = $state('')
  let html = $state('')
  let recents = $state<string[]>([])
  // The start screen's version line and the home folder its recent files
  // shorten to ~. Empty until Go answers, and for an unbundled build.
  let welcomeInfo = $state<WelcomeInfo>({ version: '', home: '' })
  const welcomeRecents = $derived(recents.map((r) => ({ path: r, ...splitRecent(r, welcomeInfo.home) })))
  let pendingAction = $state<'quit' | 'close' | 'open' | 'new' | null>(null)
  let pendingRecentPath = $state<string | null>(null)
  let welcomeDismissed = $state(false)
  let toastMsg = $state('')
  // A toast may carry one button, such as Show in Finder after an export.
  let toastAction = $state<{ label: string; run: () => void } | null>(null)
  // Connecting to the Halmos portal and exporting through it. pendingExport
  // is the export a connection was started for, resumed once it is approved.
  let connectState = $state<ConnectState | null>(null)
  let pendingExport = $state<ExportFormat | null>(null)
  let accountOpen = $state(false)
  let account = $state<AccountInfo | null>(null)
  let accountProblem = $state('')
  let portalAlert = $state<{ text: string; button: string; url: string } | null>(null)
  let editorWidth = $state(50)
  let editor: ReturnType<typeof Editor>
  let preview: ReturnType<typeof Preview>
  let syncScrolling = $state(false)
  let showOutline = $state(false)
  let outline = $state<OutlineEntry[]>([])

  let autoSave = $state(true)
  // A draft found on open (or the untitled one at launch), awaiting the
  // user's Restore / Discard Draft. Null when no dialog is up. `key` is the
  // docPath it was offered for, captured up front so Discard Draft still
  // targets the right draft after dismissRecovery has cleared `recovery`.
  // `changed` means another program changed the file after the draft's
  // edits began, which the dialog says.
  let recovery = $state<{ key: string; content: string; changed: boolean } | null>(null)
  // Another program changed the open document while it had unsaved edits
  // here, awaiting Keep Mine / Use File. A later change replaces it, so the
  // answer always applies to the newest version on disk.
  let diskChange = $state<{ version: string; content: string } | null>(null)
  // A Save that found the file changed on disk, awaiting Overwrite / Cancel.
  // Holds the resolver of askOverwrite's promise; null when no dialog is up.
  let overwriteAnswer = $state<((overwrite: boolean) => void) | null>(null)
  // Another program deleted the open document. The text stays open and
  // counts as unsaved, so quitting asks and drafts keep being written; Save
  // recreates the file.
  let diskGone = $state(false)
  // One toast per document for a failing draft write: a toast every two
  // seconds while typing would be worse than no insurance.
  let draftWriteWarned = false

  type UpdateCheckSetting = 'unasked' | 'on' | 'off'
  let updateCheck = $state<UpdateCheckSetting>('unasked')
  // The first-launch question; true only until it has been answered once.
  let askUpdates = $state(false)
  let zoteroHelp = $state<'not-running' | 'no-better-bibtex' | null>(null)
  // A newer version, awaiting Later / View Release. Null when no dialog is up.
  let updateNotice = $state<UpdateResult | null>(null)
  let spellCheck = $state(true)

  // The keeper decides when a draft is written and discarded; recovery.go
  // decides whether one is worth offering back. Go's own errors are
  // reported here, once, because the keeper swallows them by design.
  const drafts = createDraftKeeper(
    {
      write: (docPath, text) =>
        DocumentService.WriteDraft(docPath, text).catch((err) => {
          if (draftWriteWarned) return
          draftWriteWarned = true
          toast(`Could not write a recovery draft: ${err}`)
        }),
      discard: (docPath) =>
        DocumentService.DiscardDraft(docPath).catch((err) => console.warn('DiscardDraft:', err)),
    },
    DRAFT_DEBOUNCE_MS,
  )

  // Every render feeds both the preview and the outline; one function so a
  // call site cannot update one and leave the other a document behind.
  function renderInto(text: string) {
    const opts: RenderOptions = { formatter, chartWidth, docPath: path }
    // `hermes:render` in Web Inspector: markdown-it, KaTeX, citeproc — the
    // JS half of a preview update. The DOM half is `hermes:preview-dom`.
    const result = timed('render', () => renderDocument(text, opts))
    html = result.html
    outline = result.outline
    crossrefTargets = result.crossrefs.targets
    // Missing references and labels used twice share the status-bar count
    // and the dialog, in line order, each shown as it is written.
    const { missing, duplicates } = result.crossrefs
    const problems = [
      ...missing.map((m) => ({ key: `@${m.key}`, line: m.line })),
      ...duplicates.map((d) => ({ key: `{#${d.key}} used twice`, line: d.line })),
    ].sort((a, b) => a.line - b.line)
    missingRefs = problems
    duplicateLabels = duplicates.length > 0
    if (problems.length === 0) missingOpen = false
  }

  // The last render's cross-reference targets, read by the editor's list when
  // it opens. Not reactive: nothing redraws when they change.
  let crossrefTargets: CrossrefTarget[] = []

  // References whose label no figure, table or equation has, and labels a
  // second target repeats, from the last render, so no extra parse is needed.
  let missingRefs = $state<{ key: string; line: number }[]>([])
  let duplicateLabels = $state(false)
  const missingCount = $derived(
    `${missingRefs.length} ${duplicateLabels ? 'cross-reference problem' : 'missing cross-reference'}` +
      (missingRefs.length === 1 ? '' : 's'),
  )
  let missingOpen = $state(false)
  function jumpToMissing(line: number) {
    missingOpen = false
    jumpToLine(line)
  }

  // The panel's own arrows. The View menu owns the same setting, so this is a
  // read-modify-write of the whole value — the menu only ever changes the
  // field it owns, and so does this.
  async function setOutlineShown(shown: boolean) {
    try {
      const current: Settings = await DocumentService.Settings()
      await DocumentService.UpdateSettings({ ...current, showOutline: shown })
    } catch (err) {
      toast(`Could not save outline visibility: ${err}`)
    }
  }

  // An explicit jump moves both panes, whatever Sync Scrolling says: the
  // author chose that heading, and following is a different thing from
  // being taken there.
  function jumpToLine(line: number) {
    editor.goToLine(line)
    preview.syncToLine(line, editor.lineCount())
  }
  let themeSetting = $state<ThemeSetting>('system')
  let chartWidth = $state<ChartWidth>('medium')
  let figureAlign = $state<FigureAlignment>('centre')
  let paperSize = $state<PaperSize>(DEFAULT_PAPER_SIZE)
  let bodyFont = $state('new-york')
  let orientation = $state<PageOrientation>(DEFAULT_ORIENTATION)
  let systemPrefersDark = $state(false)
  let scrollFrame: number | null = null
  let toastTimer: ReturnType<typeof setTimeout>
  let formatter = $state<CitationFormatter | undefined>(undefined)
  let bibEntries = $state.raw<CSLEntry[]>([])
  // Guards against a stale ReadBibliography response landing after a newer
  // request (e.g. rapid frontmatter edits or back-to-back bib:changed
  // events): each call captures its generation and bails after every await
  // if a later call has since started, so the latest call always wins.
  let reloadGeneration = 0

  const fm = $derived(parseFrontmatter(content))
  // Svelte's $derived always treats an object return value as "changed" on
  // recomputation (safe_not_equal short-circuits true for objects), so an
  // effect reading fm.bibliography/fm.csl directly would rerun on every
  // keystroke, not just when those fields actually change — since content
  // (and therefore fm) changes on every keystroke. Deriving the primitive
  // fields separately lets each one's own equality check (plain !==) gate
  // correctly, so the reload effect below only fires on a real change.
  const fmBibliography = $derived(fm.bibliography)
  const citationContext = $derived<CitationContext | null>(
    formatter && fmBibliography
      ? { entries: bibEntries, has: (k) => formatter!.has(k), reference: (k) => formatter!.reference(k), bibName: fmBibliography }
      : null,
  )
  const fmCsl = $derived(fm.csl)

  // Format → Citation Style ticks the current style; tell Go whenever it
  // changes (including on open and close, where content changes under it).
  $effect(() => {
    void DocumentService.SetCitationStyle(fmCsl ?? 'apa')
  })

  // Citation keys the bibliography does not have. unknownCitations parses the
  // whole document, so this is never run per keystroke: debounced on text
  // change, immediate when the formatter (or the bibliography name) changes.
  let unknown = $state<{ key: string; line: number }[]>([])
  let unknownOpen = $state(false)
  function recountUnknown(text: string) {
    const f = formatter
    unknown = f && fmBibliography ? unknownCitations(text, (k) => f.has(k)) : []
    if (unknown.length === 0) unknownOpen = false
  }
  const recountUnknownSoon = debounce(recountUnknown, 300)
  $effect(() => {
    void formatter
    void fmBibliography
    recountUnknownSoon.cancel()
    untrack(() => recountUnknown(content))
  })
  function jumpToUnknown(line: number) {
    unknownOpen = false
    jumpToLine(line)
  }

  // The wait follows the cost of the last update: twice the measured time,
  // between 60 and 300 ms, starting at 100 until the first measurement. The
  // measurement takes in the preview's DOM work as well as the render —
  // flushSync runs the effect that reconciles the sheet here rather than in
  // the microtask Svelte would otherwise use — so a chart-heavy document
  // that is cheap to render but dear to lay out is still waited for.
  //
  // The wait alone is trailing-edge: keystrokes arriving faster than it
  // reset it every time, and the preview shows nothing until they stop. A
  // fast typist gets there in bursts; the demo player (lib/demo.ts) types
  // at a fixed cadence with no pauses at all and starved the preview for a
  // whole paragraph. The maximum wait, four times the current wait, bounds
  // that: during continuous typing the preview still updates, and since the
  // wait is twice the last update's cost, those updates take at most about
  // an eighth of the time.
  const previewWait = createAdaptiveWait({ initial: 100, min: 60, max: 300, factor: 2 })
  const updatePreview = debounce(
    (text: string) => {
      const start = performance.now()
      renderInto(text)
      flushSync()
      previewWait.record(performance.now() - start)
    },
    previewWait.wait,
    () => previewWait.wait() * 4,
  )

  const filename = $derived(path ? path.split('/').pop() : 'Untitled')
  // Dirty means "differs from what's on disk" — typing back to the saved
  // text (or emptying a never-saved doc) clears it again. A deleted file
  // differs from a disk that no longer holds it.
  const dirty = $derived(content !== savedContent || diskGone)

  // Keep the Go side (window-close hook) in sync with the derived flag.
  $effect(() => {
    void DocumentService.SetDirty(dirty)
  })

  // Every input the keeper cares about, in one place. `path ?? ''` is the
  // untitled key on the Go side.
  $effect(() => {
    drafts.update(path ?? '', content, dirty, autoSave)
  })
  const showWelcome = $derived(
    !welcomeDismissed && path === null && content === '' && recents.length > 0,
  )

  function toast(msg: string, action: { label: string; run: () => void } | null = null) {
    toastMsg = msg
    toastAction = action
    clearTimeout(toastTimer)
    // Longer with a button, so there is time to reach it.
    toastTimer = setTimeout(() => {
      toastMsg = ''
      toastAction = null
    }, action ? 8000 : 4000)
  }

  // Reload the bibliography when the document's frontmatter changes it,
  // when the document path changes, or on bib:changed from the watcher.
  // Parses .bib text in a Web Worker and keeps the last result (bibLoader.ts).
  const bibParser = createBibParser()
  // What the current formatter was built from, so a reload that finds the
  // same text and style keeps it. Null when there is nothing to keep.
  let loadedBib: { text: string; csl: string; xml: string | null } | null = null

  // The keys last warned about, so a reload of the same bibliography does not
  // repeat the warning. Emptied when none are left, so they can warn again.
  let warnedShadowed = ''
  function warnShadowed(keys: string[]) {
    const set = [...keys].sort().join('\n')
    if (set === warnedShadowed) return
    warnedShadowed = set
    if (keys.length === 0) return
    const shown = keys.slice(0, 5).join(', ')
    const more = keys.length > 5 ? ` and ${keys.length - 5} more` : ''
    toast(
      `These references can't be cited because their keys look like cross-references (fig:, tbl:, eq:, sec:): ${shown}${more}. Rename them in your reference manager.`,
    )
  }

  async function reloadBibliography() {
    const gen = ++reloadGeneration
    const wanted = fmBibliography ?? null
    if (!wanted || !path) {
      formatter = undefined
      bibEntries = []
      loadedBib = null
      // A named bibliography resolves relative to the document, so an unsaved
      // document cannot load one. Say so rather than failing silently.
      const styleFile = fmCsl && isStyleFile(fmCsl) ? fmCsl : undefined
      const unsaved = unsavedBibliographyMessage(wanted ?? undefined, path ?? null)
      // One toast: a second would replace the first. A style file is named
      // too, since it resolves against the saved document just as the .bib does.
      if (unsaved) toast(styleFile ? `${unsaved} and ${styleFile}` : unsaved)
      else if (styleFile && !path) toast(`Save the document to load ${styleFile}`)
      void DocumentService.WatchBibliography('', path ?? '')
      return
    }
    try {
      const text = await DocumentService.ReadBibliography(wanted, path)
      if (gen !== reloadGeneration) return // superseded by a newer request
      const csl = fmCsl ?? 'apa'
      // A style file resolves relative to the document, like the bibliography.
      // A failure to read it falls back to APA below, never to no citations.
      let xml: string | null = null
      let styleUnreadable = false
      if (isStyleFile(csl)) {
        try {
          xml = await DocumentService.ReadCitationStyle(csl, path)
        } catch {
          styleUnreadable = true
        }
        if (gen !== reloadGeneration) return // superseded while the file was read
      }
      // Building a formatter costs its first formatting pass (up to 0.9 s on
      // a long paper), so the same text and style keep the one there is:
      // saving an untitled document, for one, changes the path but not these.
      if (formatter && loadedBib && loadedBib.text === text && loadedBib.csl === csl && loadedBib.xml === xml) {
        void DocumentService.WatchBibliography(wanted, path)
        return
      }
      const { entries, warnings } = await bibParser.parse(text)
      if (gen !== reloadGeneration) return // superseded while it was parsed
      if (warnings.length)
        toast(`Bibliography: ${warnings.length} entr${warnings.length === 1 ? 'y' : 'ies'} could not be parsed`)
      let next: CitationFormatter
      let styleNotice: string | null = null
      if (isStyleFile(csl)) {
        try {
          if (styleUnreadable) throw new Error('unreadable')
          next = await createCitationFormatter(entries, csl, xml ?? undefined)
        } catch {
          if (gen !== reloadGeneration) return
          next = await createCitationFormatter(entries, 'apa')
          styleNotice = `Citation style could not be loaded: ${csl} — using APA`
        }
      } else {
        next = await createCitationFormatter(entries, csl)
        if (fmCsl && !STYLE_IDS.includes(fmCsl)) styleNotice = `Unknown citation style "${fmCsl}" — using APA`
      }
      if (gen !== reloadGeneration) return // superseded while the style loaded
      formatter = next
      bibEntries = entries
      warnShadowed(shadowedKeys(entries))
      loadedBib = styleNotice ? null : { text, csl, xml }
      if (styleNotice) toast(styleNotice)
    } catch {
      if (gen !== reloadGeneration) return // superseded by a newer request
      formatter = undefined
      bibEntries = []
      loadedBib = null
      toast(`Bibliography not found: ${wanted}`)
    }
    void DocumentService.WatchBibliography(wanted, path)
  }

  $effect(() => {
    void fmBibliography
    void fmCsl
    void path
    void reloadBibliography()
  })

  // Re-render when the FORMATTER or the chart width changes (bib loaded or
  // reloaded, style change, View → Chart Width). content is read untracked:
  // content changes flow through the debounced typing path, not this
  // immediate effect.
  $effect(() => {
    void formatter
    void chartWidth
    // The editor's unknown-key marks read the same bibliography.
    editor?.refreshCitations()
    renderInto(untrack(() => content))
  })

  async function insertCitation() {
    // Same reasoning as the chartOpen guards below: the chart builder modal
    // does not block the keyboard, so this must refuse to touch the document
    // while it's open rather than trust that focus alone kept it out.
    if (chartOpen || tableOpen) return
    try {
      const picked = await DocumentService.PickCitations()
      if (picked) {
        editor.insertAtCursor(picked)
        // Zotero supplies the key; only the document's .bib can resolve it.
        // Warn when the two disagree, which is the common Zotero setup error.
        const f = formatter
        if (f) {
          const unresolved = unresolvedInsertionMessage(
            picked,
            (key) => f.has(key),
            fmBibliography ?? null,
          )
          if (unresolved) toast(unresolved)
        }
      }
    } catch (e) {
      // Ask why only now: probing before every pick would add two requests to
      // the path that works. A status check that itself fails means Zotero
      // did not answer, which reads the same as not running.
      let status = 'not-running'
      try {
        status = await DocumentService.ZoteroStatus()
      } catch {
        // keep the default
      }
      if (status === 'ready') toast(String(e))
      else zoteroHelp = status === 'no-better-bibtex' ? 'no-better-bibtex' : 'not-running'
    }
  }

  // Insert → Cross-reference…: the editor's list at the cursor, every kind in
  // it. Refused while anything modal is up, as insertCitation is.
  function insertCrossref() {
    if (showWelcome || chartOpen || tableOpen || newOpen || pendingAction || equationAsk) return
    if (!crossrefTargets.some(pickable)) {
      toast("There's nothing to refer to yet. Give a figure or table a caption, or add a display equation.")
      return
    }
    if (!editor.openCrossrefList()) toast("Cross-references can't go inside code, maths or frontmatter.")
  }

  // An unnamed equation chosen from the list waits here while its name is
  // asked. `typed` is what `[from, to)` held then, checked again before writing.
  let equationAsk = $state<{ target: CrossrefTarget; from: number; to: number; typed: string } | null>(null)
  let equationError = $state<NameError | null>(null)

  // What was refused by the editor, said with the target's kind word.
  function refusedToast(t: CrossrefTarget, why: 'moved' | 'own-line') {
    const word = KIND_WORD[t.kind].toLowerCase()
    toast(
      why === 'moved'
        ? `That ${word} moved, so no reference was added.`
        : `That reference is on the ${word}'s own line, so it wasn't added.`,
    )
  }

  // A target without a label was chosen: a figure or table is labelled from
  // its caption straight away; an equation needs a name first.
  function pickCrossref(target: CrossrefTarget, from: number, to: number) {
    if (showWelcome || chartOpen || tableOpen || newOpen || pendingAction || equationAsk) return
    if (target.kind === 'eq') {
      equationError = null
      equationAsk = { target, from, to, typed: editor.textInRange(from, to) }
      return
    }
    const result = editor.applyReference(target, from, to)
    if (result === 'moved' || result === 'own-line') refusedToast(target, result)
  }

  function nameEquation(name: string) {
    const ask = equationAsk
    if (!ask) return
    // The document may have changed under the dialog (a reload from disk).
    const result =
      editor.textInRange(ask.from, ask.to) === ask.typed
        ? editor.applyReference(ask.target, ask.from, ask.to, name)
        : 'moved'
    if (result === 'ok' || result === 'moved' || result === 'own-line') {
      equationAsk = null
      if (result !== 'ok') refusedToast(ask.target, result)
      return
    }
    equationError = result
  }

  const FORMAT_COMMANDS: Record<string, StateCommand> = {
    'heading:0': toggleHeading(0),
    'heading:1': toggleHeading(1),
    'heading:2': toggleHeading(2),
    'heading:3': toggleHeading(3),
    'heading:4': toggleHeading(4),
    'heading:5': toggleHeading(5),
    'heading:6': toggleHeading(6),
    bullet: toggleBulletList,
    ordered: toggleOrderedList,
    quote: toggleBlockquote,
    bold: toggleBold,
    italic: toggleItalic,
    code: toggleInlineCode,
    strike: toggleStrikethrough,
  }

  let chartOpen = $state(false)
  let chartInitial: BuilderState | null = $state(null)
  let chartTarget: { from: number; to: number; info: string } | null = null

  function openChartBuilder() {
    // A second trigger while the builder is already open must be a no-op,
    // not a way to silently retarget it: ChartBuilder reads `initial` once at
    // mount, so reassigning chartInitial here would be ignored — but
    // chartTarget WOULD update, turning a pending insert into a replace of
    // whatever block the cursor happens to be in.
    if (chartOpen) return
    if (tableOpen) return
    // Same guard as applyFormat: menu items fire regardless of focus, so
    // without it this would act on the hidden document behind the welcome pane.
    if (showWelcome) return
    // The unsaved-changes confirm dialog must stay the only modal on screen —
    // opening the builder on top of it would leave its buttons keyboard-
    // reachable behind a chart modal with no focus trap.
    if (pendingAction) return

    const block = editor.enclosingChartBlock()
    if (!block) {
      chartInitial = null
      chartTarget = null
      chartOpen = true
      return
    }

    // An empty fence has no JSON to read, but that's not a refusal case: a
    // fresh builder targeted at replacing this (empty) block is exactly the
    // right thing to open.
    if (block.spec.trim() === '') {
      chartInitial = null
      chartTarget = { from: block.from, to: block.to, info: block.info }
      chartOpen = true
      return
    }

    const result = readSpec(block.spec)
    if (!result.ok) {
      toast(
        result.reason === 'invalid-json'
          ? "That chart block isn't valid JSON, so it can't be opened here."
          : refusalMessage(result.unconsumed),
      )
      return
    }
    chartInitial = result.state
    chartTarget = { from: block.from, to: block.to, info: block.info }
    chartOpen = true
  }

  function commitChart(spec: string) {
    // A replaced chart keeps its whole info string, so a `{#fig:id}` label survives.
    const block = '```' + (chartTarget?.info ?? 'vega-lite') + '\n' + spec + '\n```'
    if (chartTarget) {
      // chartTarget is a raw offset pair captured when the builder opened and
      // never remapped against later document changes, so it cannot be
      // trusted blindly at commit time — guards elsewhere keep the document
      // still while the builder is open, but this is the safety net that
      // holds even if one of those guards is missing or a future change adds
      // a new way to edit the document. Re-check that the range still looks
      // like a vega-lite block before overwriting it.
      const current = editor.textInRange(chartTarget.from, chartTarget.to)
      if (!current.startsWith('```vega-lite') || !current.endsWith('```')) {
        toast("That chart moved while the builder was open, so it wasn't changed.")
        chartOpen = false
        chartInitial = null
        chartTarget = null
        return
      }
      editor.replaceRange(chartTarget.from, chartTarget.to, block)
    } else {
      editor.insertBlockAtCursor(block + '\n')
    }
    chartOpen = false
    chartInitial = null
    chartTarget = null
    // Every commit re-folds every vega-lite block in the document, including
    // ones the user had deliberately left unfolded — not just the block just
    // inserted or replaced.
    editor.runCommand(foldAllCodeBlocks)
  }

  // Go is told, so a close or quit asks first while a builder holds work
  // that is not yet in the document.
  $effect(() => {
    void DocumentService.SetBuilderOpen(chartOpen || tableOpen)
  })

  // A close or quit that arrived while a builder was open, waiting on the
  // "Discard the chart?" dialog.
  let builderClose: 'close' | 'quit' | null = $state(null)

  function discardBuilderAndContinue() {
    const intent = builderClose
    builderClose = null
    if (!intent) return
    closeChartBuilder()
    closeTableBuilder()
    pendingAction = intent
    if (!dirty) finishPending()
  }

  function closeChartBuilder() {
    chartOpen = false
    chartInitial = null
    chartTarget = null
  }

  let tableOpen = $state(false)
  let tableInitial: PipeTable | null = $state(null)
  let tableTarget: { from: number; to: number } | null = null
  // The exact text captured at the target range when the builder opened.
  // commitTable compares against this rather than merely re-parsing the live
  // range: parsePipeTable is deliberately lenient about trailing rows (it
  // treats any non-blank line after the delimiter as a data row, pipes or
  // not), so a stray edit that inserts a bogus row ahead of the table's own
  // rows — pushing the tail of the original block out of the stashed
  // [from, to) window — still parses "successfully" even though it is no
  // longer the table that was opened. An exact-text check catches that;
  // parsePipeTable alone would not.
  let tableOriginalText = ''

  // Mirrors openChartBuilder guard for guard; see the comments there.
  function openTableBuilder() {
    if (tableOpen || chartOpen || newOpen) return
    if (showWelcome) return
    if (pendingAction) return

    const block = editor.enclosingTable()
    if (!block) {
      tableInitial = null
      tableTarget = null
      tableOpen = true
      return
    }
    // The caption is part of the range but not of the table.
    const result = parsePipeTable(editor.textInRange(block.from, block.tableTo))
    if (!result.ok) {
      // Rare: Lezer only produces a Table for text that is one. Refuse rather
      // than open a fresh builder targeted at a block we could not read.
      toast("That table couldn't be read, so it can't be opened here.")
      return
    }
    tableInitial = { ...result.table, caption: block.caption?.caption ?? '', label: block.caption?.label ?? undefined }
    tableTarget = { from: block.from, to: block.to }
    tableOriginalText = block.text
    tableOpen = true
  }

  function closeTableBuilder() {
    tableOpen = false
    tableInitial = null
    tableTarget = null
    tableOriginalText = ''
  }

  function commitTable(table: PipeTable) {
    const text = serializePipeTable(table)
    if (tableTarget) {
      // Same safety net as commitChart: the range was captured when the
      // builder opened and is not remapped, so prove it still holds the same
      // table before overwriting it.
      const current = editor.textInRange(tableTarget.from, tableTarget.to)
      if (current !== tableOriginalText) {
        toast("That table moved while the builder was open, so it wasn't changed.")
        closeTableBuilder()
        return
      }
      editor.replaceRange(tableTarget.from, tableTarget.to, text)
    } else {
      // Unlike commitChart's fence, a GFM table does not terminate itself —
      // its last row keeps absorbing whatever text follows until a blank
      // line breaks it, so a plain trailing '\n' here would turn the next
      // paragraph into a bogus table row. Separate with a blank line, unless
      // one is already there (or there is nothing after the cursor at all),
      // in which case a bare '\n' avoids tripling up into two blank lines.
      const separator = editor.isFollowedByBlankLine() ? '\n' : '\n\n'
      editor.insertBlockAtCursor(text + separator)
    }
    closeTableBuilder()
  }

  function applyFormat(name: string) {
    // Menu accelerators fire regardless of focus, so a guard is required:
    // without it, Cmd-B on the welcome screen would edit a hidden document —
    // and, for the same reason, Cmd-B while the chart builder modal is open
    // would edit the document behind it.
    if (showWelcome || chartOpen || tableOpen) return
    const cmd = FORMAT_COMMANDS[name]
    if (cmd) editor.runCommand(cmd)
  }

  // Edit → Find (#18). Same guard as applyFormat: the accelerators fire on
  // the welcome screen and over the builders too.
  function applyFind(cmd: string) {
    if (showWelcome || chartOpen || tableOpen || newOpen) return
    if (cmd === 'open' || cmd === 'replace' || cmd === 'next' || cmd === 'previous') editor.find(cmd)
  }

  const FOLD_COMMANDS: Record<string, Command> = {
    'fold-block': foldCode,
    'unfold-block': unfoldCode,
    'fold-all-code': foldAllCodeBlocks,
    'unfold-all': unfoldAll,
  }

  function applyFold(name: string) {
    // Same guard as applyFormat: menu accelerators fire regardless of focus,
    // so without it a chord on the welcome screen — or with the chart
    // builder open — would act on a hidden document.
    if (showWelcome || chartOpen || tableOpen) return
    const cmd = FOLD_COMMANDS[name]
    if (cmd) editor.runCommand(cmd)
  }

  function insertCodeBlock(language: string) {
    // Same guard as applyFormat and applyFold: menu items fire regardless of
    // focus, so without it this would write into the hidden document behind
    // the welcome pane — or into the one behind the chart builder, which
    // cannot intercept an event arriving through Go's bus.
    if (showWelcome || chartOpen || tableOpen) return
    editor.insertCodeBlockAtCursor(language)
  }

  // Export → Export HTML…. The page is built from the rendered preview, which
  // only exists here, so Go only asks where and writes. htmlExport and the
  // KaTeX assets it loads are imported on first use: they are not part of
  // the startup bundle.
  // The header and footer come from the frontmatter, the title from the
  // first heading in the outline (lib/pageFurniture.ts).
  function exportPDF() {
    const furniture = pageFurniture(fm, outline[0]?.text ?? '', filename)
    void DocumentService.ExportPDF(path ?? '', furniture).catch((e) => toast(String(e)))
  }

  async function exportHTML() {
    if (showWelcome || chartOpen || tableOpen || newOpen) return
    const docPath = path ?? ''
    try {
      const target = await DocumentService.ChooseHTMLExportPath(docPath)
      if (!target) return
      // The panel is not modal to the webview: the document may have
      // changed, and a page built from the new one would be saved under the
      // old one's name with its images resolved against the wrong folder.
      const moved = () => (path ?? '') !== docPath || showWelcome || chartOpen || tableOpen || newOpen
      if (moved()) {
        toast('Export cancelled: the document changed')
        return
      }
      const { buildStandaloneHTML, loadExportStyles } = await import('./lib/htmlExport')
      const { css, katexCss } = await loadExportStyles()
      const root = await preview.exportRoot()
      // exportRoot waits up to 10 s for charts and diagrams to hydrate.
      if (moved()) {
        toast('Export cancelled: the document changed')
        return
      }
      const page = await buildStandaloneHTML(root, {
        title: (filename ?? 'Untitled').replace(/\.[^.]+$/, ''),
        bodyFont: bodyFontStack(bodyFont),
        css,
        katexCss,
        inlineImage: (src) => DocumentService.ReadImageDataURI(docPath, src).catch(() => null),
      })
      await DocumentService.WriteHTMLExport(target, page)
      toast(`Exported ${target.split('/').pop()}`)
    } catch (e) {
      toast(`Could not export HTML: ${e}`)
    }
  }

  // Export → Export Word… / Export LaTeX…. The document is converted by Pandoc
  // on the Halmos portal (PortalService.Export); everything sent is built
  // here from what the editor holds, and checked first, because a refusal
  // the document caused is charged to the person's seat. The first export on
  // a Mac that is not connected asks to connect, then carries on.
  async function exportPandoc(format: ExportFormat) {
    if (showWelcome || chartOpen || tableOpen || newOpen) return
    const acct = await PortalService.Account()
    if (!acct.signedIn) {
      if (acct.error) {
        toast(messageFor(acct.error, format).text)
        return
      }
      pendingExport = format
      connectState = { kind: 'ask' }
      return
    }
    await runExport(format)
  }

  const formatName = (format: ExportFormat) => (format === 'docx' ? 'Word' : 'LaTeX')

  async function runExport(format: ExportFormat) {
    if (showWelcome || chartOpen || tableOpen || newOpen) return
    const docPath = path ?? ''
    const source = content
    try {
      const target = await PortalService.ChooseExportPath(format, docPath)
      if (!target) return
      // As exportHTML: the panel is not modal to the webview.
      // Unlike the HTML page, the request is built from the text, matched
      // against what the preview drew, so an edit made meanwhile cancels too.
      const moved = () =>
        (path ?? '') !== docPath || content !== source || showWelcome || chartOpen || tableOpen || newOpen
      if (moved()) {
        toast('Export cancelled: the document changed')
        return
      }
      const body = await buildConvertBody(format, docPath, source)
      if (moved()) {
        toast('Export cancelled: the document changed')
        return
      }
      const problem = checkRequest(body)
      if (problem) {
        toast(problemMessage(problem))
        return
      }
      toast(`Exporting to ${formatName(format)}…`)
      const err = await PortalService.Export(target, body as ConvertRequest)
      if (err) {
        handlePortalError(err, format)
        return
      }
      toast(`Exported ${target.split('/').pop()}`, {
        label: 'Show in Finder',
        run: () => void PortalService.RevealExport(target),
      })
    } catch (e) {
      toast(`Could not export to ${formatName(format)}: ${e}`)
    }
  }

  // buildConvertBody gathers the request: for Word, charts and diagrams as
  // the preview drew them and each local image read beside the document
  // (anything not PNG, JPEG or GIF redrawn as PNG); the citation style's XML;
  // and only the cited part of the bibliography.
  async function buildConvertBody(format: ExportFormat, docPath: string, source: string): Promise<ConvertBody> {
    let markdown = source
    markdown = labelForExport(markdown)
    markdown = abstractReferencesForExport(markdown)
    markdown = authorsForExport(markdown)
    const images: Record<string, string> = {}
    if (format === 'docx') {
      const root = await preview.exportRoot()
      const diagrams = replaceDiagramFences(markdown, await diagramImages(root))
      markdown = diagrams.markdown
      Object.assign(images, diagrams.images)
    }
    const plan = planImages(markdown, format, docPath !== '')
    const resolved: ResolvedImage[] = []
    for (const ref of plan.refs) {
      const img = await PortalService.ReadExportImage(docPath, ref.src)
      let ext: ResolvedImage['ext'] = null
      let data = img.base64
      if (!img.error) {
        if (img.mime === 'image/png') ext = 'png'
        else if (img.mime === 'image/jpeg') ext = 'jpg'
        else if (img.mime === 'image/gif') ext = 'gif'
        else {
          // At its own size: a photo doubled would pass the 8 MB limit.
          data = await toPng(`data:${img.mime};base64,${img.base64}`, 1).catch(() => '')
          if (data) ext = 'png'
        }
      }
      if (ext) images[`${ref.key}.${ext}`] = data
      resolved.push({ key: ref.key, src: ref.src, ext })
    }
    markdown = finalizeImages(plan.markdown, resolved)
    const csl =
      fmCsl && isStyleFile(fmCsl)
        ? await DocumentService.ReadCitationStyle(fmCsl, docPath).catch(() => undefined)
        : ((await loadStyleXml(fmCsl ?? 'apa')) ?? (await loadStyleXml('apa')) ?? undefined)
    const bibText =
      fmBibliography && path ? await DocumentService.ReadBibliography(fmBibliography, path).catch(() => '') : ''
    const bibliography = buildBibliography(markdown, bibText)
    if (bibliography) markdown = withReferencesHeading(markdown)
    const body: ConvertBody = { format, markdown, csl, bibliography }
    if (format === 'docx' && Object.keys(images).length) body.images = images
    return body
  }

  function handlePortalError(err: PortalError, format: ExportFormat) {
    const m = messageFor(err, format)
    if (m.action === 'connect') {
      pendingExport = format
      connectState = { kind: 'ask' }
    } else if ((m.action === 'pricing' || m.action === 'billing') && err.pricingURL) {
      portalAlert = { text: m.text, button: m.action === 'pricing' ? 'See Plans' : 'Open Billing', url: err.pricingURL }
    } else {
      toast(m.text)
    }
  }

  async function startConnect() {
    if (connectState?.kind === 'starting' || connectState?.kind === 'waiting') return
    connectState = { kind: 'starting' }
    const info = await PortalService.StartPairing()
    // Cancelled while the code was asked for: Go has already dropped it.
    if (connectState?.kind !== 'starting') return
    if (info.error) {
      connectState = { kind: 'failed', message: messageFor(info.error, pendingExport ?? 'docx').text }
      return
    }
    connectState = { kind: 'waiting', code: info.userCode, url: info.verificationURL }
  }

  function cancelConnect() {
    if (connectState?.kind === 'waiting' || connectState?.kind === 'starting') void PortalService.CancelPairing()
    connectState = null
    pendingExport = null
  }

  function onPairing(ev: { state: string; email?: string; error?: PortalError | null }) {
    if (connectState?.kind !== 'waiting') return
    if (ev.state === 'approved') {
      const resume = pendingExport
      pendingExport = null
      if (resume) {
        connectState = null
        toast(`Connected as ${ev.email || 'your Halmos account'} · a confirmation email was sent`)
        void runExport(resume)
      } else {
        connectState = { kind: 'connected', email: ev.email ?? '' }
      }
    } else if (ev.state === 'denied') {
      connectState = { kind: 'failed', message: 'The request was denied.' }
    } else if (ev.state === 'expired') {
      connectState = { kind: 'failed', message: 'The code expired before it was approved.' }
    } else {
      connectState = {
        kind: 'failed',
        message: ev.error ? messageFor(ev.error, 'docx').text : 'Something went wrong while connecting.',
      }
    }
  }

  // App menu → Account…: who this Mac is connected as, read fresh each time.
  async function openAccount() {
    accountOpen = true
    account = null
    accountProblem = ''
    const info = await PortalService.Account()
    account = info
    accountProblem = info.error ? messageFor(info.error, 'docx').text : ''
  }

  async function signOut() {
    await PortalService.SignOut()
    account = { ...(account as AccountInfo), signedIn: false, email: '', seatSource: '', seatStatus: '', error: null }
    accountProblem = ''
  }

  // Format → Citation Style. Writes `csl:` through the editor so it is one
  // undo step and marks the document dirty like any other edit.
  async function applyCitationStyle(choice: string) {
    // Same guard as applyFormat: the menu fires over the welcome pane and
    // over the builders and the New dialog.
    if (showWelcome || chartOpen || tableOpen || newOpen) return
    let value = choice
    if (choice === 'other') {
      if (path === null) {
        toast('Save the document before choosing a style file')
        return
      }
      const docPath = path
      let chosen = ''
      try {
        chosen = await DocumentService.ChooseCitationStyle()
      } catch (e) {
        toast(String(e))
        return
      }
      if (!chosen) return
      // The panel is not modal to the webview: the document may have changed.
      if (path !== docPath || showWelcome || chartOpen || tableOpen || newOpen) return
      value = bibliographyReference(chosen, docPath)
    } else if (!STYLE_IDS.includes(choice)) {
      return
    }
    const change = frontmatterKeyChange(content, 'csl', value)
    // Choosing the style already written would only dirty the document.
    if (content.slice(change.from, change.to) === change.insert) return
    editor.applyChange(change.from, change.to, change.insert)
  }

  const PASTE_EXTENSIONS: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp',
  }

  // The binding takes []byte, which Wails sends as a base64 string.
  function blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onerror = () => reject(reader.error)
      reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''))
      reader.readAsDataURL(blob)
    })
  }

  // Editor paste handler for a clipboard that holds an image and no text. The
  // image file is written at once and is not part of undo; the link goes in
  // through the editor, so it dirties the document and undoes like any text.
  async function pasteImage(file: Blob, type: string) {
    if (showWelcome || chartOpen || tableOpen || newOpen) return
    if (path === null) {
      toast('Save the document before pasting images')
      return
    }
    const ext = PASTE_EXTENSIONS[type]
    if (!ext) {
      toast('This image type cannot be pasted')
      return
    }
    const docPath = path
    try {
      if (file.size === 0) throw new Error('the pasted image is empty')
      const rel = await DocumentService.SavePastedImage(docPath, await blobToBase64(file), ext)
      // The write is async: do not drop a link into a different document.
      if (path !== docPath || showWelcome || chartOpen || tableOpen || newOpen) return
      editor.insertImageLink(rel)
    } catch (e) {
      toast(`Could not paste the image: ${e}`)
    }
  }

  function onEditorChange(text: string) {
    content = text
    welcomeDismissed = true
    updatePreview(text)
    recountUnknownSoon(text)
  }

  // `cursor` is 'end' for a document created a moment ago, so typing starts
  // below its frontmatter; the 'start' default is for opening a file, which
  // must not relocate where ⌘⇧C and the Format-menu commands act.
  function loadDocument(
    docPath: string,
    docContent: string,
    cursor: 'start' | 'end' | { from: number; to: number } = 'start',
  ) {
    // Before anything changes: the keeper must not read the swap from a
    // dirty old document to a clean new one as a save of the old one.
    drafts.reset()
    draftWriteWarned = false
    // A swap makes any pending offer moot; the draft file stays on disk and
    // is offered again when that document is next opened.
    recovery = null
    diskChange = null
    diskGone = false
    // The question was about the document going away; nothing is written.
    answerOverwrite(false)
    path = docPath
    content = docContent
    welcomeDismissed = true
    editor.setContent(docContent, cursor) // fires onEditorChange, queueing a render
    savedContent = docContent
    // Render now rather than after the debounce, and drop the queued pass: it
    // would only re-render this same text.
    updatePreview.cancel()
    renderInto(docContent)
    void refreshRecents()
    void offerDraft(docPath)
  }

  // Asks Go whether a draft is worth offering for docPath ('' for untitled)
  // and raises the dialog if so. Go has already dropped a draft the file has
  // caught up with, so found means newer and different. A failure to ask is
  // logged, not shown: the cost is one missed offer.
  async function offerDraft(docPath: string) {
    try {
      const draft: Draft = await DocumentService.RecoverDraft(docPath)
      if (!draft.found) return
      // The document may have been swapped again while we waited.
      if ((path ?? '') !== docPath) return
      recovery = { key: docPath, content: draft.content, changed: draft.changed }
    } catch (err) {
      console.warn('RecoverDraft:', err)
    }
  }

  function restoreDraft() {
    const draft = recovery
    recovery = null
    if (!draft) return
    // savedContent is left as the file's text (or '' for untitled), so the
    // restored document is dirty: nothing on disk holds this text yet. The
    // draft file itself stays until the next clean transition — it is still
    // the only copy.
    editor.setContent(draft.content, 'start') // fires onEditorChange, queueing a render
    content = draft.content
    welcomeDismissed = true
    updatePreview.cancel()
    renderInto(draft.content)
  }

  // Closes the dialog without touching the draft file: Esc (or any other
  // native dismissal) must not be destructive. The draft stays on disk and
  // is offered again the next time this document is opened, the same as a
  // document swap.
  function dismissRecovery() {
    recovery = null
    // A first launch with no recents goes to the template, as it would have
    // without a draft to ask about. Only the untitled path can be here with
    // an empty buffer.
    if (path === null && content === '' && recents.length === 0) doNew()
  }

  // document:changed from Go's watcher. Halmos's own saves never send it.
  // A clean document takes the new text without asking; a dirty one asks.
  function onDiskChange(change: { path: string; version: string; content: string }) {
    // The previous document's watcher can still report after a switch.
    if (change.path !== path) return
    // A deleted file that came back: whether the document is dirty is again
    // a matter of its text.
    diskGone = false
    if (!dirty) {
      useDiskVersion(change, false)
      return
    }
    diskChange = { version: change.version, content: change.content }
  }

  // `undoable` is false for the silent reload and true for Use File, so ⌘Z
  // brings back the text the user chose to replace.
  function useDiskVersion(change: { version: string; content: string }, undoable: boolean) {
    editor.reloadContent(change.content, undoable) // fires onEditorChange, queueing a render
    content = change.content
    savedContent = change.content
    acceptDiskVersion(change.version)
  }

  // A failure is logged, not shown: the cost is one extra conflict question
  // at the next Save.
  function acceptDiskVersion(version: string) {
    void DocumentService.AcceptDiskVersion(version).catch((err) => console.warn('AcceptDiskVersion:', err))
  }

  // Keep Mine, and Esc: the edits stay and stay unsaved, and the file's
  // version becomes the base, so the next Save does not ask about it again.
  function keepMine() {
    const change = diskChange
    diskChange = null
    if (change) acceptDiskVersion(change.version)
  }

  function useFile() {
    const change = diskChange
    diskChange = null
    if (change) useDiskVersion(change, true)
  }

  // document:moved: another program renamed or moved the open file. Go has
  // already re-pointed its tracking, moved the draft and added the new path
  // to recents; the path effects re-arm the bibliography watcher and re-key
  // the draft keeper.
  function onDiskMove(move: { from: string; to: string }) {
    if (move.from !== path) return
    path = move.to
    toast(`Moved to ${move.to.split('/').slice(-2).join('/')}`)
    void refreshRecents()
  }

  // document:deleted: the text stays open, unsaved, until Save recreates it.
  function onDiskDelete(gone: { path: string }) {
    if (gone.path !== path) return
    diskGone = true
    toast(`"${filename}" was deleted. Save will recreate it.`)
  }

  // Resolves true on Overwrite, false on Cancel or Esc. A second ask (a Save
  // from the unsaved-changes dialog while this one is up) answers the first
  // with false, so that save() does not wait for ever.
  function askOverwrite(): Promise<boolean> {
    answerOverwrite(false)
    return new Promise((resolve) => (overwriteAnswer = resolve))
  }

  function answerOverwrite(overwrite: boolean) {
    const resolve = overwriteAnswer
    overwriteAnswer = null
    resolve?.(overwrite)
  }

  function discardRecoveredDraft() {
    // Captured before dismissRecovery clears `recovery`: the key the draft
    // was offered under, not the live path, which the first-launch
    // fallthrough below may already have moved on from.
    const key = recovery?.key ?? path ?? ''
    dismissRecovery()
    void DocumentService.DiscardDraft(key).catch((err) => console.warn('DiscardDraft:', err))
  }

  // The first-launch question, answered once. Both answers are stored, so
  // the dialog never comes back; Esc is "Don't Check" for the same reason.
  async function answerUpdateQuestion(answer: 'on' | 'off') {
    askUpdates = false
    try {
      const current: Settings = await DocumentService.Settings()
      await DocumentService.UpdateSettings({ ...current, updateCheck: answer })
    } catch (err) {
      toast(`Could not save the update-check setting: ${err}`)
      return
    }
    if (answer === 'on') void checkForUpdates(false)
  }

  // manual: Help → Check for Updates…, which ignores the daily throttle and
  // always reports. Automatic: at launch, which only speaks up when there is
  // something to say — an offline launch must not nag.
  async function checkForUpdates(manual: boolean) {
    if (manual && (chartOpen || tableOpen)) {
      toast('Finish or cancel the chart or table before checking for updates.')
      return
    }
    try {
      const result: UpdateResult = await DocumentService.CheckForUpdates(manual)
      if (result.available) {
        updateNotice = result
        return
      }
      if (manual) toast(`Halmos ${result.current} is up to date.`)
    } catch (err) {
      if (manual) toast(`Could not check for updates: ${err}`)
      else console.warn('CheckForUpdates:', err)
    }
  }

  function viewRelease() {
    const notice = updateNotice
    updateNotice = null
    if (notice) void Browser.OpenURL(notice.url)
  }

  async function refreshRecents() {
    recents = (await DocumentService.RecentFiles()) ?? []
  }

  // The start screen's Clear. With no recents the pane has nothing to show,
  // so this ends the way a first launch does: in a new templated document.
  async function clearRecents() {
    await DocumentService.ClearRecents()
    await refreshRecents()
    doNew()
  }

  async function refreshSettings() {
    const s: Settings = await DocumentService.Settings()
    syncScrolling = s.syncScrolling
    showOutline = s.showOutline
    autoSave = s.autoSave
    // Go clamps to the three values, so the cast is a spelling of what the
    // binding cannot express.
    updateCheck = s.updateCheck as UpdateCheckSetting
    spellCheck = s.spellCheck
    themeSetting = s.theme as ThemeSetting
    // Go normalises both on the way out, so the cast is a spelling of what
    // the binding cannot express rather than an unchecked assumption.
    chartWidth = s.chartWidth as ChartWidth
    figureAlign = s.figureAlignment as FigureAlignment
    paperSize = s.paperSize as PaperSize
    bodyFont = s.bodyFont
    orientation = s.printOrientation as PageOrientation
    applyTheme(resolveTheme(themeSetting, systemPrefersDark))
  }

  // Scroll fires in bursts; one measurement per frame is plenty, and coalescing
  // keeps a fast scroll from forcing layout dozens of times.
  function onEditorScroll() {
    if (!syncScrolling || scrollFrame !== null) return
    scrollFrame = requestAnimationFrame(() => {
      scrollFrame = null
      if (!syncScrolling) return
      preview.syncToLine(editor.topVisibleLine(), editor.lineCount())
    })
  }

  function requestNew() {
    // menu:new fires regardless of focus (and regardless of whether the
    // chart builder modal is covering the editor), so this must refuse
    // rather than swap the whole document out from under an open modal.
    if (chartOpen || tableOpen || newOpen) return
    if (dirty) {
      pendingAction = 'new'
      return
    }
    newOpen = true
  }

  // File → New… is two prompts: this dialog (bibliography? which style?) and
  // then the native save panel. The order is forced by the frontmatter: the
  // live `bibliography:` key names a `.bib` after the document's own stem,
  // which is not known until the panel has been answered.
  let newOpen = $state(false)

  async function createDocument(
    bibliography: BibliographyChoice | null,
    csl: string,
    start: { starter: StarterId; pageFurniture: boolean },
  ) {
    newOpen = false
    try {
      const chosen = await DocumentService.ChooseNewDocumentPath()
      if (!chosen) return // cancelled
      // The frontmatter value and CreateDocument's bibName are the same
      // string: both resolve against the document, so what the document
      // says is exactly what gets created (or, for an existing file, found).
      // Only an existing file needs the document's folder to be known, which
      // is why this runs after the save panel rather than in the dialog.
      const { name: bibName, seed } = bibliographyFor(bibliography, chosen)
      const text = newDocumentText(bibName === '' ? null : bibName, csl, start)
      const doc = await DocumentService.CreateDocument(chosen, text, bibName, seed)
      // A starter with a title placeholder opens with it selected, so typing
      // replaces it; otherwise typing continues below the frontmatter.
      loadDocument(doc.path, doc.content, titleSelection(doc.content) ?? 'end')
    } catch (err) {
      toast(`Could not create document: ${err}`)
    }
  }

  function bibliographyFor(
    choice: BibliographyChoice | null,
    docPath: string,
  ): { name: string; seed: string } {
    if (choice === null) return { name: '', seed: '' }
    switch (choice.kind) {
      case 'same': {
        const stem = docPath.replace(/^.*[\\/]/, '').replace(/\.[^.]*$/, '')
        return { name: `${stem}.bib`, seed: BIBLIOGRAPHY_SEED }
      }
      case 'new':
        return { name: choice.name, seed: BIBLIOGRAPHY_SEED }
      case 'existing':
        // No seed: the file exists, and CreateDocument leaves an existing
        // file alone regardless.
        return { name: bibliographyReference(choice.path, docPath), seed: '' }
    }
  }

  // The first-launch scratch document: an untitled, templated buffer. Every
  // other route to a new document goes through createDocument above, which
  // saves and names the file first; this stays for the launch with nothing
  // to show, where a dialog before the window has even settled would be
  // hostile.
  function doNew() {
    drafts.reset()
    draftWriteWarned = false
    // A swap makes any pending offer moot; the draft file stays on disk and
    // is offered again when that document is next opened.
    recovery = null
    diskChange = null
    diskGone = false
    answerOverwrite(false)
    path = null
    // Untitled: Go stops watching the old file and checking saves against it.
    void DocumentService.ForgetDocument().catch((err) => console.warn('ForgetDocument:', err))
    // 'end' lands the cursor (and focus) below the frontmatter so the user
    // can start typing immediately; loadDocument() below relies on the
    // 'start' default instead, since opening a file must not relocate where
    // ⌘⇧C and the Format-menu commands act.
    editor.setContent(NEW_DOCUMENT_TEMPLATE, 'end') // fires onEditorChange, queueing a render
    content = NEW_DOCUMENT_TEMPLATE
    // savedContent is seeded too: dirty is derived as content !== savedContent,
    // so seeding only content would make every new document dirty on creation
    // and prompt on close despite the user never touching it. The two
    // assignments must stay in the same synchronous block (no `await` or
    // `flushSync()` between them): Svelte defers effects to a microtask, so
    // as long as both run before the next tick, the Go side's SetDirty(dirty)
    // effect only ever observes the settled, non-dirty state. Splitting them
    // across a suspension point would let that effect fire on the transient
    // content !== savedContent gap and send SetDirty(true) for a fresh,
    // untouched template — prompting to save on close for a document the
    // user never edited.
    savedContent = NEW_DOCUMENT_TEMPLATE
    updatePreview.cancel() // the render below supersedes it
    renderInto(NEW_DOCUMENT_TEMPLATE)
    welcomeDismissed = true
  }

  function requestOpen() {
    // Same reasoning as requestNew: menu:open must not swap the document out
    // from under an open chart builder modal, or the New… dialog.
    if (chartOpen || tableOpen || newOpen) return
    if (dirty) {
      pendingAction = 'open'
      return
    }
    void doOpen()
  }

  async function doOpen() {
    try {
      const doc = await DocumentService.Open()
      if (!doc.path) return // cancelled
      loadDocument(doc.path, doc.content)
    } catch (err) {
      toast(`Could not open file: ${err}`)
    }
  }

  function requestOpenRecent(p: string) {
    // Same reasoning as requestNew: menu- and welcome-pane-triggered opens
    // must not swap the document out from under an open chart builder modal,
    // or the New… dialog.
    if (chartOpen || tableOpen || newOpen) return
    if (dirty) {
      pendingAction = 'open'
      pendingRecentPath = p
      return
    }
    void openRecent(p)
  }

  async function openRecent(p: string) {
    try {
      const doc = await DocumentService.OpenPath(p)
      loadDocument(doc.path, doc.content)
    } catch (err) {
      toast(`Could not open ${p}: ${err}`)
    }
  }

  /** Returns true if the document was saved (false = cancelled/failed). */
  async function save(): Promise<boolean> {
    const snapshot = content // what we're writing (content may change mid-await)
    try {
      if (path) {
        const docPath = path
        const result = await DocumentService.Save(docPath, snapshot, false)
        // Another program changed the file since Halmos last matched it, and
        // nothing was written. Replacing that is the user's call.
        if (result.conflict) {
          if (!(await askOverwrite())) return false
          // The document may have been closed or swapped while asking.
          if (path !== docPath) return false
          await DocumentService.Save(docPath, snapshot, true)
        }
      } else {
        const newPath = await DocumentService.SaveAs(snapshot)
        if (!newPath) return false // cancelled
        path = newPath
        // A rename starts a new document's one-toast-per-document guard;
        // the old path's failure (if any) says nothing about this one.
        draftWriteWarned = false
        void refreshRecents()
      }
      savedContent = snapshot
      // Saving the editor's text is keeping mine; Go's Save has re-tracked
      // the version on disk, so the Keep Mine / Use File question is moot.
      diskChange = null
      diskGone = false
      return true
    } catch (err) {
      toast(`Could not save: ${err}`)
      return false
    }
  }

  async function saveAs() {
    const snapshot = content
    try {
      const newPath = await DocumentService.SaveAs(snapshot)
      if (!newPath) return
      path = newPath
      savedContent = snapshot
      diskGone = false
      // Same reasoning as the Save-As branch of save(): a new document
      // should not inherit a warning already shown for the old one.
      draftWriteWarned = false
      void refreshRecents()
    } catch (err) {
      toast(`Could not save: ${err}`)
    }
  }

  async function confirmSave() {
    // By the time save() resolves, the dirty effect has queued the draft's
    // discard, and finishPending's quit branch settles it.
    if (await save()) finishPending()
    else pendingAction = null
  }

  async function confirmDiscard() {
    savedContent = content // treat current text as accepted; clears dirty
    diskGone = false
    await DocumentService.SetDirty(false)
    // The dirty effect above has queued the draft's discard by now; a quit
    // that follows must not outrun it.
    await drafts.settle()
    finishPending()
  }

  function finishPending() {
    const action = pendingAction
    const recentPath = pendingRecentPath
    pendingAction = null
    pendingRecentPath = null
    if (action === 'quit') void drafts.settle().then(() => DocumentService.Quit())
    else if (action === 'close') void drafts.settle().then(() => DocumentService.CloseWindow())
    else if (action === 'new') newOpen = true
    else if (action === 'open') {
      if (recentPath) void openRecent(recentPath)
      else void doOpen()
    }
  }

  function onDividerKeydown(e: KeyboardEvent) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    const step = e.key === 'ArrowLeft' ? -2 : 2
    editorWidth = Math.min(80, Math.max(20, editorWidth + step))
  }

  function startDrag(e: MouseEvent) {
    e.preventDefault()
    const move = (ev: MouseEvent) => {
      editorWidth = Math.min(80, Math.max(20, (ev.clientX / window.innerWidth) * 100))
    }
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  // Demo mode (demo.go, lib/demo.ts): the script's verbs map onto the same
  // functions the menus and builders call, so a recording shows exactly what
  // a person would see. Each action throws on what it cannot do, and the
  // player stops there and names the step.
  const demoActions: DemoActions = {
    async open(p) {
      const doc = await DocumentService.OpenPath(p)
      loadDocument(doc.path, doc.content)
    },
    goto: (line) => editor.goToLine(line),
    typeChar: (c) => editor.insertAtCursor(c),
    menu(name) {
      if (name === 'insert-chart') return openChartBuilder()
      if (name === 'insert-table') return openTableBuilder()
      const [verb, arg] = name.split(/\s+/, 2)
      if (verb === 'format' && arg && FORMAT_COMMANDS[arg]) return applyFormat(arg)
      throw new Error(`unknown menu name ${JSON.stringify(name)}`)
    },
    chart(spec) {
      if (!chartOpen) throw new Error('the chart builder is not open')
      commitChart(spec)
    },
    table(source) {
      if (!tableOpen) throw new Error('the table builder is not open')
      const parsed = parsePipeTable(source)
      if (!parsed.ok) throw new Error(`the body is not a pipe table (${parsed.reason})`)
      commitTable(parsed.table)
    },
    fullscreen: () => DemoService.Fullscreen(),
    record: (p) => DemoService.StartRecording(p),
    stop: () => DemoService.StopRecording(),
    async quit() {
      await drafts.settle()
      await DocumentService.Quit()
    },
  }

  // Go hid the window (#17): the app stays in the Dock, and a click on it
  // brings back the welcome pane rather than the document just closed. Only
  // reached clean — a dirty close goes through the unsaved-changes dialog
  // first — so there is nothing here to save.
  function closeDocument() {
    drafts.reset()
    draftWriteWarned = false
    recovery = null
    diskChange = null
    diskGone = false
    answerOverwrite(false)
    // A builder or the New dialog left open would come back over the welcome
    // pane on the next Dock click, aimed at a document that is gone.
    closeChartBuilder()
    closeTableBuilder()
    newOpen = false
    path = null
    void DocumentService.ForgetDocument().catch((err) => console.warn('ForgetDocument:', err))
    editor.setContent('')
    content = ''
    savedContent = ''
    welcomeDismissed = false
    updatePreview.cancel()
    renderInto('')
    // Mirrors first launch: with no recents the welcome pane has nothing to
    // show, so start a templated document instead.
    if (recents.length === 0) doNew()
  }

  async function startDemo() {
    let steps: Awaited<ReturnType<typeof DemoService.Script>>
    try {
      steps = await DemoService.Script()
    } catch (err) {
      toast(`Demo script: ${err}`)
      return
    }
    if (!steps?.length) return
    const result = await runDemo(
      steps,
      demoActions,
      (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    )
    if (!result.ok) {
      toast(`Demo stopped at step ${result.step} (${result.verb}): ${result.message}`)
    }
  }

  onMount(() => {
    // Asked from here, not pushed from Go: Go cannot know when this page is
    // ready to be told, and a script that starts before the editor exists
    // would type into nothing.
    void startDemo()
    Events.On('menu:new', requestNew)
    Events.On('menu:open', requestOpen)
    Events.On('menu:open-recent', (ev: { data: unknown }) => {
      if (typeof ev.data === 'string') requestOpenRecent(ev.data)
    })
    Events.On('menu:save', () => void save())
    Events.On('menu:save-as', () => void saveAs())
    Events.On('close:confirm', (ev: { data: unknown }) => {
      // 'close' from the window's close button, 'quit' from ⌘Q. Anything
      // else is treated as a quit, the older and safer reading.
      const intent = ev.data === 'close' ? 'close' : 'quit'
      // Go asks with a builder open even for a clean document (mustAsk), so
      // an uncommitted chart or table is never dropped without a word. Its
      // dialog comes first; the unsaved-changes one, if needed, after.
      if (chartOpen || tableOpen) {
        builderClose = intent
        return
      }
      pendingAction = intent
      // Clean by now (a builder Go saw has since closed): nothing to ask.
      if (!dirty) finishPending()
    })
    Events.On('document:closed', closeDocument)
    Events.On('document:changed', (ev: { data: unknown }) => {
      const d = ev.data as { path?: unknown; version?: unknown; content?: unknown } | null
      if (typeof d?.path !== 'string' || typeof d.version !== 'string' || typeof d.content !== 'string') return
      onDiskChange({ path: d.path, version: d.version, content: d.content })
    })
    Events.On('document:moved', (ev: { data: unknown }) => {
      const d = ev.data as { from?: unknown; to?: unknown } | null
      if (typeof d?.from !== 'string' || typeof d.to !== 'string') return
      onDiskMove({ from: d.from, to: d.to })
    })
    Events.On('document:deleted', (ev: { data: unknown }) => {
      const d = ev.data as { path?: unknown } | null
      if (typeof d?.path !== 'string') return
      onDiskDelete({ path: d.path })
    })
    // Finder's Open With while running (#19); same path as Open Recent, so
    // unsaved changes are asked about first.
    Events.On('file:open', (ev: { data: unknown }) => {
      if (typeof ev.data === 'string') requestOpenRecent(ev.data)
    })
    Events.On('recents:changed', () => void refreshRecents())
    Events.On('bib:changed', () => void reloadBibliography())
    Events.On('menu:insert-citation', () => void insertCitation())
    Events.On('menu:insert-crossref', () => insertCrossref())
    Events.On('menu:export-pdf', () => exportPDF())
    Events.On('menu:export-html', () => void exportHTML())
    Events.On('menu:export-pandoc', (ev: { data: unknown }) => {
      if (ev.data === 'docx' || ev.data === 'latex') void exportPandoc(ev.data)
    })
    Events.On('menu:account', () => void openAccount())
    Events.On('portal:pairing', (ev: { data: unknown }) => {
      if (ev.data && typeof ev.data === 'object') onPairing(ev.data as { state: string; email?: string })
    })
    Events.On('menu:insert-chart', () => openChartBuilder())
    Events.On('menu:insert-table', () => openTableBuilder())
    Events.On('menu:insert-code', (ev: { data: unknown }) => {
      // '' is the Plain text item, and a legitimate payload — a bare fence.
      if (typeof ev.data === 'string') insertCodeBlock(ev.data)
    })
    Events.On('menu:format', (ev: { data: unknown }) => {
      if (typeof ev.data === 'string') applyFormat(ev.data)
    })
    Events.On('menu:find', (ev: { data: unknown }) => {
      if (typeof ev.data === 'string') applyFind(ev.data)
    })
    Events.On('menu:citation-style', (ev: { data: unknown }) => {
      if (typeof ev.data === 'string') void applyCitationStyle(ev.data)
    })
    Events.On('menu:fold', (ev: { data: unknown }) => {
      if (typeof ev.data === 'string') applyFold(ev.data)
    })
    Events.On('settings:changed', () => void refreshSettings())
    Events.On('menu:check-updates', () => void checkForUpdates(true))

    const media = window.matchMedia('(prefers-color-scheme: dark)')
    systemPrefersDark = media.matches
    const onSchemeChange = (e: MediaQueryListEvent | { matches: boolean }) => {
      systemPrefersDark = e.matches
      applyTheme(resolveTheme(themeSetting, systemPrefersDark))
    }
    media.addEventListener('change', onSchemeChange)

    // Independent of the reads below and only cosmetic, so it neither waits
    // for them nor holds them up.
    DocumentService.WelcomeInfo().then(
      (info) => (welcomeInfo = info),
      (err) => console.warn('WelcomeInfo:', err),
    )

    void (async () => {
      // allSettled, not all: these two reads are independent, and a rejection
      // from either must not stop the other's effect from applying, nor skip
      // the templating check below. Promise.all would let one rejection sink
      // both — turning a settings-load failure into a blank, template-less
      // editor on top of the settings failure itself.
      //
      // The third read is the file Finder launched us to open (#19), asked
      // for after file:open is subscribed above so no request falls between
      // the two: Go buffers until this call and emits from then on.
      let launchFile = ''
      const takeLaunch = DocumentService.TakeLaunchFile().then(
        (p) => (launchFile = p),
        (err) => console.warn('TakeLaunchFile:', err),
      )
      await Promise.allSettled([refreshRecents(), refreshSettings(), takeLaunch])
      if (launchFile) {
        // The file the user just asked for wins over the untitled draft
        // offer and the template; an untitled draft stays on disk and is
        // offered at the next launch.
        requestOpenRecent(launchFile)
      } else {
        // A crash with an untitled document leaves a draft under the
        // 'untitled' key; this is the one moment it can be offered. The
        // dialog's Discard Draft falls through to the template below when
        // there are no recents; Restore replaces it.
        await offerDraft('')
        // A recovery offer is the more urgent dialog; the update question and
        // the automatic check wait for a launch with nothing else on screen.
        if (recovery !== null) return
        // A first launch has nothing to put in the welcome pane, so go
        // straight into a templated document rather than an empty one — the
        // user who has never seen Hermes is exactly the one the template is
        // for.
        if (recents.length === 0) doNew()
      }
      if (updateCheck === 'unasked') askUpdates = true
      else if (updateCheck === 'on') void checkForUpdates(false)
    })()

    return () => {
      media.removeEventListener('change', onSchemeChange)
      // App is the root component, so in production this runs only as the
      // process is going away — but a pending frame that outlives its
      // component is a leak the moment anything else unmounts it, and the
      // teardown it belongs in already exists.
      if (scrollFrame !== null) cancelAnimationFrame(scrollFrame)
    }
  })
</script>

<div class="app">
  <header class="toolbar">
    <div class="toolbar-group" role="group" aria-label="Outline">
      <button
        class="outline-toggle"
        aria-pressed={showOutline}
        title={showOutline ? 'Hide outline (⌘⌥O)' : 'Show outline (⌘⌥O)'}
        onclick={() => void setOutlineShown(!showOutline)}>Outline</button
      >
    </div>
    <div class="toolbar-group" role="group" aria-label="File">
      <button onclick={requestOpen}>Open…</button>
      <button onclick={() => void save()}>Save</button>
    </div>
    <div class="toolbar-group" role="group" aria-label="Insert">
      <button onclick={() => void insertCitation()}>Cite…</button>
      <button onclick={openChartBuilder}>Chart…</button>
      <button onclick={openTableBuilder}>Table…</button>
    </div>
    <div class="toolbar-group toolbar-end" role="group" aria-label="Export">
      <button onclick={exportPDF}>Export PDF…</button>
    </div>
  </header>

  <main class="panes">
    {#if showOutline}
      <Outline entries={outline} onjump={jumpToLine} />
    {/if}
    <section class="editor-pane" style="width: {editorWidth}%">
      <Editor bind:this={editor} citations={() => citationContext} crossrefs={() => crossrefTargets} onpickcrossref={pickCrossref} onchange={onEditorChange} onformat={applyFormat} onscroll={onEditorScroll} onpasteimage={pasteImage} spellcheck={spellCheck} />
    </section>
    <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -- WAI-ARIA "window splitter" pattern: a focusable separator with arrow-key resizing is the recommended markup -->
    <div
      class="divider"
      onmousedown={startDrag}
      onkeydown={onDividerKeydown}
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize editor and preview panes"
      aria-valuenow={Math.round(editorWidth)}
      aria-valuemin={20}
      aria-valuemax={80}
      tabindex="0"
    ></div>
    <Preview bind:this={preview} {html} {figureAlign} {paperSize} {bodyFont} {orientation} />
  </main>

  <footer class="status-bar">
    <span class="status-name">{filename}{dirty ? ' — Edited' : ''}</span>
    {#if unknown.length > 0}
      <button class="link-button unknown-count" onclick={() => (unknownOpen = true)}
        >{unknown.length} unknown citation{unknown.length === 1 ? '' : 's'}</button
      >
    {/if}
    {#if missingRefs.length > 0}
      <button class="link-button unknown-count" onclick={() => (missingOpen = true)}
        >{missingCount}</button
      >
    {/if}
  </footer>

  {#if showWelcome}
    <div class="welcome">
      <aside class="welcome-side">
        <div class="welcome-title">
          <h1>Halmos Editor</h1>
          {#if welcomeInfo.version}
            <p class="welcome-version">Version {welcomeInfo.version}</p>
          {/if}
        </div>
        <div class="welcome-actions">
          <button class="primary" data-shortcut="⌘N" onclick={requestNew}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>New Document</button
          >
          <button data-shortcut="⌘O" onclick={requestOpen}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>Open…</button
          >
        </div>
        <!-- Buttons, not <a href>: a real link would navigate the webview
             away and take the app state with it. Same route the preview's
             links take. -->
        <div class="welcome-help">
          <button class="welcome-link" onclick={() => void Browser.OpenURL('https://www.halmoseditor.com/guides')}
            >Guides at halmoseditor.com</button
          >
          <button class="welcome-link" onclick={() => void Browser.OpenURL('https://github.com/richarc/halmos/discussions')}
            >Questions and ideas</button
          >
          <p>Found a bug? Help → Report an Issue… fills in the version for you.</p>
        </div>
      </aside>
      <section class="welcome-main" aria-label="Recent files">
        <div class="welcome-recents-head">
          <h2>Recent files</h2>
          <button class="welcome-link welcome-clear" onclick={() => void clearRecents()}>Clear</button>
        </div>
        <ul class="welcome-recents">
          {#each welcomeRecents as r (r.path)}
            <li>
              <button class="welcome-recent" title={r.path} onclick={() => requestOpenRecent(r.path)}>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5M9 13h6M9 17h4" /></svg>
                <span class="welcome-recent-text">
                  <span class="welcome-recent-name">{r.name}</span>
                  <span class="welcome-recent-folder">{r.folder}</span>
                </span>
              </button>
            </li>
          {/each}
        </ul>
      </section>
    </div>
  {/if}

  <!-- Both builders are placed ahead of NewDocument and the confirm Dialog
       below: those two are mounted unconditionally (they own visibility via
       their own `open` prop, not an {#if}), so their footer buttons —
       including ones labelled "Cancel" — are always present in the DOM.
       Putting the builders first means a plain `document.querySelectorAll`
       lookup (as the test helpers here do) finds the builder's own button
       first, matching what a user actually sees on top. -->
  {#if chartOpen}
    <ChartBuilder
      initial={chartInitial}
      oncommit={commitChart}
      oncancel={closeChartBuilder}
    />
  {/if}

  {#if tableOpen}
    <TableBuilder initial={tableInitial} oncommit={commitTable} oncancel={closeTableBuilder} />
  {/if}

  <NewDocument open={newOpen} onclose={() => (newOpen = false)} oncreate={(b, c, s) => void createDocument(b, c, s)} />

  <Dialog
    open={pendingAction !== null}
    label="Unsaved changes"
    title="Unsaved changes"
    role="alertdialog"
    onclose={() => {
      pendingAction = null
      pendingRecentPath = null
    }}
  >
    <p>"{filename}" has unsaved changes.</p>
    {#snippet footer()}
      <button class="dialog-alt" onclick={() => void confirmDiscard()}>Don't Save</button>
      <button
        onclick={() => {
          pendingAction = null
          pendingRecentPath = null
        }}>Cancel</button
      >
      <button class="primary" onclick={() => void confirmSave()}>Save</button>
    {/snippet}
  </Dialog>

  <Dialog
    open={builderClose !== null}
    label={chartOpen ? 'Discard chart' : 'Discard table'}
    title={chartOpen ? 'Discard the chart?' : 'Discard the table?'}
    role="alertdialog"
    onclose={() => (builderClose = null)}
  >
    <p>
      The {chartOpen ? 'chart' : 'table'} you are building is not in the document yet.
      Discard it and {builderClose === 'quit' ? 'quit' : 'close'}?
    </p>
    {#snippet footer()}
      <button class="dialog-alt" onclick={discardBuilderAndContinue}>Discard</button>
      <button class="primary" onclick={() => (builderClose = null)}>Keep Editing</button>
    {/snippet}
  </Dialog>

  <Dialog
    open={recovery !== null}
    label="Recover draft"
    title="Recover draft"
    role="alertdialog"
    onclose={dismissRecovery}
  >
    {#if path === null}
      <p>An unsaved untitled document was recovered from the last session. Restore it?</p>
    {:else if recovery?.changed}
      <p>A draft of "{filename}" was found, and the file has since been changed by another program. Restore the draft?</p>
    {:else}
      <p>A draft of "{filename}" newer than the file on disk was found. Restore it?</p>
    {/if}
    {#snippet footer()}
      <button class="dialog-alt" onclick={discardRecoveredDraft}>Discard Draft</button>
      <button class="primary" onclick={restoreDraft}>Restore</button>
    {/snippet}
  </Dialog>

  <Dialog
    open={diskChange !== null}
    label="Changed on disk"
    title="Changed on disk"
    role="alertdialog"
    onclose={keepMine}
  >
    <p>"{filename}" was changed by another program, and there are unsaved changes here.</p>
    {#snippet footer()}
      <button onclick={keepMine}>Keep Mine</button>
      <button class="primary" onclick={useFile}>Use File</button>
    {/snippet}
  </Dialog>

  <Dialog
    open={overwriteAnswer !== null}
    label="Changed on disk"
    title="Changed on disk"
    role="alertdialog"
    onclose={() => answerOverwrite(false)}
  >
    <p>"{filename}" was changed by another program since it was opened. Save anyway and replace those changes?</p>
    {#snippet footer()}
      <button onclick={() => answerOverwrite(false)}>Cancel</button>
      <button class="primary" onclick={() => answerOverwrite(true)}>Overwrite</button>
    {/snippet}
  </Dialog>

  <EquationName
    open={equationAsk !== null}
    error={equationError}
    oninsert={nameEquation}
    oncancel={() => (equationAsk = null)}
  />

  <UnknownCitations
    open={missingOpen}
    items={missingRefs}
    onclose={() => (missingOpen = false)}
    onjump={jumpToMissing}
    title={duplicateLabels ? 'Cross-reference problems' : 'Missing cross-references'}
    hint="No figure, table or equation has this label, or two share it. Click one to go to it."
    display={(key) => key}
  />
  <UnknownCitations open={unknownOpen} items={unknown} onclose={() => (unknownOpen = false)} onjump={jumpToUnknown} />

  <Dialog open={zoteroHelp !== null} label="Zotero" title="Zotero" onclose={() => (zoteroHelp = null)}>
    {#if zoteroHelp === 'no-better-bibtex'}
      <p>Zotero is running but the Better BibTeX plugin isn't installed. Halmos uses it to pick citations and to export your library as a .bib file.</p>
      <p>You can also type [@ to cite from your .bib without Zotero.</p>
    {:else}
      <p>Zotero isn't running. Open Zotero, then try again.</p>
    {/if}
    {#snippet footer()}
      {#if zoteroHelp === 'no-better-bibtex'}
        <button class="dialog-alt" onclick={() => void Browser.OpenURL('https://retorque.re/zotero-better-bibtex/installation/')}>Open Install Page</button>
      {/if}
      <button class="primary" onclick={() => (zoteroHelp = null)}>OK</button>
    {/snippet}
  </Dialog>

  <Dialog open={askUpdates} label="Check for updates" title="Check for updates" onclose={() => void answerUpdateQuestion('off')}>
    <p>
      Halmos can fetch a small file from GitHub once a day to see whether a newer version exists.
      Nothing about you or your documents is sent.
    </p>
    <p class="dialog-hint">You can change this later in the Help menu.</p>
    {#snippet footer()}
      <button class="dialog-alt" onclick={() => void answerUpdateQuestion('off')}>Don't Check</button>
      <button class="primary" onclick={() => void answerUpdateQuestion('on')}>Check Automatically</button>
    {/snippet}
  </Dialog>

  <Dialog open={updateNotice !== null} label="Update available" title="Update available" onclose={() => (updateNotice = null)}>
    {#if updateNotice}
      <p>Halmos {updateNotice.latest} is available. You have {updateNotice.current}.</p>
    {/if}
    {#snippet footer()}
      <button onclick={() => (updateNotice = null)}>Later</button>
      <button class="primary" onclick={viewRelease}>View Release</button>
    {/snippet}
  </Dialog>

  <ConnectDialog
    state={connectState}
    purpose={pendingExport}
    onconnect={() => void startConnect()}
    onreopen={(url) => void PortalService.OpenPortalURL(url)}
    oncancel={cancelConnect}
    ondone={() => (connectState = null)}
  />

  <AccountDialog
    open={accountOpen}
    {account}
    problem={accountProblem}
    onconnect={() => {
      accountOpen = false
      pendingExport = null
      connectState = { kind: 'ask' }
    }}
    onsignout={() => void signOut()}
    onplans={(url) => void PortalService.OpenPortalURL(url)}
    onclose={() => (accountOpen = false)}
  />

  <Dialog
    open={portalAlert !== null}
    label="Halmos subscription"
    title="Halmos subscription"
    role="alertdialog"
    onclose={() => (portalAlert = null)}
  >
    {#if portalAlert}<p>{portalAlert.text}</p>{/if}
    {#snippet footer()}
      <button onclick={() => (portalAlert = null)}>Close</button>
      <button
        class="primary"
        onclick={() => {
          if (portalAlert) void PortalService.OpenPortalURL(portalAlert.url)
          portalAlert = null
        }}>{portalAlert?.button ?? 'See Plans'}</button
      >
    {/snippet}
  </Dialog>

  {#if toastMsg}
    <div class="toast" role="status">{toastMsg}{#if toastAction}<button
          class="link-button toast-action"
          onclick={() => toastAction?.run()}>{toastAction.label}</button
        >{/if}</div>
  {/if}
</div>
