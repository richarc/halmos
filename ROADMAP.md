# Hermes Roadmap

Hermes is a desktop editor for writing academic papers in markdown, with LaTeX
math and Vega-Lite charts rendered live and exported to PDF. Releases follow
[Semantic Versioning](https://semver.org). This file lists planned and
in-progress work only; [CHANGELOG.md](CHANGELOG.md) records what has shipped,
and git history holds the earlier versions of this file with the design notes
for each release.

## Direction

Agreed 2026-10-12. These rules decide what goes into each release below.

- **The desktop editor stays free, and so do citations.** Citations are
  Hermes's main strength and the reason to choose it, so making them
  seamless comes first and is never behind a payment.
- **Hermes earns money from a hosted back end.** Paid features are the ones
  that cost money to run: Pandoc conversion on a server, reference lookups
  and AI calls. A subscription matches that ongoing cost.
- **AI removes routine work; it does not write the paper.** Acceptable:
  equations, charts, tables, formatting, conversion, reference clean-up and
  finding sources in the user's own library. Not offered: writing the
  user's paragraphs, arguments or conclusions. Hermes keeps a record of what
  the AI did in each document and can produce the AI-use disclosure
  statement journals ask for.
- **Order:** citation improvements, then v1.0.0, then the back end and
  payment with export and citation services as the first paid features,
  then AI for routine work, then AI limited to the user's own sources.

## v0.13.0 — Reading and sharing

Smaller improvements for reading and sharing documents. Can move after
v1.0.0 if the release work needs the time.

- [ ] **Quick Look preview for `.md` files.** Finder's space-bar preview shows
      the rendered document, so a reader sees Hermes output without opening
      the app. Builds on the `.md` association from v0.11.4. Needs a Quick
      Look preview extension inside the bundle; the renderer is JavaScript,
      so the extension has to host a web view or reuse the bundled
      `frontend/dist`. Check what this does to signing and notarization in
      `wails3 task release` before starting.
- [ ] **Rendering additions.** markdown-it plugins for task lists and
      GitHub-style alerts (`> [!NOTE]`). Each needs preview styles in
      `style.css` under the colour contract, PDF export checked, and
      spell-check scoping checked.
- [ ] **Copy button on code blocks** in the preview. Hidden in PDF export.
- [ ] **Paste an image into the editor.** Save the pasted image beside the
      document (an `images/` folder or similar, to decide) and insert
      `![](path)`. `localimages.go` already serves images from beside the
      document; this is the missing write side. An untitled document has no
      folder yet, so it needs a rule: refuse with a message, or ask to save
      first.
- [ ] **Export to self-contained HTML.** One file with styles, maths, charts
      and local images inlined, for sharing a draft without a PDF. Charts as
      inline SVG, images as data URIs. Remote images stay remote.
- [ ] **Reading comfort.** A third theme (sepia or similar) and a choice of
      body font for the preview. Both are settings in `settings.go`. A third
      theme means a third palette block in `style.css`, and
      `styleContract.test.ts` currently checks exactly two blocks, so the
      test changes with it.

## v1.0.0 — Production

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
- [ ] **A documentation site**, static, on GitHub Pages. Most of the content
      exists — `README.md`, `docs/authoring.md`, `CHANGELOG.md` — so
      the work is a generator (Astro Starlight, MkDocs Material or similar), a
      landing page with a download link, and pointing the release at it.
      Sequencing note: the bundled in-app guides land in v0.9, and the
      eventual ambition is that the site's pages ARE Hermes documents
      published through the app. That argues for keeping the first site
      deliberately thin rather than investing in a structure the publishing
      work would then replace.
- [ ] **Auto-update — deliberately deferred, and worth naming.** Without
      something like Sparkle, everyone who downloads a release stays on it
      until they think to check. Tolerable at first; the main complaint later.
      One constraint to note now: Sparkle validates that an update is signed by
      the same team, so if the Developer ID ever changes — an individual
      enrolment becoming an organization one, say — that needs a transitional
      release. Cheapest while there are few users.
      *Status 2026-10-11*: since v0.10.0 Hermes checks a feed
      (`updates/latest.json`) and tells the user a newer version exists, but
      downloading and installing it is still manual.
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
- [ ] **Pricing page on the documentation site**, ready for v1.1.0. The
      site states what is free (the editor and citations) and what the
      subscription adds.
- [ ] Windows and Linux stay in the backlog. Decide before v1.1.0 whether
      Windows comes before the first paid release: many academics use it,
      and a Mac-only product limits who can pay.

## v1.1.0 — Back end, payment and first paid services

The hosted back end, decided 2026-08-28 and given its first paid features
on 2026-10-12. Pandoc export moved here from v0.10.0: the dependency
question it turns on below — shell out to a user-installed Pandoc, or bundle
one — dissolves when the conversion runs on a server Hermes controls.

- [ ] **Accounts and sign-in from the desktop app.** The app learns which
      paid features the user has. Sign-in tokens kept in the macOS Keychain.
- [ ] **Payment.** A subscription through a merchant of record (Paddle or
      similar), which handles VAT and sales tax worldwide. Decide whether a
      free allowance of conversions and lookups is included.
- [ ] **Hosting, privacy policy and terms.** Documents sent for conversion
      are processed and not kept. Say so in the policy and design the server
      so it is true.
- [ ] **Licence and name.** Decided 2026-10-13: the desktop app stays
      Apache-2.0 and the server code stays private. Before charging: check
      and register the product name as a trademark ("Hermes" alone is a
      crowded name; Apache-2.0 grants no trademark rights), and have a
      lawyer review the licence, trademark and terms together.
- [ ] **Contributor licence agreement** before accepting outside pull
      requests. Today every commit is the author's, so the licence of future
      versions can still be changed; outside contributions without an
      agreement would remove that option.
- [ ] Export to DOCX and LaTeX through Pandoc. Hermes already builds toward
      Pandoc without collecting the payoff: `![caption](img)` was chosen
      because it is exactly Pandoc's figure convention, citations are `[@key]`,
      and the figures design argues captions live in each format's native home
      so a Pandoc conversion keeps them. Meanwhile the only output is PDF
      through the print panel, and co-authors and journals want `.docx`.
      Pandoc runs on the server, so nothing is installed or bundled on the
      user's Mac. Bibliography handling needs
      thought — Pandoc can resolve citations itself from the same `.bib`,
      which may mean handing it the raw markdown rather than anything Hermes
      has already rendered.
- [ ] **DOI lookup.** Paste a DOI or article URL and get a `.bib` entry added
      to the document's bibliography (Crossref).
- [ ] **Reference check.** Flags duplicate entries, missing fields, and
      retracted papers (Retraction Watch data in Crossref).
- [ ] **Word export keeps working citations**, so co-authors can edit the
      `.docx` without breaking references.

## v1.2.0 — AI for routine work

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
      with the document (what was asked, what was inserted, when). Hermes
      can produce a disclosure statement from that record.
- [ ] **Prompt-injection safety.** An opened document must not be able to
      instruct the AI. Prerequisite: the Content-Security-Policy item in the
      backlog.

## v1.3.0 — AI limited to the user's own sources

Paid. The AI only ever cites what is in the user's `.bib` file or Zotero
library, so it cannot invent a reference.

- [ ] **Suggest references for a paragraph** from the user's library, with
      the reason each one fits. The user chooses what to insert.
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
  code carries a TODO inviting a config option; Hermes ships its own print
  path meanwhile).
- Windows/Linux support (paths, menus, and print behavior are currently
  macOS-focused).
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
  Audited 2026-08-06: this is the *only* way Hermes reaches the network beyond
  the Zotero picker. No `fetch`, `XMLHttpRequest` or `WebSocket` anywhere in
  `frontend/src`; one `http.Client` in Go, pointed at localhost. The ~60 URLs
  in the bundle are identifiers (XML namespaces, CSL style IDs, ORCIDs), not
  endpoints, and are never fetched.
- ~~Two document types: single-file, and a multi-part type living in a
  directory.~~ **Dropped 2026-08-06.** Hermes stays single-file. The research
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
- Quitting from the Dock menu or at logout with unsaved changes loses them.
  Those paths go straight to `applicationShouldTerminate`, which Wails
  beta.12 gives no hook for; only ⌘Q and the close button are guarded.
  Pre-dates v0.11.4.
- The `.md` association is by extension only (`CFBundleTypeExtensions`). If
  Open With turns out to miss Hermes on some macOS version, add
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
  - Right after Zotero starts, while Better BibTeX is still loading, Hermes
    says Better BibTeX is not installed. A "starting, try again" message
    would be more accurate.
  - The same inline footnote written twice (`^[see @a]` twice in one
    paragraph) puts the second one's underline and line number on the
    first. The preview is unaffected. Needs per-note offset tracking in
    `lib/citationKeys.ts`.
  - The unknown-citation count parses the whole document a second time on
    each typing pause, alongside the preview render. Derive it from the
    render's citations if large documents feel slow.
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
