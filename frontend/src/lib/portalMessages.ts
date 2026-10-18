// What the person is told when talking to the Halmos portal goes wrong. Each
// code is a fixed word from the portal's contract (hermesportal
// docs/api/device-flow.md) or one of the editor's own (portalclient.go), so
// the sentences are fixed too and never repeat anything from the document.

import type { PortalError } from '../../bindings/hermes/models'
import type { ExportFormat, ExportProblem } from './exportRequest'

export type PortalAction = 'pricing' | 'billing' | 'connect'

const REASONS: Record<string, string> = {
  markdown: "The document couldn't be read as text.",
  markdown_nesting: 'The document nests square brackets more than 6 deep, which the export service refuses.',
  bibliography: "The bibliography couldn't be read as text.",
  csl: "The citation style file isn't valid CSL.",
  csl_dtd: 'The citation style file has a DOCTYPE or ENTITY declaration, which the export service refuses.',
  images: "The document's images couldn't be sent.",
  image_key: "An image's name couldn't be sent.",
  image_type: 'An image is not PNG, JPEG or GIF.',
  image_svg: 'An SVG image could not be converted to PNG.',
  image_encoding: "An image couldn't be sent.",
}

const LIMITS: Record<string, string> = {
  markdown: 'The document is over 2 MB, the export limit.',
  bibliography: 'The cited references are over 2 MB, the export limit.',
  csl: 'The citation style file is over 256 KB, the export limit.',
  image: 'An image is over 8 MB, the export limit.',
  image_count: 'The document has more than 50 images, the export limit.',
  images_total: 'The images add up to more than 16 MB, the export limit.',
}

const FALLBACK = "The export service couldn't convert this document."

export function messageFor(err: PortalError, _format: ExportFormat): { text: string; action?: PortalAction } {
  switch (err.code) {
    case 'no_seat':
    case 'subscription_inactive':
      return { text: 'Word and LaTeX export need a Halmos subscription.', action: 'pricing' }
    case 'past_due':
      return {
        text: "Your Halmos subscription's payment failed. Update the payment method to keep exporting.",
        action: 'billing',
      }
    case 'reauth':
    case 'signed_out':
      return { text: 'This Mac is no longer connected to your Halmos account.', action: 'connect' }
    case 'rate_limited': {
      const minutes = Math.max(1, Math.ceil((err.retryAfterSeconds ?? 60) / 60))
      return { text: `Too many exports for now. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.` }
    }
    case 'busy':
      return { text: 'Another export is still running.' }
    case 'service_unavailable':
      return { text: 'The export service is restarting. Try again in a minute.' }
    case 'network':
      return { text: "Couldn't reach halmoseditor.com." }
    case 'misconfigured':
      return { text: 'The Halmos server address is misconfigured.' }
    case 'keychain':
      return { text: "Couldn't read or save the Halmos sign-in in the Keychain." }
    case 'write_failed':
      return { text: "Couldn't save the exported file." }
    case 'conversion_failed':
      if (err.reason === 'timeout') return { text: 'The document took too long to convert.' }
      if (err.reason === 'output_too_large') return { text: 'The converted document would be too large.' }
      return { text: `${FALLBACK} Check the citation style.` }
    case 'invalid_request':
      return { text: REASONS[err.reason ?? ''] ?? FALLBACK }
    case 'payload_too_large':
    case 'request_too_large':
      return { text: LIMITS[err.limit ?? ''] ?? 'The document and its images are over 25 MB, the export limit.' }
    default:
      return { text: FALLBACK }
  }
}

export function problemMessage(p: ExportProblem): string {
  switch (p.code) {
    case 'nesting':
      return `Line ${p.line} nests square brackets more than 6 deep, which the export service refuses.`
    case 'markdown_size':
      return LIMITS.markdown
    case 'bibliography_size':
      return LIMITS.bibliography
    case 'csl_size':
      return LIMITS.csl
    case 'csl_dtd':
      return REASONS.csl_dtd
    case 'image_count':
      return LIMITS.image_count
    case 'image_size':
      return LIMITS.image
    case 'images_total':
      return LIMITS.images_total
    case 'body_size':
      return 'The document and its images are over 25 MB, the export limit.'
  }
}
