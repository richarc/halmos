# Find a citation style from the CSL repository — design

Written from the v0.16.0 roadmap item; the author asked for no questions,
so every decision below that the roadmap does not state is marked
*My call*. The portal side is done and deployed (2026-10-28); its contract
is `hermesportal/docs/api/styles.md` (not in this repository) and is
summarised under "The portal's routes".

## Why

Five styles are bundled. Any other journal's style means finding its
`.csl` file on the web, downloading it and choosing it with Other Style
File…. The CSL repository has over 10,000 styles, and most journal styles
in it are *dependent*: a name and a pointer to the style that does the
formatting. Checked 2026-10-29: a dependent style chosen through Other
Style File… today loads without an error and formats nothing (citeproc's
bibliography comes back empty). So the common case is broken as well as
slow.

## Goals

- Format → Citation Style → **Find a Style…** opens a searchable list of
  every style in the repository. It replaces Other Style File… in the menu.
- Search by journal name or abbreviation; filter by field and by format
  (author-date, numeric, note).
- The selected style shows a sample citation and reference.
- **Use Style** installs the style (and its parent, for a dependent one)
  and writes `csl: <id>` into the frontmatter.
- **Choose a file…** in the same window does what Other Style File… does
  today, for styles not in the repository.
- A document naming an installed or repository style by ID formats with
  it: in the preview, on hover, and in Word and LaTeX export. A dependent
  style formats with its parent.
- A co-author's Halmos that opens a document with `csl: <id>` it has not
  installed fetches and installs that style by itself.
- Installed styles record when they were installed, and Halmos offers
  updates when the repository's copy has changed.
- Offline, the bundled and installed styles keep working.

## Non-goals

- The third-party licence notice for the styles (CC BY-SA 3.0): that is the
  v1.0.0 licence-notices item. This item carries only the attribution the
  contract asks for in the window that offers the styles.
- Removing an installed style from the library. *My call:* not needed for
  this item; a style that is never chosen costs a few KB.
- Locales other than en-US. A style's `default-locale` (`en-GB` for many
  journals) is ignored, as it is today for every style.
- Editing a style, or watching a chosen style file for changes (unchanged
  from today).
- An account: the style routes need none.

## Anti-goals

- Opening a document makes a network request it does not need. Only a
  `csl:` value that is neither bundled nor installed nor a path triggers a
  fetch.
- A document that formatted yesterday formats differently today without
  the author asking: updates are offered, never applied by themselves.
- Text from a style file shown as markup. The index and the files are
  written by anyone upstream; titles are shown as text, and the sample is
  citeproc's output, which escapes text a style supplies (checked
  2026-10-29: a `<text value="<img …>">` comes out as `&#60;img …&#62;`).
- A style that fails to download or verify leaves a half-written library.
- The window freezes while the 3.6 MB index downloads or is searched.

## The portal's routes

Base: the portal origin (`https://www.halmoseditor.com`, or
`HALMOS_PORTAL_URL` in a development build, as `portalOrigin()` gives it),
path `/styles`. No account, no cookies, no CORS, so every call is made from
Go.

- `GET /styles/index.json`: about 3.6 MB of JSON, ~900 KB gzipped. `ETag`;
  revalidate with `If-None-Match` when the copy is an hour old or more
  (`304` has no body). Fields: `version` (1), `commit`, `built_at`,
  `license`, `source`, `styles` (sorted by `id`), `renamed` (old ID → new
  ID). Each style: `id`, `title`, `title_short`, `parent` (null for an
  independent style; a parent is never itself dependent), `format`
  (`author-date`, `numeric`, `note`, `author`, `label` or null), `fields`,
  `issn`, `eissn`, `updated`, `sha256` (of the file as served). Unknown keys
  are ignored.
- `GET /styles/<id>.csl`: the file, `ETag: "<sha256>"`. A renamed ID is a
  `301` to the new ID's URL; follow it (same origin only). Unknown ID is
  `404 not_found`.
- Errors: `{error, error_description}`; `429 rate_limited` and
  `503 busy`/`unavailable` carry `Retry-After`.

## How it works

### The library (Go)

- *My call:* the library lives in the app's existing data folder,
  `~/Library/Application Support/hermes/styles/`, beside `settings.json`
  and the drafts, not the roadmap's `…/Halmos/styles/`. The data folder
  keeps the old name on purpose (CLAUDE.md), and one folder is easier to
  find and back up.
- The folder holds `<id>.csl` per installed style, `library.json`
  (per style: `id`, `title`, `parent`, `sha256`, `installedAt`, and
  `asParent`, true when it was installed only as another style's parent),
  and the cached index with its `ETag` and fetch time.
- A style is installed by fetching its file, checking its SHA-256 against
  the index, then, for a dependent style, doing the same for its parent;
  files are written atomically (the existing `atomicwrite.go`), and
  `library.json` is written last, so a failure part way leaves no entry
  pointing at a missing file.
- *My call:* the downloaded file must parse as XML with a `style` root
  element; anything else is refused.
- Size caps (*my call*): the index at 32 MB, a style file at 2 MB.

### Resolving `csl:`

A `csl:` value is, in order:

1. a bundled ID (`apa`, …): as today;
2. a path ending `.csl`: as today (`isStyleFile`), now also following a
   dependent file's `independent-parent` link if that parent is installed
   or in the repository; *my call:* a dependent file whose parent cannot
   be found falls back to APA with a toast naming it;
3. an installed ID, or an installed style's old ID through `renamed`;
4. an ID in the cached or freshly fetched index (directly or through
   `renamed`): installed there and then, with a toast "Installed citation
   style <title>";
5. otherwise: APA, with the toast it shows today for an unknown style,
   extended to say Halmos could not reach the style list when that is why.

Go returns the XML of the style that does the formatting (the parent's for
a dependent style) and the chosen style's title. The preview, the hover,
and Word and LaTeX export all use that XML; export sends the parent's CSL,
as the roadmap says.

### Updates

- When the index is fetched or revalidated, each installed style's
  `sha256` is compared with the index entry for its ID (or its renamed
  ID). A difference is an update.
- *My call:* updates are offered in the Find a Style window only: a line
  at the top, "Updates for N installed styles", with **Update All**, and
  an installed style with an update shows **Update** in place of Use
  Style. No toast at launch. An update rewrites the file under its
  installed ID, so documents naming the old ID keep working.
- A style that is in neither `styles` nor `renamed` was removed upstream:
  kept, never offered an update.

### The menu

Format → Citation Style: the five bundled styles, a separator, then the
installed styles the author chose (not those installed only as a parent),
by title, then a separator and **Find a Style…**. The current style is
ticked, as now. Other Style File… leaves the menu; *my call:* it is not
kept as a second item, since the window's Choose a file… does the same.

### The Find a Style window

- A modal dialog in the editor's own style (`Dialog.svelte`), like New
  Document.
- A search field, focused on open; a **Field** menu (All fields, then each
  field in the index, sorted) and a **Format** menu (All formats,
  Author-date, Numeric, Note, and the two rarer ones, Author and Label).
- The results: each row shows the title and, when there is one, the
  abbreviation, plus the format; installed styles are marked. *My call:*
  results are ranked: the ID or abbreviation equal to the query, then a
  title starting with it, then a word in the title starting with it, then
  anywhere in the title, ID or abbreviation; within a rank, by title. The
  list shows the first 100, with "Showing 100 of N — type more to narrow
  it". An empty query lists installed styles first, then all styles by
  title.
- The search runs in Go over the cached index (*my call*), so the 3.6 MB
  index is never sent to the webview; the frontend asks for a page of
  results per keystroke.
- The detail for the selected style: title, abbreviation, format, fields,
  "Uses the formatting of <parent title>" for a dependent style, and a
  sample citation and reference, formatted with a fixed sample article
  (one entry, built in). *My call:* selecting a style fetches its file
  (and parent) to show the sample; it is kept in memory and installed
  only on Use Style. The sample waits 300 ms after the selection settles
  before fetching.
- The buttons: **Use Style** (or **Update**), **Choose a file…**,
  **Cancel**. Enter uses the selected style; Escape cancels.
- At the foot: "Styles from the CSL project (citationstyles.org), shared
  under CC BY-SA 3.0", with a link to https://citationstyles.org/ that
  opens in the browser. The contract asks for this wherever the styles are
  offered.
- No index and no network: the window says "Halmos can't reach the style
  list. Installed styles and Choose a file… still work." and lists the
  installed styles. `429`/`503`: "The style list is busy; try again in a
  minute." Errors installing say which style failed and leave the document
  as it was.
- Use Style works on an unsaved document, since an ID does not depend on
  where the document is. Choose a file… still needs a saved document, as
  today.

### Choosing writes the frontmatter

As today: `csl: <id>` through `frontmatterKeyChange` and the editor, one
undo step, and nothing when the value is already there.

## Constraints

- All HTTP from Go; the webview never calls the portal.
- No new frontend dependency. Go's standard library for HTTP, XML and
  hashing.
- The new Go service's API is reached through regenerated bindings
  (`wails3 task common:generate:bindings`), never hand-edited.
- Accelerators are owned by `menu.go`; Find a Style… gets none.
- Colours from the palette in `style.css`.
- `hermes` is public: no portal internals beyond the contract above.

## Done when

- Go tests: index fetch, cache and `304` revalidation against an
  `httptest` server; install of an independent and a dependent style;
  SHA-256 mismatch refused with nothing written; a non-XML body refused;
  renamed ID followed; resolution order 1–5; update detection; search
  ranking and filters; offline with and without a cached index.
- Frontend tests: the window lists, filters and selects; Use Style writes
  `csl:`; Choose a file… behaves as Other Style File… did; the sample
  shows for the selected style; the offline message; the menu event opens
  the window.
- A document with `csl: nature-communications` renders Nature's numbering
  in the preview and sends Nature's CSL in Word export.
- Checked by eye in the app: find "Nature Communications", see its sample,
  use it, see the preview, reopen the document with the network off.
- Docs: `docs/authoring.md` "Choosing a style" describes Find a Style….
  `CHANGELOG.md` Unreleased → Added, and Fixed for dependent style files.
  `ROADMAP.md` item ticked, its product roadmap row updated,
  `../bin/check-roadmaps` run.

## Left to the builder

- The service and file names, and the shape of the bindings.
- The sample article's details.
- How the window lays out the list and the detail, within the palette.
