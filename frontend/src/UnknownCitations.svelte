<script lang="ts">
  import Dialog from './Dialog.svelte'

  interface Props {
    open: boolean
    items: { key: string; line: number }[]
    onclose: () => void
    onjump: (line: number) => void
  }

  const { open, items, onclose, onjump }: Props = $props()
</script>

<Dialog {open} label="Unknown citations" title="Unknown citations" {onclose} class="unknown-citations">
  <p class="dialog-hint">Not found in the bibliography. Click one to go to it.</p>
  <ul class="unknown-list">
    {#each items as item, i (i)}
      <li>
        <button class="unknown-entry" onclick={() => onjump(item.line)}>
          <span class="unknown-key">[@{item.key}]</span>
          <span class="unknown-line">Line {item.line}</span>
        </button>
      </li>
    {/each}
  </ul>
  {#snippet footer()}
    <button class="primary" onclick={onclose}>Close</button>
  {/snippet}
</Dialog>
