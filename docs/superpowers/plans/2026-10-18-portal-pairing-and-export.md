# Portal Pairing and Word/LaTeX Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The editor pairs with the person's Halmos account and exports the open document to `.docx` or `.tex` through the portal's Pandoc service.

**Architecture:**
- All HTTP is in Go. A small client handles the origin, requests and error decoding. An auth layer handles pairing and token rotation behind one mutex, with the refresh token in the Keychain. A `PortalService` binding is what the frontend calls.
- The frontend builds the conversion body (markdown, trimmed bibliography, CSL XML, images, charts and diagrams as PNG), checks it against the contract's limits before sending, and owns the dialogs and messages.

**Tech Stack:**
- Go: `net/http`, and cgo with the Security framework.
- Wails v3 bindings and events.
- Svelte 5 and TypeScript, tested with Vitest and jsdom.

**Spec:** `docs/superpowers/specs/2026-10-18-portal-pairing-and-export-design.md`. Its authority is the contract `~/Development/hermesportal/docs/api/device-flow.md`, which is read-only. Where the plan and the contract disagree, the contract wins.

## Global Constraints

- **Origin.** In release builds the origin is `https://www.halmoseditor.com` and the API base is `<origin>/api/v1`. A `HALMOS_PORTAL_URL` override exists only in files built with `//go:build !production`. It must be an `https://` origin with no path, query or fragment; anything else is refused.
- `client_id` is `halmos-editor`.
- **Requests.** Bodies are JSON with `Content-Length` and no chunking. Redirects are never followed: a 3xx returns `PortalError{Code: "misconfigured"}`. The User-Agent is `HalmosEditor/<version>`. Timeouts are 15 s, or 60 s for `/services/convert`.
- **Tokens.**
  - The refresh token is stored only in the Keychain: service `com.qxquantum.hermes.portal`, account set to the origin, data as JSON `{"refreshToken","deviceId","deviceName"}`.
  - The access token is kept only in memory.
  - Tokens and device codes are never logged and never sent to the frontend.
- **Refresh.**
  - One `sync.Mutex` covers every refresh and every read of the access token.
  - The new refresh token is saved before the access token is returned.
  - Refresh when under 60 s of the access token remains, or once on a `401`. A `401` after that refresh deletes the stored credential and returns `PortalError{Code: "reauth"}`.
  - A `402` never touches tokens.
- **Retries.**
  - `503 busy`: retry after `Retry-After` (default 2 s), up to 3 times.
  - `429`: never retried automatically; the error carries `retryAfterSeconds`.
  - `503 service_unavailable`: not retried.
- **Pairing.** Poll no faster than `interval`. On `slow_down`, add 5 s, capped at 60. Polling stops on `access_denied`, `expired_token`, `invalid_grant`, `invalid_client`, cancel, or `expires_in`.
- **Opening URLs.** URLs from the server (`verification_uri_complete`, `pricing_url`) are opened only when their origin equals the current origin. Otherwise the result is `PortalError{Code: "misconfigured"}`.
- **Device name.** The Computer Name (`scutil --get ComputerName`, falling back to the hostname), then ` · `, then 4 characters from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`. Control, bidirectional-override and zero-width characters are removed, whitespace is collapsed, and the result is cut to 80 runes, keeping the suffix.
- **Conversion body.** `{format, markdown, bibliography?, csl?, images?}`. `images` is sent for `docx` only.
- **Limits checked before sending** (UTF-8 bytes; MiB = 1,048,576 bytes):
  - markdown and bibliography: 2 MiB each
  - CSL: 256 KiB, and no `<!DOCTYPE` or `<!ENTITY`
  - images: at most 50, 8 MiB each and 16 MiB together (decoded)
  - whole body: 25 MiB
  - brackets: at most 6 deep per paragraph
- **Image keys** are `images/<n>.<png|jpg|gif>`, and charts and diagrams are `diagrams/<n>.png`, with `n` counting from 1 in document order.
- **Menus.**
  - File: `Export Word…` and `Export LaTeX…`, after `Export HTML…`, both emitting `menu:export-pandoc` with payload `"docx"` or `"latex"`.
  - App menu: `Account…` after About, emitting `menu:account`.
- **Event.** `portal:pairing` with payload `{state: "approved"|"denied"|"expired"|"failed", email?: string}`.
- **Messages** are the exact strings in the spec's "Errors" list.

## Review Focus

1. **Concurrent token use.** An export and an Account read that both find the token expired must refresh exactly once. Test: Task 3, `TestAccessTokenRefreshesOnceUnderConcurrency`.
2. **Losing the Keychain write.** If saving the new refresh token fails after a rotation, the call fails and the access token is not used, so the next attempt can use the 60-second retry window. Test: Task 3, `TestRefreshDoesNotUseAccessWhenSaveFails`.
3. **402 after a refresh.** A `401`, then a refresh, then a `402` keeps the new tokens and returns the `402`'s `pricing_url`. Test: Task 3, `TestAuthedDo402KeepsTokens`.
4. **A document with no path** (untitled) exporting to DOCX with local images: those images are left as captions and the export still runs. Test: Task 6, `skips local images when the document has no path`.
5. **Diagram order.** A chart that failed to render (`.chart-error`) must not shift later charts onto the wrong fence; it becomes a caption-only reference. Test: Task 7, `keeps fence order when a chart failed`.

---

### Task 1: Keychain credential store

**Files:**
- Create: `keychain_darwin.go`, `credentials.go`
- Test: `keychain_darwin_test.go`, `credentials_test.go`

**Interfaces:**
- Produces:
  - `type storedCredential struct { RefreshToken string \`json:"refreshToken"\`; DeviceID int \`json:"deviceId"\`; DeviceName string \`json:"deviceName"\` }`
  - `type credentialStore interface { Load(origin string) (storedCredential, bool, error); Save(origin string, c storedCredential) error; Delete(origin string) error }`
  - `newKeychainStore(service string) credentialStore` (darwin)
  - `type memoryStore` in `credentials.go`, used by tests in later tasks, with a `failSave bool` field.

- [ ] **Step 1: Failing tests.**
  - `TestKeychainStoreRoundTrip` uses service `com.qxquantum.hermes.portal.test`:
    - Save, then Load, returns the same values.
    - Saving again replaces the item; it does not add a duplicate.
    - Delete, then Load, gives `ok=false` and no error.
    - Delete of a missing item gives no error.
    - It is skipped when `CI` is set.
  - `TestKeychainStoreKeysByOrigin`: two origins hold different credentials.
  - `TestMemoryStore`: the same round trip, and Save returns an error when `failSave` is set.
- [ ] **Step 2: Run** `go test -run 'Keychain|MemoryStore' ./.`. Expected: FAIL (undefined).
- [ ] **Step 3: Implement.**
  - Use cgo with `-framework Security -framework CoreFoundation` and generic password items: `SecItemCopyMatching`, `SecItemUpdate` (falling back to `SecItemAdd` on `errSecItemNotFound`), and `SecItemDelete`.
  - Set `kSecAttrAccessible` to `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`.
  - The data is the JSON of `storedCredential`.
- [ ] **Step 4: Run** `go test ./.`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: Keychain store for the portal credential`.

---

### Task 2: Portal HTTP client and origin

**Files:**
- Create: `portalclient.go`, `portalorigin_production.go` (`//go:build production`), `portalorigin_dev.go` (`//go:build !production`)
- Test: `portalclient_test.go`

**Interfaces:**
- Produces:
  - `type PortalError struct { Status int \`json:"status"\`; Code string \`json:"code"\`; Reason string \`json:"reason,omitempty"\`; Limit string \`json:"limit,omitempty"\`; PricingURL string \`json:"pricingURL,omitempty"\`; RetryAfterSeconds int \`json:"retryAfterSeconds,omitempty"\` }`. It implements `error`.
  - The codes are the contract's `error` values, plus `network`, `misconfigured`, `reauth` and `signed_out`.
  - `portalOrigin() (string, error)`
  - `validateOrigin(s string) (string, error)`
  - `sameOrigin(rawURL, origin string) bool`
  - `type portalClient struct { origin string; http *http.Client; version string }`
  - `newPortalClient(origin, version string) *portalClient`
  - `(c *portalClient) do(ctx context.Context, method, path string, body any, bearer string, timeout time.Duration) ([]byte, *PortalError)`

- [ ] **Step 1: Failing tests** against `httptest.NewTLSServer`, with the client's `http` set to the server's client:
  - `TestDoSendsJSONWithLength`: the server sees `Content-Type: application/json`, a `Content-Length` equal to the body's length, no `Transfer-Encoding`, `Authorization: Bearer x` when a bearer is given, and the User-Agent.
  - `TestDoDecodesErrors`: a table of `(status, body, header) → PortalError`, covering:
    - `402 no_seat` with `pricing_url`
    - `429` with `Retry-After: 120` gives 120
    - `400 invalid_request` with `reason: markdown_nesting`
    - `413` with `limit: image`
    - `503 busy` with no `Retry-After` gives the default of 2
    - a non-JSON 500 gives `Code: "server_error"`
  - `TestDoRefusesRedirects`: a 301 gives `misconfigured`, and the target handler is never hit.
  - `TestDoNetworkError`: a closed server gives `Code: "network"`.
  - `TestValidateOrigin`:
    - accepts `https://x.trycloudflare.com`
    - refuses `http://…`, `https://x.com/path`, `https://x.com?q`, and `""`
  - `TestSameOrigin`: the same scheme and host is true; a different host, scheme or port is false.
  - `TestProductionOriginIgnoresEnv` is in a `//go:build production` test file and runs with `go test -tags production -run ProductionOrigin ./.`. With `HALMOS_PORTAL_URL` set, it still returns `https://www.halmoseditor.com`.
- [ ] **Step 2: Run** `go test -run 'Do|Origin' ./.`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - `CheckRedirect` returns `http.ErrUseLastResponse`.
  - Bodies are marshalled to a `bytes.Reader`, so `Content-Length` is set.
  - Responses are read with `io.LimitReader`: 64 MiB for convert, 1 MiB otherwise.
- [ ] **Step 4: Run** `go test ./. && go test -tags production -run ProductionOrigin ./.`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: portal HTTP client`.

---

### Task 3: Pairing and token rotation

**Files:**
- Create: `portalauth.go`, `devicename.go`
- Test: `portalauth_test.go`, `devicename_test.go`

**Interfaces:**
- Consumes: Task 1's `credentialStore` and `memoryStore`, and Task 2's `portalClient` and `PortalError`.
- Produces:
  - `type portalAuth struct` with fields `client`, `store`, `now func() time.Time`, `mu sync.Mutex`, `access string`, `expiry time.Time`, `cred storedCredential`, `loaded bool`
  - `type pairing struct { DeviceCode, UserCode, VerificationURIComplete string; ExpiresIn, Interval int }`
  - `(a *portalAuth) startPairing(ctx, deviceName string) (pairing, *PortalError)`
  - `(a *portalAuth) pollPairing(ctx, p pairing, sleep func(time.Duration)) (storedCredential, *PortalError)`. It returns codes `access_denied`, `expired_token`, `invalid_grant` or `invalid_client`, and saves the credential on success.
  - `(a *portalAuth) accessToken(ctx) (string, *PortalError)`. It returns `signed_out` when there is no credential.
  - `(a *portalAuth) authedDo(ctx, method, path string, body any, timeout time.Duration) ([]byte, *PortalError)`
  - `(a *portalAuth) signOut() error`
  - `deviceName(computer string, rnd io.Reader) string`

- [ ] **Step 1: Failing tests**, using an `httptest` fake portal with scripted responses and a `memoryStore`:
  - `TestPollPairing`:
    - pending, then slow_down, then 200: the sleeps are interval, then interval+5, then save.
    - `slow_down` caps at 60.
    - `access_denied`, `expired_token` and `invalid_grant` each stop polling with that code.
    - It stops when ctx is cancelled.
  - `TestAccessTokenRefreshesWhenNearExpiry`: an expiry 59 s away triggers `/token`. The new refresh token is in the store before the access token is returned.
  - `TestAccessTokenRefreshesOnceUnderConcurrency`: 10 goroutines call `accessToken` with an expired token, and the fake sees exactly one `/token`.
  - `TestRefreshDoesNotUseAccessWhenSaveFails`: with `failSave`, `accessToken` returns an error and the in-memory access token stays empty.
  - `TestAuthedDoRefreshesOnceOn401`:
    - a 401, then a refresh, then a retry with 200 succeeds.
    - a 401, refresh, 401 deletes the credential and returns `reauth`.
  - `TestAuthedDo402KeepsTokens`: a 401, refresh, then 402 `no_seat` returns `pricing_url`, and the store still holds the rotated token.
  - `TestAuthedDoRetriesBusy`: two 503 `busy` responses with `Retry-After: 2`, then 200, gives success with two sleeps of 2 s. Four `busy` responses return `busy`.
  - `TestDeviceName`:
    - `"Craig's MacBook Pro"` gives `"Craig's MacBook Pro · "` plus 4 characters from the alphabet.
    - Control and zero-width characters are removed, and runs of whitespace collapse to one space.
    - A 100-rune name is cut to 80 runes with the suffix intact.
    - An empty name gives `"Mac · XXXX"`.
- [ ] **Step 2: Run** `go test -run 'Pairing|AccessToken|AuthedDo|Refresh|DeviceName' ./.`. Expected: FAIL.
- [ ] **Step 3: Implement.** Add an injectable `sleep` field (default `time.Sleep`) used by `authedDo`'s busy retry.
- [ ] **Step 4: Run** `go test ./.`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: device pairing and refresh-token rotation`.

---

### Task 4: PortalService binding, menus and registration

**Files:**
- Create: `portalservice.go`
- Modify:
  - `main.go`: register `application.NewService(portal)`.
  - `menu.go`:
    - Replace `menu.AddRole(application.AppMenu)` with a hand-built app submenu: About, `Account…`, a separator, Services, a separator, Hide, Hide Others, Show All, a separator, Quit, matching Wails' own `NewAppMenu` order.
    - Add the two File items after `Export HTML…`.
- Test: `portalservice_test.go`, `menu_test.go`
- Regenerate: `wails3 task common:generate:bindings`

**Interfaces:**
- Consumes: Task 3's `portalAuth`.
- Produces (bindings):
  - `AccountInfo{SignedIn bool; Email, Organisation, SeatSource, SeatStatus, DeviceName string; Error *PortalError}`
  - `PortalService.Account() AccountInfo`
  - `PortalService.StartPairing() (PairingInfo{UserCode string; ExpiresIn int; Error *PortalError})`. It opens the verification URL (same origin only) and polls in a goroutine. The goroutine emits `portal:pairing`, and on approval reads `/me` for the email.
  - `PortalService.CancelPairing()`
  - `PortalService.SignOut() error`
  - `PortalService.OpenPortalURL(url string) *PortalError`, for same-origin URLs only.
  - `PortalService.ChooseExportPath(format, docPath string) (string, error)`: the save panel with name `<stem>.docx` or `<stem>.tex` (or `Untitled.*`), defaulting to the document's folder.
  - `ExportImage{Base64, Mime string; Error string}` and `PortalService.ReadExportImage(docPath, src string) ExportImage`:
    - resolves with `localImagePath`
    - refuses over 8 MiB with `Error: "too_large"`
    - sets Mime from `http.DetectContentType`, or `image/svg+xml` for a `.svg` extension
  - `ConvertRequest{Format, Markdown, Bibliography, CSL string; Images map[string]string}` (JSON `omitempty`) and `PortalService.Export(path string, req ConvertRequest) *PortalError`. It posts, decodes `content_base64`, and calls `writeFileAtomic(path, data, 0o644)`.

- [ ] **Step 1: Failing tests:**
  - `TestServiceAccountSignedOut`: an empty store gives `SignedIn=false` with no error.
  - `TestServiceAccountMe`: the fake `/me` with a seat maps to the fields; `seat: null` gives empty seat fields.
  - `TestServiceExportWritesFile`: the fake convert returns base64 of `"PK…"`, and the file at the path holds those bytes.
  - `TestServiceExportSendsNoImagesForLatex`: images are present with `latex`, and the fake sees no `images` key.
  - `TestServiceExportErrorPassesThrough`: a 402 gives `*PortalError` with `pricingURL`, and no file is written.
  - `TestReadExportImage`: a PNG gives `image/png`; a `.svg` gives `image/svg+xml`; a 9 MiB file gives `too_large`; an untitled document with a relative src gives an Error.
  - `TestOpenPortalURLRefusesOtherHosts`.
  - menu_test: the File menu has `Export Word…` and `Export LaTeX…` right after `Export HTML…`, and the app menu has `Account…` right after About.
- [ ] **Step 2: Run** `go test ./.`. Expected: FAIL.
- [ ] **Step 3: Implement.** Then regenerate the bindings.
- [ ] **Step 4: Run** `go test ./. && go build -o /dev/null . && cd frontend && npm run check`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: PortalService, Export Word/LaTeX and Account menus`.

---

### Task 5: Bundled CSL XML and bibliography trimming

**Files:**
- Modify: `frontend/src/lib/citations.ts`, to export `loadStyleXml(id: string): Promise<string | null>` over the existing `STYLE_LOADERS`.
- Create: `frontend/src/lib/bibTrim.ts`
- Test: `frontend/src/lib/citations.test.ts`, `frontend/src/lib/bibTrim.test.ts`

**Interfaces:**
- Produces:
  - `loadStyleXml(id)`
  - `trimBibliography(bibText: string, keys: Set<string>): string`. It keeps `@string`, `@preamble` and `@comment` blocks, plus entries whose key is in `keys`. Brace matching counts nesting and ignores braces inside quoted values.

- [ ] **Step 1: Failing tests:**
  - `loadStyleXml('apa')` starts with `<?xml` and contains `<style`. An unknown id gives `null`.
  - trimBibliography:
    - keeps only the cited entries
    - keeps `@string` macros
    - handles nested braces `{A {B} C}` and `@Article` in mixed case
    - returns `''` for no keys
    - returns the text unchanged when it can't find any entry boundaries (a malformed file)
- [ ] **Step 2: Run** `cd frontend && npx vitest run src/lib/bibTrim.test.ts src/lib/citations.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same. Expected: PASS.
- [ ] **Step 5: Commit** `feat: CSL XML loader and bibliography trimming for export`.

---

### Task 6: Conversion request builder and pre-send checks

**Files:**
- Create: `frontend/src/lib/exportRequest.ts`
- Test: `frontend/src/lib/exportRequest.test.ts`

**Interfaces:**
- Consumes: Task 5's `trimBibliography`, and `findCitationKeys` from `lib/citationKeys.ts`.
- Produces:
  - `type ExportFormat = 'docx' | 'latex'`
  - `planImages(markdown: string, format: ExportFormat, hasDocPath: boolean): { markdown: string; refs: { src: string; key: string }[] }`
    - It rewrites `![alt](src "title")` references for local images:
      - DOCX: to `images/<n>.<ext>`, where `ext` is decided later from the bytes. The planned key uses a placeholder `images/<n>`, which `finalizeImages` resolves.
      - LaTeX: only a leading `./` is removed.
    - It never touches remote, `data:`, or absolute paths, or images inside code.
    - With no doc path, local images are left as they are, with no refs.
  - `finalizeImages(markdown, resolved: { key: string; ext: 'png'|'jpg'|'gif' | null }[]): string`. A `null` ext puts back a reference with no image, which becomes a caption.
  - `bracketDepthProblem(markdown: string): { line: number } | null`
  - `type ExportProblem = { code: 'markdown_size'|'bibliography_size'|'csl_size'|'csl_dtd'|'image_count'|'image_size'|'images_total'|'body_size'|'nesting'; line?: number }`
  - `checkRequest(req: { format; markdown; bibliography?; csl?; images?: Record<string,string> }): ExportProblem | null`
  - `buildBibliography(markdown, bibText): string | undefined`, which trims to the cited keys. `undefined` when there is no bib.

- [ ] **Step 1: Failing tests:**
  - planImages DOCX:
    - `![A](figs/my plot.png)` becomes key `images/1`, and the src is kept in refs.
    - Two references to the same src share one key.
    - `https://…` and `data:` are unchanged.
    - An image inside a fenced code block is unchanged.
    - **"skips local images when the document has no path."**
  - planImages LaTeX: `./figs/a.png` becomes `figs/a.png`, and no refs are returned.
  - finalizeImages: `images/1` with png gives `images/1.png`; with `null` it gives `![A](figs/my plot.png)`, the original text.
  - bracketDepthProblem:
    - 6 nested in a paragraph is ok; 7 nested gives the line number.
    - A blank line resets the count; a line with only `\t ` also resets it.
    - `\[` is not counted.
    - Brackets in a fenced block count.
  - checkRequest:
    - each limit at its boundary: exactly 2 MiB is ok, 2 MiB + 1 gives `markdown_size`
    - a CSL containing `<!DOCTYPE` gives `csl_dtd`
    - 51 images give `image_count`
    - images summing over 16 MiB (decoded, base64 length × 3/4 minus padding) give `images_total`
  - buildBibliography: only the cited keys are kept.
- [ ] **Step 2: Run** `cd frontend && npx vitest run src/lib/exportRequest.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Use the markdown-it tokenizer (as `renderer.ts` does) to find image tokens and fence ranges. Don't use a regex over the raw text, so code is respected.
- [ ] **Step 4: Run** the same. Expected: PASS.
- [ ] **Step 5: Commit** `feat: build and check the conversion request`.

---

### Task 7: Images, charts and diagrams to PNG

**Files:**
- Create: `frontend/src/lib/rasterise.ts`, `frontend/src/lib/exportDiagrams.ts`
- Test: `frontend/src/lib/exportDiagrams.test.ts`

**Interfaces:**
- Produces:
  - `toPng(dataUri: string, scale = 2): Promise<string>` (base64 PNG) in `rasterise.ts`, drawing through `Image` and `canvas`. It is used for SVG, WebP, AVIF and BMP.
  - `canvasToPng(c: HTMLCanvasElement): string`
  - `diagramImages(root: HTMLElement): Promise<(string | null)[]>`: one entry per `.vega-lite-chart` and `.mermaid-diagram` in document order. A chart's `canvas` uses `canvasToPng`. A mermaid `svg` is serialised and run through `toPng`. A `.chart-error`, a `.mermaid-error`, or an element with nothing rendered gives `null`.
  - `replaceDiagramFences(markdown: string, images: (string | null)[]): { markdown: string; images: Record<string,string> }`. The nth `vega-lite` or `mermaid` fence becomes `![<caption>](diagrams/<n>.png)` when its image is not null. The caption is the Vega-Lite `title`, or empty. A null leaves the fence as it is.

- [ ] **Step 1: Failing tests** (jsdom; `toPng` stubbed through `vi.mock('./rasterise')`):
  - diagramImages over a built DOM:
    - a chart with a canvas, a mermaid with an svg, and a chart with `.chart-error` give `[png, png, null]`
    - **"keeps fence order when a chart failed."**
  - replaceDiagramFences:
    - two fences with `[a, null]`: the first becomes an image with its title caption, and the second keeps its fence
    - non-diagram fences are untouched
    - a fence inside a list item counts in order
- [ ] **Step 2: Run** `cd frontend && npx vitest run src/lib/exportDiagrams.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** `rasterise.ts` is not unit-tested, because jsdom has no canvas. Task 9's click-through covers it.
- [ ] **Step 4: Run** the same. Expected: PASS.
- [ ] **Step 5: Commit** `feat: charts, diagrams and SVG to PNG for Word export`.

---

### Task 8: Dialogs, messages and the export flow in App

**Files:**
- Create: `frontend/src/ConnectDialog.svelte`, `frontend/src/AccountDialog.svelte`, `frontend/src/lib/portalMessages.ts`
- Modify:
  - `frontend/src/App.svelte`:
    - add `exportPandoc(format)` and `menu:export-pandoc`, `menu:account` and `portal:pairing` listeners
    - give `toast()` an optional `{label, run}` action
    - add the dialogs
  - `frontend/public/style.css`, only if new classes are needed. Use existing tokens, so the contract tests pass.
- Test: `frontend/src/lib/portalMessages.test.ts`, `frontend/src/App.test.ts`

**Interfaces:**
- Consumes: the Task 4 bindings, and Tasks 5–7.
- Produces:
  - `messageFor(err: PortalError, format: ExportFormat): { text: string; action?: 'pricing' | 'billing' | 'connect' }`
  - `problemMessage(p: ExportProblem): string`

**Flow of `exportPandoc(format)`:**
1. Apply the same guards as `exportHTML`.
2. Call `Account()`. If not signed in, open ConnectDialog in "ask" mode with the pending format.
3. On `portal:pairing` approved, continue.
4. `ChooseExportPath`. An empty path stops the export.
5. Wait for `preview.exportRoot()`, then run `diagramImages`, `replaceDiagramFences`, `planImages`, `ReadExportImage` for each ref, `toPng` where the type isn't png, jpeg or gif, and `finalizeImages`.
6. Get the CSL: `loadStyleXml(fmCsl ?? 'apa')`, or `ReadCitationStyle` for a style file.
7. `buildBibliography`, then `checkRequest`. On a problem, toast `problemMessage` and stop.
8. Toast "Exporting to Word…" or "Exporting to LaTeX…", then call `Export`.
9. On success, toast "Exported <name>" with a "Show in Finder" action, using the existing reveal binding if there is one, or else `Browser.OpenFile` on the folder.
10. On an error:
    - an action error opens a small alertdialog with the message and a button (See plans or Open billing, through `OpenPortalURL(pricingURL)`)
    - `reauth` opens ConnectDialog
    - anything else toasts the message

- [ ] **Step 1: Failing tests:**
  - portalMessages: one case per code in the spec's Errors list, with the exact strings, including the `429` minutes rounded up from `retryAfterSeconds`. Unknown codes fall back to "The export service couldn't convert this document."
  - App.test, with `PortalService` mocked like `DocumentService`:
    - **"asks to connect before the first export"**: `Account` returns signed out, `menu:export-pandoc` `docx` opens a dialog labelled "Connect to Halmos", and `ChooseExportPath` isn't called.
    - **"shows the code while waiting"**: Connect calls `StartPairing`, and the user code is shown.
    - **"continues the export once approved"**: `portal:pairing` approved, then `ChooseExportPath('docx', …)` is called.
    - **"offers plans on no_seat"**: `Export` returns a 402 with `no_seat`, a dialog shows the no-seat text, and See plans calls `OpenPortalURL` with the URL.
    - **"does not send when a check fails"**: 7-deep brackets toast the nesting message, and `Export` isn't called.
    - **"Account shows the seat"**: `menu:account` with a signed-in account shows the email, "Complimentary" and Sign Out. Sign Out calls `SignOut`.
- [ ] **Step 2: Run** `cd frontend && npx vitest run src/lib/portalMessages.test.ts src/App.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Use the existing `Dialog.svelte`, with `role="alertdialog"` for errors. The code is shown in `ui-monospace` at 24px.
- [ ] **Step 4: Run** `cd frontend && npm test && npm run check`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: connect, account and Word/LaTeX export in the app`.

---

### Task 9: Docs, package, click-through with Craig

**Files:**
- Modify: `CHANGELOG.md` (Unreleased → Added), `README.md` (a short "Export to Word and LaTeX" section, including that it needs a Halmos account and sends the document to halmoseditor.com for conversion), and `docs/getting-started.md` if it lists exports.

- [ ] **Step 1: Docs.** CHANGELOG bullet:

```markdown
- Export to Word and LaTeX (File → Export Word…, Export LaTeX…), converted
  by Pandoc on halmoseditor.com with the document's citation style. Needs a
  Halmos account: the first export connects this Mac to it, and
  Account… in the app menu shows the connection and the subscription.
```

- [ ] **Step 2: Full suite** `go test ./. && go test -tags production -run ProductionOrigin ./. && cd frontend && npm test && npm run check`. Expected: PASS.
- [ ] **Step 3: Commit** `docs: Word and LaTeX export`.
- [ ] **Step 4: Package and launch.** `wails3 task package`, re-register Quick Look, then `open`. Confirm `strings "bin/Halmos Editor" | grep -c "api/v1"` is at least 1, and that `HALMOS_PORTAL_URL` is absent from the binary.
- [ ] **Step 5: Click-through with Craig.** There are about 4 conversions in total. No loops.
  1. Halmos Editor → Account…: it shows "Not connected". Press Connect, and the browser opens to the code. **Craig approves.** The dialog then shows the email and "Complimentary".
  2. Open `docs/test-document.md`, then File → Export Word…, and save to the Desktop. Open the `.docx` in Word or Pages. Check the citations, the reference list, the images and the charts against `docs/test-pandoc/out`.
  3. File → Export LaTeX… beside the document. The `.tex` names the images by their paths.
  4. Account… → Sign Out, then Export Word… asks to connect again. Cancel.
  5. Optional, if an account without a seat is at hand: a `402` shows See plans.
