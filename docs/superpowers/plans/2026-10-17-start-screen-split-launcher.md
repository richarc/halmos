# Start Screen: Split Launcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the welcome pane with design A ("Split launcher"): a left side panel with the app name, version, New and Open buttons and help links, and a right-hand recent files list showing each file's name with its folder underneath.

**Architecture:** The pane stays the `.welcome` overlay in `App.svelte`, shown under the same `showWelcome` rule, so every guard that checks `showWelcome` is untouched. Go gains one small binding for the version and home folder. A pure TS helper splits a recent path into name and `~`-shortened folder. All colours go through the palette in `style.css`.

**Tech Stack:** Go + Wails v3 beta.30 bindings, Svelte 5, Vitest + jsdom.

**Spec:** the approved mockup, artboard "A · Split launcher" on https://claude.ai/artifact/6iTavRNfr1ew3N2D9WkHik (`project/Main.dc.html`). The user chose A on 2026-10-17 and skipped design questions; calls made without them are listed under Global Constraints as "Call:".

## Global Constraints

- Layout per mockup A: side panel 340px wide, `padding: 72px 32px 32px` (72px clears the hidden-inset title bar), right border; main area `padding: 72px 56px 32px`.
- Side panel, top to bottom: "Halmos Editor" (26px, weight 600), version line (13px, `--muted`) as `Version <x.y.z>`, then two full-width 44px buttons — New document (primary) and Open… — each with an icon and a shortcut hint on the right (⌘N, ⌘O), then at the bottom: "Guides at halmoseditor.com", "Questions and ideas", and the line "Found a bug? Help → Report an Issue… fills in the version for you."
- Main area: heading "Recent files" (15px, 600) with a "Clear" link on the right; one row per recent file: document icon, file name (14px, 500), folder below (12px, `--muted`, one line, ellipsis).
- Call: button labels stay sentence case — "New document", "Open…" — as the rest of the app and the existing tests use, not the mockup's "New Document".
- Call: the shortcut hint is CSS `::after { content: attr(data-shortcut) }`, so a button's `textContent` stays its label.
- Call: folders under the home folder show as `~/…`; the version line is hidden when Go reports no version (unbundled builds).
- Call: "Clear" calls `ClearRecents`, then behaves like first launch with no recents: the pane goes and a new templated document opens (`doNew()`), as `closeDocument` already does.
- Links open with `Browser.OpenURL`, never `<a href>` (CLAUDE.md: a real link navigates the webview away). Guides: `https://www.halmoseditor.com/guides`. Questions: `https://github.com/richarc/halmos/discussions`.
- No literal colours in `style.css` rules; any new custom property is defined in `:root`, `:root[data-theme="dark"]` and `:root[data-theme="sepia"]` (`styleContract.test.ts` fails otherwise). New property: `--welcome-panel` = `#f5f5f5` light, `#242424` dark, `#ebe0c6` sepia (between sepia's `--bg` `#f1e7d0` and `--surface` `#e8dcc0`).
- Never hand-edit `frontend/bindings/`.

## Review Focus

1. **Narrow window.** Below 760px wide the side panel stacks above the list instead of squeezing it. Task 3 CSS + click-through item 4.
2. **Ten recents with long names and deep folders.** The list scrolls inside the main area; names and folders truncate with an ellipsis, never wrap the row or push the panel. Task 3 test `truncates long folders` asserts the class; click-through item 3.
3. **A recent file directly in the home folder, or at `/`.** Folder shows `~` and `/`, never an empty line. Task 2 tests.
4. **Home folder is a prefix of another folder** (`/Users/ann` vs `/Users/anna/x.md`). Must not become `~a/x`. Task 2 test.
5. **Dark and sepia themes.** Panel, rows and hover use palette variables; contract test enforces all three blocks. Click-through item 5.

---

### Task 1: Go binding for version and home folder

**Files:**
- Modify: `documentservice.go` (new type + method, next to `RecentFiles`)
- Test: `documentservice_test.go`
- Modify (regenerated): `frontend/bindings/hermes/*`

**Interfaces:**
- Produces: `type WelcomeInfo struct { Version string \`json:"version"\`; Home string \`json:"home"\` }` and `func (s *DocumentService) WelcomeInfo() WelcomeInfo` — `Version` is `s.version()` (`""` unbundled), `Home` is `os.UserHomeDir()` or `""` on error. TS: `DocumentService.WelcomeInfo(): Promise<WelcomeInfo>` from `../bindings/hermes`.

- [ ] **Step 1: Write the failing test** `TestWelcomeInfoReportsVersionAndHome`: `s := newTestService(t); s.version = func() string { return "1.2.3" }`; assert `s.WelcomeInfo().Version == "1.2.3"` and `.Home` equals `os.UserHomeDir()`.
- [ ] **Step 2: Run** `go test ./. -run TestWelcomeInfo` — Expected: FAIL, `s.WelcomeInfo undefined`.
- [ ] **Step 3: Implement** the type and method.
- [ ] **Step 4: Run** `go test ./.` — Expected: PASS.
- [ ] **Step 5: Regenerate** `wails3 task common:generate:bindings` — Expected: `WelcomeInfo` appears in `frontend/bindings/hermes/documentservice.ts` and a `models.ts` type.
- [ ] **Step 6: Commit** `feat: WelcomeInfo binding for the start screen`.

---

### Task 2: Split a recent path into name and folder

**Files:**
- Create: `frontend/src/lib/recentPath.ts`
- Test: `frontend/src/lib/recentPath.test.ts`

**Interfaces:**
- Produces: `export function splitRecent(path: string, home: string): { name: string; folder: string }`.

- [ ] **Step 1: Write the failing tests:**

```ts
expect(splitRecent('/Users/ann/Papers/qec.md', '/Users/ann')).toEqual({ name: 'qec.md', folder: '~/Papers' })
expect(splitRecent('/Users/ann/notes.md', '/Users/ann')).toEqual({ name: 'notes.md', folder: '~' })
expect(splitRecent('/Users/anna/x.md', '/Users/ann')).toEqual({ name: 'x.md', folder: '/Users/anna' })
expect(splitRecent('/Volumes/Data/a.md', '/Users/ann')).toEqual({ name: 'a.md', folder: '/Volumes/Data' })
expect(splitRecent('/a.md', '/Users/ann')).toEqual({ name: 'a.md', folder: '/' })
expect(splitRecent('/Users/ann/Papers/qec.md', '')).toEqual({ name: 'qec.md', folder: '/Users/ann/Papers' })
expect(splitRecent('/Users/ann/Papers/qec.md', '/Users/ann/')).toEqual({ name: 'qec.md', folder: '~/Papers' })
```

- [ ] **Step 2: Run** `cd frontend && npx vitest run src/lib/recentPath.test.ts` — Expected: FAIL, module not found.
- [ ] **Step 3: Implement** with string ops on `/` (no Node `path`; this runs in the webview). Strip one trailing `/` from `home`; replace only when `folder === home` or `folder.startsWith(home + '/')`.
- [ ] **Step 4: Run** the same command — Expected: 7 PASS.
- [ ] **Step 5: Commit** `feat: splitRecent for the start screen's recent files`.

---

### Task 3: The new welcome pane

**Files:**
- Modify: `frontend/src/App.svelte` (the `{#if showWelcome}` block at ~1337, plus `welcomeInfo` state loaded with recents on mount, and a `clearRecents` handler)
- Modify: `frontend/public/style.css` (replace the `.welcome*` rules at ~603–611; add `--welcome-panel` to both palette blocks; keep `.welcome` in the print-hide list at ~818)
- Test: `frontend/src/App.test.ts` (`describe('welcome pane')` at ~185; add `WelcomeInfo` and `ClearRecents` to the `DocumentService` mock)

**Interfaces:**
- Consumes: `DocumentService.WelcomeInfo()` (Task 1), `splitRecent` (Task 2), existing `DocumentService.ClearRecents()`, `requestNew`, `requestOpen`, `requestOpenRecent`, `doNew`, `refreshRecents`.
- Produces DOM the tests rely on: `.welcome` root; `.welcome-side` (aside) holding `h1`, `.welcome-version`, `.welcome-actions` with two buttons (`data-shortcut="⌘N"` / `"⌘O"`), `.welcome-help`; `.welcome-main` holding `h2` "Recent files", a "Clear" button, and `ul.welcome-recents` of `li > button.welcome-recent` each with `.welcome-recent-name` and `.welcome-recent-folder`.

- [ ] **Step 1: Update the mock** — `WelcomeInfo: vi.fn(async () => ({ version: '0.14.0', home: '/Users/ann' }))`, `ClearRecents: vi.fn(async () => { recents.current = [] })`.
- [ ] **Step 2: Rewrite the welcome-pane tests** (replace the two link-order tests; keep the New/Open tests, which use `buttonByText(target, 'New document' | 'Open…')` and must still pass unchanged):
  - `shows the app name and version` — `h1` text `Halmos Editor`; `.welcome-version` text `Version 0.14.0`.
  - `hides the version line when there is none` — mock returns `version: ''`; `.welcome-version` is null.
  - `lists recent files by name with the folder under it` — `recents.current = ['/Users/ann/Papers/qec.md']`; `.welcome-recent-name` = `qec.md`, `.welcome-recent-folder` = `~/Papers`; clicking `.welcome-recent` calls `DocumentService.OpenPath` with the full path (via the existing `requestOpenRecent`).
  - `truncates long folders` — `.welcome-recent-folder` has the class the CSS truncates (assert element exists; truncation itself is checked by eye).
  - `opens the guides and discussions in the browser` — `buttonByText(target, 'Guides at halmoseditor.com')` → `Browser.OpenURL('https://www.halmoseditor.com/guides')`; `'Questions and ideas'` → `…/discussions`; `.welcome a[href]` is null; `.welcome-help` text contains `Help → Report an Issue`.
  - `shows the shortcut hints without changing the labels` — New button `dataset.shortcut === '⌘N'`, Open `'⌘O'`.
  - `Clear empties the list and starts a new document` — click `buttonByText(target, 'Clear')`; expect `ClearRecents` called, `.welcome` gone, editor holds the new-document template (reuse the assertion the existing first-launch test uses).
- [ ] **Step 3: Run** `cd frontend && npx vitest run src/App.test.ts` — Expected: the new tests FAIL (missing elements); everything else passes.
- [ ] **Step 4: Implement the markup and handler.** Load `welcomeInfo` with `DocumentService.WelcomeInfo()` alongside the first `refreshRecents()`; default `{ version: '', home: '' }`. Icons are inline stroke SVGs copied from the mockup, `aria-hidden="true"`. `clearRecents`: `await DocumentService.ClearRecents(); await refreshRecents(); doNew()`.
- [ ] **Step 5: Implement the CSS** per Global Constraints. `.welcome` becomes `display: flex` (still `position: absolute; inset: 0; background: var(--overlay-bg)`); `.welcome-main` `overflow: auto`; recent rows hover `var(--surface)`, radius 8px; primary button uses existing `button.primary` styling; `.welcome-actions button::after { content: attr(data-shortcut); margin-left: auto; font-size: 12px; color: var(--muted) }` (on the primary button use `currentColor` at 0.8 opacity); `@media (max-width: 760px)` stacks: `.welcome { flex-direction: column }`, side panel full width, no right border, bottom border instead. Remove the now-unused `.welcome-intro` rules. Keep `button.link-button`: the status bar, Outline, UnknownCitations and TableBuilder use it; update its comment, which names the welcome pane.
- [ ] **Step 6: Run** `cd frontend && npm test && npm run check` — Expected: all pass, including `styleContract.test.ts`.
- [ ] **Step 7: Commit** `feat: split-launcher start screen`.

---

### Task 4: Docs, package, click-through

**Files:**
- Modify: `CHANGELOG.md` (`## [Unreleased]` → `### Changed`), `ROADMAP.md` (tick "A better start screen")

- [ ] **Step 1: CHANGELOG** under `### Changed` add:

```markdown
- A new start screen. New document and Open… sit in a side panel with the
  app version and the help links; recent files list each file's name with
  its folder underneath, and Clear empties the list.
```

- [ ] **Step 2: ROADMAP** — `str.replace` the one block `- [ ] **A better start screen.**` → `- [x] **A better start screen.**` and append `*Done 2026-10-17*: option A, the split launcher.` to that item. Check `grep -c '^- \[ \]'` drops by exactly 1 and `grep '^## '` is unchanged.
- [ ] **Step 3: Full suite** `go test ./. && cd frontend && npm test && npm run check` — Expected: pass.
- [ ] **Step 4: Package** `wails3 task package`, re-register (`lsregister -f`, `pluginkit -a` per memory), `open "bin/Halmos Editor.app"`. Confirm freshness with `ls -lT`.
- [ ] **Step 5: User click-through** (with at least 3 recents; ask the user):
  1. Layout matches mockup A; version shows.
  2. New document, Open…, ⌘N, ⌘O; clicking a recent opens it.
  3. With 10 recents incl. a long name: list scrolls, text truncates.
  4. Narrow the window below ~760px: panel stacks above the list.
  5. View → Appearance → Dark and Sepia: readable, hover visible.
  6. Guides and Questions open in the browser.
  7. Clear: list empties and a new document opens.
- [ ] **Step 6: Commit** `docs: changelog and roadmap for the new start screen`.
