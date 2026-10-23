import type { parseBib } from './bibliography'

export type ParsedBib = ReturnType<typeof parseBib>

/** The part of a Web Worker the parser uses, so tests can stand one in. */
export interface BibWorker {
  onmessage: ((ev: { data: BibReply }) => void) | null
  onerror: ((ev: Event) => void) | null
  postMessage(msg: { id: number; text: string }): void
  terminate(): void
}

export type BibReply = { ready: true } | { id: number; result: ParsedBib } | { id: number; error: string }

/**
 * How long the worker has to say it has loaded before parsing moves to the
 * main thread. A worker that fails to load fires `error`; this covers one
 * that never answers at all. Not a limit on parsing: a large library takes
 * longer than this, and the clock stops once the worker is ready.
 */
export const BIB_WORKER_READY_MS = 5000

/**
 * Parses .bib text off the main thread. A 2,000-entry library takes about
 * 1.5 s to parse, and Zotero's "Keep updated" export rewrites the file while
 * the author is typing, so parsing on the main thread froze the editor.
 *
 * The last text parsed is cached, so a style change, or a reload that reads
 * the same text, does not parse again. Each call gets its own copy of the
 * entries, because the formatter keeps the array it is given.
 *
 * If the worker cannot be started or fails, parsing falls back to the main
 * thread for good: slower, never wrong.
 */
export function createBibParser(spawn: () => BibWorker | null = spawnBibWorker) {
  let worker: BibWorker | null | undefined // undefined: not started yet
  let nextId = 0
  const pending = new Map<number, { text: string; resolve: (r: ParsedBib) => void; reject: (e: unknown) => void }>()
  let cached: { text: string; result: Promise<ParsedBib> } | null = null

  // Imported only when needed, so the parser stays out of the startup
  // bundle; the worker carries its own copy.
  async function onMainThread(text: string): Promise<ParsedBib> {
    const { parseBib } = await import('./bibliography')
    return parseBib(text)
  }

  function abandonWorker() {
    worker?.terminate()
    worker = null
    for (const [id, p] of pending) {
      pending.delete(id)
      onMainThread(p.text).then(p.resolve, p.reject)
    }
  }

  function start(): BibWorker | null {
    if (worker !== undefined) return worker
    try {
      worker = spawn()
    } catch {
      worker = null
    }
    if (worker) {
      const readyTimer = setTimeout(() => abandonWorker(), BIB_WORKER_READY_MS)
      worker.onmessage = ({ data }) => {
        if ('ready' in data) {
          clearTimeout(readyTimer)
          return
        }
        const p = pending.get(data.id)
        if (!p) return
        pending.delete(data.id)
        if ('result' in data) p.resolve(data.result)
        else onMainThread(p.text).then(p.resolve, p.reject)
      }
      worker.onerror = () => {
        clearTimeout(readyTimer)
        abandonWorker()
      }
    }
    return worker
  }

  function inWorker(text: string): Promise<ParsedBib> {
    const w = start()
    if (!w) return onMainThread(text)
    return new Promise((resolve, reject) => {
      const id = ++nextId
      pending.set(id, { text, resolve, reject })
      w.postMessage({ id, text })
    })
  }

  return {
    async parse(text: string): Promise<ParsedBib> {
      if (cached?.text !== text) {
        const result = inWorker(text)
        const entry = { text, result }
        cached = entry
        // A failed parse is not kept, so the next read tries again.
        result.catch(() => {
          if (cached === entry) cached = null
        })
      }
      const { entries, warnings } = await cached.result
      return { entries: structuredClone(entries), warnings: [...warnings] }
    },
  }
}

function spawnBibWorker(): BibWorker | null {
  if (typeof Worker === 'undefined') return null
  // A separate file from 'self', which the page's Content-Security-Policy
  // allows (worker-src falls back to script-src). Not ?worker&inline: that
  // would be a blob: URL, which the policy refuses.
  return new Worker(new URL('./bibWorker.ts', import.meta.url), { type: 'module' }) as unknown as BibWorker
}
