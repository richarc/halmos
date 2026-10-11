# Hermes Roadmap

Hermes is a desktop editor for writing academic papers in markdown, with LaTeX
math and Vega-Lite charts rendered live and exported to PDF. Releases follow
[Semantic Versioning](https://semver.org). This file lists planned and
in-progress work only; [CHANGELOG.md](CHANGELOG.md) records what has shipped,
and git history holds the earlier versions of this file with the design notes
for each release.

## v0.12.0 — Reading and sharing

Candidates from a review of Markdific (markdific.com, 2026-10-11), a general
Markdown viewer and editor. Picked for academic use and for reaching people
who have not opened Hermes yet. Not yet planned in detail.

- [ ] **Quick Look preview for `.md` files.** Finder's space-bar preview shows
      the rendered document, so a reader sees Hermes output without opening
      the app. Builds on the `.md` association from v0.11.4. Needs a Quick
      Look preview extension inside the bundle; the renderer is JavaScript,
      so the extension has to host a web view or reuse the bundled
      `frontend/dist`. Check what this does to signing and notarization in
      `wails3 task release` before starting.
- [ ] **Rendering additions.** markdown-it plugins for footnotes (the most
      important for academic writing), task lists and GitHub-style alerts
      (`> [!NOTE]`). Each needs preview styles in `style.css` under the
      colour contract, PDF export checked, and spell-check scoping checked.
      Footnotes must sit correctly with citations and the bibliography at the
      end of the document.
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
      exists — `README.md`, `docs/hermes-authoring.md`, `CHANGELOG.md` — so
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
- [ ] Windows and Linux stay in the backlog.

## v1.1.0 — Advanced features (SaaS back end)

Paid features served by a hosted back end rather than the desktop binary,
decided 2026-08-28. Pandoc export moves here from v0.10.0: the dependency
question it turns on below — shell out to a user-installed Pandoc, or bundle
one — dissolves when the conversion runs on a server Hermes controls, and
`.docx`/LaTeX output is the first thing worth charging for.

- [ ] Export to DOCX and LaTeX through Pandoc. Hermes already builds toward
      Pandoc without collecting the payoff: `![caption](img)` was chosen
      because it is exactly Pandoc's figure convention, citations are `[@key]`,
      and the figures design argues captions live in each format's native home
      so a Pandoc conversion keeps them. Meanwhile the only output is PDF
      through the print panel, and co-authors and journals want `.docx`. The
      decision that used to come first — the dependency: shell out to a
      Pandoc the user installed (simple, but fails on a fresh machine and
      needs a not-found path that explains itself), or bundle one (a much
      larger binary, though v1.0 is already facing signing and notarization,
      so the packaging conversation is open anyway). Bibliography handling needs
      thought too — Pandoc can resolve citations itself from the same `.bib`,
      which may mean handing it the raw markdown rather than anything Hermes
      has already rendered.

## Direction — AI help for academic writing (under consideration)

Proposed 2026-10-11, not committed to a release. The idea: Hermes grows into
an AI-assisted tool for academic research and writing, with LaTeX and
Vega-Lite charts generated from prompts, then edited in Hermes's own
builders. Recorded here with the review of it, so the reasoning is not lost.

**What fits what Hermes already has**
- The chart builder already reads a Vega-Lite spec into a form and writes it
  back (`readSpec`/`buildSpec`). A prompt that produces a spec the builder
  can open is a short step from there.
- LaTeX maths from a prompt fits, and the live preview shows a wrong result
  straight away.
- Citations are the strongest asset. AI writing tools make up references;
  Hermes can limit suggestions to the user's own `.bib` file and Zotero
  library, so every inserted key exists.
- Documents stay plain markdown, so AI output is readable, can be compared
  line by line, and is never locked in.

**Concerns**
- Settings screens generated by a model on the fly: not recommended. They
  behave differently each time and are hard to test and document. Use fixed,
  tested builders that edit what the AI produced; if more controls are
  needed, derive them from the Vega-Lite schema, not from a model.
- Crowded market: Overleaf (AI features for LaTeX), general chat and coding
  assistants, Elicit, SciSpace and NotebookLM (asking questions of papers),
  Obsidian with plugins (second brain). Hermes's distinct position is a
  focused tool for writing papers, with citations and figures checked
  against the user's real sources. A general AI research tool gives that up.
- Academic integrity: universities and journals have AI rules, and many
  require disclosure. "AI handles equations, charts, formatting and citation
  lookup in your own library" is defensible; "AI writes the paper" is not.
- Privacy and cost: unpublished research is sensitive. Options are the
  user's own API key, a hosted service (fits the v1.1.0 back end), local
  models, or a mix. Each changes pricing, support and the privacy promise.
  Today Hermes makes almost no network requests; cloud AI ends that claim.
- Security: an opened document can carry hidden instructions to the model.
  The missing Content-Security-Policy (backlog) becomes a prerequisite.
- Searching your own documents with AI (RAG) and a "second brain" are a
  separate, large product, and cut against the single-file decision of
  2026-08-06. The useful slice for Hermes is searching the PDFs already in
  the user's Zotero library to back a claim with a source.
- Focus: v1.0.0 is unfinished. Starting this first risks leaving both the
  editor and the AI features half done.

**Suggested order, each step usable on its own**
1. Ship v1.0.0 as the editor it is now.
2. Chart from a prompt: describe the chart and data, get a Vega-Lite spec,
   open it in the existing builder. The cheapest test of demand.
3. LaTeX from a prompt at the cursor, shown before it is inserted.
4. Citation help limited to the user's library: suggest references for a
   paragraph, insert keys only from the `.bib` file.
5. Search over the PDFs in the user's Zotero library, if 2–4 are used.
6. Second brain: a separate product, if ever.

**Decisions needed before any AI work starts**
- Who pays for model calls: the user's own key, a Hermes subscription, or
  local models only.
- Where Hermes stands on AI-written prose compared with AI help on
  structure, equations and figures.
- Whether this follows v1.0.0 or replaces part of it.

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
