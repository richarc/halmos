# Table Captions and Cross-References Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Numbered table captions, and references to figures, tables and display equations that render as linked "Figure 2" in the preview, PDF, HTML, Word and LaTeX, picked from a list as citations are.

**Architecture:** Each kind of target (figure, table, labelled equation) is found and numbered by a markdown-it core rule that stamps one shared `TargetMeta` onto its token. A collecting rule gathers those stamps into `env.crossrefs` before rendering, so a reference rule renders "Figure 2" regardless of order. The citation inline rules decide, by key prefix, whether a match is a citation or a cross-reference, so the two cannot disagree. The editor offers targets from the last render through a second CodeMirror completion source, and writes a missing label into the document in the same edit as the reference.

**Tech Stack:** Svelte 5 + TypeScript, markdown-it, CodeMirror 6, Vitest; Go (Wails v3) only for one menu item.

**Spec:** `docs/superpowers/specs/2026-10-25-table-captions-and-cross-references-design.md`

## Global Constraints

- Work on a branch `crossrefs` off `main`; merge back locally with `--no-ff`. Do not push (`main` is held until the v0.15.0 release).
- Syntax is Pandoc / pandoc-crossref only. Labels: image `![Caption](x.png){#fig:name}`; chart and Mermaid on the opening fence line ```` ```vega-lite {#fig:name} ````; table `: Caption {#tbl:name}`; display maths `$$ … $$ {#eq:name}` (after the closing `$$`, same line). References: `@fig:id`, `[@fig:id]`, `[@fig:a; @tbl:b]`, `@Fig:id`.
- Any key starting `fig:`, `tbl:`, `eq:` or `sec:`, in any case, is a cross-reference and never a citation.
- Captions read `Figure 2: Caption` and `Table 1: Caption` (colon, one space). The em dash in `figureLabel` goes.
- References read like the portal's Word output: `Figure 2`, `Table 1`, `Equation 1`, `Section 1`; several of one kind `Figures 1, 2`; a no-break space (U+00A0) before each number run. A labelled equation shows `(1)` at the right.
- A missing label renders as `Figure ??` (kind word, no-break space, `??`) in a `crossref-error` span.
- Only level-0 (top-level) blocks are numbered. Figures and tables need a caption to be numbered; equations need a label.
- A document with no labels, no references and no `: ` line after a table renders exactly as before, apart from the dash-to-colon change in figure captions.
- Halmos never rewrites an existing label.
- Colours only through the palette in `frontend/public/style.css`; `styleContract.test.ts` must still pass.
- Commands: frontend tests `npm --prefix frontend test`; type check `npm --prefix frontend run check`; Go `go test ./. && go build -o /dev/null .`.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A table caption with no blank line before it** (`| 1 | 2 |` then `: Caption` on the next line). GFM absorbs it as a table row. Expected: Halmos always writes a blank line before the caption, and the authoring guide says to. Test in Task 4 pins the absorbed case as "not a caption", so nobody mistakes it for a bug fix later.
2. **Clearing a labelled table's caption in the builder.** That drops the label, and references show `Table ??`. Expected: the builder keeps the label line when the caption is cleared but a label exists, by refusing to commit with a field message "This table is referred to; give it a caption or remove the references first." Test in Task 8.
3. **A reference inside a footnote, a list item or a table cell** must still resolve (only *targets* are restricted to top level). Test in Task 6.
4. **Picking an unlabelled target after the document changed since the last render** (the list is a render behind). Expected: the label is written at the target found in the live text, matched by kind and number; if no match, a toast "That figure moved, so no reference was added." and nothing is written. Test in Task 10.
5. **Two captions that slug the same** ("Results" twice). Expected `fig:results` then `fig:results-2`. Test in Task 1.

---

### Task 1: The cross-reference vocabulary

**Files:**
- Create: `frontend/src/lib/crossrefs.ts`
- Test: `frontend/src/lib/crossrefs.test.ts`

**Interfaces:**
- Produces:
  - `type CrossrefKind = 'fig' | 'tbl' | 'eq'`
  - `type ReferenceKind = CrossrefKind | 'sec'`
  - `isCrossrefKey(key: string): boolean` — true when the key starts `fig:`/`tbl:`/`eq:`/`sec:` in any case.
  - `referenceKind(key: string): ReferenceKind | null` — the lower-cased prefix.
  - `trailingLabel(text: string, kind: CrossrefKind): { text: string; label: string | null }` — strips one trailing `{#<kind>:id}` (optionally with further attributes after a space, e.g. `{#fig:a width=50%}`) and the whitespace before it; returns `text` trimmed at the end. A label of another kind is not stripped.
  - `slugLabel(kind: 'fig' | 'tbl', caption: string, taken: ReadonlySet<string>): string`
  - `equationLabel(name: string, taken: ReadonlySet<string>): { ok: true; label: string } | { ok: false; reason: 'empty' | 'invalid' | 'taken' }`
  - `KIND_WORD: Record<ReferenceKind, string>` = `{ fig: 'Figure', tbl: 'Table', eq: 'Equation', sec: 'Section' }`
  - `interface TargetMeta { kind: CrossrefKind; number: number | null; caption: string; label: string | null }` — `number` is null only for an unlabelled equation.
  - `interface CrossrefTarget extends TargetMeta { block: 'image' | 'chart' | 'mermaid' | 'table' | 'equation'; line: number; tex?: string }` — `line` is the 1-based document line a label is appended to; `tex` is the formula for equations.
  - `labelSuffix(block: CrossrefTarget['block'], label: string): string` — `{#label}` straight after an image (Pandoc needs the attribute touching the `)`), ` {#label}` with one space for every other block.
  - `referenceText(keys: string[], lookup: (label: string) => { kind: CrossrefKind; number: number } | undefined): { text: string; missing: boolean }`

- [ ] **Step 1: Write the failing tests**

```ts
expect(isCrossrefKey('fig:a')).toBe(true)
expect(isCrossrefKey('Fig:a')).toBe(true)
expect(isCrossrefKey('SEC:intro')).toBe(true)
expect(isCrossrefKey('figueroa2019')).toBe(false)
expect(isCrossrefKey('fig')).toBe(false)

expect(trailingLabel('Yield by group {#tbl:yield}', 'tbl')).toEqual({ text: 'Yield by group', label: 'tbl:yield' })
expect(trailingLabel('x {#fig:a width=50%}', 'fig')).toEqual({ text: 'x', label: 'fig:a' })
expect(trailingLabel('Yield {#fig:a}', 'tbl')).toEqual({ text: 'Yield {#fig:a}', label: null })
expect(trailingLabel('no label', 'fig')).toEqual({ text: 'no label', label: null })

const none = new Set<string>()
expect(slugLabel('fig', 'Yield by variety, with 95% confidence intervals', none))
  .toBe('fig:yield-by-variety-with-95-confidence')
expect(slugLabel('fig', 'Café crème', none)).toBe('fig:cafe-creme')
expect(slugLabel('tbl', 'Results', new Set(['tbl:results']))).toBe('tbl:results-2')
expect(slugLabel('tbl', 'Results', new Set(['tbl:results', 'tbl:results-2']))).toBe('tbl:results-3')
expect(slugLabel('fig', '∑∑', none)).toBe('fig:figure')

expect(labelSuffix('image', 'fig:a')).toBe('{#fig:a}')
expect(labelSuffix('chart', 'fig:a')).toBe(' {#fig:a}')

expect(equationLabel('bayes', none)).toEqual({ ok: true, label: 'eq:bayes' })
expect(equationLabel(' ', none)).toEqual({ ok: false, reason: 'empty' })
expect(equationLabel('two words', none)).toEqual({ ok: false, reason: 'invalid' })
expect(equationLabel('bayes', new Set(['eq:bayes']))).toEqual({ ok: false, reason: 'taken' })

const nums: Record<string, { kind: CrossrefKind; number: number }> = {
  'fig:a': { kind: 'fig', number: 1 }, 'fig:b': { kind: 'fig', number: 2 }, 'tbl:t': { kind: 'tbl', number: 1 },
}
const lookup = (l: string) => nums[l]
expect(referenceText(['fig:b'], lookup)).toEqual({ text: 'Figure 2', missing: false })
expect(referenceText(['fig:a', 'fig:b'], lookup)).toEqual({ text: 'Figures 1, 2', missing: false })
expect(referenceText(['fig:a', 'tbl:t'], lookup)).toEqual({ text: 'Figure 1, Table 1', missing: false })
expect(referenceText(['Fig:a'], lookup)).toEqual({ text: 'Figure 1', missing: false })
expect(referenceText(['fig:zz'], lookup)).toEqual({ text: 'Figure ??', missing: true })
expect(referenceText(['sec:intro'], lookup)).toEqual({ text: 'Section ??', missing: true })
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm --prefix frontend test -- src/lib/crossrefs.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `frontend/src/lib/crossrefs.ts`**

Values the tests fix:
- Slug: NFKD, drop combining marks, lower-case, every run of characters outside `[a-z0-9]` becomes `-`, trim `-`. Cap at 40 characters, cutting back to the last `-` at or before 40 when there is one. An empty slug becomes `figure` or `table`. Add `-2`, `-3`, … until the label is not in `taken`.
- Equation name: trimmed. Must match `/^[A-Za-z0-9_][A-Za-z0-9_.-]*$/`. A leading `eq:` typed by the author is accepted and not doubled.
- Lookup in `referenceText` is by the lower-cased prefix plus the id exactly as written, so `@Fig:a` finds `fig:a`. Adjacent keys of the same kind group into one run with the plural word (`Figures`, `Tables`, `Equations`, `Sections`). Runs join with `, `. `missing` is true if any key is missing; a missing key prints `??` in place of its number.

- [ ] **Step 4: Run to verify they pass**

Run: `npm --prefix frontend test -- src/lib/crossrefs.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/crossrefs.ts frontend/src/lib/crossrefs.test.ts
git commit -m "crossrefs: label, slug and reference-text rules"
```

---

### Task 2: The citation parser draws the line

**Files:**
- Modify: `frontend/src/lib/citations.ts` (`bracketRule`, `narrativeRule`, `citationPlugin`)
- Modify: `frontend/src/lib/citationCompletion.ts`
- Test: `frontend/src/lib/citations.test.ts`, `frontend/src/lib/citationKeys.test.ts`, `frontend/src/lib/citationCompletion.test.ts`

**Interfaces:**
- Consumes: `isCrossrefKey` (Task 1).
- Produces:
  - Inline token type `crossref`, with `meta = { keys: string[]; mixed: boolean; src: string; start: number; end: number }` and `content` = the raw source. It is never pushed onto `env.citations`.
  - `shadowedKeys(entries: CSLEntry[]): string[]` in `citationCompletion.ts` — bibliography ids for which `isCrossrefKey` is true, in entry order.

- [ ] **Step 1: Write the failing tests**

In `citations.test.ts`, parsing with `createMarkdownParser()`:
- `See @fig:a.` gives one `crossref` token, `meta.keys` `['fig:a']`, and `env.citations` undefined or empty.
- `[@fig:a; @tbl:b]` gives one `crossref` token with keys `['fig:a', 'tbl:b']`, `mixed: false`.
- `[@fig:a; @smith2020]` gives one `crossref` token with `mixed: true`, and no citation cluster.
- `@Fig:a` gives a `crossref`.
- `@figueroa2019` and `[@fig]` are still citations.
- `[@smith2020]` is unchanged: one citation cluster.

In `citationKeys.test.ts`: `findCitationKeys('See @fig:a and [@smith2020].')` returns only `smith2020`. `unknownCitations('[@eq:x]', () => false)` is `[]`.

In `citationCompletion.test.ts`:
- Typing `@fig:` returns null, whatever the entries hold.
- Typing `@fig` (no colon) still lists an entry `figueroa2019`.
- An entry with id `fig:old` is never offered.
- `shadowedKeys([{ id: 'fig:old' }, { id: 'smith' }])` returns `['fig:old']`.

- [ ] **Step 2: Run to verify they fail**

Run: `npm --prefix frontend test -- src/lib/citations.test.ts src/lib/citationKeys.test.ts src/lib/citationCompletion.test.ts`
Expected: the new cases FAIL.

- [ ] **Step 3: Implement**

- Both rules: after the items are parsed, if any key `isCrossrefKey`, push a `crossref` token instead of calling `pushCitation`. `mixed` is true when some keys are not cross-references. Same `src`/`start`/`end` meta as citations.
- `citationPlugin` gives `crossref` a placeholder renderer that escapes the raw content. Task 6 replaces it in `renderer.ts`.
- Completion: return null when the typed key `isCrossrefKey` (the crossref source in Task 10 takes over there), and filter shadowed entries out of the index.

- [ ] **Step 4: Run all frontend tests**

Run: `npm --prefix frontend test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/citations.ts frontend/src/lib/citationCompletion.ts frontend/src/lib/*.test.ts
git commit -m "citations: fig:/tbl:/eq:/sec: keys are cross-references, never citations"
```

---

### Task 3: Figure labels, ids and the colon caption

**Files:**
- Modify: `frontend/src/lib/figures.ts` (`figureLabel`, `FigureMeta`, `numberFigures`)
- Modify: `frontend/src/lib/renderer.ts` (fence dispatch, `wrapAsFigure`)
- Modify: `frontend/src/lib/exportDiagrams.ts` (`DIAGRAM_INFO` match on the first word)
- Test: `frontend/src/lib/figures.test.ts`, `frontend/src/lib/renderer.test.ts`, `frontend/src/lib/exportDiagrams.test.ts`

**Interfaces:**
- Consumes: `trailingLabel`, `TargetMeta` (Task 1).
- Produces:
  - `fenceLanguage(info: string): string` exported from `figures.ts` — the info string's first word.
  - `FigureMeta` becomes a type alias for `TargetMeta` (with `kind: 'fig'`), so existing callers compile. The stamp moves from `token.meta.figure` to `token.meta.target`, on chart and Mermaid fence tokens and on the image's `figure` paragraph-open token; `figureOf` reads `meta.target`.
  - A labelled figure's `<figure>` carries `id="<label>"`.

- [ ] **Step 1: Write the failing tests**

- `figureLabel(2, 'Recovered sources')` is `'Figure 2: Recovered sources'`. Update every existing test expecting `Figure n — `.
- ```` ```vega-lite {#fig:yield}\n{"title":"Yield","mark":"bar"}\n``` ```` renders a `<figure id="fig:yield"` containing `.vega-lite-chart` and `<figcaption>Figure 1: Yield</figcaption>`.
- ```` ```vega-lite {#fig:x}\n{"mark":"bar"}\n``` ```` (no title) renders the plain chart div. The label is ignored, there is no number, and the chart still hydrates.
- ```` ```mermaid {#fig:flow} ```` with a frontmatter title renders `<figure id="fig:flow"`.
- `![Field plot](plot.png){#fig:field}` renders `<figure id="fig:field"` with caption `Figure 1: Field plot`, and no literal `{#fig:field}` text anywhere in the HTML.
- `![](plot.png){#fig:x}` (empty alt) is not a figure. The `{#fig:x}` text is still removed.
- `replaceDiagramFences` finds a ```` ```vega-lite {#fig:a} ```` block (images length 1) and replaces it.

- [ ] **Step 2: Run to verify they fail**

Run: `npm --prefix frontend test -- src/lib/figures.test.ts src/lib/renderer.test.ts src/lib/exportDiagrams.test.ts`
Expected: the new cases FAIL.

- [ ] **Step 3: Implement**

- Every `info.trim() === 'vega-lite'` or `'mermaid'` comparison (figures.ts, renderer.ts fence rule, exportDiagrams.ts) becomes `fenceLanguage(info) === …`. The fence label is `trailingLabel(info after the first word, 'fig').label`.
- Image label: in `numberFigures`, for a paragraph whose inline children are `[image, text]` with the text matching a whole `{#fig:…}`, drop the text child and treat the paragraph as a lone image. This must run after the `inline` core rule, as it does today.
- `wrapAsFigure` adds `id` when `target.label` is set, escaped with `md.utils.escapeHtml`.

- [ ] **Step 4: Run all frontend tests**

Run: `npm --prefix frontend test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/figures.ts frontend/src/lib/renderer.ts frontend/src/lib/exportDiagrams.ts frontend/src/lib/*.test.ts
git commit -m "figures: read {#fig:} labels, give labelled figures ids, colon captions"
```

---

### Task 4: Table captions

**Files:**
- Create: `frontend/src/lib/tableCaptions.ts`
- Modify: `frontend/src/lib/renderer.ts` (register the plugin)
- Modify: `frontend/public/style.css` (`.sheet table > caption`)
- Test: `frontend/src/lib/tableCaptions.test.ts`

**Interfaces:**
- Consumes: `trailingLabel`, `TargetMeta` (Task 1).
- Produces:
  - `tableCaptionPlugin(md: MarkdownIt): void`
  - `parseCaptionLine(line: string): { caption: string; label: string | null } | null` — `line` must start `: ` (colon, then at least one space).
  - Tokens `table_caption_open` / `inline` / `table_caption_close`, placed straight after `table_open`. `table_open.meta.target` is a `TargetMeta` with `kind: 'tbl'`. `table_open` carries `id` when labelled.

- [ ] **Step 1: Write the failing tests**

Using `render()` from `renderer.ts`:
- `| a | b |\n|---|---|\n| 1 | 2 |\n\n: Yield by group` renders `<table` … `<caption>Table 1: Yield by group</caption>` as the first child of the table. There is no `<p>` holding `: Yield`.
- With `: Yield by group {#tbl:yield}`, the table has `id="tbl:yield"` and the caption has no `{#`.
- `: Caption with *emphasis*` renders `<em>emphasis</em>` inside the caption.
- Two captioned tables and one captioned figure are numbered Table 1, Table 2, Figure 1, independently.
- A table without a caption line renders exactly as it does on `main` (compare against a stored string).
- A `: Caption` paragraph two blank lines after the table stays a paragraph.
- A `: Caption` with no blank line before it (Review Focus 1) is a table row, not a caption.
- A captioned table inside a blockquote gets a `<caption>` but no number: the caption text alone, with no `Table n: `.
- `parseCaptionLine(': Results {#tbl:r}')` is `{ caption: 'Results', label: 'tbl:r' }`. `parseCaptionLine(':Results')` is null.

- [ ] **Step 2: Run to verify they fail**

Run: `npm --prefix frontend test -- src/lib/tableCaptions.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

- A core rule registered **before** `inline`. It runs for a `table_close` followed by `paragraph_open` at the same level, where the paragraph's `map[0] - table.map[1] <= 1`, and the inline content passes `parseCaptionLine`. The paragraph's three tokens move to just after `table_open` and are retyped as caption tokens, with the inline content set to the caption text. The inline rule then parses it.
- A second core rule after `inline` numbers level-0 captioned tables, writing `meta.target`.
- The `table_caption_open` renderer writes `<caption>` plus `Table n: ` (escaped) when numbered.
- CSS: `caption-side: top`, the same font and colour rules as `.sheet figcaption`, using existing palette variables only.

- [ ] **Step 4: Run all frontend tests**

Run: `npm --prefix frontend test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/tableCaptions.ts frontend/src/lib/tableCaptions.test.ts frontend/src/lib/renderer.ts frontend/public/style.css
git commit -m "tables: Pandoc caption line renders as a numbered caption above the table"
```

---

### Task 5: Equation labels and numbers

**Files:**
- Create: `frontend/src/lib/equations.ts`
- Modify: `frontend/src/lib/renderer.ts` (`math_block` wrapper)
- Modify: `frontend/public/style.css` (`.sheet .equation`, `.equation-number`)
- Test: `frontend/src/lib/equations.test.ts`

**Interfaces:**
- Consumes: `TargetMeta` (Task 1).
- Produces:
  - `equationPlugin(md: MarkdownIt): void`. It stamps `meta.target` (`kind: 'eq'`; `number` set only when labelled; `caption` = `''`) and `meta.tex` on every level-0 `math_block`.
  - `EQUATION_LABEL = /\$\$\s*\{#(eq:[A-Za-z0-9_][A-Za-z0-9_:.-]*)\}\s*$/`

- [ ] **Step 1: Write the failing tests**

- `$$\na+b\n$$ {#eq:sum}` renders `<div class="equation" id="eq:sum" data-source-line="1">`. Inside it: the KaTeX display, then `<span class="equation-number">(1)</span>`. `data-source-line` appears once and not on the inner `<p>`.
- `$$ a+b $$ {#eq:sum}` (one line) renders the same, and the KaTeX output does not contain `{#eq`.
- `$$\na+b\n$$` (unlabelled) renders exactly as on `main`, with no number.
- Three equations, the 1st and 3rd labelled, are numbered (1) and (2).
- A labelled equation inside a list item gets its id but no number.

- [ ] **Step 2: Run to verify they fail**

Run: `npm --prefix frontend test -- src/lib/equations.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

- The KaTeX plugin drops a label on the closing line (multi-line) or leaves `$$ {#eq:x}` inside `content` (one line). So read the label from the source line itself, `state.src` split at `token.map[1] - 1`, and strip `$$ {#…}` from the end of `content` when it is there.
- The `math_block` renderer: when `meta.target.label` is set, wrap the plugin's output in the `div`, moving the anchor onto it. Otherwise keep today's path.
- Check `lib/fitMath.ts` still finds `.katex-display` inside the wrapper (it queries descendants, so it should).

- [ ] **Step 4: Run all frontend tests**

Run: `npm --prefix frontend test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/equations.ts frontend/src/lib/equations.test.ts frontend/src/lib/renderer.ts frontend/public/style.css
git commit -m "equations: {#eq:} labels number display maths"
```

---

### Task 6: Rendering references, and the target list

**Files:**
- Create: `frontend/src/lib/crossrefTargets.ts`
- Modify: `frontend/src/lib/renderer.ts` (`RenderEnv`, `RenderResult`, a `crossref` renderer, registration order)
- Modify: `frontend/public/style.css` (`.crossref`, `.crossref-error`)
- Test: `frontend/src/lib/crossrefTargets.test.ts`, `frontend/src/lib/renderer.test.ts`, `frontend/src/Preview.test.ts`

**Interfaces:**
- Consumes: `TargetMeta`, `CrossrefTarget`, `referenceText` (Task 1); the `crossref` token (Task 2); the `meta.target` stamps (Tasks 3–5).
- Produces:
  - `crossrefPlugin(md: MarkdownIt): void` — a core rule pushed after `figures`, the table numbering rule and the equation rule. It fills `env.crossrefTargets: CrossrefTarget[]` in document order and `env.crossrefMissing: { key: string; line: number }[]`. `line` is the 1-based document line of the block holding the reference, offset by `sourceLineOffset`. References are looked for in all inline tokens, including footnotes.
  - `collectTargets(markdown: string): CrossrefTarget[]` — the same targets from a parser with the same plugins, for callers without a render (the editor at pick time, export). It handles frontmatter like `renderDocument`.
  - `RenderResult` gains `crossrefs: { targets: CrossrefTarget[]; missing: { key: string; line: number }[] }`.
  - The reference renders as `<a class="crossref" href="#<first label>">Figure 2</a>`; missing or mixed renders as `<span class="crossref-error">…</span>`.

`CrossrefTarget.line`, the line a label is appended to:
- image: the paragraph's last line;
- chart and Mermaid: the opening fence line;
- table: the caption line, or for a table without a caption, none (such a table is not a target);
- equation: the closing `$$` line.

- [ ] **Step 1: Write the failing tests**

- A reference before its target: `See @fig:b.\n\n![A](a.png){#fig:a}\n\n![B](b.png){#fig:b}` renders `<a class="crossref" href="#fig:b">Figure 2</a>`.
- `[@fig:a; @fig:b]` renders `Figures 1, 2`, linked to `#fig:a`.
- `@tbl:t` and `@eq:e` resolve to `Table 1` and `Equation 1`.
- `@fig:nope` renders `<span class="crossref-error">Figure ??</span>`, and `crossrefs.missing` is `[{ key: 'fig:nope', line: 1 }]`.
- `[@fig:a; @smith]` renders a `crossref-error` holding the raw text.
- A reference inside a footnote, a list item and a table cell each resolves (Review Focus 3).
- With frontmatter of 3 lines, `missing[0].line` counts document lines, not body lines.
- `collectTargets` on a document with an unlabelled captioned chart at line 5 returns `{ kind: 'fig', number: 1, label: null, caption: 'Yield', line: 5 }`. For an unlabelled equation it returns `{ kind: 'eq', number: null, tex: 'a+b', line: <closing line> }`.
- `Preview.test.ts`: clicking a rendered `a.crossref` scrolls the preview to the element with that id and does not call `Browser.OpenURL`. The existing fragment handler already does this; the test pins it for ids with a colon.

- [ ] **Step 2: Run to verify they fail**

Run: `npm --prefix frontend test -- src/lib/crossrefTargets.test.ts src/lib/renderer.test.ts src/Preview.test.ts`
Expected: the new cases FAIL.

- [ ] **Step 3: Implement**

- Number lookup goes through a map built from `env.crossrefTargets` where `label !== null && number !== null`, keyed by label.
- The `crossref` renderer rule in `renderer.ts` reads that map from `env`. Rendering happens after every core rule, so forward references resolve.
- Register order in `renderer.ts`: `source_line`, `figurePlugin`, `tableCaptionPlugin`, `equationPlugin`, `crossrefPlugin`, then outline and toc as now.
- CSS: `.crossref` uses the document link colour; `.crossref-error` uses the same variables as `.cite-error`.

- [ ] **Step 4: Run all frontend tests**

Run: `npm --prefix frontend test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/crossrefTargets.ts frontend/src/lib/*.test.ts frontend/src/lib/renderer.ts frontend/src/Preview.test.ts frontend/public/style.css
git commit -m "crossrefs: render references as linked numbers; list targets"
```

---

### Task 7: Word and LaTeX export carry labels

**Files:**
- Create: `frontend/src/lib/exportCrossrefs.ts`
- Modify: `frontend/src/lib/exportDiagrams.ts` (`replaceDiagramFences` writes the fence's label after the image)
- Modify: `frontend/src/App.svelte` (`buildConvertBody`: label first, then diagrams)
- Test: `frontend/src/lib/exportCrossrefs.test.ts`, `frontend/src/lib/exportDiagrams.test.ts`

**Interfaces:**
- Consumes: `collectTargets` (Task 6), `fenceLanguage`, `trailingLabel`.
- Produces: `labelForExport(markdown: string): string`. Every target with `label === null && number !== null` (captioned figures and tables only; unlabelled equations have a null number) gets `labelSuffix(block, '<kind>:halmos-<n>')` appended at its `line`. `n` counts per kind from 1 and skips labels already in the document.

- [ ] **Step 1: Write the failing tests**

- An unlabelled captioned image becomes `![A](a.png){#fig:halmos-1}`, and an author label elsewhere is untouched.
- An unlabelled captioned table caption line becomes `: Yield {#tbl:halmos-1}`.
- An uncaptioned figure, an unlabelled equation and a nested figure are unchanged.
- An image with alt text inside a list item is unchanged.
- `labelForExport` on a document with no targets returns the input unchanged.
- `replaceDiagramFences` on ```` ```vega-lite {#fig:yield} ```` with a title gives `![Yield](diagrams/1.png){#fig:yield}`.
- After `labelForExport`, an unlabelled captioned chart gives `![Yield](diagrams/1.png){#fig:halmos-1}`.

- [ ] **Step 2: Run to verify they fail**

Run: `npm --prefix frontend test -- src/lib/exportCrossrefs.test.ts src/lib/exportDiagrams.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement, and in `buildConvertBody` call `markdown = labelForExport(markdown)` before the `docx` branch.** This applies to both formats. The document in the editor is never changed.

- [ ] **Step 4: Run all frontend tests**

Run: `npm --prefix frontend test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/exportCrossrefs.ts frontend/src/lib/exportCrossrefs.test.ts frontend/src/lib/exportDiagrams.ts frontend/src/lib/exportDiagrams.test.ts frontend/src/App.svelte
git commit -m "export: label every numbered figure and table so Word numbers as the preview does"
```

---

### Task 8: The table builder's Caption field

**Files:**
- Modify: `frontend/src/lib/pipeTable.ts` (`PipeTable`, `serializePipeTable`)
- Modify: `frontend/src/Editor.svelte` (`enclosingTable` includes a caption line)
- Modify: `frontend/src/TableBuilder.svelte` (Caption field)
- Modify: `frontend/src/App.svelte` (`openTableBuilder`, `commitTable`)
- Test: `frontend/src/lib/pipeTable.test.ts`, `frontend/src/TableBuilder.test.ts`, `frontend/src/Editor.test.ts`

**Interfaces:**
- Consumes: `parseCaptionLine` (Task 4).
- Produces:
  - `PipeTable` gains `caption?: string` and `label?: string`.
  - `serializePipeTable` appends `\n\n: <caption>` and ` {#<label>}` when `caption` is non-empty.
  - `TableBlock` from `enclosingTable()` gains `caption: { caption: string; label: string | null } | null`. Its `to` and `text` extend over the blank line and the caption line when there is one. That works whether the cursor is in the table or on the caption line.

- [ ] **Step 1: Write the failing tests**

- `serializePipeTable({ …, caption: 'Yield', label: 'tbl:y' })` ends `\n\n: Yield {#tbl:y}`. With `caption: ''` it has no caption line.
- `enclosingTable()` on a table followed by a blank line and `: Yield {#tbl:y}` returns `caption: { caption: 'Yield', label: 'tbl:y' }` and `to` at the end of the caption line. It does the same with the cursor on the caption line.
- TableBuilder: a Caption text field, labelled "Caption", above the grid, seeded from `initial.caption`. Commit passes `caption` and keeps `label`.
- Review Focus 2: with `initial.label` set, clearing the caption shows the field error "This table is referred to; give it a caption or remove the references first." and does not call `oncommit`.
- With no label, clearing the caption commits a table with no caption line.

- [ ] **Step 2: Run to verify they fail**

Run: `npm --prefix frontend test -- src/lib/pipeTable.test.ts src/TableBuilder.test.ts src/Editor.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement.** `openTableBuilder` copies `block.caption` into `tableInitial`, and `tableOriginalText` covers the whole extended range, so `commitTable`'s exact-text check still guards it.

- [ ] **Step 4: Run all frontend tests**

Run: `npm --prefix frontend test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/pipeTable.ts frontend/src/Editor.svelte frontend/src/TableBuilder.svelte frontend/src/App.svelte frontend/src/*.test.ts frontend/src/lib/*.test.ts
git commit -m "table builder: Caption field, round-tripping the label"
```

---

### Task 9: The chart builder keeps a fence label

**Files:**
- Modify: `frontend/src/Editor.svelte` (`ChartBlock`, `enclosingChartBlock`)
- Modify: `frontend/src/App.svelte` (`chartTarget`, `commitChart`)
- Test: `frontend/src/Editor.test.ts`, `frontend/src/App.test.ts`

**Interfaces:**
- Consumes: `fenceLanguage` (Task 3).
- Produces: `ChartBlock` gains `info: string` (the full trimmed info string). `enclosingChartBlock` matches `fenceLanguage(info) === 'vega-lite'`.

- [ ] **Step 1: Write the failing tests**

- `enclosingChartBlock()` finds ```` ```vega-lite {#fig:yield} ```` and returns `info: 'vega-lite {#fig:yield}'`.
- Committing from the builder on that block writes ```` ```vega-lite {#fig:yield} ```` as the opening line.
- Inserting a new chart still writes ```` ```vega-lite ````.

- [ ] **Step 2: Run to verify they fail**

Run: `npm --prefix frontend test -- src/Editor.test.ts src/App.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement.** Store `info` on `chartTarget`. `commitChart` writes `'```' + (chartTarget?.info ?? 'vega-lite') + '\n'`. The moved-block guard keeps its `startsWith('```vega-lite')` check.

- [ ] **Step 4: Run all frontend tests**

Run: `npm --prefix frontend test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/Editor.svelte frontend/src/App.svelte frontend/src/*.test.ts
git commit -m "chart builder: keep the fence's {#fig:} label when updating a chart"
```

---

### Task 10: Picking a target: completion, label writing, the equation prompt, the menu item

**Files:**
- Create: `frontend/src/lib/crossrefCompletion.ts`
- Create: `frontend/src/EquationName.svelte`
- Modify: `frontend/src/Editor.svelte` (second completion source, `openCrossrefList()`, `insertReference()`)
- Modify: `frontend/src/App.svelte` (pass targets, handle the equation prompt, `menu:insert-crossref`)
- Modify: `menu.go` (Insert → Cross-reference…), `menu_test.go`
- Modify: `CLAUDE.md` (add `menu:insert-crossref` to the events list)
- Test: `frontend/src/lib/crossrefCompletion.test.ts`, `frontend/src/Editor.test.ts`, `frontend/src/App.test.ts`, `menu_test.go`

**Interfaces:**
- Consumes: `CrossrefTarget`, `slugLabel`, `equationLabel`, `KIND_WORD` (Task 1); `collectTargets` (Task 6); `RenderResult.crossrefs.targets` (Task 6).
- Produces:
  - `crossrefCompletionSource(get: () => CrossrefTarget[], all: () => boolean, pick: (t: CrossrefTarget, from: number, to: number) => void): CompletionSource`
  - `planReference(text: string, target: CrossrefTarget, from: number, to: number, eqName?: string): { changes: { from: number; to: number; insert: string }[] } | { error: 'moved' | 'taken' | 'invalid' | 'empty' }` — pure. `[from, to)` covers what was typed, including the `@` (empty when opened from the menu). It re-finds the target with `collectTargets(text)` by kind and number (equations by kind and `tex`). For an unlabelled target it appends `labelSuffix(block, label)` at the end of `line`, before any trailing whitespace. It replaces `[from, to)` with `@<label>`.
  - Editor: `openCrossrefList(): void` (sets the all-kinds flag, calls `startCompletion`); `applyReference(target, from, to, eqName?): 'ok' | 'moved' | 'taken' | 'invalid' | 'empty'` (one transaction, one undo step).
  - Go event `menu:insert-crossref` (payloadless), accelerator `shift+cmdorctrl+r`.

Completion behaviour:
- It triggers on `/@(fig|tbl|eq):([\w:.-]*)$/i` at the same boundaries as citations (not mid-word, not in code, frontmatter or maths). With the all-kinds flag set (from the menu), it triggers at the cursor with `from = to = pos`.
- Options are filtered to the typed kind and ordered by document order. In all-kinds mode, figures come first, then tables, then equations.
- Each option shows: label `Figure 2` / `Table 1` / `Equation 1` / `Unnamed equation`; detail = the caption. An equation shows the formula drawn with `katex.renderToString(tex, { throwOnError: false })`, cut to 60 TeX characters with `…`.
- Matching against what was typed is on the existing label, else the caption slug.
- Choosing an option with a label inserts `@<label>`. Without one: for a figure or table, `pick` calls `applyReference` straight away. For an equation, App opens `EquationName`.

`EquationName.svelte`: a `Dialog` titled "Name this equation". It has one text field (placeholder `bayes`) and the hint "Halmos writes {#eq:name} after the equation." Insert and Cancel buttons. Errors: `empty` "Type a name.", `invalid` "Use letters, digits, - _ or . only, no spaces.", `taken` "Another equation already has that name." The dialog stays open on an error.

The App guards are the same as `insertCitation`: refuse while a builder, the New dialog, the welcome pane or a pending action is open. A `moved` result toasts "That figure moved, so no reference was added." (the kind word follows the target).

- [ ] **Step 1: Write the failing tests**

- `planReference`, with the text `See @fig:\n\n![Yield](a.png)\n` and `from`/`to` covering `@fig:`, returns changes that make the text `See @fig:yield\n\n![Yield](a.png){#fig:yield}\n`.
- On a labelled target it only replaces `[from, to)`.
- When the live text has no figure with that number (Review Focus 4), it returns `{ error: 'moved' }`.
- For an equation, `eqName: 'bayes'` writes ` {#eq:bayes}` after the closing `$$`. `eqName: 'a b'` gives `{ error: 'invalid' }`.
- For a chart, the label goes on the opening fence line: ```` ```vega-lite {#fig:yield} ````.
- For a table, the label goes at the end of the caption line.
- Completion: `@fig:` lists only figures. `@eq:` lists equations including `Unnamed equation`. `@tbl:` with no captioned tables returns null. In maths or code it returns null.
- Editor: `applyReference` is one undo step (one `undo` restores the original text).
- `menu_test.go`: the Insert menu has "Cross-reference…" with accelerator `shift+cmdorctrl+r`, emitting `menu:insert-crossref`. Copy the pattern the existing Insert tests use.

- [ ] **Step 2: Run to verify they fail**

Run: `npm --prefix frontend test -- src/lib/crossrefCompletion.test.ts src/Editor.test.ts src/App.test.ts && go test ./.`
Expected: FAIL.

- [ ] **Step 3: Check the shortcut is free.** Run `grep -n 'shift+cmdorctrl+r' menu.go` and `grep -rn "Mod-Shift-r" frontend/node_modules/@codemirror/*/dist/index.js`. Expected: no output. If either matches, use `shift+cmdorctrl+x` after the same check, and note the change in the commit.

- [ ] **Step 4: Implement.** The source is added in the same `EditorState.languageData` entry as the citation source (`autocomplete: [citationSource, crossrefSource]`). App passes `() => lastRender.crossrefs.targets`. Insert → Cross-reference… goes after Citation… in `menu.go`, using `docEmit` as Citation… does.

- [ ] **Step 5: Run all tests and the type check**

Run: `npm --prefix frontend test && npm --prefix frontend run check && go test ./. && go build -o /dev/null .`
Expected: PASS, 0 errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/src menu.go menu_test.go CLAUDE.md
git commit -m "crossrefs: pick a target from a list; Halmos writes the label once"
```

---

### Task 11: Reporting missing references and shadowed keys

**Files:**
- Modify: `frontend/src/App.svelte` (status bar, `UnknownCitations` reuse, the bibliography-load warning)
- Modify: `frontend/src/UnknownCitations.svelte` (`title`, `hint`, and item formatting props)
- Test: `frontend/src/App.test.ts`

**Interfaces:**
- Consumes: `RenderResult.crossrefs.missing` (Task 6); `shadowedKeys` (Task 2).
- Produces:
  - A status-bar button `N missing cross-reference(s)`, beside the unknown-citation count. It shows even when there is no bibliography.
  - The same dialog component, titled "Missing cross-references", hint "No figure, table or equation has this label. Click one to go to it.", listing `@fig:x` and its line.
  - On each bibliography load that has shadowed keys, one toast: `These references can't be cited because their keys look like cross-references (fig:, tbl:, eq:, sec:): <keys, comma-separated, at most 5 then "and N more">. Rename them in your reference manager.` It is not shown again for the same set of keys.

- [ ] **Step 1: Write the failing tests** for the button text (singular and plural), the dialog title, jump-to-line, and the toast (shown once for the same key set, shown again when the set changes).

- [ ] **Step 2: Run to verify they fail**

Run: `npm --prefix frontend test -- src/App.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement.** The missing list comes from the render result each render, which is already debounced, so no extra parse is needed.

- [ ] **Step 4: Run all frontend tests and the type check**

Run: `npm --prefix frontend test && npm --prefix frontend run check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/App.svelte frontend/src/UnknownCitations.svelte frontend/src/App.test.ts
git commit -m "crossrefs: report missing labels; warn on bibliography keys that look like references"
```

---

### Task 12: Docs, changelog, roadmap, and a check in the app

**Files:**
- Modify: `docs/authoring.md`, `docs/getting-started.md`, `docs/test-document.md`
- Modify: `CHANGELOG.md` (Unreleased / 0.15.0 section)
- Modify: `ROADMAP.md` (tick both v0.15.0 items) and `../ROADMAP.md` (both product rows to done)
- Modify: `CLAUDE.md` (the `lib/figures.ts` paragraph: colon captions, fence first-word matching, and the new modules `crossrefs.ts`, `tableCaptions.ts`, `equations.ts`, `crossrefTargets.ts`)

- [ ] **Step 1: Docs.**
  - `authoring.md`: table captions (blank line, then `: Caption`); labels and references with examples of each form; that Halmos names figures and tables from the caption and asks for equation names; which equations are numbered; that `@fig` without a colon is still a citation; the LaTeX limit ("charts and diagrams stay as code in LaTeX, so a reference to one shows as missing there"); that bibliography keys starting `fig:`/`tbl:`/`eq:`/`sec:` can't be cited. Replace the advice not to type "Figure 3" by hand with a pointer to references.
  - `getting-started.md`: one short paragraph.
  - `test-document.md`: a captioned table, a labelled chart, image and equation, references to each (one forward), one grouped reference and one missing reference.

- [ ] **Step 2: CHANGELOG and roadmaps.** Do guarded single-block replacements. Compare `grep -c '^- \['` and `grep '^## '` before and after, in both roadmaps. Then run `../bin/check-roadmaps`. Expected: `ok`.

- [ ] **Step 3: Full verification**

Run: `npm --prefix frontend test && npm --prefix frontend run check && go test ./. && go build -o /dev/null .`
Expected: all PASS.

- [ ] **Step 4: Check in the app.** Run `wails3 task build && wails3 task run`. Confirm the binary is new with `strings "bin/Halmos Editor" | grep crossref-error`. Open `docs/test-document.md` and check:
  - captions read with colons;
  - references show numbers and clicking one scrolls to the target;
  - `@fig:` lists figures;
  - picking an unlabelled figure writes the label;
  - Insert → Cross-reference… (⇧⌘R) lists all kinds;
  - naming an equation works.

  Capture only the app window (`screencapture -l <windowid>`).

- [ ] **Step 5: Quick Look.** Run `wails3 task quicklook:test`. Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add docs CHANGELOG.md ROADMAP.md CLAUDE.md
git commit -m "docs: table captions and cross-references"
git -C .. add ROADMAP.md && git -C .. commit -m "roadmap: table captions and cross-references done"
```

- [ ] **Step 7: Follow-up note, not done here.** Re-vendoring the renderer in the portal (`npm --prefix hermesportal/tools/hermes-docs run check:vendor -- --write`) is a portal-session task. Say so in the hand-over.
