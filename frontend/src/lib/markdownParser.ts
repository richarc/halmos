import MarkdownIt from 'markdown-it'
import katexPluginModule from '@vscode/markdown-it-katex'
import footnotePlugin from 'markdown-it-footnote'
import { taskAlertsPlugin } from './taskAlerts'
import { citationPlugin } from './citations'

// The plugin ships CJS; Vite's browser interop and Vitest's node interop
// disagree on whether the default import is the plugin function or the CJS
// exports object wrapping it. Unwrap so both environments get the function.
const katexPlugin = ((katexPluginModule as { default?: unknown }).default ??
  katexPluginModule) as Parameters<MarkdownIt['use']>[0]

/**
 * markdown-it with every option and plugin that changes what counts as a
 * citation: linkify (a URL's `/@handle` is a link), KaTeX (`$f(@a)$` is
 * maths), footnotes (`[^1]: [@a]` is a note, not a link reference definition)
 * and the citation rules themselves.
 *
 * The preview (renderer.ts) and the editor's recognisers (citationKeys.ts,
 * citationFeedback.ts) all start from this, so they cannot disagree about what
 * the preview will treat as a citation. `katexOptions` only affects rendering.
 */
export function createMarkdownParser(katexOptions: Record<string, unknown> = {}): MarkdownIt {
  return new MarkdownIt({ html: false, linkify: true })
    .use(katexPlugin, katexOptions)
    .use(footnotePlugin as unknown as Parameters<MarkdownIt['use']>[0])
    .use(taskAlertsPlugin)
    .use(citationPlugin)
}
