import { Events } from '@wailsio/runtime'

type EventName = keyof Events.CustomEvents

/** One handler per event Go sends (events.go), its payload typed by the
 * generated bindings. */
export type AppEventHandlers = { [E in EventName]?: (ev: Events.WailsEvent<E>) => void }

// The events that are commands: a menu item, the palette running one, a quit
// or close, a file from Finder. Each closes the palette first (beforeCommand),
// focus and selection restored, then does what it does from the menu. The
// palette's own toggle is not one, or it could never open.
function isCommand(name: string): boolean {
  if (name === 'menu:command-palette') return false
  return name.startsWith('menu:') || name === 'close:confirm' || name === 'file:open'
}

/** Subscribes every handler to its event, and returns a function that
 * unsubscribes them all. */
export function subscribeAppEvents(handlers: AppEventHandlers, opts: { beforeCommand: () => void }): () => void {
  const offs: (() => void)[] = []
  for (const name of Object.keys(handlers) as EventName[]) {
    const handle = handlers[name] as ((ev: Events.WailsEvent<typeof name>) => void) | undefined
    if (!handle) continue
    const command = isCommand(name)
    offs.push(
      Events.On(name, (ev) => {
        if (command) opts.beforeCommand()
        handle(ev)
      }),
    )
  }
  return () => offs.forEach((off) => off())
}
