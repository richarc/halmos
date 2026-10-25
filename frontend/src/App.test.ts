// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, unmount, flushSync } from 'svelte'
import { EditorView } from '@codemirror/view'
import { completionStatus, acceptCompletion, closeCompletion, startCompletion } from '@codemirror/autocomplete'

const { DocumentService, listeners, recents, settings, DEFAULT_SETTINGS } = vi.hoisted(() => {
  const listeners: Record<string, (ev: { data: unknown }) => void> = {}
  const recents = { current: [] as string[] }
  const DEFAULT_SETTINGS = {
    printOrientation: 'portrait',
    syncScrolling: false,
    showOutline: false,
    theme: 'system',
    figureAlignment: 'centre',
    chartWidth: 'medium',
    autoSave: true,
    // 'off', not the production default 'unasked': the first-launch question
    // would otherwise open in every test that mounts App.
    updateCheck: 'off',
    spellCheck: true,
  }
  const settings = { current: { ...DEFAULT_SETTINGS } }
  return {
    listeners,
    recents,
    settings,
    DEFAULT_SETTINGS,
    DocumentService: {
      RecentFiles: vi.fn(async () => recents.current),
      ClearRecents: vi.fn(async () => {
        recents.current = []
      }),
      WelcomeInfo: vi.fn(async () => ({ version: '0.14.0', home: '/Users/ann' })),
      SetDirty: vi.fn(async () => {}),
      SetBuilderOpen: vi.fn(async () => {}),
      WatchBibliography: vi.fn(async () => {}),
      ReadBibliography: vi.fn(async () => ''),
      Open: vi.fn(async () => ({ path: '', content: '' })),
      OpenPath: vi.fn(async () => ({ path: '', content: '' })),
      Save: vi.fn(async () => ({ conflict: false })),
      SaveAs: vi.fn(async () => ''),
      Quit: vi.fn(async () => {}),
      AcceptDiskVersion: vi.fn(async (_version: string) => {}),
      ForgetDocument: vi.fn(async () => {}),
      CloseWindow: vi.fn(async () => {}),
      TakeLaunchFile: vi.fn(async () => ''),
      PickCitations: vi.fn(async () => ''),
      ZoteroStatus: vi.fn(async () => 'ready'),
      ExportPDF: vi.fn(async () => {}),
      ChooseHTMLExportPath: vi.fn(async (_docPath: string) => ''),
      WriteHTMLExport: vi.fn(async (_path: string, _html: string) => {}),
      ReadImageDataURI: vi.fn(async (_docPath: string, _src: string) => 'data:image/png;base64,AA=='),
      Settings: vi.fn(async () => settings.current),
      UpdateSettings: vi.fn(async (_next: typeof DEFAULT_SETTINGS) => {}),
      ImportData: vi.fn(async () => ''),
      ChooseNewDocumentPath: vi.fn(async () => ''),
      ChooseBibliography: vi.fn(async () => ''),
      ChooseCitationStyle: vi.fn(async () => ''),
      SetCitationStyle: vi.fn(async (_csl: string) => {}),
      CreateDocument: vi.fn(async (path: string, content: string, _bibName: string, _bibContent: string) => ({ path, content })),
      WriteDraft: vi.fn(async (_docPath: string, _content: string) => {}),
      DiscardDraft: vi.fn(async (_docPath: string) => {}),
      RecoverDraft: vi.fn(async (_docPath: string) => ({ found: false, content: '' })),
      SavePastedImage: vi.fn(async (_doc: string, _data: string | null, _ext: string) => 'images/pasted-20261017-140305.png'),
      CheckForUpdates: vi.fn(async (_force: boolean) => ({
        checked: true, available: false, current: '0.9.0', latest: '0.9.0',
        url: 'https://github.com/richarc/halmos/releases/tag/v0.9.0',
      })),
    },
  }
})

// Signed in with a complimentary seat unless a test says otherwise.
const { PortalService, SIGNED_IN } = vi.hoisted(() => {
  const SIGNED_IN = {
    signedIn: true, email: 'c@x.com', organisation: '', seatSource: 'complimentary', seatStatus: 'active',
    deviceName: 'Mac · ABCD', pricingURL: 'https://www.halmoseditor.com/pricing', error: null,
  }
  return {
    SIGNED_IN,
    PortalService: {
      Account: vi.fn(async () => ({ ...SIGNED_IN }) as Record<string, unknown>),
      StartPairing: vi.fn(async () => ({
        userCode: 'BDFG-HJKL', verificationURL: 'https://www.halmoseditor.com/device?user_code=BDFG-HJKL',
        expiresIn: 900, error: null,
      }) as Record<string, unknown>),
      CancelPairing: vi.fn(async () => {}),
      SignOut: vi.fn(async () => {}),
      OpenPortalURL: vi.fn(async (_url: string) => null),
      ChooseExportPath: vi.fn(async (_format: string, _docPath: string) => ''),
      ReadExportImage: vi.fn(async (_docPath: string, _src: string) => ({ base64: 'iVBORw==', mime: 'image/png', error: '' })),
      Export: vi.fn(async (_path: string, _req: Record<string, unknown>) => null as Record<string, unknown> | null),
      RevealExport: vi.fn(async (_path: string) => {}),
    },
  }
})

vi.mock('@wailsio/runtime', () => ({
  Events: {
    On: (name: string, cb: (ev: { data: unknown }) => void) => {
      listeners[name] = cb
    },
  },
  Browser: { OpenURL: vi.fn() },
}))
// Demo mode is off in every test: Script() returns no script, so App's
// startDemo returns before it touches anything. Defined inside the factory
// because vi.mock is hoisted above any top-level constant.
vi.mock('../bindings/hermes', () => ({
  DocumentService,
  PortalService,
  DemoService: {
    Script: vi.fn(async () => null),
    StartRecording: vi.fn(async () => {}),
    StopRecording: vi.fn(async () => {}),
  },
}))

import { Browser } from '@wailsio/runtime'

// The real debounce is two seconds; every test here would wait it out.
// App.svelte passes DRAFT_DEBOUNCE_MS to the keeper explicitly so this
// mock is what it sees.
const htmlExport = vi.hoisted(() => ({
  buildStandaloneHTML: vi.fn(
    async (
      _root: HTMLElement,
      _opts: {
        title: string
        bodyFont: string
        css: string
        katexCss: string
        inlineImage: (src: string) => Promise<string | null>
      },
    ) => 'PAGE',
  ),
  loadExportStyles: vi.fn(async () => ({ css: 'DOC CSS', katexCss: 'KATEX CSS' })),
}))
vi.mock('./lib/htmlExport', () => htmlExport)
// jsdom has no canvas: a redraw to PNG is recorded, not performed.
const rasterise = vi.hoisted(() => ({
  toPng: vi.fn(async (_uri: string, _scale?: number) => 'PNGDATA'),
  canvasToPng: vi.fn(() => 'CANVASPNG'),
}))
vi.mock('./lib/rasterise', () => rasterise)
// Counted, not replaced: the bibliography tests check when a formatter is built.
const citationsSpy = vi.hoisted(() => ({ created: 0 }))
vi.mock('./lib/citations', async (importOriginal) => {
  const real = await importOriginal<typeof import('./lib/citations')>()
  return {
    ...real,
    createCitationFormatter: (...args: Parameters<typeof real.createCitationFormatter>) => {
      citationsSpy.created++
      return real.createCitationFormatter(...args)
    },
  }
})
vi.mock('./lib/recoveryDraft', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./lib/recoveryDraft')>()),
  DRAFT_DEBOUNCE_MS: 20,
}))

import App from './App.svelte'

// Tracked so afterEach can always unmount, even when a test body throws
// partway through — otherwise a failing assertion leaves App mounted with a
// live $effect still calling DocumentService.SetDirty, which pollutes later
// tests' mock call counts and turns one real failure into a cascade.
let mounted: ReturnType<typeof mount> | undefined

function mountApp() {
  const target = document.createElement('div')
  document.body.appendChild(target)
  const cmp = mount(App, { target })
  mounted = cmp
  flushSync() // Svelte 5 runs onMount in a microtask
  return { target }
}

function buttonByText(root: HTMLElement, text: string): HTMLButtonElement | undefined {
  return [...root.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)
}

// Shared by the chart-builder and table-builder describes below: both open
// the same recent document the same way, so this is hoisted rather than
// duplicated per describe.
async function openDoc(content: string) {
  recents.current = ['/tmp/paper.md']
  DocumentService.OpenPath.mockResolvedValueOnce({ path: '/tmp/paper.md', content })
  const { target } = mountApp()
  await vi.waitFor(() => expect(target.querySelector('.welcome')).not.toBeNull())
  listeners['menu:open-recent']({ data: '/tmp/paper.md' })
  await vi.waitFor(() => expect(target.textContent).toContain('Results'))
  return target
}

// jsdom does not implement matchMedia at all (not a stub — simply absent), and
// App's onMount calls it unconditionally. Install a default fake before every
// test so mounts outside the theme suite don't crash; theme tests overwrite
// it with their own value before mounting.
function stubMatchMedia(prefersDark: boolean) {
  const listeners: Array<(e: { matches: boolean }) => void> = []
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: () => ({
      matches: prefersDark,
      addEventListener: (_: string, cb: (e: { matches: boolean }) => void) =>
        listeners.push(cb),
      removeEventListener: () => {},
    }),
  })
  return { fire: (matches: boolean) => listeners.forEach((cb) => cb({ matches })) }
}

beforeEach(() => {
  recents.current = []
  settings.current = { ...DEFAULT_SETTINGS }
  vi.clearAllMocks()
  stubMatchMedia(false)
  // applyTheme writes to <html>'s dataset, which outlives unmount (afterEach
  // only clears document.body). Left in place, a stale value from a prior
  // test can make a later assertion pass for the wrong reason.
  document.documentElement.removeAttribute('data-theme')
})

afterEach(() => {
  if (mounted) {
    unmount(mounted)
    mounted = undefined
  }
  document.body.innerHTML = ''
})

describe('welcome pane', () => {
  // The pane is the first thing a returning user sees: what the app is and
  // which version, how to start, and the files they were last working on.
  it('shows the app name and version', async () => {
    recents.current = ['/papers/thesis.md']
    const { target } = mountApp()
    await vi.waitFor(() => expect(target.querySelector('.welcome-version')).not.toBeNull())

    expect(target.querySelector('.welcome h1')?.textContent).toBe('Halmos Editor')
    expect(target.querySelector('.welcome-version')?.textContent).toBe('Version 0.14.0')
  })

  // An unbundled build has no Info.plist to read a version from.
  it('hides the version line when there is none', async () => {
    recents.current = ['/papers/thesis.md']
    DocumentService.WelcomeInfo.mockResolvedValueOnce({ version: '', home: '/Users/ann' })
    const { target } = mountApp()
    await vi.waitFor(() => expect(target.querySelector('.welcome')).not.toBeNull())
    await Promise.resolve()
    flushSync()

    expect(target.querySelector('.welcome-version')).toBeNull()
  })

  it('lists recent files by name with the folder under it', async () => {
    recents.current = ['/Users/ann/Papers/qec.md']
    const { target } = mountApp()
    await vi.waitFor(() =>
      expect(target.querySelector('.welcome-recent-folder')?.textContent).toBe('~/Papers'),
    )

    expect(target.querySelector('.welcome-recent-name')?.textContent).toBe('qec.md')
    target.querySelector<HTMLButtonElement>('.welcome-recent')!.click()
    await vi.waitFor(() => expect(DocumentService.OpenPath).toHaveBeenCalledWith('/Users/ann/Papers/qec.md'))
  })

  // The ellipsis itself is CSS and checked by eye; this pins the element the
  // rule targets, one per row.
  it('truncates long folders', async () => {
    recents.current = ['/Users/ann/a/very/deep/folder/that/goes/on/and/on/qec.md', '/Users/ann/b.md']
    const { target } = mountApp()
    await vi.waitFor(() => expect(target.querySelectorAll('.welcome-recent-folder')).toHaveLength(2))
  })

  // Both links open in the system browser — a plain <a href> would navigate
  // the webview away and destroy the app state.
  it('opens the guides and discussions in the browser', async () => {
    recents.current = ['/papers/thesis.md']
    const { target } = mountApp()
    await vi.waitFor(() => expect(target.querySelector('.welcome')).not.toBeNull())

    buttonByText(target, 'Guides at halmoseditor.com')!.click()
    expect(Browser.OpenURL).toHaveBeenCalledWith('https://www.halmoseditor.com/guides')
    buttonByText(target, 'Questions and ideas')!.click()
    expect(Browser.OpenURL).toHaveBeenCalledWith('https://github.com/richarc/halmos/discussions')
    expect(target.querySelector('.welcome a[href]')).toBeNull()
    expect(target.querySelector('.welcome-help')?.textContent).toContain('Help → Report an Issue')
  })

  // The hint is drawn by CSS from data-shortcut, so a button's text stays
  // its label.
  it('shows the shortcut hints without changing the labels', async () => {
    recents.current = ['/papers/thesis.md']
    const { target } = mountApp()
    await vi.waitFor(() => expect(buttonByText(target, 'New Document')).toBeDefined())

    expect(buttonByText(target, 'New Document')!.dataset.shortcut).toBe('⌘N')
    // Scoped to the welcome pane: the toolbar has its own Open… button.
    expect(buttonByText(target.querySelector('.welcome')!, 'Open…')!.dataset.shortcut).toBe('⌘O')
  })

  // With nothing left to list, the pane goes the way a first launch does:
  // straight into a new templated document.
  it('Clear empties the list and starts a new document', async () => {
    recents.current = ['/papers/thesis.md']
    const { target } = mountApp()
    await vi.waitFor(() => expect(buttonByText(target, 'Clear')).toBeDefined())

    buttonByText(target, 'Clear')!.click()

    await vi.waitFor(() => expect(target.querySelector('.welcome')).toBeNull())
    expect(DocumentService.ClearRecents).toHaveBeenCalled()
    await vi.waitFor(() =>
      expect(target.querySelector('.editor-pane')?.textContent).toContain('bibliography: references.bib'),
    )
  })

  it('names the start screen button New Document', async () => {
    recents.current = ['/papers/thesis.md']
    const { target } = mountApp()
    await vi.waitFor(() => expect(target.querySelector('.welcome')).not.toBeNull())
    const welcome = target.querySelector<HTMLElement>('.welcome')!
    expect(buttonByText(welcome, 'New Document')).toBeDefined()
    expect(buttonByText(welcome, 'New document')).toBeUndefined()
  })

  it('offers both New document and Open… when recents exist', async () => {
    recents.current = ['/papers/thesis.md']
    const { target } = mountApp()

    await vi.waitFor(() => expect(target.querySelector('.welcome')).not.toBeNull())
    expect(buttonByText(target, 'New Document')).toBeDefined()
    expect(buttonByText(target.querySelector('.welcome')!, 'Open…')).toBeDefined()
  })

  it('routes Open… through the same file dialog as the toolbar', async () => {
    recents.current = ['/papers/thesis.md']
    const { target } = mountApp()
    await vi.waitFor(() => expect(target.querySelector('.welcome')).not.toBeNull())

    buttonByText(target.querySelector('.welcome')!, 'Open…')!.click()
    flushSync()

    expect(DocumentService.Open).toHaveBeenCalled()
  })
})

describe('new documents', () => {
  const editorText = (target: HTMLElement) =>
    target.querySelector('.editor-pane')?.textContent ?? ''
  const dialog = (target: HTMLElement) =>
    target.querySelector('dialog[aria-label="New document"]') as HTMLDialogElement | null

  it('opens the New… dialog from the welcome pane and File → New', async () => {
    recents.current = ['/papers/thesis.md']
    const { target } = mountApp()
    await vi.waitFor(() => expect(buttonByText(target, 'New Document')).toBeDefined())

    buttonByText(target, 'New Document')!.click()
    flushSync()
    expect(dialog(target)?.open).toBe(true)

    buttonByText(target, 'Cancel')!.click()
    flushSync()
    expect(dialog(target)?.open).toBe(false)
    // Cancelling made nothing: the welcome pane is still there.
    expect(target.querySelector('.welcome')).not.toBeNull()

    listeners['menu:new']({ data: null })
    flushSync()
    expect(dialog(target)?.open).toBe(true)
  })

  async function openNewDialog() {
    recents.current = ['/papers/thesis.md']
    const { target } = mountApp()
    await vi.waitFor(() => expect(buttonByText(target, 'New Document')).toBeDefined())
    buttonByText(target, 'New Document')!.click()
    flushSync()
    return target
  }

  const radio = (target: HTMLElement, value: string) =>
    dialog(target)!.querySelector(`input[type="radio"][value="${value}"]`) as HTMLInputElement

  it('creates the document and its bibliography beside it, then loads it', async () => {
    DocumentService.ChooseNewDocumentPath.mockResolvedValueOnce('/papers/draft.md')
    const target = await openNewDialog()
    buttonByText(target, 'Create…')!.click()
    flushSync()
    // Step two: the bibliography choice, defaulting to the document's name.
    expect(radio(target, 'same').checked).toBe(true)
    expect(DocumentService.ChooseNewDocumentPath).not.toHaveBeenCalled()
    buttonByText(target, 'Continue…')!.click()

    await vi.waitFor(() => expect(DocumentService.CreateDocument).toHaveBeenCalled())
    const [path, content, bibName, bibContent] = DocumentService.CreateDocument.mock.calls[0]
    expect(path).toBe('/papers/draft.md')
    expect(content).toContain('bibliography: draft.bib')
    expect(content).toContain('csl: apa')
    expect(bibName).toBe('draft.bib')
    expect(bibContent.startsWith('%')).toBe(true)

    await vi.waitFor(() => expect(editorText(target)).toContain('bibliography: draft.bib'))
    expect(target.querySelector('.welcome')).toBeNull()
    // A document that was just written to disk is not dirty.
    expect(target.querySelector('.status-bar')?.textContent).not.toContain('Edited')
    expect(target.querySelector('.status-bar')?.textContent).toContain('draft.md')
  })

  it('creates a bibliography with a different name, adding .bib', async () => {
    DocumentService.ChooseNewDocumentPath.mockResolvedValueOnce('/papers/draft.md')
    const target = await openNewDialog()
    buttonByText(target, 'Create…')!.click()
    flushSync()
    radio(target, 'new').click()
    flushSync()
    expect((buttonByText(target, 'Continue…') as HTMLButtonElement).disabled).toBe(true)
    const name = dialog(target)!.querySelector('input[type="text"]') as HTMLInputElement
    name.value = 'shared'
    name.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
    expect((buttonByText(target, 'Continue…') as HTMLButtonElement).disabled).toBe(false)
    buttonByText(target, 'Continue…')!.click()

    await vi.waitFor(() => expect(DocumentService.CreateDocument).toHaveBeenCalled())
    const [, content, bibName, bibContent] = DocumentService.CreateDocument.mock.calls[0]
    expect(content).toContain('bibliography: shared.bib')
    expect(bibName).toBe('shared.bib')
    expect(bibContent.startsWith('%')).toBe(true)
  })

  it('points at an existing library, relative when beside the document', async () => {
    DocumentService.ChooseNewDocumentPath.mockResolvedValueOnce('/papers/draft.md')
    DocumentService.ChooseBibliography.mockResolvedValueOnce('/papers/lib/refs.bib')
    const target = await openNewDialog()
    buttonByText(target, 'Create…')!.click()
    flushSync()
    radio(target, 'existing').click()
    flushSync()
    expect((buttonByText(target, 'Continue…') as HTMLButtonElement).disabled).toBe(true)
    buttonByText(target, 'Choose…')!.click()
    await vi.waitFor(() => expect(dialog(target)!.textContent).toContain('/papers/lib/refs.bib'))
    expect((buttonByText(target, 'Continue…') as HTMLButtonElement).disabled).toBe(false)
    buttonByText(target, 'Continue…')!.click()

    await vi.waitFor(() => expect(DocumentService.CreateDocument).toHaveBeenCalled())
    const [, content, bibName, bibContent] = DocumentService.CreateDocument.mock.calls[0]
    expect(content).toContain('bibliography: lib/refs.bib')
    expect(bibName).toBe('lib/refs.bib')
    expect(bibContent).toBe('')
  })

  it('points at an existing library absolutely when it is elsewhere', async () => {
    DocumentService.ChooseNewDocumentPath.mockResolvedValueOnce('/papers/draft.md')
    DocumentService.ChooseBibliography.mockResolvedValueOnce('/Users/me/Library/refs.bib')
    const target = await openNewDialog()
    buttonByText(target, 'Create…')!.click()
    flushSync()
    radio(target, 'existing').click()
    flushSync()
    buttonByText(target, 'Choose…')!.click()
    await vi.waitFor(() => expect(dialog(target)!.textContent).toContain('/Users/me/Library/refs.bib'))
    buttonByText(target, 'Continue…')!.click()

    await vi.waitFor(() => expect(DocumentService.CreateDocument).toHaveBeenCalled())
    const [, content, bibName] = DocumentService.CreateDocument.mock.calls[0]
    expect(content).toContain('bibliography: /Users/me/Library/refs.bib')
    expect(bibName).toBe('/Users/me/Library/refs.bib')
  })

  // Names as the Citation Style menu shows them; the values stay the ids
  // that go into the frontmatter.
  it('lists citation styles by name', async () => {
    const target = await openNewDialog()
    const options = [...(dialog(target)!.querySelector('select') as HTMLSelectElement).options]
    expect(options.map((o) => o.textContent)).toEqual(['APA', 'Chicago (author-date)', 'Harvard', 'IEEE', 'Vancouver'])
    expect(options.map((o) => o.value)).toEqual(['apa', 'chicago-author-date', 'harvard', 'ieee', 'vancouver'])
  })

  it('goes back to the first step without losing the style', async () => {
    const target = await openNewDialog()
    const select = dialog(target)!.querySelector('select') as HTMLSelectElement
    select.value = 'ieee'
    select.dispatchEvent(new Event('change', { bubbles: true }))
    flushSync()
    buttonByText(target, 'Create…')!.click()
    flushSync()
    buttonByText(target, 'Back')!.click()
    flushSync()
    expect((dialog(target)!.querySelector('select') as HTMLSelectElement).value).toBe('ieee')
    expect(buttonByText(target, 'Create…')).toBeDefined()
  })

  it('writes the commented template and no bibliography when unticked', async () => {
    recents.current = ['/papers/thesis.md']
    DocumentService.ChooseNewDocumentPath.mockResolvedValueOnce('/papers/notes.md')
    const { target } = mountApp()
    await vi.waitFor(() => expect(buttonByText(target, 'New Document')).toBeDefined())

    buttonByText(target, 'New Document')!.click()
    flushSync()
    const box = dialog(target)!.querySelector('input[type="checkbox"]') as HTMLInputElement
    box.click()
    flushSync()
    expect(dialog(target)!.querySelector('select')).toBeNull()
    buttonByText(target, 'Create…')!.click()

    await vi.waitFor(() => expect(DocumentService.CreateDocument).toHaveBeenCalled())
    const [, content, bibName] = DocumentService.CreateDocument.mock.calls[0]
    expect(content).toContain('# bibliography: references.bib')
    expect(bibName).toBe('')
  })

  it('does nothing when the save panel is cancelled', async () => {
    const target = await openNewDialog()
    buttonByText(target, 'Create…')!.click()
    flushSync()
    buttonByText(target, 'Continue…')!.click()

    await vi.waitFor(() => expect(DocumentService.ChooseNewDocumentPath).toHaveBeenCalled())
    await Promise.resolve()
    expect(DocumentService.CreateDocument).not.toHaveBeenCalled()
    expect(target.querySelector('.welcome')).not.toBeNull()
  })
})

describe('toolbar', () => {
  it('labels and groups the toolbar buttons', async () => {
    recents.current = []
    const { target } = mountApp()
    await vi.waitFor(() => expect(target.querySelector('.editor-pane')).not.toBeNull())
    expect([...target.querySelectorAll('.toolbar button')].map((b) => b.textContent?.trim())).toEqual([
      'Outline', 'Open…', 'Save', 'Cite…', 'Chart…', 'Table…', 'Export PDF…',
    ])
    expect(target.querySelectorAll('.toolbar .toolbar-group')).toHaveLength(4)
  })

  it("the Outline button shows the panel's state and toggles it", async () => {
    recents.current = []
    const { target } = mountApp()
    await vi.waitFor(() => expect(target.querySelector('.outline-toggle')).not.toBeNull())
    const toggle = target.querySelector('.outline-toggle') as HTMLButtonElement
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
    expect(toggle.title).toBe('Show outline (⌘⌥O)')
    toggle.click()
    await vi.waitFor(() => expect(DocumentService.UpdateSettings).toHaveBeenCalled())
    expect(DocumentService.UpdateSettings.mock.calls[0][0].showOutline).toBe(true)
  })

  it('the Outline button reads as pressed while the outline is shown', async () => {
    recents.current = []
    settings.current = { ...DEFAULT_SETTINGS, showOutline: true }
    const { target } = mountApp()
    await vi.waitFor(() => expect(target.querySelector('.outline')).not.toBeNull())
    const toggle = target.querySelector('.outline-toggle') as HTMLButtonElement
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
    expect(toggle.title).toBe('Hide outline (⌘⌥O)')
  })
})

describe('outline panel', () => {
  it('is hidden by default with no reveal arrow', async () => {
    recents.current = []
    const { target } = mountApp()
    await vi.waitFor(() => expect(target.querySelector('.editor-pane')).not.toBeNull())
    expect(target.querySelector('.outline')).toBeNull()
    expect(target.querySelector('.outline-reveal')).toBeNull()
    expect(target.querySelector('.outline-arrow')).toBeNull()
  })

  it('shows when the setting is on and lists the document headings', async () => {
    recents.current = []
    settings.current = { ...DEFAULT_SETTINGS, showOutline: true }
    const { target } = mountApp()
    await vi.waitFor(() => expect(target.querySelector('.outline')).not.toBeNull())
    expect(target.querySelector('.outline-heading')?.textContent).toBe('Outline')

    listeners['menu:open-recent'] // ensure listeners registered
    // Load a document with headings through the open-recent path.
    DocumentService.OpenPath.mockResolvedValueOnce({
      path: '/papers/p.md',
      content: '# One\n\n## Two\n',
    })
    listeners['menu:open-recent']({ data: '/papers/p.md' })
    await vi.waitFor(() =>
      expect([...target.querySelectorAll('.outline-entry')].map((b) => b.textContent?.trim())).toEqual([
        'One',
        'Two',
      ]),
    )
  })

  it('says how to add a heading when there are none', async () => {
    recents.current = []
    settings.current = { ...DEFAULT_SETTINGS, showOutline: true }
    const { target } = mountApp()
    await vi.waitFor(() => expect(target.querySelector('.outline')).not.toBeNull())
    DocumentService.OpenPath.mockResolvedValueOnce({ path: '/papers/plain.md', content: 'Just prose.\n' })
    listeners['menu:open-recent']({ data: '/papers/plain.md' })
    await vi.waitFor(() =>
      expect([...target.querySelectorAll('.outline-empty')].map((p) => p.textContent)).toEqual([
        'No headings yet.',
        'Lines that start with # appear here.',
      ]),
    )
  })

  it('marks top-level headings and titles each row with its text', async () => {
    recents.current = []
    settings.current = { ...DEFAULT_SETTINGS, showOutline: true }
    const { target } = mountApp()
    await vi.waitFor(() => expect(target.querySelector('.outline')).not.toBeNull())
    DocumentService.OpenPath.mockResolvedValueOnce({ path: '/papers/p.md', content: '# One\n\n## Two\n' })
    listeners['menu:open-recent']({ data: '/papers/p.md' })
    await vi.waitFor(() => expect(target.querySelectorAll('.outline-entry')).toHaveLength(2))
    const [one, two] = [...target.querySelectorAll<HTMLButtonElement>('.outline-entry')]
    expect(one.classList.contains('outline-top')).toBe(true)
    expect(two.classList.contains('outline-top')).toBe(false)
    expect([one.title, two.title]).toEqual(['One', 'Two'])
  })

  it('hides through the toolbar button', async () => {
    recents.current = []
    settings.current = { ...DEFAULT_SETTINGS, showOutline: true }
    const { target } = mountApp()
    await vi.waitFor(() => expect(target.querySelector('.outline')).not.toBeNull())

    ;(target.querySelector('.outline-toggle') as HTMLButtonElement).click()
    await vi.waitFor(() => expect(DocumentService.UpdateSettings).toHaveBeenCalled())
    expect(DocumentService.UpdateSettings.mock.calls[0][0].showOutline).toBe(false)
  })
})

describe('first launch', () => {
  it('templates the document when there are no recents', async () => {
    recents.current = []
    const { target } = mountApp()

    await vi.waitFor(() => {
      expect(target.querySelector('.editor-pane')?.textContent).toContain(
        'bibliography: references.bib',
      )
    })
    expect(target.querySelector('.welcome')).toBeNull()
    expect(target.querySelector('.status-bar')?.textContent).not.toContain('Edited')
  })

  it('shows the welcome pane and leaves the document empty when recents exist', async () => {
    recents.current = ['/papers/thesis.md']
    const { target } = mountApp()

    await vi.waitFor(() => expect(target.querySelector('.welcome')).not.toBeNull())
    expect(target.querySelector('.editor-pane')?.textContent).not.toContain('bibliography')
  })

  it('still templates the document when Settings() rejects', async () => {
    recents.current = []
    DocumentService.Settings.mockRejectedValueOnce(new Error('boom'))
    const { target } = mountApp()

    await vi.waitFor(() => {
      expect(target.querySelector('.editor-pane')?.textContent).toContain(
        'bibliography: references.bib',
      )
    })
    expect(target.querySelector('.welcome')).toBeNull()
  })
})

describe('scroll sync', () => {
  it('does not move the preview while sync is off', async () => {
    settings.current = { ...DEFAULT_SETTINGS }
    recents.current = []
    const { target } = mountApp()
    await vi.waitFor(() => expect(target.querySelector('.cm-scroller')).not.toBeNull())

    const pane = target.querySelector('.preview-pane') as HTMLElement
    Object.defineProperty(pane, 'scrollHeight', { value: 4000, configurable: true })
    const scroller = target.querySelector('.cm-scroller') as HTMLElement
    scroller.dispatchEvent(new Event('scroll'))
    await new Promise((r) => requestAnimationFrame(() => r(null)))

    expect(pane.scrollTop).toBe(0)
  })

  // Deferred review finding, v0.5: the scroll-sync frame was requested and
  // never cancelled. Latent for as long as App is the root component and only
  // unmounts when the process is going away anyway — but it is a leak the
  // moment anything else unmounts it, and App already has teardown to hang it
  // off, so there is no reason to leave it pending.
  //
  // Asserting that cancelAnimationFrame was *called* proves nothing:
  // CodeMirror cancels frames of its own on destroy, so that passes against
  // an App that cancels nothing. This does the accounting instead — every
  // frame requested must have run or been cancelled by the time the unmount
  // returns — which fails against the unfixed App and cannot be satisfied by
  // somebody else's teardown.
  it('leaves no scroll-sync frame pending after unmount', async () => {
    settings.current = { ...DEFAULT_SETTINGS, syncScrolling: true }
    recents.current = []
    const { target } = mountApp()
    await vi.waitFor(() => expect(DocumentService.Settings).toHaveBeenCalled())
    // Wait for onMount's async startup to have finished seeding the template,
    // not merely for the editor to exist. Unmounting between those two points
    // makes doNew() run against a torn-down component — a different race, and
    // not the one under test.
    await vi.waitFor(() =>
      expect(target.querySelector('.editor-pane')?.textContent).toContain('bibliography'),
    )
    flushSync()

    const pending = new Set<number>()
    const realRequest = window.requestAnimationFrame.bind(window)
    const realCancel = window.cancelAnimationFrame.bind(window)
    const request = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((cb: FrameRequestCallback) => {
        const id = realRequest((t) => {
          pending.delete(id)
          cb(t)
        })
        pending.add(id)
        return id
      })
    const cancel = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id: number) => {
      pending.delete(id)
      realCancel(id)
    })

    const scroller = target.querySelector('.cm-scroller') as HTMLElement
    scroller.dispatchEvent(new Event('scroll')) // queues the frame
    expect(pending.size).toBeGreaterThan(0)

    // Unmount before it runs — the case the finding is about.
    unmount(mounted!)
    mounted = undefined

    expect([...pending]).toEqual([])
    request.mockRestore()
    cancel.mockRestore()
  })

  it('reads the persisted setting at startup', async () => {
    settings.current = { ...DEFAULT_SETTINGS, syncScrolling: true }
    recents.current = []
    mountApp()
    await vi.waitFor(() => expect(DocumentService.Settings).toHaveBeenCalled())
  })

  it('re-reads the setting when the menu changes it', async () => {
    settings.current = { ...DEFAULT_SETTINGS }
    recents.current = []
    mountApp()
    await vi.waitFor(() => expect(DocumentService.Settings).toHaveBeenCalled())

    const before = DocumentService.Settings.mock.calls.length
    settings.current = { ...DEFAULT_SETTINGS, syncScrolling: true }
    listeners['settings:changed']({ data: null })
    await vi.waitFor(() =>
      expect(DocumentService.Settings.mock.calls.length).toBeGreaterThan(before),
    )
  })
})

describe('theme', () => {
  it('applies the persisted explicit theme', async () => {
    settings.current = { ...DEFAULT_SETTINGS, theme: 'dark' }
    recents.current = []
    stubMatchMedia(false)
    mountApp()

    await vi.waitFor(() =>
      expect(document.documentElement.dataset.theme).toBe('dark'),
    )
  })

  it('follows the system preference when the setting is system', async () => {
    settings.current = { ...DEFAULT_SETTINGS }
    recents.current = []
    stubMatchMedia(true)
    mountApp()

    await vi.waitFor(() =>
      expect(document.documentElement.dataset.theme).toBe('dark'),
    )
  })

  it('ignores the system preference when the setting is explicit', async () => {
    // The case most likely to regress: a system change must not override an
    // explicit choice.
    settings.current = { ...DEFAULT_SETTINGS, theme: 'light' }
    recents.current = []
    const media = stubMatchMedia(false)
    mountApp()
    await vi.waitFor(() =>
      expect(document.documentElement.dataset.theme).toBe('light'),
    )

    media.fire(true)
    flushSync()

    expect(document.documentElement.dataset.theme).toBe('light')
  })

  it('flips the theme when the system preference changes and the setting is system', async () => {
    // Positive counterpart to the "ignores" test above: proves the change
    // listener is actually wired, not merely that firing it does nothing.
    // Without this, deleting the addEventListener call in App.svelte would
    // leave both tests passing for the wrong reason.
    settings.current = { ...DEFAULT_SETTINGS }
    recents.current = []
    const media = stubMatchMedia(false)
    mountApp()
    await vi.waitFor(() =>
      expect(document.documentElement.dataset.theme).toBe('light'),
    )

    media.fire(true)
    flushSync()

    expect(document.documentElement.dataset.theme).toBe('dark')
  })
})

describe('fold menu', () => {
  const WITH_CODE =
    '# Results\n\nSome prose that explains the numbers.\n\n```js\nconst x = 1\nconst y = 2\n```\n'

  async function mountWithCodeBlock() {
    recents.current = ['/tmp/paper.md']
    DocumentService.OpenPath.mockResolvedValueOnce({
      path: '/tmp/paper.md',
      content: WITH_CODE,
    })
    const { target } = mountApp()
    await vi.waitFor(() => expect(target.querySelector('.welcome')).not.toBeNull())

    listeners['menu:open-recent']({ data: '/tmp/paper.md' })
    await vi.waitFor(() => expect(target.textContent).toContain('const x'))
    return target
  }

  it('folds every code block when the menu asks', async () => {
    const target = await mountWithCodeBlock()

    listeners['menu:fold']({ data: 'fold-all-code' })
    flushSync()

    // The placeholder pill is what replaces the hidden lines.
    await vi.waitFor(() =>
      expect(target.querySelector('.cm-foldPlaceholder')).not.toBeNull(),
    )
    // The discriminator from CodeMirror's built-in foldAll: that command
    // would also fold the heading, swallowing this prose along with it.
    // Only the custom fold-all-code command leaves prose outside a fence
    // visible while folding the code block. Scoped to .editor-pane because
    // .preview-pane renders the raw markdown independently of CodeMirror's
    // fold state and would contain the prose regardless of which command ran.
    expect(target.querySelector('.editor-pane')?.textContent).toContain(
      'Some prose that explains the numbers.',
    )
  })

  it('ignores an unknown command name', async () => {
    const target = await mountWithCodeBlock()

    // Must not throw — the same tolerance menu:format already has.
    listeners['menu:fold']({ data: 'not-a-command' })
    flushSync()

    expect(target.querySelector('.cm-foldPlaceholder')).toBeNull()
  })
})

describe('chart builder', () => {
  const WITH_CHART = [
    '# Results',
    '',
    '```vega-lite',
    '{"data": {"values": [{"a": 1}]}, "mark": "line", "encoding": {"x": {"field": "a", "type": "quantitative"}, "y": {"field": "a", "type": "quantitative"}}}',
    '```',
    '',
  ].join('\n')

  const WITH_TRANSFORM = [
    '# Results',
    '',
    '```vega-lite',
    '{"data": {"values": []}, "transform": [{"filter": "true"}], "mark": "line"}',
    '```',
    '',
  ].join('\n')

  it('opens an empty builder from prose', async () => {
    const target = await openDoc('# Results\n\nJust prose.\n')
    listeners['menu:insert-chart']({ data: null })
    flushSync()
    expect(target.querySelector('.chart-builder')).not.toBeNull()
    expect(target.textContent).toContain('Insert chart')
  })

  it('prefills the builder when the cursor is inside a chart block', async () => {
    const target = await openDoc(WITH_CHART)
    const view = EditorView.findFromDOM(target.querySelector('.cm-editor')!)!
    view.dispatch({ selection: { anchor: WITH_CHART.indexOf('"mark"') } })
    listeners['menu:insert-chart']({ data: null })
    flushSync()
    expect(target.textContent).toContain('Edit chart')
  })

  it('refuses a spec it cannot model and leaves the document untouched', async () => {
    const target = await openDoc(WITH_TRANSFORM)
    const view = EditorView.findFromDOM(target.querySelector('.cm-editor')!)!
    const before = view.state.doc.toString()
    view.dispatch({ selection: { anchor: WITH_TRANSFORM.indexOf('"filter"') } })
    listeners['menu:insert-chart']({ data: null })
    flushSync()

    expect(target.querySelector('.chart-builder')).toBeNull()
    expect(target.textContent).toContain('That chart filters or calculates its data ("transform")')
    expect(view.state.doc.toString()).toBe(before)
  })

  it('inserts a fenced block at the cursor on commit', async () => {
    const target = await openDoc('# Results\n\nJust prose.\n')
    listeners['menu:insert-chart']({ data: null })
    flushSync()

    const box = target.querySelector<HTMLTextAreaElement>('#chart-paste')!
    box.value = 'dose,response\n0,1\n5,2\n'
    box.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
    for (const [field, value] of [
      ['x', 'dose'],
      ['y', 'response'],
    ]) {
      const el = target.querySelector<HTMLSelectElement>(`select[data-field="${field}"]`)!
      el.value = value
      el.dispatchEvent(new Event('change', { bubbles: true }))
      flushSync()
    }
    ;[...target.querySelectorAll('button')]
      .find((b) => b.textContent?.trim() === 'Insert')!
      .click()
    flushSync()

    const view = EditorView.findFromDOM(target.querySelector('.cm-editor')!)!
    const doc = view.state.doc.toString()
    expect(doc).toContain('```vega-lite')
    expect(doc).toContain('"field": "dose"')
    expect(target.querySelector('.chart-builder')).toBeNull()
  })

  // Critical finding: commitChart's insert branch called editor.insertAtCursor,
  // a bare replaceSelection with no leading newline. Leaving the cursor
  // mid-line (the ordinary place it sits after typing a sentence) and
  // inserting a chart merged the fence into the prose line — markdown then
  // rendered the whole dataset as visible text, and Lezer would not parse it
  // as a FencedCode node, so the builder could never reopen it. This is the
  // path that broke; it now goes through insertBlockAtCursor instead.
  it('inserts on its own line even when the cursor sits mid-line, not merged into the prose', async () => {
    const target = await openDoc('# Results\n\nJust prose.\n')
    const view = EditorView.findFromDOM(target.querySelector('.cm-editor')!)!
    const midLine = view.state.doc.toString().indexOf('Just prose.') + 'Just prose.'.length
    view.dispatch({ selection: { anchor: midLine } })

    listeners['menu:insert-chart']({ data: null })
    flushSync()

    const box = target.querySelector<HTMLTextAreaElement>('#chart-paste')!
    box.value = 'dose,response\n0,1\n5,2\n'
    box.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
    for (const [field, value] of [
      ['x', 'dose'],
      ['y', 'response'],
    ]) {
      const el = target.querySelector<HTMLSelectElement>(`select[data-field="${field}"]`)!
      el.value = value
      el.dispatchEvent(new Event('change', { bubbles: true }))
      flushSync()
    }
    ;[...target.querySelectorAll('button')]
      .find((b) => b.textContent?.trim() === 'Insert')!
      .click()
    flushSync()

    const doc = view.state.doc.toString()
    expect(doc).toMatch(/(^|\n)```vega-lite/)
    // The original sentence survives whole, on its own line — not merged
    // into the fence, which is what made the document unrenderable and the
    // block unreopenable.
    expect(doc.split('\n')).toContain('Just prose.')
  })

  it('does nothing from the welcome screen', async () => {
    recents.current = ['/tmp/paper.md']
    const { target } = mountApp()
    await vi.waitFor(() => expect(target.querySelector('.welcome')).not.toBeNull())
    listeners['menu:insert-chart']({ data: null })
    flushSync()
    expect(target.querySelector('.chart-builder')).toBeNull()
  })

  it('opens targeting an empty fence rather than refusing it as invalid JSON', async () => {
    const target = await openDoc(['# Results', '', '```vega-lite', '```', ''].join('\n'))
    const view = EditorView.findFromDOM(target.querySelector('.cm-editor')!)!
    const content = view.state.doc.toString()
    view.dispatch({ selection: { anchor: content.indexOf('```vega-lite') + 5 } })
    listeners['menu:insert-chart']({ data: null })
    flushSync()

    // Not refused, and not prefilled either — a fresh builder targeted at
    // replacing this block on commit.
    expect(target.querySelector('.chart-builder')).not.toBeNull()
    expect(target.textContent).toContain('Insert chart')
  })

  it('keeps the fence label when updating a labelled chart', async () => {
    const labelled = WITH_CHART.replace('```vega-lite', '```vega-lite {#fig:yield}')
    const target = await openDoc(labelled)
    const view = EditorView.findFromDOM(target.querySelector('.cm-editor')!)!
    view.dispatch({ selection: { anchor: labelled.indexOf('"mark"') } })
    listeners['menu:insert-chart']({ data: null })
    flushSync()
    expect(target.textContent).toContain('Edit chart')

    const markSelect = target.querySelector<HTMLSelectElement>('select[data-field="chart-type"]')!
    markSelect.value = 'bar'
    markSelect.dispatchEvent(new Event('change', { bubbles: true }))
    flushSync()
    ;[...target.querySelectorAll('button')]
      .find((b) => b.textContent?.trim() === 'Update')!
      .click()
    flushSync()

    const doc = view.state.doc.toString()
    expect(doc).toContain('```vega-lite {#fig:yield}\n')
    expect(doc).toContain('"mark": "bar"')
  })

  it('replaces exactly the target block in place on an edited-chart commit, leaving prose intact', async () => {
    const target = await openDoc(WITH_CHART)
    const view = EditorView.findFromDOM(target.querySelector('.cm-editor')!)!
    view.dispatch({ selection: { anchor: WITH_CHART.indexOf('"mark"') } })
    listeners['menu:insert-chart']({ data: null })
    flushSync()
    expect(target.textContent).toContain('Edit chart')

    const markSelect = target.querySelector<HTMLSelectElement>('select[data-field="chart-type"]')!
    markSelect.value = 'bar'
    markSelect.dispatchEvent(new Event('change', { bubbles: true }))
    flushSync()

    ;[...target.querySelectorAll('button')]
      .find((b) => b.textContent?.trim() === 'Update')!
      .click()
    flushSync()

    const doc = view.state.doc.toString()
    expect(target.querySelector('.chart-builder')).toBeNull()
    expect((doc.match(/```vega-lite/g) ?? []).length).toBe(1)
    expect(doc).toContain('"mark": "bar"')
    expect(doc).not.toContain('"mark": "line"')
    expect(doc).toContain('# Results')
  })

  // Critical finding: replaceRange used a stashed { from, to } blindly. The
  // chart-builder modal does not block the keyboard, so a stray edit reaching
  // the editor behind it — three characters typed inside the target block —
  // shifted the closing fence without the stashed range knowing, and commit
  // wrote using the stale offsets, leaving the old fence as garbage after the
  // new text. commitChart now re-validates the range against the live
  // document immediately before writing and refuses rather than corrupt it.
  it('refuses to commit when the target block changed while the builder was open', async () => {
    const target = await openDoc(WITH_CHART)
    const view = EditorView.findFromDOM(target.querySelector('.cm-editor')!)!
    const insidePos = WITH_CHART.indexOf('"mark"')
    view.dispatch({ selection: { anchor: insidePos } })
    listeners['menu:insert-chart']({ data: null })
    flushSync()
    expect(target.textContent).toContain('Edit chart')

    // Simulates a stray keystroke reaching the editor behind the modal —
    // exactly what the paste-box autofocus in ChartBuilder.svelte exists to
    // prevent in the real app, and exactly what the commit-time validation
    // exists to catch if it happens anyway.
    view.dispatch({ changes: { from: insidePos, to: insidePos, insert: 'XYZ' } })
    const stray = view.state.doc.toString()

    ;[...target.querySelectorAll('button')]
      .find((b) => b.textContent?.trim() === 'Update')!
      .click()
    flushSync()

    expect(target.querySelector('.chart-builder')).toBeNull()
    expect(target.textContent).toContain("wasn't changed")
    // The document is exactly the stray edit — commit must refuse rather
    // than write using stale offsets, not merely avoid an obvious corruption.
    expect(view.state.doc.toString()).toBe(stray)
  })

  // Important finding: openChartBuilder had no re-entry guard. Firing
  // menu:insert-chart again while the builder is already open reassigned
  // chartTarget (even though chartInitial's new value would be silently
  // ignored, since ChartBuilder reads `initial` only once at mount) — so a
  // pending Insert silently turned into a Replace of whatever block the
  // cursor now sat in. openChartBuilder now no-ops while chartOpen is true.
  it('a second menu:insert-chart while already open does not turn Insert into Replace', async () => {
    const target = await openDoc(WITH_CHART)
    const view = EditorView.findFromDOM(target.querySelector('.cm-editor')!)!
    view.dispatch({ selection: { anchor: 0 } }) // in the heading, not inside the chart
    listeners['menu:insert-chart']({ data: null })
    flushSync()
    expect(target.textContent).toContain('Insert chart')

    // Move into the existing chart and re-fire the menu — must be a no-op
    // while the builder is already open, not a switch to replace mode.
    view.dispatch({ selection: { anchor: WITH_CHART.indexOf('"mark"') } })
    listeners['menu:insert-chart']({ data: null })
    flushSync()
    expect(target.textContent).toContain('Insert chart')

    // Cursor back to a safe prose position so the commit's outcome (insert
    // vs. replace) is unambiguous.
    view.dispatch({ selection: { anchor: 0 } })

    const box = target.querySelector<HTMLTextAreaElement>('#chart-paste')!
    box.value = 'dose,response\n0,1\n5,2\n'
    box.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
    for (const [field, value] of [
      ['x', 'dose'],
      ['y', 'response'],
    ]) {
      const el = target.querySelector<HTMLSelectElement>(`select[data-field="${field}"]`)!
      el.value = value
      el.dispatchEvent(new Event('change', { bubbles: true }))
      flushSync()
    }
    ;[...target.querySelectorAll('button')]
      .find((b) => b.textContent?.trim() === 'Insert')!
      .click()
    flushSync()

    const doc = view.state.doc.toString()
    // The original chart survives untouched, and a new one was inserted
    // alongside it — not in place of it.
    expect(doc).toContain('"field": "a"')
    expect(doc).toContain('"field": "dose"')
    expect((doc.match(/```vega-lite/g) ?? []).length).toBe(2)
  })

  // Minor finding: the builder could open on top of the unsaved-changes
  // confirm dialog, leaving that dialog's buttons keyboard-reachable behind a
  // modal with no focus trap. openChartBuilder now refuses while pendingAction
  // is set, same shape as its existing chartOpen/showWelcome guards.
  it('does not open the chart builder over the unsaved-changes confirm dialog', async () => {
    const target = await openDoc('# Results\n\nJust prose.\n')
    const view = EditorView.findFromDOM(target.querySelector('.cm-editor')!)!
    view.dispatch({ changes: { from: 0, to: 0, insert: 'x' } }) // make the document dirty
    flushSync()

    listeners['menu:new']({ data: null })
    flushSync()
    // The confirm dialog's content is always in the DOM (see the fix below),
    // so textContent can't tell shown from hidden — check the dialog's own
    // open state instead.
    expect(
      target.querySelector<HTMLDialogElement>('dialog[aria-label="Unsaved changes"]')!.open,
    ).toBe(true) // confirm dialog is up

    listeners['menu:insert-chart']({ data: null })
    flushSync()
    expect(target.querySelector('.chart-builder')).toBeNull()
  })

  // Same robustness gap in the other direction: close:confirm fires
  // regardless of what else is on screen, so without a guard it could raise
  // the unsaved-changes dialog behind the chart modal.
  it('does not raise the unsaved-changes dialog while the chart builder is open', async () => {
    const target = await openDoc('# Results\n\nJust prose.\n')
    listeners['menu:insert-chart']({ data: null })
    flushSync()
    expect(target.querySelector('.chart-builder')).not.toBeNull()

    listeners['close:confirm']({ data: null })
    flushSync()

    // The unsaved-changes dialog is now a native <dialog> that App.svelte
    // renders unconditionally (Dialog owns visibility via the `open` prop,
    // not an {#if}), so its "has unsaved changes" text is always present in
    // the DOM regardless of whether pendingAction is set — a textContent
    // check can no longer distinguish shown from hidden. The guard under
    // test (chartOpen, in the close:confirm handler) is unchanged; only the
    // way to observe its effect changes: query the dialog's own open state.
    const confirmDialog = target.querySelector<HTMLDialogElement>(
      'dialog[aria-label="Unsaved changes"]',
    )!
    expect(confirmDialog.open).toBe(false)
    expect(target.querySelector('.chart-builder')).not.toBeNull()
  })

  // A quit or close with a builder open asks before the chart is thrown
  // away, clean document or not; Keep Editing leaves everything as it was.
  it('asks before discarding the chart on quit, and Keep Editing keeps it', async () => {
    const target = await openDoc('# Results\n\nJust prose.\n')
    listeners['menu:insert-chart']({ data: null })
    flushSync()
    expect(DocumentService.SetBuilderOpen).toHaveBeenLastCalledWith(true)

    listeners['close:confirm']({ data: null })
    flushSync()

    const ask = target.querySelector<HTMLDialogElement>('dialog[aria-label="Discard chart"]')!
    expect(ask.open).toBe(true)
    expect(ask.textContent).toContain('Discard it and quit?')
    expect(
      target.querySelector<HTMLDialogElement>('dialog[aria-label="Unsaved changes"]')!.open,
    ).toBe(false)

    buttonByText(ask, 'Keep Editing')!.click()
    flushSync()
    expect(ask.open).toBe(false)
    expect(target.querySelector('.chart-builder')).not.toBeNull()
    expect(DocumentService.Quit).not.toHaveBeenCalled()
  })

  // role="alertdialog" makes screen readers announce this dialog as a
  // destructive interruption rather than a plain dialog — dropped once
  // already in this branch and restored, hence a test to keep it that way.
  it('marks the unsaved-changes confirm dialog as an alertdialog', async () => {
    const target = await openDoc('# Results\n\nJust prose.\n')
    const confirmDialog = target.querySelector<HTMLDialogElement>(
      'dialog[aria-label="Unsaved changes"]',
    )!
    expect(confirmDialog.getAttribute('role')).toBe('alertdialog')
  })
})

describe('table builder', () => {
  const WITH_TABLE = ['# Results', '', '| a | b |', '| --- | --- |', '| 1 | 2 |', '', 'After.', ''].join('\n')

  function typeCell(target: HTMLElement, row: number, col: number, value: string) {
    const input = target.querySelector<HTMLInputElement>(`input.td-cell[data-row="${row}"][data-col="${col}"]`)!
    input.value = value
    input.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
  }

  it('opens from the menu and from the toolbar', async () => {
    const target = await openDoc('# Results\n\nJust prose.\n')
    listeners['menu:insert-table']({ data: null })
    flushSync()
    expect(target.querySelector('.table-builder')).not.toBeNull()
    buttonByText(target, 'Cancel')!.click()
    flushSync()
    expect(target.querySelector('.table-builder')).toBeNull()
    buttonByText(target, 'Table…')!.click()
    flushSync()
    expect(target.querySelector('.table-builder')).not.toBeNull()
  })

  it('inserts a padded table at the cursor as its own block', async () => {
    const target = await openDoc('# Results\n\nJust prose.\n')
    const view = EditorView.findFromDOM(target.querySelector('.cm-editor')!)!
    view.dispatch({ selection: { anchor: view.state.doc.length } })
    listeners['menu:insert-table']({ data: null })
    flushSync()
    typeCell(target, 0, 0, 'x')
    buttonByText(target, 'Insert')!.click()
    flushSync()
    expect(view.state.doc.toString()).toContain('| Column 1 | Column 2 | Column 3 |\n| -------- | -------- | -------- |\n| x        |          |          |')
    expect(target.querySelector('.table-builder')).toBeNull()
  })

  it('inserting above prose leaves a blank line before it, not swallowing the paragraph', async () => {
    const content = '# Results\n\nAfter.\n'
    const target = await openDoc(content)
    const view = EditorView.findFromDOM(target.querySelector('.cm-editor')!)!
    view.dispatch({ selection: { anchor: content.indexOf('After.') } })
    listeners['menu:insert-table']({ data: null })
    flushSync()
    typeCell(target, 0, 0, 'x')
    buttonByText(target, 'Insert')!.click()
    flushSync()
    const doc = view.state.doc.toString()
    expect(doc).toContain('|\n\nAfter.')
    expect(doc).not.toContain('|\nAfter.')
  })

  it('inserting at the end of a document does not leave a double blank line', async () => {
    const content = '# Results\n\nJust prose.\n'
    const target = await openDoc(content)
    const view = EditorView.findFromDOM(target.querySelector('.cm-editor')!)!
    view.dispatch({ selection: { anchor: view.state.doc.length } })
    listeners['menu:insert-table']({ data: null })
    flushSync()
    typeCell(target, 0, 0, 'x')
    buttonByText(target, 'Insert')!.click()
    flushSync()
    const doc = view.state.doc.toString()
    expect(doc.endsWith('\n\n')).toBe(false)
    expect(doc.endsWith('|\n')).toBe(true)
  })

  it('replaces the table under the cursor', async () => {
    const target = await openDoc(WITH_TABLE)
    const view = EditorView.findFromDOM(target.querySelector('.cm-editor')!)!
    view.dispatch({ selection: { anchor: WITH_TABLE.indexOf('| 1') } })
    listeners['menu:insert-table']({ data: null })
    flushSync()
    expect(target.textContent).toContain('Edit table')
    typeCell(target, 0, 1, '42')
    buttonByText(target, 'Update')!.click()
    flushSync()
    const doc = view.state.doc.toString()
    expect(doc).toContain('| a   | b   |\n| --- | --- |\n| 1   | 42  |')
    expect(doc).not.toContain('| 1 | 2 |')
    expect(doc).toContain('After.')
  })

  async function openCaptioned(text: string, at: string) {
    const target = await openDoc(text)
    const view = EditorView.findFromDOM(target.querySelector('.cm-editor')!)!
    view.dispatch({ selection: { anchor: text.indexOf(at) } })
    listeners['menu:insert-table']({ data: null })
    flushSync()
    return { target, view }
  }

  it('opens a captioned table with the caption in its field, not as a row', async () => {
    const text = '# Results\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\n: Yield {#tbl:y}\n'
    const { target } = await openCaptioned(text, '| 1')
    expect(target.querySelectorAll('input.td-cell')).toHaveLength(2)
    expect(target.querySelector<HTMLInputElement>('input[data-field="caption"]')!.value).toBe('Yield')
  })

  it('keeps a heading right after the caption when the builder commits', async () => {
    const text = '# Results\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\n: Yield {#tbl:y}\n## Methods\n'
    const { target, view } = await openCaptioned(text, '| 1')
    buttonByText(target, 'Update')!.click()
    flushSync()
    expect(view.state.doc.toString()).toBe(
      '# Results\n\n| a   | b   |\n| --- | --- |\n| 1   | 2   |\n\n: Yield {#tbl:y}\n## Methods\n',
    )
  })

  it('round-trips a wrapped caption and its label', async () => {
    const text = '# Results\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\n: Yield by\ngroup {#tbl:y}\n\nAfter.\n'
    const { target, view } = await openCaptioned(text, '| 1')
    buttonByText(target, 'Update')!.click()
    flushSync()
    expect(view.state.doc.toString()).toContain('\n\n: Yield by group {#tbl:y}\n\nAfter.\n')
  })

  it('refuses to commit when the target moved while open', async () => {
    const target = await openDoc(WITH_TABLE)
    const view = EditorView.findFromDOM(target.querySelector('.cm-editor')!)!
    const inside = WITH_TABLE.indexOf('| 1')
    view.dispatch({ selection: { anchor: inside } })
    listeners['menu:insert-table']({ data: null })
    flushSync()
    view.dispatch({ changes: { from: inside, to: inside, insert: 'XYZ\n\n' } })
    const stray = view.state.doc.toString()
    buttonByText(target, 'Update')!.click()
    flushSync()
    expect(target.textContent).toContain("wasn't changed")
    expect(view.state.doc.toString()).toBe(stray)
    expect(target.querySelector('.table-builder')).toBeNull()
  })

  it('a second menu:insert-table while open is a no-op', async () => {
    const target = await openDoc(WITH_TABLE)
    const view = EditorView.findFromDOM(target.querySelector('.cm-editor')!)!
    view.dispatch({ selection: { anchor: WITH_TABLE.indexOf('After') } })
    listeners['menu:insert-table']({ data: null })
    flushSync()
    expect(target.textContent).toContain('Insert table')
    view.dispatch({ selection: { anchor: WITH_TABLE.indexOf('| 1') } })
    listeners['menu:insert-table']({ data: null })
    flushSync()
    expect(target.querySelectorAll('.table-builder')).toHaveLength(1)
    expect(target.textContent).toContain('Insert table')
  })

  it('the chart and table builders refuse to open over each other', async () => {
    const target = await openDoc('# Results\n\nJust prose.\n')
    listeners['menu:insert-table']({ data: null })
    flushSync()
    listeners['menu:insert-chart']({ data: null })
    flushSync()
    expect(target.querySelector('.chart-builder')).toBeNull()
    buttonByText(target, 'Cancel')!.click()
    flushSync()
    listeners['menu:insert-chart']({ data: null })
    flushSync()
    listeners['menu:insert-table']({ data: null })
    flushSync()
    expect(target.querySelector('.table-builder')).toBeNull()
    expect(target.querySelector('.chart-builder')).not.toBeNull()
  })

  it('does not open over the welcome pane', async () => {
    recents.current = ['/tmp/paper.md']
    const { target } = mountApp()
    await vi.waitFor(() => expect(target.querySelector('.welcome')).not.toBeNull())
    listeners['menu:insert-table']({ data: null })
    flushSync()
    expect(target.querySelector('.table-builder')).toBeNull()
  })

  it('quits a clean document once the table is discarded', async () => {
    const target = await openDoc('# Results\n\nJust prose.\n')
    listeners['menu:insert-table']({ data: null })
    flushSync()
    listeners['close:confirm']({ data: null })
    flushSync()
    const ask = target.querySelector<HTMLDialogElement>('dialog[aria-label="Discard table"]')!
    expect(ask.open).toBe(true)

    buttonByText(ask, 'Discard')!.click()
    flushSync()

    expect(target.querySelector('.table-builder')).toBeNull()
    await vi.waitFor(() => expect(DocumentService.Quit).toHaveBeenCalled())
  })
})

describe('insert code block', () => {
  async function openDoc(content: string) {
    recents.current = ['/tmp/paper.md']
    DocumentService.OpenPath.mockResolvedValueOnce({ path: '/tmp/paper.md', content })
    const { target } = mountApp()
    await vi.waitFor(() => expect(target.querySelector('.welcome')).not.toBeNull())
    listeners['menu:open-recent']({ data: '/tmp/paper.md' })
    await vi.waitFor(() => expect(target.textContent).toContain('Results'))
    return target
  }

  it('writes a fence carrying the language the menu named', async () => {
    const target = await openDoc('# Results\n\n')
    const view = EditorView.findFromDOM(target.querySelector('.cm-editor')!)!

    listeners['menu:insert-code']({ data: 'python' })
    flushSync()

    expect(view.state.doc.toString()).toContain('```python\n')
  })

  it('writes a bare fence for the Plain text item', async () => {
    const target = await openDoc('# Results\n\n')
    const view = EditorView.findFromDOM(target.querySelector('.cm-editor')!)!

    listeners['menu:insert-code']({ data: '' })
    flushSync()

    expect(view.state.doc.toString()).toContain('```\n\n```')
  })

  // Menu events arrive from AppKit through Go's event bus and never touch the
  // DOM, so a modal cannot intercept them — the same reason applyFormat and
  // applyFold carry this guard.
  it('is refused while the chart builder is open', async () => {
    const target = await openDoc('# Results\n\nJust prose.\n')
    const view = EditorView.findFromDOM(target.querySelector('.cm-editor')!)!
    listeners['menu:insert-chart']({ data: null })
    flushSync()
    expect(target.querySelector('.chart-builder')).not.toBeNull()
    const before = view.state.doc.toString()

    listeners['menu:insert-code']({ data: 'python' })
    flushSync()

    expect(view.state.doc.toString()).toBe(before)
  })

  it('does nothing from the welcome screen', async () => {
    recents.current = ['/tmp/paper.md']
    const { target } = mountApp()
    await vi.waitFor(() => expect(target.querySelector('.welcome')).not.toBeNull())
    const view = EditorView.findFromDOM(target.querySelector('.cm-editor')!)!
    const before = view.state.doc.toString()

    listeners['menu:insert-code']({ data: 'python' })
    flushSync()

    expect(view.state.doc.toString()).toBe(before)
  })
})

describe('export PDF', () => {
  // The export dialog names the file after the document, so the path has to
  // reach Go. Nothing static can catch a regression here: ExportPDF's
  // parameter is a plain string, so passing null for an unsaved document
  // would type-check and produce a nonsense filename.
  it('passes an empty path when no document is open', async () => {
    recents.current = ['/papers/thesis.md']
    const { target } = mountApp()
    await vi.waitFor(() => expect(target.querySelector('.welcome')).not.toBeNull())

    listeners['menu:export-pdf']({ data: null })
    flushSync()

    expect(DocumentService.ExportPDF).toHaveBeenCalledWith('', { header: '', footer: '', title: '' })
  })

  it('passes the open document’s path once one is open', async () => {
    recents.current = ['/tmp/paper.md']
    DocumentService.OpenPath.mockResolvedValueOnce({
      path: '/tmp/paper.md',
      content: '# Results\n',
    })
    const { target } = mountApp()
    await vi.waitFor(() => expect(target.querySelector('.welcome')).not.toBeNull())
    listeners['menu:open-recent']({ data: '/tmp/paper.md' })
    await vi.waitFor(() => expect(target.textContent).toContain('Results'))

    listeners['menu:export-pdf']({ data: null })
    flushSync()

    expect(DocumentService.ExportPDF).toHaveBeenCalledWith('/tmp/paper.md', { header: '', footer: '', title: '' })
  })

  it('passes the frontmatter’s header and footer, titled by the first heading', async () => {
    recents.current = ['/tmp/paper.md']
    DocumentService.OpenPath.mockResolvedValueOnce({
      path: '/tmp/paper.md',
      content: '---\nheader: "{title}"\nfooter: Page {page} of {pages}\n---\n# Results\n',
    })
    const { target } = mountApp()
    await vi.waitFor(() => expect(target.querySelector('.welcome')).not.toBeNull())
    listeners['menu:open-recent']({ data: '/tmp/paper.md' })
    await vi.waitFor(() => expect(target.textContent).toContain('Results'))

    listeners['menu:export-pdf']({ data: null })
    flushSync()

    expect(DocumentService.ExportPDF).toHaveBeenCalledWith(
      '/tmp/paper.md',
      expect.objectContaining({ header: '{title}', footer: 'Page {page} of {pages}', title: 'Results' }),
    )
  })
})

describe('export HTML', () => {
  async function openPaper() {
    recents.current = ['/tmp/paper.md']
    DocumentService.OpenPath.mockResolvedValueOnce({ path: '/tmp/paper.md', content: '# Results\n' })
    const mounted = mountApp()
    await vi.waitFor(() => expect(mounted.target.querySelector('.welcome')).not.toBeNull())
    listeners['menu:open-recent']({ data: '/tmp/paper.md' })
    await vi.waitFor(() => expect(mounted.target.textContent).toContain('Results'))
    return mounted
  }

  it('builds the page from the sheet and writes it where the panel chose', async () => {
    const { target } = await openPaper()
    DocumentService.ChooseHTMLExportPath.mockResolvedValueOnce('/tmp/out/paper.html')

    listeners['menu:export-html']({ data: null })

    await vi.waitFor(() =>
      expect(DocumentService.WriteHTMLExport).toHaveBeenCalledWith('/tmp/out/paper.html', 'PAGE'),
    )
    expect(DocumentService.ChooseHTMLExportPath).toHaveBeenCalledWith('/tmp/paper.md')
    const [root, opts] = htmlExport.buildStandaloneHTML.mock.calls[0]
    expect(root).toBe(target.querySelector('.sheet'))
    expect(opts.bodyFont).toContain('New York')
    expect(opts.css).toBe('DOC CSS')
    expect(opts.katexCss).toBe('KATEX CSS')
    // Local images are read relative to the open document.
    await expect(opts.inlineImage('images/fig.png')).resolves.toBe('data:image/png;base64,AA==')
    expect(DocumentService.ReadImageDataURI).toHaveBeenCalledWith('/tmp/paper.md', 'images/fig.png')
    DocumentService.ReadImageDataURI.mockRejectedValueOnce(new Error('missing'))
    await expect(opts.inlineImage('gone.png')).resolves.toBeNull()
    await vi.waitFor(() => expect(target.querySelector('.toast')?.textContent).toBe('Exported paper.html'))
  })

  it('does nothing more when the panel is cancelled', async () => {
    await openPaper()
    listeners['menu:export-html']({ data: null })
    await vi.waitFor(() => expect(DocumentService.ChooseHTMLExportPath).toHaveBeenCalled())
    await new Promise((r) => setTimeout(r, 0))
    expect(htmlExport.buildStandaloneHTML).not.toHaveBeenCalled()
    expect(DocumentService.WriteHTMLExport).not.toHaveBeenCalled()
  })

  it('reports a failed write', async () => {
    const { target } = await openPaper()
    DocumentService.ChooseHTMLExportPath.mockResolvedValueOnce('/tmp/out/paper.html')
    DocumentService.WriteHTMLExport.mockRejectedValueOnce(new Error('disk full'))
    listeners['menu:export-html']({ data: null })
    await vi.waitFor(() =>
      expect(target.querySelector('.toast')?.textContent).toBe('Could not export HTML: Error: disk full'),
    )
  })

  it('abandons the export when another document is opened while the panel is up', async () => {
    const { target } = await openPaper()
    let choose!: (v: string) => void
    DocumentService.ChooseHTMLExportPath.mockReturnValueOnce(new Promise<string>((r) => (choose = r)))
    listeners['menu:export-html']({ data: null })
    await vi.waitFor(() => expect(DocumentService.ChooseHTMLExportPath).toHaveBeenCalled())

    // The panel is not modal to the webview: open another document behind it.
    DocumentService.OpenPath.mockResolvedValueOnce({ path: '/tmp/other.md', content: '# Other\n' })
    listeners['menu:open-recent']({ data: '/tmp/other.md' })
    await vi.waitFor(() => expect(target.textContent).toContain('Other'))

    choose('/tmp/out/paper.html')
    await vi.waitFor(() => expect(target.querySelector('.toast')).not.toBeNull())
    expect(target.querySelector('.toast')?.textContent).toMatch(/changed/)
    expect(DocumentService.WriteHTMLExport).not.toHaveBeenCalled()
  })

  it('is ignored on the welcome screen', async () => {
    recents.current = ['/papers/thesis.md']
    const { target } = mountApp()
    await vi.waitFor(() => expect(target.querySelector('.welcome')).not.toBeNull())
    listeners['menu:export-html']({ data: null })
    flushSync()
    expect(DocumentService.ChooseHTMLExportPath).not.toHaveBeenCalled()
  })
})

describe('figure settings', () => {
  it('publishes the persisted alignment onto the preview pane', async () => {
    settings.current = { ...DEFAULT_SETTINGS, figureAlignment: 'right' }
    recents.current = []
    stubMatchMedia(false)
    const { target } = mountApp()

    await vi.waitFor(() =>
      expect(
        target.querySelector<HTMLElement>('.preview-pane')!.dataset.figureAlign,
      ).toBe('right'),
    )
  })

  it('re-renders the preview when the menu changes the chart width', async () => {
    settings.current = { ...DEFAULT_SETTINGS }
    recents.current = []
    stubMatchMedia(false)
    const { target } = mountApp()
    const pane = target.querySelector<HTMLElement>('.preview-pane')!

    // A chart in the document is what makes the width observable at all.
    const editor = EditorView.findFromDOM(target.querySelector('.cm-editor')!)!
    // Empty recents triggers App's own first-launch doNew(), which lands
    // asynchronously (after refreshRecents/refreshSettings resolve) and would
    // otherwise clobber a dispatch made before it settles. Wait for it first.
    await vi.waitFor(() => expect(editor.state.doc.length).toBeGreaterThan(0))
    editor.dispatch({
      changes: { from: 0, to: editor.state.doc.length, insert: '```vega-lite\n{"mark":"bar"}\n```\n' },
    })
    await vi.waitFor(() =>
      expect(pane.querySelector('.vega-lite-chart')?.getAttribute('data-spec')).toContain(
        '"width":400',
      ),
    )

    settings.current = { ...DEFAULT_SETTINGS, chartWidth: 'large' }
    listeners['settings:changed']({ data: null })

    await vi.waitFor(() =>
      expect(pane.querySelector('.vega-lite-chart')?.getAttribute('data-spec')).toContain(
        '"width":560',
      ),
    )
  })
})

describe('recovery drafts', () => {
  // vi.clearAllMocks in the top-level beforeEach clears calls, not
  // implementations, so a mockImplementation set by one test here would
  // leak into the next. Put the default back before each.
  beforeEach(() => {
    DocumentService.RecoverDraft.mockImplementation(async () => ({ found: false, content: '' }))
  })

  function recoverDialog(target: HTMLElement) {
    return target.querySelector<HTMLDialogElement>('dialog[aria-label="Recover draft"]')!
  }

  it('writes a draft shortly after typing into a dirty document', async () => {
    const target = await openDoc('# Results\n')
    const view = EditorView.findFromDOM(target.querySelector('.cm-editor')!)!
    view.dispatch({ changes: { from: 0, to: 0, insert: 'x' } })
    flushSync()

    await vi.waitFor(() =>
      expect(DocumentService.WriteDraft).toHaveBeenCalledWith('/tmp/paper.md', 'x# Results\n'),
    )
  })

  it('discards the draft when the document is saved', async () => {
    const target = await openDoc('# Results\n')
    const view = EditorView.findFromDOM(target.querySelector('.cm-editor')!)!
    view.dispatch({ changes: { from: 0, to: 0, insert: 'x' } })
    flushSync()
    await vi.waitFor(() => expect(DocumentService.WriteDraft).toHaveBeenCalled())

    listeners['menu:save']({ data: null })
    await vi.waitFor(() => expect(DocumentService.DiscardDraft).toHaveBeenCalledWith('/tmp/paper.md'))
  })

  it('discards the draft under the untitled key when the first save of a new document renames it', async () => {
    // save() sets `path` and clears dirty in the same tick, so by the time
    // the keeper's effect sees the clean transition, docPath is already the
    // new path — the untitled draft would be orphaned without dirtyPath.
    const { target } = mountApp()
    await vi.waitFor(() => expect(target.querySelector('.cm-scroller')).not.toBeNull())

    const view = EditorView.findFromDOM(target.querySelector('.cm-editor')!)!
    view.dispatch({ changes: { from: 0, to: 0, insert: 'x' } })
    flushSync()

    DocumentService.SaveAs.mockResolvedValueOnce('/tmp/new.md')
    listeners['menu:save']({ data: null })

    await vi.waitFor(() => expect(DocumentService.DiscardDraft).toHaveBeenCalledWith(''))
  })

  it('writes nothing while Autosave is off', async () => {
    settings.current = { ...DEFAULT_SETTINGS, autoSave: false }
    const target = await openDoc('# Results\n')
    const view = EditorView.findFromDOM(target.querySelector('.cm-editor')!)!
    view.dispatch({ changes: { from: 0, to: 0, insert: 'x' } })
    flushSync()

    await new Promise((r) => setTimeout(r, 80)) // four debounce windows
    expect(DocumentService.WriteDraft).not.toHaveBeenCalled()

    // Prove the harness can observe a write at all, so the assertion above
    // cannot be passing because nothing here is capable of calling
    // WriteDraft in the first place.
    settings.current = { ...DEFAULT_SETTINGS, autoSave: true }
    listeners['settings:changed']({ data: null })
    view.dispatch({ changes: { from: 0, to: 0, insert: 'y' } })
    flushSync()
    await vi.waitFor(() => expect(DocumentService.WriteDraft).toHaveBeenCalled())
  })

  it('offers a newer draft on open, and Restore puts it in the editor as unsaved', async () => {
    DocumentService.RecoverDraft.mockImplementation(async (docPath: string) =>
      docPath === '/tmp/paper.md'
        ? { found: true, content: '# Results\n\nrecovered text\n' }
        : { found: false, content: '' },
    )
    const target = await openDoc('# Results\n')
    await vi.waitFor(() => expect(recoverDialog(target).open).toBe(true))
    expect(recoverDialog(target).getAttribute('role')).toBe('alertdialog')
    expect(target.textContent).toContain('A draft of "paper.md" newer than the file on disk was found')

    buttonByText(recoverDialog(target), 'Restore')!.click()
    flushSync()

    expect(recoverDialog(target).open).toBe(false)
    expect(target.textContent).toContain('recovered text')
    // The file on disk still holds the old text, so the document is dirty.
    expect(target.querySelector('.status-bar')!.textContent).toContain('— Edited')
    expect(DocumentService.DiscardDraft).not.toHaveBeenCalled()
  })

  it('Discard Draft removes the draft and keeps the file as opened', async () => {
    DocumentService.RecoverDraft.mockImplementation(async (docPath: string) =>
      docPath === '/tmp/paper.md'
        ? { found: true, content: '# Results\n\nrecovered text\n' }
        : { found: false, content: '' },
    )
    const target = await openDoc('# Results\n\nOn disk.\n')
    await vi.waitFor(() => expect(recoverDialog(target).open).toBe(true))

    buttonByText(recoverDialog(target), 'Discard Draft')!.click()
    flushSync()

    expect(recoverDialog(target).open).toBe(false)
    await vi.waitFor(() => expect(DocumentService.DiscardDraft).toHaveBeenCalledWith('/tmp/paper.md'))
    expect(target.textContent).toContain('On disk.')
    expect(target.textContent).not.toContain('recovered text')
    expect(target.querySelector('.status-bar')!.textContent).not.toContain('Edited')
  })

  it('offers an untitled draft at launch and restores it into an unsaved buffer', async () => {
    DocumentService.RecoverDraft.mockImplementation(async (docPath: string) =>
      docPath === '' ? { found: true, content: '# Scratch\n\nnever saved\n' } : { found: false, content: '' },
    )
    const { target } = mountApp()
    await vi.waitFor(() => expect(recoverDialog(target).open).toBe(true))
    expect(target.textContent).toContain('An unsaved untitled document was recovered from the last session')

    buttonByText(recoverDialog(target), 'Restore')!.click()
    flushSync()

    expect(target.textContent).toContain('never saved')
    expect(target.querySelector('.status-bar')!.textContent).toContain('Untitled — Edited')
    expect(target.querySelector('.welcome')).toBeNull()
  })

  it('discarding the untitled draft on a first launch still opens the template', async () => {
    DocumentService.RecoverDraft.mockImplementation(async (docPath: string) =>
      docPath === '' ? { found: true, content: '# Scratch\n' } : { found: false, content: '' },
    )
    const { target } = mountApp()
    await vi.waitFor(() => expect(recoverDialog(target).open).toBe(true))

    buttonByText(recoverDialog(target), 'Discard Draft')!.click()
    flushSync()

    await vi.waitFor(() => expect(DocumentService.DiscardDraft).toHaveBeenCalledWith(''))
    // No recents, so the first-launch template takes over as it always has.
    await vi.waitFor(() => expect(target.querySelector('.status-bar')!.textContent).toContain('Untitled'))
    expect(target.textContent).not.toContain('# Scratch')
  })

  it('Esc dismisses the recover dialog without discarding the draft', async () => {
    DocumentService.RecoverDraft.mockImplementation(async (docPath: string) =>
      docPath === '' ? { found: true, content: '# Scratch\n\nnever saved\n' } : { found: false, content: '' },
    )
    const { target } = mountApp()
    await vi.waitFor(() => expect(recoverDialog(target).open).toBe(true))

    recoverDialog(target).dispatchEvent(new Event('cancel'))
    flushSync()

    expect(recoverDialog(target).open).toBe(false)
    expect(DocumentService.DiscardDraft).not.toHaveBeenCalled()
  })

  it('waits for the draft queue before quitting after Save', async () => {
    const target = await openDoc('# Results\n')
    const view = EditorView.findFromDOM(target.querySelector('.cm-editor')!)!
    view.dispatch({ changes: { from: 0, to: 0, insert: 'x' } })
    flushSync()

    listeners['close:confirm']({ data: null })
    flushSync()
    // Scoped to the dialog: the toolbar's own Save button comes first in
    // DOM order and would only save, never quit.
    const confirm = target.querySelector<HTMLElement>('dialog[aria-label="Unsaved changes"]')!
    buttonByText(confirm, 'Save')!.click()

    await vi.waitFor(() => expect(DocumentService.Quit).toHaveBeenCalled())
    const discardOrder = DocumentService.DiscardDraft.mock.invocationCallOrder[0]
    const quitOrder = DocumentService.Quit.mock.invocationCallOrder[0]
    expect(discardOrder).toBeLessThan(quitOrder)
  })

  it('drops a pending draft offer when another document is opened over it', async () => {
    DocumentService.RecoverDraft.mockImplementation(async (docPath: string) =>
      docPath === '' ? { found: true, content: '# Scratch\n\nnever saved\n' } : { found: false, content: '' },
    )
    recents.current = ['/tmp/paper.md']
    DocumentService.OpenPath.mockResolvedValueOnce({ path: '/tmp/paper.md', content: '# Results\n\nOn disk.\n' })
    const { target } = mountApp()
    await vi.waitFor(() => expect(recoverDialog(target).open).toBe(true))

    listeners['menu:open-recent']({ data: '/tmp/paper.md' })
    await vi.waitFor(() => expect(target.textContent).toContain('On disk.'))

    expect(recoverDialog(target).open).toBe(false)
    expect(target.textContent).not.toContain('never saved')
    expect(target.querySelector('.status-bar')!.textContent).not.toContain('Edited')
  })
})

describe('update check', () => {
  const AVAILABLE = {
    checked: true, available: true, current: '0.9.0', latest: '0.10.0',
    url: 'https://github.com/richarc/halmos/releases/tag/v0.10.0',
  }
  function askDialog(target: HTMLElement) {
    return target.querySelector<HTMLDialogElement>('dialog[aria-label="Check for updates"]')!
  }
  function noticeDialog(target: HTMLElement) {
    return target.querySelector<HTMLDialogElement>('dialog[aria-label="Update available"]')!
  }

  // vi.clearAllMocks clears calls, not implementations, so anything a test
  // here sets with mockImplementation would leak into the next. Restore
  // both defaults before each.
  beforeEach(() => {
    DocumentService.CheckForUpdates.mockImplementation(async () => ({
      checked: true, available: false, current: '0.9.0', latest: '0.9.0',
      url: 'https://github.com/richarc/halmos/releases/tag/v0.9.0',
    }))
    DocumentService.RecoverDraft.mockImplementation(async () => ({ found: false, content: '' }))
  })

  it('asks once at first launch, and Check Automatically saves on and checks', async () => {
    settings.current = { ...DEFAULT_SETTINGS, updateCheck: 'unasked' }
    const { target } = mountApp()
    await vi.waitFor(() => expect(askDialog(target).open).toBe(true))
    expect(target.textContent).toContain('Nothing about you or your documents is sent.')
    expect(DocumentService.CheckForUpdates).not.toHaveBeenCalled()

    buttonByText(askDialog(target), 'Check Automatically')!.click()
    flushSync()

    expect(askDialog(target).open).toBe(false)
    await vi.waitFor(() => expect(DocumentService.UpdateSettings).toHaveBeenCalled())
    expect(DocumentService.UpdateSettings.mock.calls[0][0].updateCheck).toBe('on')
    await vi.waitFor(() => expect(DocumentService.CheckForUpdates).toHaveBeenCalledWith(false))
  })

  it("Don't Check saves off and fetches nothing", async () => {
    settings.current = { ...DEFAULT_SETTINGS, updateCheck: 'unasked' }
    const { target } = mountApp()
    await vi.waitFor(() => expect(askDialog(target).open).toBe(true))

    buttonByText(askDialog(target), "Don't Check")!.click()
    flushSync()

    await vi.waitFor(() => expect(DocumentService.UpdateSettings).toHaveBeenCalled())
    expect(DocumentService.UpdateSettings.mock.calls[0][0].updateCheck).toBe('off')
    expect(DocumentService.CheckForUpdates).not.toHaveBeenCalled()
  })

  it('Esc on the question counts as Don\'t Check, so it is asked once', async () => {
    settings.current = { ...DEFAULT_SETTINGS, updateCheck: 'unasked' }
    const { target } = mountApp()
    await vi.waitFor(() => expect(askDialog(target).open).toBe(true))

    askDialog(target).dispatchEvent(new Event('cancel'))
    flushSync()

    expect(askDialog(target).open).toBe(false)
    await vi.waitFor(() => expect(DocumentService.UpdateSettings).toHaveBeenCalled())
    expect(DocumentService.UpdateSettings.mock.calls[0][0].updateCheck).toBe('off')
  })

  it('does not ask while a recovery draft is being offered', async () => {
    settings.current = { ...DEFAULT_SETTINGS, updateCheck: 'unasked' }
    DocumentService.RecoverDraft.mockImplementation(async (docPath: string) =>
      docPath === '' ? { found: true, content: '# Scratch\n' } : { found: false, content: '' },
    )
    const { target } = mountApp()
    await vi.waitFor(() =>
      expect(target.querySelector<HTMLDialogElement>('dialog[aria-label="Recover draft"]')!.open).toBe(true),
    )
    expect(askDialog(target).open).toBe(false)
  })

  it('checks automatically at launch when the setting is on, and shows nothing when up to date', async () => {
    settings.current = { ...DEFAULT_SETTINGS, updateCheck: 'on' }
    const { target } = mountApp()
    await vi.waitFor(() => expect(DocumentService.CheckForUpdates).toHaveBeenCalledWith(false))
    await new Promise((r) => setTimeout(r, 20))
    expect(noticeDialog(target).open).toBe(false)
    expect(target.querySelector('.toast')).toBeNull()
  })

  it('shows the update dialog when a newer version is available, and View Release opens it', async () => {
    settings.current = { ...DEFAULT_SETTINGS, updateCheck: 'on' }
    DocumentService.CheckForUpdates.mockResolvedValueOnce(AVAILABLE)
    const { target } = mountApp()
    await vi.waitFor(() => expect(noticeDialog(target).open).toBe(true))
    expect(target.textContent).toContain('Halmos 0.10.0 is available. You have 0.9.0.')

    buttonByText(noticeDialog(target), 'View Release')!.click()
    flushSync()

    expect(Browser.OpenURL).toHaveBeenCalledWith(AVAILABLE.url)
    expect(noticeDialog(target).open).toBe(false)
  })

  it('Later closes the dialog without opening anything', async () => {
    settings.current = { ...DEFAULT_SETTINGS, updateCheck: 'on' }
    DocumentService.CheckForUpdates.mockResolvedValueOnce(AVAILABLE)
    const { target } = mountApp()
    await vi.waitFor(() => expect(noticeDialog(target).open).toBe(true))

    buttonByText(noticeDialog(target), 'Later')!.click()
    flushSync()

    expect(noticeDialog(target).open).toBe(false)
    expect(Browser.OpenURL).not.toHaveBeenCalled()
  })

  it('does not check at launch when the setting is off', async () => {
    mountApp()
    await vi.waitFor(() => expect(DocumentService.Settings).toHaveBeenCalled())
    await new Promise((r) => setTimeout(r, 20))
    expect(DocumentService.CheckForUpdates).not.toHaveBeenCalled()
  })

  it('Help → Check for Updates… forces a check and says when it is up to date', async () => {
    const { target } = mountApp()
    await vi.waitFor(() => expect(DocumentService.Settings).toHaveBeenCalled())

    listeners['menu:check-updates']({ data: null })

    await vi.waitFor(() => expect(DocumentService.CheckForUpdates).toHaveBeenCalledWith(true))
    await vi.waitFor(() => expect(target.textContent).toContain('Halmos 0.9.0 is up to date.'))
  })

  it('a manual check reports a failure', async () => {
    DocumentService.CheckForUpdates.mockRejectedValueOnce(new Error('the version feed returned 404 Not Found'))
    const { target } = mountApp()
    await vi.waitFor(() => expect(DocumentService.Settings).toHaveBeenCalled())

    listeners['menu:check-updates']({ data: null })

    await vi.waitFor(() =>
      expect(target.textContent).toContain('Could not check for updates: Error: the version feed returned 404 Not Found'),
    )
  })

  it('an automatic check that fails stays quiet', async () => {
    settings.current = { ...DEFAULT_SETTINGS, updateCheck: 'on' }
    DocumentService.CheckForUpdates.mockRejectedValueOnce(new Error('offline'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { target } = mountApp()
    await vi.waitFor(() => expect(DocumentService.CheckForUpdates).toHaveBeenCalled())
    await new Promise((r) => setTimeout(r, 20))
    expect(target.querySelector('.toast')).toBeNull()
    expect(noticeDialog(target).open).toBe(false)
    warn.mockRestore()
  })

  it('refuses a manual check while the chart builder is open', async () => {
    const target = await openDoc('# Results\n')
    listeners['menu:insert-chart']({ data: null })
    flushSync()
    expect(target.querySelector('.chart-builder')).not.toBeNull()

    listeners['menu:check-updates']({ data: null })
    flushSync()

    expect(target.textContent).toContain('Finish or cancel the chart or table before checking for updates.')
    expect(DocumentService.CheckForUpdates).not.toHaveBeenCalled()
  })
})

describe('spell checking setting', () => {
  it('reaches the editor: off in settings means spellcheck="false" on the content element', async () => {
    settings.current = { ...DEFAULT_SETTINGS, spellCheck: false }
    const { target } = mountApp()
    await vi.waitFor(() => expect(DocumentService.Settings).toHaveBeenCalled())
    await vi.waitFor(() =>
      expect(target.querySelector('.cm-content')!.getAttribute('spellcheck')).toBe('false'),
    )
  })

  it('defaults on', async () => {
    const { target } = mountApp()
    await vi.waitFor(() => expect(DocumentService.Settings).toHaveBeenCalled())
    await vi.waitFor(() =>
      expect(target.querySelector('.cm-content')!.getAttribute('spellcheck')).toBe('true'),
    )
  })
})

// #17: closing the window hides it and leaves Hermes in the Dock. The close
// button sends close:confirm with "close"; ⌘Q sends "quit" (or, in older
// tests, null — still a quit).
describe('closing the window', () => {
  it('hides the window after Don\'t Save on a close, rather than quitting', async () => {
    const target = await openDoc('# Results\n')
    const view = EditorView.findFromDOM(target.querySelector('.cm-editor')!)!
    view.dispatch({ changes: { from: 0, to: 0, insert: 'x' } })
    flushSync()

    listeners['close:confirm']({ data: 'close' })
    flushSync()
    const confirm = target.querySelector<HTMLDialogElement>('dialog[aria-label="Unsaved changes"]')!
    expect(confirm.open).toBe(true)
    buttonByText(confirm, "Don't Save")!.click()

    await vi.waitFor(() => expect(DocumentService.CloseWindow).toHaveBeenCalled())
    expect(DocumentService.Quit).not.toHaveBeenCalled()
  })

  it('still quits after Don\'t Save when the payload is not "close"', async () => {
    const target = await openDoc('# Results\n')
    const view = EditorView.findFromDOM(target.querySelector('.cm-editor')!)!
    view.dispatch({ changes: { from: 0, to: 0, insert: 'x' } })
    flushSync()

    listeners['close:confirm']({ data: 'quit' })
    flushSync()
    const confirm = target.querySelector<HTMLElement>('dialog[aria-label="Unsaved changes"]')!
    buttonByText(confirm, "Don't Save")!.click()

    await vi.waitFor(() => expect(DocumentService.Quit).toHaveBeenCalled())
    expect(DocumentService.CloseWindow).not.toHaveBeenCalled()
  })

  it('returns to the welcome pane when the document is closed', async () => {
    const target = await openDoc('# Results\n')
    expect(target.querySelector('.welcome')).toBeNull()

    listeners['document:closed']({ data: null })
    flushSync()

    await vi.waitFor(() => expect(target.querySelector('.welcome')).not.toBeNull())
    const view = EditorView.findFromDOM(target.querySelector('.cm-editor')!)!
    expect(view.state.doc.toString()).toBe('')
  })

  // A clean close skips close:confirm and hides the window straight away, so
  // closeDocument is the only place left to put the builders away.
  it('closes an open builder or New dialog with the document', async () => {
    for (const open of ['menu:insert-chart', 'menu:insert-table', 'menu:new']) {
      const target = await openDoc('# Results\n\nJust prose.\n')
      listeners[open]({ data: null })
      flushSync()
      expect(target.querySelector('.chart-builder, .table-builder, dialog[aria-label="New document"][open]')).not.toBeNull()

      listeners['document:closed']({ data: null })
      flushSync()

      await vi.waitFor(() => expect(target.querySelector('.welcome')).not.toBeNull())
      expect(target.querySelector('.chart-builder, .table-builder, dialog[aria-label="New document"][open]')).toBeNull()
    }
  })

  it('asks about the chart, then about unsaved changes, before closing', async () => {
    const target = await openDoc('# Results\n\nJust prose.\n')
    const view = EditorView.findFromDOM(target.querySelector('.cm-editor')!)!
    view.dispatch({ changes: { from: 0, to: 0, insert: 'x' } })
    flushSync()
    listeners['menu:insert-chart']({ data: null })
    flushSync()

    listeners['close:confirm']({ data: 'close' })
    flushSync()
    const ask = target.querySelector<HTMLDialogElement>('dialog[aria-label="Discard chart"]')!
    expect(ask.textContent).toContain('Discard it and close?')
    buttonByText(ask, 'Discard')!.click()
    flushSync()

    expect(target.querySelector('.chart-builder')).toBeNull()
    expect(
      target.querySelector<HTMLDialogElement>('dialog[aria-label="Unsaved changes"]')!.open,
    ).toBe(true)
    expect(DocumentService.CloseWindow).not.toHaveBeenCalled()
  })

  it('closes a clean document once the chart is discarded', async () => {
    const target = await openDoc('# Results\n\nJust prose.\n')
    listeners['menu:insert-chart']({ data: null })
    flushSync()

    listeners['close:confirm']({ data: 'close' })
    flushSync()
    buttonByText(target.querySelector<HTMLElement>('dialog[aria-label="Discard chart"]')!, 'Discard')!.click()
    flushSync()

    await vi.waitFor(() => expect(DocumentService.CloseWindow).toHaveBeenCalled())
  })
})

describe('changes made by another program', () => {
  const MINE = '# Results\n\nMine.\n'
  const THEIRS = '# Results\n\nTheirs.\n'

  // Save resolves { conflict: true } once in some tests below; put the
  // default back so it cannot leak into the next.
  beforeEach(() => {
    DocumentService.Save.mockImplementation(async () => ({ conflict: false }))
    DocumentService.RecoverDraft.mockImplementation(async () => ({ found: false, content: '' }))
  })

  function changed(content: string, version = 'v2', path = '/tmp/paper.md') {
    listeners['document:changed']({ data: { path, version, content } })
    flushSync()
  }

  // Both questions are titled "Changed on disk"; the one up is the open one.
  function openQuestions(target: HTMLElement) {
    return [...target.querySelectorAll<HTMLDialogElement>('dialog[aria-label="Changed on disk"]')].filter((d) => d.open)
  }

  function editorText(target: HTMLElement) {
    return EditorView.findFromDOM(target.querySelector('.cm-editor')!)!.state.doc.toString()
  }

  function typeX(target: HTMLElement) {
    const view = EditorView.findFromDOM(target.querySelector('.cm-editor')!)!
    view.dispatch({ changes: { from: 0, to: 0, insert: 'x' } })
    flushSync()
  }

  async function settledClean() {
    await vi.waitFor(() => expect(DocumentService.SetDirty).toHaveBeenLastCalledWith(false))
  }

  it('reloads a clean document silently', async () => {
    const target = await openDoc(MINE)
    changed(THEIRS)

    expect(editorText(target)).toBe(THEIRS)
    await vi.waitFor(() => expect(target.querySelector('.preview-pane')!.textContent).toContain('Theirs.'))
    expect(openQuestions(target)).toHaveLength(0)
    await vi.waitFor(() => expect(DocumentService.AcceptDiskVersion).toHaveBeenCalledWith('v2'))
    await settledClean()
    expect(target.querySelector('.status-name')!.textContent).not.toContain('Edited')
  })

  // A watcher event from the previous document can land after a switch.
  it('ignores a change for another path', async () => {
    const target = await openDoc(MINE)
    changed(THEIRS, 'v2', '/tmp/other.md')

    expect(editorText(target)).toBe(MINE)
    expect(openQuestions(target)).toHaveLength(0)
    expect(DocumentService.AcceptDiskVersion).not.toHaveBeenCalled()
  })

  it('asks when there are unsaved edits', async () => {
    const target = await openDoc(MINE)
    typeX(target)
    changed(THEIRS)

    const [dlg] = openQuestions(target)
    expect(dlg).toBeDefined()
    expect(dlg.getAttribute('role')).toBe('alertdialog')
    expect(dlg.textContent).toContain('"paper.md" was changed by another program, and there are unsaved changes here.')
    expect(buttonByText(dlg, 'Keep Mine')).toBeDefined()
    expect(buttonByText(dlg, 'Use File')!.classList).toContain('primary')
    expect(editorText(target)).toBe('x' + MINE)
    expect(DocumentService.AcceptDiskVersion).not.toHaveBeenCalled()
  })

  it('Keep Mine keeps the text and accepts the version', async () => {
    const target = await openDoc(MINE)
    typeX(target)
    changed(THEIRS)
    buttonByText(openQuestions(target)[0], 'Keep Mine')!.click()
    flushSync()

    expect(openQuestions(target)).toHaveLength(0)
    expect(editorText(target)).toBe('x' + MINE)
    await vi.waitFor(() => expect(DocumentService.AcceptDiskVersion).toHaveBeenCalledWith('v2'))
    expect(target.querySelector('.status-name')!.textContent).toContain('Edited')
  })

  // Esc must not be destructive, the same rule as the recovery dialog.
  it('Esc on the question keeps mine', async () => {
    const target = await openDoc(MINE)
    typeX(target)
    changed(THEIRS)
    openQuestions(target)[0].dispatchEvent(new Event('cancel'))
    flushSync()

    expect(openQuestions(target)).toHaveLength(0)
    expect(editorText(target)).toBe('x' + MINE)
    await vi.waitFor(() => expect(DocumentService.AcceptDiskVersion).toHaveBeenCalledWith('v2'))
  })

  it('Use File applies the file and accepts it', async () => {
    const target = await openDoc(MINE)
    typeX(target)
    changed(THEIRS)
    buttonByText(openQuestions(target)[0], 'Use File')!.click()
    flushSync()

    expect(openQuestions(target)).toHaveLength(0)
    expect(editorText(target)).toBe(THEIRS)
    await vi.waitFor(() => expect(DocumentService.AcceptDiskVersion).toHaveBeenCalledWith('v2'))
    await settledClean()
  })

  it('a second change replaces the open question', async () => {
    const target = await openDoc(MINE)
    typeX(target)
    changed(THEIRS, 'v2')
    changed('# Results\n\nThird.\n', 'v3')

    expect(openQuestions(target)).toHaveLength(1)
    buttonByText(openQuestions(target)[0], 'Use File')!.click()
    flushSync()

    expect(editorText(target)).toBe('# Results\n\nThird.\n')
    await vi.waitFor(() => expect(DocumentService.AcceptDiskVersion).toHaveBeenCalledWith('v3'))
    expect(DocumentService.AcceptDiskVersion).not.toHaveBeenCalledWith('v2')
  })

  it('a stream of changes on a clean document asks nothing', async () => {
    const target = await openDoc(MINE)
    for (let i = 1; i <= 5; i++) changed(`# Results\n\nVersion ${i}.\n`, `v${i}`)

    expect(openQuestions(target)).toHaveLength(0)
    expect(editorText(target)).toBe('# Results\n\nVersion 5.\n')
    await vi.waitFor(() => expect(DocumentService.AcceptDiskVersion).toHaveBeenLastCalledWith('v5'))
    await settledClean()
  })

  it('Save asks before overwriting, and Overwrite writes', async () => {
    const target = await openDoc(MINE)
    typeX(target)
    DocumentService.Save.mockResolvedValueOnce({ conflict: true })
    listeners['menu:save']({ data: null })

    await vi.waitFor(() => expect(openQuestions(target)).toHaveLength(1))
    const dlg = openQuestions(target)[0]
    expect(dlg.getAttribute('role')).toBe('alertdialog')
    expect(dlg.textContent).toContain(
      '"paper.md" was changed by another program since it was opened. Save anyway and replace those changes?',
    )
    expect(buttonByText(dlg, 'Overwrite')!.classList).toContain('primary')
    buttonByText(dlg, 'Overwrite')!.click()

    await vi.waitFor(() => expect(DocumentService.Save).toHaveBeenLastCalledWith('/tmp/paper.md', 'x' + MINE, true))
    await settledClean()
    expect(openQuestions(target)).toHaveLength(0)
  })

  it('Save asks before overwriting, and Cancel writes nothing', async () => {
    const target = await openDoc(MINE)
    typeX(target)
    DocumentService.Save.mockResolvedValueOnce({ conflict: true })
    listeners['menu:save']({ data: null })

    await vi.waitFor(() => expect(openQuestions(target)).toHaveLength(1))
    buttonByText(openQuestions(target)[0], 'Cancel')!.click()
    flushSync()

    await vi.waitFor(() => expect(openQuestions(target)).toHaveLength(0))
    expect(DocumentService.Save).toHaveBeenCalledTimes(1)
    expect(target.querySelector('.status-name')!.textContent).toContain('Edited')
  })

  it('Esc on the overwrite question writes nothing', async () => {
    const target = await openDoc(MINE)
    typeX(target)
    DocumentService.Save.mockResolvedValueOnce({ conflict: true })
    listeners['menu:save']({ data: null })

    await vi.waitFor(() => expect(openQuestions(target)).toHaveLength(1))
    openQuestions(target)[0].dispatchEvent(new Event('cancel'))
    flushSync()

    await vi.waitFor(() => expect(openQuestions(target)).toHaveLength(0))
    expect(DocumentService.Save).toHaveBeenCalledTimes(1)
    expect(target.querySelector('.status-name')!.textContent).toContain('Edited')
  })

  // The overwrite question belongs to the document it was asked for.
  it('closing the document answers the overwrite question with no', async () => {
    const target = await openDoc(MINE)
    typeX(target)
    DocumentService.Save.mockResolvedValueOnce({ conflict: true })
    listeners['menu:save']({ data: null })
    await vi.waitFor(() => expect(openQuestions(target)).toHaveLength(1))

    listeners['document:closed']({ data: null })
    flushSync()

    await vi.waitFor(() => expect(openQuestions(target)).toHaveLength(0))
    await vi.waitFor(() => expect(target.querySelector('.welcome')).not.toBeNull())
    expect(DocumentService.Save).not.toHaveBeenCalledWith(expect.anything(), expect.anything(), true)
    await settledClean()
  })

  // The quit's Save asks first; a ⌘S while that is up asks again. The quit's
  // save() must get its answer (no), or the unsaved-changes dialog would wait
  // on a promise nothing will ever resolve.
  it('a second overwrite question answers the first with no', async () => {
    const target = await openDoc(MINE)
    typeX(target)
    const unsaved = target.querySelector<HTMLDialogElement>('dialog[aria-label="Unsaved changes"]')!
    DocumentService.Save.mockResolvedValueOnce({ conflict: true }).mockResolvedValueOnce({ conflict: true })
    listeners['close:confirm']({ data: 'quit' })
    flushSync()
    buttonByText(unsaved, 'Save')!.click()
    await vi.waitFor(() => expect(openQuestions(target)).toHaveLength(1))

    listeners['menu:save']({ data: null })
    await vi.waitFor(() => expect(DocumentService.Save).toHaveBeenCalledTimes(2))
    // The first ask was answered no: the quit is abandoned.
    await vi.waitFor(() => expect(unsaved.open).toBe(false))
    expect(openQuestions(target)).toHaveLength(1)

    buttonByText(openQuestions(target)[0], 'Overwrite')!.click()
    await vi.waitFor(() => expect(DocumentService.Save).toHaveBeenCalledTimes(3))
    expect(DocumentService.Save).toHaveBeenLastCalledWith('/tmp/paper.md', 'x' + MINE, true)
    await settledClean()
    expect(DocumentService.Quit).not.toHaveBeenCalled()
  })

  // Saving the editor's text is keeping mine: the disk question goes away.
  it('a save made while the disk question is up clears it', async () => {
    const target = await openDoc(MINE)
    typeX(target)
    changed(THEIRS)
    expect(openQuestions(target)).toHaveLength(1)

    DocumentService.Save.mockResolvedValueOnce({ conflict: true })
    listeners['menu:save']({ data: null })
    await vi.waitFor(() => expect(openQuestions(target)).toHaveLength(2))
    const overwrite = openQuestions(target).find((d) => buttonByText(d, 'Overwrite'))!
    buttonByText(overwrite, 'Overwrite')!.click()

    await vi.waitFor(() => expect(openQuestions(target)).toHaveLength(0))
    await settledClean()
    expect(editorText(target)).toBe('x' + MINE)
  })

  it('quit with Save meets a conflict: Cancel stays, Overwrite quits', async () => {
    const target = await openDoc(MINE)
    typeX(target)
    const unsaved = target.querySelector<HTMLDialogElement>('dialog[aria-label="Unsaved changes"]')!

    DocumentService.Save.mockResolvedValueOnce({ conflict: true })
    listeners['close:confirm']({ data: 'quit' })
    flushSync()
    buttonByText(unsaved, 'Save')!.click()
    await vi.waitFor(() => expect(openQuestions(target)).toHaveLength(1))
    buttonByText(openQuestions(target)[0], 'Cancel')!.click()
    flushSync()
    await vi.waitFor(() => expect(unsaved.open).toBe(false))
    expect(DocumentService.Quit).not.toHaveBeenCalled()
    expect(DocumentService.Save).toHaveBeenCalledTimes(1)
    expect(target.querySelector('.status-name')!.textContent).toContain('Edited')

    DocumentService.Save.mockResolvedValueOnce({ conflict: true })
    listeners['close:confirm']({ data: 'quit' })
    flushSync()
    buttonByText(unsaved, 'Save')!.click()
    await vi.waitFor(() => expect(openQuestions(target)).toHaveLength(1))
    buttonByText(openQuestions(target)[0], 'Overwrite')!.click()

    await vi.waitFor(() => expect(DocumentService.Quit).toHaveBeenCalled())
    expect(DocumentService.Save).toHaveBeenLastCalledWith('/tmp/paper.md', 'x' + MINE, true)
  })

  // menu:new only opens the New… dialog, which can be cancelled with this
  // document still open, so the untitled template (doNew) is what forgets.
  // It is reached from a close with no recents, and from the welcome pane.
  it('new and close forget the document', async () => {
    const target = await openDoc(MINE)
    DocumentService.ForgetDocument.mockClear()
    listeners['document:closed']({ data: null })
    flushSync()
    expect(DocumentService.ForgetDocument).toHaveBeenCalledTimes(1)

    await vi.waitFor(() => expect(target.querySelector('.welcome')).not.toBeNull())
    DocumentService.ForgetDocument.mockClear()
    buttonByText(target, 'Clear')!.click()
    await vi.waitFor(() => expect(editorText(target)).toContain('bibliography: references.bib'))
    expect(DocumentService.ForgetDocument).toHaveBeenCalledTimes(1)
  })

  function moved(from: string, to: string) {
    listeners['document:moved']({ data: { from, to } })
    flushSync()
  }

  function deleted(path = '/tmp/paper.md') {
    listeners['document:deleted']({ data: { path } })
    flushSync()
  }

  it('follows a moved file', async () => {
    const target = await openDoc(MINE)
    DocumentService.RecentFiles.mockClear()
    moved('/tmp/paper.md', '/tmp/Papers/qec.md')

    expect(target.querySelector('.toast')?.textContent).toBe('Moved to Papers/qec.md')
    expect(target.querySelector('.status-name')!.textContent).toContain('qec.md')
    // Go has already added the new path to recents; only the list is re-read.
    await vi.waitFor(() => expect(DocumentService.RecentFiles).toHaveBeenCalled())

    typeX(target)
    listeners['menu:save']({ data: null })
    await vi.waitFor(() => expect(DocumentService.Save).toHaveBeenCalledWith('/tmp/Papers/qec.md', 'x' + MINE, false))
    await settledClean()
  })

  // Go has already moved the draft; the keeper carries on under the new
  // path and discards nothing.
  it('a move with unsaved edits keeps drafting under the new path', async () => {
    const target = await openDoc(MINE)
    typeX(target)
    moved('/tmp/paper.md', '/tmp/Papers/qec.md')
    typeX(target)

    await vi.waitFor(() => expect(DocumentService.WriteDraft).toHaveBeenLastCalledWith('/tmp/Papers/qec.md', 'xx' + MINE))
    expect(DocumentService.DiscardDraft).not.toHaveBeenCalled()
    expect(target.querySelector('.status-name')!.textContent).toContain('Edited')
  })

  it('ignores a move of another file', async () => {
    const target = await openDoc(MINE)
    moved('/tmp/other.md', '/tmp/Papers/other.md')

    expect(target.querySelector('.toast')).toBeNull()
    expect(target.querySelector('.status-name')!.textContent).toContain('paper.md')
    listeners['menu:save']({ data: null })
    await vi.waitFor(() => expect(DocumentService.Save).toHaveBeenCalledWith('/tmp/paper.md', MINE, false))
  })

  it('a deleted file stays open and unsaved', async () => {
    const target = await openDoc(MINE)
    await settledClean()
    deleted()

    expect(target.querySelector('.toast')?.textContent).toBe('"paper.md" was deleted. Save will recreate it.')
    expect(editorText(target)).toBe(MINE)
    await vi.waitFor(() => expect(DocumentService.SetDirty).toHaveBeenLastCalledWith(true))
    expect(target.querySelector('.status-name')!.textContent).toContain('Edited')

    listeners['menu:save']({ data: null })
    await vi.waitFor(() => expect(DocumentService.Save).toHaveBeenCalledWith('/tmp/paper.md', MINE, false))
    await settledClean()
    expect(target.querySelector('.status-name')!.textContent).not.toContain('Edited')
  })

  // Don't Save accepts the text as it is, so the document goes clean and
  // the draft written for it is discarded rather than left behind.
  it("Don't Save on a deleted file discards its draft", async () => {
    const target = await openDoc(MINE)
    deleted()
    await vi.waitFor(() => expect(DocumentService.SetDirty).toHaveBeenLastCalledWith(true))
    listeners['close:confirm']({ data: 'quit' })
    flushSync()
    const unsaved = target.querySelector<HTMLDialogElement>('dialog[aria-label="Unsaved changes"]')!
    buttonByText(unsaved, "Don't Save")!.click()

    await vi.waitFor(() => expect(DocumentService.Quit).toHaveBeenCalled())
    expect(DocumentService.DiscardDraft).toHaveBeenCalledWith('/tmp/paper.md')
  })

  it('Save As on a deleted file makes it clean', async () => {
    const target = await openDoc(MINE)
    deleted()
    await vi.waitFor(() => expect(DocumentService.SetDirty).toHaveBeenLastCalledWith(true))
    DocumentService.SaveAs.mockResolvedValueOnce('/tmp/again.md')
    listeners['menu:save-as']({ data: null })

    await settledClean()
    expect(target.querySelector('.status-name')!.textContent).toBe('again.md')
  })

  it('ignores a delete of another file', async () => {
    const target = await openDoc(MINE)
    await settledClean()
    deleted('/tmp/other.md')

    expect(target.querySelector('.toast')).toBeNull()
    expect(target.querySelector('.status-name')!.textContent).not.toContain('Edited')
  })

  // Go reports a file that comes back as a change, even with the same bytes.
  // With no edits of its own the document takes it back silently.
  it('a deleted file that comes back is clean again', async () => {
    const target = await openDoc(MINE)
    deleted()
    await vi.waitFor(() => expect(DocumentService.SetDirty).toHaveBeenLastCalledWith(true))
    changed(MINE)

    expect(openQuestions(target)).toHaveLength(0)
    await vi.waitFor(() => expect(DocumentService.AcceptDiskVersion).toHaveBeenCalledWith('v2'))
    await settledClean()
  })

  it('a recovery offer says when the file changed', async () => {
    DocumentService.RecoverDraft.mockImplementation(async (docPath: string) =>
      docPath === '/tmp/paper.md' ? { found: true, content: 'x', changed: true } : { found: false, content: '', changed: false },
    )
    const target = await openDoc(MINE)
    const dlg = target.querySelector<HTMLDialogElement>('dialog[aria-label="Recover draft"]')!
    await vi.waitFor(() => expect(dlg.open).toBe(true))
    expect(dlg.textContent).toContain(
      'A draft of "paper.md" was found, and the file has since been changed by another program. Restore the draft?',
    )
  })
})

// #18: Edit → Find.
describe('menu:find', () => {
  it('opens the search panel with a document loaded', async () => {
    const target = await openDoc('# Results\n')

    listeners['menu:find']({ data: 'open' })
    flushSync()

    expect(target.querySelector('.cm-search')).not.toBeNull()
  })

  it('is ignored on the welcome screen', async () => {
    recents.current = ['/tmp/paper.md']
    const { target } = mountApp()
    await vi.waitFor(() => expect(target.querySelector('.welcome')).not.toBeNull())

    listeners['menu:find']({ data: 'open' })
    flushSync()

    expect(target.querySelector('.cm-search')).toBeNull()
  })
})

// #19: a .md handed over by Finder — at launch (buffered in Go, collected
// with TakeLaunchFile) or while running (file:open).
describe('opening a file from Finder', () => {
  it('opens a launch file instead of the welcome pane', async () => {
    recents.current = ['/tmp/paper.md']
    DocumentService.TakeLaunchFile.mockResolvedValueOnce('/tmp/x.md')
    DocumentService.OpenPath.mockResolvedValueOnce({ path: '/tmp/x.md', content: '# Launched\n' })
    const { target } = mountApp()

    await vi.waitFor(() => expect(target.textContent).toContain('Launched'))
    expect(DocumentService.OpenPath).toHaveBeenCalledWith('/tmp/x.md')
    expect(target.querySelector('.welcome')).toBeNull()
  })

  it('opens a launch file instead of the first-launch template', async () => {
    DocumentService.TakeLaunchFile.mockResolvedValueOnce('/tmp/x.md')
    DocumentService.OpenPath.mockResolvedValueOnce({ path: '/tmp/x.md', content: '# Launched\n' })
    const { target } = mountApp()

    await vi.waitFor(() => expect(target.textContent).toContain('Launched'))
    const view = EditorView.findFromDOM(target.querySelector('.cm-editor')!)!
    expect(view.state.doc.toString()).toBe('# Launched\n')
  })

  // The untitled draft stays on disk and is offered at the next launch; the
  // file the user just asked for is the one they want to see.
  it('opens a launch file over a pending untitled draft offer', async () => {
    DocumentService.RecoverDraft.mockImplementationOnce(async (docPath: string) =>
      docPath === '' ? { found: true, content: 'never saved' } : { found: false, content: '' },
    )
    DocumentService.TakeLaunchFile.mockResolvedValueOnce('/tmp/x.md')
    DocumentService.OpenPath.mockResolvedValueOnce({ path: '/tmp/x.md', content: '# Launched\n' })
    const { target } = mountApp()

    await vi.waitFor(() => expect(target.textContent).toContain('Launched'))
    expect(
      target.querySelector<HTMLDialogElement>('dialog[aria-label="Recover draft"]')!.open,
    ).toBe(false)
  })

  it('asks about unsaved changes before opening over them', async () => {
    const target = await openDoc('# Results\n')
    const view = EditorView.findFromDOM(target.querySelector('.cm-editor')!)!
    view.dispatch({ changes: { from: 0, to: 0, insert: 'x' } })
    flushSync()
    DocumentService.OpenPath.mockClear()

    listeners['file:open']({ data: '/tmp/y.md' })
    flushSync()

    const confirm = target.querySelector<HTMLDialogElement>('dialog[aria-label="Unsaved changes"]')!
    expect(confirm.open).toBe(true)
    expect(DocumentService.OpenPath).not.toHaveBeenCalled()

    DocumentService.OpenPath.mockResolvedValueOnce({ path: '/tmp/y.md', content: '# Other\n' })
    buttonByText(confirm, "Don't Save")!.click()
    await vi.waitFor(() => expect(DocumentService.OpenPath).toHaveBeenCalledWith('/tmp/y.md'))
  })
})

describe('dialog titles and button order', () => {
  // Every dialog is mounted while closed (Dialog owns visibility), so its
  // title and footer are in the DOM from the start.
  it('titles each app dialog with its accessible name', async () => {
    const { target } = mountApp()
    await vi.waitFor(() => expect(target.querySelector('dialog[aria-label="Unsaved changes"]')).not.toBeNull())
    for (const label of ['Unsaved changes', 'Recover draft', 'Zotero', 'Check for updates', 'Update available', 'Unknown citations']) {
      const dlg = target.querySelector(`dialog[aria-label="${label}"]`)!
      expect(dlg.querySelector('h2.dialog-title')?.textContent, label).toBe(label)
    }
  })

  // The alternative action stands apart on the left, as in other Mac apps.
  it("puts Don't Save, Discard Draft and Don't Check on the left", async () => {
    const { target } = mountApp()
    await vi.waitFor(() => expect(target.querySelector('dialog[aria-label="Unsaved changes"]')).not.toBeNull())
    const alt = (label: string, text: string) =>
      buttonByText(target.querySelector<HTMLElement>(`dialog[aria-label="${label}"]`)!, text)!
    expect(alt('Unsaved changes', "Don't Save").classList).toContain('dialog-alt')
    expect(alt('Recover draft', 'Discard Draft').classList).toContain('dialog-alt')
    expect(alt('Check for updates', "Don't Check").classList).toContain('dialog-alt')
  })

  it('splits the update question into its text and a hint', async () => {
    const { target } = mountApp()
    await vi.waitFor(() => expect(target.querySelector('dialog[aria-label="Check for updates"]')).not.toBeNull())
    const dlg = target.querySelector('dialog[aria-label="Check for updates"]')!
    expect(dlg.querySelector('.dialog-hint')?.textContent?.trim()).toBe('You can change this later in the Help menu.')
  })
})

describe('unknown citations in the status bar', () => {
  const bib = '@article{a, title={A}, author={Doe, Jane}, year={2020}}'
  const fm = '---\nbibliography: refs.bib\n---\n'

  async function openWithBib(body: string) {
    DocumentService.ReadBibliography.mockResolvedValue(bib)
    return openDoc(`${fm}# Results\n\n${body}\n`)
  }

  afterEach(() => DocumentService.ReadBibliography.mockResolvedValue(''))

  it('shows the unknown citation count in the status bar', async () => {
    const target = await openWithBib('[@a; @b]')
    await vi.waitFor(() =>
      expect(target.querySelector('.status-bar')?.textContent).toContain('1 unknown citation'),
    )
    expect(target.querySelector('.status-bar')?.textContent).not.toContain('citations')
  })

  it('puts the unknown-citations link last in the bar', async () => {
    const target = await openWithBib('[@b]')
    await vi.waitFor(() => expect(target.querySelector('.unknown-count')).not.toBeNull())
    expect(target.querySelector('.status-bar')!.lastElementChild).toBe(target.querySelector('.unknown-count'))
  })

  it('says Edited for unsaved changes', async () => {
    const target = await openWithBib('Prose.')
    const view = EditorView.findFromDOM(target.querySelector('.cm-editor')!)!
    view.dispatch({ changes: { from: 0, to: 0, insert: 'x' } })
    flushSync()
    expect(target.querySelector('.status-bar')!.textContent).toContain('paper.md — Edited')
    expect(target.querySelector('.status-bar')!.textContent).not.toContain('•')
  })

  it('pluralises the count', async () => {
    const target = await openWithBib('[@b; @c]')
    await vi.waitFor(() =>
      expect(target.querySelector('.status-bar')?.textContent).toContain('2 unknown citations'),
    )
  })

  it('hides the count without a bibliography', async () => {
    DocumentService.ReadBibliography.mockResolvedValue(bib)
    const target = await openDoc('# Results\n\n[@b]\n')
    await new Promise((r) => setTimeout(r, 400))
    expect(target.querySelector('.status-bar')?.textContent).not.toContain('unknown')
  })

  it('jumps to the line from the list', async () => {
    const target = await openWithBib('[@a]\n\n[@b]')
    const btn = await vi.waitFor(() => {
      const b = target.querySelector<HTMLButtonElement>('.unknown-count')
      expect(b).not.toBeNull()
      return b!
    })
    btn.click()
    flushSync()
    const dlg = target.querySelector<HTMLDialogElement>('dialog[aria-label="Unknown citations"]')!
    expect(dlg.open).toBe(true)
    expect(dlg.textContent).toContain('[@b]')
    expect(dlg.textContent).toContain('Line 8')
    expect(dlg.textContent).toContain('Not found in the bibliography. Click one to go to it.')
    // Return closes it: Close is the dialog's primary.
    expect(buttonByText(dlg, 'Close')!.classList).toContain('primary')
    const view = EditorView.findFromDOM(target.querySelector('.cm-editor')!)!
    const entry = dlg.querySelector<HTMLButtonElement>('.unknown-list button')!
    entry.click()
    flushSync()
    expect(dlg.open).toBe(false)
    const line = view.state.doc.lineAt(view.state.selection.main.head).number
    expect(line).toBe(8)
  })
})

describe('missing cross-references in the status bar', () => {
  const statusText = (t: HTMLElement) => t.querySelector('.status-bar')?.textContent ?? ''

  it('counts references with no label, singular and plural, without a bibliography', async () => {
    const target = await openDoc('# Results\n\nSee @fig:nope.\n')
    await vi.waitFor(() => expect(statusText(target)).toContain('1 missing cross-reference'))
    expect(statusText(target)).not.toContain('cross-references')
    const view = EditorView.findFromDOM(target.querySelector('.cm-editor')!)!
    view.dispatch({ changes: { from: view.state.doc.length, insert: '\nAnd @tbl:gone.\n' } })
    await vi.waitFor(() => expect(statusText(target)).toContain('2 missing cross-references'))
  })

  it('lists them in the dialog and jumps to the line', async () => {
    const target = await openDoc('# Results\n\nOne.\n\nSee @fig:nope.\n')
    const btn = await vi.waitFor(() => {
      const b = [...target.querySelectorAll<HTMLButtonElement>('.status-bar button')].find((x) =>
        x.textContent?.includes('missing cross-reference'),
      )
      expect(b).toBeTruthy()
      return b!
    })
    btn.click()
    flushSync()
    const dlg = target.querySelector<HTMLDialogElement>('dialog[aria-label="Missing cross-references"]')!
    expect(dlg.open).toBe(true)
    expect(dlg.textContent).toContain('No figure, table or equation has this label. Click one to go to it.')
    expect(dlg.textContent).toContain('@fig:nope')
    expect(dlg.textContent).toContain('Line 5')
    dlg.querySelector<HTMLButtonElement>('.unknown-list button')!.click()
    flushSync()
    expect(dlg.open).toBe(false)
    const view = EditorView.findFromDOM(target.querySelector('.cm-editor')!)!
    expect(view.state.doc.lineAt(view.state.selection.main.head).number).toBe(5)
  })
})

describe('bibliography keys that look like cross-references', () => {
  const entry = (id: string) => `@article{${id}, title={T}, author={Doe, Jane}, year={2020}}\n`
  const fm = '---\nbibliography: refs.bib\n---\n# Results\n\nText.\n'
  const toastText = (t: HTMLElement) => t.querySelector('.toast')?.textContent ?? ''
  const WARNING = "These references can't be cited because their keys look like cross-references"
  afterEach(() => DocumentService.ReadBibliography.mockResolvedValue(''))

  async function dismiss(target: HTMLElement) {
    // Toasts clear themselves; wait for the current one to go.
    await vi.waitFor(() => expect(target.querySelector('.toast')).toBeNull(), { timeout: 8000 })
  }

  it('warns once per set of keys, and again when the set changes', async () => {
    DocumentService.ReadBibliography.mockResolvedValue(entry('a') + entry('fig:old'))
    const target = await openDoc(fm)
    await vi.waitFor(() =>
      expect(toastText(target)).toBe(
        `${WARNING} (fig:, tbl:, eq:, sec:): fig:old. Rename them in your reference manager.`,
      ),
    )
    await dismiss(target)
    listeners['bib:changed']({ data: null })
    await new Promise((r) => setTimeout(r, 100))
    expect(toastText(target)).toBe('')

    DocumentService.ReadBibliography.mockResolvedValue(entry('a') + entry('fig:old') + entry('tbl:t'))
    listeners['bib:changed']({ data: null })
    await vi.waitFor(() => expect(toastText(target)).toContain('fig:old, tbl:t.'))
  })

  it('names at most five keys, then how many more', async () => {
    DocumentService.ReadBibliography.mockResolvedValue(
      ['fig:1', 'fig:2', 'fig:3', 'fig:4', 'fig:5', 'fig:6', 'fig:7'].map(entry).join(''),
    )
    const target = await openDoc(fm)
    await vi.waitFor(() =>
      expect(toastText(target)).toContain('fig:1, fig:2, fig:3, fig:4, fig:5 and 2 more. Rename them'),
    )
  })

  it('stays quiet when no key looks like a reference', async () => {
    DocumentService.ReadBibliography.mockResolvedValue(entry('a'))
    const target = await openDoc(fm)
    await new Promise((r) => setTimeout(r, 200))
    expect(toastText(target)).not.toContain(WARNING)
  })
})

describe('reloading the bibliography', () => {
  const bib = '@article{a, title={A}, author={Doe, Jane}, year={2020}}'
  const fm = '---\nbibliography: refs.bib\n---\n'
  afterEach(() => DocumentService.ReadBibliography.mockResolvedValue(''))

  // Building a formatter costs its first formatting pass, so a reload that
  // reads the same text with the same style keeps the formatter it has.
  it('keeps the formatter when the text and style are unchanged', async () => {
    DocumentService.ReadBibliography.mockResolvedValue(bib)
    const target = await openDoc(`${fm}# Results\n\n[@a; @b]\n`)
    await vi.waitFor(() => expect(target.querySelector('.status-bar')?.textContent).toContain('1 unknown citation'))
    const built = citationsSpy.created
    const reads = DocumentService.ReadBibliography.mock.calls.length
    const watches = DocumentService.WatchBibliography.mock.calls.length

    listeners['bib:changed']({ data: null })
    await vi.waitFor(() => expect(DocumentService.WatchBibliography.mock.calls.length).toBe(watches + 1))
    expect(DocumentService.ReadBibliography.mock.calls.length).toBe(reads + 1)
    expect(citationsSpy.created).toBe(built)

    DocumentService.ReadBibliography.mockResolvedValue(`${bib}\n@article{b, title={B}, author={Roe, Max}, year={2021}}`)
    listeners['bib:changed']({ data: null })
    await vi.waitFor(() => expect(target.querySelector('.status-bar')?.textContent).not.toContain('unknown citation'))
    expect(citationsSpy.created).toBe(built + 1)
  })

  it('builds a new formatter when only the style changes', async () => {
    DocumentService.ReadBibliography.mockResolvedValue(bib)
    const target = await openDoc('---\nbibliography: refs.bib\ncsl: apa\n---\n# Results\n\n[@a; @b]\n')
    await vi.waitFor(() => expect(target.querySelector('.status-bar')?.textContent).toContain('1 unknown citation'))
    const built = citationsSpy.created
    const view = EditorView.findFromDOM(target.querySelector('.cm-editor')!)!
    const at = view.state.doc.toString().indexOf('apa')
    view.dispatch({ changes: { from: at, to: at + 3, insert: 'ieee' } })
    await vi.waitFor(() => expect(citationsSpy.created).toBe(built + 1))
  })
})

describe('csl style files in an unsaved document', () => {
  async function typeIntoUntitled(text: string) {
    const { target } = mountApp()
    await vi.waitFor(() => expect(target.querySelector('.cm-editor')).not.toBeNull())
    const view = EditorView.findFromDOM(target.querySelector('.cm-editor')!)!
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } })
    return target
  }
  const toastText = (t: HTMLElement) => t.querySelector('.toast')?.textContent

  it('asks to save when only a .csl style is named', async () => {
    const target = await typeIntoUntitled('---\ncsl: my.csl\n---\n# Results\n')
    await vi.waitFor(() => expect(toastText(target)).toBe('Save the document to load my.csl'))
  })

  it('names both files when a bibliography is also set', async () => {
    const target = await typeIntoUntitled('---\nbibliography: refs.bib\ncsl: my.csl\n---\n# Results\n')
    await vi.waitFor(() =>
      expect(toastText(target)).toBe('Save the document to load refs.bib and my.csl'),
    )
  })
})

describe('Format → Citation Style', () => {
  const editorText = (t: HTMLElement) => EditorView.findFromDOM(t.querySelector('.cm-editor')!)!.state.doc.toString()

  it('writes csl into the frontmatter from the menu', async () => {
    const target = await openDoc('# Results\n')
    listeners['menu:citation-style']({ data: 'ieee' })
    await vi.waitFor(() => expect(editorText(target)).toContain('csl: ieee'))
    await vi.waitFor(() => expect(DocumentService.SetDirty).toHaveBeenLastCalledWith(true))
  })

  it('writes a relative path for a chosen style file', async () => {
    recents.current = ['/doc/dir/p.md']
    DocumentService.OpenPath.mockResolvedValueOnce({ path: '/doc/dir/p.md', content: '# Results\n' })
    const { target } = mountApp()
    await vi.waitFor(() => expect(target.querySelector('.welcome')).not.toBeNull())
    listeners['menu:open-recent']({ data: '/doc/dir/p.md' })
    await vi.waitFor(() => expect(target.textContent).toContain('Results'))
    DocumentService.ChooseCitationStyle.mockResolvedValueOnce('/doc/dir/styles/x.csl')
    listeners['menu:citation-style']({ data: 'other' })
    await vi.waitFor(() => expect(editorText(target)).toContain('csl: styles/x.csl'))
  })

  it('does nothing when the style file panel is cancelled', async () => {
    const target = await openDoc('# Results\n')
    listeners['menu:citation-style']({ data: 'other' })
    await vi.waitFor(() => expect(DocumentService.ChooseCitationStyle).toHaveBeenCalled())
    await Promise.resolve()
    expect(editorText(target)).not.toContain('csl:')
  })

  it('asks to save first for a style file in an untitled document', async () => {
    const { target } = mountApp()
    await vi.waitFor(() => expect(target.querySelector('.cm-editor')).not.toBeNull())
    DocumentService.ChooseCitationStyle.mockClear()
    listeners['menu:citation-style']({ data: 'other' })
    await vi.waitFor(() =>
      expect(target.querySelector('.toast')?.textContent).toBe('Save the document before choosing a style file'),
    )
    expect(DocumentService.ChooseCitationStyle).not.toHaveBeenCalled()
  })

  it('keeps the caret in the body text after a style choice', async () => {
    const target = await openDoc('# Results\n\nSome prose here.\n')
    const view = EditorView.findFromDOM(target.querySelector('.cm-editor')!)!
    const anchor = view.state.doc.toString().indexOf('prose')
    view.dispatch({ selection: { anchor } })
    listeners['menu:citation-style']({ data: 'ieee' })
    await vi.waitFor(() => expect(view.state.doc.toString()).toContain('csl: ieee'))
    const after = view.state.doc.toString()
    expect(after.slice(view.state.selection.main.head)).toMatch(/^prose here/)
  })

  it('leaves the document clean when the style is already written', async () => {
    const target = await openDoc('---\ncsl: ieee\n---\n# Results\n')
    const view = EditorView.findFromDOM(target.querySelector('.cm-editor')!)!
    const before = view.state.doc.toString()
    listeners['menu:citation-style']({ data: 'ieee' })
    await Promise.resolve()
    flushSync()
    expect(view.state.doc.toString()).toBe(before)
    expect(DocumentService.SetDirty).not.toHaveBeenLastCalledWith(true)
  })

  it('reports the current style to Go', async () => {
    const target = await openDoc('---\ncsl: ieee\n---\n# Results\n')
    await vi.waitFor(() => expect(DocumentService.SetCitationStyle).toHaveBeenLastCalledWith('ieee'))
    listeners['menu:citation-style']({ data: 'harvard' })
    await vi.waitFor(() => expect(DocumentService.SetCitationStyle).toHaveBeenLastCalledWith('harvard'))
    void target
  })

  it('reports apa when the document has no csl', async () => {
    await openDoc('# Results\n')
    await vi.waitFor(() => expect(DocumentService.SetCitationStyle).toHaveBeenLastCalledWith('apa'))
  })
})

describe('Zotero picker failure', () => {
  const NOT_RUNNING = "Zotero isn't running. Open Zotero, then try again."
  const NO_BBT =
    "Zotero is running but the Better BibTeX plugin isn't installed. Halmos uses it to pick citations and to export your library as a .bib file."
  const INSTALL_URL = 'https://retorque.re/zotero-better-bibtex/installation/'

  function zoteroDialog(target: HTMLElement) {
    return target.querySelector<HTMLDialogElement>('dialog[aria-label="Zotero"]')!
  }

  beforeEach(() => {
    DocumentService.PickCitations.mockImplementation(async () => {
      throw new Error('zotero picker unavailable')
    })
  })
  afterEach(() => {
    DocumentService.PickCitations.mockImplementation(async () => '')
    DocumentService.ZoteroStatus.mockImplementation(async () => 'ready')
  })

  it('explains that Zotero is not running', async () => {
    DocumentService.ZoteroStatus.mockImplementation(async () => 'not-running')
    const { target } = mountApp()
    listeners['menu:insert-citation']({ data: undefined })
    await vi.waitFor(() => expect(zoteroDialog(target).open).toBe(true))
    expect(zoteroDialog(target).textContent).toContain(NOT_RUNNING)
  })

  it('falls back to the not-running message when the status check itself fails', async () => {
    DocumentService.ZoteroStatus.mockImplementation(async () => {
      throw new Error('boom')
    })
    const { target } = mountApp()
    listeners['menu:insert-citation']({ data: undefined })
    await vi.waitFor(() => expect(zoteroDialog(target).open).toBe(true))
    expect(zoteroDialog(target).textContent).toContain(NOT_RUNNING)
  })

  it('explains that Better BibTeX is missing and offers the install page', async () => {
    DocumentService.ZoteroStatus.mockImplementation(async () => 'no-better-bibtex')
    const { target } = mountApp()
    listeners['menu:insert-citation']({ data: undefined })
    await vi.waitFor(() => expect(zoteroDialog(target).open).toBe(true))
    const text = zoteroDialog(target).textContent ?? ''
    expect(text).toContain(NO_BBT)
    expect(text).toContain('You can also type [@ to cite from your .bib without Zotero.')

    buttonByText(zoteroDialog(target), 'Open Install Page')!.click()
    expect(Browser.OpenURL).toHaveBeenCalledWith(INSTALL_URL)
  })

  it('shows the error itself when Zotero reports ready', async () => {
    DocumentService.ZoteroStatus.mockImplementation(async () => 'ready')
    const { target } = mountApp()
    listeners['menu:insert-citation']({ data: undefined })
    await vi.waitFor(() => expect(target.querySelector('.toast')?.textContent).toContain('zotero picker unavailable'))
    expect(zoteroDialog(target).open).toBe(false)
  })
})

describe('citation completion and hover in the mounted app', () => {
  const bib = '@article{smith2020, title={On Things}, author={Smith, Jane}, year={2020}}'
  const fm = '---\nbibliography: refs.bib\n---\n'

  afterEach(() => DocumentService.ReadBibliography.mockResolvedValue(''))
  // jsdom's Range has no geometry; CodeMirror measures the selection with it.
  beforeEach(() => {
    Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList
    Range.prototype.getBoundingClientRect = () => new DOMRect()
  })

  async function openWithBib(body: string) {
    DocumentService.ReadBibliography.mockResolvedValue(bib)
    const target = await openDoc(`${fm}# Results\n\n${body}\n`)
    // The preview formats the citation once the formatter has loaded.
    await vi.waitFor(() => expect(target.querySelector('.preview-pane')?.textContent).toContain('Smith'))
    return { target, view: EditorView.findFromDOM(target.querySelector('.cm-editor')!)! }
  }

  it('opens the completion popup while typing [@ and letters', async () => {
    const { view } = await openWithBib('See [@smith2020].\n\nAlso ')
    const at = view.state.doc.toString().indexOf('Also ') + 5
    view.dispatch({ selection: { anchor: at } })
    view.focus()
    let pos = at
    for (const ch of '[@smi') {
      view.dispatch({ changes: { from: pos, insert: ch }, selection: { anchor: pos + 1 }, userEvent: 'input.type' })
      pos++
    }
    await vi.waitFor(() => expect(completionStatus(view.state)).toBe('active'), { timeout: 2000 })
  })

  it('shows a hover tooltip over a key in the editor', async () => {
    const { target, view } = await openWithBib('See [@smith2020].')
    const pos = view.state.doc.toString().indexOf('smith2020') + 2
    // jsdom has no layout: pin the coordinate mapping to the key, then move
    // the mouse over the line the way a real pointer would.
    view.posAtCoords = (() => pos) as typeof view.posAtCoords
    view.coordsAtPos = (() => ({ top: 0, bottom: 20, left: 0, right: 10 })) as typeof view.coordsAtPos
    const line = [...view.contentDOM.querySelectorAll('.cm-line')].find((l) => l.textContent?.includes('smith2020'))!
    line.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 5, clientY: 5 }))
    await vi.waitFor(() => expect(target.querySelector('.cm-citation-tooltip')?.textContent).toContain('Smith'), {
      timeout: 2000,
    })
  })
})

describe('pasting an image', () => {
  function pasteEvent(items: { type: string; kind: string; file?: Blob }[], types: string[], text = '') {
    const ev = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(ev, 'clipboardData', {
      value: {
        items: items.map((i) => ({ kind: i.kind, type: i.type, getAsFile: () => i.file ?? null })),
        types,
        getData: (t: string) => (t === 'text/plain' ? text : ''),
        files: [],
      },
    })
    return ev
  }
  const png = () => new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' })

  it('saves it and inserts a link with the cursor in the alt text', async () => {
    const target = await openDoc('# Results\n\n')
    const view = EditorView.findFromDOM(target.querySelector('.cm-editor')!)!
    view.dispatch({ selection: { anchor: view.state.doc.length } })
    const ev = pasteEvent([{ kind: 'file', type: 'image/png', file: png() }], ['Files'])
    view.contentDOM.dispatchEvent(ev)
    expect(ev.defaultPrevented).toBe(true)

    await vi.waitFor(() => expect(view.state.doc.toString()).toContain('![](images/pasted-20261017-140305.png)'))
    expect(DocumentService.SavePastedImage).toHaveBeenCalledWith('/tmp/paper.md', 'AQID', 'png')
    const at = view.state.doc.toString().indexOf('![](') + 2
    expect(view.state.selection.main.head).toBe(at)
  })

  it('shows a message in an untitled document', async () => {
    recents.current = []
    const { target } = mountApp()
    await vi.waitFor(() => expect(target.querySelector('.cm-editor')).not.toBeNull())
    const view = EditorView.findFromDOM(target.querySelector('.cm-editor')!)!
    view.contentDOM.dispatchEvent(pasteEvent([{ kind: 'file', type: 'image/png', file: png() }], ['Files']))
    await vi.waitFor(() =>
      expect(target.querySelector('.toast')?.textContent).toBe('Save the document before pasting images'),
    )
    expect(DocumentService.SavePastedImage).not.toHaveBeenCalled()
  })

  it('refuses an image type it cannot save', async () => {
    const target = await openDoc('# Results\n\n')
    const view = EditorView.findFromDOM(target.querySelector('.cm-editor')!)!
    const bmp = new Blob([new Uint8Array([1])], { type: 'image/bmp' })
    view.contentDOM.dispatchEvent(pasteEvent([{ kind: 'file', type: 'image/bmp', file: bmp }], ['Files']))
    await vi.waitFor(() =>
      expect(target.querySelector('.toast')?.textContent).toBe('This image type cannot be pasted'),
    )
    expect(DocumentService.SavePastedImage).not.toHaveBeenCalled()
  })

  it('shows the failure message for an empty image and writes nothing', async () => {
    const target = await openDoc('# Results\n\n')
    const view = EditorView.findFromDOM(target.querySelector('.cm-editor')!)!
    const empty = new Blob([], { type: 'image/png' })
    view.contentDOM.dispatchEvent(pasteEvent([{ kind: 'file', type: 'image/png', file: empty }], ['Files']))
    await vi.waitFor(() =>
      expect(target.querySelector('.toast')?.textContent).toContain('Could not paste the image'),
    )
    expect(DocumentService.SavePastedImage).not.toHaveBeenCalled()
  })

  it('leaves a paste with text and an image to the normal text paste', async () => {
    const target = await openDoc('# Results\n\n')
    const view = EditorView.findFromDOM(target.querySelector('.cm-editor')!)!
    const ev = pasteEvent(
      [
        { kind: 'string', type: 'text/plain' },
        { kind: 'file', type: 'image/png', file: png() },
      ],
      ['text/plain', 'Files'],
      'hello',
    )
    view.contentDOM.dispatchEvent(ev)
    await new Promise((r) => setTimeout(r, 20))
    expect(DocumentService.SavePastedImage).not.toHaveBeenCalled()
    expect(view.state.doc.toString()).toContain('hello')
  })
})

describe('Word and LaTeX export', () => {
  async function openPaper(content = '# Results\n') {
    recents.current = ['/tmp/paper.md']
    DocumentService.OpenPath.mockResolvedValueOnce({ path: '/tmp/paper.md', content })
    const m = mountApp()
    await vi.waitFor(() => expect(m.target.querySelector('.welcome')).not.toBeNull())
    listeners['menu:open-recent']({ data: '/tmp/paper.md' })
    await vi.waitFor(() => expect(m.target.textContent).toContain('Results'))
    return m
  }
  const dialog = (root: HTMLElement, label: string) =>
    root.querySelector<HTMLElement>(`dialog[aria-label="${label}"][open]`)

  it('asks to connect before the first export', async () => {
    PortalService.Account.mockResolvedValueOnce({ ...SIGNED_IN, signedIn: false, email: '' })
    const { target } = await openPaper()
    listeners['menu:export-pandoc']({ data: 'docx' })
    await vi.waitFor(() => expect(dialog(target, 'Connect to Halmos')).not.toBeNull())
    expect(dialog(target, 'Connect to Halmos')!.textContent).toContain('Export to Word')
    expect(PortalService.ChooseExportPath).not.toHaveBeenCalled()
  })

  it('shows the code while waiting', async () => {
    PortalService.Account.mockResolvedValueOnce({ ...SIGNED_IN, signedIn: false, email: '' })
    const { target } = await openPaper()
    listeners['menu:export-pandoc']({ data: 'docx' })
    await vi.waitFor(() => expect(dialog(target, 'Connect to Halmos')).not.toBeNull())
    buttonByText(dialog(target, 'Connect to Halmos')!, 'Connect')!.click()
    await vi.waitFor(() => expect(dialog(target, 'Connect to Halmos')!.textContent).toContain('BDFG-HJKL'))
    expect(PortalService.StartPairing).toHaveBeenCalled()
  })

  it('continues the export once approved', async () => {
    PortalService.Account.mockResolvedValueOnce({ ...SIGNED_IN, signedIn: false, email: '' })
    const { target } = await openPaper()
    listeners['menu:export-pandoc']({ data: 'docx' })
    await vi.waitFor(() => expect(dialog(target, 'Connect to Halmos')).not.toBeNull())
    buttonByText(dialog(target, 'Connect to Halmos')!, 'Connect')!.click()
    await vi.waitFor(() => expect(dialog(target, 'Connect to Halmos')!.textContent).toContain('BDFG-HJKL'))
    listeners['portal:pairing']({ data: { state: 'approved', email: 'c@x.com' } })
    await vi.waitFor(() => expect(PortalService.ChooseExportPath).toHaveBeenCalledWith('docx', '/tmp/paper.md'))
  })

  it('sends the document with its style and writes where the panel chose', async () => {
    const { target } = await openPaper()
    PortalService.ChooseExportPath.mockResolvedValueOnce('/tmp/out/paper.docx')
    listeners['menu:export-pandoc']({ data: 'docx' })
    await vi.waitFor(() => expect(PortalService.Export).toHaveBeenCalled())
    const [out, req] = PortalService.Export.mock.calls[0]
    expect(out).toBe('/tmp/out/paper.docx')
    expect(req.format).toBe('docx')
    expect(req.markdown).toBe('# Results\n')
    expect(String(req.csl)).toContain('<style')
    await vi.waitFor(() => expect(target.querySelector('.toast')?.textContent).toContain('Exported paper.docx'))
    buttonByText(target.querySelector('.toast')!, 'Show in Finder')!.click()
    expect(PortalService.RevealExport).toHaveBeenCalledWith('/tmp/out/paper.docx')
  })

  it('offers plans on no_seat', async () => {
    const { target } = await openPaper()
    PortalService.ChooseExportPath.mockResolvedValueOnce('/tmp/out/paper.docx')
    PortalService.Export.mockResolvedValueOnce({ status: 402, code: 'no_seat', pricingURL: 'https://www.halmoseditor.com/pricing' })
    listeners['menu:export-pandoc']({ data: 'docx' })
    await vi.waitFor(() => expect(dialog(target, 'Halmos subscription')).not.toBeNull())
    const d = dialog(target, 'Halmos subscription')!
    expect(d.textContent).toContain('Word and LaTeX export need a Halmos subscription.')
    buttonByText(d, 'See Plans')!.click()
    expect(PortalService.OpenPortalURL).toHaveBeenCalledWith('https://www.halmoseditor.com/pricing')
    expect(PortalService.SignOut).not.toHaveBeenCalled()
  })

  it('does not send when a check fails', async () => {
    const { target } = await openPaper('# Results\n\n[[[[[[[x]]]]]]]\n')
    PortalService.ChooseExportPath.mockResolvedValueOnce('/tmp/out/paper.docx')
    listeners['menu:export-pandoc']({ data: 'latex' })
    await vi.waitFor(() =>
      expect(target.querySelector('.toast')?.textContent).toBe(
        'Line 3 nests square brackets more than 6 deep, which the export service refuses.',
      ),
    )
    expect(PortalService.Export).not.toHaveBeenCalled()
  })

  it('redraws a document image that is not PNG, JPEG or GIF at its own size', async () => {
    await openPaper('# Results\n\n![A](fig.webp)\n')
    PortalService.ChooseExportPath.mockResolvedValueOnce('/tmp/out/paper.docx')
    PortalService.ReadExportImage.mockResolvedValueOnce({ base64: 'UklGRg==', mime: 'image/webp', error: '' })
    listeners['menu:export-pandoc']({ data: 'docx' })
    await vi.waitFor(() => expect(PortalService.Export).toHaveBeenCalled())
    expect(rasterise.toPng).toHaveBeenCalledWith('data:image/webp;base64,UklGRg==', 1)
    const req = PortalService.Export.mock.calls[0][1] as { markdown: string; images: Record<string, string> }
    expect(req.images['images/1.png']).toBe('PNGDATA')
    expect(req.markdown).toContain('![A](images/1.png)')
  })

  it('abandons the export when the document is edited while the panel is up', async () => {
    const { target } = await openPaper()
    let choose!: (v: string) => void
    PortalService.ChooseExportPath.mockReturnValueOnce(new Promise<string>((r) => (choose = r)))
    listeners['menu:export-pandoc']({ data: 'docx' })
    await vi.waitFor(() => expect(PortalService.ChooseExportPath).toHaveBeenCalled())
    const view = EditorView.findFromDOM(target.querySelector('.cm-editor')!)!
    view.dispatch({ changes: { from: 0, insert: 'Edited ' } })
    choose('/tmp/out/paper.docx')
    await vi.waitFor(() =>
      expect(target.querySelector('.toast')?.textContent).toBe('Export cancelled: the document changed'),
    )
    expect(PortalService.Export).not.toHaveBeenCalled()
  })

  it('starts one connection however often Connect is pressed', async () => {
    PortalService.Account.mockResolvedValueOnce({ ...SIGNED_IN, signedIn: false, email: '' })
    const { target } = await openPaper()
    let started!: (v: Record<string, unknown>) => void
    PortalService.StartPairing.mockReturnValueOnce(new Promise((r) => (started = r)))
    listeners['menu:export-pandoc']({ data: 'docx' })
    await vi.waitFor(() => expect(dialog(target, 'Connect to Halmos')).not.toBeNull())
    const connect = buttonByText(dialog(target, 'Connect to Halmos')!, 'Connect')!
    connect.click()
    flushSync()
    buttonByText(dialog(target, 'Connect to Halmos')!, 'Connect')?.click()
    expect(PortalService.StartPairing).toHaveBeenCalledTimes(1)
    started({ userCode: 'BDFG-HJKL', verificationURL: 'https://www.halmoseditor.com/device', expiresIn: 900, error: null })
    await vi.waitFor(() => expect(dialog(target, 'Connect to Halmos')!.textContent).toContain('BDFG-HJKL'))
  })

  it('drops a code that arrives after Cancel', async () => {
    PortalService.Account.mockResolvedValueOnce({ ...SIGNED_IN, signedIn: false, email: '' })
    const { target } = await openPaper()
    let started!: (v: Record<string, unknown>) => void
    PortalService.StartPairing.mockReturnValueOnce(new Promise((r) => (started = r)))
    listeners['menu:export-pandoc']({ data: 'docx' })
    await vi.waitFor(() => expect(dialog(target, 'Connect to Halmos')).not.toBeNull())
    buttonByText(dialog(target, 'Connect to Halmos')!, 'Connect')!.click()
    flushSync()
    buttonByText(dialog(target, 'Connect to Halmos')!, 'Cancel')!.click()
    expect(PortalService.CancelPairing).toHaveBeenCalled()
    started({ userCode: 'BDFG-HJKL', verificationURL: 'https://www.halmoseditor.com/device', expiresIn: 900, error: null })
    await new Promise((r) => setTimeout(r, 0))
    flushSync()
    expect(dialog(target, 'Connect to Halmos')).toBeNull()
  })

  it('Account shows the seat and signs out', async () => {
    const { target } = mountApp()
    listeners['menu:account']({ data: null })
    await vi.waitFor(() => expect(dialog(target, 'Halmos account')?.textContent).toContain('c@x.com'))
    const d = dialog(target, 'Halmos account')!
    expect(d.textContent).toContain('Complimentary')
    expect(d.textContent).toContain('Mac · ABCD')
    buttonByText(d, 'Sign Out')!.click()
    await vi.waitFor(() => expect(PortalService.SignOut).toHaveBeenCalled())
    await vi.waitFor(() => expect(dialog(target, 'Halmos account')?.textContent).toContain('Not connected'))
  })
})

// CodeMirror ignores accept and move keys for interactionDelay (75 ms)
// after the list opens, so a test waits that out the way a person would.
const listReady = () => new Promise((r) => setTimeout(r, 100))

describe('picking a cross-reference', () => {
  // jsdom's Range has no geometry; CodeMirror measures the selection with it.
  beforeEach(() => {
    Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList
    Range.prototype.getBoundingClientRect = () => new DOMRect()
  })

  const DOC = '# Results\n\nSee \n\n$$\na = b\n$$\n'

  async function openAt(content: string, at: number) {
    const target = await openDoc(content)
    const view = EditorView.findFromDOM(target.querySelector('.cm-editor')!)!
    view.dispatch({ selection: { anchor: at } })
    return { target, view }
  }

  function nameField(target: HTMLElement) {
    return target.querySelector<HTMLInputElement>('input[placeholder="bayes"]')!
  }

  function typeName(target: HTMLElement, name: string) {
    const input = nameField(target)
    input.value = name
    input.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
  }

  it('Insert → Cross-reference… lists the targets at the cursor', async () => {
    const { target, view } = await openAt(DOC, DOC.indexOf('See ') + 4)
    listeners['menu:insert-crossref']({ data: null })
    await vi.waitFor(() => expect(completionStatus(view.state)).toBe('active'))
    expect(target.querySelector('li.cm-crossref-option .cm-completionLabel')?.textContent).toBe('Unnamed equation')
  })

  it('Insert → Cross-reference… says so when there is nothing to refer to', async () => {
    const { target, view } = await openAt('# Results\n\nSee \n', 15)
    listeners['menu:insert-crossref']({ data: null })
    await vi.waitFor(() =>
      expect(target.querySelector('.toast')?.textContent).toBe(
        "There's nothing to refer to yet. Give a figure or table a caption, or add a display equation.",
      ),
    )
    expect(completionStatus(view.state)).toBeNull()
  })

  it('does not say so when the menu is refused for another reason', async () => {
    const { target } = await openAt('# Results\n\nSee \n', 15)
    listeners['menu:insert-table']({ data: null })
    flushSync()
    listeners['menu:insert-crossref']({ data: null })
    await new Promise((r) => setTimeout(r, 50))
    expect(target.querySelector('.toast')?.textContent ?? '').not.toContain('nothing to refer to')
  })

  it('does nothing while the table builder is open', async () => {
    const { view } = await openAt(DOC, DOC.indexOf('See ') + 4)
    listeners['menu:insert-table']({ data: null })
    flushSync()
    listeners['menu:insert-crossref']({ data: null })
    await new Promise((r) => setTimeout(r, 50))
    expect(completionStatus(view.state)).toBeNull()
  })

  it('asks for a name before referring to an unnamed equation, and keeps asking until it is usable', async () => {
    const { target, view } = await openAt(DOC, DOC.indexOf('See ') + 4)
    listeners['menu:insert-crossref']({ data: null })
    await vi.waitFor(() => expect(completionStatus(view.state)).toBe('active'))
    await listReady()
    acceptCompletion(view)
    flushSync()
    const dialog = target.querySelector('dialog[aria-label="Name this equation"]')!
    expect(dialog.hasAttribute('open')).toBe(true)
    expect(dialog.textContent).toContain('Halmos writes {#eq:name} after the equation.')

    buttonByText(dialog as HTMLElement, 'Insert')!.click()
    flushSync()
    expect(dialog.textContent).toContain('Type a name.')

    typeName(target, 'a b')
    buttonByText(dialog as HTMLElement, 'Insert')!.click()
    flushSync()
    expect(dialog.textContent).toContain('Use letters, digits, - _ or . only, no spaces.')
    expect(dialog.hasAttribute('open')).toBe(true)

    typeName(target, 'bayes')
    buttonByText(dialog as HTMLElement, 'Insert')!.click()
    flushSync()
    expect(view.state.doc.toString()).toBe('# Results\n\nSee @eq:bayes\n\n$$\na = b\n$$ {#eq:bayes}\n')
    expect(dialog.hasAttribute('open')).toBe(false)
  })

  it('says so when another equation has the name', async () => {
    const doc = DOC + '\n$$\nc\n$$ {#eq:bayes}\n'
    const { target, view } = await openAt(doc, doc.indexOf('See ') + 4)
    listeners['menu:insert-crossref']({ data: null })
    await vi.waitFor(() => expect(completionStatus(view.state)).toBe('active'))
    // In document order: the unnamed equation, then the named one.
    const options = [...target.querySelectorAll('li.cm-crossref-option .cm-completionLabel')].map((e) => e.textContent)
    expect(options).toEqual(['Unnamed equation', 'Equation 1'])
    await listReady()
    acceptCompletion(view)
    flushSync()
    typeName(target, 'bayes')
    const dialog = target.querySelector('dialog[aria-label="Name this equation"]') as HTMLElement
    buttonByText(dialog, 'Insert')!.click()
    flushSync()
    expect(dialog.textContent).toContain('Another equation already has that name.')
  })

  it('Cancel leaves the document as it was', async () => {
    const { target, view } = await openAt(DOC, DOC.indexOf('See ') + 4)
    listeners['menu:insert-crossref']({ data: null })
    await vi.waitFor(() => expect(completionStatus(view.state)).toBe('active'))
    await listReady()
    acceptCompletion(view)
    flushSync()
    const dialog = target.querySelector('dialog[aria-label="Name this equation"]') as HTMLElement
    buttonByText(dialog, 'Cancel')!.click()
    flushSync()
    expect(dialog.hasAttribute('open')).toBe(false)
    expect(view.state.doc.toString()).toBe(DOC)
  })

  it('toasts and writes nothing when the equation went away while the name was asked', async () => {
    const { target, view } = await openAt(DOC, DOC.indexOf('See ') + 4)
    listeners['menu:insert-crossref']({ data: null })
    await vi.waitFor(() => expect(completionStatus(view.state)).toBe('active'))
    await listReady()
    acceptCompletion(view)
    flushSync()
    const eq = view.state.doc.toString().indexOf('a = b')
    view.dispatch({ changes: { from: eq, to: eq + 5, insert: 'c = d' } })
    typeName(target, 'bayes')
    const dialog = target.querySelector('dialog[aria-label="Name this equation"]') as HTMLElement
    buttonByText(dialog, 'Insert')!.click()
    flushSync()
    await vi.waitFor(() =>
      expect(target.querySelector('.toast')?.textContent).toBe('That equation moved, so no reference was added.'),
    )
    expect(view.state.doc.toString()).toBe('# Results\n\nSee \n\n$$\nc = d\n$$\n')
    expect(dialog.hasAttribute('open')).toBe(false)
  })

  it("refuses a reference on an unlabelled table's own caption line, and says so", async () => {
    const doc = '# Results\n\n| a |\n| --- |\n| 1 |\n\n: Crops, as @tbl:\n'
    const { target, view } = await openAt(doc, doc.length - 1)
    startCompletion(view)
    await vi.waitFor(() => expect(completionStatus(view.state)).toBe('active'))
    await listReady()
    acceptCompletion(view)
    flushSync()
    await vi.waitFor(() =>
      expect(target.querySelector('.toast')?.textContent).toBe("That reference is on the table's own line, so it wasn't added."),
    )
    expect(view.state.doc.toString()).toBe(doc)
    closeCompletion(view)
  })

  it('labels an unlabelled figure straight away when it is chosen', async () => {
    const doc = '# Results\n\nSee @fig:\n\n![Yield](a.png)\n'
    const { view } = await openAt(doc, doc.indexOf('@fig:') + 5)
    // Typing opens the list; here it is asked for directly.
    startCompletion(view)
    await vi.waitFor(() => expect(completionStatus(view.state)).toBe('active'))
    await listReady()
    acceptCompletion(view)
    flushSync()
    expect(view.state.doc.toString()).toBe('# Results\n\nSee @fig:yield\n\n![Yield](a.png){#fig:yield}\n')
    closeCompletion(view)
  })
})
