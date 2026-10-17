import { renderDocument } from './renderer'
import { fitDisplayMath } from './fitMath'

/** The shape every Preview hydrator (charts, diagrams, code) already has. */
export interface Hydrator {
  hydrate(root: HTMLElement): Promise<unknown>
}

export interface PreviewOptions {
  /** The file's size on disk, in bytes. */
  totalBytes?: number
  /** How many of those bytes were read and passed in; less means truncated. */
  shownBytes?: number
  /** How long to wait for the hydrators before showing what has rendered. */
  timeoutMs?: number
}

/**
 * How long Quick Look waits for charts, diagrams and code to hydrate. Quick
 * Look shows nothing until the Swift side reports the preview ready, so a
 * hydrator that never settles must not hold it forever: past this, the page
 * is shown as it stands.
 */
export const HYDRATE_TIMEOUT_MS = 5000

/** An inline image: loads nothing. Any other `data:` type is not an image. */
const DATA_IMAGE = /^data:image\//i

/**
 * The Quick Look preview's whole render: the document into the sheet, then
 * charts, diagrams and code hydrated the way Preview.svelte does it.
 *
 * No citation formatter and no document path: the extension is handed one
 * file and nothing else, so citations show as written and a bibliography
 * named in the frontmatter is not read.
 *
 * Images other than inline `data:image/` ones are replaced by their file name
 * before the HTML reaches the page. A document-relative image has no route
 * to load from here, and a remote one would be a network request made just
 * by pressing space in Finder.
 *
 * Resolves once every hydrator has settled, failed or not, or after
 * `timeoutMs`, whichever is first — a hydrator already degrades its own
 * failures to text, and the Swift side waits on this promise before telling
 * Quick Look the preview is ready.
 */
export async function renderPreview(
  sheet: HTMLElement,
  markdown: string,
  hydrators: Hydrator[],
  opts: PreviewOptions = {},
): Promise<void> {
  // Parsed in a <template>, whose content belongs to an inert document:
  // nothing in it is fetched until it is moved into the page.
  const template = document.createElement('template')
  template.innerHTML = renderDocument(markdown).html
  replaceImages(template.content)
  const note = truncationNote(opts)
  if (note) template.content.prepend(note)
  sheet.replaceChildren(template.content)

  fitDisplayMath(sheet)

  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, opts.timeoutMs ?? HYDRATE_TIMEOUT_MS)
  })
  try {
    await Promise.race([Promise.allSettled(hydrators.map((h) => h.hydrate(sheet))), timeout])
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Replaces every `<img>` under `root` except inline `data:image/` ones with
 * a `[Image: name]` stand-in. Exported for tests: markdown-it already refuses
 * most other `data:` links, so this is the second line, not the only one.
 */
export function replaceImages(root: ParentNode): void {
  for (const img of Array.from(root.querySelectorAll('img'))) {
    const src = img.getAttribute('src') ?? ''
    if (DATA_IMAGE.test(src)) continue
    const stand = document.createElement('span')
    stand.className = 'quicklook-image'
    stand.textContent = `[Image: ${fileName(src)}]`
    img.replaceWith(stand)
  }
}

function truncationNote({ totalBytes, shownBytes }: PreviewOptions): HTMLElement | null {
  if (totalBytes === undefined || shownBytes === undefined || shownBytes >= totalBytes) return null
  const p = document.createElement('p')
  p.className = 'quicklook-truncated'
  p.textContent =
    `This file is ${megabytes(totalBytes)}. Quick Look shows the first ` +
    `${megabytes(shownBytes)}; open it in Halmos Editor to see the rest.`
  return p
}

function megabytes(bytes: number): string {
  const mb = Math.round((bytes / (1024 * 1024)) * 10) / 10
  return `${mb} MB`
}

/** The last path segment of an image source, decoded for reading. */
function fileName(src: string): string {
  const path = src.split(/[?#]/)[0]
  const last = path.slice(path.lastIndexOf('/') + 1) || path
  try {
    return decodeURIComponent(last)
  } catch {
    return last
  }
}
