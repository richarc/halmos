// The Web Worker behind bibLoader.ts: parses .bib text off the main thread.
import { parseBib } from './bibliography'
import type { BibReply } from './bibLoader'

self.onmessage = (ev: MessageEvent<{ id: number; text: string }>) => {
  const { id, text } = ev.data
  let reply: BibReply
  try {
    reply = { id, result: parseBib(text) }
  } catch (err) {
    reply = { id, error: String(err) }
  }
  self.postMessage(reply)
}
