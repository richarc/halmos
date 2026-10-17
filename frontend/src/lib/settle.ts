/**
 * Waits until the promise `current()` returns has settled and is still the
 * one it returns — so work that replaced it while waiting is waited for too —
 * or until `capMs` has passed, whichever is first. Rejection counts as
 * settled. `current` must return the same promise until the work is
 * replaced; a getter that makes a new one per call never counts as settled
 * and waits out the cap. Used by HTML export to wait for the preview's
 * hydrators.
 */
export async function waitForLatest(current: () => Promise<unknown>, capMs: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const cap = new Promise<'cap'>((r) => (timer = setTimeout(() => r('cap'), capMs)))
  try {
    for (;;) {
      const waited = current()
      const result = await Promise.race([waited.then(() => 'done', () => 'done'), cap])
      if (result === 'cap' || waited === current()) return
      // Yield a task before looking again, so the cap can fire even if
      // replacements keep settling within microtasks.
      await new Promise((r) => setTimeout(r, 0))
    }
  } finally {
    clearTimeout(timer)
  }
}
