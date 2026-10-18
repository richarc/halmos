<!-- frontend/src/TableBuilder.svelte -->
<script lang="ts">
  import { flushSync, untrack } from 'svelte'
  import Dialog from './Dialog.svelte'
  import { parseDelimited } from './lib/dataTable'
  import type { Alignment, PipeTable } from './lib/pipeTable'

  interface Props {
    /** The table under the cursor, or null for a new one. */
    initial: PipeTable | null
    oncommit: (table: PipeTable) => void
    oncancel: () => void
  }

  const { initial, oncommit, oncancel }: Props = $props()

  // Read once at mount, as ChartBuilder does: the modal is recreated on each
  // open, never updated, so nothing here reacts to a later `initial`.
  const seed = untrack(() =>
    initial
      ? { header: [...initial.header], align: [...initial.align], rows: initial.rows.map((r) => [...r]) }
      : { header: ['Column 1', 'Column 2', 'Column 3'], align: [null, null, null], rows: [['', '', ''], ['', '', '']] },
  )

  let header = $state<string[]>(seed.header)
  let align = $state<Alignment[]>(seed.align)
  let rows = $state<string[][]>(seed.rows)

  // Each icon is three text lines drawn the way the alignment sets them; the
  // dashed one is "no alignment", which leaves it to the renderer.
  const ALIGNMENTS: { value: Alignment; path: string; dashed?: boolean; title: string }[] = [
    { value: null, path: 'M2 5h10', dashed: true, title: 'No alignment' },
    { value: 'left', path: 'M1 1h12M1 5h8M1 9h10', title: 'Align left' },
    { value: 'center', path: 'M1 1h12M3 5h8M2 9h10', title: 'Centre' },
    { value: 'right', path: 'M1 1h12M5 5h8M3 9h10', title: 'Align right' },
  ]

  const title = untrack(() => (initial ? 'Edit table' : 'Insert table'))

  const empty = $derived(header.every((h) => h.trim() === '') && rows.every((r) => r.every((c) => c.trim() === '')))

  function addRow() {
    rows = [...rows, header.map(() => '')]
  }
  function removeRow(i: number) {
    rows = rows.filter((_, r) => r !== i)
  }
  function addColumn() {
    header = [...header, `Column ${header.length + 1}`]
    align = [...align, null]
    rows = rows.map((r) => [...r, ''])
  }
  function removeColumn(c: number) {
    if (header.length <= 1) return
    header = header.filter((_, i) => i !== c)
    align = align.filter((_, i) => i !== c)
    rows = rows.map((r) => r.filter((_, i) => i !== c))
  }
  function setAlign(c: number, value: Alignment) {
    align = align.map((a, i) => (i === c ? value : a))
  }

  let grid: HTMLElement | undefined = $state()

  function cellInput(r: number, c: number): HTMLInputElement | null {
    return grid?.querySelector<HTMLInputElement>(`input.td-cell[data-row="${r}"][data-col="${c}"]`) ?? null
  }

  // Enter moves down a row; on the last row it adds one first. Tab keeps the
  // browser's own order, which is already reading order.
  //
  // Synchronous, not `await tick()`: this runs from a plain keydown handler,
  // not an effect, so `flushSync()` is safe here, and it matters — a caller
  // that flushes and asserts focus in the same synchronous turn (as the test
  // does) would otherwise observe this function's continuation still pending
  // as an unresolved microtask.
  function onCellKey(e: KeyboardEvent, r: number, c: number) {
    if (e.key !== 'Enter') return
    e.preventDefault()
    if (r === rows.length - 1) addRow()
    flushSync()
    cellInput(r + 1, c)?.focus()
  }

  let importOpen = $state(false)
  let importError = $state('')

  function onImport(e: Event) {
    const text = (e.currentTarget as HTMLTextAreaElement).value
    if (text.trim() === '') {
      importError = ''
      return
    }
    const result = parseDelimited(text)
    if (!result.ok) {
      importError = result.message
      return
    }
    importError = ''
    // result.table.rows is unusable here: parseDelimited types a quantitative
    // column's cells as JS numbers, so round-tripping through String() would
    // reformat cells the user typed (007 -> 7, 1.50 -> 1.5, 1e3 -> 1000) even
    // though the table builder's contract is "cells are raw markdown source".
    // result.raw carries the same cells as the trimmed strings splitLine
    // produced, untouched by that coercion.
    header = result.table.columns.map((col) => col.name)
    align = header.map(() => null)
    rows = result.raw
  }

  function commit() {
    oncommit({ header: [...header], align: [...align], rows: rows.map((r) => [...r]) })
  }

  // Same reason as ChartBuilder's paste box: the modal does not stop keystrokes
  // reaching the editor beneath it if focus is left behind. Runs once.
  //
  // This effect must run *after* Dialog.svelte's focusDefaultButton, which
  // focuses `.modal-buttons .primary` (the Insert/Update button) once the
  // dialog opens — otherwise that focus would win and the effect's own
  // focus() call here would be a no-op against a button that grabbed focus
  // later. Verified in a real browser (headless Chrome, 2026-08-28); jsdom
  // cannot exercise the ordering because Dialog's jsdom fallback path skips
  // showModal() entirely (see Dialog.svelte), so focusDefaultButton never
  // runs there and this effect always "wins" in tests regardless of order. A
  // Svelte upgrade that changes effect scheduling would surface as the
  // Insert/Update button holding focus when the table builder opens, instead
  // of the first header cell.
  let firstHeader: HTMLInputElement | undefined = $state()
  $effect(() => {
    firstHeader?.focus()
  })
</script>

<Dialog open label={title} {title} class="table-builder" onclose={oncancel}>
  <div class="table-grid" bind:this={grid}>
    <table>
      <thead>
        <tr>
          {#each header as h, c (c)}
            <th>
              <div class="col-controls">
                <div class="align-group" role="group" aria-label={`Alignment for column ${c + 1}`}>
                  {#each ALIGNMENTS as a (a.value ?? 'none')}
                    <button
                      type="button"
                      class="align"
                      data-col={c}
                      data-align={a.value ?? 'none'}
                      aria-pressed={align[c] === a.value ? 'true' : 'false'}
                      aria-label={a.title}
                      title={a.title}
                      onclick={() => setAlign(c, a.value)}
                    ><svg width="14" height="10" viewBox="0 0 14 10" aria-hidden="true"
                      ><path d={a.path} stroke="currentColor" stroke-width="1.4" stroke-dasharray={a.dashed ? '2 2' : undefined} /></svg
                    ></button>
                  {/each}
                </div>
                <button type="button" class="remove-col" data-col={c} title="Remove column"
                  aria-label={`Remove column ${c + 1}`} disabled={header.length <= 1}
                  onclick={() => removeColumn(c)}>✕</button>
              </div>
              {#if c === 0}
                <input class="th-cell" bind:this={firstHeader} value={h} aria-label={`Header ${c + 1}`}
                  oninput={(e) => (header[c] = (e.currentTarget as HTMLInputElement).value)} />
              {:else}
                <input class="th-cell" value={h} aria-label={`Header ${c + 1}`}
                  oninput={(e) => (header[c] = (e.currentTarget as HTMLInputElement).value)} />
              {/if}
            </th>
          {/each}
          <th class="row-controls"></th>
        </tr>
      </thead>
      <tbody>
        {#each rows as row, r (r)}
          <tr>
            {#each row as cell, c (c)}
              <td>
                <input class="td-cell" data-row={r} data-col={c} value={cell}
                  style:text-align={align[c] ?? undefined}
                  aria-label={`Row ${r + 1}, column ${c + 1}`}
                  oninput={(e) => (rows[r][c] = (e.currentTarget as HTMLInputElement).value)}
                  onkeydown={(e) => onCellKey(e, r, c)} />
              </td>
            {/each}
            <td class="row-controls">
              <button type="button" class="remove-row" data-row={r} title="Remove row" aria-label={`Remove row ${r + 1}`}
                onclick={() => removeRow(r)}>✕</button>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>

  <div class="table-actions">
    <button type="button" onclick={addRow}>Add Row</button>
    <button type="button" onclick={addColumn}>Add Column</button>
    <button type="button" class="paste-toggle" aria-expanded={importOpen} onclick={() => (importOpen = !importOpen)}>
      {importOpen ? 'Hide Paste Box' : 'Paste Data…'}
    </button>
  </div>
  <p class="dialog-hint table-hint">Return moves to the next row. The buttons above each column set its alignment.</p>

  {#if importOpen}
    <section class="table-import">
      <label for="table-import">Paste data</label>
      <textarea id="table-import" rows="4" aria-invalid={importError ? 'true' : undefined} oninput={onImport}></textarea>
      {#if importError}
        <p class="field-error" role="alert">{importError}</p>
      {/if}
      <p class="dialog-hint">Comma- or tab-separated, with a header row. It replaces the table above.</p>
    </section>
  {/if}

  {#snippet footer()}
    <button onclick={oncancel}>Cancel</button>
    <button class="primary" disabled={empty} onclick={commit}>
      {initial ? 'Update' : 'Insert'}
    </button>
  {/snippet}
</Dialog>
