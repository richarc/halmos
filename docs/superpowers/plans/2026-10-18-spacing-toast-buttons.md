# Spacing Scale, Toast and Button Sizes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the design system's last known inconsistencies, exactly as the "Proposed" side of the finishing audit shows; the user approved every change on 2026-10-18.

**Architecture:** CSS value changes in `style.css`, guarded by a new style-contract test that fails on any chrome spacing value off the scale. The toast gets its own text size, width and position. One label change in `App.svelte`. The design system's tokens and READMEs record the scale and the two named button sizes.

**Tech Stack:** Svelte 5, TypeScript, Vitest + jsdom, plain CSS.

**Spec:** the audit canvas https://claude.ai/artifact/AzrWkRxFap7dUM5mPD4bik ("Proposed" column) and the design system https://claude.ai/artifact/QYDPgsGxNgVo8G6LG4GaBj.

## Global Constraints

- Spacing scale for the chrome: 2, 4, 8, 12, 16, 20, 24, 32, 48 (px). Named exceptions: 72 (title-bar clearance), 104 (toolbar inset), 0. The global `button` rule's `5px 12px` padding is the regular button's size and stays. Document rules (anything rendering on the sheet: selectors containing `.sheet`, `.preview-pane`, `.cite-error`, `.chart-error`, `.mermaid`) are not chrome and are not checked.
- Folds, from the audit table (selector → new value):
  - `.welcome-actions` gap 8; `.welcome-actions button` gap 8, padding `0 12px`; `.welcome-help` gap 8
  - `.welcome-recents-head` padding `0 12px`; `.welcome button.welcome-recent` gap 12, padding `8px 12px`
  - `.welcome-recent-text` gap 2; `.welcome-title` gap 4; `.welcome-main` padding `72px 48px 32px`
  - narrow-window `.welcome-side` gap 24
  - `.outline-heading` padding `12px 12px 4px`; `.outline ul` padding `0 8px 8px`, gap 2
  - `.unknown-list` margin `8px -8px 0`; `.unknown-list button.unknown-entry` padding `4px 8px`
  - `.table-grid input` padding `4px 8px`; `.col-controls` padding `4px 8px`
  - `button.link-button` padding `4px 0` (not on the canvas: the only user overrides it to 0, so nothing on screen changes; folded so the contract test has no exception for it)
- Toast: `font-size: 13px; line-height: 1.5; padding: 8px 12px; max-width: 360px; overflow-wrap: anywhere; bottom: 40px; right: 16px` (40 = the 24px status bar + 16).
- Start screen primary button reads `New Document`. The New document dialog's title and accessible name stay `New document` (a title, sentence case).
- Two named button sizes, unchanged in look: Regular (13px, 28px tall, `radius-6`) and Large (14px, 44px tall, `radius-8`, start screen only).

## Review Focus

1. **Focus rings in the unknown-citations list.** Rows sit 8px into a negative margin inside a scrolling list; a focused row's ring (4px total) must not be clipped at the list's edges. Click-through item 4.
2. **Table builder rows** at 4px cell padding: inputs, the alignment group and the remove buttons still fit and line up. Click-through item 3.
3. **A long toast** with an unbroken path wraps inside 360px rather than overflowing. Test in Task 2; click-through item 2.
4. **Start screen in a narrow window** (below 760px): the stacked layout still spaces cleanly. Click-through item 1.
5. **Dark and sepia**: no colour changes, but the toast's inverted fill must still read at 13px. Contrast pair already exists (`toast`). Click-through item 5.

---

### Task 1: Spacing scale

**Files:**
- Modify: `frontend/public/style.css` (rules named in Global Constraints)
- Test: `frontend/src/lib/styleContract.test.ts`

- [ ] **Step 1: Failing test** `keeps chrome spacing on the scale` in the `style.css palette contract` describe: strip comments; for every innermost `selector { body }` whose selector does not match the document pattern, collect px numbers from `gap`, `row-gap`, `column-gap`, `padding*` and `margin*` declarations; allowed = `{0, 2, 4, 8, 12, 16, 20, 24, 32, 48, 72, 104}`, plus `5` for the exact selector `button`. Expect the list of `selector: property value` offenders to equal `[]`.
- [ ] **Step 2: Run** `cd frontend && npx vitest run src/lib/styleContract.test.ts` — Expected: FAIL, listing the offenders in Global Constraints' fold list (and nothing else; anything else is a plan gap — rule on it).
- [ ] **Step 3: Implement** every fold in Global Constraints.
- [ ] **Step 4: Run** `cd frontend && npm test && npm run check` — Expected: all pass.
- [ ] **Step 5: Commit** `style: chrome spacing on one scale`.

---

### Task 2: Toast and the New Document label

**Files:**
- Modify: `frontend/public/style.css` (`.toast` ~line 947)
- Modify: `frontend/src/App.svelte` (start screen primary button ~line 1374)
- Test: `frontend/src/lib/styleContract.test.ts`, `frontend/src/App.test.ts`
- Modify: `docs/getting-started.md:27`

- [ ] **Step 1: Failing tests:**
  - styleContract `gives the toast its own text size and keeps it above the status bar` — the `.toast` rule contains `font-size: 13px`, `max-width: 360px`, `overflow-wrap: anywhere` and `bottom: 40px`.
  - App.test welcome describe: `names the start screen button New Document` — `buttonByText(target.querySelector('.welcome')!, 'New Document')` is defined and `buttonByText(..., 'New document')` is undefined.
- [ ] **Step 2: Run** `cd frontend && npx vitest run src/lib/styleContract.test.ts src/App.test.ts` — Expected: both FAIL.
- [ ] **Step 3: Implement** the toast rule per Global Constraints; the label. Update existing tests that click the start screen button by `'New document'` to `'New Document'` (the dialog's `aria-label="New document"` lookups stay). Guide line 27: `a **New Document** button`.
- [ ] **Step 4: Run** `cd frontend && npm test && npm run check` — Expected: all pass.
- [ ] **Step 5: Commit** `feat: toast text size and position; New Document in Title Case`.

---

### Task 3: Docs, design system, package, click-through

**Files:**
- Modify: `CHANGELOG.md`, `ROADMAP.md`
- Modify (artifact): design system `README.md`, `tokens.json` (spacing tokens), `components/Toast/README.md`, `components/Button/README.md`

- [ ] **Step 1: CHANGELOG** top bullet under `### Changed`:

```markdown
- Spacing across the app follows one scale, toasts use the same text size
  as dialogs, wrap long messages and sit above the status bar instead of
  covering it, and the start screen's button reads "New Document".
```

- [ ] **Step 2: ROADMAP** — the design-system item's status: replace `Left: toast text size, the start screen's button sizes, and
      the spacing scale.` with a sentence recording them done on 2026-10-18 and the item complete; tick its box (`- [ ]` → `- [x]` on that item only). `str.replace` with `assert s.count(old) == 1`; `grep -c '^- \[ \]'` drops by exactly 1, `grep -c '^- \['` and `grep '^## '` unchanged.
- [ ] **Step 3: Design system** — tokens.json spacing: `space-2, 4, 8, 12, 16, 20, 24, 32, 48`, plus `space-72` and `toolbar-inset` kept as named measurements; drop `space-6, 10, 14, 56` with usages moved to the new steps. README: Known inconsistencies keeps only the icons line; Spacing section states the scale and its three exceptions; Type adds nothing. Button README: Regular and Large as named sizes, "New Document" as the example. Toast README: 13px/1.5, 8 × 12 padding, 360 max width, 16px above the status bar. Publish only those files.
- [ ] **Step 4: Full suite** `go test ./. && cd frontend && npm test && npm run check` — Expected: pass.
- [ ] **Step 5: Package** `wails3 task package`, re-register Quick Look, relaunch; confirm the binary contains `max-width: 360px`.
- [ ] **Step 6: User click-through:**
  1. Start screen: spacing looks as on the canvas; "New Document"; narrow the window below 760px and check the stacked layout.
  2. File → Export HTML… once: the "Exported …" toast is 13px and sits above the status bar, with the unknown-citations link still visible.
  3. Insert → Table…: cells, alignment buttons and ✕ line up at the tighter padding.
  4. Cite a missing key, open the unknown-citations list, Tab through its rows: focus rings are whole.
  5. Repeat 1–2 in Dark and Sepia.
- [ ] **Step 7: Commit** `docs: changelog and roadmap for the spacing scale, toast and buttons`.
