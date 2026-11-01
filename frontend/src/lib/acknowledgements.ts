/**
 * The third-party licence notices the build generates
 * (scripts/notices/plugin.ts writes /acknowledgements.json into dist), read
 * by Help → Acknowledgements when it opens. Never at startup: the file is
 * several hundred KB of licence text.
 *
 * The shape is re-declared here rather than imported from scripts/notices,
 * which is Node code outside this tsconfig; the fields read here are the
 * ones notices.ts writes.
 */
export type AcknowledgementEntry = {
  name: string
  version: string
  licence: string
  copyright: string[]
  text: string
  election?: string
  source?: string
  extraText?: string
  origin: 'npm' | 'go'
}

export type Acknowledgements = { generatedBy: 'halmos-notices'; entries: AcknowledgementEntry[] }

/** The notices, or null outside a built app (the dev server has no file). */
export async function loadAcknowledgements(fetchFn: (url: string) => Promise<Response> = fetch): Promise<Acknowledgements | null> {
  try {
    const res = await fetchFn('/acknowledgements.json')
    if (!res.ok) return null
    const body = (await res.json()) as Partial<Acknowledgements>
    if (body?.generatedBy !== 'halmos-notices' || !Array.isArray(body.entries)) return null
    return body as Acknowledgements
  } catch {
    return null
  }
}
