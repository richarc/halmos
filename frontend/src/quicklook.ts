// Entry for the Quick Look preview extension (quicklook/), built on its own
// by `vite build --mode quicklook` into dist-quicklook/. It must never import
// the Wails runtime or bindings: the extension has no Go side to talk to.
import 'katex/dist/katex.min.css'
import { createChartHydrator } from './lib/charts'
import { createMermaidHydrator } from './lib/mermaid'
import { createCodeHydrator } from './lib/codeHighlight'
import { DEFAULT_ORIENTATION, DEFAULT_PAPER_SIZE, sheetStyle } from './lib/paper'
import { renderPreview } from './lib/quicklookPreview'

declare global {
  interface Window {
    /** Called by PreviewViewController.swift with the file's text. */
    renderMarkdown(text: string): Promise<void>
  }
}

const sheet = document.getElementById('sheet')!
sheet.setAttribute('style', sheetStyle(DEFAULT_PAPER_SIZE, DEFAULT_ORIENTATION))
const hydrators = [createChartHydrator(), createMermaidHydrator(), createCodeHydrator()]

window.renderMarkdown = (text) => renderPreview(sheet, text, hydrators)
