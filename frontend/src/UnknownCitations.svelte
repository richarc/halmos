<script lang="ts">
  import Dialog from './Dialog.svelte'

  interface Props {
    open: boolean
    items: { key: string; line: number }[]
    onclose: () => void
    onjump: (line: number) => void
    title?: string
    hint?: string
    /** How an entry's key is shown. */
    display?: (key: string) => string
  }

  const {
    open,
    items,
    onclose,
    onjump,
    title = 'Unknown citations',
    hint = 'Not found in the bibliography. Click one to go to it.',
    display = (key) => `[@${key}]`,
  }: Props = $props()
</script>

<Dialog {open} label={title} {title} {onclose} class="unknown-citations">
  <p class="dialog-hint">{hint}</p>
  <ul class="unknown-list">
    {#each items as item, i (i)}
      <li>
        <button class="unknown-entry" onclick={() => onjump(item.line)}>
          <span class="unknown-key">{display(item.key)}</span>
          <span class="unknown-line">Line {item.line}</span>
        </button>
      </li>
    {/each}
  </ul>
  {#snippet footer()}
    <button class="primary" onclick={onclose}>Close</button>
  {/snippet}
</Dialog>
