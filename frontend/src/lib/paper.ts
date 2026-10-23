/**
 * Paper geometry, in one place.
 *
 * The preview draws the document as a sheet at true paper proportions, so the
 * app has to know what paper it is. These values are also what the PDF export
 * builds its NSPrintInfo from, which is the point: one source of truth means
 * the sheet cannot promise a measure the export does not deliver.
 */

export type PaperSize = 'a4' | 'letter'
export type PageOrientation = 'portrait' | 'landscape'

/** Must match settings.go's defaultSettings(). */
export const DEFAULT_PAPER_SIZE: PaperSize = 'a4'
export const DEFAULT_ORIENTATION: PageOrientation = 'portrait'

/**
 * The page margin across the paper's short edge: left and right in portrait,
 * top and bottom in landscape. Changed from 20mm in v0.8: A4 at 20mm gives an
 * ~88-character measure, which is poor. 25mm gives ~82 — still wide, because
 * that is what a one-column A4 paper genuinely is.
 */
export const PAGE_MARGIN_MM = 25

/**
 * Short and long edge in millimetres. US Letter is exact (8.5 × 11 in), so
 * its ratio is the one the PDF export's 612 × 792pt paper has.
 */
const PAPER_MM: Record<PaperSize, { short: number; long: number }> = {
  a4: { short: 210, long: 297 },
  letter: { short: 215.9, long: 279.4 },
}

function paperMm(size: PaperSize) {
  return PAPER_MM[size] ?? PAPER_MM[DEFAULT_PAPER_SIZE]
}

export function sheetWidthMm(size: PaperSize, orientation: PageOrientation): number {
  const paper = paperMm(size)
  return orientation === 'landscape' ? paper.long : paper.short
}

/**
 * The page margins in millimetres: x is left and right, y is top and bottom.
 *
 * Not one margin all round, because of how WebKit makes the PDF. It ignores
 * the @page top margin, makes each page's content as tall as its width times
 * the paper's height-to-width ratio, and draws that against the bottom margin.
 * With 25mm all round on A4 the content is 160mm × 226mm in a 160mm × 247mm
 * space, and every page had 21mm of blank paper above the text (measured).
 * Margins that leave a text area of the paper's own shape fill the space
 * exactly, so the pair across the short edge stays at PAGE_MARGIN_MM and the
 * other pair is scaled by the long-to-short ratio: 25mm × 35.4mm on A4.
 */
export function pageMarginsMm(
  size: PaperSize,
  orientation: PageOrientation,
): { x: number; y: number } {
  const paper = paperMm(size)
  const scaled = (PAGE_MARGIN_MM * paper.long) / paper.short
  return orientation === 'landscape'
    ? { x: scaled, y: PAGE_MARGIN_MM }
    : { x: PAGE_MARGIN_MM, y: scaled }
}

const mm = (n: number) => n.toFixed(3).replace(/\.?0+$/, '')

/**
 * The @page rule the app prints with. Preview.svelte puts it after style.css,
 * whose own `@page { margin: 25mm }` is for the HTML export, where a browser
 * prints the page and honours every margin.
 */
export function pageRule(size: PaperSize, orientation: PageOrientation): string {
  const { x, y } = pageMarginsMm(size, orientation)
  return `@page { margin: ${mm(y)}mm ${mm(x)}mm; }`
}

/**
 * The sheet's geometry as an inline style, which is how it reaches CSS.
 *
 * Each margin is given twice, as a percentage and as an absolute cap, and
 * style.css pads the sheet with `min()` of the two. CSS resolves percentage
 * padding — vertical as well as horizontal — against the CONTAINING BLOCK's
 * inline size, the preview pane, never against the sheet's own width, and the
 * sheet's width is capped: `min(var(--sheet-width), 100%)`. The two only
 * coincide while the pane is narrower than the paper. Once the pane is wider
 * the sheet stops growing and the percentage does not, so a 1265px pane drew
 * about 39.7mm of side padding and a measure 109px narrower than the PDF's,
 * and widening the preview made the text column narrower.
 *
 * Pane at least as wide as the paper: the percentage is at least the margin,
 * the cap wins, the sheet draws exactly the margin @page prints. Pane
 * narrower: the percentage wins, and the shrunk sheet keeps a proportionally
 * true margin. Percentages are rounded to three decimals, well below a device
 * pixel at any sheet size.
 */
export function sheetStyle(size: PaperSize, orientation: PageOrientation): string {
  const width = sheetWidthMm(size, orientation)
  const { x, y } = pageMarginsMm(size, orientation)
  const pct = (n: number) => mm((n / width) * 100)
  return (
    `--sheet-width: ${width}mm; ` +
    `--sheet-margin-x: ${pct(x)}%; --sheet-margin-x-max: ${mm(x)}mm; ` +
    `--sheet-margin-y: ${pct(y)}%; --sheet-margin-y-max: ${mm(y)}mm`
  )
}
