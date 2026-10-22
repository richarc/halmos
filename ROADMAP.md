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
- [ ] **Follow changes made to the open file by something else**, as the
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
- [ ] **An Export menu.** Move Export PDF… (⌘E), Export HTML…, Export
      Word… and Export LaTeX… out of File into their own top-level menu.
      They are added in `menu.go` (`addPandocExportItems` for Word and
      LaTeX); the `menu:export-*` events and the frontend handlers stay as
      they are.
- [ ] **Chart builder improvements.** Scope to follow. Candidates already
      recorded: layered charts (Backlog) and the builder left open when the
      window closes (v0.11.4 leftovers).
- [ ] **Page numbers, headers and footers in exported output.** Set in the
      frontmatter, like `bibliography`, `csl` and `toc`, so a document
      carries its own page setup. The key names and what they can hold
      (fixed text, the title, the page number, page of pages) are to be
      decided. Each format needs its own route:
      - PDF: `print_darwin.go` prints with zero margins and lets the CSS
        `@page` rule set the 25mm margin, and nothing draws a header or
        footer today. WebKit's printing does not appear to support CSS
        page-margin boxes (`@top-center`, `counter(page)`); check that
        first, because if it is true the PDF route needs a different
        mechanism, and that decides the size of this item.
      - Word and LaTeX: made by the portal's Pandoc conversion, so the
        settings travel in the export request and the portal applies them
        (a reference `.docx` for Word, the LaTeX template or `fancyhdr`
        for LaTeX).
      - HTML: page numbers only matter when it is printed; decide whether
        it gets print CSS or nothing.
- [ ] **Control how references are formatted, beyond the chosen style.**
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
- [ ] **Architecture, performance and security review** of the whole app
      before v1.0.0. Findings that block 1.0 are fixed here; the rest go to
      the Backlog with the reasons, like the earlier review leftovers.

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
- [ ] **AI-use record and disclosure statement.** Each AI action is recorded
      with the document (what was asked, what was inserted, when). Halmos
      can produce a disclosure statement from that record.
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
  - Closing the window while the chart builder, table builder or New
    dialog is open leaves it open; after a Dock click it reappears over the
    welcome pane. `closeDocument` in `App.svelte` could close them.
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
