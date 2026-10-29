<script lang="ts">
  import { TutorialService } from '../bindings/hermes'
  import type { TutorialResult } from '../bindings/hermes/models'
  import Dialog from './Dialog.svelte'

  // Help → Getting Started. Go gets the tutorial (from the portal, or the
  // copy bundled with the app) and writes it to a new folder; this asks
  // where, and hands the entry back for App to open through its usual
  // unsaved-changes guard. See tutorialservice.go.

  interface Props {
    open: boolean
    onclose: () => void
    onstarted: (result: TutorialResult) => void
  }

  const { open, onclose, onstarted }: Props = $props()

  let existing = $state('')
  let existingEntry = $state('')
  let folder = $state('')
  /** 'earlier' offers the existing tutorial; 'fresh' asks where to start. */
  let step = $state<'loading' | 'earlier' | 'fresh'>('loading')
  let busy = $state(false)
  let error = $state('')

  $effect(() => {
    if (!open) return
    step = 'loading'
    error = ''
    busy = false
    void TutorialService.State()
      .then((st) => {
        existing = st.existing
        existingEntry = st.existingEntry
        folder = st.suggested
        step = st.existing ? 'earlier' : 'fresh'
      })
      .catch((e) => {
        error = String(e)
        step = 'fresh'
      })
  })

  async function change() {
    try {
      const chosen = await TutorialService.ChooseLocation()
      if (chosen) folder = chosen
    } catch (e) {
      error = String(e)
    }
  }

  async function start() {
    if (busy || !folder) return
    busy = true
    error = ''
    try {
      const result = await TutorialService.Create(folder)
      onstarted(result)
    } catch (e) {
      error = `Could not write the tutorial: ${e instanceof Error ? e.message : String(e)}`
    } finally {
      busy = false
    }
  }

  function openEarlier() {
    onstarted({ entry: existingEntry, bundled: false, needsUpdate: false })
  }
</script>

<Dialog {open} label="Getting Started" title="Getting Started" onclose={() => !busy && onclose()} class="getting-started">
  {#if step === 'earlier'}
    <p>You started the tutorial before, in {existing}.</p>
  {:else if step === 'fresh'}
    <p>
      A short document that teaches Halmos by doing: equations, a chart, a citation, a table and
      cross-references. It goes in a folder of its own, with its bibliography and data.
    </p>
    <div class="tutorial-folder">
      <span class="tutorial-folder-label">Folder:</span>
      <span class="tutorial-folder-path" title={folder}>{folder}</span>
      <button type="button" disabled={busy} onclick={() => void change()}>Change…</button>
    </div>
    {#if busy}
      <p class="tutorial-status" role="status">Getting the tutorial…</p>
    {/if}
  {/if}
  {#if error}
    <p class="tutorial-error" role="alert">{error}</p>
  {/if}

  {#snippet footer()}
    <button disabled={busy} onclick={onclose}>Cancel</button>
    {#if step === 'earlier'}
      <button onclick={() => (step = 'fresh')}>Start Fresh</button>
      <button class="primary" onclick={openEarlier}>Open It</button>
    {:else}
      <button class="primary" disabled={busy || step !== 'fresh' || !folder} onclick={() => void start()}>Start</button>
    {/if}
  {/snippet}
</Dialog>

<style>
  .tutorial-folder {
    display: flex;
    align-items: center;
    gap: 0.5em;
    margin: 0.75em 0;
  }
  .tutorial-folder-label {
    color: var(--muted);
  }
  .tutorial-folder-path {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tutorial-status {
    color: var(--muted);
  }
  .tutorial-error {
    color: var(--cite-error-fg);
  }
</style>
