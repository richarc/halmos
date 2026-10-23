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
import { offlineLoader, prepareSpec } from './charts'

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

describe('prepareSpec', () => {
  it('turns delimited text into rows, wherever a spec keeps data', () => {
    // Vega reads CSV by generating code, which the app page's policy forbids.
    const out = prepareSpec({
      data: { values: 'a,b\n1,x\n2,y', format: { type: 'csv' } },
      layer: [{ data: { values: 'a\tb\n3\tz', format: { type: 'tsv' } } }],
      datasets: { semi: 'a;b\n4;w' },
      vconcat: [{ data: { values: 'a|b\n5|v', format: { type: 'dsv', delimiter: '|' } } }],
    }) as Record<string, any>
    expect(out.data).toEqual({ values: [{ a: '1', b: 'x' }, { a: '2', b: 'y' }], format: { type: 'json', parse: 'auto' } })
    expect(out.layer[0].data.values).toEqual([{ a: '3', b: 'z' }])
    expect(out.vconcat[0].data).toEqual({ values: [{ a: '5', b: 'v' }], format: { type: 'json', parse: 'auto' } })
    // A named dataset has no format of its own; it is only converted when a
    // data object names it with one, so a plain string is left as written.
    expect(out.datasets.semi).toBe('a;b\n4;w')
  })

  it('keeps an explicit parse and Vega’s own data arrays', () => {
    const out = prepareSpec({
      data: [{ name: 't', values: 'n\n7', format: { type: 'csv', parse: { n: 'number' } } }],
    }) as Record<string, any>
    expect(out.data[0]).toEqual({ name: 't', values: [{ n: '7' }], format: { type: 'json', parse: { n: 'number' } } })
  })

  it('drops the embed options a spec carries, and nothing else of its metadata', () => {
    // vega-embed lets a spec's usermeta.embedOptions override the caller's:
    // a document could turn the interpreter off or change number formatting
    // for every chart after it.
    const out = prepareSpec({ mark: 'bar', usermeta: { embedOptions: { ast: false }, note: 'kept' } }) as Record<string, any>
    expect(out.usermeta).toEqual({ note: 'kept' })
  })
})

describe('charts under the page’s policy', () => {
  it('render with code generation forbidden, as the app page forbids it', async () => {
    const { compile } = await import('vega-lite')
    const { expressionInterpreter } = await import('vega-interpreter')
    const spec = prepareSpec({
      data: { values: 'a,c\n1,x\n2,y\n3,x', format: { type: 'csv' } },
      transform: [
        { calculate: "datum.a * 2 + (datum.c == 'x' ? 1 : 0)", as: 'b' },
        { filter: 'datum.b > 2' },
      ],
      params: [{ name: 'pick', select: { type: 'point', fields: ['c'] } }],
      mark: 'bar',
      encoding: {
        x: { field: 'a', type: 'ordinal' },
        y: { field: 'b', type: 'quantitative', axis: { labelExpr: "format(datum.value, '.1f')" } },
        color: { condition: { param: 'pick', field: 'c' }, value: 'grey' },
      },
    })
    const compiled = compile(spec as never).spec
    const realFunction = globalThis.Function
    const realEval = globalThis.eval
    const refuse = () => {
      throw new EvalError('code generation from strings is forbidden')
    }
    globalThis.Function = new Proxy(realFunction, { apply: refuse, construct: refuse })
    globalThis.eval = refuse as never
    try {
      const view = new vega.View(vega.parse(compiled, undefined, { ast: true }), {
        renderer: 'none',
        loader: offlineLoader,
        expr: expressionInterpreter,
      } as never)
      await view.runAsync()
      expect(view.data('data_0').map((d: { b: number }) => d.b)).toEqual([3, 4, 7])
      view.finalize()
    } finally {
      globalThis.Function = realFunction
      globalThis.eval = realEval
    }
  })
})
