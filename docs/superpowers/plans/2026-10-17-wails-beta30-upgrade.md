# Wails v3.0.0-beta.30 Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Halmos from Wails `v3.0.0-beta.12` to `v3.0.0-beta.30` with no change in app behaviour other than the upstream fixes.

**Architecture:** A dependency bump in three places that must match (Go module, `wails3` CLI, `@wailsio/runtime`), regenerated bindings, then checks of the macOS paths the upstream changes touch: modal panels (beta.13), window close/hide (beta.30), per-run-loop JS calls (beta.30) and the private-API gate (beta.19). No app code is expected to change; if a build or test fails, that is a finding to report, not something to patch around inside this plan.

**Tech Stack:** Go 1.26 / cgo, Wails v3 beta.30, Svelte 5 + Vite, Task.

**Spec:** none written; the requirements are the release-notes review in this session, summarised under Global Constraints.

## Global Constraints

- Target version exactly `v3.0.0-beta.30` (Go) / `3.0.0-beta.30` (npm) — no caret, no range.
- `go.mod`, the installed `wails3` CLI and `frontend/package.json` must all read beta.30 before any build.
- Do **not** run `wails3 task common:update:build-assets` or `update:build-assets`: it would drop the hand-added `deps: [build]` on `run` in `build/darwin/Taskfile.yml`, and nothing in beta.13–30 needs the newer templates.
- Do **not** add the `private_mac_apis` build tag to production builds. Halmos uses no transparency, Liquid Glass or programmatic inspector opening.
- Never hand-edit `frontend/bindings/`; regenerate.
- Old plans under `docs/superpowers/plans/` that mention beta.12 are history; leave them.
- `ROADMAP.md`, `README.md`, `CHANGELOG.md`: single-block `str.replace`/Edit only, per CLAUDE.md.

## Review Focus

1. **Export PDF on a long document** (beta.13 changed main-thread work during modal loops; `print_darwin.go` runs `NSPrintPanel` then `runOperationModalForWindow:`). Expected: panel opens, PDF has every page, no hang. Covered in Task 3 checklist item 1.
2. **Close the window with unsaved changes, then reopen from the Dock** (beta.30 "prevent duplicate window teardown"; Halmos hides instead of destroying). Expected: Save/Don't Save prompt, window comes back with state intact. Task 3 items 3–4.
3. **Open/Save panels and the `.csl` chooser** (same modal-loop change). Expected: panels open, choose, return a path; app keeps responding. Task 3 item 2.
4. **Dark theme on launch** (beta.19 moved window background colour to a public API). Expected: no white flash before the page paints in dark mode. Task 3 item 6.
5. **Safari Web Inspector in a dev build** (beta.19 gates `developerExtrasEnabled` behind `private_mac_apis`; Wails' dev build now sets `inspectable` itself). Expected: app listed in Safari → Develop. Task 2.

---

### Task 1: Bump the pins, regenerate bindings, pass the suites

**Files:**
- Modify: `go.mod:7`, `go.sum`
- Modify: `frontend/package.json:30`, `frontend/package-lock.json`
- Modify (regenerated): `frontend/bindings/**`
- Modify: `README.md:107`, `README.md:113`, `CLAUDE.md:5`, `ROADMAP.md:227`, `CHANGELOG.md` (`## [Unreleased]`)

**Interfaces:**
- Produces: a tree where `go build .`, `go test ./.`, `npm test`, `npm run check` and `wails3 task build` all succeed at beta.30. Tasks 2 and 3 build from this.

- [ ] **Step 1: Record the baseline**

Run: `go test ./. && (cd frontend && npm test && npm run check)`
Expected: all pass at beta.12. If not, stop — a pre-existing failure would be blamed on the upgrade.

- [ ] **Step 2: Install the CLI**

Run: `go install github.com/wailsapp/wails/v3/cmd/wails3@v3.0.0-beta.30 && wails3 version`
Expected: `v3.0.0-beta.30`

- [ ] **Step 3: Bump the Go module**

Run: `go get github.com/wailsapp/wails/v3@v3.0.0-beta.30 && go mod tidy && git diff go.mod`
Expected: line 7 reads `v3.0.0-beta.30`; the `go` directive does not drop (beta.30 needs 1.25.0). Note any indirect dependency changes for the commit message.

- [ ] **Step 4: Bump the runtime**

Run: `cd frontend && npm install --save-exact @wailsio/runtime@3.0.0-beta.30 && grep wailsio/runtime package.json`
Expected: `"@wailsio/runtime": "3.0.0-beta.30",`

- [ ] **Step 5: Regenerate bindings**

Run: `wails3 task common:generate:bindings && git diff --stat frontend/bindings`
Expected: succeeds. Read the diff: changes should be formatting/helper-ordering only (beta.21 changed generic model creator ordering). Any change to a `hermes/*` service signature is unexpected — stop and report.

- [ ] **Step 6: Run the suites and builds**

Run: `go test ./. && go build -o /dev/null . && (cd frontend && npm test && npm run check && npm run build) && wails3 task build`
Expected: all pass; `bin/Halmos Editor` mtime is now. If `bin/Halmos Editor` is a universal binary left by a release build, delete it and rerun (see memory: package after release build).

- [ ] **Step 7: Update the version references**

- `README.md:107` → `Beta (\`v3.0.0-beta.30\`) — match \`go.mod\``
- `README.md:113` → `...wails3@v3.0.0-beta.30`
- `CLAUDE.md:5` → `v3.0.0-beta.30`
- `ROADMAP.md:227` → replace `Wails\n  beta.12 gives no hook for` with `Wails\n  (checked up to beta.30) gives no hook for` — the delegate's `applicationShouldTerminate` is unchanged between the two versions.
- `CHANGELOG.md` under `## [Unreleased]` add:

```markdown
### Changed

- Updated Wails to v3.0.0-beta.30. On macOS this stops the app running
  about 120 empty script calls a second while the window is open, fixes a
  memory leak, and keeps the app responsive while print and file panels
  are open.
```

Check: `grep -c '^- \[' ROADMAP.md` and `grep '^## ' ROADMAP.md` unchanged from before the edit.

- [ ] **Step 8: Commit**

```bash
git add go.mod go.sum frontend/package.json frontend/package-lock.json frontend/bindings README.md CLAUDE.md ROADMAP.md CHANGELOG.md
git commit -m "build: update Wails to v3.0.0-beta.30"
```

---

### Task 2: Dev build and Web Inspector

**Files:**
- Modify: `.claude/skills/web-inspector/SKILL.md:8`

**Interfaces:**
- Consumes: Task 1's tree.

- [ ] **Step 1: Build and launch a dev build**

Run: `wails3 task build DEV=true && wails3 task run DEV=true`
Expected: app launches. Confirm the binary is new: `ls -lT "bin/Halmos Editor"`.

- [ ] **Step 2: Check the inspector (user)**

Ask the user: Safari → Develop → this Mac — is Halmos Editor listed, and does the inspector attach? Also: does right-click in the preview show "Inspect Element"?
Expected: listed and attaches (Wails' `webview_window_darwin_dev.go` and our `inspector_darwin.go` both set `inspectable`). "Inspect Element" is expected to be **gone**, because `developerExtrasEnabled` is now only set under `private_mac_apis`.

- [ ] **Step 3: If the Develop menu does not list the app**

Rebuild with `wails3 task build DEV=true EXTRA_TAGS=private_mac_apis` and re-check. If that fixes it, the dev command for profiling becomes that one. Do not touch production tags.

- [ ] **Step 4: Update the skill**

In `.claude/skills/web-inspector/SKILL.md:8` replace the sentence beginning "Two things have to be true…" with what Step 2/3 found. Facts to state: since beta.19 `developerExtrasEnabled` is set only with `EXTRA_TAGS=private_mac_apis`; since beta.30 Wails' dev build sets `inspectable` itself, so `inspector_darwin.go` is now belt-and-braces; the `strings … | grep -c developerExtrasEnabled` check reads 0 in a default dev build and 1 only with the tag. Also fix the stale binary name there: `bin/Hermes Editor` → `bin/Halmos Editor`.

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/web-inspector/SKILL.md
git commit -m "docs: web-inspector skill for Wails beta.30 private-API gate"
```

---

### Task 3: Packaged-app click-through and idle CPU check

**Files:** none changed unless a check fails.

**Interfaces:**
- Consumes: Task 1's tree.

- [ ] **Step 1: Measure idle CPU on the current release first**

With the installed v0.14.0 app (beta.12) open on a document and left idle 30 s:
Run: `top -l 6 -s 5 -stats pid,command,cpu | grep -i halmos`
Record the CPU figures (app process and its `com.apple.WebKit.WebContent` helper: `top -l 6 -s 5 -stats pid,command,cpu | grep -i webcontent`). Quit it.

- [ ] **Step 2: Package and register**

Run: `wails3 task package && ls -lT "bin/Halmos Editor.app/Contents/MacOS/Halmos Editor" && open "bin/Halmos Editor.app"`
Expected: package succeeds and re-signs; Quick Look appex embedded. Re-register Quick Look per memory (`lsregister` + `pluginkit -a`) if needed.

- [ ] **Step 3: Measure idle CPU on the new build**

Same document, same 30 s idle, same `top` commands.
Expected: lower than Step 1, mainly in the WebContent process. Record both figures for the user. Equal figures are not a failure of the upgrade, just no measurable gain.

- [ ] **Step 4: User click-through**

Give the user this checklist on the packaged app and collect pass/fail for each:

1. File → Export PDF… on a long document (10+ pages): panel opens, PDF has every page, app does not hang.
2. File → Open…, Save As…, and Citation Style → Other… (`.csl` panel): each opens, returns, app keeps responding.
3. Edit a document, click the window's close button: Save/Don't Save/Cancel prompt appears; Cancel keeps the window.
4. Close with Don't Save, then click the Dock icon / open a file from Finder: window returns, no crash.
5. ⌘Q with unsaved changes: prompt appears.
6. View → Appearance → Dark, quit, relaunch: no white flash before the page paints.
7. Format menu shortcuts (⌘B, ⌘I, ⌘⇧K) and ⌘⌥[ / ⌘⌥] fold.
8. Copy button on a code block, paste elsewhere: text copied.
9. Paste a screenshot into a saved document: image saved and linked.
10. Space bar on a `.md` in Finder: Quick Look preview renders.
11. Help → Check for Updates…: dialog reports v0.14.0 is current.

- [ ] **Step 5: Report**

Any failure: stop and use superpowers:systematic-debugging; compare against the v0.14.0 app to confirm it is a regression, not pre-existing. All pass: report the CPU figures and the checklist result. No commit — releasing is a separate decision.
