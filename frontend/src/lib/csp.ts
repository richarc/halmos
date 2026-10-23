/**
 * The app page's Content-Security-Policy, added to index.html by the
 * production build (vite.config.ts). Not in development, where Vite's live
 * reload needs a socket to its own server.
 *
 * A document can come from anyone, and the preview renders it in this page,
 * so the page may send requests only to the app itself (connect-src), run
 * only the app's own scripts (no inline script, no eval: charts use Vega's
 * expression interpreter), and embed or post nothing. Images may come from
 * anywhere, as they do in papers; inline styles are how Svelte, KaTeX, Vega
 * and Mermaid draw.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "connect-src 'self'",
  "img-src 'self' data: blob: https: http:",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "object-src 'none'",
  "frame-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ')

/** index.html with the policy as the first element of its head. */
export function withContentSecurityPolicy(html: string): string {
  return html.replace(
    /<head>/,
    `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CONTENT_SECURITY_POLICY}" />`,
  )
}
