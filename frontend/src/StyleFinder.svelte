<script lang="ts">
  // Format → Citation Style → Find a Style…: every style in the CSL
  // repository, searched in Go over the portal's index (StyleService), with
  // a sample of the selected one. Use Style installs it (with its parent,
  // for a dependent style) and hands the id to the parent, which writes
  // `csl:`. Choose a file… is the old Other Style File…, for styles not in
  // the repository; the parent runs it.
  import { tick } from 'svelte'
  import { Browser } from '@wailsio/runtime'
  import Dialog from './Dialog.svelte'
  import { StyleService } from '../bindings/hermes'
  import type { StyleSummary } from '../bindings/hermes/models'
  import { formatSample } from './lib/styleSample'

  interface Props {
    open: boolean
    onclose: () => void
    /** The style is installed; write `csl: <id>`. */
    onuse: (id: string) => void
    onchoosefile: () => void
  }

  const { open, onclose, onuse, onchoosefile }: Props = $props()

  const FORMATS: { value: string; label: string }[] = [
    { value: '', label: 'All formats' },
    { value: 'author-date', label: 'Author-date' },
    { value: 'numeric', label: 'Numeric' },
    { value: 'note', label: 'Note' },
    { value: 'author', label: 'Author' },
    { value: 'label', label: 'Label' },
  ]
  const formatLabel = (f: string) => FORMATS.find((x) => x.value === f && f !== '')?.label ?? ''
  const SAMPLE_DELAY_MS = 300

  let status = $state<'loading' | 'ready' | 'offline' | 'busy'>('loading')
  let fields = $state.raw<string[]>([])
  let updates = $state(0)
  let query = $state('')
  let field = $state('')
  let format = $state('')
  let results = $state.raw<StyleSummary[]>([])
  let total = $state(0)
  let active = $state(0)
  let working = $state(false)
  let problem = $state('')
  let sample = $state<{ id: string; citation: string; reference: string; error: boolean } | null>(null)
  let input: HTMLInputElement | undefined = $state()
  let list: HTMLElement | undefined = $state()

  // Each opening and each search is numbered, so a slow answer never
  // replaces a newer one.
  let openGen = 0
  let searchGen = 0

  const selected = $derived<StyleSummary | undefined>(results[active])

  $effect(() => {
    if (!open) return
    const gen = ++openGen
    status = 'loading'
    query = ''
    field = ''
    format = ''
    results = []
    total = 0
    active = 0
    problem = ''
    sample = null
    void tick().then(() => input?.focus())
    void load(gen)
  })

  async function load(gen: number) {
    const st = await StyleService.LoadIndex().catch(() => ({ ready: false, error: 'offline', fields: [], updates: 0 }))
    if (gen !== openGen) return
    fields = st.fields ?? []
    updates = st.updates
    if (st.ready) {
      status = 'ready'
      await search()
      return
    }
    status = st.error === 'busy' ? 'busy' : 'offline'
    const installed = (await StyleService.Installed().catch(() => null)) ?? []
    if (gen !== openGen) return
    results = installed
    total = installed.length
  }

  async function search() {
    if (status !== 'ready') return
    const gen = ++searchGen
    const r = await StyleService.Search(query, field, format).catch(() => null)
    if (gen !== searchGen || !r) return
    results = r.styles ?? []
    total = r.total
    active = 0
  }

  function onInput(e: Event) {
    query = (e.currentTarget as HTMLInputElement).value
    void search()
  }

  // The sample waits for the selection to settle, so arrowing down the list
  // does not download every style on the way.
  $effect(() => {
    const st = selected
    if (!open || !st) return
    const id = st.id
    if (sample?.id === id) return
    const timer = setTimeout(async () => {
      const text = await StyleService.PreviewStyle(id).catch(() => null)
      if (selected?.id !== id) return
      let next = { id, citation: '', reference: '', error: true }
      if (text?.xml) {
        try {
          next = { id, ...(await formatSample(text.xml)), error: false }
        } catch {
          // Shown as "No sample" below.
        }
      }
      if (selected?.id === id) sample = next
    }, SAMPLE_DELAY_MS)
    return () => clearTimeout(timer)
  })

  // Keep the highlighted row in view. jsdom has no scrollIntoView.
  $effect(() => {
    const row = list?.querySelector<HTMLElement>(`#style-option-${active}`)
    if (row && typeof row.scrollIntoView === 'function') row.scrollIntoView({ block: 'nearest' })
  })

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (results.length) active = Math.min(active + 1, results.length - 1)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      active = Math.max(active - 1, 0)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      void use()
    }
  }

  async function use() {
    const st = selected
    if (!st || working) return
    working = true
    problem = ''
    const res = await StyleService.InstallStyle(st.id).catch(() => null)
    working = false
    if (!res || res.error) {
      problem = `Couldn't install ${res?.title || st.title}.`
      return
    }
    onuse(st.id)
  }

  async function updateAll() {
    if (working) return
    working = true
    problem = ''
    const res = await StyleService.UpdateAll().catch(() => null)
    working = false
    if (!res || res.error) problem = `Couldn't update ${res?.title || 'the installed styles'}.`
    await load(openGen)
  }

  function openCSL(e: MouseEvent) {
    e.preventDefault()
    void Browser.OpenURL('https://citationstyles.org/')
  }
</script>

<Dialog {open} label="Find a style" class="style-finder" {onclose}>
  <h2 class="dialog-title">Find a style</h2>
  <div class="style-controls">
    <input
      bind:this={input}
      type="search"
      aria-label="Journal or style name"
      placeholder="Journal name or abbreviation"
      autocomplete="off"
      spellcheck="false"
      role="combobox"
      aria-expanded="true"
      aria-controls="style-list"
      aria-activedescendant={selected ? `style-option-${active}` : undefined}
      value={query}
      disabled={status !== 'ready'}
      oninput={onInput}
      onkeydown={onKeydown}
    />
    <select
      name="field"
      aria-label="Field"
      value={field}
      disabled={status !== 'ready'}
      onchange={(e) => {
        field = (e.currentTarget as HTMLSelectElement).value
        void search()
      }}
    >
      <option value="">All fields</option>
      {#each fields as f (f)}
        <option value={f}>{f}</option>
      {/each}
    </select>
    <select
      name="format"
      aria-label="Format"
      value={format}
      disabled={status !== 'ready'}
      onchange={(e) => {
        format = (e.currentTarget as HTMLSelectElement).value
        void search()
      }}
    >
      {#each FORMATS as f (f.value)}
        <option value={f.value}>{f.label}</option>
      {/each}
    </select>
  </div>

  {#if status === 'loading'}
    <p class="dialog-hint">Loading styles…</p>
  {:else if status === 'offline'}
    <p class="dialog-hint">Halmos can't reach the style list. Installed styles and Choose a file… still work.</p>
  {:else if status === 'busy'}
    <p class="dialog-hint">The style list is busy; try again in a minute.</p>
  {/if}
  {#if status === 'ready' && updates > 0}
    <p class="style-updates">
      Updates for {updates} installed {updates === 1 ? 'style' : 'styles'}
      <button type="button" disabled={working} onclick={() => void updateAll()}>Update All</button>
    </p>
  {/if}

  <div class="style-layout">
    <div class="style-results">
      <ul id="style-list" class="style-list" role="listbox" aria-label="Styles" bind:this={list}>
        {#each results as st, i (st.id)}
          <!-- svelte-ignore a11y_click_events_have_key_events -- the search field owns the keyboard: arrows move, Return uses -->
          <li
            id="style-option-{i}"
            class="style-row"
            role="option"
            aria-selected={i === active}
            onmousedown={(e) => e.preventDefault()}
            onclick={() => (active = i)}
            ondblclick={() => {
              active = i
              void use()
            }}
          >
            <span class="style-title">{st.title}</span>
            {#if st.titleShort && st.titleShort !== st.title}<span class="style-short">{st.titleShort}</span>{/if}
            <span class="style-meta">
              {formatLabel(st.format)}{#if st.installed}{st.format ? ' · ' : ''}Installed{/if}
            </span>
          </li>
        {/each}
      </ul>
      {#if status === 'ready' && results.length === 0}
        <p class="dialog-hint">No styles match.</p>
      {/if}
      {#if total > results.length}
        <p class="dialog-hint">Showing {results.length} of {total} — type more to narrow it</p>
      {/if}
    </div>

    <div class="style-detail" aria-live="polite">
      {#if selected}
        <h3 class="style-detail-title">{selected.title}</h3>
        {#if selected.titleShort}<p class="dialog-hint">{selected.titleShort}</p>{/if}
        <p class="dialog-hint">
          {[formatLabel(selected.format), (selected.fields ?? []).join(', ')].filter(Boolean).join(' · ')}
        </p>
        {#if selected.parent}
          <p class="dialog-hint">Uses the formatting of {selected.parentTitle || selected.parent}</p>
        {/if}
        <div class="style-sample">
          {#if sample?.id === selected.id && !sample.error}
            <!-- citeproc's output: it escapes any text the style supplies. -->
            <p class="style-sample-citation">{@html sample.citation}</p>
            <div class="style-sample-reference">{@html sample.reference}</div>
          {:else if sample?.id === selected.id}
            <p class="dialog-hint">No sample for this style.</p>
          {:else}
            <p class="dialog-hint">Loading sample…</p>
          {/if}
        </div>
      {/if}
      {#if problem}<p class="style-problem" role="alert">{problem}</p>{/if}
    </div>
  </div>

  <p class="style-attribution dialog-hint">
    <!-- prettier-ignore -->
    Styles from the CSL project (<a href="https://citationstyles.org/" onclick={openCSL}>citationstyles.org</a>), shared under CC BY-SA 3.0
  </p>

  {#snippet footer()}
    <button class="dialog-alt" onclick={onchoosefile}>Choose a file…</button>
    <button onclick={onclose}>Cancel</button>
    <button class="primary" disabled={!selected || working} onclick={() => void use()}>
      {selected?.update ? 'Update' : 'Use Style'}
    </button>
  {/snippet}
</Dialog>

<style>
  :global(dialog.style-finder) {
    width: min(52rem, 92vw);
    max-width: min(52rem, 92vw);
  }
  .style-controls {
    display: flex;
    gap: 8px;
    margin: 8px 0 12px;
  }
  .style-controls input {
    flex: 1;
    min-width: 0;
  }
  .style-updates {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
  }
  .style-layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 16px;
    min-height: 320px;
  }
  .style-list {
    list-style: none;
    padding: 4px;
    margin: 0;
    height: 320px;
    overflow-y: auto;
    border: 1px solid var(--border);
    border-radius: 6px;
  }
  .style-row {
    display: flex;
    align-items: baseline;
    gap: 8px;
    padding: 4px 8px;
    border-radius: 4px;
    cursor: default;
  }
  .style-row[aria-selected='true'] {
    background: var(--accent);
    color: var(--on-accent);
  }
  .style-title {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .style-short,
  .style-meta {
    flex: none;
    font-size: 11px;
    opacity: 0.75;
  }
  .style-detail-title {
    font-size: 14px;
    font-weight: 600;
    margin: 0 0 4px;
  }
  .style-sample {
    margin-top: 12px;
    padding: 12px;
    background: var(--panel);
    border-radius: 6px;
  }
  .style-sample-citation {
    margin-bottom: 8px;
  }
  .style-problem {
    margin-top: 12px;
    color: var(--cite-error-fg);
  }
  .style-attribution {
    margin-top: 12px;
  }
  .style-attribution a {
    color: var(--accent);
  }
</style>
