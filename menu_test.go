package main

import (
	"io"
	"log/slog"
	"os"
	"reflect"
	"regexp"
	"sort"
	"strings"
	"sync"
	"testing"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// The App menu's role items are built by Wails against globalApplication, so
// one has to exist before a menu can be constructed at all. Created once and
// silenced — application.New logs three banner lines otherwise, and test
// output should be pristine.
var testApp = sync.OnceFunc(func() {
	application.New(application.Options{
		Name:   "Hermes Editor",
		Logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
	})
})

// This is the test that the first attempt at the ⌘Q fix needed and did not
// have. That attempt replaced the Quit item's OnClick and shipped, and ⌘Q went
// on discarding documents: on macOS a role-based item is created with
// target=nil and the role's own selector — Quit maps to `terminate:` in Wails'
// roleToSelector table — so AppKit sends the action up the responder chain to
// NSApp and the Go callback is never invoked. Clearing the role is what puts
// the item back on the handleClick path.
//
// Testing quitRequest alone did not catch it, because quitRequest was never
// reached. This tests the wiring instead.
func TestReclaimQuitItemClearsTheRoleThatBypassesGo(t *testing.T) {
	testApp()
	menu := application.NewMenu()
	menu.AddRole(application.AppMenu)

	if menu.FindByRole(application.Quit) == nil {
		t.Fatal("precondition failed: the App menu should carry a Quit role item")
	}

	quit := reclaimQuitItem(menu)
	if quit == nil {
		t.Fatal("want the Quit item back so a handler can be attached")
	}
	if menu.FindByRole(application.Quit) != nil {
		t.Error("the Quit role must be cleared; while it is set, macOS binds " +
			"terminate: and the Go handler never runs")
	}
	if got := quit.Label(); got == "" {
		t.Error("the item must keep its label")
	}
	if got := quit.GetAccelerator(); got == "" {
		t.Error("the item must keep ⌘Q, or the shortcut stops working entirely")
	}
}

func TestReclaimQuitItemToleratesAMenuWithoutOne(t *testing.T) {
	testApp()
	if got := reclaimQuitItem(application.NewMenu()); got != nil {
		t.Errorf("want nil for a menu with no Quit item, got %v", got)
	}
}

// The branch ⌘Q takes once it does reach Go. Separate from the wiring above:
// both have to be right, and the first attempt got the wiring wrong while this
// half was already correct.
func TestQuitRequestConfirmsWhenDirty(t *testing.T) {
	confirmed, quit := 0, 0
	quitRequest(true, func() { confirmed++ }, func() { quit++ })

	if confirmed != 1 {
		t.Errorf("a dirty document must raise the confirm, raised %d", confirmed)
	}
	if quit != 0 {
		t.Errorf("a dirty document must not quit yet, quit %d", quit)
	}
}

func TestQuitRequestQuitsWhenClean(t *testing.T) {
	confirmed, quit := 0, 0
	quitRequest(false, func() { confirmed++ }, func() { quit++ })

	if quit != 1 {
		t.Errorf("a clean document must quit, quit %d", quit)
	}
	if confirmed != 0 {
		t.Errorf("a clean document must not prompt, raised %d", confirmed)
	}
}

// The red button's branch. Same shape as quitRequest, but the clean path
// hides the window instead of quitting, so the app stays in the Dock (#17).
func TestCloseRequestConfirmsWhenDirty(t *testing.T) {
	confirmed, closed := 0, 0
	closeRequest(true, func() { confirmed++ }, func() { closed++ })

	if confirmed != 1 {
		t.Errorf("a dirty document must raise the confirm, raised %d", confirmed)
	}
	if closed != 0 {
		t.Errorf("a dirty document must not close yet, closed %d", closed)
	}
}

func TestCloseRequestClosesWhenClean(t *testing.T) {
	confirmed, closed := 0, 0
	closeRequest(false, func() { confirmed++ }, func() { closed++ })

	if closed != 1 {
		t.Errorf("a clean document must close, closed %d", closed)
	}
	if confirmed != 0 {
		t.Errorf("a clean document must not prompt, raised %d", confirmed)
	}
}

// Find's chords must not shadow anything else in the menu bar (⌘E is Export
// PDF, which is why "Use Selection for Find" is absent). Accelerators live in
// several tables in menu.go, so the source is the one place that sees them
// all; chords are compared as sorted key sets so "alt+cmdorctrl+f" and
// "cmdorctrl+alt+f" collide.
func TestFindItemsHaveUniqueAccelerators(t *testing.T) {
	src, err := os.ReadFile("menu.go")
	if err != nil {
		t.Fatal(err)
	}
	norm := func(chord string) string {
		parts := strings.Split(chord, "+")
		sort.Strings(parts)
		return strings.Join(parts, "+")
	}
	counts := map[string]int{}
	for _, m := range regexp.MustCompile(`"((?:[a-z]+\+)*cmdorctrl(?:\+[a-z0-9\[\]]+)+)"`).FindAllStringSubmatch(string(src), -1) {
		counts[norm(m[1])]++
	}
	if len(findItems) != 4 {
		t.Fatalf("want 4 Find items, got %d", len(findItems))
	}
	for _, it := range findItems {
		if n := counts[norm(it.key)]; n != 1 {
			t.Errorf("%s (%s) appears %d times in menu.go, want exactly once", it.label, it.key, n)
		}
	}
}

// With the window hidden (#17), a menu chord must not edit, save, export or
// print the document nobody can see — final review, Important 1.
func TestWhenVisibleSkipsHiddenWindow(t *testing.T) {
	ran := 0
	whenVisible(false, func() { ran++ })
	if ran != 0 {
		t.Errorf("a document command ran %d times on a hidden window", ran)
	}
}

func TestWhenVisibleRunsOnShownWindow(t *testing.T) {
	ran := 0
	whenVisible(true, func() { ran++ })
	if ran != 1 {
		t.Errorf("a document command on a shown window ran %d times, want 1", ran)
	}
}

// The menu's style ids and the formatter's loader keys are two lists of the
// same thing; a style added to one and not the other would tick nothing or
// fail to load.
func TestCitationStyleIDsMatchFrontend(t *testing.T) {
	src, err := os.ReadFile("frontend/src/lib/citations.ts")
	if err != nil {
		t.Fatal(err)
	}
	block := regexp.MustCompile(`(?s)STYLE_LOADERS[^\n]*\{\n(.*?)\n\}`).FindSubmatch(src)
	if block == nil {
		t.Fatal("no STYLE_LOADERS table in citations.ts")
	}
	want := map[string]bool{}
	for _, m := range regexp.MustCompile(`(?m)^\s*'?([a-z-]+)'?:\s*\(\)`).FindAllSubmatch(block[1], -1) {
		want[string(m[1])] = true
	}
	got := map[string]bool{}
	for _, st := range citationStyles {
		got[st.id] = true
	}
	if len(want) == 0 || !reflect.DeepEqual(got, want) {
		t.Fatalf("menu ids %v, frontend ids %v", got, want)
	}
}

func TestCitationStyleClickAlwaysRebuildsMenu(t *testing.T) {
	s := newTestService(t)
	rebuilt, emitted := 0, 0
	s.onCitationStyleChanged = func() { rebuilt++ }
	for i := 0; i < 2; i++ {
		citationStyleClicked(s, func() { emitted++ })
	}
	if emitted != 2 || rebuilt != 2 {
		t.Fatalf("emitted %d, rebuilt %d; want 2 and 2", emitted, rebuilt)
	}
}
