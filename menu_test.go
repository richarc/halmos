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
		Name:   "Halmos Editor",
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

// Every other quit — the Dock menu, logout, restart — reaches Go only as
// applicationShouldTerminate, through Options.ShouldQuit. Returning true there
// with a dirty document discards it.
func TestShouldQuitConfirmsAndRefusesWhenDirty(t *testing.T) {
	confirmed := 0
	if shouldQuit(true, false, func() { confirmed++ }) {
		t.Error("a dirty document must not quit before the user chooses")
	}
	if confirmed != 1 {
		t.Errorf("a dirty document must raise the confirm, raised %d", confirmed)
	}
}

func TestShouldQuitAllowsCleanDocument(t *testing.T) {
	confirmed := 0
	if !shouldQuit(false, false, func() { confirmed++ }) {
		t.Error("a clean document must quit")
	}
	if confirmed != 0 {
		t.Errorf("a clean document must not prompt, raised %d", confirmed)
	}
}

// DocumentService.Quit runs after Save or Don't Save, and for a demo's quit
// step, and goes through applicationShouldTerminate again. It must not loop
// back into the confirm.
func TestShouldQuitAllowsApprovedQuitWhenDirty(t *testing.T) {
	confirmed := 0
	if !shouldQuit(true, true, func() { confirmed++ }) {
		t.Error("an approved quit must go through")
	}
	if confirmed != 0 {
		t.Errorf("an approved quit must not prompt, raised %d", confirmed)
	}
}

func TestApproveQuitIsRemembered(t *testing.T) {
	s := newTestService(t)
	if s.quitApproved() {
		t.Fatal("a new service must not start approved")
	}
	s.approveQuit()
	if !s.quitApproved() {
		t.Error("approveQuit must be remembered")
	}
}

// A builder's work is not in the document until committed, so an open builder
// asks before a close or quit even when the document is clean.
func TestMustAskWhenDirtyOrBuilderOpen(t *testing.T) {
	s := newTestService(t)
	if s.mustAsk() {
		t.Fatal("a clean document with no builder open must not ask")
	}
	s.SetBuilderOpen(true)
	if !s.mustAsk() {
		t.Error("an open builder must ask")
	}
	s.SetBuilderOpen(false)
	s.SetDirty(true)
	if !s.mustAsk() {
		t.Error("unsaved changes must ask")
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

// The menu's body-font values and the frontend's BODY_FONTS keys are two lists
// of the same thing; a value in one and not the other would tick nothing or
// fall back to the default stack.
func TestBodyFontMenuValuesMatchFrontend(t *testing.T) {
	src, err := os.ReadFile("frontend/src/lib/bodyFont.ts")
	if err != nil {
		t.Fatal(err)
	}
	block := regexp.MustCompile(`(?s)BODY_FONTS[^\n]*\{\n(.*?)\n\}`).FindSubmatch(src)
	if block == nil {
		t.Fatal("no BODY_FONTS table in bodyFont.ts")
	}
	want := map[string]bool{}
	for _, m := range regexp.MustCompile(`(?m)^\s*'?([a-z-]+)'?:`).FindAllSubmatch(block[1], -1) {
		want[string(m[1])] = true
	}
	got := map[string]bool{}
	for _, f := range bodyFonts {
		got[f.value] = true
	}
	if len(want) == 0 || !reflect.DeepEqual(got, want) {
		t.Fatalf("menu values %v, frontend values %v", got, want)
	}
}

func TestAppMenuHasAccountAfterAbout(t *testing.T) {
	testApp()
	menu := application.NewMenu()
	addAppMenu(menu, "Halmos Editor", func() {})
	app := menu.ItemAt(0).GetSubmenu()
	if app == nil {
		t.Fatal("no app submenu")
	}
	if l := app.ItemAt(0).Label(); !strings.HasPrefix(l, "About") {
		t.Errorf("first item %q, want About", l)
	}
	if l := app.ItemAt(1).Label(); l != "Account…" {
		t.Errorf("second item %q, want Account…", l)
	}
	if menu.FindByRole(application.Quit) == nil {
		t.Error("the hand-built app menu must keep Quit, which reclaimQuitItem takes over")
	}
}

// Exporting has its own top-level menu, right after File: PDF (⌘E) and HTML,
// which the app makes itself, then Word and LaTeX, which go through the
// portal's conversion.
func TestExportMenu(t *testing.T) {
	testApp()
	menu := application.NewMenu()
	menu.AddSubmenu("File")
	addExportMenu(menu, func(string, ...any) {})
	item := menu.ItemAt(1)
	if item == nil || !item.IsSubmenu() || item.Label() != "Export" {
		t.Fatalf("second top-level item is not the Export menu")
	}
	export := item.GetSubmenu()
	want := []string{"Export PDF…", "Export HTML…", "", "Export Word…", "Export LaTeX…"}
	for i, label := range want {
		it := export.ItemAt(i)
		if it == nil {
			t.Fatalf("item %d missing, want %q", i, label)
		}
		if label == "" {
			if !it.IsSeparator() {
				t.Errorf("item %d is %q, want a separator", i, it.Label())
			}
			continue
		}
		if it.Label() != label {
			t.Errorf("item %d is %q, want %q", i, it.Label(), label)
		}
	}
	if export.ItemAt(len(want)) != nil {
		t.Errorf("Export has more than %d items", len(want))
	}
	if acc := export.ItemAt(0).GetAccelerator(); acc != "Cmd+E" && acc != "cmdorctrl+e" {
		t.Errorf("Export PDF… accelerator %q, want ⌘E", acc)
	}
}

// File no longer carries the export items; Print… stays there.
func TestFileMenuHasNoExportItems(t *testing.T) {
	src, err := os.ReadFile("menu.go")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(src), `file.Add("Export`) {
		t.Error("an Export item is still added to File")
	}
	if !strings.Contains(string(src), `file.Add("Print…")`) {
		t.Error("Print… is no longer in File")
	}
}
