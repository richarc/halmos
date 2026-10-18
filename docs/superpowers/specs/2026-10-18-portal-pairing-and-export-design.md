# Portal pairing and Word/LaTeX export: design

Date: 2026-10-18. The contract is `~/Development/hermesportal/docs/api/device-flow.md`, and it governs. Where this document and the contract disagree, the contract wins. The brief is the portal session's `editor-agent-brief.md`. The user skipped the design questions, so every decision below marked **(call)** is the author's and open to change.

## Intent

The editor connects to the person's Halmos account and exports the open document to Word (`.docx`) or LaTeX (`.tex`). The conversion runs on the portal's Pandoc, so nothing is installed on the Mac. The point right now is to test the portal end to end from the real app. This is v1.1.0 work, pulled forward without worrying about roadmap order.

## Goals

- Pair this Mac with the account through the device flow, and stay signed in across launches.
- File → Export Word… and File → Export LaTeX… produce a file the person saves where they choose, with citations and the reference list in the document's style.
- Every error in the contract leads to a specific, plain message and the action the contract prescribes.
- Nothing the document caused to fail is sent if the editor could have caught it first, because failures are charged to the seat.

## Non-goals

- The DOI lookup and reference check services. They are placeholders on the server.
- Buying a seat in the app. A `402` opens the portal's `pricing_url`.
- Windows and Linux Keychain equivalents.
- Converting on every keystroke, or any background conversion.

## Anti-goals

These would make it a failure even if it technically worked:

- A refresh token in `settings.json`, a log, or anywhere but the Keychain.
- A `402` that signs the person out or asks them to pair again.
- Two refreshes racing, so the server sees theft and revokes the device.
- An API call from the webview's `fetch`. The API has no CORS by design.
- Following a URL from the server to a host other than the one being talked to.

## Constraints from the contract

- Base `https://www.halmoseditor.com/api/v1`, on the `www` host only. `client_id` is `halmos-editor`.
- JSON bodies with `Content-Length` and no chunking. The cap is 4 KB, or 25 MiB for a conversion.
- Access tokens last 15 minutes. Every refresh returns a new refresh token that must be persisted before the access token is used.
- Refresh once on a `401`. A `401` right after a refresh means pair again. Never refresh or re-pair on a `402`.
- `Retry-After` is honoured on every `429` and `503`. Only one conversion per seat runs at a time.
- Conversion limits:
  - markdown and bibliography 2 MiB each; CSL 256 KiB, with no `<!DOCTYPE` or `<!ENTITY`
  - images: DOCX only, PNG/JPEG/GIF, at most 50, 8 MiB each and 16 MiB together
  - keys are ASCII and safe, up to 4 segments
  - brackets nest at most 6 deep in a paragraph
  - 20 seconds of conversion time
- Front matter `bibliography:` and `csl:` are ignored by the server. The request's fields are the only ones used.

## Where the code goes

**All HTTP is in Go.** A new `portal` area in the Go backend:

- `portalclient.go` holds the HTTP client:
  - The base URL, which is the `www` origin in release builds. A `HALMOS_PORTAL_URL` override exists only in files built without the `production` tag. Release builds already pass `-tags production`, so the override is compiled out. The override takes an `https://` origin with no path; anything else is refused.
  - Request building with an explicit `Content-Length`, and redirects not followed. A 301 is reported as a misconfiguration and never re-sent.
  - Error decoding into `{status, error, reason, limit, pricingURL, retryAfter}`.
- `portalauth.go` holds pairing, tokens and refresh:
  - **One `sync.Mutex` serialises every refresh** and every read of the access token. A refresh writes the new refresh token to the Keychain, and only then hands out the access token.
  - The access token lives in memory only. It is refreshed when under 60 seconds remain, or once on a `401`.
- `keychain_darwin.go` stores items with the Security framework through cgo, as `print_darwin.go` already uses cgo:
  - Generic password items, with service `com.qxquantum.hermes.portal` and account set to the **origin**, so credentials are kept per origin.
  - The device name and device id go in the same item's comment or a second item.
  - Nothing goes in `settings.json`. **(call)** The brief speaks of moving the token out of `settings.json`, but the editor has never stored one there, so nothing needs migrating.
- `portalservice.go` is the binding the frontend calls:
  - `Account() (AccountInfo, error)`: `/me`. Returns signed out when there is no token.
  - `StartPairing() (PairingInfo, error)`: `{userCode, expiresIn}`. It also opens `verification_uri_complete` in the browser, but only if it is on the current origin. Polling runs in a Go goroutine at `interval`, adding 5 s on `slow_down` up to 60 s, and emits `portal:pairing` events (`approved`, `denied`, `expired`, `failed`).
  - `CancelPairing()`
  - `SignOut()`: deletes the Keychain item and the in-memory token.
  - `Export(format string, req ExportRequest, docPath string) (string, error)`: shows the save panel, sends the conversion, decodes the result, writes the file atomically with the existing atomic-write helper, and returns the saved path. An empty path means the person cancelled.
- **Device name (call):** the Mac's Computer Name plus a 4-character random suffix generated at each pairing, for example `Craig's MacBook Pro · 7F3K`. It is cleaned to the contract's rules and cut to 80 characters. The suffix matters because the server has no sign-out endpoint (see Open items). Without it, pairing again after signing out would collide with the old device's name and be refused at approval.

## What the frontend builds

`lib/exportRequest.ts` (pure, tested) builds the conversion body from what the editor already holds:

- **Markdown:** the document text with front matter kept. The server ignores `bibliography:` and `csl:`. Image references are rewritten as described below.
- **Bibliography:** the `.bib` text already loaded for the preview, cut down to the entries the document cites, which the contract recommends. If citeproc parsing fails, the whole file is sent.
- **CSL:** the XML of the style in use: the bundled asset for a bundled id, or the custom file's text, read through the existing `ReadCitationStyle`. It is sent always, even for the default style, so the output matches the preview. **(call)**
- **Images (DOCX only):**
  - Every document-relative image becomes a key `images/<n>.<ext>`, with the reference in the sent markdown rewritten to that key. Real file names may contain spaces or non-ASCII, which the key rules forbid.
  - Go reads the bytes. A new binding returns base64 and the type detected from the bytes; the existing `ReadImageDataURI` resolution is reused.
  - SVG is rasterised to PNG in the webview by drawing it onto a canvas at 2× its natural size.
  - Remote (`http`) and `data:` images are left as they are; Pandoc renders them as their caption.
- **Charts and diagrams (call):** each Vega-Lite and Mermaid block is replaced, for DOCX, by its preview rendering rasterised to PNG at 2×, keeping its caption as alt text. Without this, a Word export of a paper with charts shows raw JSON. For LaTeX they stay as code blocks, since LaTeX gets no images.
- **LaTeX:** no images are sent. References keep their document paths, minus a leading `./`, so the `.tex` saved beside the document finds them. The save panel defaults to the document's folder for this reason.

**Checks before sending.** Any failure shows a message naming what to fix, and nothing is sent:

- markdown, bibliography or CSL over its limit
- a CSL with `<!DOCTYPE` or `<!ENTITY`
- more than 50 images, an image over 8 MiB, or images over 16 MiB together
- brackets nested more than 6 deep in a paragraph, counted by the contract's rule: blank-line paragraphs, `\[` not counted, code counted. The message gives the line number.

## What the person sees

- **Menus (call):**
  - File → Export Word… and Export LaTeX…, after Export HTML…
  - App menu → Account…, after About.
  - Both follow the existing `menu:*` event pattern.
- **First export on an unpaired Mac:**
  1. A dialog: "Export to Word uses your Halmos account. Connect this Mac?" with Connect and Cancel buttons.
  2. Connect starts pairing. The dialog shows the code in large monospace (`BDFG-HJKL`), says "Your browser has opened halmoseditor.com. Check the code matches, then approve.", and offers "Open the page again" and Cancel.
  3. On approval, the dialog says "Connected as craig@… · a confirmation email was sent". The export then continues straight to the save panel.
  4. Denied or expired: "Not connected" with Try again.
- **Converting:** a toast reads "Exporting to Word…", then "Exported paper.docx" with a Show in Finder button. The save panel comes before the upload, so a cancelled save sends nothing.
- **Account… dialog:**
  - Signed in: email, the seat ("Complimentary", "Personal plan", or "No subscription" with a See plans button), the device name, and Sign Out.
  - Signed out: a Connect button.
  - The dialog explains that signing out only forgets the connection on this Mac. Removing the device happens on the site.
- **Errors**, each one sentence in the existing error dialog or toast style:
  - `402 no_seat` or `subscription_inactive`: "Word and LaTeX export need a Halmos subscription." with See plans (`pricing_url`, same origin only). Tokens are kept.
  - `402 past_due`: "Your Halmos subscription's payment failed. Update the payment method to keep exporting." with Open billing.
  - `401` after one refresh: the device was signed out on the site, so the connect dialog shows again.
  - `429`: "Too many exports for now. Try again in N minutes." No automatic retry.
  - `503 busy`: retried silently after `Retry-After`, up to 3 times. After that, "Another export is still running."
  - `503 service_unavailable`: "The export service is restarting. Try again in a minute."
  - `400` or `413` with a `reason` or `limit`: a fixed sentence per word, such as "The citation style file isn't valid CSL" or "An image is not PNG, JPEG or GIF".
  - `422 timeout`: "The document took too long to convert."
  - `422 output_too_large`: "The converted document would be too large."
  - Other `422`: "The export service couldn't convert this document. Check the citation style."
  - Network failure: "Couldn't reach halmoseditor.com."

## Testing

- **Go unit tests against `httptest` servers:** every status in the contract's tables, token rotation persisted before use, one refresh at a time under concurrent callers, `402` never touching tokens, redirects refused, and the override refused in production builds.
- **Keychain:** a test on a throwaway service name, skipped in CI if the keychain is locked.
- **Frontend (Vitest):** the request builder covers image key rewriting, the LaTeX and DOCX differences, every pre-send check including the bracket rule, and trimming the bibliography to cited entries.
- **Against production, by hand, with the user:**
  - Pairing, with Craig approving the code.
  - A Word and a LaTeX export of `docs/test-document.md`, compared with `docs/test-pandoc/out`.
  - A `402`, using an account with no seat if one is available.
  - No test loops: production limits are 6 a minute and 60 an hour.

## Left to the builder

- Exact dialog layout within the design system.
- The wording of fixed messages, apart from those above.
- Whether the bibliography is trimmed in Go or TypeScript.

## Open items for the portal

These are not blocking:

1. **No sign-out endpoint.** The editor can forget its credential, but the device stays live on the server until removed on the site. A `POST /device/revoke` taking the refresh token would make Sign Out real. Until then, the Account dialog explains it.
2. **No URL for the devices page.** If the portal has a stable path such as `/account/devices`, the Account dialog can link to it.
