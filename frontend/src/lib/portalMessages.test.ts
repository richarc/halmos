import { describe, it, expect } from 'vitest'
import { messageFor, problemMessage } from './portalMessages'

const err = (code: string, extra: Record<string, unknown> = {}) => ({ status: 0, code, ...extra })

describe('messageFor', () => {
  it('offers plans for a missing or inactive subscription', () => {
    for (const code of ['no_seat', 'subscription_inactive']) {
      expect(messageFor(err(code), 'docx')).toEqual({
        text: 'Word and LaTeX export need a Halmos subscription.',
        action: 'pricing',
      })
    }
  })

  it('sends a failed payment to billing', () => {
    expect(messageFor(err('past_due'), 'docx')).toEqual({
      text: "Your Halmos subscription's payment failed. Update the payment method to keep exporting.",
      action: 'billing',
    })
  })

  it('asks to connect again when the device was signed out', () => {
    expect(messageFor(err('reauth'), 'docx').action).toBe('connect')
    expect(messageFor(err('signed_out'), 'latex').action).toBe('connect')
  })

  it('says how long to wait when rate limited, rounded up to minutes', () => {
    expect(messageFor(err('rate_limited', { retryAfterSeconds: 61 }), 'docx').text)
      .toBe('Too many exports for now. Try again in 2 minutes.')
    expect(messageFor(err('rate_limited', { retryAfterSeconds: 30 }), 'docx').text)
      .toBe('Too many exports for now. Try again in 1 minute.')
  })

  it('has a fixed sentence for each service state', () => {
    expect(messageFor(err('busy'), 'docx').text).toBe('Another export is still running.')
    expect(messageFor(err('service_unavailable'), 'docx').text)
      .toBe('The export service is restarting. Try again in a minute.')
    expect(messageFor(err('network'), 'docx').text).toBe("Couldn't reach halmoseditor.com.")
    expect(messageFor(err('conversion_failed', { reason: 'timeout' }), 'docx').text)
      .toBe('The document took too long to convert.')
    expect(messageFor(err('conversion_failed', { reason: 'output_too_large' }), 'docx').text)
      .toBe('The converted document would be too large.')
    expect(messageFor(err('conversion_failed'), 'docx').text)
      .toBe("The export service couldn't convert this document. Check the citation style.")
  })

  it('names what the service refused', () => {
    expect(messageFor(err('invalid_request', { reason: 'csl' }), 'docx').text)
      .toBe("The citation style file isn't valid CSL.")
    expect(messageFor(err('invalid_request', { reason: 'image_type' }), 'docx').text)
      .toBe('An image is not PNG, JPEG or GIF.')
    expect(messageFor(err('payload_too_large', { limit: 'image' }), 'docx').text)
      .toBe('An image is over 8 MB, the export limit.')
  })

  it('falls back for anything it does not know', () => {
    expect(messageFor(err('teapot'), 'docx').text).toBe("The export service couldn't convert this document.")
  })
})

describe('problemMessage', () => {
  it('names the line for too-deep brackets', () => {
    expect(problemMessage({ code: 'nesting', line: 12 }))
      .toBe('Line 12 nests square brackets more than 6 deep, which the export service refuses.')
  })

  it('names each limit', () => {
    expect(problemMessage({ code: 'markdown_size' })).toBe('The document is over 2 MB, the export limit.')
    expect(problemMessage({ code: 'image_count' })).toBe('The document has more than 50 images, the export limit.')
    expect(problemMessage({ code: 'csl_dtd' }))
      .toBe('The citation style file has a DOCTYPE or ENTITY declaration, which the export service refuses.')
  })
})
