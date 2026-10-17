/**
 * The document's body typeface, by the key the BodyFont setting stores.
 * menu.go's bodyFonts lists the same keys; TestBodyFontMenuValuesMatchFrontend
 * fails if the two drift. Preview.svelte writes the chosen stack as
 * --doc-font-body, so the preview, PDF and HTML export all follow it.
 */
export const BODY_FONTS: Record<string, string> = {
  'new-york': "ui-serif, 'New York', Georgia, serif",
  charter: 'Charter, Georgia, serif',
  iowan: "'Iowan Old Style', Georgia, serif",
  palatino: "Palatino, 'Palatino Linotype', serif",
  georgia: 'Georgia, serif',
  'system-sans': "-apple-system, 'Helvetica Neue', sans-serif",
}

export const DEFAULT_BODY_FONT = 'new-york'

/** The CSS stack for a setting value; anything unknown gets the default. */
export function bodyFontStack(key: string): string {
  return BODY_FONTS[key] ?? BODY_FONTS[DEFAULT_BODY_FONT]
}
