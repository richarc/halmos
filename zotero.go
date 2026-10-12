package main

import (
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// ZoteroStatus says why the picker might not open: "not-running" when Zotero
// does not answer its connector ping, "no-better-bibtex" when it answers but
// Better BibTeX's CAYW probe does not say "ready", otherwise "ready". The
// frontend asks only after PickCitations has failed, so the picker is never
// probed on the happy path.
func (s *DocumentService) ZoteroStatus() string {
	client := &http.Client{Timeout: 2 * time.Second}
	ping, err := client.Get(s.caywBase + "/connector/ping")
	if err != nil {
		return "not-running"
	}
	ping.Body.Close()
	resp, err := client.Get(s.caywBase + "/better-bibtex/cayw?probe=true")
	if err != nil {
		return "no-better-bibtex"
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil || resp.StatusCode != http.StatusOK || strings.TrimSpace(string(body)) != "ready" {
		return "no-better-bibtex"
	}
	return "ready"
}

// PickCitations opens Zotero's citation picker via Better BibTeX's CAYW
// endpoint and returns the chosen citations in Pandoc format. The timeout is
// long because the user is interacting with the picker; an empty response
// means they cancelled.
func (s *DocumentService) PickCitations() (string, error) {
	client := &http.Client{Timeout: 5 * time.Minute}
	resp, err := client.Get(s.caywBase + "/better-bibtex/cayw?format=pandoc")
	if err != nil {
		return "", fmt.Errorf("zotero picker unavailable: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("zotero picker returned %s", resp.Status)
	}
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}
	// The picker is Zotero's own window, so showing it activates Zotero — and
	// when Hermes is fullscreen it owns a Space of its own, which means macOS
	// has to switch Spaces to get there. That part is not ours to prevent; you
	// cannot use the picker without Zotero coming forward. Coming back is
	// ours, and nothing did it, so the user was left on another Space with an
	// unsaved document behind a fullscreen boundary.
	//
	// Deliberately after a response rather than on the error path above: a
	// request that never reached Zotero never showed a picker, so focus never
	// left, and grabbing it back would be a pointless steal on top of an error
	// the user still has to read. A cancel gets the same treatment as a pick —
	// it arrives here with an empty body, and the user is just as stranded.
	s.refocusWindow()
	return string(body), nil
}
