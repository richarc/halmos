// Type-only, so importing it costs nothing at runtime: vega and vega-lite are
// the largest thing Hermes bundles, and a document with no charts should never
// load them. embedChart imports the real module on first use.
import type vegaEmbedFn from 'vega-embed'
import type { Loader } from 'vega'

/** The slice of a Vega view the hydrator needs for cleanup. */
export interface ChartView {
  finalize(): void
}

export type EmbedFn = (el: HTMLElement, specText: string) => Promise<ChartView | null>

export interface ChartHydrator {
  hydrate(container: HTMLElement): Promise<void>
  destroy(): void
}

/**
 * Creates a hydrator that turns `.vega-lite-chart` placeholders into live
 * charts. It owns the chart lifecycle:
 * - caches the first rendered node per spec text and moves it (no re-embed)
 *   into the new DOM on later passes; extra occurrences of a duplicated spec
 *   are embedded fresh each pass;
 * - finalizes Vega views when their chart leaves the document (cache
 *   eviction, replaced duplicates, or `destroy()`), releasing listeners and
 *   timers;
 * - guards against overlapping passes: when a newer `hydrate` starts, the
 *   older pass abandons its remaining work.
 */
export function createChartHydrator(embed: EmbedFn = embedChart): ChartHydrator {
  const cache = new Map<string, HTMLElement>()
  const views = new Map<HTMLElement, ChartView>()
  let generation = 0

  function finalizeElement(el: HTMLElement): void {
    views.get(el)?.finalize()
    views.delete(el)
  }

  return {
    async hydrate(container: HTMLElement): Promise<void> {
      const gen = ++generation
      const placeholders = Array.from(
        container.querySelectorAll<HTMLElement>('.vega-lite-chart'),
      )
      const liveSpecs = new Set<string>()
      // Every node placed into the new DOM this pass — moved from cache or
      // freshly embedded. A cached node already in this set means the spec is
      // duplicated, so the extra occurrence embeds fresh instead of stealing.
      const placedThisPass = new Set<HTMLElement>()

      // Two phases. The synchronous one settles everything that needs no
      // embed — kept nodes and cache moves — and collects the rest; the
      // second embeds those all at once. Awaiting each embed in turn made a
      // paper with eight charts pay eight Vega embeds end to end on first
      // open and on every chart-width change.
      const toEmbed: { el: HTMLElement; specText: string }[] = []
      for (const el of placeholders) {
        const specText = el.dataset.spec ?? ''
        liveSpecs.add(specText)
        // A node this hydrator already finished, left in place by the
        // preview's reconciliation because its block did not change. Its
        // view is live and must count as placed, or the sweep below would
        // finalize it; nothing else to do.
        if (el.dataset.hydrated !== undefined) {
          placedThisPass.add(el)
          continue
        }
        const cached = cache.get(specText)

        if (cached && !placedThisPass.has(cached)) {
          // The cached node still carries the source line it was rendered at.
          // Editing above the chart moves it, so adopt the fresh placeholder's
          // line — otherwise scroll sync desynchronises from here down while
          // the chart itself still looks perfectly correct.
          if (el.dataset.sourceLine !== undefined) {
            cached.dataset.sourceLine = el.dataset.sourceLine
          } else {
            // A captioned chart's placeholder carries no anchor: it moved to
            // the wrapping <figure>. Since the caption is stripped out of
            // data-spec, that placeholder's spec text is identical to the
            // same chart uncaptioned — so a cached node from the uncaptioned
            // form can legitimately be adopted here, still carrying its old
            // line. Left on, the figure and its child are two anchors for one
            // source line.
            delete cached.dataset.sourceLine
          }
          el.replaceWith(cached)
          placedThisPass.add(cached)
          continue
        }

        // No cache entry, or the cached node is already placed this pass
        // (duplicated spec): embed fresh.
        toEmbed.push({ el, specText })
      }

      await Promise.all(
        toEmbed.map(async ({ el, specText }) => {
          const view = await embed(el, specText)
          if (gen !== generation) {
            // A newer pass started while we awaited: this element belongs to
            // a stale DOM. Release its view; the pass is abandoned below.
            view?.finalize()
            return
          }
          if (view) views.set(el, view)
          el.dataset.hydrated = ''
          placedThisPass.add(el)
          // Whichever copy of a duplicated spec finishes first is the one
          // later passes move; the other stays an extra, embedded fresh.
          if (!cache.has(specText)) cache.set(specText, el)
        }),
      )
      if (gen !== generation) return

      // Evict cache entries whose spec left the document.
      for (const [spec, el] of cache) {
        if (!liveSpecs.has(spec)) {
          cache.delete(spec)
          finalizeElement(el)
        }
      }

      // Finalize tracked views whose element was neither reused nor embedded
      // this pass (e.g. last pass's extra duplicate, or a stale pass's
      // leftovers) — they were discarded with the old DOM.
      for (const el of Array.from(views.keys())) {
        if (!placedThisPass.has(el)) {
          finalizeElement(el)
        }
      }
    },

    destroy(): void {
      for (const el of Array.from(views.keys())) {
        finalizeElement(el)
      }
      cache.clear()
    },
  }
}

const NO_URLS = 'Charts use inline data: put the values in the spec instead of a URL'
const refuse = () => Promise.reject(new Error(NO_URLS))

/**
 * The loader every chart runs with: it refuses everything. A chart is
 * document content, and Vega fetches whatever a spec names — a data URL, a
 * URL built from a signal, an image mark's url, a link's href — from the app's
 * origin, which serves files beside the document. With Vega's own loader a
 * document someone sent could read a file and send it elsewhere. Charts made
 * in Halmos carry their values inline, so nothing legitimate is lost.
 */
export const offlineLoader: Loader = {
  load: refuse,
  sanitize: refuse,
  http: refuse,
  file: refuse,
}

export async function embedChart(
  el: HTMLElement,
  specText: string,
): Promise<ChartView | null> {
  let spec: unknown
  try {
    spec = JSON.parse(specText)
  } catch (err) {
    renderChartError(el, `Invalid JSON: ${(err as Error).message}`)
    return null
  }
  try {
    // Inside the try: a chart that cannot load its renderer reports the same
    // way as a chart that cannot render.
    const [{ default: vegaEmbed }, { expressionInterpreter }] = await Promise.all([
      import('vega-embed'),
      import('vega-interpreter'),
    ])
    const result = await vegaEmbed(el, spec as Parameters<typeof vegaEmbedFn>[1], {
      actions: false,
      loader: offlineLoader,
      // The app page's Content-Security-Policy forbids eval, which Vega's
      // default expression compiler uses; the interpreter evaluates instead.
      ast: true,
      expr: expressionInterpreter,
    })
    return result.view
  } catch (err) {
    renderChartError(el, (err as Error).message)
    return null
  }
}

function renderChartError(el: HTMLElement, message: string): void {
  el.classList.add('chart-error')
  el.textContent = `Chart error: ${message}`
}
