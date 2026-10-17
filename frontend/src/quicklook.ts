// Entry for the Quick Look preview extension (quicklook/), built on its own
// by `vite build --mode quicklook` into dist-quicklook/. It must never import
// the Wails runtime or bindings: the extension has no Go side to talk to.
import 'katex/dist/katex.min.css'
import { createChartHydrator } from './lib/charts'
import { createMermaidHydrator } from './lib/mermaid'
import { createCodeHydrator } from './lib/codeHighlight'
import { DEFAULT_ORIENTATION, DEFAULT_PAPER_SIZE, sheetStyle } from './lib/paper'
import { renderPreview, type Hydrator, type PreviewOptions } from './lib/quicklookPreview'

declare global {
  interface Window {
    /**
     * Called by PreviewViewController.swift with the file's text and, when
     * the file was too large to read whole, its size and the bytes read.
     */
    renderMarkdown(text: string, info?: PreviewOptions): Promise<void>
  }
}

/** Wires the page's sheet to window.renderMarkdown. Exported for tests. */
export function mountQuickLook(sheet: HTMLElement, hydrators: Hydrator[]): void {
  sheet.setAttribute('style', sheetStyle(DEFAULT_PAPER_SIZE, DEFAULT_ORIENTATION))
  window.renderMarkdown = (text, info) =>
    renderPreview(sheet, text, hydrators, {
      totalBytes: info?.totalBytes,
      shownBytes: info?.shownBytes,
    })
}

const sheet = document.getElementById('sheet')
if (sheet) {
  mountQuickLook(sheet, [createChartHydrator(), createMermaidHydrator(), createCodeHydrator()])
}
