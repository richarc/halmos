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

<Dialog {open} label="Unknown citations" {onclose} class="unknown-citations">
  <ul class="unknown-list">
    {#each items as item, i (i)}
      <li>
        <button class="link-button" onclick={() => onjump(item.line)}>
          <span class="unknown-key">[@{item.key}]</span>
          <span class="unknown-line">line {item.line}</span>
        </button>
      </li>
    {/each}
  </ul>
  {#snippet footer()}
    <button onclick={onclose}>Close</button>
  {/snippet}
</Dialog>
