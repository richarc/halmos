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
serves, and lists the editor's own work for it. AI in Halmos removes
routine work but does not write the paper.

## v1.0.0 — Production

Serves: M1.0

A signed, notarized editor anyone can download, with the licence notices
it owes. The documentation site, the new start screen and the design system
for this release have shipped (see CHANGELOG.md, v0.15.0).

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
- [ ] **Bookmarks and document properties in the exported PDF.** Export
      PDF… writes a PDF with no outline and no title or author, because
      WebKit's printing adds neither. Add a bookmark for each heading (the
      sidebar outline in Preview and Acrobat, which a long thesis needs)
      and set the title and author from the frontmatter. Bookmarks need the
      page each heading landed on, which only the finished PDF knows: on
      macOS, find each heading's text in it with PDFKit. Write the outline
      and properties in Go with pdfcpu (Apache-2.0, pure Go) rather than
      PDFKit, so the Windows version (v1.1.0) can reuse that step; check
      first that pdfcpu writes nested bookmarks and keeps the links and
      searchable text WebKit produced. Added 2026-10-30.
- [ ] **Pre-1.0 clean-up.** An architecture review on 2026-10-30 found the
      code in good shape (vet clean, no races, 78% Go coverage, all calls
      through generated bindings) and listed 20 fixes to make before the
      1.0 freeze, plus `release` refusing a working tree that is not clean
      or not at the tag (added 2026-10-31). Small defects: Show in Finder leaves a process behind, a
      shared error value, a test double in the app, the bibliography reader
      accepting any file, Print finding the wrong window, and `wails3 dev`
      building a production binary. Then Wails v3.0.0's own patterns: typed
      events, `ServiceShutdown`, the v3.0.0 build template ported by hand,
      one quit path. Then structure: settings changed one field at a time,
      typed file errors, saving through symlinks with Finder tags kept,
      settings and the update check as their own services, the Wails-free
      code in `internal/` packages, `App.svelte`'s event wiring in a module,
      a Windows compile check in CI, and fuzz tests. Spec
      `docs/superpowers/specs/2026-10-30-pre1.0-cleanup-design.md`, plan
      `docs/superpowers/plans/2026-10-30-pre1.0-cleanup.md`. Added
      2026-10-30.

## v1.1.0 — Windows and free export

Serves: M1.1

The Windows version, auto-update, and Word and LaTeX export for any
connected account. Reordered 2026-11-01.

The hosted back end was decided 2026-08-28. Pandoc export moved here from
v0.10.0: the dependency question it turns on below — shell out to a
user-installed Pandoc, or bundle one — dissolves when the conversion runs on
a server Halmos controls.

- [ ] **Windows and Linux versions.** Moved here on 2026-10-18 from the
      backlog and v1.0.0. Many users are on Windows. The paths, menus and
      print behaviour are currently macOS-focused.
      PDF export, from a review on 2026-10-30: on Windows the app runs in
      WebView2, which is Chromium, so Export PDF needs its own route there
      (WebView2's print to PDF, or Chromium's own PDF printing through it).
      Chromium is the better printer: confirm in a spike whether it gives
      running headers and footers with page numbers, bookmarks from the
      headings, tagged PDF and CSS page-margin boxes. `pdfstamp_darwin.go`
      is PDFKit and does not port, so move the header and footer drawing
      into shared Go (pdfcpu, as the v1.0.0 bookmarks step does), leaving
      each platform only to render the preview to a PDF at the paper size.
      The same document will break pages differently on Mac and Windows
      (different fonts and line breaking; New York is macOS-only), while
      each PDF still matches its own preview; say so in the docs. Only a
      separate typesetter such as Typst would make the two identical, at the
      cost of the PDF no longer matching the preview.
      *Moved to v1.1.0 on 2026-11-01.* Windows is the requirement; Linux
      ships with it only if it costs little more, otherwise it follows.
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
      *Moved to v1.1.0 on 2026-11-01*: with the Windows version, which needs
      its own update route.
- [x] **Accounts and sign-in from the desktop app.** The app learns which
      services the account can use. Sign-in tokens kept in the macOS
      Keychain. The account's back end, the privacy policy and the terms are
      outside this repository.
      *Done 2026-10-20*: Connect pairs the Mac with the portal, Account…
      in the app menu shows the connection and the account.
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
- [ ] **Word and LaTeX export for any connected account.** Added
      2026-11-01. Release builds show Connect and Export Word…/LaTeX… from
      v1.1.0; the portal serves conversion to any connected device. Narrow
      the `nopaid` tag to the account parts not yet live, which v1.2.0
      drops. The
      export guide and Getting Started say export needs a free account and
      an internet connection, and that documents are converted and not
      kept. Pandoc stays on the server for now: bundling it locally means
      porting the portal's conversion to Go, signing and shipping Pandoc
      and pandoc-crossref (GPL, as separate programs) for each platform,
      and releasing the editor for every conversion fix. Reconsider if
      users ask for offline export.
- [ ] **Contributor licence agreement** before accepting outside pull
      requests. Today every commit is the author's, so the licence of future
      versions can still be changed; outside contributions without an
      agreement would remove that option.
- [ ] **Release v1.1.0**, once the items above are done and the portal
      serves conversion to any connected account: the editor calls what the
      portal must already serve. Before cutting it, check that signed builds
      never ask for the Keychain password (added 2026-10-29). Development
      builds are signed ad hoc, so each rebuild is a new app to the Keychain
      and asks for the login password at every portal call (the refresh
      token is rewritten on each refresh). Release builds are signed with
      Developer ID, which should keep access across versions without
      asking. Check it: install a signed build, Connect and export to Word;
      update to a second signed build and export again. Neither should ask.
      If one does, consider the data protection keychain
      (`kSecUseDataProtectionKeychain`), which needs a keychain access group
      and an embedded provisioning profile. Includes the Windows build.

## v1.2.0 — Citations and equations right

Serves: M1.2

Getting a reference right (DOI lookup, reference check, `@cite` search) and
LaTeX for equations written from a prompt, through the hosted service the
editor connects to from v1.1.0. Every AI result is shown before it is
inserted, and nothing is written into the document without the user
accepting it. Reordered 2026-11-01.

- [ ] **DOI lookup.** Paste a DOI or article URL and get a `.bib` entry added
      to the document's bibliography (Crossref).
      *Moved to v1.2.0 on 2026-11-01.*
- [ ] **Reference check.** Flags duplicate entries, missing fields, and
      retracted papers (Retraction Watch data in Crossref).
      *Moved to v1.2.0 on 2026-11-01.*
- [ ] **Find a reference by describing it (`@cite` search).** Type a
      description instead of a key, such as `[@cite transformer attention
      Vaswani]` or `[@cite "double descent in deep learning"]`, and get a
      short list of matching papers from scholarly catalogues (OpenAlex,
      Semantic Scholar, Crossref), each with its title, authors, year,
      venue and DOI. The user picks one; its BibTeX is added to the
      document's `.bib` (not added again if the DOI is already there) and
      the `@key` replaces the search at the cursor. Built first as a plain
      catalogue search with no AI; v1.3.0 adds
      AI to build the search and rank what comes back. Every result is a
      record the catalogue returned, never an entry Halmos wrote. Shares
      the DOI lookup's route to a `.bib` entry (v1.2.0). Decide the trigger
      in the spec: typed `@cite` in the editor, an Insert menu item and a
      palette command. Added 2026-10-31 in v1.3.0; moved here the same day.
- [ ] **LaTeX from a prompt** at the cursor, shown rendered before it is
      inserted.
      *Moved to v1.2.0 on 2026-11-01*: the first AI feature.
- [ ] **AI-use record and disclosure statement.** Many publishers now ask
      authors to declare generative AI use: the tool and version, what it
      was used for, and where in the paper. Authors piece this together
      from memory at submission, and the wording rules differ by journal,
      the same shape of problem as citation styles. Expanded 2026-10-24:
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
      *Moved to v1.2.0 on 2026-11-01*: with the first AI feature. Templates
      for universities' AI-use declarations in assignments come before
      publishers' ones.
- [ ] **Prompt-injection safety.** An opened document must not be able to
      instruct the AI. Prerequisite: the Content-Security-Policy item in the
      backlog.
      *Moved to v1.2.0 on 2026-11-01*: with the first AI feature.
- [ ] **AI usage meter.** Added 2026-10-31. The editor shows the
      account's AI use (Account… and beside the AI commands), warns before
      it runs out, and when it has, says so and links to the account page
      on the portal. The portal reports the usage; the editor holds no
      limits or prices of its own.
      *Moved to v1.2.0 on 2026-11-01*: with the first AI feature.
- [ ] **Release v1.2.0**, once the items above are done and the portal
      serves them: the editor calls what the portal must already serve.
      Drops the `nopaid` tag. Added 2026-11-01.

## v1.3.0 — Knowing what to cite

Serves: M1.3

Points out what needs a citation and finds it. The AI only ever cites
what is in the user's `.bib` file or Zotero library, or a real record the
user finds and picks from a scholarly catalogue, so it cannot invent a
reference. Was v1.4.0 until 2026-11-01.

- [ ] **Uncited-claim check.** Point out statements that look like they
      need a citation. Suggests, never writes.
      *Moved to v1.3.0 on 2026-11-01*: first in this release.
- [ ] **Suggest references for the text at the cursor** from the user's
      library: the highlighted text if there is a selection, otherwise the
      sentence or paragraph around the cursor. Each suggestion comes with the
      reason it fits. The user chooses what to insert.
- [ ] **`@cite` search ranked by AI.** The v1.2.0 search, with the AI
      turning the description into a better search and ranking what comes
      back. Results stay records the catalogue returned, never an entry the
      AI wrote. Added 2026-10-31.
- [ ] **Search the PDFs in the user's Zotero library** to find where a
      source supports a claim. Decide whether the index is built locally or
      on the server; unpublished work and licensed PDFs argue for local.

## v1.4.0 — Charts, tables and sharing

Serves: M1.4

AI help with charts and tables, shown before it is inserted, and
publishing a document to share it. Was in v1.2.0 (publishing) and v1.3.0
(charts and tables) until 2026-11-01.

- [ ] **Chart from a prompt.** Describe the chart and the data; the result
      is a Vega-Lite spec that opens in the existing chart builder
      (`readSpec`) for editing. If the builder cannot model the spec, say so
      instead of inserting it unseen.
      *Moved to v1.4.0 on 2026-11-01*: after the citation work.
- [ ] **Table from pasted text** (a copied spreadsheet range, a PDF table),
      opened in the table builder.
      *Moved to v1.4.0 on 2026-11-01*: after the citation work.
- [ ] **Publish a document to share it.** Added 2026-10-28; details at
      planning. A **Publish** button sends the document to the portal,
      which hosts it at a link the user can send to colleagues or friends.
      It needs Connect. Republishing updates the same
      link; the user can unpublish. The contract change comes first, and
      the portal serves it before this release. Moved from v1.1.0 on
      2026-10-31.
      Open at planning: what is sent (rendered HTML, or the Markdown with
      its `.bib`, images and data files for the portal to render); where
      Publish lives (File menu, toolbar, palette); how the editor shows a
      document's link and whether it is out of date; and what is kept in
      the document or beside it.
      *Moved to v1.4.0 on 2026-11-01*: after the citation work.

## Backlog (unscheduled)

Ideas noted along the way, not yet committed to a release:

- **A Problem set starter** in the New dialog: numbered questions, each
  with a worked answer under it. Noted 2026-11-01.
- **Check Dirac notation.** Confirm that `\ket`, `\bra` and `\braket`
  render well in the preview and in every export. Noted 2026-11-01.
- **Quantum circuit diagrams.** What `quantikz` does in LaTeX; Mermaid does
  not draw circuits. Investigate a circuit builder like the chart builder.
  Noted 2026-11-01.
- **Try Pele as the diagram renderer.** Pele (`pele`, MIT, from the
  Obsidian team) reads Mermaid 12.1 syntax and draws SVG with no
  dependencies: about 230 KB against Mermaid's 1.6 MB, and well under a
  millisecond a diagram. It would make diagrams appear at once, shrink
  Quick Look's single script (8.4 MB, mostly Mermaid), and drop the
  Mermaid 12 settings `lib/mermaid.ts` pins. The swap is one function,
  `renderMermaid`, whose SVG the HTML and Word exports already use. Not
  before 1.0: it was four weeks old with 23 releases when noted, against
  the 1.0 dependency hold, and it draws with its own layout and look, so
  every existing diagram would change. Compare both renderers on the
  diagrams in `docs/` first; Quick Look could move before the app.
  Noted 2026-11-01.
- **Word export keeps working citations**, so co-authors can edit the
  `.docx` without breaking references. Moved from v1.1.0 on 2026-10-31:
  it matters most once review is a loop (v1.1.0's review import), and
  it invites co-authors to treat the Word file as the master copy.
  *Moved to the backlog on 2026-11-01.*
- **Import review changes from a returned Word document.** Added
  2026-10-31. Word export is mostly a hand-off, and the common loop is
  a supervisor or co-author returning the `.docx` with tracked changes
  and comments, which the author now copies into the Markdown by hand.
  Import the returned file and show its tracked changes and comments as
  suggestions against the Markdown, one paragraph at a time, beside the
  source; the user accepts or rejects each, and the Markdown stays the
  master copy. It works because Halmos knows what it exported: keep a
  snapshot of the text each export sent, have the portal convert the
  returned file with Pandoc keeping tracked changes and comments,
  compare paragraph by paragraph against the snapshot, and map each
  change back to its source lines. Only prose changes are offered:
  citations, charts, cross-references, labels and frontmatter are never
  re-imported from Word. It needs Connect; the
  contract change comes first, and the portal serves it before this
  release. Open at planning: where the snapshot is kept (beside the
  document, or in the app's data folder keyed by document), what
  happens when the Markdown changed after the export, how a change that
  spans paragraphs or touches a citation is shown, and whether comments
  can be kept as Markdown comments.
  *Moved to the backlog on 2026-11-01.*
- **A release workflow.** CI arrived on 2026-08-23 — `ci.yml` runs the
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
  *Moved to the Backlog 2026-10-31*: not needed for 1.0. Its one gain over
  the hand release is a build of exactly the tagged commit, which the
  pre-1.0 clean-up gets by making `release` refuse a working tree that is
  not clean or not at the tag. The cost it would add is the signing
  identity held as GitHub secrets. The workflow stays in the repository,
  disabled.
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
    Plan it with the Windows version in v1.1.0.
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
