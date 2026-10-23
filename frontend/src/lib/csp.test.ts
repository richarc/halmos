import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { CONTENT_SECURITY_POLICY, withContentSecurityPolicy } from './csp'

const directives = new Map(
  CONTENT_SECURITY_POLICY.split(';').map((d) => {
    const [name, ...values] = d.trim().split(/\s+/)
    return [name, values] as const
  }),
)

describe('the app page’s Content-Security-Policy', () => {
  it('lets the page send requests only to the app itself', () => {
    // The guard that matters most: document content that ever got a request
    // out of the page could carry the document, or a file, with it.
    expect(directives.get('connect-src')).toEqual(["'self'"])
    expect(directives.get('default-src')).toEqual(["'self'"])
  })

  it('runs only the app’s own scripts, with no inline script or eval', () => {
    expect(directives.get('script-src')).toEqual(["'self'"])
  })

  it('embeds nothing and posts nowhere', () => {
    for (const d of ['object-src', 'frame-src', 'base-uri', 'form-action']) {
      expect(directives.get(d), d).toEqual(["'none'"])
    }
  })

  it('still shows remote and pasted images, and inline styles', () => {
    // Remote images are ordinary in papers; style attributes are how Svelte,
    // KaTeX, Vega and Mermaid draw.
    expect(directives.get('img-src')).toEqual(["'self'", 'data:', 'blob:', 'https:', 'http:'])
    expect(directives.get('style-src')).toEqual(["'self'", "'unsafe-inline'"])
  })
})

describe('withContentSecurityPolicy', () => {
  it('puts the policy first in the head of the real index.html', () => {
    const html = withContentSecurityPolicy(readFileSync('index.html', 'utf8'))
    const meta = `<meta http-equiv="Content-Security-Policy" content="${CONTENT_SECURITY_POLICY}" />`
    expect(html).toContain(meta)
    // Before anything that loads: a policy only governs what comes after it.
    expect(html.indexOf(meta)).toBeLessThan(html.indexOf('<link'))
    expect(html.indexOf(meta)).toBeLessThan(html.indexOf('<script'))
  })
})

describe('the build', () => {
  it('adds the policy to the app page in production builds, and not to Quick Look', async () => {
    const { default: config } = await import('../../vite.config')
    type Plug = { name: string; apply?: string; transformIndexHtml?: (html: string) => string }
    const plugins = (mode: string) =>
      ((config as (env: { mode: string; command: string }) => { plugins: unknown[] })({ mode, command: 'build' })
        .plugins.flat(Infinity) as Plug[])
    const csp = plugins('production').find((p) => p?.name === 'content-security-policy')
    expect(csp?.apply).toBe('build')
    expect(csp?.transformIndexHtml?.('<head></head>')).toContain(CONTENT_SECURITY_POLICY)
    expect(plugins('quicklook').some((p) => p?.name === 'content-security-policy')).toBe(false)
  })
})
