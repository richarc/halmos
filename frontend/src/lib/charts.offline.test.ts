// @vitest-environment node
//
// A chart is document content, and a document can come from anyone. Vega
// fetches whatever a spec names: a data URL, a URL built from a signal, an
// image mark's url, a link's href. Charts in Halmos carry their values
// inline, so the loader charts run with refuses every one of these. This
// runs real Vega against a local server and counts what reaches it.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import * as vega from 'vega'
import { offlineLoader } from './charts'

let server: http.Server
let base = ''
const seen: string[] = []

beforeAll(async () => {
  server = http.createServer((req, res) => {
    seen.push(req.url ?? '')
    res.end('x\n1\n')
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(() => new Promise<void>((r) => server.close(() => r())))

function spec(): vega.Spec {
  return {
    data: [
      { name: 'a', url: `${base}/data`, format: { type: 'csv' } },
      { name: 'b', url: { signal: `'${base}/signal'` } },
    ],
    marks: [{ type: 'image', encode: { enter: { url: { value: `${base}/image` } } } }],
  }
}

async function run(loader?: vega.Loader) {
  seen.length = 0
  const view = new vega.View(vega.parse(spec()), { renderer: 'none', ...(loader ? { loader } : {}) })
  await view.runAsync().catch(() => {})
  await new Promise((r) => setTimeout(r, 200))
  await view.runAsync().catch(() => {})
  view.finalize()
  return [...seen]
}

describe('offlineLoader', () => {
  it('is needed: Vega’s own loader fetches what the spec names', async () => {
    expect(await run()).toEqual(expect.arrayContaining(['/data', '/signal']))
  })

  it('lets nothing a spec names reach the network', async () => {
    expect(await run(offlineLoader)).toEqual([])
  })

  it('refuses every way in with a message saying why', async () => {
    for (const call of [
      () => offlineLoader.load(`${base}/x`),
      () => offlineLoader.sanitize(`${base}/x`, { context: 'href' }),
      () => offlineLoader.http(`${base}/x`, {}),
      () => offlineLoader.file('/etc/hosts'),
    ]) {
      await expect(call()).rejects.toThrow(/inline/)
    }
  })
})
