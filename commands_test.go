package main

import (
	"reflect"
	"testing"

	"github.com/wailsapp/wails/v3/pkg/application"
)

func TestCommandSetRecordsPathLabelAndAccelerator(t *testing.T) {
	testApp()
	m := application.NewMenu()
	s := newCommandSet()
	s.item(m.Add("Table…").SetAccelerator("shift+cmdorctrl+t"), []string{"Insert"}, func() {}, commandOpts{})
	r := &commandRegistry{}
	r.replace(s)

	want := []Command{{ID: "Insert › Table…", Path: []string{"Insert"}, Label: "Table…", Accelerator: "Cmd+Shift+T"}}
	if got := r.list(); !reflect.DeepEqual(got, want) {
		t.Fatalf("list() = %#v, want %#v", got, want)
	}
}

func TestCommandSetLeavesOutDisabledItems(t *testing.T) {
	testApp()
	m := application.NewMenu()
	s := newCommandSet()
	s.item(m.Add("Save"), []string{"File"}, func() {}, commandOpts{})
	s.item(m.Add("Export").SetEnabled(false), []string{"File"}, func() {}, commandOpts{})
	r := &commandRegistry{}
	r.replace(s)

	got := r.list()
	if len(got) != 1 || got[0].Label != "Save" {
		t.Fatalf("list() = %#v, want only Save", got)
	}
}

func TestCommandSetReportsChecked(t *testing.T) {
	testApp()
	m := application.NewMenu()
	s := newCommandSet()
	s.item(m.AddCheckbox("Spell Check", true), []string{"Edit"}, func() {}, commandOpts{})
	s.item(m.AddRadio("A4", false), []string{"File", "Paper Size"}, func() {}, commandOpts{})
	r := &commandRegistry{}
	r.replace(s)

	got := r.list()
	if len(got) != 2 || !got[0].Checked || got[1].Checked {
		t.Fatalf("list() = %#v, want checkbox checked and radio unchecked", got)
	}
}

func TestCommandSetIDOverride(t *testing.T) {
	testApp()
	m := application.NewMenu()
	s := newCommandSet()
	s.item(m.Add("notes.md"), []string{"File", "Open Recent"}, func() {},
		commandOpts{id: "File › Open Recent › /a/notes.md", detail: "/a"})
	r := &commandRegistry{}
	r.replace(s)

	got := r.list()
	if len(got) != 1 || got[0].ID != "File › Open Recent › /a/notes.md" || got[0].Detail != "/a" {
		t.Fatalf("list() = %#v", got)
	}
}

func TestRegistryRunCallsTheMenuAction(t *testing.T) {
	testApp()
	m := application.NewMenu()
	s := newCommandSet()
	calls := 0
	s.item(m.Add("Save"), []string{"File"}, func() { calls++ }, commandOpts{})
	r := &commandRegistry{}
	r.replace(s)

	if !r.run("File › Save") {
		t.Fatal("run(File › Save) = false, want true")
	}
	if calls != 1 {
		t.Fatalf("fn called %d times, want 1", calls)
	}
	if r.run("nope") {
		t.Fatal("run(nope) = true, want false")
	}
}

func TestRegistryReplaceDropsOldEntries(t *testing.T) {
	testApp()
	m := application.NewMenu()
	r := &commandRegistry{}
	old := newCommandSet()
	oldCalls := 0
	old.item(m.Add("Old"), []string{"File"}, func() { oldCalls++ }, commandOpts{})
	r.replace(old)

	next := newCommandSet()
	next.item(m.Add("New"), []string{"File"}, func() {}, commandOpts{})
	r.replace(next)

	if r.run("File › Old") {
		t.Fatal("run(File › Old) = true after replace, want false")
	}
	if oldCalls != 0 {
		t.Fatalf("old fn called %d times, want 0", oldCalls)
	}
}
