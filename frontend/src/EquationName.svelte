<script lang="ts">
  import Dialog from './Dialog.svelte'

  export type NameError = 'empty' | 'invalid' | 'taken'

  interface Props {
    open: boolean
    /** Why the last name was refused; the dialog stays open showing it. */
    error: NameError | null
    oninsert: (name: string) => void
    oncancel: () => void
  }

  const { open, error, oninsert, oncancel }: Props = $props()

  const MESSAGES: Record<NameError, string> = {
    empty: 'Type a name.',
    invalid: 'Use letters, digits, - _ or . only, no spaces.',
    taken: 'Another equation already has that name.',
  }

  let name = $state('')
  let field: HTMLInputElement | undefined = $state()

  // A fresh field each time it opens, with the caret in it: the name is the
  // only thing asked, so typing should not need a click first.
  $effect(() => {
    if (!open) return
    name = ''
    field?.focus()
  })
</script>

<Dialog {open} label="Name this equation" title="Name this equation" onclose={oncancel}>
  <input
    bind:this={field}
    bind:value={name}
    type="text"
    class="equation-name"
    placeholder="bayes"
    aria-label="Equation name"
    aria-invalid={error ? 'true' : undefined}
    onkeydown={(e) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        oninsert(name)
      }
    }}
  />
  <p class="dialog-hint">Halmos writes {'{#eq:name}'} after the equation.</p>
  {#if error}<p class="field-error" role="alert">{MESSAGES[error]}</p>{/if}
  {#snippet footer()}
    <button onclick={oncancel}>Cancel</button>
    <button class="primary" onclick={() => oninsert(name)}>Insert</button>
  {/snippet}
</Dialog>

<style>
  .equation-name {
    width: 100%;
  }
  .equation-name[aria-invalid='true'] {
    border-color: var(--cite-error-fg);
  }
  .dialog-hint {
    margin-top: 4px;
  }
  .field-error {
    color: var(--cite-error-fg);
    margin-top: 4px;
  }
</style>
