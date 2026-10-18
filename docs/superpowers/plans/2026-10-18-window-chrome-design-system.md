# Toolbar, Outline and Status Bar to the Design System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the toolbar, outline panel and status bar in line with the Halmos Design System, exactly as the "Proposed" side of the window chrome audit shows; the user approved every change on 2026-10-18.

**Architecture:** Markup changes in `App.svelte` (toolbar groups and Outline toggle, status bar text) and `Outline.svelte` (no arrow, new rows and empty state); look in `style.css`. The side-panel colour token is renamed from `--welcome-panel` to `--panel` because the outline now uses it too. Contrast pairs for the new text-on-ground combinations go into `contrast.test.ts`.

**Tech Stack:** Svelte 5, TypeScript, Vitest + jsdom, plain CSS.

**Spec:** the audit canvas https://claude.ai/artifact/GQGCLdLabyu33dmWs7hjFJ ("Proposed" column of each artboard) and the design system https://claude.ai/artifact/QYDPgsGxNgVo8G6LG4GaBj (README rules and tokens).

## Global Constraints

- Toolbar order and labels: `Outline` | `Open…` `Save` | `Cite…` `Chart…` `Table…` | `Export PDF…` (right-aligned). Single `…` character. Groups 16px apart, buttons in a group 8px apart. Button size, corners and casing unchanged.
- The Outline button is a toggle: `aria-pressed` follows `showOutline`; pressed fill `var(--border)`. Its `title` is `Hide outline (⌘⌥O)` when shown, `Show outline (⌘⌥O)` when hidden. Clicking it calls the existing `setOutlineShown(!showOutline)`.
- No outline arrows anywhere: the `‹` hide button and the `›` reveal tab are removed. Show/hide routes are the toolbar button, ⌘⌥O and View → Outline.
- Outline panel: 220px, background `var(--panel)`, heading `Outline` as an 11px / 600 / `.04em` / uppercase / `--muted` label (padding 12px 12px 6px); rows 13px, padding 4px 8px, radius 6px, hover fill `--surface`, no colour change on hover; list padding `0 6px 8px`, rows 1px apart; indentation `(level - 1) * 12px`; level-1 rows weight 500; long names end in an ellipsis; each row's `title` is the full heading text (or `(untitled)`).
- Outline empty state, two lines, 12px `--muted`: `No headings yet.` and `Lines that start with # appear here.`
- Status bar: height 24px, items vertically centred, 12px `--muted`, padding 0 12px. Unsaved shows `{name} — Edited` (em dash, spaces), never `•`. Unknown citations link at the right (`margin-left: auto`), colour `--cite-error-fg`, wording unchanged (`N unknown citation(s)`), underline on hover.
- Token rename `--welcome-panel` → `--panel` in all three palette blocks and every use. No literal colours (contract test).

## Review Focus

1. **Toggle stays in step with the menu.** View → Outline, ⌘⌥O and the toolbar button must agree: `aria-pressed` and the View checkbox both follow the one `showOutline` setting. Test in Task 1; click-through item 2.
2. **Window dragging.** The toolbar's empty space, including the gaps between groups and the space before Export PDF…, must still drag the window; buttons must still click. Click-through item 1.
3. **Narrow window.** With no minimum window width, a narrow window must be no worse than now: buttons stay clickable and do not overlap the traffic lights. Click-through item 5.
4. **Long headings.** A heading wider than the panel ends in an ellipsis and its full text shows on hover; the panel never scrolls sideways. Test in Task 2; click-through item 3.
5. **Dark and sepia.** Pressed Outline button, panel text, and the red unknown-citations link stay readable in all three themes. Contrast pairs in Tasks 1–3; click-through item 6.

---

### Task 1: Toolbar groups, ellipses and the Outline toggle

**Files:**
- Modify: `frontend/src/App.svelte` (`<header class="toolbar">`, ~line 1308)
- Modify: `frontend/public/style.css` (`.toolbar`, ~line 250)
- Test: `frontend/src/App.test.ts`, `frontend/src/lib/contrast.test.ts`

**Interfaces:**
- Produces: `button.outline-toggle` in the toolbar with `aria-pressed="true|false"`. Task 2 relies on it being the only mouse route to show the outline.

- [ ] **Step 1: Failing tests** in `App.test.ts`, new describe `toolbar`:
  - `labels and groups the toolbar buttons` — `[...target.querySelectorAll('.toolbar button')].map(b => b.textContent.trim())` equals `['Outline', 'Open…', 'Save', 'Cite…', 'Chart…', 'Table…', 'Export PDF…']`; `.toolbar .toolbar-group` count is 4.
  - `the Outline button shows the panel's state and toggles it` — default settings: `.outline-toggle` has `aria-pressed="false"` and title `Show outline (⌘⌥O)`; click it → `UpdateSettings` called with `showOutline: true`. With `showOutline: true`: `aria-pressed="true"`, title `Hide outline (⌘⌥O)`.
  - In `contrast.test.ts` PAIRS: `['pressed toolbar button', '--fg', '--border', 4.5]`.
- [ ] **Step 2: Run** `cd frontend && npx vitest run src/App.test.ts src/lib/contrast.test.ts` — Expected: the two toolbar tests FAIL; the contrast pair passes (guard, all three themes).
- [ ] **Step 3: Implement** — four `<div class="toolbar-group">` wrappers (`role="group"`, `aria-label` `Outline`, `File`, `Insert`, `Export`); the last group gets class `toolbar-end`. Update existing tests that find toolbar buttons by the old labels (`buttonByText(target, 'Table')` → `'Table…'`).
- [ ] **Step 4: CSS** — `.toolbar { gap: 16px; }`; `.toolbar-group { display: flex; gap: 8px; }`; `.toolbar-end { margin-left: auto; }`; `.toolbar button[aria-pressed="true"] { background: var(--border); }`. Groups stay drag regions; buttons keep `no-drag`.
- [ ] **Step 5: Run** `cd frontend && npm test && npm run check` — Expected: all pass.
- [ ] **Step 6: Commit** `feat: toolbar groups, ellipses and an Outline toggle`.

---

### Task 2: Outline panel

**Files:**
- Modify: `frontend/src/Outline.svelte`
- Modify: `frontend/src/App.svelte` (remove the `.outline-reveal` button and the `onhide` prop)
- Modify: `frontend/public/style.css` (outline rules ~385–406; palette blocks ~32, ~96, ~148; `.welcome-side` ~630; print rule ~983)
- Test: `frontend/src/App.test.ts` (`outline panel` describe), `frontend/src/lib/contrast.test.ts`

**Interfaces:**
- Consumes: `button.outline-toggle` (Task 1).
- Produces: `Outline` props `{ entries, onjump }` only. CSS token `--panel`.

- [ ] **Step 1: Failing tests** — rewrite the `outline panel` describe:
  - `is hidden by default with no reveal arrow` — `.outline` null, `.outline-reveal` null, `.outline-arrow` null.
  - `shows when the setting is on and lists the document headings` — keep the existing body; also `.outline-heading` text `Outline`; empty state's `.outline-empty` texts equal `['No headings yet.', 'Lines that start with # appear here.']`.
  - `marks top-level headings and titles each row with its text` — after loading `# One\n\n## Two\n`: the `One` row has class `outline-top`, `Two` does not; titles are `One` and `Two`.
  - `hides through the toolbar button` — replaces the arrow test: with `showOutline: true`, click `.outline-toggle` → `UpdateSettings` called with `showOutline: false`.
  - In `contrast.test.ts` PAIRS: `['side panel text', '--fg', '--panel', 7]`, `['side panel muted', '--muted', '--panel', 4.5]`.
- [ ] **Step 2: Run** `cd frontend && npx vitest run src/App.test.ts src/lib/contrast.test.ts` — Expected: the outline tests and both contrast pairs FAIL (`--panel` not defined yet).
- [ ] **Step 3: Implement** markup — `<p class="outline-heading">Outline</p>` replaces `.outline-header`; rows `button.outline-entry` (drop `link-button`) with `class:outline-top={e.level === 1}` and `title={e.text || '(untitled)'}`; `li` `padding-left: {(e.level - 1) * 12}px`; empty state is the two `p.outline-empty` lines. Remove `onhide` from `Outline.svelte` and the reveal button from `App.svelte`.
- [ ] **Step 4: CSS** per Global Constraints, replacing the old outline rules; rename `--welcome-panel` to `--panel` in the three palette blocks and `.welcome-side`; remove `.outline-reveal` from the print rule.
- [ ] **Step 5: Run** `cd frontend && npm test && npm run check` — Expected: all pass, style contract included.
- [ ] **Step 6: Commit** `feat: outline panel rows and heading from the design system`.

---

### Task 3: Status bar

**Files:**
- Modify: `frontend/src/App.svelte` (`<footer class="status-bar">`, ~line 1347)
- Modify: `frontend/public/style.css` (`.status-bar`, ~598)
- Test: `frontend/src/App.test.ts`, `frontend/src/lib/contrast.test.ts`

- [ ] **Step 1: Failing tests:**
  - New in the unknown-citations describe: `puts the unknown-citations link last in the bar` — the `.unknown-count` button is the status bar's last element child.
  - New: `says Edited for unsaved changes` — after an edit, `.status-bar` text contains `draft.md — Edited` and not `•`.
  - Update existing dirty assertions: `toContain('•')` → `toContain('— Edited')`; `not.toContain('•')` → `not.toContain('Edited')`; `'Untitled •'` → `'Untitled — Edited'`.
  - In `contrast.test.ts` PAIRS: `['status bar error', '--cite-error-fg', '--bg', 4.5]`.
- [ ] **Step 2: Run** `cd frontend && npx vitest run src/App.test.ts src/lib/contrast.test.ts` — Expected: the Edited tests FAIL; the link-position test passes (guard: it is already last); the contrast pair passes (guard).
- [ ] **Step 3: Implement** — `<span class="status-name">{filename}{#if dirty}<span class="status-edited"> — Edited</span>{/if}</span>`.
- [ ] **Step 4: CSS** — `.status-bar { height: 24px; padding: 0 12px; align-items: center; }` (keep border, size, colour, gap); `.status-bar .unknown-count { margin-left: auto; color: var(--cite-error-fg); font-size: 12px; padding: 0; }`.
- [ ] **Step 5: Run** `cd frontend && npm test && npm run check` — Expected: all pass.
- [ ] **Step 6: Commit** `feat: status bar says Edited and flags unknown citations in red`.

---

### Task 4: Docs, design system, package, click-through

**Files:**
- Modify: `CHANGELOG.md` (`## [Unreleased]` → `### Changed`), `ROADMAP.md` (design-system item status)
- Modify (artifact): design system `README.md`, `tokens.json` (`welcome-panel` → `panel`), `components/Toolbar/README.md`, `components/StatusBar/README.md`

- [ ] **Step 1: CHANGELOG** top bullet under `### Changed`:

```markdown
- The toolbar, outline and status bar follow the design system. The
  toolbar groups its buttons, adds "…" where a dialog follows, and gains
  an Outline button that shows and hides the outline. The outline's arrows
  are gone, its rows match the start screen's lists, and an empty outline
  says how to add a heading. The status bar says "Edited" instead of
  showing a dot, and unknown citations show at its right in red.
```

- [ ] **Step 2: ROADMAP** — replace `Next: the toolbar, status bar and` … through the end of that sentence so it records the toolbar, status bar and outline done on 2026-10-18 and names what is left (toast text size, start screen button sizes, spacing scale). One `str.replace` on a unique string with `assert s.count(old) == 1`; `grep -c '^- \['` and `grep '^## '` unchanged.
- [ ] **Step 3: Design system** — README: Colour rule "A side panel takes one step off its neighbour: `panel`"; Iconography "The toolbar is text-only" stays; States gains "A toggle button shows its on state with a `border` fill and `aria-pressed`"; remove nothing from Known inconsistencies except what this fixed (none listed). Toolbar README: groups, ellipses, Outline toggle. StatusBar README: `— Edited`, error-coloured link at the right, 24px. tokens.json: rename the token and its usage text to name the outline too. Publish only those files.
- [ ] **Step 4: Full suite** `go test ./. && cd frontend && npm test && npm run check` — Expected: pass.
- [ ] **Step 5: Package** `wails3 task package`, re-register Quick Look, open the app; confirm the binary contains `Lines that start with #`.
- [ ] **Step 6: User click-through:**
  1. Toolbar: groups and ellipses as on the canvas; drag the window by the empty toolbar space, including between groups.
  2. Click Outline: panel opens and the button looks pressed; ⌘⌥O closes it and the button releases; View → Outline's tick agrees each time.
  3. Outline: hover a row (grey fill, no blue); a long heading ends in "…" and its tooltip shows it whole; click a heading jumps to it; a document with no headings shows the two-line empty state.
  4. Status bar: type a character → "— Edited"; save → it goes; cite a missing key → red link at the right, opens the list.
  5. Narrow the window as far as it goes: toolbar buttons stay clickable and clear of the traffic lights.
  6. Repeat 2–4 in Dark and Sepia.
- [ ] **Step 7: Commit** `docs: changelog and roadmap for the toolbar, outline and status bar`.
