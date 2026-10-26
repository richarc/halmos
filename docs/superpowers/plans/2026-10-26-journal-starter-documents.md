# Journal-shaped starter documents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** File → New… offers "Start from: Blank / Research article" and a "Page header and footer" checkbox, and a research article opens with a rendered title block, five sections and the title placeholder selected.

**Architecture:** `lib/documentTemplate.ts` holds a `STARTERS` list and builds the text (`newDocumentText` gains an options argument whose defaults reproduce today's output). `NewDocument.svelte` adds the select and the checkbox and passes them through `oncreate`; `App.svelte`'s `createDocument` passes them on, and `Editor.setContent` gains a selection cursor so the title placeholder is selected after creation.

**Tech Stack:** TypeScript, Svelte 5, CodeMirror 6, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-26-journal-starter-documents-design.md`

## Global Constraints

- Two starters only: `blank` ("Blank") and `article` ("Research article"). A new starter must be one list entry.
- Blank without header and footer produces exactly today's text (`NEW_DOCUMENT_TEMPLATE` with no bibliography; today's live two-key block with one). Existing `documentTemplate` tests stay unchanged and pass.
- Header and footer lines, exactly: `header: "{title}"` and `footer: "Page {page} of {pages}"`.
- The research article's frontmatter and body are the spec's example (title `"Title of the paper"` quoted; one author `Your Name` / `Your institution`; the abstract prompt; `##` Introduction with its one prompt sentence, then empty `##` Methods, Results, Discussion, Conclusion). No `date:` line, no References heading, no `#` heading.
- Dialog defaults: resets to Blank with the box unticked on every open; choosing Research article ticks the box, choosing Blank unticks it; the author can change the box afterwards.
- No `journal:` frontmatter key. No new settings. No Go changes.
- The first-launch scratch document (`doNew`) is unchanged.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. An article created with no bibliography — renders with no status-bar warning and no toast, and its frontmatter still parses (title, author, abstract). Test in Task 1.
2. Changing the starter after ticking or unticking the box — the box follows the starter's default each time the starter changes. Test in Task 2.
3. Cancel on the save panel after choosing Research article — nothing is created, and the next New… opens on Blank. Test in Task 2.
4. Undo straight after creation — does not bring back the previous document (the existing `setContent` guarantee holds for the new cursor mode). Test in Task 2.
5. A title placeholder that cannot be found (text changed in future) — the document still opens, with today's cursor placement. Test in Task 1 (`titleSelection` returns null) and Task 2 (falls back to `'end'`).

---

### Task 1: Starter text

**Files:**
- Modify: `frontend/src/lib/documentTemplate.ts`
- Test: `frontend/src/lib/documentTemplate.test.ts`

**Interfaces:**
- Produces, in `documentTemplate.ts`:
  - `export type StarterId = 'blank' | 'article'`
  - `export interface Starter { id: StarterId; label: string; hint: string; furnitureByDefault: boolean }`
  - `export const STARTERS: readonly Starter[]` — `blank`: label "Blank", hint "Frontmatter for the bibliography and nothing else.", `furnitureByDefault: false`; `article`: label "Research article", hint "Title, author, abstract, and Introduction, Methods, Results, Discussion, Conclusion.", `furnitureByDefault: true`.
  - `newDocumentText(bibliography: string | null, csl: string, options?: { starter?: StarterId; pageFurniture?: boolean }): string` — defaults `starter: 'blank'`, `pageFurniture: false`.
  - `export function titleSelection(text: string): { from: number; to: number } | null` — the range of `Title of the paper` inside the frontmatter's `title:` line (inside the quotes), or null.

- [ ] **Step 1: Write the failing tests** in `documentTemplate.test.ts`, `describe('starters')`:
  - `STARTERS.map((s) => s.id)` equals `['blank', 'article']`.
  - `newDocumentText(null, 'apa', { starter: 'blank', pageFurniture: false })` `toBe` `NEW_DOCUMENT_TEMPLATE`, and `newDocumentText('paper.bib', 'ieee', {})` equals `newDocumentText('paper.bib', 'ieee')`.
  - blank with `pageFurniture: true`: `parseFrontmatter` gives `header === '{title}'` and `footer === 'Page {page} of {pages}'`, other keys as without.
  - article with `'paper.bib'`, `'apa'`: `parseFrontmatter` gives `title === 'Title of the paper'`, `authors` `[{ name: 'Your Name', affiliation: 'Your institution' }]`, an abstract starting `One paragraph:`, `bibliography === 'paper.bib'`, `csl === 'apa'`, no `header`/`footer` unless `pageFurniture: true`.
  - Review Focus 1: article with `null` bibliography: `title`/`authors`/`abstract` parse as above, `bibliography` undefined; `renderDocument(text)` HTML contains `class="title-block"` and exactly five `<h2` section headings whose text is Introduction, Methods, Results, Discussion, Conclusion in order; `crossrefs.missing` is empty; no `[@` in the HTML.
  - article text contains no line starting `# ` and no `date:` line.
  - Review Focus 5: `titleSelection(article text)` slices to `'Title of the paper'`; `titleSelection(NEW_DOCUMENT_TEMPLATE) === null`; `titleSelection('no frontmatter') === null`.

- [ ] **Step 2: Run them to see them fail.** From `frontend/`: `npx vitest run src/lib/documentTemplate.test.ts` — FAIL (exports missing).

- [ ] **Step 3: Implement.** The article frontmatter is the title/author/abstract lines of the spec's example, then the bibliography part exactly as today (the two live keys, or the five comment lines of `NEW_DOCUMENT_TEMPLATE` between its fences when there is no bibliography), then the two header/footer lines when `pageFurniture`; then the body from the spec. Blank with `pageFurniture` inserts the two lines before today's closing fence. Keep `newDocumentText`'s existing `STYLE_IDS` check. Update the file's doc comments to describe the starters.

- [ ] **Step 4: Run the tests.** `npx vitest run src/lib/documentTemplate.test.ts` then `npx vitest run` — all PASS.

- [ ] **Step 5: Commit.** `frontend/src/lib/documentTemplate.ts`, its test — `new document: research-article starter and page header/footer lines`.

### Task 2: The New dialog and opening the document

**Files:**
- Modify: `frontend/src/NewDocument.svelte`, `frontend/src/App.svelte` (`createDocument`, `loadDocument`), `frontend/src/Editor.svelte` (`setContent`)
- Test: `frontend/src/App.test.ts` (where the New dialog is tested today), `frontend/src/Editor.test.ts`

**Interfaces:**
- Consumes: `STARTERS`, `StarterId`, `newDocumentText(…, options)`, `titleSelection` (Task 1).
- Produces:
  - `NewDocument.svelte`: `oncreate(bibliography: BibliographyChoice | null, csl: string, start: { starter: StarterId; pageFurniture: boolean })`.
  - `Editor.svelte`: `setContent(text: string, cursor: 'start' | 'end' | { from: number; to: number } = 'start')` — a range selects it and focuses the editor, like `'end'`.
  - `App.svelte`: `loadDocument(docPath, docContent, cursor: 'start' | 'end' | { from: number; to: number } = 'start')`.

- [ ] **Step 1: Write the failing tests.**
  - `Editor.test.ts`: `setContent('---\ntitle: "T"\n---\n', { from: 12, to: 13 })` leaves the selection at 12–13; Review Focus 4: after `setContent` with a range, running `undo` leaves the document text unchanged.
  - `App.test.ts`, following the existing New-dialog tests:
    - the first step shows a "Start from" select with options "Blank" and "Research article" (Blank selected) and an unticked "Page header and footer" checkbox, each with its hint text from `STARTERS`;
    - Review Focus 2: selecting Research article ticks the box; unticking it, then selecting Blank and Research article again, ticks it again; selecting Blank unticks it;
    - creating with Research article and the box ticked (no bibliography, save panel mocked to a path) calls `CreateDocument` with text equal to `newDocumentText(null, csl, { starter: 'article', pageFurniture: true })` and the editor's selection covers `Title of the paper`;
    - with a bibliography chosen, the starter and box still reach the text (the `bibliography:` line is live);
    - Review Focus 3: Research article, then the save panel returns `''` — `CreateDocument` is not called; reopening New… shows Blank and an unticked box;
    - Review Focus 5: if `titleSelection` finds nothing (Blank), the cursor is placed as today (`'end'`).
- [ ] **Step 2: Run them to see them fail.** `npx vitest run src/App.test.ts src/Editor.test.ts`.
- [ ] **Step 3: Implement.**
  - `NewDocument.svelte`: a `starter` state (reset to `'blank'` on open with the others) and a `pageFurniture` state (reset to `false`); a "Start from" row styled like `.style-row`, above "Include a bibliography", with the starter's `hint` under it in `.hint`; the checkbox row under it, hint "The title at the top of each PDF page, 'Page 1 of 5' at the bottom."; changing `starter` sets `pageFurniture` to that starter's `furnitureByDefault`. Pass `{ starter, pageFurniture }` as `oncreate`'s third argument on every path (no bibliography, same, new, existing).
  - `App.svelte`: `createDocument` takes the third argument, builds the text with it, and calls `loadDocument(doc.path, doc.content, titleSelection(doc.content) ?? 'end')`; the `<NewDocument … oncreate>` binding passes it through.
  - `Editor.svelte`: `setContent` accepts the range (`EditorSelection.single(from, to)`), focuses for any cursor other than `'start'`, and keeps its comment's rule that opening a file uses `'start'`.
- [ ] **Step 4: Run the tests.** `npx vitest run` and `npx svelte-check --threshold error` — all PASS, 0 errors.
- [ ] **Step 5: Commit.** — `new document: Start from and page header/footer in the New dialog; select the title`.

### Task 3: Docs, check in the app, roadmap

**Files:**
- Modify: `docs/getting-started.md`, `docs/authoring.md`, `CHANGELOG.md`, `ROADMAP.md`, `CLAUDE.md` (only if a sentence about `documentTemplate.ts`/the New dialog needs updating)
- Modify (product repository): `../ROADMAP.md` (row "Journal-shaped starter documents")

- [ ] **Step 1: Docs.** `getting-started.md`: File → New… — "Start from" (Blank or Research article) and the page header and footer checkbox, in its existing voice. `authoring.md`: one line in the frontmatter section that File → New… can start a research article with `title`, `author` and `abstract` filled in, and how to add `date:`.
- [ ] **Step 2: Check in the app** (controller). `wails3 task build && wails3 task run`; confirm the binary is new (`strings "bin/Halmos Editor" | grep -c "Research article"` ≥ 1). File → New… → Research article, box ticked, no bibliography → save → the title block shows, the title placeholder is selected, typing replaces it, the status bar shows no warnings; Export PDF shows the title at the top and "Page 1 of N" at the bottom. Capture only the app window if a screenshot is needed.
- [ ] **Step 3: Changelog and roadmap.** `CHANGELOG.md` Unreleased → Added. `ROADMAP.md`: tick the item with a *Done* note (guarded single-block replacement; `grep -c '^- \['` and `grep '^## '` before and after). Product `../ROADMAP.md` row: done in the editor 2026-10-26 (not yet released); then `../bin/check-roadmaps`.
- [ ] **Step 4: Run everything.** `npx vitest run`, `npx svelte-check --threshold error`, `go test ./. && go build -o /dev/null .` — all pass.
- [ ] **Step 5: Commit** in each repository: hermes `docs: starter documents in the New dialog`; product `roadmap: journal-shaped starter documents done in the editor`.
