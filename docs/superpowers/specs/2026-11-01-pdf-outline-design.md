# PDF bookmarks and document properties — design

Roadmap: `ROADMAP.md` v1.0.0, "Bookmarks and document properties in the
exported PDF" (product milestone M1.0). Written 2026-11-01. The user asked
to skip the questions and work from the roadmap item; every choice below
not quoted from that item is marked as my call.

## Why

Export PDF… writes a PDF with no outline and no title or author, because
WebKit's printing adds neither. A long thesis needs the outline: it is the
sidebar in Preview and Acrobat that a reader and an examiner use to move
around. Without a title the viewer shows the file name, and the
document's properties are blank where submission systems and reference
managers look.

## What exists

- `DocumentService.ExportPDF(docPath, furniture)` shows the save panel and
  calls `exportPDF` (`print_darwin.go`), which renders the webview with
  `NSPrintOperation` straight to the chosen file. With a header or footer
  it renders to a temporary file instead, and `HermesExportFinisher` (the
  operation's didRun callback, Objective-C) draws them with
  `pdfstamp_darwin.go` on the way to the chosen path, falling back to the
  unstamped PDF if that fails.
- `pdfPageTexts(path) []string` (`pdfstamp_darwin.go`) already returns the
  text PDFKit reads from each page.
- The frontend knows the headings (the sidebar outline, `lib/outline.ts`,
  and `lib/toc.ts`'s slugs) and the frontmatter (`lib/frontmatter.ts`:
  `title`, `author`).

## Goals

1. **An outline in every exported PDF**: one bookmark per heading of the
   document, in document order, nested by heading level, each opening the
   page the heading is on.
2. **Document properties**: Title from the frontmatter `title`, Author from
   the frontmatter `author`.
3. **The step is written in Go with pdfcpu** (Apache-2.0, pure Go), as the
   roadmap item says, so the Windows version (v1.1.0) can reuse it. Only
   finding the page each heading landed on uses PDFKit, and only through
   the existing `pdfPageTexts`.
4. **Nothing WebKit produced is lost**: links (the contents list's internal
   links and external ones), searchable and selectable text, and the
   header and footer drawn by the stamping step. The roadmap item asks for
   this to be checked first.
5. **An export never fails because of this step.** If the outline or the
   properties cannot be written, the user still gets the PDF WebKit
   rendered (with its header and footer), as the stamping step already
   falls back.

## Non-goals

- File → Print… and the Word and LaTeX exports (the portal's Pandoc
  already writes Word headings and LaTeX `\section`s).
- Bookmarks that land on the heading's position within the page; the page
  is enough (my call; add the position only if pdfcpu offers it with no
  extra work).
- Windows. This design only keeps the Go step platform-independent; the
  Windows version will need its own page-finding.
- Any setting to turn this off (my call: there is no reason to want a PDF
  without an outline).

## Anti-goals

- **A bookmark pointing at the wrong page.** A heading's text can appear
  earlier than the heading itself: in the contents list (`[[toc]]`), in a
  cross-reference, in body text. An outline that sends "Results" to the
  contents page is worse than none.
- **A slower or less reliable export.** The step runs once per export over
  the finished file; a long thesis must not take noticeably longer, and a
  failure in it must not lose the export (goal 5).
- **Changing the document.** As with the other exports, nothing is written
  back to the Markdown.

## Decisions

- **The headings and properties come from the frontend**, sent with the
  export: `ExportPDF(docPath, furniture, outline)` gains a value carrying
  the headings (level and text, in document order) and the title and
  author strings. The frontend already holds both; Go does not parse
  Markdown.
- **Which headings** (my call): every heading the sidebar outline lists,
  levels 1 to 6, with the same text the sidebar shows. The title block is
  not a heading and gets no bookmark; Title in the properties covers it.
  A skipped level (a level 3 straight under a level 1) nests under the
  nearest shallower heading.
- **Author** (my call): the author names only, without affiliations, joined
  with ", ". No frontmatter `title` means no Title property; viewers then
  show the file name as they do today.
- **Off the main thread** (my call): the didRun callback runs on the main
  thread, so it hands the temporary file to Go and returns; the pdfcpu
  step and the move to the chosen path run on a goroutine. The app must
  not freeze while it runs.
- **Window title** (my call): also turn on the PDF viewer setting
  `DisplayDocTitle` when there is a Title, so viewers that honour it
  (Acrobat) show the title rather than the file name. Preview may still
  show the file name; that is not a failure. Skip the setting if pdfcpu
  cannot write it.
- **Creator** (my call): set to `Halmos Editor`, so a submission system can
  tell where the file came from. Producer stays whatever pdfcpu or WebKit
  writes.
- **Finding the page** (the roadmap item's approach): after the PDF is
  rendered, read each page's text with `pdfPageTexts` **from the file
  before the header and footer are stamped** (same layout; a header can
  repeat a heading's text on every page) and assign pages in a
  pure Go function, so it can be tested anywhere. For each heading, in
  document order, take the first page at or after the previous heading's
  page whose text contains the heading's text. Compare after normalising
  whitespace and case, and allow the heading to wrap across lines. A
  heading's maths is kept as TeX source in the sidebar's text, which never
  matches the PDF, so the frontend sends a second, match-only text with
  maths, code and markup left out, alongside the text the bookmark shows
  (found by the design check). A heading that cannot be found takes the
  previous heading's page (the
  first heading, page 1) and is logged; it never stops the export.
  *Contents list:* when the document has a `[[toc]]` or `toc: true`, the
  pages the contents list occupies are skipped for matching (my call; the
  builder decides how to recognise them, for example by the contents
  list's own text, which the frontend can send).
- **Order of the post-processing steps**: WebKit renders, then the header
  and footer are stamped (if any), then pdfcpu writes the outline and
  properties, then the file is moved to the chosen path. The didRun
  callback therefore runs for every export, not only those with a header
  or footer, and hands the finished temporary file to Go.
- **pdfcpu version**: pin one exact version in `go.mod`, as the other
  dependencies are pinned for 1.0. It is new during the 1.0 dependency
  hold (2026-10-29), which the roadmap item, added 2026-10-30, accepts.
  Its licence and those of the modules it brings in reach
  `THIRD-PARTY-NOTICES.txt` through the notices generator with no extra
  work; if pdfcpu ships a NOTICE file, it must be carried too.

## Check first (before building on pdfcpu)

The roadmap item says to check, before relying on pdfcpu, that it:

1. writes **nested** bookmarks;
2. sets **Title and Author** in the document information (its
   `AddProperties` may write custom keys only; if so, find how pdfcpu sets
   the standard ones);
3. keeps WebKit's **links** and **searchable text**, and the stamped header
   and footer, after rewriting the file;
4. on a 200-page PDF, grows the file by no more than 10% or 1 MB,
   whichever is larger, and adds no more than 2 seconds to the export
   (my call on both limits).

If any of these fails, stop and report rather than work around it: the
choice of pdfcpu was the roadmap's, and changing it is the user's call.

## Tests and checks

- Pure Go: nesting a flat list of (level, text) into bookmarks, including a
  skipped level and a document with no headings (no outline written).
- Pure Go: page assignment over page texts: a heading found on its page; a
  heading whose text also appears earlier in a contents list or in body
  text is not sent there; a wrapped heading; a heading not found takes the
  previous heading's page; headings never go backwards.
- Go, with a real PDF made in the test (pdfcpu can create one): after the
  step, the PDF's bookmarks read back nested with the right pages, Title
  and Author read back, and the page count and text are unchanged.
- Go: a failure in the step leaves the rendered PDF at the chosen path.
- Frontend: the outline value sent with the export (headings with levels
  and the sidebar's text, title, author names) for a document with
  frontmatter, `[[toc]]`, maths in a heading, and no headings.
- Manual (user): export a long document with a contents list and a header
  and footer; check the sidebar outline in Preview, the title in the
  window and in File → Get Info / Preview's inspector, that links in the
  contents list still work, and that text can be searched.

## Left to the builder

- The exact Go and Objective-C wiring of the hand-over from the didRun
  callback to Go.
- How the contents list's pages are recognised.
- The normalisation details of the text match (hyphenation at line ends,
  ligatures, maths rendered by KaTeX), within the anti-goal.
- Updating `CLAUDE.md`'s `print_darwin.go` paragraph and the roadmap.
