import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// The design system's "Elevation in dark" (2026-10-29): anything raised above
// the window has an edge you can see in every theme. Floating surfaces take
// popover-bg, a 1px edge-strong border and popover-shadow; dialogs keep
// overlay-bg and the backdrop, plus a 1px edge-strong border; the start
// screen's large secondary buttons take surface and edge-strong.

const here = fileURLToPath(import.meta.url)
const CSS = readFileSync(join(here, '../../../public/style.css'), 'utf8')
const EDITOR = readFileSync(join(here, '../../Editor.svelte'), 'utf8')

/** The declarations of the first rule whose selector is exactly `selector`. */
function rule(selector: string): string {
  const re = new RegExp(`^${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`, 'm')
  const m = re.exec(CSS)
  if (!m) throw new Error(`no rule for ${selector}`)
  return m[1].replace(/\s+/g, ' ')
}

function tokens(selector: string): Record<string, string> {
  const start = CSS.indexOf(selector + ' {')
  const block = CSS.slice(start, CSS.indexOf('\n}', start))
  return Object.fromEntries([...block.matchAll(/^\s*(--[a-z0-9-]+)\s*:\s*([^;]+);/gm)].map((m) => [m[1], m[2].trim()]))
}

describe('elevation', () => {
  it.each([
    [':root', '#ffffff', '#8a8a8a', 'rgba(0, 0, 0, 0.18)'],
    [':root[data-theme="dark"]', '#2c2c2c', '#707070', 'rgba(0, 0, 0, 0.6)'],
    [':root[data-theme="sepia"]', '#f6eedb', '#8c7853', 'rgba(60, 40, 10, 0.25)'],
  ])('%s has the design system values', (selector, popover, edge, shadow) => {
    const t = tokens(selector)
    expect(t['--popover-bg']).toBe(popover)
    expect(t['--edge-strong']).toBe(edge)
    expect(t['--popover-shadow']).toBe(shadow)
  })

  it('the command palette is a floating surface', () => {
    const r = rule('.palette')
    expect(r).toContain('background: var(--popover-bg)')
    expect(r).toContain('border: 1px solid var(--edge-strong)')
    expect(r).toContain('box-shadow: 0 8px 24px var(--popover-shadow)')
    expect(rule('.palette input.palette-input')).toContain('background: var(--popover-bg)')
  })

  it('a dialog keeps overlay-bg and gains an edge-strong border, no shadow', () => {
    const r = rule('dialog')
    expect(r).toContain('background: var(--overlay-bg)')
    expect(r).toContain('border: 1px solid var(--edge-strong)')
    expect(r).not.toContain('box-shadow')
  })

  it("the start screen's secondary buttons take surface and edge-strong", () => {
    const r = rule('.welcome-actions button:not(.primary)')
    expect(r).toContain('background: var(--surface)')
    expect(r).toContain('border-color: var(--edge-strong)')
  })

  it('the completion list and citation hover are floating surfaces', () => {
    const block = /'\.cm-tooltip': \{([^}]*)\}/.exec(EDITOR)![1]
    expect(block).toContain("backgroundColor: 'var(--popover-bg)'")
    expect(block).toContain("border: '1px solid var(--edge-strong)'")
    expect(block).toContain("boxShadow: '0 8px 24px var(--popover-shadow)'")
  })
})
