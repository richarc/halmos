# Journal-shaped starter documents

Design for the v0.15.0 roadmap item "Journal-shaped starter documents in
the New dialog". Written 2026-10-26 from the roadmap item and the code; the
product owner chose to skip the questions, so every decision below not
quoted from the roadmap is the designer's call and is marked **(call)**.

## Why

File → New… makes an empty document with a few frontmatter lines for the
bibliography. An author writing a paper then types the same skeleton every
time: a title, the authors, an abstract, and Introduction, Methods, Results,
Discussion. Halmos now reads `title`, `author`, `date` and `abstract` from
the frontmatter (v0.15.0), so a starter can set up a real title block as
well as the sections. The roadmap item: "an article with title, authors,
abstract and the usual sections".

## Goals

- The New dialog offers a choice of starting point: **Blank** (today's
  document) or **Research article**.
- A research article opens with a title block that already renders (title,
  one author with an affiliation, an abstract) and the usual sections, so
  the author replaces text rather than recalling syntax.
- Everything in the starter is ordinary Halmos markdown that also means the
  same to Pandoc, so it exports to Word and LaTeX as it previews.
- A **Page header and footer** checkbox adds a running header (the title)
  and footer ("Page 1 of 5") for Export PDF, with either starting point.
  Product owner's decision, 2026-10-26: a checkbox rather than a third
  starter, since it combines with both.
- The bibliography and citation-style choices work exactly as today with
  either starting point.

## Non-goals

- More journal shapes (review article, letter, thesis chapter) and
  journal-specific templates. Journals differ mostly in page layout, which
  they enforce through their own LaTeX class or Word template; that is a
  later "journal profile" (a starter, a citation style and an export
  template chosen together), noted in the product roadmap on 2026-10-26.
  This design keeps the starters as a list so a profile can reuse them,
  and adds no `journal:` frontmatter key. Product owner's decision,
  2026-10-26.
- User-made templates, or opening an existing file as a template.
- Changing the first-launch scratch document (`doNew`), which stays blank.
- Remembering the last choice between sessions. The dialog resets to Blank
  each time it opens, as its other choices already reset. **(call)**
- Example figures, tables, equations or cross-references in the starter.
  The test document shows those; a starter full of examples is text to
  delete. **(call)**

## Anti-goals

- A starter that exports placeholder text unnoticed. The placeholders must
  be obviously placeholders in the preview, so a forgotten one is caught on
  reading the PDF.
- A starter that renders with errors or warnings: no unknown citations, no
  missing cross-references, no "Bibliography not found" toast.
- Frontmatter that Pandoc would read differently from Halmos.

## What the author sees

### The New dialog

The first step gains one row above "Include a bibliography":

> **Start from** [ Blank ▾ ] — choices "Blank" and "Research article".

A one-line hint under it names what the selected starter contains, for
example "Title, author, abstract, and Introduction, Methods, Results,
Discussion, Conclusion." **(call)**: a select rather than radio buttons or
cards, matching the citation-style row already in the dialog and keeping it
a one-screen dialog.

Below it, a checkbox:

> ☐ **Page header and footer** — hint: "The title at the top of each PDF
> page, 'Page 1 of 5' at the bottom."

It is ticked when Research article is selected and unticked for Blank;
changing the starter resets it to that default, and the author can change
it either way before Create…. **(call)** on the defaults. When ticked, the
frontmatter gains:

```yaml
header: "{title}"
footer: "Page {page} of {pages}"
```

These only affect Export PDF; `{title}` is the metadata title, else the
first heading, else the file name.

Everything after that is unchanged: bibliography on or off, the style, the
bibliography step, the save panel.

### The research article

```markdown
---
title: "Title of the paper"
author:
  - name: Your Name
    affiliation: Your institution
abstract: |
  One paragraph: the question, what was done, the main result, and why it
  matters.
bibliography: paper.bib
csl: apa
header: "{title}"
footer: "Page {page} of {pages}"
---

## Introduction

What is known, what is not, and the question this paper answers.

## Methods

## Results

## Discussion

## Conclusion
```

- The frontmatter's bibliography lines are exactly what today's dialog
  writes for the chosen bibliography and style (live when a bibliography
  was chosen, the commented guidance block when not).
- Section headings are `##`: the title block is the document's title, so
  there is no `#` heading. **(call)**
- Only the Introduction carries a prompt sentence, as a model of tone;
  other sections are empty headings. **(call)**: prompts under every
  heading are more to delete than they help.
- No `date:` line. **(call)**: the date is usually the submission date, and
  formatting today's date in the author's region is not reliable in the
  webview (the reason PDF footers format `{date}` in Go). The authoring
  guide shows how to add one.
- No References heading: the reference list is added after the text
  automatically, as today.
- Placeholder wording is plain and generic ("Title of the paper", "Your
  Name", "Your institution") so it is obvious in the preview. **(call)**
- The title is quoted, so an author who types a colon into it keeps valid
  YAML (the authoring guide's rule from v0.15.0).

### After creation

The document opens with the title placeholder selected, so typing replaces
it. **(call)**: today the cursor lands below the frontmatter; for an article
the title is the first thing to write. Blank documents keep today's cursor
placement.

## Constraints

- `lib/documentTemplate.ts` stays the one place starter text is defined.
  The starters are a list (id, label, hint, whether the header and footer
  default on), so a new starter is one entry. `newDocumentText` gains the
  starter and the header/footer choice; Blank without header and footer
  produces exactly today's text (existing tests unchanged).
- The starter renders with no status-bar warnings and no toasts, with and
  without a bibliography.
- The frontmatter parses with Halmos's metadata reader (title, one author
  with affiliation, abstract) and is valid YAML.
- The dialog's existing behaviour and tests (reset on open, the
  bibliography step, Cancel/Back) are unchanged.
- No new settings, no Go changes beyond what selecting the title needs (if
  any; `loadDocument` already takes a cursor position).

## Docs and roadmap

- `docs/getting-started.md`: File → New… mentions the starting point.
- `docs/authoring.md`: one line in the frontmatter section that File → New…
  can start a research article with these keys filled in.
- `CHANGELOG.md`, `hermes/ROADMAP.md` (tick the item), the product roadmap
  row, `bin/check-roadmaps`.

## Left to the builder

- How the starter list is represented in code, so long as a new starter
  is one entry.
- How the title placeholder is selected after creation (a new cursor mode
  for `loadDocument`, or an editor call after load).
- Tests, beyond: Blank is byte-for-byte today's text; the article's
  frontmatter parses to the expected title, author and abstract; the
  article renders a title block and five `h2` sections with no warnings, with
  and without a bibliography; the header/footer lines appear exactly when
  ticked, for both starters, and parse as `header`/`footer`; the dialog
  passes the chosen starter and checkbox through, resets to Blank (box
  unticked) on open, and ticks the box when Research article is chosen.
