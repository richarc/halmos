# Dialogs to the Design System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the seven small dialogs in line with the Halmos Design System, exactly as the "Proposed" side of the dialog audit shows; the user approved every change on 2026-10-17.

**Architecture:** Shared look goes into `Dialog.svelte` (an optional visible title) and `style.css` (dialog text size, paragraph spacing, hint style, left-aligned alternative button, field size and corners). Each call site then opts in: passes `title`, marks its alternative button, splits a hint. New document gets real style names from a list kept in step with `menu.go`. A contract test stops Svelte files referencing colour variables that do not exist.

**Tech Stack:** Svelte 5, TypeScript, Vitest + jsdom, plain CSS.

**Spec:** the audit canvas https://claude.ai/artifact/6UE6FaL4PhjbnqmG1knB7N ("Proposed" column of each artboard) and the design system https://claude.ai/artifact/QYDPgsGxNgVo8G6LG4GaBj (README rules and tokens).

## Global Constraints

- Dialog body text 13px, line-height 1.5; paragraphs 8px apart; hints 12px `--muted`.
- Visible title: 15px, weight 600, 8px below; text equals the dialog's accessible name.
- Alternative action (Don't Save, Discard Draft, Open Install Page, Don't Check) sits at the left of the footer; Cancel and the primary stay right.
- Fields (`input` other than checkbox/radio, `select`, `textarea`): 13px, padding 4px 8px, `border-radius: 6px`.
- Dialog button casing stays Title Case; existing wording stays except the two approved additions: Check for updates' last sentence becomes its own hint line; Unknown citations gains the line "Not found in the bibliography. Click one to go to it."
- New document's style list shows `APA`, `Chicago (author-date)`, `Harvard`, `IEEE`, `Vancouver` in that order — the labels and order of `citationStyles` in `menu.go:13-19`. Values stay the ids.
- Unknown citations: key in monospace 13px, "Line N" 12px `--muted` at the right, rows `padding: 6px 10px`, `radius 6px`, hover `--surface`; Close becomes `primary`.
- No literal colours in `style.css` rules (contract test). The chart and table builders are not redesigned here; they only inherit the shared dialog text size and field rules.

## Review Focus

1. **Chart and table builders inherit 13px body text and the new field size.** They must still lay out (labels, selects in the encode grid, textarea). Click-through item 6.
2. **Return still runs the primary action.** `focusDefaultButton` looks for `.modal-buttons .primary`; Unknown citations now has one (Close). Existing focus test stays green; click-through item 2.
3. **A long file name in Unsaved changes / Recover draft.** Wraps inside the 400px dialog, never widens it. Click-through item 1.
4. **Dark and sepia.** Hints and line numbers use `--muted`; contrast holds on `--overlay-bg` in all three themes (checked in the design system). Click-through item 7.
5. **Screen readers.** The visible title must not change the accessible name (keep `aria-label`), so existing `dialog[aria-label="…"]` test selectors keep working.

---

### Task 1: Shared dialog look

**Files:**
- Modify: `frontend/src/Dialog.svelte` (props + markup at the end of the file)
- Modify: `frontend/public/style.css` (`.dialog-body` ~line 709, `.modal-buttons` ~712, field rule ~363)
- Test: `frontend/src/Dialog.test.ts`

**Interfaces:**
- Produces: `Dialog` prop `title?: string` → renders `<h2 class="dialog-title">{title}</h2>` as the first child of `.dialog-body`; nothing when absent. CSS classes `dialog-title`, `dialog-hint` (on a `<p>`), `dialog-alt` (on a footer button).

- [ ] **Step 1: Failing tests** in `Dialog.test.ts`, using the file's existing mount helper:
  - `shows a visible title when given one` — `title: 'Unsaved changes'` → `dialog .dialog-body > h2.dialog-title` text `Unsaved changes`, and it is the body's first element child.
  - `shows no title element without one` — no `title` → `h2.dialog-title` is null.
  - `keeps the accessible name when titled` — `label: 'Unsaved changes', title: 'Unsaved changes'` → `aria-label` still `Unsaved changes`.
- [ ] **Step 2: Run** `cd frontend && npx vitest run src/Dialog.test.ts` — Expected: the two title tests FAIL; the third passes (guard).
- [ ] **Step 3: Implement** the prop and markup.
- [ ] **Step 4: CSS** — `.dialog-body { padding: 24px; font-size: 13px; line-height: 1.5; }`; `.dialog-body p + p { margin-top: 8px; }`; `.dialog-title { margin: 0 0 8px; font-size: 15px; font-weight: 600; line-height: 1.3; }`; `.dialog-hint { font-size: 12px; color: var(--muted); }`; `.modal-buttons .dialog-alt { margin-right: auto; }`; field rule: `font-size: 13px; padding: 4px 8px; border-radius: 6px;`.
- [ ] **Step 5: Run** `cd frontend && npm test && npm run check` — Expected: all pass (contract test included).
- [ ] **Step 6: Commit** `feat: dialog titles, text size and field corners from the design system`.

---

### Task 2: The five App dialogs and Unknown citations

**Files:**
- Modify: `frontend/src/App.svelte` (Dialogs at ~1433–1510)
- Modify: `frontend/src/UnknownCitations.svelte`
- Modify: `frontend/public/style.css` (`.unknown-list` rules ~603–605)
- Test: `frontend/src/App.test.ts`

**Interfaces:**
- Consumes: `title`, `.dialog-alt`, `.dialog-hint` (Task 1).

- [ ] **Step 1: Failing tests** in `App.test.ts` (find each dialog by its existing `aria-label`):
  - `titles the unsaved-changes dialog and puts Don't Save on the left` — open it the way the existing unsaved-changes tests do; `h2.dialog-title` = `Unsaved changes`; the `Don't Save` button has class `dialog-alt`.
  - `titles the first-launch update question and splits its hint` — `updateCheck: 'unasked'`; title `Check for updates`; `.dialog-hint` text `You can change this later in the Help menu.`; `Don't Check` has `dialog-alt`.
  - `unknown citations dialog has a title, a subtitle and a primary Close` — trigger it the way the existing unknown-citations test does; title `Unknown citations`; text contains `Not found in the bibliography. Click one to go to it.`; `Close` has class `primary`; a row shows `Line 14`-style text (`Line ` + number).
- [ ] **Step 2: Run** `cd frontend && npx vitest run src/App.test.ts` — Expected: these FAIL, others pass.
- [ ] **Step 3: Implement** — pass `title` equal to each `label` on Unsaved changes, Recover draft, Zotero, Check for updates, Update available, Unknown citations; add `class="dialog-alt"` to Don't Save, Discard Draft, Open Install Page, Don't Check; move "You can change this later in the Help menu." into `<p class="dialog-hint">`; Unknown citations: subtitle `<p class="dialog-hint">`, rows `<span class="unknown-key">[@key]</span><span class="unknown-line">Line N</span>`, Close `class="primary"`.
- [ ] **Step 4: CSS** for Unknown citations per Global Constraints (rows `justify-content: space-between; align-items: baseline;` key `font-family: var(--doc-font-mono)` is sheet-scoped, so use `ui-monospace, SFMono-Regular, Menlo, monospace` directly; hover `background: var(--surface)`; list `margin: 8px -10px 0`).
- [ ] **Step 5: Run** `cd frontend && npm test && npm run check` — Expected: all pass. Fix any existing test that matched the old lowercase `line N` text by updating it to `Line N`.
- [ ] **Step 6: Commit** `feat: titles and macOS button order in the app's dialogs`.

---

### Task 3: New document — style names and the missing colour

**Files:**
- Modify: `frontend/src/lib/citations.ts` (next to `STYLE_IDS`, ~line 35)
- Test: `frontend/src/lib/citations.test.ts`
- Modify: `frontend/src/NewDocument.svelte` (markup ~95–150, styles ~160–200)
- Modify: `frontend/src/lib/styleContract.test.ts`
- Test: `frontend/src/App.test.ts` (new-documents describe)

**Interfaces:**
- Produces: `export const STYLE_CHOICES: readonly { id: string; label: string }[]` — `[{apa,'APA'},{'chicago-author-date','Chicago (author-date)'},{harvard,'Harvard'},{ieee,'IEEE'},{vancouver,'Vancouver'}]`, with a comment naming `menu.go`'s `citationStyles` as the other half.

- [ ] **Step 1: Failing tests:**
  - citations.test `STYLE_CHOICES covers every bundled style once, in menu order` — `STYLE_CHOICES.map(c => c.id).sort()` equals `[...STYLE_IDS].sort()`; labels equal the five above in order.
  - styleContract.test `Svelte components reference only defined variables` — read every `frontend/src/**/*.svelte`, collect `var(--name`, assert each is defined in `style.css` or in the existing `RUNTIME_VARIABLES` set. Expected to FAIL on `--text-muted`.
  - App.test `New document lists styles by name` — open New document; the `select` options' text is the five labels and their values are the ids.
- [ ] **Step 2: Run** `cd frontend && npx vitest run src/lib/citations.test.ts src/lib/styleContract.test.ts src/App.test.ts` — Expected: the three FAIL.
- [ ] **Step 3: Implement** — `STYLE_CHOICES`; NewDocument iterates it (`<option value={c.id}>{c.label}</option>`); `h2` → `class="dialog-title"` (drop its local `h2` rule); `.hint` → `color: var(--muted); font-size: 12px; margin: 4px 0 16px 24px;`; `.indent { margin: 6px 0 16px 24px; }`; `.check-row { gap: 8px; }`; `.style-row { gap: 16px; }`.
- [ ] **Step 4: Run** `cd frontend && npm test && npm run check` — Expected: all pass.
- [ ] **Step 5: Commit** `fix: New document shows style names and grey hints`.

---

### Task 4: Docs, design system, package, click-through

**Files:**
- Modify: `CHANGELOG.md` (`## [Unreleased]`), `ROADMAP.md` (status line of the design-system item)
- Modify (artifact): design system README "Known inconsistencies" and Dialog / TextField component READMEs

- [ ] **Step 1: CHANGELOG** under `### Changed`:

```markdown
- Dialogs follow the new design system: each shows its title, text is the
  same size as the rest of the app, paragraphs are spaced, and the
  alternative button (Don't Save, Discard Draft) sits on the left as in
  other Mac apps. New document lists citation styles by name, and its
  hints are grey as intended.
```

- [ ] **Step 2: ROADMAP** — replace the item's status sentence `Step 2 audits each screen against it (dialogs first), …` so it records: dialogs audited and redesigned 2026-10-17; builders next. One `str.replace` on a unique string; check `grep -c '^- \[ \]'` and `grep '^## '` unchanged.
- [ ] **Step 3: Design system** — in its README remove the four dialog inconsistencies now fixed (16px text, missing titles, touching paragraphs, `--text-muted`) and the field-corner one; update Dialog README rules (title, 13px body, alt left) and TextField (13px, 4px × 8px, radius-6). Publish only those files.
- [ ] **Step 4: Full suite** `go test ./. && cd frontend && npm test && npm run check` — Expected: pass.
- [ ] **Step 5: Package** `wails3 task package`, re-register Quick Look, open the app; confirm binary time with `ls -lT`.
- [ ] **Step 6: User click-through:**
  1. Edit a file with a long name, close the window: Unsaved changes shows its title, Don't Save on the left, text wraps.
  2. Press Return in it: saves. Esc: cancels.
  3. File → New…: title, grey hints, style names; step 2 Bibliography looks right.
  4. Status bar unknown citations (cite a missing key): title, subtitle, rows, Return closes.
  5. Help → Check for Updates… with update check on (or set `updateCheck` to `unasked` to see the question): Update available / question dialogs.
  6. Insert → Chart… and Insert → Table…: still lay out correctly.
  7. Repeat 1 and 3 in Dark and Sepia.
- [ ] **Step 7: Commit** `docs: changelog and roadmap for the dialog redesign`.
