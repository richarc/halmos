<script lang="ts">
  import Dialog from './Dialog.svelte'
  import { STYLE_CHOICES } from './lib/citations'
  import { STARTERS, withBibExtension, type StarterId } from './lib/documentTemplate'
  import { DocumentService } from '../bindings/hermes'

  /**
   * Where the new document's bibliography comes from. `same` is today's
   * behaviour and the default; `new` is created beside the document under
   * the given name; `existing` is a file the author already has, absolute.
   */
  export type BibliographyChoice =
    | { kind: 'same' }
    | { kind: 'new'; name: string }
    | { kind: 'existing'; path: string }

  interface Props {
    open: boolean
    onclose: () => void
    /**
     * The author pressed Continue… (or Create… with no bibliography); the
     * parent goes on to the save panel. `null` means no bibliography.
     */
    oncreate: (
      bibliography: BibliographyChoice | null,
      csl: string,
      start: { starter: StarterId; pageFurniture: boolean },
    ) => void
    /** The native open panel; injectable so tests need no Wails runtime. */
    chooseBibliography?: () => Promise<string>
  }

  const {
    open,
    onclose,
    oncreate,
    chooseBibliography = () => DocumentService.ChooseBibliography(),
  }: Props = $props()

  // Ticked by default: the flow exists for papers, and a scratch document
  // costs one click to opt out of. The style only matters when it is ticked.
  let withBibliography = $state(true)
  let csl = $state('apa')
  // What the document starts from, and whether it gets Export PDF's running
  // header and footer. The box follows the starter's default each time the
  // starter changes; the author can still change it after.
  let starter = $state<StarterId>('blank')
  let pageFurniture = $state(false)
  const starterHint = $derived(STARTERS.find((s) => s.id === starter)?.hint ?? '')

  function chooseStarter(id: StarterId) {
    starter = id
    pageFurniture = STARTERS.find((s) => s.id === id)?.furnitureByDefault ?? false
  }

  // Step two, shown only when a bibliography is wanted. A separate step
  // rather than three radios under the checkbox: the first dialog stays the
  // one-decision screen it was, and the choice is skipped entirely for a
  // document without citations.
  let step = $state<'document' | 'bibliography'>('document')
  let kind = $state<BibliographyChoice['kind']>('same')
  let newName = $state('')
  let existingPath = $state('')

  // Reset for the next opening, so a choice made and then cancelled does not
  // silently carry into a later document.
  $effect(() => {
    if (open) {
      withBibliography = true
      csl = 'apa'
      starter = 'blank'
      pageFurniture = false
      step = 'document'
      kind = 'same'
      newName = ''
      existingPath = ''
    }
  })

  const canContinue = $derived(
    kind === 'same' ||
      (kind === 'new' && withBibExtension(newName) !== '') ||
      (kind === 'existing' && existingPath !== ''),
  )

  function create() {
    if (!withBibliography) {
      oncreate(null, csl, { starter, pageFurniture })
      return
    }
    step = 'bibliography'
  }

  function proceed() {
    if (!canContinue) return
    const start = { starter, pageFurniture }
    if (kind === 'new') oncreate({ kind, name: withBibExtension(newName) }, csl, start)
    else if (kind === 'existing') oncreate({ kind, path: existingPath }, csl, start)
    else oncreate({ kind: 'same' }, csl, start)
  }

  async function choose() {
    try {
      const picked = await chooseBibliography()
      if (picked) existingPath = picked
    } catch {
      // The panel failing to open leaves the choice as it was; the disabled
      // Continue… already says nothing has been chosen.
    }
  }
</script>

<Dialog {open} label="New document" {onclose}>
  {#if step === 'document'}
    <h2 class="dialog-title">New document</h2>
    <label class="style-row"
      >Start from
      <select
        name="starter"
        value={starter}
        onchange={(e) => chooseStarter((e.currentTarget as HTMLSelectElement).value as StarterId)}
      >
        {#each STARTERS as s (s.id)}
          <option value={s.id}>{s.label}</option>
        {/each}
      </select>
    </label>
    <p class="hint no-indent">{starterHint}</p>
    <label class="check-row">
      <input type="checkbox" name="page-furniture" bind:checked={pageFurniture} />
      Page header and footer
    </label>
    <p class="hint">The title at the top of each PDF page, 'Page 1 of 5' at the bottom.</p>
    <label class="check-row">
      <input type="checkbox" name="bibliography" bind:checked={withBibliography} />
      Include a bibliography
    </label>
    <p class="hint">
      Points the document at a <code>.bib</code> file so citations work from
      the first line. The next step chooses which.
    </p>
    {#if withBibliography}
      <label class="style-row"
        >Citation style
        <select name="csl" bind:value={csl}>
          {#each STYLE_CHOICES as c (c.id)}
            <option value={c.id}>{c.label}</option>
          {/each}
        </select>
      </label>
    {/if}
  {:else}
    <h2 class="dialog-title">Bibliography</h2>
    <label class="check-row">
      <input type="radio" name="bib-kind" value="same" bind:group={kind} />
      Same name as the document
    </label>
    <p class="hint">Creates <code>&lt;name&gt;.bib</code> beside the document.</p>
    <label class="check-row">
      <input type="radio" name="bib-kind" value="new" bind:group={kind} />
      A new file named
    </label>
    <div class="indent">
      <input
        type="text"
        bind:value={newName}
        placeholder="references"
        disabled={kind !== 'new'}
        aria-label="Bibliography file name"
      />
      <p class="hint no-indent">Created beside the document; <code>.bib</code> is added if missing.</p>
    </div>
    <label class="check-row">
      <input type="radio" name="bib-kind" value="existing" bind:group={kind} />
      An existing file
    </label>
    <div class="indent">
      <button type="button" disabled={kind !== 'existing'} onclick={() => void choose()}>Choose…</button>
      {#if existingPath}
        <p class="hint no-indent path">{existingPath}</p>
      {/if}
    </div>
  {/if}
  {#snippet footer()}
    {#if step === 'document'}
      <button onclick={onclose}>Cancel</button>
      <button class="primary" onclick={create}>Create…</button>
    {:else}
      <button onclick={() => (step = 'document')}>Back</button>
      <button class="primary" disabled={!canContinue} onclick={proceed}>Continue…</button>
    {/if}
  {/snippet}
</Dialog>

<style>
  .check-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .hint {
    margin: 4px 0 16px 24px;
    font-size: 12px;
    color: var(--muted);
  }
  .indent {
    margin: 6px 0 16px 24px;
  }
  .indent input[type='text'] {
    width: 100%;
  }
  .no-indent {
    margin-left: 0;
  }
  .path {
    word-break: break-all;
  }
  .style-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
  }
</style>
