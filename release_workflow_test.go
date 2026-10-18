package main

import (
	"os"
	"regexp"
	"strings"
	"testing"
)

// The Release workflow holds the Developer ID signing identity and the notary
// key, so its safety rules are pinned here rather than left to review: it runs
// only for version tags, publishes nothing, never moves main (the update feed
// is read from main, see README's Cutting a release), keeps secrets out of
// script text, and always cleans up. String checks, not a YAML parse: the
// rules are about what the file says, and that keeps the module free of a
// YAML dependency for one test.

const releaseWorkflowPath = ".github/workflows/release.yml"

func readReleaseWorkflow(t *testing.T) string {
	t.Helper()
	b, err := os.ReadFile(releaseWorkflowPath)
	if err != nil {
		t.Fatalf("read %s: %v", releaseWorkflowPath, err)
	}
	return string(b)
}

func indentOf(line string) int {
	return len(line) - len(strings.TrimLeft(line, " "))
}

// scriptLines returns every line that is part of a run: script — the rest of
// a one-line `run: cmd`, or the indented lines under `run: |`.
func scriptLines(src string) []string {
	var out []string
	lines := strings.Split(src, "\n")
	runKey := regexp.MustCompile(`^(\s*)(- )?run:\s*(.*)$`)
	for i := 0; i < len(lines); i++ {
		m := runKey.FindStringSubmatch(lines[i])
		if m == nil {
			continue
		}
		rest := strings.TrimSpace(m[3])
		if rest != "|" && rest != ">" && rest != "|-" && rest != ">-" {
			out = append(out, rest)
			continue
		}
		keyIndent := len(m[1])
		if m[2] != "" {
			keyIndent += 2
		}
		for i+1 < len(lines) {
			next := lines[i+1]
			if strings.TrimSpace(next) != "" && indentOf(next) <= keyIndent {
				break
			}
			out = append(out, next)
			i++
		}
	}
	return out
}

// steps splits the jobs section into steps, each from its `- ` line to the next.
func steps(src string) []string {
	var out []string
	var cur []string
	stepStart := regexp.MustCompile(`^      - `)
	for _, l := range strings.Split(src, "\n") {
		if stepStart.MatchString(l) {
			if cur != nil {
				out = append(out, strings.Join(cur, "\n"))
			}
			cur = []string{l}
		} else if cur != nil {
			cur = append(cur, l)
		}
	}
	if cur != nil {
		out = append(out, strings.Join(cur, "\n"))
	}
	return out
}

func TestReleaseWorkflowContract(t *testing.T) {
	src := readReleaseWorkflow(t)

	t.Run("triggers", func(t *testing.T) {
		on := src[strings.Index(src, "\non:"):]
		on = on[:strings.Index(on[1:], "\n\n")+1]
		for _, want := range []string{"tags:", "'v*'", "workflow_dispatch"} {
			if !strings.Contains(on, want) {
				t.Errorf("on: block lacks %q:\n%s", want, on)
			}
		}
		for _, banned := range []string{"branches:", "pull_request"} {
			if strings.Contains(on, banned) {
				t.Errorf("on: block must not contain %q", banned)
			}
		}
	})

	t.Run("permissions", func(t *testing.T) {
		top := regexp.MustCompile(`(?m)^permissions:\n  contents: read\n`)
		if !top.MatchString(src) {
			t.Error("top-level permissions must be exactly contents: read")
		}
		if n := strings.Count(src, "contents: write"); n != 1 {
			t.Errorf("contents: write appears %d times, want 1 (the release job)", n)
		}
		if regexp.MustCompile(`(?m)^\S.*contents: write`).MatchString(src) ||
			regexp.MustCompile(`(?m)^  contents: write`).MatchString(src) {
			t.Error("contents: write must be granted inside the job, not at the top level")
		}
	})

	t.Run("environment", func(t *testing.T) {
		if !regexp.MustCompile(`(?m)^    environment: release$`).MatchString(src) {
			t.Error("the job must run in the protected release environment")
		}
	})

	t.Run("actions", func(t *testing.T) {
		uses := regexp.MustCompile(`uses:\s*(\S+)`).FindAllStringSubmatch(src, -1)
		if len(uses) == 0 {
			t.Fatal("no uses: lines found")
		}
		for _, u := range uses {
			if !strings.HasPrefix(u[1], "actions/") {
				t.Errorf("third-party action %s; only actions/* may see the signing secrets", u[1])
			}
		}
	})

	t.Run("secrets via env", func(t *testing.T) {
		for _, l := range scriptLines(src) {
			if strings.Contains(l, "secrets.") {
				t.Errorf("secret interpolated into a script, pass it through env: instead:\n%s", l)
			}
		}
	})

	t.Run("draft only", func(t *testing.T) {
		if n := strings.Count(src, "gh release create"); n != 1 {
			t.Fatalf("gh release create appears %d times, want 1", n)
		}
		i := strings.Index(src, "gh release create")
		cmd := src[i:]
		// The command may continue over backslash-joined lines.
		end := regexp.MustCompile(`[^\\]\n`).FindStringIndex(cmd)
		if end != nil {
			cmd = cmd[:end[1]]
		}
		for _, want := range []string{"--draft", "--verify-tag"} {
			if !strings.Contains(cmd, want) {
				t.Errorf("gh release create lacks %s:\n%s", want, cmd)
			}
		}
		for _, banned := range []string{"git push", "gh release edit"} {
			if strings.Contains(src, banned) {
				t.Errorf("workflow contains %q; publishing and pushing main stay manual", banned)
			}
		}
	})

	t.Run("tag guarded", func(t *testing.T) {
		check := strings.Index(src, "release:check-tag")
		build := strings.Index(src, "wails3 task release ")
		if check < 0 || build < 0 || check > build {
			t.Errorf("release:check-tag must run before wails3 task release (check at %d, build at %d)", check, build)
		}
		if !strings.Contains(src, `TAG="$GITHUB_REF_NAME"`) {
			t.Error(`release:check-tag must be given TAG="$GITHUB_REF_NAME"`)
		}
	})

	t.Run("cleanup", func(t *testing.T) {
		for _, s := range steps(src) {
			if strings.Contains(s, "if: always()") &&
				strings.Contains(s, "security delete-keychain") &&
				strings.Contains(s, `rm -f "$RUNNER_TEMP`) {
				return
			}
		}
		t.Error("no if: always() step deletes the keychain and the key files under $RUNNER_TEMP")
	})

	// main.go embeds frontend/dist, which is git-ignored, so a fresh checkout
	// does not compile until the frontend is built. The release task's own
	// first step is `go test ./.`, so it builds the frontend before that —
	// which also stops a local release testing against a stale dist.
	t.Run("frontend built before go test", func(t *testing.T) {
		b, err := os.ReadFile("Taskfile.yml")
		if err != nil {
			t.Fatal(err)
		}
		task := string(b)
		start := strings.Index(task, "\n  release:\n")
		if start < 0 {
			t.Fatal("no release task in Taskfile.yml")
		}
		task = task[start:]
		build := strings.Index(task, "--prefix frontend run build")
		test := strings.Index(task, "- go test ./.")
		if build < 0 || test < 0 || build > test {
			t.Errorf("release must build the frontend before go test ./. (build at %d, test at %d)", build, test)
		}
	})

	t.Run("wails pin", func(t *testing.T) {
		mod, err := os.ReadFile("go.mod")
		if err != nil {
			t.Fatal(err)
		}
		want := regexp.MustCompile(`github.com/wailsapp/wails/v3 (\S+)`).FindStringSubmatch(string(mod))
		got := regexp.MustCompile(`wails3@(\S+)`).FindStringSubmatch(src)
		if want == nil || got == nil || got[1] != want[1] {
			t.Errorf("wails3 installed at %v, go.mod has %v; they must be bumped together", got, want)
		}
	})
}
