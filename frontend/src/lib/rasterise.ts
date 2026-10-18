// Turns what the preview drew into PNG for a Word export: the export service
// takes PNG, JPEG or GIF only, and refuses SVG because older Word cannot show
// it. Not unit-tested — jsdom has no canvas — so the export click-through
// covers it.

/** canvasToPng returns a canvas's pixels as base64 PNG, without the data: prefix. */
export function canvasToPng(c: HTMLCanvasElement): string {
  return c.toDataURL('image/png').split(',')[1] ?? ''
}

// An SVG with no width of its own (Mermaid sizes by viewBox and CSS) still
// needs a canvas size.
const FALLBACK_WIDTH = 800

/**
 * toPng draws an image (SVG, WebP, AVIF, BMP…) onto a canvas at `scale`
 * times its natural size and returns base64 PNG. The canvas is filled white
 * first, so a transparent diagram is not black-on-dark in Word's dark mode.
 */
export function toPng(dataUri: string, scale = 2): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const w = img.naturalWidth || FALLBACK_WIDTH
      const h = img.naturalHeight || Math.round(w * 0.6)
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(w * scale)
      canvas.height = Math.round(h * scale)
      const ctx = canvas.getContext('2d')
      if (!ctx) return reject(new Error('no 2d context'))
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      resolve(canvasToPng(canvas))
    }
    img.onerror = () => reject(new Error('image did not load'))
    img.src = dataUri
  })
}
