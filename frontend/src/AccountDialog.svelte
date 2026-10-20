<script lang="ts">
  import Dialog from './Dialog.svelte'
  import type { AccountInfo } from '../bindings/hermes/models'

  interface Props {
    open: boolean
    /** null while it is being read. */
    account: AccountInfo | null
    /** Shown in place of the details when the account could not be read. */
    problem: string
    onconnect: () => void
    onsignout: () => void
    onplans: (url: string) => void
    onclose: () => void
  }

  const { open, account, problem, onconnect, onsignout, onplans, onclose }: Props = $props()

  function seatLabel(a: AccountInfo): string {
    if (!a.seatSource) return 'No subscription'
    const source =
      a.seatSource === 'complimentary'
        ? 'Complimentary'
        : a.seatSource === 'personal'
          ? 'Personal plan'
          : a.seatSource === 'team'
            ? 'Team plan'
            : a.seatSource.charAt(0).toUpperCase() + a.seatSource.slice(1)
    return a.organisation && a.seatSource === 'team' ? `${source} · ${a.organisation}` : source
  }
</script>

<Dialog {open} label="Halmos account" title="Halmos account" {onclose}>
  {#if account === null}
    <p class="dialog-hint">Reading your account…</p>
  {:else if !account.signedIn}
    <p>Not connected. Word and LaTeX export use your Halmos account.</p>
  {:else}
    <dl class="account-details">
      {#if account.email}<dt>Signed in as</dt><dd>{account.email}</dd>{/if}
      {#if !problem}<dt>Subscription</dt><dd>{seatLabel(account)}</dd>{/if}
      <dt>This Mac</dt><dd>{account.deviceName}</dd>
    </dl>
    {#if problem}<p>{problem}</p>{/if}
    <p class="dialog-hint">
      Signing out forgets the connection on this Mac. To remove the Mac from your account, sign it out on
      halmoseditor.com.
    </p>
  {/if}
  {#snippet footer()}
    {#if account?.signedIn}
      <button class="dialog-alt" onclick={onsignout}>Sign Out</button>
      {#if !account.seatSource && !problem && account.pricingURL}
        <button onclick={() => onplans(account.pricingURL)}>See Plans</button>
      {/if}
      <button class="primary" onclick={onclose}>Done</button>
    {:else if account}
      <button onclick={onclose}>Cancel</button>
      <button class="primary" onclick={onconnect}>Connect</button>
    {:else}
      <button onclick={onclose}>Cancel</button>
    {/if}
  {/snippet}
</Dialog>
