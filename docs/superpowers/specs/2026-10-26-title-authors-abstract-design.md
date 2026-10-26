# Title, authors and abstract as document metadata

Design for the v0.15.0 roadmap item "Title, authors and abstract as document
metadata". Written 2026-10-26 from the roadmap item and the code; the product
owner chose to skip the questions, so every decision below not quoted from
the roadmap is the designer's call and is marked **(call)**.

## Why

A paper's first page carries its title, its authors and where they work,
and an abstract. Halmos has no place for any of them. The frontmatter is
removed before rendering and only six keys are read (`bibliography`, `csl`,
`toc`, `toc-depth`, `header`, `footer`), so an author types the title as a
`# Heading` and the abstract as an ordinary paragraph. That reads as a
heading and a paragraph, not as a title block, and Word and LaTeX get no
title block at all.

Pandoc already builds a title block for Word and LaTeX from `title`,
`author`, `date` and `abstract`, and the portal sends Halmos's frontmatter
to Pandoc unchanged. So the work is mostly in the editor: read the same
keys, show them in the preview, PDF and HTML, and make sure what Pandoc
receives means the same thing.

The roadmap asks for this before v1.0.0, because changing what frontmatter
means is harder once 1.0 documents exist.

## Goals

- `title`, `author`, `date` and `abstract` in the frontmatter, with
  Pandoc's names and meanings, so the same document gives the same title
  block in the preview, PDF, HTML, Word and LaTeX.
- Authors can carry an affiliation, since a paper needs one.
- The preview and PDF show a title block at the top of the first page:
  title, authors with affiliations, date, abstract.
- `{title}` in a page header or footer, and the HTML export's `<title>`,
  use the metadata title when there is one.
- A document without these keys renders exactly as today.

## Non-goals

- Journal-shaped starter documents in the New dialog. That is the next
  roadmap item, and builds on this one.
- A form or dialog for editing the metadata. It is typed in the
  frontmatter, like every other key. **(call)**
- Other Pandoc metadata: `subtitle`, `keywords`, `thanks`, `lang`,
  corresponding-author marks, ORCID, email. Easy to add later with the same
  machinery. **(call)**
- Journal-specific title layouts (two-column, affiliation footnotes). One
  plain, centred layout.
- Changing the page-number `{date}` placeholder: it stays the export date,
  not the `date:` key. **(call)** — see "Page header and footer".

## Anti-goals

- A syntax only Halmos understands. If Pandoc would read a key differently,
  it is wrong. This is the same rule the cross-references design follows.
- Breaking existing documents. No key Halmos reads today changes meaning.
- Losing what the author wrote. A shape Halmos cannot show (say, an author
  with fields it does not know) is ignored by the preview, not rewritten,
  and still goes to Pandoc as written where that is safe.

## What the author writes

```yaml
---
title: Yield response of winter wheat to late nitrogen
author:
  - name: Ada Lovelace
    affiliation: University of London
  - name: Charles Babbage
    affiliation: University of Cambridge
  - Mary Somerville
date: 26 October 2026
abstract: |
  Late nitrogen raised yield by 8% across three seasons ($p < 0.01$).
  The response was largest on light soils.
bibliography: references.bib
csl: apa
---
```

- **`title`**: one line of Markdown (emphasis and inline maths allowed, as
  Pandoc allows).
- **`author`**: one of
  - a single name: `author: Ada Lovelace`;
  - a list of names: `- Ada Lovelace`;
  - a list of entries with `name` and optional `affiliation`, as above;
    names and entries may be mixed.
  `affiliation` is one line of text. Several authors with the same
  affiliation share it. **(call)**: `name`/`affiliation` are the field names
  most Pandoc journal templates and filters use; Pandoc's default templates
  only understand plain names, which is handled in "Word and LaTeX" below.
- **`date`**: shown exactly as written. Halmos does not parse or format
  it, as Pandoc does not. **(call)**: no `today` keyword in this round.
- **`abstract`**: Markdown, normally a YAML block (`abstract: |` followed by
  indented lines); one line also works. Paragraphs, emphasis, inline and
  display maths are rendered. **(call)**: citations in the abstract render
  as citations, as Pandoc does, and count in numbering order (an IEEE
  number cited first in the abstract is [1]). Journals discourage this, but
  showing them raw would be worse.

### Parsing

Today's parser reads one `key: value` per line. Lists and multi-line blocks
need more of YAML. Constraints for the builder:

- What Halmos reads must mean the same in Pandoc's YAML reader for every
  shape listed above, including quoting (`title: "Yield: a study"`), block
  scalars (`|` and `>`), and comments.
- Anything outside those shapes is ignored for display, with no error,
  and the document still renders.
- The existing six keys keep their exact current behaviour, including the
  trailing-comment rule in `unquote` that the new-document template depends
  on (issue #8).
- The renderer runs on every keystroke, in Quick Look (a classic script
  with no module loading) and vendored into the portal's guides, so a
  parser library must work in all three and be small.

Whether that is a YAML library (for example `yaml`) or an extension of the
hand parser to the listed shapes is left to the builder, with the above as
the test. **(call)** to leave it open: a library guarantees agreement with
Pandoc on odd inputs; a hand parser keeps the bundle and the vendored copy
small.

## What the reader sees

### Preview, PDF and HTML

A title block at the top of the sheet, before the first line of the body
and before a contents list placed at the top:

1. **Title**, centred, larger than a `#` heading. **(call)**
2. **Authors**, centred, on one line, comma-separated, wrapping as needed.
   When any author has an affiliation, each distinct affiliation gets a
   number in order of first appearance, shown as a superscript after each
   author's name, and the affiliations follow on their own centred lines,
   each starting with its number. When every author shares one
   affiliation, no numbers: the affiliation is one line under the names.
   **(call)**
3. **Date**, centred, on its own line.
4. **Abstract**: the word "Abstract" as a small heading, then the text in
   a slightly narrower block, justified or left-aligned as the body is.
   **(call)**

Each part appears only when its key is set; a document with only `title`
shows only the title. The block uses the existing colour palette and body
font (`--doc-font-body`); `styleContract.test.ts` still applies.

The block is part of the rendered HTML, so the PDF (printed from the
preview) and the HTML export (cloned from the preview) get it with no
separate work. Quick Look gets it too, since it uses the same renderer.

### The title and the first heading

Many existing documents use `# Title` as their title. If such a document
gains `title:`, the title shows twice; that is the author's choice to fix,
and the authoring guide says so. Halmos does not hide the heading.
**(call)**: guessing which heading is the title would be wrong for some
documents and invisible to the author.

The outline (the list of headings) is unchanged: the title block is not a
heading and does not appear in it. **(call)**

### Scroll sync

The title block maps to the frontmatter lines. The existing virtual anchor
(line 1 → top of the preview) already interpolates from the top to the
first body block, so no new anchor is needed; the builder confirms this on
a document with a long abstract.

### Page header and footer

`{title}` in `header`/`footer` becomes: the metadata `title` (as plain
text, Markdown stripped) when set, else the first heading, else the file
name. The HTML export's `<title>` follows the same rule. `{date}` stays the
date of export, because a running footer that prints the date the PDF was
made is what it means today and changing it would alter existing documents.
**(call)**

## Word and LaTeX

The portal sends the frontmatter to Pandoc as written, so `title`, `date`
and `abstract` already work there with no change.

`author` with `name`/`affiliation` entries does not: Pandoc's default Word
and LaTeX templates expect each author to be text, and an entry with
fields is printed wrongly or not at all. (Not confirmed: Pandoc is not
installed on the development Mac. The builder checks it with one export
through the portal before building the rewrite; if Pandoc prints the
`name` field correctly, the rewrite only adds the affiliation.) So the export copy (the same copy
`lib/exportCrossrefs.ts` and `lib/exportDiagrams.ts` already adjust, never
the document) rewrites each such entry as text in the export copy:
"Ada Lovelace, University of London". **(call)**: this needs no change to the
API contract or the portal, and the result is readable in both formats.
Proper affiliation layout in Word and LaTeX (superscripts, a separate
affiliations line) needs a template or filter on the portal and is a later
item.

The portal's M0.15 item "Title block from document metadata" then only has
to check that a title block comes through; the editor tells it the export
copy's `author` is always a list of text entries.

## Constraints

- `lib/frontmatter.ts`'s `Frontmatter` gains the four fields; it stays the
  one place frontmatter is read.
- Rendering stays a pure function of the document (and the bibliography),
  computed on every render.
- The vendored renderer in the portal: a guide without these keys renders
  unchanged. The portal re-vendor is a follow-up there.
- Quick Look must not break, and must not fetch anything.
- `frontmatterKeyChange` (used by Format → Citation Style) must still edit
  `csl:` correctly in a frontmatter that now contains lists and block
  scalars: it must not mistake an indented line inside `abstract: |` or an
  author entry for a top-level key. Today it matches `^key\s*:` on any line,
  so an abstract line starting `csl:` would be hit; the builder fixes that
  to match only unindented lines.

## Docs and roadmap

- `docs/authoring.md`: "Frontmatter: exactly six keys" becomes ten keys,
  with the example above; the note about `# Title` appearing twice; how
  `{title}` is chosen.
- `docs/getting-started.md`: the frontmatter table gains the four keys.
- `docs/test-document.md`: a title block at the top.
- `CHANGELOG.md`, `hermes/ROADMAP.md` (tick the item), the product roadmap
  row, and a note for the portal's M0.15 item about the flattened authors.

## Left to the builder

- The parser (library or hand-written), within the constraints above.
- Exact sizes and spacing of the title block, within the existing design.
- How the abstract's Markdown is rendered (a second markdown-it pass, or
  tokens injected into the main one) so long as citations, maths and
  cross-references in it behave as in the body.
- Tests, beyond: a document with none of the keys renders byte-for-byte as
  before; each author shape parses; a Pandoc-quoted title round-trips;
  `frontmatterKeyChange` ignores indented lines; the export copy flattens
  `name`/`affiliation` entries and leaves plain names alone; `{title}`
  prefers the metadata title.
