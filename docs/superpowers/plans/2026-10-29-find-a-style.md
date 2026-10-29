# Find a Style Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Format → Citation Style → Find a Style… searches the CSL repository through the portal's style index, installs a style (with its parent) into a local library, and any `csl: <id>` resolves through that library.

**Architecture:** Go does all HTTP, the on-disk library and the search (`styleclient.go`, `stylelibrary.go`, `styleservice.go`; a new bound `StyleService`). The frontend asks Go to resolve every non-bundled `csl:` value to the XML that does the formatting, and shows a `StyleFinder.svelte` dialog that pages through Go's search results.

**Tech Stack:** Go 1.25 standard library (`net/http`, `encoding/xml`, `crypto/sha256`), Wails v3 beta.30 bindings, Svelte 5, citeproc-js (already bundled), vitest.

**Spec:** `docs/superpowers/specs/2026-10-29-find-a-style-design.md`

## Global Constraints

- All HTTP from Go; the webview never calls the portal. Origin is `portalOrigin()`, path prefix `/styles`.
- Index cap 32 MB, style file cap 2 MB. Index timeout 30 s, style file 15 s.
- Index revalidated with `If-None-Match` only when the cached copy is ≥ 1 hour old.
- Redirects followed only to the same origin (renamed IDs are a `301`), at most 3.
- A style file is accepted only if its SHA-256 equals the index's `sha256` and it parses as XML with root element `style`.
- Library: `<data>/hermes/styles/` (the directory of `recents.json` + `styles`): `<id>.csl`, `library.json`, `index.json`, `index-meta.json`. Files via `writeFileAtomic`; `library.json` written last.
- Updates are offered, never applied unprompted.
- Text from the index is shown as text; the sample is citeproc's (escaping) output.
- Attribution in the window: "Styles from the CSL project (citationstyles.org), shared under CC BY-SA 3.0", link `https://citationstyles.org/`.
- Bindings regenerated with `wails3 task common:generate:bindings`, never hand-edited.
- Accelerators are owned by `menu.go`; Find a Style… has none.
- Colours from `style.css`'s palette only.
- Tests: `go test ./. && go build -o /dev/null .`; `cd frontend && npx vitest run < /dev/null`; `npx svelte-check`.

## Review Focus

- A dependent style whose parent fails to download: nothing is installed, `library.json` is unchanged (Task 3 test `TestInstallDependentParentFailsWritesNothing`).
- A document opened offline naming an installed style formats with it, with no network request (Task 3 test `TestResolveInstalledMakesNoRequest`).
- A renamed ID in a document (`csl: aaa`) resolves to the new style (Task 3 test `TestResolveRenamed`).
- The finder opened while the index is still downloading does not freeze typing: `LoadIndex` is awaited before the first search, searches are local (Task 6 test "shows loading, then results").
- A menu action (⌘B) fired while the finder is open does not edit the document behind it (Task 7 test "ignores format menu while the finder is open").

---

### Task 1: The style client

**Files:**
- Create: `styleclient.go`, `styleclient_test.go`

**Interfaces:**
- Produces:
  - `type styleEntry struct { ID string \`json:"id"\`; Title string \`json:"title"\`; TitleShort *string \`json:"title_short"\`; Parent *string \`json:"parent"\`; Format *string \`json:"format"\`; Fields []string \`json:"fields"\`; Updated *string \`json:"updated"\`; SHA256 string \`json:"sha256"\` }`
  - `type styleIndexDoc struct { Version int; Commit string; BuiltAt string \`json:"built_at"\`; Styles []styleEntry; Renamed map[string]string }`
  - `type styleClient struct { origin string; http *http.Client; version string }`
  - `func newStyleClient(origin, version string, base *http.Client) *styleClient` — `base` nil means a fresh `http.Client`; the client's `CheckRedirect` is set to `sameOriginRedirect(origin)`.
  - `func (c *styleClient) fetchIndex(ctx context.Context, etag string) (data []byte, newETag string, notModified bool, perr *PortalError)`
  - `func (c *styleClient) fetchStyle(ctx context.Context, id string) ([]byte, *PortalError)`
  - `func parseStyleIndex(data []byte) (*styleIndexDoc, error)` — rejects `version != 1` and any entry with an empty `id` or `sha256`.
  - `func checkStyleFile(data []byte, sha string) error` — SHA-256 lowercase hex compare, then `xml.Decoder` first `StartElement` local name must be `style`.
- Reuses `PortalError`, `decodePortalError` from `portalclient.go`. Error codes: `network`, `not_found`, `rate_limited`, `busy`, `unavailable`, `server_error`, `misconfigured`, plus `invalid` from `checkStyleFile` callers.

- [ ] **Step 1: Write failing tests** against `httptest.NewTLSServer` (pass `srv.Client()` as `base`):
  - `TestFetchIndexSendsETagAndReads304`: first call `etag=""` gets 200 + `ETag: "abc"` → returns data, `"\"abc\""`; second call with that etag, server asserts `If-None-Match` equals it, answers 304 → `notModified == true`, data nil.
  - `TestFetchIndexCapsSize`: server writes 32 MB + 1 bytes → `perr.Code == "server_error"`.
  - `TestFetchStyleFollowsSameOriginRedirect`: `/styles/aaa.csl` → 301 `/styles/new.csl` → 200 body; returns body.
  - `TestFetchStyleRefusesOtherOrigin`: 301 to `https://example.invalid/x.csl` → `perr.Code == "misconfigured"`.
  - `TestFetchStyleErrors`: 404 `{"error":"not_found"}` → `not_found`; 429 with `Retry-After: 60` → `rate_limited`, `RetryAfterSeconds == 60`.
  - `TestFetchStyleRejectsBadID`: `fetchStyle(ctx, "../x")` → `not_found`, no request made (IDs must match `^[a-z0-9-]+$`).
  - `TestParseStyleIndex`: the contract's two-entry example parses; `version: 2` errors; an entry with `"id": ""` errors; unknown keys are ignored.
  - `TestCheckStyleFile`: right sha + `<style>` root ok; wrong sha errors; right sha of `<html>` errors; right sha of `not xml` errors.
- [ ] **Step 2: Run** `go test -run 'Style' ./.` — Expected: FAIL (undefined: newStyleClient …).
- [ ] **Step 3: Implement** in `styleclient.go`. Requests carry `User-Agent: HalmosEditor/<version>` as `portalclient.go` does; do not set `Accept-Encoding` (Go's transport adds gzip and undoes it).
- [ ] **Step 4: Run** `go test ./. && go build -o /dev/null .` — Expected: PASS.
- [ ] **Step 5: Commit** `styles: client for the portal's style index and files`.

### Task 2: The library and search

**Files:**
- Create: `stylelibrary.go`, `stylelibrary_test.go`

**Interfaces:**
- Consumes: `styleEntry`, `styleIndexDoc`, `parseStyleIndex` (Task 1).
- Produces:
  - `type installedStyle struct { ID string \`json:"id"\`; Title string \`json:"title"\`; Parent string \`json:"parent,omitempty"\`; SHA256 string \`json:"sha256"\`; InstalledAt time.Time \`json:"installedAt"\`; AsParent bool \`json:"asParent,omitempty"\` }`
  - `type styleLibrary struct { dir string }` with
    - `func (l *styleLibrary) installed() (map[string]installedStyle, error)` — missing file is an empty map.
    - `func (l *styleLibrary) readStyle(id string) ([]byte, error)`
    - `func (l *styleLibrary) writeStyles(files map[string][]byte, entries []installedStyle) error` — writes every file, then `library.json` with the entries merged in (an existing non-`AsParent` entry stays non-`AsParent`).
    - `func (l *styleLibrary) cachedIndex() (data []byte, etag string, fetchedAt time.Time, err error)` and `func (l *styleLibrary) storeIndex(data []byte, etag string, fetchedAt time.Time) error`; `func (l *styleLibrary) touchIndex(fetchedAt time.Time) error` (a 304 updates only the time).
  - `type StyleSummary struct { ID, Title, TitleShort, Format string; Fields []string; Parent, ParentTitle string; Installed, Update bool }` (JSON tags camelCase: `id`, `title`, `titleShort`, `format`, `fields`, `parent`, `parentTitle`, `installed`, `update`).
  - `func searchStyles(idx *styleIndexDoc, lib map[string]installedStyle, query, field, format string, limit int) (results []StyleSummary, total int)`
  - `func styleFields(idx *styleIndexDoc) []string` — every field, sorted, unique.
  - `func hasUpdate(idx *styleIndexDoc, st installedStyle) bool` — the index entry for `st.ID` or `idx.Renamed[st.ID]` exists and its sha differs.
- Ranking (spec): rank 0 `id` or `title_short` equals the query (case-insensitive); 1 title starts with it; 2 a title word starts with it; 3 substring of title, id or title_short; no match dropped. Within a rank, by title (case-insensitive), then id. Empty query: installed (non-`AsParent`) first, then all others by title. `field`/`format` empty means all.

- [ ] **Step 1: Failing tests:**
  - `TestLibraryWriteThenRead`: write two styles, read both back; `installed()` has both with the given `InstalledAt`.
  - `TestLibraryKeepsChosenOverParent`: install `nature` directly, then install `nature-communications` with `nature` as `AsParent` → `nature.AsParent == false`.
  - `TestLibraryIndexCache`: store, read back data/etag/time; `touchIndex` changes only the time.
  - `TestSearchRanking`: index with `nature` (title "Nature"), `nature-communications` ("Nature Communications"), `the-lancet` ("The Lancet", short "Lancet"), `bmj` ("BMJ", short "BMJ"), `natural-hazards` ("Natural Hazards"): query `nature` → `nature, nature-communications, natural-hazards`… (`natural-hazards` doesn't contain "nature" → dropped; assert order `["nature","nature-communications"]`); query `lancet` → `the-lancet` (rank 0 via short); query `bmj` → `bmj` first.
  - `TestSearchFiltersAndLimit`: `field="medicine"` keeps only entries with it; `format="numeric"` likewise; limit 2 of 4 matches → `len==2, total==4`.
  - `TestSearchEmptyQueryInstalledFirst`.
  - `TestSearchMarksParentAndUpdate`: dependent entry gets `ParentTitle`; installed with different sha → `Update == true`.
  - `TestHasUpdateFollowsRename` and `TestHasUpdateRemovedUpstream` (not in styles or renamed → false).
- [ ] **Step 2: Run** `go test -run 'Library|Search|HasUpdate' ./.` — Expected: FAIL (undefined).
- [ ] **Step 3: Implement** `stylelibrary.go`. Create the directory (0700) on first write.
- [ ] **Step 4: Run** `go test ./. && go build -o /dev/null .` — Expected: PASS.
- [ ] **Step 5: Commit** `styles: the local style library and search`.

### Task 3: StyleService

**Files:**
- Create: `styleservice.go`, `styleservice_test.go`
- Modify: `main.go` (construct and register the service), `documentservice.go` (remove `ReadCitationStyle`), `documentservice_test.go` (its test moves to Task 3's resolve tests)
- Regenerate: `frontend/bindings/`

**Interfaces:**
- Consumes: Tasks 1–2.
- Produces (bound methods; JSON camelCase):
  - `type StyleIndexStatus struct { Ready bool; Error string; Fields []string; Updates int }` — `Error` is `""`, `"offline"` (no index at all, network failed) or `"busy"` (429/503 and no cached index). With a cached index and a failed fetch, `Ready` is true and `Error` empty.
  - `func (s *StyleService) LoadIndex() StyleIndexStatus` — loads the cached index into memory; fetches when there is none or it is ≥ 1 h old; on 304 calls `touchIndex`.
  - `func (s *StyleService) Search(query, field, format string) StyleSearchResult` with `type StyleSearchResult struct { Styles []StyleSummary; Total int }`, limit 100; empty result when no index is loaded.
  - `func (s *StyleService) Installed() []StyleSummary` — chosen (non-`AsParent`) installed styles by title; works with no index.
  - `type StyleText struct { XML, Title, Error string }`
  - `func (s *StyleService) PreviewStyle(id string) StyleText` — the formatting XML (parent's for a dependent) from the library, else fetched and kept in an in-memory map; nothing written to disk.
  - `type StyleInstallResult struct { ID, Title, Error string }`
  - `func (s *StyleService) InstallStyle(id string) StyleInstallResult` — follows `Renamed`; fetches style and (if dependent) parent, `checkStyleFile` each against the index sha (`Error: "invalid"` on failure), then `writeStyles` once. Re-installing an installed style is how an update is applied. Calls `s.onChanged` after a write.
  - `func (s *StyleService) UpdateAll() StyleInstallResult` — reinstalls every installed style with `hasUpdate`; `ID` empty; `Error` the first failure.
  - `type ResolvedStyle struct { XML, Title string; Installed bool; Error string }` — `Installed` true when this call installed it from the repository.
  - `func (s *StyleService) ResolveStyle(csl, docPath string) ResolvedStyle` — the spec's order 2–5 (the frontend never sends bundled ids): a `.csl` path is read with `resolveAgainstDoc`; if its `<info><link rel="independent-parent" href>` names a parent, the parent id is the href's last path segment, resolved as an id (installed, else installed from the repository); `Error` codes `unreadable`, `parent_missing`, `not_found`, `offline`, `busy`, `invalid`.
  - `onChanged func()` field, set in `main.go` to rebuild the menu (Task 4).
- Construction: `func NewStyleService(dataDir string) *StyleService` (origin from `portalOrigin()`, `appVersion()`); test constructor `newStyleServiceWith(lib *styleLibrary, client *styleClient, now func() time.Time) *StyleService`. A `sync.Mutex` guards the in-memory index, the preview map and library writes.

- [ ] **Step 1: Failing tests** (httptest TLS server serving a two-style index — `nature` independent, `nature-communications` → `nature` — `renamed: {"aaa":"nature"}`, and the two files; a request counter):
  - `TestLoadIndexFetchesThenUsesCache`: first `LoadIndex` makes 1 request; second within the hour makes 0; with `now` advanced 61 min, 1 conditional request answered 304, and `index-meta.json`'s time moves.
  - `TestLoadIndexOfflineWithAndWithoutCache`: server closed, no cache → `Error: "offline"`; with a cache → `Ready: true`, `Error: ""`.
  - `TestInstallDependentInstallsParent`: `InstallStyle("nature-communications")` writes both files; `nature` is `AsParent`; `Installed()` lists only Nature Communications.
  - `TestInstallDependentParentFailsWritesNothing`: server 503s for `nature.csl` → `Error: "busy"`, no `.csl` files and no `library.json`.
  - `TestInstallRejectsShaMismatch`: served bytes differ from the index sha → `Error: "invalid"`, nothing written.
  - `TestResolveInstalledMakesNoRequest`: after install, counter reset, `ResolveStyle("nature-communications", "")` returns Nature's XML, `Title: "Nature Communications"`, `Installed: false`, 0 requests.
  - `TestResolveFetchesUnknownID`: empty library → `ResolveStyle("nature-communications","")` installs and returns `Installed: true`.
  - `TestResolveRenamed`: `ResolveStyle("aaa","")` → Nature's XML.
  - `TestResolveUnknownAndOffline`: `"no-such-style"` → `not_found`; server closed and no cache → `offline`.
  - `TestResolveFileResolvesAgainstDocument` (moved from `TestReadCitationStyleResolvesAgainstDocument`): an independent `my.csl` beside the document returns its own text; missing → `unreadable`.
  - `TestResolveDependentFile`: a file whose `independent-parent` is `http://www.zotero.org/styles/nature` returns Nature's XML; with the server closed and nothing installed → `parent_missing`.
  - `TestPreviewStyleWritesNothing`: `PreviewStyle("nature-communications")` returns Nature's XML; the library dir has no files.
  - `TestUpdateAll`: install, then serve a changed `nature.csl` with a matching new index sha and advance the clock → `LoadIndex().Updates == 1`; `UpdateAll()` rewrites it; `Updates` is then 0.
- [ ] **Step 2: Run** `go test -run 'LoadIndex|Install|Resolve|PreviewStyle|UpdateAll' ./.` — Expected: FAIL.
- [ ] **Step 3: Implement** `styleservice.go`; register `application.NewService(styles)` in `main.go` with `NewStyleService(filepath.Dir(recentsPath))`; delete `ReadCitationStyle` and its test.
- [ ] **Step 4: Run** `wails3 task common:generate:bindings`, then `go test ./. && go build -o /dev/null .` — Expected: PASS; `frontend/bindings/hermes/` has `styleservice.ts`.
- [ ] **Step 5: Commit** `styles: StyleService installs and resolves repository styles`.

### Task 4: The Citation Style menu

**Files:**
- Modify: `menu.go:325-337`, `main.go` (pass the service; `styles.onChanged` rebuilds the menu), `menu_test.go`

**Interfaces:**
- Consumes: `(*StyleService).Installed()` (Task 3).
- Produces: `installMenu(app, win, docs, reg, styles *StyleService)`; menu emits `menu:citation-style` with an installed style's id, or `"find"` for **Find a Style…**. `"other"` is no longer emitted.
- Extract `func citationStyleItems(installed []StyleSummary) (bundled, chosen []struct{ label, id string })` so the order is testable without AppKit.

- [ ] **Step 1: Failing tests:** `TestCitationStyleItemsListsInstalledByTitle` (installed `[{id:"b",title:"Zeta"},{id:"a",title:"Alpha"}]` → chosen labels `["Alpha","Zeta"]`, bundled unchanged); `TestFindAStyleEmitsFind` — following the existing menu tests' pattern for an emitted payload; if the menu tests have no such harness, assert on a `const findStylePayload = "find"` used by the item.
- [ ] **Step 2: Run** `go test -run 'CitationStyle|FindAStyle' ./.` — Expected: FAIL.
- [ ] **Step 3: Implement.** Separator then chosen installed styles (checkboxes, ticked when `currentStyle == id`, through `citationStyleClicked`), separator, `Find a Style…` (no accelerator) emitting `"find"`; separators collapse when no style is installed. Every item through `cmds.item` so the palette lists them.
- [ ] **Step 4: Run** `go test ./. && go build -o /dev/null .` — Expected: PASS.
- [ ] **Step 5: Commit** `menu: installed styles and Find a Style… in Citation Style`.

### Task 5: Formatting with resolved styles

**Files:**
- Modify: `frontend/src/App.svelte` (`reloadBibliography` ~370-440, `buildConvertBody` ~943), `frontend/src/lib/citations.ts` (export `isBundledStyle(id: string): boolean`), `frontend/src/App.test.ts` (mock `StyleService`)

**Interfaces:**
- Consumes: `StyleService.ResolveStyle(csl, docPath)` (Task 3 binding).
- Rule: a `csl:` value that is not bundled (`!isBundledStyle`) goes to `ResolveStyle(csl, path ?? '')`. `XML` non-empty → `createCitationFormatter(entries, csl, XML)`; `Installed` → toast `Installed citation style ${Title}`. Otherwise APA with a toast per `Error`:
  - `not_found` → `Unknown citation style "${csl}" — using APA` (today's text)
  - `offline` / `busy` → `Citation style "${csl}" isn't installed and Halmos can't reach the style list — using APA`
  - `unreadable` / `invalid` → `Citation style could not be loaded: ${csl} — using APA` (today's text)
  - `parent_missing` → `Citation style ${csl} depends on a style Halmos can't find — using APA`
- `loadedBib` keeps comparing the XML, so an unchanged style keeps the formatter.
- Export uses the same `ResolveStyle` XML for a non-bundled value, `loadStyleXml` for a bundled one, APA's XML on failure.

- [ ] **Step 1: Failing tests** in `App.test.ts` (`describe('repository styles')`): `csl: nature-communications` with `ResolveStyle` resolving to a fixture numeric XML renders the citation in that style; `Installed: true` shows the toast `Installed citation style Nature Communications`; `Error: 'offline'` shows the offline toast and renders APA; Word export with `csl: nature-communications` sends the resolved XML as `csl`; a `.csl` path still goes through `ResolveStyle` with the document path.
- [ ] **Step 2: Run** `cd frontend && npx vitest run src/App.test.ts < /dev/null` — Expected: the new tests FAIL.
- [ ] **Step 3: Implement**; remove the `ReadCitationStyle` mock and calls.
- [ ] **Step 4: Run** full vitest and `npx svelte-check` — Expected: PASS, 0 errors.
- [ ] **Step 5: Commit** `citations: repository and dependent styles format in preview and export`.

### Task 6: The Find a Style window

**Files:**
- Create: `frontend/src/StyleFinder.svelte`, `frontend/src/StyleFinder.test.ts`, `frontend/src/lib/styleSample.ts`, `frontend/src/lib/styleSample.test.ts`

**Interfaces:**
- Consumes: `StyleService.LoadIndex/Search/PreviewStyle/InstallStyle/UpdateAll/Installed` (Task 3), `createCitationFormatter` (`citations.ts`), `Dialog.svelte`.
- Produces:
  - `formatSample(xml: string): Promise<{ citation: string; reference: string }>` — one built-in `article-journal` entry (key `sample`), formatted as one cluster plus the bibliography; throws when citeproc produces no reference.
  - `StyleFinder.svelte` props: `{ open: boolean; onclose: () => void; onuse: (id: string) => void; onchoosefile: () => void }`. `onuse` is called after `InstallStyle` succeeds.
- Behaviour (spec "The Find a Style window"): `LoadIndex` on open, "Loading styles…" until it resolves; search on each input change; Field and Format `<select>`s (Format values `author-date`, `numeric`, `note`, `author`, `label`, labelled "Author-date", "Numeric", "Note", "Author", "Label"); results as a `role="listbox"` with ↑/↓ moving the selection and Enter = Use Style; "Showing 100 of N — type more to narrow it" when `Total > Styles.length`; detail with title, abbreviation, format, fields, "Uses the formatting of <ParentTitle>"; sample 300 ms after selection settles via `PreviewStyle` + `formatSample`, a stale reply ignored; "Updates for N installed styles" + Update All when `Updates > 0`; primary button "Update" for a selected style with `update`; offline message "Halmos can't reach the style list. Installed styles and Choose a file… still work." listing `Installed()`; busy message "The style list is busy; try again in a minute."; install error shown inline as "Couldn't install <title>." The attribution line at the foot opens `https://citationstyles.org/` with `Browser.OpenURL`.

- [ ] **Step 1: Failing tests:**
  - `styleSample.test.ts`: with the bundled IEEE XML (`loadStyleXml('ieee')`) the citation is `[1]` and the reference contains the sample title.
  - `StyleFinder.test.ts` (mock `../bindings/hermes` and `@wailsio/runtime`; fake timers for the 300 ms): "shows loading, then results"; "searches as you type" (`Search` called with `('lancet','','')`); "filters by field and format"; "shows the parent and sample for a dependent style"; "Use Style installs then calls onuse with the id"; "shows the install error and does not call onuse"; "offline lists installed styles"; "Update All calls UpdateAll"; "Choose a file… calls onchoosefile"; "shows the count when results are cut"; "attribution link opens citationstyles.org".
- [ ] **Step 2: Run** `npx vitest run src/StyleFinder.test.ts src/lib/styleSample.test.ts < /dev/null` — Expected: FAIL (missing modules).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** full vitest and `npx svelte-check` — Expected: PASS.
- [ ] **Step 5: Commit** `styles: the Find a Style window`.

### Task 7: Wiring the window into the app

**Files:**
- Modify: `frontend/src/App.svelte`, `frontend/src/App.test.ts`

**Interfaces:**
- Consumes: `StyleFinder` (Task 6), `menu:citation-style` payloads `"find"` and ids (Task 4).
- `applyCitationStyle(choice)`: `"find"` opens the finder (same guards as today); an id that is bundled or listed by the last `StyleService.Installed()` writes `csl:` directly; `onuse(id)` closes the finder and writes `csl: <id>` (works untitled); `onchoosefile` closes the finder and runs today's `"other"` flow (save-first toast, panel, relative path). A `styleFinderOpen` state joins `newOpen` in every guard that lists it.

- [ ] **Step 1: Failing tests:** "Find a Style… opens the finder"; "Use Style writes csl: nature-communications into an untitled document"; "Choose a file… writes a relative path" (the old `'other'` test, now driven through the finder); "an installed style from the menu writes its id"; "ignores format menu while the finder is open" (`menu:format` `bold` leaves the text unchanged). Replace the three `'other'` tests.
- [ ] **Step 2: Run** `npx vitest run src/App.test.ts < /dev/null` — Expected: new tests FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** full vitest, `npx svelte-check`, `go test ./.` — Expected: PASS.
- [ ] **Step 5: Commit** `styles: Find a Style… opens from the Citation Style menu`.

### Task 8: Docs and roadmap

**Files:**
- Modify: `docs/authoring.md` ("Choosing a style"), `CHANGELOG.md` (Unreleased → Added: Find a Style…; Fixed: a dependent style file formatted nothing), `ROADMAP.md` (tick the item, guarded single-block replacement, compare `grep -c '^- \['` and `grep '^## '`), `CLAUDE.md` (one paragraph on `styleservice.go` and the library), `../ROADMAP.md` (row: "done in the editor 2026-10-29 (not yet released)"; committed in the product repo), then `../bin/check-roadmaps`.

- [ ] **Step 1:** Edit the docs and changelog.
- [ ] **Step 2:** Tick the roadmap item; verify counts. Expected: one fewer `- [ ]`, headings unchanged.
- [ ] **Step 3:** Commit `styles: docs, changelog and roadmap` in hermes; the product row is updated after merge.
