<script lang="ts">
  import Dialog from './Dialog.svelte'
  import { DocumentService } from '../bindings/hermes'
  import { loadAcknowledgements, type Acknowledgements } from './lib/acknowledgements'

  interface Props {
    open: boolean
    onclose: () => void
  }

  const { open, onclose }: Props = $props()

  // undefined while loading, null when the build has no notices (dev server).
  let notices: Acknowledgements | null | undefined = $state(undefined)
  let error = $state('')

  // Loaded the first time the page opens, then kept: the notices do not
  // change while the app runs.
  $effect(() => {
    if (open && notices === undefined) {
      void loadAcknowledgements().then((n) => (notices = n))
    }
  })

  async function showFiles() {
    error = ''
    try {
      await DocumentService.ShowLicences()
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
    }
  }
</script>

<Dialog {open} label="Acknowledgements" title="Acknowledgements" {onclose} class="acknowledgements">
  <p class="dialog-hint">
    Halmos Editor is built on the open-source software listed here. Each is used under the licence shown, whose full
    text is below its name.
  </p>
  {#if notices === undefined}
    <p class="dialog-hint">Loading…</p>
  {:else if notices === null}
    <p>The licence notices are only available in the packaged app.</p>
  {:else}
    <ul class="ack-list">
      {#each notices.entries as e (`${e.name}@${e.version}`)}
        <li>
          <details>
            <summary>
              <span class="ack-name">{e.name}</span>
              <span class="ack-version">{e.version}</span>
              <span class="ack-licence">{e.licence}</span>
            </summary>
            {#if e.election}<p>{e.election}</p>{/if}
            {#if e.source}<p>{e.source}</p>{/if}
            {#each e.copyright as line, i (i)}<p class="ack-copyright">{line}</p>{/each}
            <pre class="ack-text">{e.text}</pre>
            {#if e.extraText}<pre class="ack-text">{e.extraText}</pre>{/if}
          </details>
        </li>
      {/each}
    </ul>
  {/if}
  {#if error}<p class="dialog-hint">{error}</p>{/if}
  {#snippet footer()}
    <button class="dialog-alt" onclick={showFiles}>Show Licence Files in Finder</button>
    <button class="primary" onclick={onclose}>Close</button>
  {/snippet}
</Dialog>
