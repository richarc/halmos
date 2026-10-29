// Author-list options set in the frontmatter (`citation-et-al-min: 3`, …)
// override the citation style's own, without the author editing the .csl
// file. They are applied to a copy of the style's XML each time it is
// loaded; that copy formats the preview and the hover, and is the CSL sent
// to the portal for Word and LaTeX, so one setting covers every output.

type Place = 'citation' | 'bibliography'

/** The CSL attributes the keys set: inheritable name options. */
export type CslAttr =
  | 'et-al-min'
  | 'et-al-use-first'
  | 'et-al-subsequent-min'
  | 'et-al-subsequent-use-first'
  | 'et-al-use-last'

const KEYS = [
  ['citation-et-al-min', 'citation', 'et-al-min'],
  ['citation-et-al-use-first', 'citation', 'et-al-use-first'],
  ['citation-et-al-subsequent-min', 'citation', 'et-al-subsequent-min'],
  ['citation-et-al-subsequent-use-first', 'citation', 'et-al-subsequent-use-first'],
  ['citation-et-al-use-last', 'citation', 'et-al-use-last'],
  ['bibliography-et-al-min', 'bibliography', 'et-al-min'],
  ['bibliography-et-al-use-first', 'bibliography', 'et-al-use-first'],
  ['bibliography-et-al-use-last', 'bibliography', 'et-al-use-last'],
] as const satisfies readonly (readonly [string, Place, CslAttr])[]

export type StyleOptionKey = (typeof KEYS)[number][0]

/** The frontmatter keys, in the documented order. */
export const STYLE_OPTION_KEYS: readonly StyleOptionKey[] = KEYS.map(([key]) => key)

export interface StyleOptions {
  citation: Partial<Record<CslAttr, string>>
  bibliography: Partial<Record<CslAttr, string>>
}

// A `-min` set on its own pairs with this use-first, which is lowered to 1
// when the style's would leave the list uncut.
const USE_FIRST_FOR: Partial<Record<CslAttr, CslAttr>> = {
  'et-al-min': 'et-al-use-first',
  'et-al-subsequent-min': 'et-al-subsequent-use-first',
}

/**
 * Reads the keys' raw frontmatter text. A bad value is left out and
 * described in `invalid`, one message per key; an empty one is not set.
 */
export function readStyleOptions(fm: Partial<Record<StyleOptionKey, string>>): {
  options: StyleOptions
  invalid: string[]
} {
  const options: StyleOptions = { citation: {}, bibliography: {} }
  const invalid: string[] = []
  for (const [key, place, attr] of KEYS) {
    const raw = fm[key]?.trim()
    if (!raw) continue
    if (attr === 'et-al-use-last') {
      const flag = raw.toLowerCase()
      if (flag === 'true' || flag === 'false') options[place][attr] = flag
      else invalid.push(`${key} must be true or false — ignored`)
    } else if (/^\d+$/.test(raw) && Number(raw) >= 1 && Number(raw) <= 100) {
      options[place][attr] = String(Number(raw))
    } else {
      invalid.push(`${key} must be a whole number from 1 to 100 — ignored`)
    }
  }
  return { options, invalid }
}

export function hasStyleOptions(o: StyleOptions): boolean {
  return Object.keys(o.citation).length > 0 || Object.keys(o.bibliography).length > 0
}

function children(el: Element, name: string): Element[] {
  return [...el.children].filter((c) => c.localName === name)
}

function descendants(el: Element, name: string): Element[] {
  return [...el.getElementsByTagNameNS('*', name)]
}

// The macros a layout reaches: <text macro> anywhere below it, and the
// macros those call in turn. Each macro is visited once, so a style whose
// macros call each other in a loop still ends.
function reachableMacros(root: Element, macros: Map<string, Element>): Set<Element> {
  const seen = new Set<Element>()
  const queue = [root]
  while (queue.length) {
    const el = queue.pop()!
    for (const t of descendants(el, 'text')) {
      const m = macros.get(t.getAttribute('macro') ?? '')
      if (m && !seen.has(m)) {
        seen.add(m)
        queue.push(m)
      }
    }
  }
  return seen
}

// Sets the options on one element (a <citation>, <bibliography> or
// <name>). `inherited` supplies a use-first the element does not set
// itself, for the lowering rule; `null` there means none at all, which on
// <citation> or <bibliography> (`noneCuts`) also gets 1, since CSL cuts a
// list only when both a min and a use-first are set. A <name> without its
// own inherits the one just set above it.
function setOn(
  el: Element,
  set: Partial<Record<CslAttr, string>>,
  inherited: (a: CslAttr) => string | null,
  noneCuts: boolean,
): void {
  for (const [attr, value] of Object.entries(set) as [CslAttr, string][]) {
    el.setAttribute(attr, value)
    const pair = USE_FIRST_FOR[attr]
    if (pair && set[pair] === undefined) {
      const current = el.getAttribute(pair) ?? inherited(pair)
      if (current === null ? noneCuts : Number(current) >= Number(value)) el.setAttribute(pair, '1')
    }
  }
}

/**
 * The style with the options applied, or `xml` itself when there are none
 * or it does not parse. Each option is set on <citation> or <bibliography>,
 * and on an author <name> that would override it there. A <name> inside a
 * <choose> is a special case the style chose (APA lists treaty parties in
 * full) and is left alone. A <name> in a macro both places use takes the
 * bibliography's value when one is set.
 */
export function applyStyleOptions(xml: string, o: StyleOptions): string {
  if (!hasStyleOptions(o)) return xml
  const d = new DOMParser().parseFromString(xml, 'application/xml')
  const style = d.documentElement
  if (!style || style.localName !== 'style' || d.getElementsByTagName('parsererror').length) return xml

  const macros = new Map(children(style, 'macro').map((m) => [m.getAttribute('name') ?? '', m]))
  const places: Partial<Record<Place, { el: Element; macros: Set<Element> }>> = {}
  for (const place of ['citation', 'bibliography'] as const) {
    const el = children(style, place)[0]
    if (el) places[place] = { el, macros: reachableMacros(el, macros) }
  }

  for (const place of ['citation', 'bibliography'] as const) {
    const p = places[place]
    if (p) setOn(p.el, o[place], (a) => style.getAttribute(a), true)
  }

  for (const name of descendants(style, 'name')) {
    const names = name.parentElement
    if (!names || names.localName !== 'names') continue
    if (!(names.getAttribute('variable') ?? '').split(/\s+/).includes('author')) continue
    let inChoose = false
    let macro: Element | null = null
    let place: Place | null = null
    for (let a: Element | null = name.parentElement; a && a !== style; a = a.parentElement) {
      if (a.localName === 'choose') inChoose = true
      if (a.localName === 'macro') macro = a
      if (a.localName === 'citation' || a.localName === 'bibliography') place = a.localName
    }
    if (inChoose) continue
    const reached = (pl: Place) => place === pl || (macro !== null && !!places[pl]?.macros.has(macro))
    let set: Partial<Record<CslAttr, string>> = {}
    if (reached('citation') && reached('bibliography')) {
      set = hasStyleOptions({ citation: {}, bibliography: o.bibliography }) ? o.bibliography : o.citation
    } else if (reached('bibliography')) {
      set = o.bibliography
    } else if (reached('citation')) {
      set = o.citation
    }
    // Only the attributes the <name> sets itself: the rest it already
    // inherits from the element set above.
    const own = Object.fromEntries(Object.entries(set).filter(([a]) => name.hasAttribute(a) || name.hasAttribute(USE_FIRST_FOR[a as CslAttr] ?? '')))
    setOn(name, own, () => null, false)
  }

  return new XMLSerializer().serializeToString(d)
}
