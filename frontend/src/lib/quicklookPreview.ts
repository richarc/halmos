import { renderDocument } from './renderer'
import { fitDisplayMath } from './fitMath'

/** The shape every Preview hydrator (charts, diagrams, code) already has. */
export interface Hydrator {
  hydrate(root: HTMLElement): Promise<unknown>
}

/**
 * The Quick Look preview's whole render: the document into the sheet, then
 * charts, diagrams and code hydrated the way Preview.svelte does it.
 *
 * No citation formatter and no document path: the extension is handed one
 * file and nothing else, so citations show as written and a bibliography
 * named in the frontmatter is not read.
 *
 * Resolves once every hydrator has settled, failed or not — a hydrator
 * already degrades its own failures to text, and the Swift side waits on
 * this promise before telling Quick Look the preview is ready.
 */
export async function renderPreview(
  sheet: HTMLElement,
  markdown: string,
  hydrators: Hydrator[],
): Promise<void> {
  sheet.innerHTML = renderDocument(markdown).html
  fitDisplayMath(sheet)
  await Promise.allSettled(hydrators.map((h) => h.hydrate(sheet)))
}
