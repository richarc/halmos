package main

import (
	"log"
	"path/filepath"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/mac"
)

// citationStyles are the styles bundled with the app, in menu order. The ids
// must match STYLE_LOADERS in frontend/src/lib/citations.ts.
var citationStyles = []struct{ label, id string }{
	{"APA", "apa"},
	{"Chicago (author-date)", "chicago-author-date"},
	{"Harvard", "harvard"},
	{"IEEE", "ieee"},
	{"Vancouver", "vancouver"},
}

// citationStyleClicked handles a click on a style checkbox: send the choice,
// then always rebuild the menu. The checkbox has already flipped itself, and
// the stored style may not change (clicking the ticked item), so only a
// rebuild puts the tick back.
func citationStyleClicked(docs *DocumentService, emit func()) {
	emit()
	docs.rebuildStyleMenu()
}

// installMenu builds and sets the application menu. It is called again
// whenever the recents list changes, so the Open Recent submenu stays
// current; the rebuild is dispatched to the main thread by the caller.
//
// Every action is registered through a commandSet (commands.go), which is
// what attaches the click handler, so the command palette lists and runs the
// same functions the menu does. The new set replaces the old one in reg once
// the menu is installed.
func installMenu(app *application.App, win *application.WebviewWindow, docs *DocumentService, reg *commandRegistry) {
	menu := application.NewMenu()
	cmds := newCommandSet()
	appName := app.Config().Name
	addAppMenu(menu, appName, func() {
		showWindow(win)
		app.Event.Emit("menu:account")
	}, cmds)

	// Menu events that act on the open document. Closing hides the window
	// rather than quitting (#17), so these are dropped while it is hidden:
	// otherwise ⌘B or Insert would edit, and ⌘S save, a document nobody can
	// see. New, Open and Open Recent show the window instead (showWindow).
	docEmit := func(name string, data ...any) {
		whenVisible(win.IsVisible(), func() { app.Event.Emit(name, data...) })
	}

	// ⌘Q used to discard unsaved work: main.go's guard is registered on
	// events.Common.WindowClosing, a *window* event, and quitting never raises
	// one. Route the shortcut through the same confirm the red button uses.
	//
	// Replacing the handler is not enough on its own — see reclaimQuitItem.
	//
	// DocumentService.Quit() deliberately still quits outright: it is what runs
	// *after* the user chooses Save or Don't Save, and sending it back through
	// this confirm would loop.
	if quit := reclaimQuitItem(menu); quit != nil {
		cmds.item(quit, []string{appName}, func() {
			quitRequest(docs.mustAsk(),
				// Shown first: with the window hidden (#17) the dialog
				// would otherwise render where nobody can see it.
				func() {
					showWindow(win)
					app.Event.Emit("close:confirm", "quit")
				},
				app.Quit)
		}, commandOpts{})
	}

	fileP := []string{"File"}
	file := menu.AddSubmenu("File")
	cmds.item(file.Add("New…").SetAccelerator("cmdorctrl+n"), fileP, func() {
		showWindow(win)
		app.Event.Emit("menu:new")
	}, commandOpts{})
	cmds.item(file.Add("Open…").SetAccelerator("cmdorctrl+o"), fileP, func() {
		showWindow(win)
		app.Event.Emit("menu:open")
	}, commandOpts{})

	recent := file.AddSubmenu("Open Recent")
	recents := docs.RecentFiles()
	addRecentItems(recent, recents, func(path string) {
		showWindow(win)
		app.Event.Emit("menu:open-recent", path)
	}, cmds)
	if len(recents) > 0 {
		recent.AddSeparator()
	}
	clearItem := cmds.item(recent.Add("Clear Recents"), []string{"File", "Open Recent"}, func() {
		docs.ClearRecents()
	}, commandOpts{})
	if len(recents) == 0 {
		clearItem.SetEnabled(false)
	}

	cmds.item(file.Add("Save").SetAccelerator("cmdorctrl+s"), fileP, func() {
		docEmit("menu:save")
	}, commandOpts{needsDocument: true})
	cmds.item(file.Add("Save As…").SetAccelerator("shift+cmdorctrl+s"), fileP, func() {
		docEmit("menu:save-as")
	}, commandOpts{needsDocument: true})
	file.AddSeparator()
	current := docs.Settings()
	paper := file.AddSubmenu("Paper Size")
	papers := []struct {
		label string
		value string
	}{
		{"A4", "a4"},
		{"US Letter", "letter"},
	}
	for _, p := range papers {
		value := p.value
		cmds.item(paper.AddRadio(p.label, current.PaperSize == value), []string{"File", "Paper Size"}, func() {
			// Read-modify-write the whole settings value, so this menu only
			// ever changes the one field it owns.
			next := docs.Settings()
			next.PaperSize = value
			if err := docs.UpdateSettings(next); err != nil {
				log.Printf("could not save paper size: %v", err)
			}
		}, commandOpts{})
	}
	orientation := file.AddSubmenu("PDF Orientation")
	orientations := []struct {
		label string
		value string
	}{
		{"Portrait", "portrait"},
		{"Landscape", "landscape"},
	}
	for _, o := range orientations {
		value := o.value
		cmds.item(orientation.AddRadio(o.label, current.PrintOrientation == value), []string{"File", "PDF Orientation"}, func() {
			// Read-modify-write the whole settings value, so this menu only
			// ever changes the one field it owns.
			next := docs.Settings()
			next.PrintOrientation = value
			if err := docs.UpdateSettings(next); err != nil {
				log.Printf("could not save PDF orientation: %v", err)
			}
		}, commandOpts{})
	}
	cmds.item(file.Add("Print…").SetAccelerator("cmdorctrl+p"), fileP, func() {
		whenVisible(win.IsVisible(), docs.PrintDocument)
	}, commandOpts{needsDocument: true})

	addExportMenu(menu, docEmit, cmds)
	addEditMenu(menu, docEmit, cmds)
	addInsertMenu(menu, docEmit, cmds)
	addFormatMenu(menu, docs, docEmit, cmds)
	addViewMenu(menu, docs, docEmit, cmds)

	menu.AddRole(application.WindowMenu)

	// Wails' HelpMenu role is no use here — it contains a single "Learn More"
	// item pointing at wails.io — so this is built by hand. Both items open in
	// the user's browser rather than in the app: a help document is not a
	// document you are writing, and loading one into the editor would mean
	// replacing whatever is open, guarded by the unsaved-changes confirm, for
	// something the reader only wants to read.
	helpP := []string{"Help"}
	help := menu.AddSubmenu("Help")
	cmds.item(help.Add("Halmos Documentation"), helpP, func() {
		if err := app.Browser.OpenURL(docsURL); err != nil {
			log.Printf("could not open the documentation: %v", err)
		}
	}, commandOpts{})
	// Questions and suggestions. Bugs have their own item below, because
	// they go to the issue form rather than to a discussion.
	cmds.item(help.Add("Discussions"), helpP, func() {
		if err := app.Browser.OpenURL(discussionsURL); err != nil {
			log.Printf("could not open the discussions: %v", err)
		}
	}, commandOpts{})
	// The licence texts ride in the bundle because a distributed binary has to
	// carry them — see Taskfile.yml's bundle:licences. Reachable from here so
	// they are not only discoverable by way of Show Package Contents.
	cmds.item(help.Add("Licences"), helpP, func() {
		// OpenFile, not OpenURL with a file:// URL. Both end at
		// exec.Command("open", target), so a plain path is handed straight to
		// `open` with no shell in between — where a hand-built file:// URL
		// would carry a raw space from "Halmos Editor.app" and be malformed.
		// Worth knowing when debugging either: the implementation discards the
		// result of `open` in a goroutine, so a bad target fails silently and
		// only a failure to *start* `open` is ever returned.
		if resources, err := mac.ResourcePath(); err == nil {
			if dir, ok := licencesPath(resources); ok {
				if err := app.Browser.OpenFile(dir); err != nil {
					log.Printf("could not open the licences: %v", err)
				}
				return
			}
		}
		// Unbundled there is nothing to open — `go run`, or the bare binary —
		// so fall back to the repository rather than doing nothing.
		if err := app.Browser.OpenURL(docsURL); err != nil {
			log.Printf("could not open the licences: %v", err)
		}
	}, commandOpts{})
	help.AddSeparator()
	// The manual route. The frontend runs the check and reports the result,
	// because the result is a dialog or a toast, which live there.
	cmds.item(help.Add("Check for Updates…"), helpP, func() {
		// The result is a dialog or toast in the window, so bring it back.
		showWindow(win)
		app.Event.Emit("menu:check-updates")
	}, commandOpts{})
	// Ticked only for "on": "unasked" reads as off here, and clicking it
	// answers the first-launch question the same way the dialog would.
	helpCurrent := docs.Settings()
	cmds.item(help.AddCheckbox("Check for Updates Automatically", helpCurrent.UpdateCheck == "on"), helpP, func() {
		next := docs.Settings()
		if next.UpdateCheck == "on" {
			next.UpdateCheck = "off"
		} else {
			next.UpdateCheck = "on"
		}
		if err := docs.UpdateSettings(next); err != nil {
			log.Printf("could not save the update-check setting: %v", err)
		}
	}, commandOpts{})
	help.AddSeparator()
	// No accelerator: an invented chord cannot be checked against every macOS
	// binding — the same reasoning as Blockquote and Insert → Chart….
	cmds.item(help.Add("Report an Issue…"), helpP, func() {
		env := app.Env.Info()
		osName, osVersion := env.OS, ""
		if env.OSInfo != nil {
			// Branding is the marketing name ("macOS Tahoe") where a platform
			// supplies one; OS is the bare identifier. Prefer the former.
			if env.OSInfo.Branding != "" {
				osName = env.OSInfo.Branding
			}
			osVersion = env.OSInfo.Version
		}
		if err := app.Browser.OpenURL(feedbackURL(appVersion(), osName, osVersion)); err != nil {
			log.Printf("could not open the issue page: %v", err)
		}
	}, commandOpts{})

	app.Menu.SetApplicationMenu(menu)
	reg.replace(cmds)
}

// addRecentItems adds one item per recent file to the Open Recent submenu.
// Two files can share a name, so each command's id carries the full path and
// its detail the folder, which the palette shows beside the name.
func addRecentItems(recent *application.Menu, paths []string, open func(string), cmds *commandSet) {
	for _, p := range paths {
		path := p
		cmds.item(recent.Add(filepath.Base(path)), []string{"File", "Open Recent"}, func() {
			open(path)
		}, commandOpts{id: "File › Open Recent › " + path, detail: filepath.Dir(path)})
	}
}

// addEditMenu is Wails' EditMenu role, spelled out so Find can join it. The
// native Find roles are not used: they send performTextFinderAction: to
// WKWebView, which searches the rendered page, not CodeMirror's document
// (only the visible lines of which are in the DOM). These route to the
// editor's own search panel instead (#18). The role items are AppKit's and
// are not commands.
func addEditMenu(menu *application.Menu, emit func(name string, data ...any), cmds *commandSet) {
	edit := menu.AddSubmenu("Edit")
	edit.AddRole(application.Undo)
	edit.AddRole(application.Redo)
	edit.AddSeparator()
	edit.AddRole(application.Cut)
	edit.AddRole(application.Copy)
	edit.AddRole(application.Paste)
	edit.AddRole(application.PasteAndMatchStyle)
	edit.AddRole(application.Delete)
	edit.AddRole(application.SelectAll)
	edit.AddSeparator()
	find := edit.AddSubmenu("Find")
	for _, f := range findItems {
		command := f.command
		cmds.item(find.Add(f.label).SetAccelerator(f.key), []string{"Edit", "Find"}, func() {
			emit("menu:find", command)
		}, commandOpts{needsDocument: true})
	}
	edit.AddSeparator()
	edit.AddRole(application.SpeechMenu)
}

// addFormatMenu adds the Format menu; every item edits the document.
func addFormatMenu(menu *application.Menu, docs *DocumentService, emit func(name string, data ...any), cmds *commandSet) {
	doc := commandOpts{needsDocument: true}
	formatP := []string{"Format"}
	format := menu.AddSubmenu("Format")
	heading := format.AddSubmenu("Heading")
	headingP := []string{"Format", "Heading"}
	headings := []struct {
		label string
		key   string
		arg   string
	}{
		{"Heading 1", "cmdorctrl+1", "heading:1"},
		{"Heading 2", "cmdorctrl+2", "heading:2"},
		{"Heading 3", "cmdorctrl+3", "heading:3"},
		{"Heading 4", "cmdorctrl+4", "heading:4"},
		{"Heading 5", "cmdorctrl+5", "heading:5"},
		{"Heading 6", "cmdorctrl+6", "heading:6"},
	}
	for _, h := range headings {
		arg := h.arg
		cmds.item(heading.Add(h.label).SetAccelerator(h.key), headingP, func() {
			emit("menu:format", arg)
		}, doc)
	}
	heading.AddSeparator()
	cmds.item(heading.Add("Paragraph").SetAccelerator("cmdorctrl+0"), headingP, func() {
		emit("menu:format", "heading:0")
	}, doc)

	style := format.AddSubmenu("Citation Style")
	styleP := []string{"Format", "Citation Style"}
	currentStyle := docs.currentCitationStyle()
	for _, st := range citationStyles {
		id := st.id
		cmds.item(style.AddCheckbox(st.label, currentStyle == id), styleP, func() {
			citationStyleClicked(docs, func() { emit("menu:citation-style", id) })
		}, doc)
	}
	style.AddSeparator()
	cmds.item(style.Add("Other Style File…"), styleP, func() {
		emit("menu:citation-style", "other")
	}, doc)

	format.AddSeparator()
	inline := []struct {
		label string
		key   string
		arg   string
	}{
		{"Bold", "cmdorctrl+b", "bold"},
		{"Italic", "cmdorctrl+i", "italic"},
		{"Inline Code", "shift+cmdorctrl+k", "code"},
		{"Strikethrough", "shift+cmdorctrl+x", "strike"},
	}
	for _, it := range inline {
		arg := it.arg
		cmds.item(format.Add(it.label).SetAccelerator(it.key), formatP, func() {
			emit("menu:format", arg)
		}, doc)
	}

	format.AddSeparator()
	cmds.item(format.Add("Bulleted List").SetAccelerator("shift+cmdorctrl+8"), formatP, func() {
		emit("menu:format", "bullet")
	}, doc)
	cmds.item(format.Add("Numbered List").SetAccelerator("shift+cmdorctrl+7"), formatP, func() {
		emit("menu:format", "ordered")
	}, doc)
	// Blockquote deliberately has no accelerator: the punctuation chords are
	// not worth guessing at, and the menu item is the discoverable route.
	cmds.item(format.Add("Blockquote"), formatP, func() {
		emit("menu:format", "quote")
	}, doc)
}

// addViewMenu adds the View menu. The settings items read the current value
// from docs.Settings() when they run, never the item's checked state: run
// from the palette there is no native toggle, so the setting is the only
// truth both routes share.
func addViewMenu(menu *application.Menu, docs *DocumentService, emit func(name string, data ...any), cmds *commandSet) {
	viewP := []string{"View"}
	view := menu.AddSubmenu("View")
	// ⇧⌘P: the menu owns the chord because AppKit delivers menu key
	// equivalents before the webview sees them. Through emit (docEmit), so
	// it does nothing while the window is hidden.
	cmds.item(view.Add("Command Palette…").SetAccelerator("shift+cmdorctrl+p"), viewP, func() {
		emit("menu:command-palette")
	}, commandOpts{})
	view.AddSeparator()

	viewCurrent := docs.Settings()
	// No accelerator: the obvious chords are taken, and this is not a frequent
	// action — the same reasoning as Blockquote in the Format menu.
	cmds.item(view.AddCheckbox("Sync Scrolling", viewCurrent.SyncScrolling), viewP, func() {
		next := docs.Settings()
		next.SyncScrolling = !next.SyncScrolling
		if err := docs.UpdateSettings(next); err != nil {
			log.Printf("could not save sync scrolling: %v", err)
		}
	}, commandOpts{})

	// ⌘⌥O: CodeMirror claims nothing on it (checked against defaultKeymap and
	// foldKeymap), and the fold chords already establish ⌘⌥ as the View
	// menu's modifier. The panel's own arrow is the mouse route.
	cmds.item(view.AddCheckbox("Outline", viewCurrent.ShowOutline).SetAccelerator("cmdorctrl+alt+o"), viewP, func() {
		next := docs.Settings()
		next.ShowOutline = !next.ShowOutline
		if err := docs.UpdateSettings(next); err != nil {
			log.Printf("could not save outline visibility: %v", err)
		}
	}, commandOpts{})

	// Below Outline: a persisted on/off like Sync Scrolling, and the View
	// menu is where those live. No accelerator; this is set once, not
	// toggled mid-sentence. Same read-modify-write as the two above.
	cmds.item(view.AddCheckbox("Autosave", viewCurrent.AutoSave), viewP, func() {
		next := docs.Settings()
		next.AutoSave = !next.AutoSave
		if err := docs.UpdateSettings(next); err != nil {
			log.Printf("could not save autosave: %v", err)
		}
	}, commandOpts{})

	// Below Autosave: a persisted on/off applied by the editor as its
	// spellcheck attribute (lib/spellcheck.ts). No accelerator.
	cmds.item(view.AddCheckbox("Check Spelling", viewCurrent.SpellCheck), viewP, func() {
		next := docs.Settings()
		next.SpellCheck = !next.SpellCheck
		if err := docs.UpdateSettings(next); err != nil {
			log.Printf("could not save spell checking: %v", err)
		}
	}, commandOpts{})

	view.AddSeparator()
	appearance := view.AddSubmenu("Appearance")
	themes := []struct {
		label string
		value string
	}{
		{"System", "system"},
		{"Light", "light"},
		{"Dark", "dark"},
		{"Sepia", "sepia"},
	}
	for _, t := range themes {
		value := t.value
		cmds.item(appearance.AddRadio(t.label, viewCurrent.Theme == value), []string{"View", "Appearance"}, func() {
			// Read-modify-write the whole settings value, so this menu only
			// ever changes the field it owns.
			next := docs.Settings()
			next.Theme = value
			if err := docs.UpdateSettings(next); err != nil {
				log.Printf("could not save theme: %v", err)
			}
		}, commandOpts{})
	}

	// Both read viewCurrent, the settings snapshot taken at the top of this
	// View block. Each action re-reads and read-modify-writes the whole
	// value, so a submenu only ever changes the one field it owns.
	alignmentMenu := view.AddSubmenu("Figure Alignment")
	alignments := []struct {
		label string
		value string
	}{
		{"Left", "left"},
		{"Centre", "centre"},
		{"Right", "right"},
	}
	for _, a := range alignments {
		value := a.value
		cmds.item(alignmentMenu.AddRadio(a.label, viewCurrent.FigureAlignment == value), []string{"View", "Figure Alignment"}, func() {
			next := docs.Settings()
			next.FigureAlignment = value
			if err := docs.UpdateSettings(next); err != nil {
				log.Printf("could not save figure alignment: %v", err)
			}
		}, commandOpts{})
	}

	fontMenu := view.AddSubmenu("Body Font")
	for _, f := range bodyFonts {
		value := f.value
		cmds.item(fontMenu.AddRadio(f.label, viewCurrent.BodyFont == value), []string{"View", "Body Font"}, func() {
			next := docs.Settings()
			next.BodyFont = value
			if err := docs.UpdateSettings(next); err != nil {
				log.Printf("could not save body font: %v", err)
			}
		}, commandOpts{})
	}

	widthMenu := view.AddSubmenu("Chart Width")
	widths := []struct {
		label string
		value string
	}{
		{"Small", "small"},
		{"Medium", "medium"},
		{"Large", "large"},
	}
	for _, w := range widths {
		value := w.value
		cmds.item(widthMenu.AddRadio(w.label, viewCurrent.ChartWidth == value), []string{"View", "Chart Width"}, func() {
			next := docs.Settings()
			next.ChartWidth = value
			if err := docs.UpdateSettings(next); err != nil {
				log.Printf("could not save chart width: %v", err)
			}
		}, commandOpts{})
	}

	view.AddSeparator()
	// ⌘⌥[ and ⌘⌥] already fold and unfold the block at the cursor — CodeMirror's
	// foldKeymap binds them, and the webview sees them before AppKit does. These
	// items exist to make that discoverable; the accelerators shown here are
	// reflecting what already happens, not claiming it.
	folds := []struct {
		label string
		key   string
		arg   string
	}{
		{"Fold Block", "cmdorctrl+alt+[", "fold-block"},
		{"Unfold Block", "cmdorctrl+alt+]", "unfold-block"},
	}
	for _, f := range folds {
		arg := f.arg
		cmds.item(view.Add(f.label).SetAccelerator(f.key), viewP, func() {
			emit("menu:fold", arg)
		}, commandOpts{needsDocument: true})
	}

	view.AddSeparator()
	// No accelerators: an invented chord cannot be checked against every macOS
	// binding, and the menu item is the discoverable route — the same reasoning
	// as Blockquote in the Format menu.
	cmds.item(view.Add("Fold All Code Blocks"), viewP, func() {
		emit("menu:fold", "fold-all-code")
	}, commandOpts{needsDocument: true})
	cmds.item(view.Add("Unfold All"), viewP, func() {
		emit("menu:fold", "unfold-all")
	}, commandOpts{needsDocument: true})
}

// reclaimQuitItem takes the App menu's Quit item back from AppKit so a Go
// handler can run on it, and returns it — or nil if there is no Quit item.
//
// Attaching OnClick alone does nothing, which is how the first attempt at this
// fix shipped without working. Wails builds a role-based item with the role's
// native selector and target=nil (menuitem_selectors_darwin.go maps Quit to
// "terminate:"), so AppKit sends the action up the responder chain to NSApp
// and the callback is never invoked. Clearing the role drops the selector,
// which puts the item back on the ordinary handleClick path. The label and the
// ⌘Q accelerator are properties of the item, not the role, so both survive.
func reclaimQuitItem(menu *application.Menu) *application.MenuItem {
	quit := menu.FindByRole(application.Quit)
	if quit == nil {
		return nil
	}
	return quit.SetRole(application.NoRole)
}

// quitRequest decides what ⌘Q does: raise the confirm (unsaved changes, or
// a builder open; see mustAsk), or quit. Split out from the menu closure so the branch is reachable by a test —
// getting it the wrong way round silently discards the user's document, and
// AppKit menu construction cannot be exercised headlessly.
func quitRequest(ask bool, confirm func(), quit func()) {
	if ask {
		confirm()
		return
	}
	quit()
}

// shouldQuit is Options.ShouldQuit's decision, run from AppKit's
// applicationShouldTerminate. ⌘Q is caught earlier by quitRequest, but the
// Dock's Quit, logout and restart arrive only here. A dirty document (or an
// open builder) raises the same confirm and refuses the quit; the user's Save or Don't Save then
// calls DocumentService.Quit, which approves first so this lets it through.
func shouldQuit(ask, approved bool, confirm func()) bool {
	if ask && !approved {
		confirm()
		return false
	}
	return true
}

// findItems is the Edit → Find submenu. command is the menu:find payload,
// which App.svelte hands to Editor.find.
var findItems = []struct{ label, key, command string }{
	{"Find…", "cmdorctrl+f", "open"},
	{"Find and Replace…", "alt+cmdorctrl+f", "replace"},
	{"Find Next", "cmdorctrl+g", "next"},
	{"Find Previous", "shift+cmdorctrl+g", "previous"},
}

// closeRequest decides what the window's close button does: raise the
// confirm (unsaved changes, or a builder open), or close. Split out for the same reason as
// quitRequest. Closing hides the window rather than quitting, so Hermes stays
// in the Dock and a click on its icon brings the window back (#17).
func closeRequest(ask bool, confirm func(), close func()) {
	if ask {
		confirm()
		return
	}
	close()
}

// whenVisible runs act only if the window is showing. Split out so the branch
// is testable without a window.
func whenVisible(visible bool, act func()) {
	if visible {
		act()
	}
}

// showWindow brings the window back if a close hid it. Menu items that start
// a document emit to the frontend, and a hidden window would act on them
// invisibly.
func showWindow(win *application.WebviewWindow) {
	win.Show()
	win.Focus()
}

// addAppMenu builds the application menu by hand, in the order of Wails' own
// AppMenu role (roles.go, NewAppMenu), with Account… after About: the role
// is a fixed block that takes no items of its own. Quit is still a role
// item, which reclaimQuitItem then takes over and installMenu registers.
func addAppMenu(menu *application.Menu, name string, onAccount func(), cmds *commandSet) {
	appMenu := menu.AddSubmenu(name)
	appMenu.AddRole(application.About)
	cmds.item(appMenu.Add("Account…"), []string{name}, onAccount, commandOpts{})
	appMenu.AddSeparator()
	appMenu.AddRole(application.ServicesMenu)
	appMenu.AddSeparator()
	appMenu.AddRole(application.Hide)
	appMenu.AddRole(application.HideOthers)
	appMenu.AddRole(application.UnHide)
	appMenu.AddSeparator()
	appMenu.AddRole(application.Quit)
}

// addExportMenu adds the top-level Export menu after File. Every item goes
// through an event rather than calling a service: the save dialog offers a
// filename derived from the document's own path, which only the frontend
// holds, and HTML, Word and LaTeX are built from the document or its rendered
// preview, which only the frontend has. Word and LaTeX convert through the
// portal (PortalService.Export).
func addExportMenu(menu *application.Menu, emit func(name string, data ...any), cmds *commandSet) {
	exportP := []string{"Export"}
	doc := commandOpts{needsDocument: true}
	export := menu.AddSubmenu("Export")
	cmds.item(export.Add("Export PDF…").SetAccelerator("cmdorctrl+e"), exportP, func() {
		emit("menu:export-pdf")
	}, doc)
	cmds.item(export.Add("Export HTML…"), exportP, func() {
		emit("menu:export-html")
	}, doc)
	export.AddSeparator()
	cmds.item(export.Add("Export Word…"), exportP, func() {
		emit("menu:export-pandoc", "docx")
	}, doc)
	cmds.item(export.Add("Export LaTeX…"), exportP, func() {
		emit("menu:export-pandoc", "latex")
	}, doc)
}

// addInsertMenu adds the Insert menu; emit is installMenu's docEmit, so a
// hidden window drops these like every other document action.
func addInsertMenu(menu *application.Menu, emit func(name string, data ...any), cmds *commandSet) {
	insertP := []string{"Insert"}
	doc := commandOpts{needsDocument: true}
	insert := menu.AddSubmenu("Insert")
	cmds.item(insert.Add("Citation…").SetAccelerator("shift+cmdorctrl+c"), insertP, func() {
		emit("menu:insert-citation", nil)
	}, doc)
	// Lists the document's figures, tables and equations at the cursor, the
	// way typing @fig: does; the frontend owns the list.
	cmds.item(insert.Add("Cross-reference…").SetAccelerator("shift+cmdorctrl+r"), insertP, func() {
		emit("menu:insert-crossref", nil)
	}, doc)
	// No accelerator: an invented chord cannot be checked against every macOS
	// binding, and the menu item is the discoverable route — the same reasoning
	// as Blockquote in the Format menu.
	cmds.item(insert.Add("Chart…"), insertP, func() {
		emit("menu:insert-chart", nil)
	}, doc)
	// ⇧⌘T: free in CodeMirror's defaultKeymap and foldKeymap, and the webview
	// has no tabs to reopen.
	cmds.item(insert.Add("Table…").SetAccelerator("shift+cmdorctrl+t"), insertP, func() {
		emit("menu:insert-table", nil)
	}, doc)

	// A submenu rather than a dialog: a code fence is a delimiter and a
	// language name, and the only part carrying value is choosing the language
	// — which a submenu does natively, needing no new UI. Curated rather than
	// the ~150 language-data knows about, which would be unusable as a menu
	// and would need a filter field, i.e. the dialog this avoids.
	//
	// Every token below was checked against loadGrammar's lookup (by name or
	// alias) and resolves. One that did not would insert a block that silently
	// never colours — which is why MATLAB is absent: no grammar ships for it.
	codeBlock := insert.AddSubmenu("Code Block")
	codeP := []string{"Insert", "Code Block"}
	codeLanguages := []struct {
		label string
		token string
	}{
		{"Python", "python"},
		{"R", "r"},
		{"Julia", "julia"},
		{"Fortran", "fortran"},
		{"C++", "c++"},
		{"JavaScript", "javascript"},
		{"Go", "go"},
		{"Rust", "rust"},
		{"Shell", "shell"},
		{"SQL", "sql"},
		{"JSON", "json"},
		{"YAML", "yaml"},
		{"LaTeX", "latex"},
	}
	for _, l := range codeLanguages {
		token := l.token
		cmds.item(codeBlock.Add(l.label), codeP, func() {
			emit("menu:insert-code", token)
		}, doc)
	}
	// Separated for the same reason Paragraph is separated from the headings
	// below: it is the "no language" option, not another language.
	codeBlock.AddSeparator()
	cmds.item(codeBlock.Add("Plain text"), codeP, func() {
		emit("menu:insert-code", "")
	}, doc)
}
