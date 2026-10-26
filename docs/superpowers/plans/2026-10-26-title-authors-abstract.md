# Title, authors and abstract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Read `title`, `author`, `date` and `abstract` from the frontmatter with Pandoc's meanings, show them as a title block in the preview, PDF, HTML and Quick Look, use the title for `{title}` and the HTML `<title>`, and send Word/LaTeX authors as text.

**Architecture:** `lib/frontmatter.ts` parses the four keys with the `yaml` library (YAML 1.2, as Pandoc's reader) beside the existing line parser, which keeps the six old keys exactly as they are. `lib/titleBlock.ts` builds the title block's HTML; `renderer.ts` renders the abstract through the same markdown-it instance before the body, sharing only the citation list, so citations number in reading order and the abstract's cross-references resolve against the body's targets. A new `lib/exportMetadata.ts` rewrites `name`/`affiliation` author entries as text in the export copy.

**Tech Stack:** TypeScript, markdown-it 14, `yaml` 2.9.1 (new, ISC, no dependencies), Svelte 5, CodeMirror 6, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-26-title-authors-abstract-design.md`

## Global Constraints

- Keys and meanings are Pandoc's: `title`, `author`, `date`, `abstract`. No other new keys.
- A document with none of the four keys renders exactly as before (every existing renderer test passes unchanged).
- The six existing keys (`bibliography`, `csl`, `toc`, `toc-depth`, `header`, `footer`) keep the current line parser and its behaviour, including the trailing-comment rule (issue #8).
- A YAML error or an unsupported shape drops only the metadata, silently; the document still renders and the six keys still work.
- `date` is shown exactly as written. `{date}` in `header`/`footer` stays the export date.
- The document is never rewritten for export; only the export copy changes.
- Colours only from the palette in `frontend/public/style.css` (`styleContract.test.ts`).
- Quick Look must keep working and fetch nothing; the renderer must not import the Wails runtime.
- `hermes` is public: no portal plans or server details in it beyond the API contract.
- Pin `yaml` at exactly `2.9.1`.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. A frontmatter that is valid for the old parser but not valid YAML (for example `footer: Page {page}: draft`) — the six keys still apply and nothing breaks. Test in Task 1.
2. An abstract containing a footnote, a heading or a figure — the body's footnote numbering, outline and figure numbers are unaffected. Test in Task 2.
3. A citation in the abstract under IEEE — it is [1] and the first body citation is [2]. Test in Task 2.
4. Typing in the abstract or title with spell check on — words are checked; other frontmatter lines are not. Test in Task 5.
5. Format → Citation Style on a document whose abstract has an indented line `  csl: x` — only the top-level `csl:` changes. Test in Task 1.

---

### Task 1: Parse the metadata

**Files:**
- Modify: `frontend/package.json`, `frontend/package-lock.json` (add `yaml` 2.9.1)
- Modify: `frontend/src/lib/frontmatter.ts`
- Test: `frontend/src/lib/frontmatter.test.ts`

**Interfaces:**
- Produces, in `frontmatter.ts`:
  - `export interface Author { name: string; affiliation?: string }`
  - `Frontmatter` gains `title?: string`, `date?: string`, `authors?: Author[]`, `abstract?: string`, `abstractLine?: number` (1-based document line of the abstract's first text line).
  - `export function hasTitleBlock(fm: Frontmatter): boolean` — true when any of `title`, `authors`, `date`, `abstract` is set.

- [ ] **Step 1: Add the dependency.** `npm install --save-exact yaml@2.9.1` in `frontend/`.

- [ ] **Step 2: Write the failing tests** in `frontmatter.test.ts`, `describe('metadata')`:
  - `title: "Yield: a study"` → `title === 'Yield: a study'`; `title: 'It''s'` → `"It's"`.
  - `author: Ada Lovelace` → `authors` `[{ name: 'Ada Lovelace' }]`.
  - `author: [Ada Lovelace, Mary Somerville]` → two names.
  - block list mixing `- name: Ada Lovelace` / `affiliation: University of London` and `- Mary Somerville` → `[{ name: 'Ada Lovelace', affiliation: 'University of London' }, { name: 'Mary Somerville' }]`.
  - an entry with no `name`, or a non-string `name`, is dropped; other fields on an entry are ignored.
  - `abstract: |` with two indented lines → the text with a newline between them and a trailing newline; `abstract: >-` folds to one line; `abstract: One line.` → `'One line.'`.
  - `abstractLine`: for a document starting `---` / `title: T` / `abstract: |` / `  First line.`, `abstractLine === 4`; for `abstract: One line.` on line 3, `abstractLine === 3`.
  - `date: 26 October 2026` → that string; `date: 2026-10-26` → `'2026-10-26'` (a string, not a Date: parse with the `core` schema).
  - Review Focus 1: `---\ncsl: ieee\nfooter: Page {page}: draft\ntitle: T\n---\n` → `csl === 'ieee'` and `footer === 'Page {page}: draft'` still read; `title` is `undefined` (the block is not valid YAML).
  - A block with none of the four keys → `hasTitleBlock(fm) === false` and the result deep-equals what it was before this task (same keys only).
  - Review Focus 5: `frontmatterKeyChange` on a frontmatter containing `abstract: |` then `  csl: x` and a top-level `csl: apa` replaces only the top-level line (asserted on the resulting text).

- [ ] **Step 3: Run them to see them fail.** `npx vitest run src/lib/frontmatter.test.ts` — the metadata tests FAIL (fields undefined); the `frontmatterKeyChange` test may already pass, since `keyRe` is anchored at the line start; keep it as a regression test.

- [ ] **Step 4: Implement.** In `parseFrontmatter`, after the existing line loop, parse `match[1] ?? ''` with `parseDocument(text, { schema: 'core' })` from `yaml`; if `doc.errors.length`, return without metadata. Read only the four keys. `title`/`date`: string scalars only (a number is converted with `String`). `author`: a string, or a sequence whose items are strings or maps with a string `name`. `abstract`: a string scalar; `abstractLine` from the value node's `range[0]` converted to a line within the block, plus the block's first line (2), plus one when the node is a block scalar (`Scalar.BLOCK_LITERAL`/`BLOCK_FOLDED`). Trim `title`, `date`, names and affiliations; keep the abstract's text as YAML gives it. Leave `unquote` and the line loop untouched.

- [ ] **Step 5: Run the tests.** `npx vitest run src/lib/frontmatter.test.ts` — PASS; then `npx vitest run` — all PASS.

- [ ] **Step 6: Commit.** `git add frontend/package.json frontend/package-lock.json frontend/src/lib/frontmatter.ts frontend/src/lib/frontmatter.test.ts` — `frontmatter: read title, author, date and abstract with Pandoc's YAML meanings`.

### Task 2: Render the title block

**Files:**
- Create: `frontend/src/lib/titleBlock.ts`
- Modify: `frontend/src/lib/renderer.ts` (`renderDocument`)
- Modify: `frontend/public/style.css`
- Test: `frontend/src/lib/titleBlock.test.ts`, `frontend/src/lib/renderer.test.ts`

**Interfaces:**
- Consumes: `Frontmatter`, `Author`, `hasTitleBlock` (Task 1); `keyLabel` from `crossrefTargets.ts`.
- Produces:
  - `titleBlock.ts`: `export function titleBlockHtml(parts: { title?: string; authors?: Author[]; date?: string; abstractHtml?: string }, inline: (s: string) => string, escape: (s: string) => string): string`.
  - `renderer.ts`: `export function plainTitle(title: string): string` — the title as plain text (markdown-it's `renderInlineAsText`, maths as its TeX source).
  - HTML classes: `header.title-block` > `h1.title-block-title`, `p.title-block-authors` (each author a `span.title-block-author`, affiliation numbers `<sup>`), `p.title-block-affiliation` (one per affiliation), `p.title-block-date`, `section.title-block-abstract` > `h2.title-block-abstract-heading` ("Abstract") + the abstract's HTML.

- [ ] **Step 1: Write the failing tests** in `titleBlock.test.ts` (with `inline` = identity and `escape` = markdown-it's `escapeHtml`):
  - title only → `<header class="title-block">` containing only the `h1`.
  - two authors with different affiliations → names in order, `<sup>1</sup>` and `<sup>2</sup>`, two affiliation lines starting with their numbers.
  - two authors sharing one affiliation, or one author with one → no `<sup>`, one affiliation line without a number.
  - one author with and one without an affiliation → the first gets `<sup>1</sup>`, the second none; one affiliation line numbered 1.
  - a name containing `<b>` is escaped.
  - date → its own `p.title-block-date`, exactly as written.
  - nothing set → `''`.

  In `renderer.test.ts`, `describe('title block')`:
  - `render(doc)` for a document with no metadata contains no `title-block`, and all existing renderer tests pass unchanged.
  - the title block comes before a top-placed contents list (`toc: true`) and before the body.
  - `title: A *bold* $x$ title` renders emphasis and KaTeX in the `h1`; `plainTitle('A *bold* $x$ title') === 'A bold x title'`.
  - Review Focus 3: with an IEEE formatter (as the existing citation tests build one), an abstract citing `@a` and a body citing `@b` render `[1]` in the abstract and `[2]` in the body.
  - an abstract `@fig:x` resolves to "Figure 1" when the body has a figure labelled `{#fig:x}`; an abstract `@fig:nope` renders `Figure ??` and appears in `crossrefs.missing` with `line === abstractLine`.
  - Review Focus 2: an abstract with `[^n]` and `[^n]: Note.`, `## Heading` and a captioned image leaves `outline` equal to the body's headings, the body's first figure "Figure 1", and the body's first footnote numbered 1.
  - abstract paragraphs carry `data-source-line` equal to their document lines (for a two-paragraph `abstract: |` starting on line 4: 4 and 6).

- [ ] **Step 2: Run them to see them fail.** `npx vitest run src/lib/titleBlock.test.ts src/lib/renderer.test.ts` — FAIL.

- [ ] **Step 3: Implement `titleBlockHtml`.** Order: title, authors, affiliations, date, abstract. Affiliation numbers by first appearance; numbers shown only when there are two or more distinct affiliations, or when some authors have one and some do not.

- [ ] **Step 4: Implement the renderer change.** In `renderDocument`, when `hasTitleBlock(fm)`:
  1. Build an abstract env: a new object with the same `chartWidthPx` and `docPath`, `sourceLineOffset: (fm.abstractLine ?? 1) - 1`, and `citations` set to the **same array** the body env will use (create it first: `env.citations = []`). Nothing else is shared, so the abstract's footnotes, headings, contents entries and figures stay out of the body's.
  2. `md.parse(fm.abstract, absEnv)` before the body is rendered, so its citation clusters come first. Keep `absEnv.crossrefMissing`.
  3. Render the body as now.
  4. Set `absEnv.crossrefLookup = env.crossrefLookup` and `md.renderer.render(absTokens, md.options, absEnv)`, so the abstract's references resolve against the body's targets.
  5. `crossrefs.missing` = the kept abstract misses whose `keyLabel(key)` is not in the body's lookup, then the body's.
  6. Title via `md.renderInline(title, {})` (a throwaway env: a citation in the title is not formatted); prepend `titleBlockHtml(...)` to `html` after the contents list is placed, so it comes first.
  The existing citation replacement (`formatCitations`) then runs over the whole HTML, title block included.

- [ ] **Step 5: Style it** in `style.css`, next to the `.csl-` rules: centred title block, the title larger than `.sheet h1`, authors, affiliations and date centred, abstract narrower (side margins about 2em) with a small heading. Palette variables only; `.title-block` gets `break-inside: avoid` in the print block with the other figures.

- [ ] **Step 6: Run the tests.** `npx vitest run` — all PASS, including `styleContract.test.ts`.

- [ ] **Step 7: Commit.** `titleBlock.ts`, its test, `renderer.ts`, `renderer.test.ts`, `style.css` — `preview: title block from the frontmatter's title, authors, date and abstract`.

### Task 3: The title in page furniture and the HTML export

**Files:**
- Modify: `frontend/src/lib/pageFurniture.ts`, `frontend/src/lib/htmlExport.ts` (`headingTitle`)
- Test: `frontend/src/lib/pageFurniture.test.ts`, `frontend/src/lib/htmlExport.test.ts`

**Interfaces:**
- Consumes: `plainTitle` (Task 2), `Frontmatter.title` (Task 1), the `h1.title-block-title` class (Task 2).
- Produces: `pageFurniture(fm: Pick<Frontmatter, 'header' | 'footer' | 'title'>, firstHeading, filename)` — same return type. `App.svelte`'s call is unchanged.

- [ ] **Step 1: Write the failing tests.**
  - `pageFurniture({ footer: '{title}', title: 'A *bold* title' }, 'Intro', 'x.md').title === 'A bold title'`; without `title` it is still `'Intro'`, and without either `'x'`.
  - `htmlExport`: a sheet whose first child is the title block with `h1.title-block-title` "My Paper" and a later `h1` "Intro" gives `<title>My Paper</title>`; a KaTeX formula in the title becomes its TeX source, as for headings.
- [ ] **Step 2: Run them to see them fail.** `npx vitest run src/lib/pageFurniture.test.ts src/lib/htmlExport.test.ts`.
- [ ] **Step 3: Implement.** `pageFurniture` prefers `plainTitle(fm.title)` when set. `headingTitle` looks for `.title-block-title` first, then the first heading outside `nav.toc` and outside `.title-block` (the abstract's own "Abstract" heading must never be the title), with the same footnote and KaTeX handling.
- [ ] **Step 4: Run the tests.** `npx vitest run` — all PASS.
- [ ] **Step 5: Commit.** — `export: the metadata title is the page title and {title}`.

### Task 4: Authors as text in the export copy

**Files:**
- Create: `frontend/src/lib/exportMetadata.ts`
- Modify: `frontend/src/App.svelte` (the export function, beside `labelForExport` at about line 907)
- Test: `frontend/src/lib/exportMetadata.test.ts`

**Interfaces:**
- Produces: `export function authorsForExport(markdown: string): string`.

- [ ] **Step 1: Write the failing tests.**
  - an `author:` list with `- name: Ada Lovelace` / `affiliation: University of London` and `- Mary Somerville` becomes a list of the strings `Ada Lovelace, University of London` and `Mary Somerville`; parsing the result with Task 1's `parseFrontmatter` gives `authors` `[{ name: 'Ada Lovelace, University of London' }, { name: 'Mary Somerville' }]`.
  - an entry with `name` only becomes its name.
  - plain names, a single `author:` string, no `author:` key, no frontmatter, and a frontmatter that is not valid YAML all return the input unchanged (`toBe`, the same string).
  - other keys, the body, and the frontmatter's other lines survive (assert `bibliography:`, `abstract:` text and the body are unchanged).
- [ ] **Step 2: Run them to see them fail.** `npx vitest run src/lib/exportMetadata.test.ts`.
- [ ] **Step 3: Implement** with `parseDocument` from `yaml`: replace the `author` node only when some entry is a map, then `doc.toString()` for the block and splice it between the original fences; the body is copied as is.
- [ ] **Step 4: Wire it.** In `App.svelte`, apply `authorsForExport` to the export copy next to `labelForExport`, for both Word and LaTeX.
- [ ] **Step 5: Run the tests.** `npx vitest run` and `npx svelte-check --threshold error` — PASS, 0 errors.
- [ ] **Step 6: Commit.** — `export: authors with affiliations reach Pandoc as text`.

### Task 5: Spell check the title and abstract

**Files:**
- Modify: `frontend/src/lib/spellcheck.ts` (`documentWideRanges`)
- Test: `frontend/src/lib/spellcheck.test.ts`

**Interfaces:**
- Consumes: `parseFrontmatter` and `abstractLine` (Task 1).

- [ ] **Step 1: Write the failing test.** Review Focus 4: for a document `---` / `title: A tittle` / `csl: ieee` / `abstract: |` / `  Some txet.` / `---` / body, `protectedRanges` over the whole document leaves the value of `title:` and the abstract's text lines **unprotected**, and still protects the `title: ` key text, the `csl: ieee` line and the fences. Maths and citations inside the abstract stay protected.
- [ ] **Step 2: Run it to see it fail.** `npx vitest run src/lib/spellcheck.test.ts`.
- [ ] **Step 3: Implement.** Replace the single frontmatter range with the frontmatter minus the `title:` value (on its line, after the colon and space) and minus the abstract's text lines (from `abstractLine` to the last line of the block scalar, or the value on the key line for a one-line abstract). The existing maths and citation patterns still apply inside.
- [ ] **Step 4: Run the tests.** `npx vitest run` — PASS.
- [ ] **Step 5: Commit.** — `spell check: check the title and abstract, not the rest of the frontmatter`.

### Task 6: Docs, check in the app, roadmap

**Files:**
- Modify: `docs/authoring.md`, `docs/getting-started.md`, `docs/test-document.md`, `CHANGELOG.md`, `ROADMAP.md`, `CLAUDE.md`
- Modify (product repository): `../ROADMAP.md` (row "Title, authors and abstract")

- [ ] **Step 1: Docs.** `authoring.md`: "Frontmatter: exactly six keys" becomes "exactly ten keys", with the spec's example; author shapes; abstract as Markdown (footnotes in it are listed under it, not with the body's); a `# Title` heading as well as `title:` shows twice; `{title}` uses the metadata title first. `getting-started.md`: the four keys in its frontmatter table. `test-document.md`: add `title`, two authors with different affiliations, `date` and a short abstract with one citation and one inline formula to its frontmatter.
- [ ] **Step 2: Check in the app.** `wails3 task build && wails3 task run`; confirm the binary is new (`strings "bin/Halmos Editor" | grep -c title-block-title` is at least 1). Open `docs/test-document.md`: the title block shows above the text, Export PDF shows it on page 1, Export HTML's tab title is the metadata title, and with sync scrolling on, scrolling the frontmatter keeps the preview at the top. Capture only the app window if a screenshot is needed.
- [ ] **Step 3: Changelog and roadmap.** `CHANGELOG.md` Unreleased → Added: title, authors, date and abstract. `ROADMAP.md`: tick the item with a *Done* note (guarded single-block replacement; `grep -c '^- \['` and `grep '^## '` checked before and after). `CLAUDE.md`: one sentence on `titleBlock.ts`, metadata parsing with `yaml`, and `authorsForExport`. Product `../ROADMAP.md` row: editor side done, and a note for the portal's "Title block from document metadata" item that the export copy's `author` is always a list of text entries; then `../bin/check-roadmaps`.
- [ ] **Step 4: Run everything.** `npx vitest run`, `npx svelte-check --threshold error`, `go test ./. && go build -o /dev/null .`, `wails3 task quicklook:test` — all pass.
- [ ] **Step 5: Commit** in each repository: hermes `docs: title, authors and abstract`; product `roadmap: title, authors and abstract done in the editor`.

## Follow-ups (not in this plan)

- Portal session: add `yaml` 2.9.1 to `tools/hermes-docs/package.json`, then re-vendor (`npm --prefix hermesportal/tools/hermes-docs run check:vendor -- --write`).
- One Word and one LaTeX export through the portal with two authors, to confirm the title block (the spec's unconfirmed Pandoc point).
