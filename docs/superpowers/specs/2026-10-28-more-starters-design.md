# More starters in the New dialog — design

Written from the v0.16.0 roadmap item; the author asked for no questions,
so every decision below that the roadmap does not state is marked
*My call*.

## Why

File → New… offers two starters: Blank and Research article. Students and
researchers write other common shapes too: assignments, lab reports,
essays, theses and proposals. Each has a structure the author otherwise
types from memory every time. Overleaf's gallery (checked 2026-10-28)
groups its templates as journal articles, theses, assignments, CVs,
letters, posters, presentations, books, newsletters, calendars and
bibliographies; the ones below are those that suit a Markdown writer with
citations, equations and charts.

## Goals

- Five new starters in the New dialog's **Start from** list:
  Assignment, Lab report, Essay, Research proposal, Thesis or dissertation.
- Each opens with its title placeholder selected, as Research article does.
- Each renders cleanly from the first moment: no "Figure ??", no missing
  bibliography toast, valid frontmatter, in the preview and in every export.
- Each shows what Halmos can do where that shape normally needs it (an
  equation in an assignment, a captioned table and chart in a lab report,
  a contents list in a thesis), as a model the author edits or deletes.

## Non-goals

- CVs, letters, posters, presentations, newsletters and calendars: they
  depend on page layout that Markdown export does not control. Books are
  the thesis starter at more length.
- New frontmatter keys or title-block fields (degree, supervisor, student
  ID, course). The title block shows `title`, `author` (name and
  affiliation), `date` and `abstract`, and the Word and LaTeX exports get
  the same from Pandoc. Adding keys would mean changing the title block and
  both exports; out of scope.
- New page-header placeholders. The header understands `{title}`, `{date}`,
  `{page}` and `{pages}` only.
- A preview of each starter in the dialog (see "The dialog").
- Starters that bring separate files (see "Data").
- User-defined or downloadable starters.

## Anti-goals

- A starter that opens with an error, a warning, a `??` reference, or a
  toast. A new document must look finished, even if empty.
- Blank changing in any way: its text stays byte-for-byte what it is today.
- Placeholder text that reads like filler. Prompts are short, in the
  Research article's tone ("What is known, what is not, and the question
  this paper answers."), and only where they help; most sections are a
  heading and nothing else.

## The dialog

*My call:* the dropdown and its one-line hint stay as they are. Seven
entries fit a dropdown, and the hint already says what each contains. A
list with a preview is more work than seven entries need; revisit if the
list grows past about ten or journal profiles arrive.

Order (*my call*, most general first, then by how often students meet them):
Blank, Research article, Assignment, Lab report, Essay, Research proposal,
Thesis or dissertation.

"Page header and footer" is ticked by default for every starter except
Blank (the roadmap asks for it on Assignment; *my call* for the rest:
each is a document that gets printed or submitted as a PDF).

## Data

The roadmap asked whether the lab report can bring a sample data file.
It cannot usefully: since v0.15.0 a chart refuses every URL and takes its
data inline only (security fix S1). So the lab report's chart writes its
data inline, in the Vega-Lite block. *My call:* no starter brings any file
besides the `.bib` the dialog already offers.

## The starters

Every starter follows the Research article's rules:

- The title is a quoted placeholder in the frontmatter, selected on open.
  Each starter has its own wording (below); `titleSelection` finds
  whichever starter's placeholder the text contains.
- No `#` heading for the title; the title block is the title. Sections are
  `##`, subsections `###`.
- No "References" heading: the reference list is added after the text.
- The bibliography keys and the page-furniture lines are added by the
  dialog, as now.
- *My call:* no `date:` key where the date would be today's (the webview
  cannot format it in the Mac's region). Where a date is a fixed thing the
  author types (a due date), it is a placeholder.

### Assignment

Hint: "Name, course and due date; numbered questions with parts; a worked
equation."

- Frontmatter: `title: "Assignment title"`; `author:` one entry, name
  "Your Name", affiliation "Student ID · Course code"; `date: "Due date"`.
- Header, *my call:* the title plus the student, so every printed page
  identifies its owner: `header: "Your Name · {title}"`. The name is typed
  twice (author and header); the alternative was a new `{author}`
  placeholder, which is out of scope. When "Page header and footer" is
  unticked, neither line is added, as now.
- Body: `## Question 1` with parts `**(a)**` and `**(b)**` as paragraphs,
  then `## Question 2`. Part (a) of Question 1 holds a short worked
  equation as a labelled display equation, `$$ … $$ {#eq:…}`, with a
  sentence referring to it by `@eq:…`, so the model shows numbering and
  cross-referencing.
- *My call:* parts as bold paragraph labels, not `###` headings: they
  are short, and headings would crowd the outline.

### Lab report

Hint: "Aim, method, results with a table and a chart, discussion."

- Frontmatter: `title: "Title of the experiment"`; `author:` name and
  affiliation as Research article.
- Sections: Aim, Background, Materials and method, Results, Discussion,
  Conclusion.
- Results holds one small data set (about five rows, two numeric columns,
  e.g. a reading against time) twice: as a pipe table with a caption line
  `: Caption {#tbl:…}`, and as a Vega-Lite line or point chart with a
  `title` (which makes it a numbered figure) and a `{#fig:…}` label. One
  sentence refers to both with `@tbl:…` and `@fig:…`. The data is inline.

### Essay

Hint: "Title, name and course; introduction, body, conclusion."

- Frontmatter: `title: "Title of the essay"`; `author:` name "Your Name",
  affiliation "Course code".
- Sections: Introduction, two body sections with placeholder headings
  (e.g. "First argument", "Second argument"), Conclusion. One prompt
  under Introduction. No equations, no charts.

### Research proposal

Hint: "Background, aims, methods, timeline and expected outcomes."

- Frontmatter: `title: "Title of the proposal"`; `author:` name and
  affiliation; `abstract:` one prompt line, as Research article.
- Sections: Background, Aims, Methods, Timeline, Expected outcomes.
- Timeline holds a small captioned pipe table (phase, months), labelled
  `{#tbl:…}`.

### Thesis or dissertation

Hint: "Title page, abstract, contents, chapters and appendices."

- Frontmatter: `title: "Title of the thesis"`; `author:` name "Your Name",
  affiliation "Department, Institution"; `abstract:` one prompt line;
  `toc: true`.
- *My call:* the degree, supervisor and date go in the first paragraph
  of the body, as plain text ("A thesis submitted for the degree of …
  Supervisor: …"), since the title block has no fields for them (see
  Non-goals). It is followed by `[[toc]]` so the contents list sits after
  it, not above it.
- Sections: Acknowledgements, Introduction, Literature review,
  Methodology, Results, Discussion, Conclusion, Appendix A.
- *My call:* chapters are `##`, like every other starter, not `#`. The
  outline and the contents list show the same tree either way, and one
  rule for all starters is simpler to follow.

## Constraints

- Starters live in `lib/documentTemplate.ts`. Adding one should be one
  `STARTERS` entry carrying its own metadata and body, not another branch
  in `newDocumentText`. *Builder's call* how.
- `StarterId` names every starter; `NewDocument.svelte` already builds its
  list from `STARTERS`, so it should need no change beyond what the tests
  show.
- Frontmatter must parse with `lib/frontmatter.ts` (the `yaml` library);
  quoted titles keep a colon typed into them valid.
- No HTML comments for guidance: `html: false` renders them as text.
- Colours, if the dialog changes at all, come from the palette in
  `style.css`.

## Done when

- The dialog lists the seven starters in the order above, Blank first and
  selected, the box unticked for Blank and ticked for the others.
- For every starter, with and without a bibliography and with and without
  header and footer, a test checks that:
  - the frontmatter parses and gives the expected title and author;
  - the document renders with no cross-reference misses (`Figure ??`,
    `Table ??`, `Equation ??`);
  - `titleSelection` selects that starter's placeholder.
- Blank's text is unchanged (the existing test keeps passing).
- The lab report renders its table as Table 1 and its chart as Figure 1;
  the assignment's equation is numbered (1).
- Each starter's text is checked by eye in the app: preview, Export PDF
  with header and footer, Export HTML.
- Docs: `docs/getting-started.md` step 1 lists the starters;
  `docs/authoring.md`'s "Start from: Research article" sentence covers the
  others. `CHANGELOG.md` Unreleased → Added. `ROADMAP.md` item ticked,
  its product roadmap row updated, `../bin/check-roadmaps` run.

## Left to the builder

- The exact prompt wording within the tone above, and the lab report's
  sample numbers.
- The shape of the `Starter` entry (fields for metadata, body, title
  placeholder).
- Label names (`eq:…`, `tbl:…`, `fig:…`) in the samples.
