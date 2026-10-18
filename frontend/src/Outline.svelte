<script lang="ts">
  import type { OutlineEntry } from './lib/outline'

  interface Props {
    entries: OutlineEntry[]
    onjump: (line: number) => void
  }

  const { entries, onjump }: Props = $props()
</script>

<!-- Shown and hidden from the toolbar's Outline button, ⌘⌥O and View →
     Outline, so the panel carries no arrow of its own. -->
<nav class="outline" aria-label="Document outline">
  <p class="outline-heading">Outline</p>
  {#if entries.length === 0}
    <p class="outline-empty">No headings yet.</p>
    <p class="outline-empty">Lines that start with # appear here.</p>
  {:else}
    <ul>
      {#each entries as e, i (i)}
        <li style="padding-left: {(e.level - 1) * 12}px">
          <!-- The title is the whole heading, for one the panel cuts short. -->
          <button
            class="outline-entry"
            class:outline-top={e.level === 1}
            onclick={() => onjump(e.line)}
            title={e.text || '(untitled)'}
          >
            {e.text || '(untitled)'}
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</nav>
