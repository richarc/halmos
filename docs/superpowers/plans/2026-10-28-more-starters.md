# More Starters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Five more starters in File → New…'s Start from list: Assignment, Lab report, Essay, Research proposal, Thesis or dissertation.

**Architecture:** Each starter becomes one `STARTERS` entry in `frontend/src/lib/documentTemplate.ts` that carries its own title placeholder, metadata, optional header and body; `newDocumentText` and `titleSelection` read the entry instead of branching on `'article'`. `NewDocument.svelte` already builds its list from `STARTERS` and needs no change.

**Tech Stack:** TypeScript, Svelte 5, vitest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-28-more-starters-design.md`

## Global Constraints

- Blank's text stays byte-for-byte what it is today (`NEW_DOCUMENT_TEMPLATE` without furniture).
- Research article's text stays exactly what it is today.
- Order: `blank`, `article`, `assignment`, `lab-report`, `essay`, `proposal`, `thesis`.
- Labels: "Blank", "Research article", "Assignment", "Lab report", "Essay", "Research proposal", "Thesis or dissertation".
- `furnitureByDefault`: false for Blank, true for every other starter.
- Title placeholders: article "Title of the paper"; assignment "Assignment title"; lab report "Title of the experiment"; essay "Title of the essay"; proposal "Title of the proposal"; thesis "Title of the thesis". Always written quoted: `title: "<placeholder>"`.
- No `#` title heading; sections `##`, subsections `###`; no "References" heading.
- No HTML comments anywhere in starter text (`html: false` shows them as text).
- Chart data inline only (charts refuse every URL); no starter brings any file.
- Header placeholders are only `{title}`, `{date}`, `{page}`, `{pages}`.
- Hints, verbatim from the spec:
  - assignment: "Name, course and due date; numbered questions with parts; a worked equation."
  - lab-report: "Aim, method, results with a table and a chart, discussion."
  - essay: "Title, name and course; introduction, body, conclusion."
  - proposal: "Background, aims, methods, timeline and expected outcomes."
  - thesis: "Title page, abstract, contents, chapters and appendices."
- Do not run prettier.

## Review Focus

1. A title typed with a colon (`Lab 3: Pendulum`) over any starter's selected placeholder must leave valid frontmatter — pinned by the "colon in the title" test in Task 1.
2. Assignment with "Page header and footer" unticked must have no `header:` or `footer:` at all, not the generic `{title}` header — pinned in Task 1.
3. Two starters' sample labels must not collide with each other's text or with themselves (a duplicate label is reported by the renderer) — pinned by `crossrefs.duplicates` being empty in Task 1.
4. The thesis's `[[toc]]` must produce the contents list after the opening paragraph, not leave a literal `[[toc]]` — pinned in Task 1.
5. A starter with a bibliography must keep the `bibliography:`/`csl:` keys live and parseable alongside its own metadata — pinned by the matrix test in Task 1.

---

### Task 1: Starters as data, and the five new ones

**Files:**
- Modify: `frontend/src/lib/documentTemplate.ts`
- Test: `frontend/src/lib/documentTemplate.test.ts`

**Interfaces:**
- Produces:
  - `type StarterId = 'blank' | 'article' | 'assignment' | 'lab-report' | 'essay' | 'proposal' | 'thesis'`
  - `interface Starter { id: StarterId; label: string; hint: string; furnitureByDefault: boolean; titlePlaceholder?: string; metadata?: string; header?: string; body?: string }` — `metadata` is frontmatter lines placed before the bibliography keys (without the `title:` line, which `newDocumentText` writes from `titlePlaceholder`), `header` replaces the generic `"{title}"` header when furniture is on, `body` follows the closing fence. Exact field names are the builder's call if the tests below still read naturally; Task 2 uses only `id`, `label`, `hint`, `furnitureByDefault`.
  - `newDocumentText(bibliography: string | null, csl: string, options?: { starter?: StarterId; pageFurniture?: boolean }): string` — signature unchanged.
  - `titleSelection(text: string): { from: number; to: number } | null` — finds the first `title: "<p>"` line for any starter's placeholder `p`.

- [ ] **Step 1: Write the failing tests** in the `describe('starters', …)` block.

Replace `'lists Blank and Research article, in that order'` with:

```ts
it('lists the seven starters in order, header and footer on for all but Blank', () => {
  expect(STARTERS.map((s) => s.id)).toEqual(['blank', 'article', 'assignment', 'lab-report', 'essay', 'proposal', 'thesis'])
  expect(STARTERS.map((s) => s.label)).toEqual([
    'Blank', 'Research article', 'Assignment', 'Lab report', 'Essay', 'Research proposal', 'Thesis or dissertation',
  ])
  expect(STARTERS.map((s) => s.furnitureByDefault)).toEqual([false, true, true, true, true, true, true])
})
```

Add a pinned copy of today's article text (built from the current code before changing it: run `newDocumentText('paper.bib', 'apa', { starter: 'article', pageFurniture: true })` and `(null, 'apa', { starter: 'article' })` once and paste both strings as literals) in a test named `'keeps the research article exactly as before'`.

Add a matrix over every non-blank starter, each bibliography (`null`, `'paper.bib'`) and each `pageFurniture` value:

```ts
const titles: Record<string, string> = {
  article: 'Title of the paper', assignment: 'Assignment title', 'lab-report': 'Title of the experiment',
  essay: 'Title of the essay', proposal: 'Title of the proposal', thesis: 'Title of the thesis',
}
for (const s of STARTERS.filter((s) => s.id !== 'blank')) {
  it(`starts ${s.label} cleanly`, () => {
    for (const bib of [null, 'paper.bib']) for (const pageFurniture of [false, true]) {
      const text = newDocumentText(bib, 'apa', { starter: s.id, pageFurniture })
      const fm = parseFrontmatter(text)
      expect(fm.title).toBe(titles[s.id])
      expect(fm.authors?.[0]?.name).toBe('Your Name')
      expect(fm.bibliography).toBe(bib ?? undefined)
      expect(fm.footer).toBe(pageFurniture ? 'Page {page} of {pages}' : undefined)
      if (!pageFurniture) expect(fm.header).toBeUndefined()
      const sel = titleSelection(text)!
      expect(text.slice(sel.from, sel.to)).toBe(titles[s.id])
      const result = renderDocument(text)
      expect(result.crossrefs.missing).toEqual([])
      expect(result.crossrefs.duplicates).toEqual([])
      expect(text).not.toMatch(/<!--|^# /m)
    }
  })
  it(`keeps ${s.label}'s frontmatter valid with a colon typed in the title`, () => {
    const text = newDocumentText(null, 'apa', { starter: s.id })
    const sel = titleSelection(text)!
    const typed = text.slice(0, sel.from) + 'Lab 3: Pendulum' + text.slice(sel.to)
    expect(parseFrontmatter(typed).title).toBe('Lab 3: Pendulum')
  })
}
```

Add one test per starter for its specifics (assert on `parseFrontmatter` and `renderDocument(text).crossrefs.targets` / `.html`):

- `'assignment: student and due date, header names the student, a numbered equation'`: authors `[{ name: 'Your Name', affiliation: 'Student ID · Course code' }]`; `fm.date === 'Due date'`; with furniture `fm.header === 'Your Name · {title}'`; `##` headings are `['Question 1', 'Question 2']`; html contains `<strong>(a)</strong>` and `<strong>(b)</strong>`; targets contain exactly one equation, number 1, and a reference to it resolves (no misses, covered by the matrix).
- `'lab report: sections, Table 1 and Figure 1, both referenced'`: `##` headings `['Aim', 'Background', 'Materials and method', 'Results', 'Discussion', 'Conclusion']`; targets include a `tbl` numbered 1 and a `fig` numbered 1; html contains `Table 1` and `Figure 1` as reference links (`class="crossref"` or whatever `crossrefTargets.ts` emits — read it, assert on that); the text contains no `"url"` key.
- `'essay: introduction, two body sections, conclusion, no maths or charts'`: `##` headings `['Introduction', 'First argument', 'Second argument', 'Conclusion']`; text contains no `$$` and no ```` ```vega-lite ````.
- `'research proposal: abstract and a captioned timeline'`: `fm.abstract` is set; `##` headings `['Background', 'Aims', 'Methods', 'Timeline', 'Expected outcomes']`; targets include a `tbl` numbered 1.
- `'thesis: contents after the opening paragraph, chapters and an appendix'`: `fm.toc === true` (or however `parseFrontmatter` exposes it; read it); `fm.abstract` set; authors `[{ name: 'Your Name', affiliation: 'Department, Institution' }]`; the body's first paragraph contains `Supervisor:`; in the rendered html the contents list's element comes after that paragraph and no literal `[[toc]]` remains; `##` headings (excluding `Abstract` and the contents heading if any) are `['Acknowledgements', 'Introduction', 'Literature review', 'Methodology', 'Results', 'Discussion', 'Conclusion', 'Appendix A']` (a subtitle after "Appendix A" such as "Appendix A: Supplementary material" is fine; then assert with `startsWith`).

Keep every existing test in the file; the existing article tests must pass untouched.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/lib/documentTemplate.test.ts`
Expected: FAIL — the new starter ids are not in `STARTERS`; existing tests pass.

- [ ] **Step 3: Implement in `frontend/src/lib/documentTemplate.ts`**

- Widen `StarterId` and `Starter` as in Interfaces. Move `ARTICLE_METADATA`/`ARTICLE_BODY` into the article entry; replace the `starter === 'article'` branches with a lookup of the entry. Assemble: `---\n` + `title: "<placeholder>"\n` (when there is one) + metadata + keys + furniture + `---\n` + body. Furniture is the entry's `header` (if any) in place of `"{title}"`, plus the footer.
- `titleSelection` searches for each starter's placeholder line; drop the single `TITLE_PLACEHOLDER` constant or keep it as the article's.
- Write the five starters' text to the spec's "The starters" section and the tests above. Prompts: one short sentence where the spec names one, in the article's tone; most headings have no prompt. Lab report data: about five rows, two numeric columns, the same numbers in the table and the chart's inline `values`; chart has a `title` and a `{#fig:…}` label on the fence line. Assignment's equation: `$$ … $$ {#eq:…}` with a sentence citing `@eq:…`. Proposal's timeline table caption `: … {#tbl:…}`. Use distinct label names per starter.
- Update the module comments that describe "Blank and Research article" so they describe the list.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/lib/documentTemplate.test.ts`
Expected: PASS, all tests.

- [ ] **Step 5: Run the whole suite and type check**

Run: `cd frontend && npx vitest run && npx svelte-check --threshold error`
Expected: `App.test.ts`'s `'offers Blank and Research article, Blank first, with the box unticked'` may fail on the option count — that is Task 2's; everything else passes, 0 errors. If it fails, note it in the commit message body and leave it for Task 2.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/documentTemplate.ts frontend/src/lib/documentTemplate.test.ts
git commit -m "starters: assignment, lab report, essay, proposal and thesis"
```

### Task 2: The dialog's list, docs, changelog and roadmap

**Files:**
- Modify: `frontend/src/App.test.ts` (the New dialog starter tests, around line 541–610)
- Modify: `docs/getting-started.md` (step 1 of File → New…, around line 33)
- Modify: `docs/authoring.md` (the "Start from: Research article" sentence, around line 51)
- Modify: `CHANGELOG.md` (`[Unreleased]` → `### Added`)
- Modify: `ROADMAP.md` (tick the v0.16.0 item "More starters in the New dialog")
- Modify: `../ROADMAP.md` (product repository: the row for this item)

**Interfaces:**
- Consumes: `STARTERS` ids and labels from Task 1.

- [ ] **Step 1: Update the App test** `'offers Blank and Research article, Blank first, with the box unticked'` → `'offers the seven starters, Blank first, with the box unticked'`: options' values equal Task 1's id list and their text equals the label list; Blank selected; box unticked. Add `'ticks the box for the assignment and shows its hint'`: choose `assignment`, the page-furniture checkbox is checked and the hint paragraph reads the assignment hint. Add `'opens a new thesis with its title selected'` following the existing article create-flow test (around line 584): choose `thesis`, create without a bibliography, and assert the saved content equals `newDocumentText(null, 'apa', { starter: 'thesis', pageFurniture: true })` and the editor selection covers "Title of the thesis" (copy how the existing article test checks selection, if it does; otherwise assert content only).

- [ ] **Step 2: Run** `cd frontend && npx vitest run src/App.test.ts -t "starter|seven|thesis|assignment"` — Expected: PASS (Task 1's code already supplies the entries; if a new test passes before any change, that is expected here, since this task changes tests and docs only).

- [ ] **Step 3: Docs.** `getting-started.md` step 1: after the Research article sentence, one sentence per new starter, saying what it starts with in the spec's words (Assignment: name, student ID and course, due date, numbered questions with parts and a worked equation, the name in the page header; Lab report: …; Essay: …; Research proposal: …; Thesis or dissertation: contents list, degree and supervisor in the first paragraph, chapters and an appendix). Keep "The document opens with the title selected" as a sentence that now covers all of them. Step 2: "It is ticked for every starter except Blank". `authoring.md`: "File → New… with any starter except Blank fills in `title` and `author` (and `abstract` for an article, proposal or thesis, `date` for an assignment's due date) for you". `CHANGELOG.md`: under `[Unreleased]` → `### Added`, one entry: "Five more starters in File → New…: Assignment, Lab report, Essay, Research proposal, and Thesis or dissertation." followed by one sentence each, wrapped at the file's width.

- [ ] **Step 4: Roadmap.** In `ROADMAP.md` tick `- [ ] **More starters in the New dialog: Assignment, and the other` and add after the item's last line (`list becomes a list with a short preview once there are seven.`) a `*Done 2026-10-28 (not yet released):*` note: five starters; data inline (charts take no URLs); no preview, the dropdown and hint suffice at seven. Guarded replacement (`assert s.count(old)==1`); `grep -c '^- \['` unchanged, `grep '^## '` unchanged. In `../ROADMAP.md`, the row containing `More starters` (or `starters`): status `done in the editor 2026-10-28 (not yet released)`. Run `../bin/check-roadmaps` — Expected: `ok`.

- [ ] **Step 5: Whole suite**

Run: `cd frontend && npx vitest run && npx svelte-check --threshold error && cd .. && go test . >/dev/null && echo go ok`
Expected: all pass, 0 errors, `go ok`.

- [ ] **Step 6: Commit** (hermes; the product repository's row is committed separately in `..`)

```bash
git add frontend/src/App.test.ts docs/getting-started.md docs/authoring.md CHANGELOG.md ROADMAP.md
git commit -m "starters: the dialog's list, docs and roadmap"
cd .. && git add ROADMAP.md && git commit -m "roadmap: more starters done in the editor" && cd hermes
```
