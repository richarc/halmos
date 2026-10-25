# Table captions and cross-references

Design for two v0.15.0 roadmap items, built together: "Numbered table
captions" and "Cross-references to figures, tables and equations" (sections
were taken out of it; see Non-goals). Agreed with the product owner on
2026-10-25.

## Why

An author writing a paper refers mostly to figures and equations: a claim
about some data points at the chart or plot of it. Halmos numbers figures
but gives no way to refer to one, and the authoring guide rightly says not
to type "Figure 3" by hand, so there is no correct way to write "as shown in
Figure 3". Tables have no caption and no number, and journals require both.

The aim is that referring to a figure, table or equation works the way
citing works today: start typing, pick from a list, and get a reference
that renders as a linked "Figure 3" and renumbers itself, in the preview,
PDF, HTML, Word and LaTeX.

## Goals

- Tables can carry a caption and are numbered "Table 1, 2, …", separately
  from figures.
- Figures (charts, Mermaid diagrams, captioned images), tables and display
  equations can be referred to, and the reference shows the target's
  current number, linked to it.
- The author never has to invent a name for a figure or a table: Halmos
  makes one from the caption.
- Picking the target from a list, as with citations.
- Everything written in the document is Pandoc / pandoc-crossref syntax, so
  the portal's Word and LaTeX conversion (already built and deployed; see
  the API contract's "Cross-references" section) resolves it unchanged.

## Non-goals

- **Section references.** Headings are not numbered today, so "see Section
  3" would point at a number the reader cannot see. Numbering headings, its
  format and style, and section references get their own roadmap item.
- Changing how citations are written, listed or formatted.
- Custom reference words ("Fig." instead of "Figure") or per-document
  numbering styles.
- Subfigures, figure or table lists ("List of Figures").

## Anti-goals

- A syntax only Halmos understands. If Pandoc would not read it the same
  way, it is wrong.
- Mixing figures and equations into the citation list. The author asked
  for them to be kept apart.
- A name that changes under existing references. Once written, a label is
  never rewritten by Halmos.
- Numbering every display equation. A page of working must not fill with
  numbers.

## What the author does

### Table captions

- A caption is a line starting with `: ` directly after the table (Pandoc's
  `table_captions` form, after the table rather than before it):

  ```markdown
  | Group   | Yield |
  | ------- | ----: |
  | Control |  21.3 |

  : Yield by group
  ```

- The preview, PDF and HTML show it **above** the table, as journals set
  table captions, in the same style and wording pattern as figure captions:
  "Table 1: Yield by group".
- **Captions use a colon, for figures too.** `figureLabel` in
  `lib/figures.ts` changes from "Figure 2 — Caption" to "Figure 2: Caption",
  which is what papers use and what the portal's Word output already writes,
  so the preview, PDF, HTML, Word and LaTeX agree. This changes how every
  existing captioned figure reads in the preview (product owner's decision,
  2026-10-25).
- Tables are numbered in document order, separately from figures. A table
  without a caption has no number and renders exactly as today (the same
  rule as figures: a caption is what makes it numbered).
- The table builder (`TableBuilder.svelte`, `lib/pipeTable.ts`) gains a
  Caption field. It reads an existing caption line when the builder opens
  on a table and writes it back, keeping any `{#tbl:…}` label on that line.
  Today a caption line after a table is parsed by markdown-it as a
  paragraph, so the caption must be recognised before that happens.

### Referring to something

- Typing `@` or `[@` shows the citation list exactly as today, and only
  citations.
- Typing `@fig:`, `@tbl:` or `@eq:` (the colon is what switches) shows a
  list of just that kind, in document order. Each entry shows the number
  and the caption, for example "Figure 2: Yield by variety". Equations
  show the formula drawn by KaTeX (or its start, if long).
- **Insert → Cross-reference…**, with a keyboard shortcut, opens a list of
  all figures, tables and equations together, so the author need not
  remember the prefixes. The shortcut is the builder's call (check
  `defaultKeymap` and `foldKeymap`, as `hermes/CLAUDE.md` says). Choosing an
  entry inserts the reference at the cursor.
- Typing `@fig` without the colon is still a citation search, so a
  bibliography key such as `figueroa2019` keeps working.
- The reference written is the bare form, `@fig:yield-by-variety`. Pandoc's
  bracketed forms (`[@fig:a]`, `[@fig:a; @fig:b]` for "Figures 1, 2", and
  `@Fig:a` for a capital at a sentence start) are also read and rendered
  when the author types them, but the list inserts the bare form.

### Names (labels)

- **Figures and tables:** when the author picks a target that has no label
  yet, Halmos makes one from its caption and writes it into the document
  beside the target, in the same edit as the reference. The name is the
  prefix plus a slug of the caption (`Yield by variety, with 95% confidence
  intervals` → `fig:yield-by-variety-with-95-confidence-intervals`, or a
  shortened form; the length rule is the builder's call), made unique in
  the document with `-2`, `-3`. After that the label is fixed: rewording the
  caption does not change it.
- **Equations:** display maths has no caption, so when the author picks an
  unlabelled equation, Halmos asks for a short name in a small prompt
  (e.g. `bayes` → `eq:bayes`), checks it is unique and a valid key, then
  writes the label and the reference.
- Only a captioned figure or table can be referred to, because the caption
  is what makes it numbered. An uncaptioned one does not appear in the
  list.

Where each label is written, in Pandoc's forms:

| Target | Label |
|---|---|
| Image | `![Caption](plot.png){#fig:name}` |
| Vega-Lite chart | on the opening fence line: ```` ```vega-lite {#fig:name} ```` |
| Mermaid diagram | on the opening fence line: ```` ```mermaid {#fig:name} ```` |
| Table | at the end of the caption line: `: Caption {#tbl:name}` |
| Display maths | after the closing `$$` on the same line: `$$ … $$ {#eq:name}` |

The fence-line form for charts and diagrams is this design's choice, not the
product owner's (the mockup showed `"name"` inside the chart's JSON): it is
the same form for both kinds of block, the chart builder does not need to
understand it, and GitHub and other renderers ignore everything after the
first word of the info string. Two consequences for the builder: the
renderer and `figures.ts` match the info string's first word rather than
the whole string (`token.info.trim() === 'vega-lite'` today), and
`commitChart` must keep the opening line's label when it replaces a block.

### What a reference renders as

- Preview, PDF and HTML export: "Figure 2", "Table 1", "Equation 1", as a
  link to the target (`#fig:name`, so each target needs that id).
  `Preview.svelte`'s link handler must scroll the preview to an in-page
  `#` link rather than send it to the browser.
- A labelled display equation shows its number, "(1)", at the right, and
  equations are numbered in document order among the labelled ones. An
  unlabelled equation is not numbered. Since Halmos writes the label the
  first time the equation is referred to, in practice an equation gets a
  number when it is first referred to; deleting the reference later leaves
  the label and the number. This matches pandoc-crossref, which numbers
  labelled equations, so Word and the preview agree (builder-check call;
  the product owner agreed "only referred-to equations", and this is the
  same in practice).
- A reference to a label that does not exist renders as a visible error in
  the reference's place ("Figure ??" style, wording the builder's call) and
  is reported the same way an unknown citation is today.
- Word and LaTeX: the portal resolves it (Word: "Figure 1" text linked to a
  bookmark; LaTeX: `\label`/`\ref`). The editor's job is to send the
  document with labels in Pandoc's form.

## Constraints

- **The citation parser must draw the portal's line**: any key starting
  `fig:`, `tbl:`, `eq:` or `sec:`, in any case, is a cross-reference and
  never a citation, whatever the bibliography holds (API contract). That
  covers `lib/citations.ts` (rendering), `lib/citationKeys.ts` (the unknown
  citation check) and `lib/citationCompletion.ts`. `sec:` is included even
  though section references are not built, so that a `@sec:` key never
  turns into a citation. A bibliography key that itself starts with one of
  these prefixes gets a warning in the editor ("this key can't be cited
  because it looks like a cross-reference; rename it in your reference
  manager"), not silent misrendering.
- **Word export of charts and diagrams**: `lib/exportDiagrams.ts` replaces
  each chart or Mermaid block with a PNG image whose alt text is the
  caption. It must carry the label too (`![Caption](chart-1.png){#fig:name}`),
  or references to charts break in Word.
- **Word and LaTeX must number as the preview does.** pandoc-crossref
  numbers only labelled figures and tables, while the preview numbers every
  captioned top-level one. So the export request (`lib/exportRequest.ts`,
  `lib/exportDiagrams.ts`) gives every captioned top-level figure and table
  that has no label a generated one in the copy it sends (a name that cannot
  collide with an author's, e.g. a reserved prefix after the colon), and
  leaves the document itself unchanged. A captioned figure nested in a list
  or quote gets none, matching the preview. No portal change.
- **LaTeX export of charts and diagrams**: today these blocks stay as code
  in the `.tex`, so they are not figures there and a reference to one
  cannot resolve. Out of scope to fix here; the authoring guide must say
  so, and the roadmap gets a note.
- Numbering must be computed fresh on every render, as figure numbering is
  (`numberFigures` in `lib/figures.ts`): a reference earlier in the
  document than its target still shows the right number, so the numbers
  are worked out before references are rendered.
- Only top-level blocks are numbered, as for figures today (a chart inside
  a list item or quote is not a figure).
- The renderer is also used by Quick Look (`quicklook/`), the HTML export
  and, vendored, by the portal's guides. Quick Look must not break; the
  portal re-vendor is a follow-up in the portal repository.
- The label syntax must not break documents written before this change:
  a document with no labels and no `: ` caption line after a table renders
  exactly as before. A table that already has such a line was already
  captioned in Pandoc's terms; it now shows "Table 1: …" in the preview,
  which is intended. Existing figure captions change from a dash to a colon,
  also intended.
- Frontmatter is not involved; no new keys.

## Already decided

- References use pandoc-crossref syntax, labels as in the table above.
- Citations and cross-references are kept apart: `@`/`[@` is citations
  only; `@fig:`/`@tbl:`/`@eq:` (with the colon) switch lists; Insert →
  Cross-reference… lists all three kinds.
- Figure and table names are made from the caption by Halmos, written into
  the document once (on first reference), and never changed after.
- Equation names are typed by the author when first referring to one.
- Equations are numbered once labelled, which Halmos does on first
  reference (see "What a reference renders as").
- Tables are numbered separately from figures; captions sit above tables.
- Captions read "Figure 2: Caption" and "Table 1: Caption", with a colon,
  everywhere; the preview's dash goes.
- No section references in this round; a separate roadmap item covers
  heading numbering and section references.

## Left to the builder

- The slug rule (length cap, characters kept, accents) and the uniqueness
  suffix.
- The reference words and the "missing label" wording, in line with the
  portal's Word output ("Figure", "Table", "Equation").
- Whether the reference list and the label writer live in one module or
  several; how the numbering pass shares its results with the reference
  renderer and the completion list.
- How the equation-name prompt looks (inline popover or small dialog),
  within the existing design system.
- The shortcut for Insert → Cross-reference….
- Whether the citation completion and the cross-reference completion are
  one CodeMirror source or two.
- Test coverage, beyond: existing documents render unchanged; the citation
  parser never treats a `fig:`/`tbl:`/`eq:`/`sec:` key as a citation; a
  reference before its target gets the right number; a Word export of a
  chart carries its label.

## Docs and roadmap

- `docs/authoring.md` and `docs/getting-started.md`: table captions,
  labels, references, which equations are numbered, the LaTeX-chart limit.
- `docs/test-document.md`: examples of each.
- `CHANGELOG.md`, `hermes/ROADMAP.md` (tick both items; add "Numbered
  headings and section references"), and the product roadmap rows.
