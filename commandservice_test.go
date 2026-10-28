package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// testCommandService builds a service over a registry holding the given
// commands, each under File, with the main-thread hop replaced by a direct
// call so no running app is needed.
func testCommandService(t *testing.T, dir string, labels ...string) *CommandService {
	t.Helper()
	testApp()
	m := application.NewMenu()
	s := newCommandSet()
	for _, l := range labels {
		s.item(m.Add(l), []string{"File"}, func() {}, commandOpts{})
	}
	r := &commandRegistry{}
	r.replace(s)
	c := newCommandService(r, dir)
	c.invoke = func(fn func()) { fn() }
	return c
}

func TestRunCommandRecordsRecentsNewestFirst(t *testing.T) {
	c := testCommandService(t, t.TempDir(), "a", "b")
	for _, id := range []string{"File › a", "File › b", "File › a"} {
		if !c.RunCommand(id) {
			t.Fatalf("RunCommand(%q) = false", id)
		}
	}
	want := []string{"File › a", "File › b"}
	if got := c.Commands().Recent; !reflect.DeepEqual(got, want) {
		t.Fatalf("Recent = %q, want %q", got, want)
	}
}

func TestRecentsKeepFive(t *testing.T) {
	labels := []string{"1", "2", "3", "4", "5", "6"}
	c := testCommandService(t, t.TempDir(), labels...)
	for _, l := range labels {
		c.RunCommand("File › " + l)
	}
	want := []string{"File › 6", "File › 5", "File › 4", "File › 3", "File › 2"}
	if got := c.Commands().Recent; !reflect.DeepEqual(got, want) {
		t.Fatalf("Recent = %q, want %q", got, want)
	}
}

func TestRecentsSurviveANewService(t *testing.T) {
	dir := t.TempDir()
	c := testCommandService(t, dir, "a", "b")
	c.RunCommand("File › a")
	c.RunCommand("File › b")

	again := testCommandService(t, dir, "a", "b")
	want := []string{"File › b", "File › a"}
	if got := again.Commands().Recent; !reflect.DeepEqual(got, want) {
		t.Fatalf("Recent = %q, want %q", got, want)
	}
}

func TestUnknownCommandIsNotRecorded(t *testing.T) {
	c := testCommandService(t, t.TempDir(), "a")
	c.RunCommand("File › a")
	if c.RunCommand("nope") {
		t.Fatal("RunCommand(nope) = true, want false")
	}
	want := []string{"File › a"}
	if got := c.Commands().Recent; !reflect.DeepEqual(got, want) {
		t.Fatalf("Recent = %q, want %q", got, want)
	}
}

func TestBadRecentsFileIsEmpty(t *testing.T) {
	for _, contents := range []string{"", "{"} {
		dir := t.TempDir()
		path := filepath.Join(dir, "palette-recents.json")
		if err := os.WriteFile(path, []byte(contents), 0o644); err != nil {
			t.Fatal(err)
		}
		c := testCommandService(t, dir, "a")
		if got := c.Commands().Recent; len(got) != 0 {
			t.Fatalf("contents %q: Recent = %q, want empty", contents, got)
		}
		if !c.RunCommand("File › a") {
			t.Fatalf("contents %q: RunCommand = false", contents)
		}
		data, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		var got []string
		if err := json.Unmarshal(data, &got); err != nil {
			t.Fatalf("contents %q: file not rewritten as valid JSON: %v (%q)", contents, err, data)
		}
		if !reflect.DeepEqual(got, []string{"File › a"}) {
			t.Fatalf("contents %q: file holds %q", contents, got)
		}
	}
}
