# Halmos Roadmap

Halmos is a desktop editor for writing academic papers in markdown, with LaTeX
math and Vega-Lite charts rendered live and exported to PDF. Releases follow
[Semantic Versioning](https://semver.org). This file lists planned and
in-progress work only; [CHANGELOG.md](CHANGELOG.md) records what has shipped,
and git history holds the earlier versions of this file with the design notes
for each release.

## Direction

The product direction, agreed 2026-10-12, and the order of releases are set
in the Halmos product roadmap, which also covers the hosted back end at
halmoseditor.com. Its milestones are named after the editor releases here:
M1.1 is v1.1.0. Each release section below opens with the milestone it
serves, and lists the editor's own work for it. In short: the editor and
citations stay free; the paid features are the hosted services that cost
money to run (conversion, reference lookups, AI); and AI removes routine
work but does not write the paper.

## v0.15.0 — Clean-up before 1.0

Serves: M0.15

Tidy what is there before v1.0.0 adds anything. More items to follow.

- [x] **Investigate following changes made to the open file by something
      else**, such as another editor or a program that generates content
      into the file. Today nothing watches the open document. Halmos keeps
      showing the text it loaded, and Save writes over the other program's
      changes without warning. The bibliography already has a watcher
      (`WatchBibliography` in `documentservice.go`, polling mtime and size,
      emitting `bib:changed`) that shows one way to detect a change. The
      investigation should answer:
      - Unsaved edits: reload silently when there are none. When there are,
        ask, and decide what the choices are (keep mine, take theirs, show
        the difference).
      - A program that writes often, such as a generator appending output:
        keep the cursor and scroll position across a reload, and avoid
        reacting to a half-written file.
      - Save: check the file has not changed since it was loaded or last
        saved, so an external change is never overwritten unseen.
      - The file is renamed, moved or deleted while open.
      - Halmos's own saves must not trigger a reload.
      - Recovery drafts (`recovery.go`) already drop a draft when the file
        on disk is newer; check that still holds.
      The outcome is a recommendation with a size estimate, built in this
      release or later.
      *Done 2026-10-22*: build it in this release, about 7 days
      (`docs/superpowers/specs/2026-10-22-external-file-changes-design.md`).
      Found on the way: a recovery draft is deleted, and the unsaved edits
      lost, when another program writes the document after the last draft
      and Halmos then crashes.
- [x] **Follow changes made to the open file by something else**, as the
      investigation above recommends:
      - The text on disk gets a version (its content hash) on open and save.
      - Save checks the file first and asks before overwriting a change
        made by another program, including Save from the close and quit
        question.
      - A watcher polls the open document every second, acts only once the
        file has settled, and never reacts to Halmos's own saves.
      - With no unsaved edits the file reloads silently, keeping cursor,
        scroll and undo history. With unsaved edits, ask once per change:
        Keep Mine or Use File (undoable).
      - A moved file is followed; a deleted one keeps its text, marked
        unsaved. Can move to v1.0.0 if the release runs long.
      - Recovery drafts are dropped only when the file holds the same text
        or Halmos saved over them, fixing the lost-draft bug.
      A view of the difference between the two versions is backlog.
      *Done 2026-10-22*: built on branch `external-changes`.
- [x] **An Export menu.** Move Export PDF… (⌘E), Export HTML…, Export
      Word… and Export LaTeX… out of File into their own top-level menu.
      They are added in `menu.go` (`addPandocExportItems` for Word and
      LaTeX); the `menu:export-*` events and the frontend handlers stay as
      they are.
      *Done 2026-10-22*: Export sits after File, with PDF (⌘E) and HTML,
      a separator, then Word and LaTeX (`addExportMenu`). Paper Size, PDF
      Orientation and Print… stay in File.
- [x] **Bug (to confirm): large white space at the top of each page in an
      exported PDF.** Reported 2026-10-22. Reproduce first with a
      multi-page document on A4 and US Letter, portrait and landscape, and
      measure the top margin against the 25mm the sheet is meant to have.
      Where the margin comes from today: the print CSS `@page { margin:
      25mm; }` in `frontend/public/style.css`, with `NSPrintInfo`'s margins
      set to zero in `print_darwin.go` so the two do not add up; a second
      place in `print_darwin.go` still sets 30pt margins, so check which
      path Export PDF… takes. Also check for leftover spacing from the
      preview (the sheet's padding, the first element's top margin) that
      the print CSS does not reset.
      *Done 2026-10-22*: confirmed, 46mm instead of 25mm on every page.
      WebKit ignores the @page top margin, sizes each page from the text
      width and the paper's ratio, and draws it against the bottom margin.
      Top and bottom margins now scale with the paper's shape (`pageRule`
      in `lib/paper.ts`; A4 portrait 25mm × 35.4mm), and the sheet draws
      the same. Print… (30pt margins, the panel's paper) is not changed.
- [x] **Chart builder improvements.** Scoped 2026-10-23 to three fixes;
      layered charts stay in the Backlog.
      - Keep styling the builder has no control for. A chart is editable
        only if the builder can rebuild it exactly, so an axis label angle
        or points on a line (both in `docs/test-document.md`) refused the
        whole chart. `chartSpec.ts` now carries a fixed list unchanged:
        `axis`, `scale`, `legend` and `sort` on each encoding, mark settings
        such as `point`, `opacity` and `interpolate` (the mark may be an
        object), and top-level `config`, `background`, `padding` and
        `autosize`. The builder drops them as they stop fitting
        (`keptStyles`): all on a new chart type, a channel's on a new
        column, type or aggregate, `scale` and `sort` on new data.
        `bin`, `timeUnit`, `transform`, `layer` and `facet` are still
        refused.
      - Name a refusal in plain English (`refusalMessage` in
        `lib/chartLabels.ts`), not as a path like `encoding.x.axis`.
      - Closing the window with a builder or the New dialog open now closes
        them (`closeDocument`). A clean close skipped the confirm step, which
        is how they were left behind. A close or quit with a builder open
        now always asks first: the frontend reports it with
        `SetBuilderOpen`, Go's `mustAsk` sends `close:confirm`, and
        "Discard the chart?" comes before the unsaved-changes dialog.
      *Done 2026-10-23.*
- [x] **Architecture, performance and security review** of the whole app
      before v1.0.0. Findings that block 1.0 are fixed here; the rest go to
      the Backlog with the reasons, like the earlier review leftovers.
      *Done 2026-10-23*: the findings are kept in the private product
      repository until the security fixes ship. The blocking ones are the
      four items below and the v1.0.0 licence notices; the rest are in the
      Backlog.
- [x] **Security fixes from the pre-1.0 review.** Narrow what a document's
      content can load and which files the app serves to the preview, and
      give the app page and the Quick Look page a Content-Security-Policy.
      Details stay in the private review (S1–S3) until this ships.
      *Done 2026-10-23*: charts run with a loader that refuses every URL
      and with Vega's expression interpreter (`charts.ts`); the image route
      and the export readers serve image extensions only, symlink targets
      included (`localImageFile`); the production build gives the app page
      a CSP (`lib/csp.ts`). Quick Look keeps its offline rules and sandbox
      instead of a CSP. Verified in a production build: no violations on
      the test document, and a request to another host is refused.
- [x] **Dependency and CI pass.** Update the shipped packages with
      published advisories (DOMPurify through Mermaid, markdown-it, KaTeX).
      Add `govulncheck`, `go vet`, the race detector, `svelte-check` and the
      Quick Look tests to CI. Bind the demo service only when demo mode is
      on.
      *Done 2026-10-23:* DOMPurify 3.4.17 and markdown-it 14.3.3. CI
      already ran `govulncheck` and `svelte-check`; it now adds `go vet`,
      `-race` and the Quick Look tests. The demo service stays registered,
      because the page asks it for a script at startup; its recording and
      full-screen methods refuse to run without `HERMES_DEMO`. KaTeX moved
      to v0.16.0.
- [x] **Reload the bibliography without freezing the editor.** Reading a
      2,000-entry `.bib` takes 1.5 s on the main thread (49 entries: 0.1 s),
      and the first citation pass after it up to 0.9 s more. Zotero's "Keep
      updated" export rewrites the file often, and every rewrite repeats
      both, even when the bytes are unchanged. Skip a reload whose contents
      have not changed, parse off the main thread, and reuse parsed entries.
      *Done 2026-10-23:* the Go watcher emits `bib:changed` only when the
      content's hash changes; `lib/bibLoader.ts` parses in a Web Worker and
      caches the last text; a reload with the same text and style keeps the
      formatter. Measured in a production build with 2,000 entries: the
      longest stall went from 2.1–2.4 s to 0.21–0.23 s. What is left is
      citeproc's first pass after a real change; see "Editing a citation
      reformats every citation" in the Backlog.
- [x] **Correct stale notes in `CLAUDE.md`.** Its PDF note describes the
      print panel, which Export PDF… never shows (that is Print…), and the
      review lists a few more.
      *Done 2026-10-23:* the PDF note covers both routes and Export PDF's
      own rules; the events list adds `menu:export-pandoc`, `menu:account`,
      `menu:insert-code` and `portal:pairing`; `PortalService` has a note;
      a Taskfile comment names the right binary.

The three items below came out of a review on 2026-10-23 of a guide to
writing books in Markdown with Sphinx, and moved from v1.1.0 on 2026-10-24.
They are free in the preview and PDF; the portal's conversion carries them
into Word and LaTeX (its M0.15 section).

- [x] **Numbered table captions.** Tables have no caption and no number,
      and journals require both. Use Pandoc's caption syntax (a
      `: Caption` line directly after the table) so the conversion keeps
      it. Decide whether tables share the figures' number sequence (they
      should not: "Table 1" and "Figure 1" are numbered separately). The
      table builder (`TableBuilder.svelte`, `lib/pipeTable.ts`) gains a
      caption field. Designed with the cross-references below
      (2026-10-25): pandoc-crossref puts a table's label on its caption line
      (`: Results by group {#tbl:results}`), so referring to a table needs
      its caption first.
      *Done 2026-10-25*: built on branch `crossrefs`. A blank line, then
      `: Caption {#tbl:name}`; the table builder has a Caption field.
- [x] **Cross-references to figures, tables and equations.**
      Halmos numbers figures but gives no way to refer to one. The
      authoring guide rightly says not to write "Figure 1" by hand, which
      leaves no correct way to write "as shown in Figure 3". Add a label
      and a reference that renders as a linked "Figure 3" and renumbers
      itself. Use pandoc-crossref's syntax (`{#fig:id}`, `{#tbl:id}`,
      `{#eq:id}`, `{#sec:id}` to label; `@fig:id` or `[@fig:id]` to refer)
      so the references survive conversion, rather than a syntax only
      Halmos understands. Points to settle:
      - The citation parser (`lib/citations.ts`, `lib/citationKeys.ts`)
        must tell `@fig:id` from a citation. BibTeX keys can contain
        colons, so a key that starts `fig:` would clash; decide the rule.
      - Labels on images, Vega-Lite charts, Mermaid diagrams, tables,
        display maths and headings, each in a form Pandoc accepts.
      - Equation numbering, which display maths does not have today.
      - Autocomplete for labels after `@`, beside the citation completion,
        and the unknown-citation check extended to unknown labels.
      - Word and LaTeX: see the portal's M0.15 cross-references item.
      Designed 2026-10-25 with the table captions above
      (`docs/superpowers/specs/2026-10-25-table-captions-and-cross-references-design.md`).
      Sections are left out: headings are not numbered, so "Section 3"
      would point at a number the reader cannot see. See "Numbered
      headings and section references" in the Backlog. Captions change
      to "Figure 2: Caption" with a colon, as papers and the Word output
      write them.
      *Done 2026-10-25*: built on branch `crossrefs`. References and
      lists in `lib/crossrefs.ts` and its neighbours; Insert →
      Cross-reference… is ⇧⌘R. Word gets generated labels on unlabelled
      figures and tables. In LaTeX a reference to a chart or diagram does
      not resolve (see the Backlog).
- [x] **Title, authors and abstract as document metadata.** Today the
      whole frontmatter is removed before rendering, and `title:` and
      `author:` are dropped (`docs/authoring.md`, "Frontmatter: exactly
      four keys"). That was fine with PDF as the only output. Pandoc builds
      a proper title block for Word and LaTeX from `title`, `author`,
      `date` and `abstract`, and a paper needs authors with affiliations.
      Decide the keys (Pandoc's names, so the conversion uses them as
      they are), how the preview and PDF show the title block, and how it
      relates to `{title}` in page headers, which today is the first
      heading. Decide before v1.0.0 if possible: changing what frontmatter
      means is harder once 1.0 documents exist.
      *Done 2026-10-26*: built on branch `metadata`. Keys are Pandoc's
      (`title`, `author`, `date`, `abstract`), read with the `yaml`
      library in `lib/frontmatter.ts`; the title block is `lib/titleBlock.ts`.
      Authors may carry an affiliation. `{title}` and the HTML page title use
      the metadata title first. Word and LaTeX get an author with an
      affiliation as "Name, Affiliation" (`authorsForExport`). Checked
      2026-10-27 with one Word and one LaTeX export (three authors, two
      affiliations; LaTeX built in Overleaf): the title block comes through.
      A reference in the abstract is sent as plain text
      (`abstractReferencesForExport`), since pandoc-crossref resolves only
      the body.
- [x] **Journal-shaped starter documents in the New dialog**
      (`lib/documentTemplate.ts`): an article with title, authors, abstract
      and the usual sections. From the Markdown-books review (2026-10-23);
      moved from the Backlog on 2026-10-24. Builds on the title, authors
      and abstract metadata above.
      *Done 2026-10-26*: built on branch `starters`
      (`docs/superpowers/specs/2026-10-26-journal-starter-documents-design.md`).
      Start from Blank or Research article; a "Page header and footer" box
      (ticked for an article). The article opens with its title selected.
      Starters are a list (`STARTERS`), so more shapes, or journal profiles
      later, are one entry each.
- [x] **Release v0.15.0**, once the items above are done. Cut by hand with
      `wails3 task release`, as since v0.9.0 (the workflow is a v1.0.0
      item). Planned 2026-10-24 as the release before 1.0. It publishes the
      security fixes held on `main` since 2026-10-23, and the account
      (Connect, Account…) and Word and LaTeX export work done on `main` for
      v1.1.0: decide before tagging whether those show in v0.15.0 while
      billing is not live. The site then offers this build (the portal's
      M0.15 section).
      *Done 2026-10-27*: released by hand, signed and notarised
      (https://github.com/richarc/halmos/releases/tag/v0.15.0); `main` and
      the update feed pushed after it. The review's public summary is
      `docs/superpowers/reviews/2026-10-23-pre-v1.0-review.md`. This
      section is removed once the site offers this build.

## v0.16.0 — Clean-up before 1.0, continued

Serves: M0.16

The v0.15.0 items still open on 2026-10-24, moved here unchanged.

- [x] **Page numbers, headers and footers in exported output.** Set in the
      frontmatter, like `bibliography`, `csl` and `toc`, so a document
      carries its own page setup. The keys are `header` and `footer`, each
      one line of text with `{title}`, `{date}`, `{page}` and `{pages}`.
      Each format needs its own route:
      - PDF: done for Export PDF. WebKit's printing has no CSS page-margin
        boxes (checked on macOS 26.6: `@top-center` and `counter(page)`
        print nothing), and AppKit's own header and footer cannot be
        changed. So the PDF is rendered as before and `pdfstamp_darwin.go`
        draws the header and footer on each page with PDFKit; text stays
        searchable and links survive. Print… is not changed: it goes
        through the print panel, with no file to draw on. Left for later:
        no header on the first page, left/right placement, alternating
        pages, and adding `header` and `footer` to the New Document
        template's commented-out keys (`lib/documentTemplate.ts`).
      - Word and LaTeX: made by the portal's Pandoc conversion, so the
        settings travel in the export request and the portal applies them
        (a reference `.docx` for Word, the LaTeX template or `fancyhdr`
        for LaTeX).
      - HTML: nothing, decided 2026-10-29. An exported page is read in a
        browser or published online, where there are no pages, and the
        title block already shows the title. Print CSS with page-margin
        boxes was turned down: Chrome and Edge print them, Safari prints
        nothing. A page printed from a browser has no running header or
        page numbers; `docs/authoring.md` says so.
      *Done 2026-10-29 (not yet released):* the editor's half of Word and
      LaTeX was missing (found 2026-10-29) and is now built: the export
      request carries Export PDF's header, footer, title and first-page
      rule as `page_furniture`, with `{date}` written in Go in the Mac's
      long date format (`localdate_darwin.go`), as the PDF has it.
- [x] **Control how references are formatted, beyond the chosen style.**
      LaTeX bibliography packages let an author set, for example, how many
      authors are listed before "et al." Offer the same, set in the
      frontmatter, without the user editing a `.csl` file. The CSL style
      already holds these options (`et-al-min`, `et-al-use-first` and
      their `subsequent` forms on `citation` and `bibliography`), so the
      likely approach is to override those attributes in the loaded style
      before citeproc-js uses it. Because the editor sends that same CSL to
      the portal for Word and LaTeX export, one change covers the preview,
      PDF, HTML, Word and LaTeX. Start with the author-list options and
      list which other options are worth exposing. Name-format options
      (initials, "and" versus "&") are candidates.
      *Done 2026-10-29 (not yet released):* eight frontmatter keys,
      `citation-et-al-min` to `bibliography-et-al-use-last` (CSL's names
      after `citation-` or `bibliography-`), applied by
      `lib/styleOptions.ts` to a copy of the style's XML. An author
      `<name>` that overrides the setting is changed too (IEEE), unless it
      is inside a `<choose>` (APA's treaty parties). A `-min` set alone
      lowers the style's use-first to 1 when it would list everyone. The
      other options are a Backlog item.
- [x] **Wails, KaTeX and Mermaid, then hold dependencies for 1.0.** Wails
      v3.0.0, the stable release, came out on 2026-10-26 (the pin is
      beta.30); take it, not beta.34, from 2026-11-02, when it is 7 days
      old as `.npmrc` asks. Its notes ask everyone on beta.30 or earlier to
      upgrade for security fixes; the ones that touch Halmos on macOS stop
      reserved `wails:` messages from iframes, and stop ~120 empty
      `evaluateJavaScript:` calls a second, which on macOS 27 broke
      click-gated clipboard writes. No API changes since beta.31, but it
      needs Go 1.26: raise `go.mod` from `go 1.25.0` to `go 1.26.0` (CI
      already uses 1.26.x). Build releases with Go 1.26.10 or later, for
      the `crypto/x509` fix GO-2026-6809. Pin `github.com/wailsapp/wails/v3`
      and `@wailsio/runtime` to exactly `3.0.0` and regenerate bindings.
      Wails now ships a minor release weekly (3.1.0, 3.2.0, …) and nightly
      pre-releases; for the 1.0 hold take only `3.0.x` hotfixes. Do Wails
      first, on its own, then KaTeX and Mermaid. KaTeX's low advisory is fixed in 0.18, which needs
      Mermaid 12 (it changes every diagram's default layout, theme and
      look, so set `layout: dagre`, `theme: default`, `look: classic` to
      keep today's) and an override for `@vscode/markdown-it-katex`, which
      asks for KaTeX 0.16. KaTeX 0.18 also prefixes its CSS classes, so
      check `style.css` and the HTML export. Then hold dependencies still
      for 1.0.
      *Done 2026-10-29, not yet released:* Wails 3.0.0 taken 3 days after
      release rather than 7, by choice; Go 1.26 (`go.mod` `go 1.26.0`).
      KaTeX 0.19.1 rather than 0.18 (0.19 only changes how missing-glyph
      warnings are reported), with `overrides` for the plugin; Mermaid
      12.2.0, which keeps its own KaTeX 0.18 in its lazy chunk. The KaTeX
      classes Halmos styles kept their names. Release builds still need Go
      1.26.10 or later (this Mac has 1.26.7; CI takes the latest 1.26.x).
- [x] **A command palette, and ⇧⌘T for Table.** Remembering shortcuts is
      the problem, and adding more makes it worse. ⇧⌘P opens a palette
      listing every menu command as `Menu: Item`, with its shortcut on the
      right; typing a few letters finds it, Return runs it. The list is
      read from the menu itself, so the two cannot disagree, and it is
      built to take non-menu commands later (portal and AI commands).
      Commands only: jumping to headings or figures is for later. Table
      gets ⇧⌘T, next to ⇧⌘C Citation and ⇧⌘R Cross-reference; Chart stays
      on the palette and the toolbar. Design:
      `docs/superpowers/specs/2026-10-27-command-palette-design.md`.
      *Done 2026-10-28, not yet released:* `commands.go` registers every
      menu action as `menu.go` builds the menu, `CommandService` lists and
      runs them, and `CommandPalette.svelte` is the box. Recents are kept
      in `palette-recents.json`. Left for later: running "Command Palette…"
      from the palette reopens it, and a failed list load shows an empty
      palette with no message.
- [x] **An interactive Getting Started tutorial.** Added 2026-10-27. The
      current Getting Started guide is read on the site; this one is done in
      the editor. Help → Getting Started (also on the start screen and the
      command palette) downloads a tutorial from halmoseditor.com, a
      markdown document, a `.bib` file and a data set, saves them to a
      folder the user picks (default `~/Documents/Halmos Tutorial/`), and
      opens the document. Each section shows a finished example, then sets
      a task the user does in the same document, naming the palette command
      that does it:
      - an inline and a display equation;
      - a chart from the bundled data set, through the chart builder;
      - a paragraph to cite: insert a citation from the bundled `.bib`;
      - a table with a caption;
      - cross-references to a figure, a table and an equation.
      Points to settle:
      - How a step is marked done: Halmos checks the step's section for the
        result (an equation, a chart fence, a `[@key]`, an `@fig:` reference)
        and ticks its task, or the user ticks it.
      - *Agreed 2026-10-29 with the portal*: the tutorial is written in
        `docs/tutorial/` (a hand-written `tutorial.json`, the Markdown, the
        `.bib`, the data set, and screenshots and example images in
        `images/`, PNG or JPEG) and served as public files: a manifest at
        `/tutorial/manifest.json` with each file's size and SHA-256, a
        `revision` and a `min_editor`, and each file at
        `/tutorial/<revision>/<name>`. No account. The editor checks every
        name and hash before writing anything, creates no folder but
        `images/`, and records the revision in the folder. Offline, on any
        error, or when `min_editor` is newer than the app: a copy bundled
        with the app, built from the same `docs/tutorial/`. A second run
        offers to open the existing folder or start fresh, and never
        overwrites the user's edits.
      *Done 2026-10-29, not yet released:* `tutorialservice.go` downloads
      and checks the tutorial (or uses `docs/tutorial/`, embedded in the
      app), writes it to a new `Halmos Tutorial` folder in the place the
      user picks, and `GettingStarted.svelte` opens it. Halmos checks the
      tasks itself: a task ends in a hidden marker
      (`<!-- check: chart -->`), and `lib/tutorialTasks.ts` ticks it in the
      preview when the result is below it, before the next heading; the
      text keeps `- [ ]`. A first launch points to it with a toast. Design:
      `docs/superpowers/specs/2026-10-29-tutorial-design.md`. Left for
      later: screenshots in `images/`; the online path is checked by eye
      once the files are synced to the portal and the version is 0.16.0.
- [x] **Find a citation style from the CSL repository.** Added
      2026-10-28. Five styles are bundled; any other means finding the
      journal's `.csl` file, downloading it and choosing it with Other Style
      File…. The CSL repository has over 10,000. Other Style File… becomes
      **Find a Style…**: a searchable list of every style in the repository
      (by journal name or abbreviation, filtered by field and by format:
      author-date, numeric, note), with a sample citation and reference for
      the one selected. Use Style installs it and applies it; "Choose a
      file…" stays for styles not in the repository.
      - The list comes from an index the portal builds from the repository
        (ID, title, short title, field, format, parent), cached by the
        editor; a style file is fetched only when chosen. No account.
      - Dependent styles (most journal styles: a journal's name pointing at
        a parent style) install with their parent; citeproc formats with
        the parent, and Word and LaTeX export send the parent's CSL. Check
        first whether a dependent style loads today.
      - Installed styles live in a library in
        `~/Library/Application Support/hermes/styles/`, inside the app's
        data folder, which keeps the old name (see CLAUDE.md). The frontmatter
        names the style by its ID (`csl: nature`), so a co-author's Halmos
        finds or fetches the same style; a path still works as today.
      - Each style records when it was installed, and Halmos offers
        updates. Offline, the bundled and installed styles still work.
      - The styles are CC BY-SA 3.0: list them in the third-party licence
        notices (v1.0.0).
      *Done 2026-10-29 (not yet released):* checked first, a dependent
      style loaded today without an error and formatted nothing.
      `StyleService` (Go) fetches and caches the index, searches it, and
      installs a style with its parent after checking each file's SHA-256;
      every `csl:` value that is not bundled resolves through it to the XML
      that formats, so a dependent style uses its parent in the preview and
      in Word and LaTeX export. Updates are offered in the window only. The licence notice stays with v1.0.0;
      the window carries the CSL project's attribution.
- [x] **More starters in the New dialog: Assignment, and the other
      common shapes.** Added 2026-10-28. Each is one more `STARTERS` entry
      in `lib/documentTemplate.ts`, next to Blank and Research article.
      Overleaf's gallery (2026-10-28) groups its templates as journal
      articles, theses, assignments, CVs, letters, posters, presentations,
      books, newsletters, calendars and bibliographies. The ones that suit
      Halmos, a Markdown writer with citations, equations and charts:
      - **Assignment**: name, student ID, course, assignment and due date
        in the frontmatter, shown in the header; numbered questions, each
        with an answer section, parts (a), (b), …; a worked equation;
        references at the end. Footer ticked by default.
      - **Lab report**: aim, background, materials and method, results with
        a captioned table and a chart from a small data set, discussion,
        conclusion, references.
      - **Essay**: title, name, course; introduction, body sections,
        conclusion, references. For the humanities, where citations matter
        most and equations not at all.
      - **Thesis or dissertation**: title page fields (degree, institution,
        supervisor, date), abstract, acknowledgements, `toc: true`, chapters
        from Introduction to Conclusion, appendices.
      - **Research proposal**: background, aims or research questions,
        methods, timeline, expected outcomes, references.
      Left out: CVs, letters, posters, presentations, newsletters and
      calendars depend on page layout that Markdown export does not
      control; books are the thesis starter at more length.
      Open: whether a starter can bring a sample data file (the lab
      report's chart) or writes its data inline; and whether the dialog's
      list becomes a list with a short preview once there are seven.
      *Done 2026-10-28 (not yet released):* the five starters above, each
      one `STARTERS` entry. Data is inline (a chart fetches nothing, so a
      starter brings no file), and the dialog keeps its list and one-line
      hint: seven entries do not need a preview.
- [x] **The completion list stays visible near the preview.** Added
      2026-10-28, [#20](https://github.com/richarc/halmos/issues/20).
      Typing `@fig:`, `@tbl:` or a citation `@` near the editor's right
      edge opens the list under the preview. It should flip left when
      there is no room on the right, or be drawn over the preview as the
      command palette is. Likely `tooltips({ parent: document.body })` in
      `Editor.svelte`; check the citation hover tooltip too.
      *Done 2026-10-28 (not yet released):* in WebKit CodeMirror falls back
      to absolute positioning, so the list sat inside the scrolling editor
      pane and was clipped. Tooltips, the citation hover included, are now
      drawn from `document.body`.
- [ ] **Release v0.16.0**, once the items above are done. Cut by hand with
      `wails3 task release`, as v0.15.0 was. The portal's parts (Word and
      LaTeX headers and footers, the tutorial bundle) are deployed before
      it, and the site then offers this build.

## v1.0.0 — Production

Serves: M1.0

Distribution is step 1 of the website work: GitHub Releases for the binary and
a static documentation site, with no server to run and no ongoing cost beyond
the Apple Developer Program. Hosting users' documents as blog posts is a
separate, much larger project and is deliberately not part of this.

- [ ] **A release workflow.** CI arrived on 2026-08-23 — `ci.yml` runs the
      frontend suite and audit on Linux and the Go suite, build and
      govulncheck on macOS, and `codeql.yml` alongside it — but nothing
      releases. Do the first release by hand so the steps are understood, then
      move `wails3 task release` into a tag-triggered workflow. *Status
      2026-10-11*: every release from v0.9.0 to v0.11.4 has been cut by hand
      with `wails3 task release`, so the manual steps are understood; the
      workflow is what remains. That needs the
      Developer ID certificate and an App Store Connect API key as repository
      secrets, which is the part worth getting right rather than fast: a
      leaked signing identity is not revocable in any comfortable way. The
      API key matters more than convenience here — unlike an app-specific
      password it is not tied to a personal Apple ID, and it can be revoked
      on its own.
      *Status 2026-10-18*: the workflow exists (`release.yml`): a `v*` tag
      produces a notarized draft release. Tick this when a real release has
      gone through it. It notarizes with the Apple ID and an app-specific
      password for now, by choice; `release` already accepts an API key, and
      switching is a change to the workflow's build step. Parked the same
      day: the workflow is disabled on GitHub and releases are still cut by
      hand until the secrets are set up.
- [x] **A documentation site.** Done outside this repository: instead of a
      static site on GitHub Pages, the `hermesportal` application serves
      [halmoseditor.com](https://www.halmoseditor.com) — the landing page, the
      download, and the guides from `docs/`, rendered by Halmos's own
      renderer. Its roadmap tracks the site's work.
- [ ] **Third-party licence notices in the app.** The MIT, BSD and ISC
      licences of the bundled libraries (about 260: CodeMirror, markdown-it,
      KaTeX, Mermaid, Vega and their dependencies) require their copyright
      and licence text to travel with every copy. `bundle:licences` ships
      only LICENSE, NOTICE, citeproc-js and the CSL licence, and the build
      strips the licence comments from the bundle. Generate one
      third-party licences file during the frontend build (a licence plugin
      for Vite), copy it in with `bundle:licences`, and optionally add
      Help → Acknowledgements to open it. Also correct NOTICE, which says
      these dependencies "are credited in README.md": a credit is not the
      licence text.
- [x] **A better start screen.** Redesign the screen with the recent files
      list and the New and Open buttons so it looks more professional and
      is easier to read. Produce three alternative designs to assess
      before choosing one. *Done 2026-10-17*: option A, the split launcher.
- [x] **A design system, and the rest of the app brought up to it.** The
      new start screen makes the other screens look rough: button sizes,
      corners, spacing and dialog text sizes were each chosen one rule at a
      time. *Status 2026-10-17*: step 1 done, the Halmos Design System in
      Claude Design, built from `style.css`, which stays the master copy.
      The dialogs were audited against it and redesigned the same day
      (titles, 13px text, macOS button order, New document's style names
      and grey hints). The chart and table builders followed on
      2026-10-18 (preview beside the settings, plain names for chart
      choices, one joined table grid). The toolbar, outline and status bar
      followed the same day (button groups and an Outline toggle, outline
      rows like the start screen's, "Edited" and a red unknown-citations
      link). Done 2026-10-18: the last items, one spacing scale for the
      chrome (checked by a test), toast text at dialog size above the status
      bar, and two named button sizes.

## v1.1.0 — Back end, payment and first paid services

Serves: M1.1

The hosted back end, decided 2026-08-28 and given its first paid features
on 2026-10-12. Pandoc export moved here from v0.10.0: the dependency
question it turns on below — shell out to a user-installed Pandoc, or bundle
one — dissolves when the conversion runs on a server Halmos controls.

- [x] **Accounts and sign-in from the desktop app.** The app learns which
      paid features the user has. Sign-in tokens kept in the macOS Keychain.
      Payment, the privacy policy and terms, and the name clearance are
      product work outside this repository: see the M1.1 milestone.
      *Done 2026-10-20*: Connect pairs the Mac with the portal, Account…
      in the app menu shows the connection and the subscription.
- [ ] **Contributor licence agreement** before accepting outside pull
      requests. Today every commit is the author's, so the licence of future
      versions can still be changed; outside contributions without an
      agreement would remove that option.
- [x] Export to DOCX and LaTeX through Pandoc. Halmos already builds toward
      Pandoc without collecting the payoff: `![caption](img)` was chosen
      because it is exactly Pandoc's figure convention, citations are `[@key]`,
      and the figures design argues captions live in each format's native home
      so a Pandoc conversion keeps them. Meanwhile the only output is PDF
      through the print panel, and co-authors and journals want `.docx`.
      Pandoc runs on the server, so nothing is installed or bundled on the
      user's Mac. Bibliography handling needs
      thought — Pandoc can resolve citations itself from the same `.bib`,
      which may mean handing it the raw markdown rather than anything Halmos
      has already rendered.
      *Done 2026-10-20*: File → Export Word… and Export LaTeX… send the
      raw markdown, the cited part of the `.bib` and the style's CSL XML;
      Pandoc resolves the citations. Charts, diagrams and SVG go as PNG.
      Citations in the `.docx` are plain text, not live fields: that is
      the separate item below.
- [ ] **DOI lookup.** Paste a DOI or article URL and get a `.bib` entry added
      to the document's bibliography (Crossref).
- [ ] **Reference check.** Flags duplicate entries, missing fields, and
      retracted papers (Retraction Watch data in Crossref).
- [ ] **Word export keeps working citations**, so co-authors can edit the
      `.docx` without breaking references.
- [ ] **Publish a document to share it.** Added 2026-10-28; details at
      planning. A **Publish** button sends the document to the portal,
      which hosts it at a link the user can send to colleagues or friends.
      A paid service, so it needs Connect. Republishing updates the same
      link; the user can unpublish. The contract change comes first, and
      the portal serves it before this release.
      Open at planning: what is sent (rendered HTML, or the Markdown with
      its `.bib`, images and data files for the portal to render); where
      Publish lives (File menu, toolbar, palette); how the editor shows a
      document's link and whether it is out of date; and what is kept in
      the document or beside it.
- [ ] **Release v1.1.0**, once the items above are done and the portal's
      go-live deploy has switched billing on: the editor's paid features
      call what the portal must already serve. Before cutting it, check
      that signed builds never ask for the Keychain password (added
      2026-10-29). Development builds are signed ad hoc, so each rebuild is
      a new app to the Keychain and asks for the login password at every
      paid-service call (the refresh token is rewritten on each refresh).
      Release builds are signed with Developer ID, which should keep access
      across versions without asking. Check it: install a signed build,
      Connect and use a paid service; update to a second signed build and
      use it again. Neither should ask. If one does, consider the data
      protection keychain (`kSecUseDataProtectionKeychain`), which needs a
      keychain access group and an embedded provisioning profile.

## v1.2.0 — AI for routine work

Serves: M1.2

Paid, through the v1.1.0 back end. Every result is shown before it is
inserted, and nothing is written into the document without the user
accepting it.

- [ ] **Chart from a prompt.** Describe the chart and the data; the result
      is a Vega-Lite spec that opens in the existing chart builder
      (`readSpec`) for editing. If the builder cannot model the spec, say so
      instead of inserting it unseen.
- [ ] **LaTeX from a prompt** at the cursor, shown rendered before it is
      inserted.
- [ ] **Table from pasted text** (a copied spreadsheet range, a PDF table),
      opened in the table builder.
- [ ] **AI-use record and disclosure statement.** Many publishers now ask
      authors to declare generative AI use: the tool and version, what it
      was used for, and where in the paper. Authors piece this together
      from memory at submission, and the wording rules differ by journal,
      the same shape of problem as citation styles. Free, like citations
      (decided 2026-10-24). Expanded 2026-10-24:
      - The record covers all AI use, not only Halmos's: every Halmos AI
        action is recorded automatically (prompt, model and version, what
        was inserted, accepted or edited); a "Log AI use" entry covers tools
        used elsewhere (a chat assistant for language editing, a translator,
        a coding assistant); an optional "Was this AI-generated?" prompt
        after a large paste, off by default.
      - Kept beside the document in plain text (for example
        `paper.ai.json`), not in the frontmatter, so it goes into git and
        to co-authors with the paper.
      - Each entry is anchored to its section and a hash of the inserted
        text, so Halmos can tell whether that text survives, was rewritten
        or was deleted. The statement describes the paper as submitted, not
        every draft.
      - Disclosure styles, like citation styles: a template per journal or
        publisher policy saying what to state, in what words and where
        (methods, acknowledgements or a declaration section). Halmos drafts
        the statement from the record; the user edits it and inserts it as
        ordinary markdown, so it exports with the rest. A plain default
        covers journals with no template.
      - An optional report listing every entry (date, tool, purpose,
        section, survived or not), for a co-author, supervisor or editor.
      - The user can edit the record, so it is not tamper-proof evidence,
        and Halmos never says it is.
      Open: manual logging and the statement need no AI back end, so they
      could ship before v1.2.0; which publishers' policies to template
      first; whether the paste prompt helps or nags. Check each publisher's
      current policy wording before writing its template.
- [ ] **Prompt-injection safety.** An opened document must not be able to
      instruct the AI. Prerequisite: the Content-Security-Policy item in the
      backlog.
- [ ] **Auto-update.** Moved from v1.0.0 on 2026-10-18. Without
      something like Sparkle, everyone who downloads a release stays on it
      until they think to check. Tolerable at first; the main complaint later.
      One constraint to note now: Sparkle validates that an update is signed by
      the same team, so if the Developer ID ever changes — an individual
      enrolment becoming an organization one, say — that needs a transitional
      release. Cheapest while there are few users.
      *Status 2026-10-11*: since v0.10.0 Halmos checks a feed
      (`updates/latest.json`) and tells the user a newer version exists, but
      downloading and installing it is still manual.
- [ ] **Windows and Linux versions.** Moved here on 2026-10-18 from the
      backlog and v1.0.0. Many academics use Windows, and a Mac-only product
      limits who can pay. The paths, menus and print behaviour are currently
      macOS-focused.

## v1.3.0 — AI limited to the user's own sources

Serves: M1.3

Paid. The AI only ever cites what is in the user's `.bib` file or Zotero
library, so it cannot invent a reference.

- [ ] **Suggest references for the text at the cursor** from the user's
      library: the highlighted text if there is a selection, otherwise the
      sentence or paragraph around the cursor. Each suggestion comes with the
      reason it fits. The user chooses what to insert.
- [ ] **Search the PDFs in the user's Zotero library** to find where a
      source supports a claim. Decide whether the index is built locally or
      on the server; unpublished work and licensed PDFs argue for local.
- [ ] **Uncited-claim check.** Point out statements that look like they
      need a citation. Suggests, never writes.

## Backlog (unscheduled)

Ideas noted along the way, not yet committed to a release:

- **More reference formatting options.** Follows the v0.16.0 author-list
  keys (2026-10-29), same mechanism. Candidates from the CSL
  specification: `and` ("and" versus "&"), `initialize-with` and
  `initialize` (initials and their punctuation), `name-as-sort-order`
  ("Smith, J." order), `delimiter-precedes-last` (the serial comma),
  `page-range-format`, and the `disambiguate-…` options (how two "Smith
  2020" citations are told apart). Ask users which they need first.
- **Numbered headings and section references.** Split from the v0.15.0
  cross-references (2026-10-25). Decide whether headings are numbered
  (per document, in frontmatter), the format ("3", "3.2", "3.2.1") and
  its style in the preview and PDF, then add `{#sec:id}` labels and
  `@sec:id` references with the same pick-from-a-list completion. The
  citation parser already treats `sec:` keys as references. Pandoc's
  `numberSections` and pandoc-crossref's `sec:` labels carry it into Word
  and LaTeX, which needs a portal check.
- **Charts and diagrams as figures in LaTeX export.** Today Vega-Lite and
  Mermaid blocks reach the `.tex` as code, so they are not figures there
  and a cross-reference to one does not resolve (found designing the
  v0.15.0 cross-references, 2026-10-25). Word already gets them as PNG
  images (`lib/exportDiagrams.ts`). Explore sending LaTeX the same images,
  or PDF/SVG for sharp print, and what the portal needs to bundle image
  files with the `.tex` (a zip, or images embedded some other way).
- **Sync scrolling stutters on large, complex documents.** With Sync
  Scrolling off the editor scrolls smoothly; with it on, a long document
  full of charts and maths is jumpy (reported 2026-10-25). The preview had
  moved in whole source lines, so a wrapped paragraph held it still and
  then jumped; that is fixed (`lineAtHeight`). What remains is not in
  script: timed in a dev build, each sync took a median 1 ms (max 6 ms) at
  60 a second, with no anchor re-measuring, nearly all of it in setting the
  preview's `scrollTop`. The likely cost is WebKit painting the newly
  exposed preview on the main thread, since the preview is scrolled from
  script while the editor scrolls on WebKit's scrolling thread. Not yet
  confirmed: the one Timelines recording had Screenshots on, which
  dominated every frame. Next: record with Screenshots off, Sync Scrolling
  on and off, and read the Layout & Rendering track (see the
  `web-inspector` skill). Possible fixes depend on that: composited layers
  for charts and formulas, or easing the preview toward its target rather
  than setting it each frame.
- From the Markdown-books review (2026-10-23):
  - ePub export. Pandoc produces it with little extra work, so it would
    be a fourth format on the portal's existing conversion endpoint.
    Matters less for papers than for books; schedule it if users ask.
  - Not adopted, with reasons: one file per chapter (the file-tree
    decision below still stands; Halmos is for papers), hosting documents
    online (out of scope, see v1.0.0), and MyST-style `{note}` blocks
    (Halmos's GitHub-style alerts travel better).
- From the pre-1.0 review (2026-10-23), deferred with reasons:
  - Go accepts any path the page sends to its file-reading and writing
    methods. Only matters if script ever runs in the page, which the
    v0.15.0 security fixes guard against; do it before the AI features
    put model output in the page.
  - Split `App.svelte` (1,945 lines; the guard against acting while a
    dialog is open is copied 18 times) before v1.1.0 adds more dialogs.
  - Split `DocumentService` (37 methods over 9 concerns). A refactor, no
    defect.
  - A diagnostics log, so a user can send one with a support request.
    Plan it with the paid services in v1.1.0.
  - Type the Go → JS events and pin the remaining Go/TS constants with
    tests, as the existing ones are.
  - Editing a citation reformats every citation (186 ms at 200); use
    citeproc's incremental update.
  - Each preview update re-parses all the rendered HTML (29 of 38 ms on a
    50-page paper); re-parse only changed blocks.
  - The startup bundle grew 25% since v0.4: KaTeX is bundled twice and
    the `.bib` parser loads before it is needed.
  - Clear the render timing measures, which grow by a few MB an hour.
  - Tighten Quick Look's offline rules.

- Revisit Vite 8 once the upstream Rolldown lone-surrogate bug is fixed
  (v0.1 pinned Vite 7 to keep KaTeX's lexer intact).
- File a Wails issue for the hardcoded landscape print orientation (their
  code carries a TODO inviting a config option; Halmos ships its own print
  path meanwhile).
- The chart hydrator runs twice on first open. The document renders once
  immediately and again when the bibliography loads, so the first hydrate
  pass is abandoned by the generation guard part-way through its embeds and
  the second does them over — every first-open `hermes:hydrate-charts`
  reading is one large entry followed by a 170–200 ms one (seen 2026-09-05
  during the v0.11 A/B). Correct, but wasted work. Either delay the first
  render until the formatter is known, or let the second pass adopt the
  first's finished embeds instead of starting from the placeholders.
- Security hardening for third-party documents. A `.md` file can cause the app
  to make a network request on open, with no click and no prompt: a
  `vega-lite` block whose spec carries `data.url` is fetched by `vega-loader`
  the moment the preview renders, and `embedChart` passes no loader
  restriction. A URL alone leaks that the document was opened, and from which
  IP. The webview also sets **no Content-Security-Policy**, so the same is true
  of any other remote reference a document can express — a remote `<img>`, for
  instance. A `default-src 'self'` policy, with an explicit allowance for the
  Zotero picker on `127.0.0.1:23119`, would close the whole class in one
  change. It needs a decision first, though: it would also block remote chart
  data and remote images, which some users legitimately want, so the useful
  version is probably a setting — off by default for safety, or on by default
  with a per-document prompt.
  Audited 2026-08-06: this is the *only* way Halmos reaches the network beyond
  the Zotero picker. No `fetch`, `XMLHttpRequest` or `WebSocket` anywhere in
  `frontend/src`; one `http.Client` in Go, pointed at localhost. The ~60 URLs
  in the bundle are identifiers (XML namespaces, CSL style IDs, ORCIDs), not
  endpoints, and are never fetched.
- ~~Two document types: single-file, and a multi-part type living in a
  directory.~~ **Dropped 2026-08-06.** Halmos stays single-file. The research
  found the deciding question was not "one file or many" but what the preview
  shows while you edit one part, and that the honest cost was not the
  rendering: scroll sync's anchors are a flat integer line space that would
  need a second dimension, `dirty` is one buffer against one saved copy, the
  bibliography watcher is explicitly a single watcher, and picking a part needs
  a file-tree pane that is probably larger than all the rendering work
  combined. Two document types also means two code paths through save, dirty,
  watch, sync and export, tested twice, forever. The organisational problem it
  was meant to solve is being approached instead by making long blocks
  collapsible in the editor.

- Leftovers from the v0.11.4 final review, judged minor:
  - A file opened from Finder while a builder or the New dialog is open is
    ignored with no message (`requestOpenRecent` returns early).
  - A file opened from Finder while the unsaved-changes dialog is up for a
    close or quit replaces that pending action, so Don't Save opens the
    file instead of closing or quitting.
- The `.md` association is by extension only (`CFBundleTypeExtensions`). If
  Open With turns out to miss Halmos on some macOS version, add
  `LSItemContentTypes` with `net.daringfireball.markdown`. Wails' Info.plist
  template has no field for it, so it would be a hand edit that
  `update:build-assets` drops.

- Spelling and Grammar submenu (Edit menu). Wails has no spelling roles,
  so `toggleContinuousSpellChecking:`, `checkSpelling:` and
  `showGuessPanel:` can only be sent from Objective-C via cgo. Not built in
  v0.10.0 because the Check Spelling setting covers the on/off case.
- Whole-document spell check. WebKit checks only the word typed and the
  word the caret leaves, never a loaded document. A full pass needs a
  JavaScript dictionary run over the text.
- Layered charts in the chart builder (points over error bars, a regression
  line over a scatter). Needs `layer` and `transform` in the
  `buildSpec`/`readSpec` round trip; `PASSTHROUGH_KEYS` excludes them today.
- Bug (to confirm): white space at the top of each page in Print….
  Export PDF… was fixed on 2026-10-22 (46mm top margin instead of 25mm),
  but Print… was left alone: it uses 30pt `NSPrintInfo` margins and the
  paper chosen in the print panel, on top of the same `@page` rule from
  `lib/paper.ts`. Reproduce first: print a multi-page document to PDF from
  the panel on A4 and US Letter, portrait and landscape, and measure the
  top margin. If it is wrong, decide whether Print… should use the same
  margin rule as Export PDF…. Moved from v0.15.0 on 2026-10-24.
- Headers and footers in File → Print…. Export PDF… draws them on the
  rendered file; Print… sends pages to the print panel, so there is no file
  to draw on. It would need its own drawing step, or Print… could render a
  stamped PDF and print that.

- Leftovers from the v0.12.0 reviews, judged minor:
  - Opening a document that uses a different bibliography leaves the
    previous one in effect for the editor's citation features (autocomplete,
    hover, underlines, unknown count) until the new one loads, typically
    under half a second.
  - The unknown-citation list can show the previous document's keys for up
    to 300 ms after opening another document with the same bibliography.
  - Right after Zotero starts, while Better BibTeX is still loading, Halmos
    says Better BibTeX is not installed. A "starting, try again" message
    would be more accurate.
  - The same inline footnote written twice (`^[see @a]` twice in one
    paragraph) puts the second one's underline and line number on the
    first. The preview is unaffected. Needs per-note offset tracking in
    `lib/citationKeys.ts`.
  - The unknown-citation count parses the whole document a second time on
    each typing pause, alongside the preview render. Derive it from the
    render's citations if large documents feel slow.

- Leftovers from the v0.14.0 reviews, judged minor:
  - Task lists and alerts: an empty `- [ ]` shows a lone checkbox; nested
    task-list spacing is unchecked; an alert marker line ending in two
    trailing spaces (a hard break) stays a plain blockquote.
  - Copy button: no message if the clipboard write fails; it can overlap a
    long first line; it is a white chip on the sepia sheet; it shows on every
    fenced block, while the docs say highlighted blocks.
  - Pasted images: if the document changes mid-paste the saved file is left
    unused with no message; a paste refused by the editor's guards gives no
    feedback; no size limit; a crash mid-write can leave a `.pasted.tmp*`
    file.
  - HTML export: an untitled document exports as `Untitled.html` while the PDF
    is `untitled.pdf`; `lang="en"` is fixed; no size limit on embedded images
    (the docs say so). The PDF save panel, unlike the HTML one, does not open
    beside the document.
  - Quick Look: a chart whose data comes from a web address is drawn empty
    (by design: the content rules block it); the release's `network.server`
    guard passes if `codesign -d` itself errors.
  - Tests: the chart-exclusion test for the copy button is weak; the contrast
    test's theme discovery would miss a theme name with digits or hyphens;
    the post-export abort path has no test of its own.
  - Autocomplete's maths and frontmatter checks are bounded for speed:
    display maths spanning a blank line, and frontmatter over 100 lines,
    are not recognised.
  - A `.csl` style file is not watched; edits on disk need the style chosen
    again or the document reopened. By design in v0.12.0.
  - Numeric styles (IEEE, Vancouver) show `[1]` in every hover tooltip,
    and number a citation inside a footnote by its position in the source.
- Re-record the citations demo (`docs/demos/citations.demo`) to show
  autocomplete, hover, the unknown-citation list and the style menu. Needs
  Screen Recording granted to the signed app (see the `demo-mode` skill).

### Deferred review findings

Real findings from the v0.4, v0.5 and v0.8 code reviews and from manual
testing, judged not to block those releases. Recorded so they are not
rediscovered from scratch; struck as they are fixed.

What is left is not a queue. Both entries are decisions — one an accepted
limitation, one a test deliberately not written — kept here because the
reasoning is the useful part and would otherwise have to be worked out again
by whoever next notices the behaviour:

- Scroll-sync anchor density is sparser inside blockquotes and list items: the
  markdown-it core rule stamps `data-source-line` on top-level blocks only, so
  a long list is one anchor rather than several. Interpolation keeps this
  near-exact for uniform content; it degrades only when a list item contains a
  chart or a large image.
- `Editor.topVisibleLine()` has no test, and the reviewer argued *against*
  adding the obvious one: under jsdom `posAtCoords` returns null so the
  function always yields 1, which is also what the happy path returns for
  offset 0 — a test asserting 1 would pass against an implementation that
  dropped the null check entirely. Testing it honestly needs a real layout
  engine.
