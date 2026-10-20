<script lang="ts" module>
  /** Where the connect dialog is: asking, showing the code, connected, or
      ended without a connection. */
  export type ConnectState =
    | { kind: 'ask' }
    | { kind: 'starting' }
    | { kind: 'waiting'; code: string; url: string }
    | { kind: 'connected'; email: string }
    | { kind: 'failed'; message: string }
</script>

<script lang="ts">
  import Dialog from './Dialog.svelte'

  interface Props {
    state: ConnectState | null
    /** What the connection is for: an export names it, Account… does not. */
    purpose: 'docx' | 'latex' | null
    onconnect: () => void
    onreopen: (url: string) => void
    oncancel: () => void
    ondone: () => void
  }

  const { state, purpose, onconnect, onreopen, oncancel, ondone }: Props = $props()

  const intro = $derived(
    purpose === 'docx'
      ? 'Export to Word uses your Halmos account. Connect this Mac?'
      : purpose === 'latex'
        ? 'Export to LaTeX uses your Halmos account. Connect this Mac?'
        : 'Connect this Mac to your Halmos account?',
  )
</script>

<Dialog open={state !== null} label="Connect to Halmos" title="Connect to Halmos" onclose={oncancel}>
  {#if state?.kind === 'ask'}
    <p>{intro}</p>
    <p class="dialog-hint">Your browser opens halmoseditor.com, where you sign in and approve this Mac.</p>
  {:else if state?.kind === 'starting'}
    <p class="dialog-hint">Asking halmoseditor.com for a code…</p>
  {:else if state?.kind === 'waiting'}
    <p>Your browser has opened halmoseditor.com. Check the code matches, then approve.</p>
    <p class="connect-code" aria-label="Connection code">{state.code}</p>
    <p class="dialog-hint">Waiting for approval…</p>
  {:else if state?.kind === 'connected'}
    <p>Connected as {state.email || 'your Halmos account'}.</p>
    <p class="dialog-hint">A confirmation email was sent.</p>
  {:else if state?.kind === 'failed'}
    <p>Not connected. {state.message}</p>
  {/if}
  {#snippet footer()}
    {#if state?.kind === 'ask'}
      <button onclick={oncancel}>Cancel</button>
      <button class="primary" onclick={onconnect}>Connect</button>
    {:else if state?.kind === 'starting'}
      <button onclick={oncancel}>Cancel</button>
    {:else if state?.kind === 'waiting'}
      <button class="dialog-alt" onclick={() => onreopen(state.url)}>Open the Page Again</button>
      <button onclick={oncancel}>Cancel</button>
    {:else if state?.kind === 'connected'}
      <button class="primary" onclick={ondone}>Done</button>
    {:else if state?.kind === 'failed'}
      <button onclick={oncancel}>Cancel</button>
      <button class="primary" onclick={onconnect}>Try Again</button>
    {/if}
  {/snippet}
</Dialog>
