package main

import "github.com/wailsapp/wails/v3/pkg/application"

// Every event Go sends to the frontend, with its payload type. The binding
// generator reads these calls (they must be direct, with constant names) and
// types each event's data for Events.On; Wails cancels an event emitted with
// any other type, and events_test.go checks that every emitted name is here.
// application.Void means the event carries no data.
func init() {
	// The open document, from the watcher (docwatch.go) and the window.
	application.RegisterEvent[DiskChange]("document:changed")
	application.RegisterEvent[DocMove]("document:moved")
	application.RegisterEvent[DocDeleted]("document:deleted")
	application.RegisterEvent[application.Void]("document:closed")
	// "close" from the window's close button, "quit" from every quit.
	application.RegisterEvent[string]("close:confirm")
	// A .md handed over by Finder while running.
	application.RegisterEvent[string]("file:open")
	application.RegisterEvent[application.Void]("recents:changed")
	application.RegisterEvent[application.Void]("settings:changed")
	application.RegisterEvent[application.Void]("bib:changed")
	application.RegisterEvent[PairingEvent]("portal:pairing")

	// Menu items. A string payload names what to do.
	application.RegisterEvent[application.Void]("menu:new")
	application.RegisterEvent[application.Void]("menu:open")
	application.RegisterEvent[string]("menu:open-recent")
	application.RegisterEvent[application.Void]("menu:save")
	application.RegisterEvent[application.Void]("menu:save-as")
	application.RegisterEvent[application.Void]("menu:export-pdf")
	application.RegisterEvent[application.Void]("menu:export-html")
	application.RegisterEvent[string]("menu:export-pandoc")
	application.RegisterEvent[application.Void]("menu:account")
	application.RegisterEvent[application.Void]("menu:check-updates")
	application.RegisterEvent[application.Void]("menu:tutorial")
	application.RegisterEvent[application.Void]("menu:acknowledgements")
	application.RegisterEvent[application.Void]("menu:command-palette")
	application.RegisterEvent[application.Void]("menu:insert-citation")
	application.RegisterEvent[application.Void]("menu:insert-crossref")
	application.RegisterEvent[application.Void]("menu:insert-chart")
	application.RegisterEvent[application.Void]("menu:insert-table")
	application.RegisterEvent[string]("menu:insert-code")
	application.RegisterEvent[string]("menu:citation-style")
	application.RegisterEvent[string]("menu:format")
	application.RegisterEvent[string]("menu:fold")
	application.RegisterEvent[string]("menu:find")
}
