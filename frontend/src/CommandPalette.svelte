<script lang="ts">
  // The command palette (⇧⌘P): a search field over a flat list of the menu's
  // commands. Go lists them each time it opens (CommandService.Commands), so
  // ticks and recents are current; lib/commandPalette.ts decides which match
  // and in what order. The parent owns `open`, runs the chosen id, and puts
  // the focus back — this only reports Esc (onclose) and a pick (onrun).
  import { tick } from 'svelte'
  import { CommandService } from '../bindings/hermes'
  import type { Command, CommandList } from '../bindings/hermes/models'
  import { rankCommands, formatAccelerator, type Match } from './lib/commandPalette'

  interface Props {
    open: boolean
    /** The welcome screen: commands that need a document are left out. */
    welcome: boolean
    onclose: () => void
    onrun: (id: string) => void
    /** Where the list comes from; injectable for tests. */
    load?: () => Promise<CommandList>
  }

  const { open, welcome, onclose, onrun, load = () => CommandService.Commands() }: Props = $props()

  let query = $state('')
  let active = $state(0)
  let commands = $state.raw<Command[]>([])
  let recent = $state.raw<string[]>([])
  let input: HTMLInputElement | undefined = $state()
  let list: HTMLElement | undefined = $state()
  // Each opening reads the list afresh; a slow answer from an earlier
  // opening must not replace a newer one.
  let generation = 0

  const matches = $derived<Match[]>(rankCommands(commands, query, recent, { welcome }))

  $effect(() => {
    if (!open) return
    const gen = ++generation
    query = ''
    active = 0
    commands = []
    recent = []
    void tick().then(() => input?.focus())
    load().then(
      (l) => {
        if (gen !== generation) return
        commands = l.commands ?? []
        recent = l.recent ?? []
      },
      (err) => console.warn('Commands:', err),
    )
  })

  // A new query starts at the best match.
  function onInput(e: Event) {
    query = (e.currentTarget as HTMLInputElement).value
    active = 0
  }

  // Keep the highlighted row in view as the arrows move it past the edge.
  // jsdom has no scrollIntoView.
  $effect(() => {
    const row = list?.querySelector<HTMLElement>(`#palette-option-${active}`)
    if (row && typeof row.scrollIntoView === 'function') row.scrollIntoView({ block: 'nearest' })
  })

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault()
      onclose()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (matches.length) active = Math.min(active + 1, matches.length - 1)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      active = Math.max(active - 1, 0)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const m = matches[active]
      if (m) onrun(m.command.id)
    } else if (e.key === 'Tab') {
      // The palette is not a modal element, so Tab would walk into the
      // document behind it.
      e.preventDefault()
    }
  }

  // The row's text split at the matched spans, for bold.
  function segments(m: Match): { text: string; bold: boolean }[] {
    const out: { text: string; bold: boolean }[] = []
    let at = 0
    for (const [from, to] of m.ranges) {
      if (from > at) out.push({ text: m.text.slice(at, from), bold: false })
      out.push({ text: m.text.slice(from, to), bold: true })
      at = to
    }
    if (at < m.text.length) out.push({ text: m.text.slice(at), bold: false })
    return out
  }
</script>

{#if open}
  <div class="palette-layer">
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -- the scrim is a pointer target only; Esc in the field is the keyboard route -->
    <div class="palette-scrim" onclick={onclose}></div>
    <div class="palette" role="dialog" aria-label="Command palette">
      <input
        bind:this={input}
        class="palette-input"
        type="text"
        role="combobox"
        aria-expanded="true"
        aria-controls="palette-list"
        aria-autocomplete="list"
        aria-activedescendant={matches.length ? `palette-option-${active}` : undefined}
        aria-label="Command"
        placeholder="Type a command"
        autocomplete="off"
        spellcheck="false"
        value={query}
        oninput={onInput}
        onkeydown={onKeydown}
      />
      <ul id="palette-list" class="palette-list" role="listbox" aria-label="Commands" bind:this={list}>
        {#each matches as m, i (m.command.id)}
          <!-- svelte-ignore a11y_click_events_have_key_events -- the field owns the keyboard: arrows move, Return runs -->
          <li
            id="palette-option-{i}"
            class="palette-row"
            role="option"
            aria-selected={i === active}
            onmousedown={(e) => e.preventDefault()}
            onmousemove={() => (active = i)}
            onclick={() => onrun(m.command.id)}
          >
            <span class="palette-tick" aria-hidden={!m.command.checked}>{m.command.checked ? '✓' : ''}</span>
            <span class="palette-text">{#each segments(m) as s, j (j)}{#if s.bold}<b>{s.text}</b>{:else}{s.text}{/if}{/each}</span>
            {#if m.command.detail}<span class="palette-detail">{m.command.detail}</span>{/if}
            {#if m.command.accelerator}<kbd>{formatAccelerator(m.command.accelerator)}</kbd>{/if}
          </li>
        {/each}
      </ul>
      {#if commands.length > 0 && matches.length === 0}
        <p class="palette-empty">No matching commands</p>
      {/if}
    </div>
  </div>
{/if}
