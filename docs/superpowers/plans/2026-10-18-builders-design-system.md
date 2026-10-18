# Chart and Table Builders to the Design System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the chart and table builders exactly as the "Proposed" side of the builder audit shows; the user approved every change on 2026-10-18.

**Architecture:** Plain names for the chart builder's choices come from one new module (`lib/chartLabels.ts`), so the stored Vega-Lite values never change. `ChartBuilder.svelte` gets a two-column layout (settings left, sticky preview right) once data is loaded, with the settings grouped under section headings. `TableBuilder.svelte` becomes one joined grid with column controls in the header cells. All new CSS is scoped under `.chart-builder` / `.table-builder`.

**Tech Stack:** Svelte 5, TypeScript, Vitest + jsdom, plain CSS.

**Spec:** the builder audit canvas https://claude.ai/artifact/CqXWJP9cp2guv4nsyTUWeo ("Proposed" column of each artboard; the generator kept at the session scratchpad is not part of the repo) and the design system https://claude.ai/artifact/QYDPgsGxNgVo8G6LG4GaBj.

## Global Constraints

- Title: `class="dialog-title"` (15px/600). Chart: `Insert chart` new, `Edit chart` when `initial` is set. Table: `Insert table` / `Edit table`. Dialog `label` (accessible name) equals the title text.
- Primary button: `Insert` new, `Update` when editing. Chart "Choose file…" becomes `Choose File…`.
- Section headings: `<p class="builder-section">` (11px, weight 600, `letter-spacing: .04em`, uppercase, `--muted`, margin `0 0 8px`). Field labels 13px `--muted`, 4px above the field. Groups 16px apart; fields in a group 8px apart.
- Chart choice labels (display only; `value` attributes stay the stored ids):
  - types: line Line, bar Bar, point Point, area Area, boxplot Box Plot, tick Strip, rule Stem, histogram Histogram, heatmap Heat Map, errorbar Error Bar, pie Pie
  - field types: quantitative Number, temporal Date, nominal Category
  - aggregates: none None, mean Average, median Median, sum Total, count Count
  - extents: ci `95% confidence interval`, stderr `Standard error`, stdev `Standard deviation`, iqr `Interquartile range`
- Chart field labels: Chart group `Type`, `Caption`; X axis group `Column`, `Treat as`, `Title`; Y group `Column`, `Treat as`, `Combine`, `Title`, and `Error bar shows` for errorbar; Colour group label `Split by` (pie `Category`, heatmap `Value`), heatmap's colour aggregate `Combine`. Group headings: `Data`, `Chart`, `X axis`, `Y axis` (pie `Slice size`), `Colour` (pie `Slices`, heatmap `Cell colour`).
- Column placeholder option `Choose a column`; no-colour option `None`. Axis title inputs show the chosen column name as `placeholder`.
- Data hint (next to Choose File…, before data): `Paste comma- or tab-separated text with a header row, or choose a .csv, .tsv or .txt file.` Textarea placeholder `year,qubits\n2023,127\n2024,1121`. After data: the summary (`N columns, N rows` plus the existing large-table sentence) is a 12px muted hint on the same row as Choose File….
- Chart layout: settings column 300px, gap 24px, preview fills the rest, `position: sticky; top: 0; align-self: start`. Below 760px viewport width the columns stack. Preview box: 1px `--border`, radius 6px, padding 12px, background `--bg`. Caption under the chart 12px `--muted`, centred. `PREVIEW_WIDTH_PX` 560 → 420.
- Table grid: one outer border `--border-strong`, radius 6px; cells square, 1px `--border` between them; header row `--surface` fill, weight 600; cell inputs borderless, `padding: 6px 8px`, min width 8rem, focus ring `2px solid var(--accent)` inset (`outline-offset: -2px`).
- Table column controls in each header cell above the name: alignment segmented control (four 24×20 buttons, inline stroke SVG icons for none/left/centre/right, pressed = `--accent` fill, `--on-accent` icon) and a quiet ✕ remove-column button. Row ✕ in a last narrow column, quiet (no border, `--muted`, hover `--border` fill and `--fg`).
- Table buttons: `Add Row`, `Add Column`, and at the right `Paste Data…` / `Hide Paste Box` when open. Paste area: label `Paste data`, error line (`--cite-error-fg`) right under the box with the box's border in `--cite-error-fg`, then hint `Comma- or tab-separated, with a header row. It replaces the table above.` Hint under the grid: `Return moves to the next row. The buttons above each column set its alignment.`
- No literal colours in `style.css` rules (contract test). Existing `data-field`, `data-col`, `data-row`, `data-align`, `.align`, `.remove-row`, `.remove-col`, `.th-cell`, `.td-cell`, `#table-import`, `#chart-paste` hooks stay.

## Review Focus

1. **Pasting must not lose focus.** The chart textarea is the same element before and after data arrives; the layout changes by a class on the wrapper, never by moving the textarea into another `{#if}` branch. Test in Task 2.
2. **Long settings column.** With every Y control showing (errorbar), the preview stays visible while the dialog scrolls (sticky), and the sticky footer still covers nothing important. Click-through item 2.
3. **Narrow window.** Below 760px the columns stack and nothing scrolls sideways; the table grid scrolls inside its own box. Click-through item 5.
4. **Existing charts open unchanged.** Option values are still the ids, so `readSpec` seeds select the right entries. Covered by the existing reopen tests staying green.
5. **Dark and sepia.** Pressed alignment icons and header fill read in all three themes. Click-through item 6.

---

### Task 1: Plain names for chart choices

**Files:**
- Create: `frontend/src/lib/chartLabels.ts`
- Test: `frontend/src/lib/chartLabels.test.ts`

**Interfaces:**
- Produces: `CHART_TYPE_LABELS: Record<ChartType, string>`, `FIELD_TYPE_LABELS: Record<FieldType, string>`, `AGGREGATE_LABELS: Record<Aggregate, string>`, `EXTENT_LABELS: Record<Extent, string>`, values as in Global Constraints. `Record` makes a missing entry a type error.

- [ ] **Step 1: Failing tests** — `labels every chart type in menu order` (`CHART_TYPES.map(t => CHART_TYPE_LABELS[t])` equals the eleven labels in order); `labels field types, aggregates and extents` (exact equality against the Global Constraints values); `every label is unique within its list`.
- [ ] **Step 2: Run** `cd frontend && npx vitest run src/lib/chartLabels.test.ts` — Expected: FAIL, module not found.
- [ ] **Step 3: Implement** the four records with a one-line comment that they are display-only.
- [ ] **Step 4: Run** the same — Expected: PASS. Then `npm run check` — 0 errors.
- [ ] **Step 5: Commit** `feat: plain names for chart builder choices`.

---

### Task 2: Chart builder layout and wording

**Files:**
- Modify: `frontend/src/ChartBuilder.svelte` (`PREVIEW_WIDTH_PX`, `valueLabel`/`colourLabel`, markup from `<Dialog` to the end)
- Modify: `frontend/public/style.css` (`.chart-builder` … `.chart-builder .chart-caption`, ~lines 746–834)
- Test: `frontend/src/ChartBuilder.test.ts`, `frontend/src/App.test.ts`

**Interfaces:**
- Consumes: Task 1's four records.
- Produces: CSS classes `builder-section`, `chart-layout` (+ `has-data`), `chart-side`, `chart-group`, `chart-pair`, `chart-preview-pane`.

- [ ] **Step 1: Failing tests** in `ChartBuilder.test.ts`:
  - `titles a new chart Insert chart and an existing one Edit chart` — `h2.dialog-title` text and `dialog` `aria-label` match; primary button text `Insert` / `Update`.
  - `shows plain names and keeps stored values` — after a paste, `select[data-field="chart-type"]` option texts are the eleven labels and values the ids; `x-type` options `Number, Date, Category`; `aggregate` texts `None, Average, Median, Total, Count`; errorbar `extent` texts the four extent labels; `colour` first option text `None`; `x` first option text `Choose a column`.
  - `groups the settings under headings` — `.builder-section` texts are `Data, Chart, X axis, Y axis, Colour`; for pie `Data, Chart, Slice size, Slices`; for heatmap the last is `Cell colour`.
  - `keeps the paste box focused when data arrives` — focus `#chart-paste`, paste valid data, flush; `document.activeElement` is still the same element and `.chart-layout` has class `has-data`.
  - `shows the column name as the axis title hint` — pick x `dose`: `input[data-field="x-title"]` placeholder `dose`.
- [ ] **Step 2: Run** `cd frontend && npx vitest run src/ChartBuilder.test.ts` — Expected: the five FAIL.
- [ ] **Step 3: Implement** the markup per Global Constraints: one `.chart-layout` wrapper always present; `.chart-side` holds the Data group then (when `table`) Chart, X axis, Y axis, Colour groups; `.chart-preview-pane` (preview div + caption) renders only when `table`. Keep every `data-field` and the existing `{#if}` conditions for which controls show. Rename the button and title from `initial`. `PREVIEW_WIDTH_PX = 420`.
- [ ] **Step 4: Update existing tests** that use old text: exact-match `'Insert chart'`/`'Update chart'` button finders become `'Insert'`/`'Update'` (ChartBuilder.test.ts and App.test.ts); `toContain('Insert chart')` stays (the title still says it); `toContain('Update chart')` becomes `toContain('Edit chart')`; `'Choose file'` becomes `'Choose File'`. No assertion is loosened beyond the renamed string.
- [ ] **Step 5: CSS** — replace the old `.chart-builder h2`, `.data-step`, `.encode-step` rules with the new classes; `.chart-layout.has-data { display: grid; grid-template-columns: 300px minmax(0, 1fr); gap: 24px; }`; sticky preview pane; 760px media query stacking it; caption 12px muted centred; `.chart-builder .builder-section` rule. Remove rules nothing uses any more.
- [ ] **Step 6: Run** `cd frontend && npm test && npm run check` — Expected: all pass, including `htmlExport` (no builder rule in the export) and the style contract.
- [ ] **Step 7: Commit** `feat: chart builder layout and plain wording from the design system`.

---

### Task 3: Table builder grid and wording

**Files:**
- Modify: `frontend/src/TableBuilder.svelte` (`ALIGNMENTS`, markup)
- Modify: `frontend/public/style.css` (`.table-builder` … `.table-builder .field-error`, ~lines 836–863)
- Test: `frontend/src/TableBuilder.test.ts`, `frontend/src/App.test.ts`

**Interfaces:**
- Consumes: `.dialog-title` and `.dialog-hint` from the dialog redesign. The table builder has no section headings.

- [ ] **Step 1: Failing tests** in `TableBuilder.test.ts`:
  - `titles a new table Insert table and an existing one Edit table` — title, `aria-label`, primary `Insert` / `Update`.
  - `puts each column's alignment and remove buttons in its header cell` — `th` for column 1 contains `.align-group` and `button.remove-col[data-col="0"]`; no `tr.remove-col-row` exists.
  - `alignment buttons show icons, not arrow characters` — each `button.align` contains an `svg` and its text content is empty.
  - `names the paste toggle by its state` — button `Paste Data…`, after click `Hide Paste Box` with `aria-expanded="true"`; label `Paste data`; hint text `It replaces the table above.` present.
  - `marks the paste box when its text is invalid` — invalid paste: `#table-import` has `aria-invalid="true"`, and the `.field-error` is the element right after it.
- [ ] **Step 2: Run** `cd frontend && npx vitest run src/TableBuilder.test.ts` — Expected: the five FAIL.
- [ ] **Step 3: Implement** — `ALIGNMENTS` drops `label` for an icon key; header cells hold a `.col-controls` row (align group + remove-col) above the `th-cell` input; remove-row buttons in a last `td.row-controls`; buttons and hints per Global Constraints; `aria-invalid` and error placement on the paste box. Keep all existing hooks.
- [ ] **Step 4: Update existing tests** — `'+ Row'` → `'Add Row'`, `'+ Column'` → `'Add Column'`, `'Import'` → `'Paste Data…'`, `'Insert table'`/`'Update table'` button finders → `'Insert'`/`'Update'` (TableBuilder.test.ts and App.test.ts); `toContain('Update table')` → `toContain('Edit table')`.
- [ ] **Step 5: CSS** per Global Constraints: `.table-grid` keeps `overflow-x: auto`; table inside a bordered rounded box; inputs borderless, square; header fill; segmented control; quiet ✕ buttons. Old `.table-grid input`, `.align-group .align`, `.table-actions`, `.table-import` rules replaced.
- [ ] **Step 6: Run** `cd frontend && npm test && npm run check` — Expected: all pass.
- [ ] **Step 7: Commit** `feat: table builder grid and wording from the design system`.

---

### Task 4: Docs, design system, package, click-through

**Files:**
- Modify: `CHANGELOG.md` (`## [Unreleased]` → `### Changed`), `ROADMAP.md` (design-system item status line)
- Modify (artifact): design system README "Known inconsistencies" (drop the builder heading size, caption size and table cell corner items) and the TextField README (builders now follow it)

- [ ] **Step 1: CHANGELOG** under `### Changed`:

```markdown
- The chart and table builders follow the design system. The chart builder
  shows its preview beside the settings, groups them under headings, and
  uses plain names (Number, Date, Category; Average, Total) instead of
  Vega-Lite's. The table builder is one joined grid with alignment and
  remove buttons in each column's header.
```

- [ ] **Step 2: ROADMAP** — replace the status sentence of the design-system item so it records: dialogs done 2026-10-17, builders done 2026-10-18, toolbar, status bar and outline next. One `str.replace` on a unique string with `assert s.count(old) == 1`; `grep -c '^- \['` and `grep '^## '` unchanged.
- [ ] **Step 3: Design system** — edit only the README files named above; publish only those.
- [ ] **Step 4: Full suite** `go test ./. && cd frontend && npm test && npm run check` — Expected: pass.
- [ ] **Step 5: Package** `wails3 task package`, re-register Quick Look, open the app; confirm the binary time with `ls -lT`.
- [ ] **Step 6: User click-through:**
  1. Insert → Chart…: title, one-column data step, hint; paste data while typing — focus stays, layout switches to two columns.
  2. Choose Error Bar: all Y controls show; scroll the dialog — preview stays in view. Menus show plain names. Insert works.
  3. Put the cursor in that chart, Insert → Chart…: title `Edit chart`, values selected as before, Update works.
  4. Insert → Table…: joined grid, icons, ✕ in headers; Return adds a row; Paste Data… with a bad row shows the error under the box; Insert works; reopen shows `Edit table`.
  5. Narrow the window below 760px: chart columns stack; a wide table scrolls inside its box.
  6. Repeat 2 and 4 in Dark and Sepia.
- [ ] **Step 7: Commit** `docs: changelog and roadmap for the builder redesign`.
