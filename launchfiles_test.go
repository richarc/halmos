package main

import "testing"

// A file handed over by Finder at cold launch arrives before the frontend is
// listening; it must wait for take() rather than be emitted into nothing.
func TestArriveBeforeReadyBuffers(t *testing.T) {
	var l launchFiles
	if l.arrive("/a.md") {
		t.Error("an arrival before take() must be buffered, not emitted")
	}
	if got := l.take(); got != "/a.md" {
		t.Errorf("take() = %q, want /a.md", got)
	}
}

func TestArriveAfterReadyEmits(t *testing.T) {
	var l launchFiles
	if got := l.take(); got != "" {
		t.Errorf("take() with nothing buffered = %q, want empty", got)
	}
	if !l.arrive("/b.md") {
		t.Error("an arrival after take() must be emitted")
	}
	if got := l.take(); got != "" {
		t.Errorf("an emitted arrival must not also be buffered, take() = %q", got)
	}
}

// Hermes has one window, so only the last of several files opens.
func TestLastArrivalWins(t *testing.T) {
	var l launchFiles
	l.arrive("/a.md")
	l.arrive("/b.md")
	if got := l.take(); got != "/b.md" {
		t.Errorf("take() = %q, want /b.md", got)
	}
}
