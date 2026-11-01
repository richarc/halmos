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

type Loaded = { notices: Acknowledgements; reason: '' } | { notices: null; reason: string }

async function fetchAcknowledgements(fetchFn: (url: string) => Promise<Response>): Promise<Loaded> {
  try {
    const res = await fetchFn('/acknowledgements.json')
    if (!res.ok) return { notices: null, reason: `HTTP ${res.status}` }
    const body = (await res.json()) as Partial<Acknowledgements>
    if (body?.generatedBy !== 'halmos-notices' || !Array.isArray(body.entries)) {
      return { notices: null, reason: 'not a licence notices file' }
    }
    return { notices: body as Acknowledgements, reason: '' }
  } catch (e) {
    return { notices: null, reason: e instanceof Error ? `${e.name}: ${e.message}` : String(e) }
  }
}

let lastFailure = ''

/** Why the last load returned null, for the page to show; '' after a success. */
export function lastLoadFailure(): string {
  return lastFailure
}

/** The notices, or null outside a built app (the dev server has no file). */
export async function loadAcknowledgements(fetchFn: (url: string) => Promise<Response> = fetch): Promise<Acknowledgements | null> {
  const { notices, reason } = await fetchAcknowledgements(fetchFn)
  lastFailure = reason
  return notices
}

/** Why a load with fetchFn fails, or '' when it succeeds. */
export async function describeFailure(fetchFn: (url: string) => Promise<Response>): Promise<string> {
  return (await fetchAcknowledgements(fetchFn)).reason
}
