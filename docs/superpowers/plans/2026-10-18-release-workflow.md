# Release Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pushing a `v<version>` tag builds, signs, notarizes and staples the app on GitHub's macOS runner and leaves a draft GitHub release with the zip attached, ready for a person to check and publish.

**Architecture:** The workflow reuses `wails3 task release` and does not copy its steps, so the ordering that task documents stays in one place. The release task gains two things. It can notarize with an App Store Connect API key from files instead of a keychain profile. It also gets a guard task that fails when the tag doesn't match `build/config.yml`. The signing certificate and API key are repository secrets scoped to a protected `release` environment. They are loaded into a throwaway keychain and temp files that are deleted at the end of the run. A Go contract test checks the workflow file for the rules below, in the same way `styleContract.test.ts` checks the CSS.

**Tech Stack:** GitHub Actions (macOS runner), Task via `wails3 task`, `notarytool`, `gh`, Go tests.

**Spec:** the ROADMAP item "A release workflow" (v1.0.0), plus README "Cutting a release". The user skipped the design questions on 2026-10-18, so the choices below are the planner's own.

## Global Constraints

- Trigger: `push` of tags matching `v*`, plus `workflow_dispatch` for a dry run. Never on branches or pull requests.
- The workflow **never publishes** and **never pushes `main`**. It creates a **draft** release (`gh release create --draft --verify-tag`). This keeps README's feed rule intact: the feed is read from `main`, so `main` is pushed only after the release is public. Pushing just the tag (`git push origin v1.0.0`) uploads the commit but does not move `main`.
- A `workflow_dispatch` run skips the tag check and the release step. It uploads the zip as a workflow artifact (kept 7 days) instead.
- Notarization uses an **App Store Connect API key** (`notarytool --key --key-id --issuer`), never an Apple ID or app-specific password.
- Secrets live in the GitHub environment `release`, never as plain repository secrets. Names:
  - `DEVELOPER_ID_P12_BASE64` and `DEVELOPER_ID_P12_PASSWORD`: the exported Developer ID Application certificate with its private key.
  - `NOTARY_KEY_BASE64`, `NOTARY_KEY_ID` and `NOTARY_ISSUER_ID`: the `.p8` key, its key ID and the issuer ID.
- Secrets reach scripts only through `env:` and never appear inside `${{ }}` in a `run:` line. The key and certificate files go under `$RUNNER_TEMP`. A final step with `if: always()` deletes the keychain and those files.
- Permissions: the top level is `contents: read`. Only the release job has `contents: write`.
- Only first-party `actions/*` actions are used, at the versions `ci.yml` uses (`@v7`). The GitHub release is created with the preinstalled `gh`.
- The toolchain matches CI: Go `1.26.x` with `check-latest: true`, and Node `24`. `wails3` is installed with `go install github.com/wailsapp/wails/v3/cmd/wails3@<the version in go.mod>`, currently `v3.0.0-beta.30`.
- Release notes are the CHANGELOG section `## [<version>] - <date>`, up to the next `## ` heading. If that section is missing, the run fails rather than publishing empty notes.
- `concurrency: release-${{ github.ref }}` with `cancel-in-progress: false`, so a notarization in progress is never cut off. `timeout-minutes: 60`.

## Review Focus

1. **Tag and version disagree** (for example tag `v1.0.1` while config says 1.0.0). The run must fail before anything is signed. Test: Task 1, `release:check-tag`.
2. **Secret leakage.** No `${{ secrets.* }}` inside a `run:` script, the `.p12` and `.p8` are written only under `$RUNNER_TEMP`, and cleanup runs on failure as well. Test: Task 2 contract test.
3. **Accidental publish or early feed.** No `gh release create` without `--draft`, and no `git push` anywhere in the workflow. Test: Task 2 contract test.
4. **Missing CHANGELOG section.** The notes step fails instead of creating a release with empty notes. Test: Task 1, `release:notes`.
5. **Local releases keep working.** With no API key variables set, `release` still notarizes with the keychain profile `hermes-notary`. Test: Task 1 dry run.

---

### Task 1: Release tasks for CI (Taskfile)

**Files:**
- Modify: `Taskfile.yml`. Change the `release` notarize command, and add the tasks `release:notarize`, `release:check-tag` and `release:notes`.

**Interfaces:**
- Produces:
  - `wails3 task release:check-tag TAG=<tag>`: exits 0 only when `TAG == v<VERSION>`. Its message names both values.
  - `wails3 task release:notes OUT=<file>`: writes the CHANGELOG section for `<VERSION>` to `<file>`, or exits non-zero if there is none.
  - `wails3 task release NOTARY_KEY=<p8 path> NOTARY_KEY_ID=<id> NOTARY_ISSUER=<uuid>`: notarizes with the API key when `NOTARY_KEY` is set, and with `--keychain-profile {{.NOTARY_PROFILE}}` otherwise.

- [ ] **Step 1: Record the failing checks.** These need to fail because the tasks don't exist yet:
  - `wails3 task release:check-tag TAG=v0.14.0`
  - `wails3 task release:notes OUT=/tmp/n.md`
  - `wails3 task --dry release:notarize ZIP=x.zip NOTARY_KEY=/k.p8 NOTARY_KEY_ID=ABC NOTARY_ISSUER=0000`

  Expected: all three fail with "task does not exist".
- [ ] **Step 2: Implement.**
  - Move the `notarytool submit` line into `release:notarize` (a public task with `ZIP`, `NOTARY_PROFILE`, `NOTARY_KEY`, `NOTARY_KEY_ID` and `NOTARY_ISSUER`), and have `release` call it, passing those vars on.
  - Carry over the existing comment about `notarytool log`, and add the `--key` form of that command.
  - Add `release:check-tag` and `release:notes`, both reading `VERSION` the way `release` does. For the notes, use `awk` from the line starting `## [<VERSION>]` up to the next line starting `## `, without the heading line, then `test -s` on the output.
  - Add one line to `release`'s `desc` naming the API-key form.
- [ ] **Step 3: Verify.** Expected:
  - `release:check-tag TAG=v0.14.0` exits 0.
  - `release:check-tag TAG=v0.14.1` exits non-zero and its message names both `v0.14.1` and `0.14.0`.
  - `release:notes OUT=$TMPDIR/n.md` exits 0. The file starts with the first line under `## [0.14.0]` and doesn't contain `## [0.13.0]`.
  - With `VERSION=9.9.9`, `release:notes` exits non-zero.
  - The `--dry` notarize output contains `--key "/k.p8" --key-id "ABC" --issuer "0000"` and doesn't contain `--keychain-profile`.
  - Without the three vars, the output contains `--keychain-profile "hermes-notary"`.
- [ ] **Step 4: Commit** `build: release tasks accept an API key and check the tag`.

---

### Task 2: The workflow and its contract test

**Files:**
- Create: `.github/workflows/release.yml`
- Create: `release_workflow_test.go` (package `main`, string-based checks with no YAML dependency, in the same style as `styleContract.test.ts`)

**Interfaces:**
- Consumes: the three tasks from Task 1.

- [ ] **Step 1: Failing test** `TestReleaseWorkflowContract` reads `.github/workflows/release.yml` and checks each rule in its own `t.Run`:
  - `triggers`: the `on:` block has `tags:` with `'v*'` and `workflow_dispatch`. It has no `branches:` and no `pull_request`.
  - `permissions`: the first `permissions:` block, at the top level, is `contents: read`. `contents: write` appears exactly once, inside the job.
  - `environment`: the job contains `environment: release`.
  - `actions`: every `uses:` value starts with `actions/`.
  - `secrets via env`: no line that is part of a `run:` script contains `secrets.`. A script is the indented lines after `run: |`, or the rest of a `run:` line.
  - `draft only`: there is exactly one `gh release create`, and its command contains `--draft` and `--verify-tag`. No `git push` and no `gh release edit` appear anywhere.
  - `tag guarded`: `release:check-tag` appears, and `TAG="$GITHUB_REF_NAME"` or `TAG=${{ github.ref_name }}` appears before `wails3 task release`.
  - `cleanup`: a step with `if: always()` contains `security delete-keychain` and `rm -f "$RUNNER_TEMP`.
  - `wails pin`: the `wails3@` version in the workflow equals the `github.com/wailsapp/wails/v3` version in `go.mod`.
- [ ] **Step 2: Run** `go test -run TestReleaseWorkflowContract ./.`. Expected: FAIL, because the file doesn't exist.
- [ ] **Step 3: Implement `release.yml`** per Global Constraints. Steps, in order:
  1. Check out.
  2. Set up Go and Node, as in `ci.yml`.
  3. `npm ci` in `frontend`.
  4. Install `wails3`.
  5. Check the tag (push only).
  6. Import the certificate:
     - Create a keychain in `$RUNNER_TEMP` with a random password from `openssl rand`.
     - `security import` the `.p12` with `-T /usr/bin/codesign`, then `security set-key-partition-list`.
     - Prepend the keychain to the user search list.
     - Check with `security find-identity -v -p codesigning`.
  7. Write the `.p8` to `$RUNNER_TEMP/notary.p8` with mode 600.
  8. `wails3 task release` with the three `NOTARY_*` vars.
  9. `release:notes` (push only).
  10. `gh release create "$GITHUB_REF_NAME" <zip> --draft --verify-tag --title "Halmos Editor <version>" --notes-file …`, with `GH_TOKEN: ${{ github.token }}` (push only).
  11. `actions/upload-artifact@v7` (dispatch only).
  12. Clean up (`if: always()`).

  Comment the non-obvious lines the way `ci.yml` does, especially why the release is a draft and why secrets go through `env`.
- [ ] **Step 4: Run** `go test ./. && go build -o /dev/null .`. Expected: PASS.
- [ ] **Step 5: Commit** `ci: tag-triggered release workflow, draft only`.

---

### Task 3: Docs, roadmap, user setup and dry run

**Files:**
- Modify: `README.md` ("Cutting a release")
- Modify: `ROADMAP.md` (status line of "A release workflow")

- [ ] **Step 1: README.** Rewrite "Cutting a release" as numbered steps:
  1. Bump `build/config.yml`, `updates/latest.json` and the CHANGELOG section in one commit on `main`.
  2. `git tag v<version>`, then `git push origin v<version>`. Push the tag only.
  3. Wait for the Release workflow, download the draft's zip, unzip it, and run `wails3 task release:verify APP=…`.
  4. Publish the draft.
  5. `git push origin main`.

  Keep the existing explanation of why `main` goes last. Keep the local `wails3 task release` route as the fallback. Add a "One-time setup" subsection listing the five secrets and how to make each one:
  - Export the Developer ID certificate with its key as a `.p12` from Keychain Access, then `base64 -i cert.p12 | pbcopy`.
  - Create an App Store Connect team API key with the Developer role. Download the `.p8`, which can only be downloaded once.
  - Create the GitHub environment `release` with deployment rules that allow only tags matching `v*` and the branch `main`. The `main` rule lets the dry run use the secrets, since a dry run starts from a branch, not a tag.
  - Add a tag ruleset so only the owner can create `v*` tags.
  - Revoking: revoke the API key in App Store Connect and delete the environment secrets.
- [ ] **Step 2: ROADMAP.** Use `str.replace` with `assert s.count(old) == 1`. Append to the item's status: `*Status 2026-10-18*: the workflow exists (release.yml): a v* tag produces a notarized draft release. Tick this when a real release has gone through it.` Don't tick the box. Afterwards, `grep -c '^- \['` and `grep '^## '` must be unchanged.
- [ ] **Step 3: Full suite** `go test ./. && cd frontend && npm test && npm run check`. Expected: all pass.
- [ ] **Step 4: Commit** `docs: cutting a release through the workflow`.
- [ ] **Step 5: User steps.** These can't be done by an agent. Ask the user to:
  - Create the API key, the `.p12`, the `release` environment, the five secrets and the tag ruleset (README, One-time setup).
  - Push `main` (the Actions tab only offers "Run workflow" for a workflow on the default branch; this doesn't change the update feed), then run it from `main` (a dry run).
  - Download the artifact and run `wails3 task release:verify APP=…` on it. Expected: `source=Notarized Developer ID`.

  Pushing `main` and the first real tag both need the user's go-ahead.
