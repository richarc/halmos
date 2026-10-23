package main

import (
	"context"
	"encoding/base64"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func newTestPortalService(t *testing.T, f *fakePortal, store credentialStore) (*PortalService, *[]string) {
	t.Helper()
	a, _ := newTestAuth(f, store)
	opened := &[]string{}
	s := newPortalServiceWith(a, func(string, any) {}, func(u string) error {
		*opened = append(*opened, u)
		return nil
	})
	return s, opened
}

func TestServiceAccountSignedOut(t *testing.T) {
	f := newFakePortal(t, nil)
	s, _ := newTestPortalService(t, f, &memoryStore{})
	got := s.Account()
	if got.SignedIn || got.Error != nil {
		t.Errorf("got %+v", got)
	}
	if f.count("/me") != 0 {
		t.Error("asked /me with no credential")
	}
}

func TestServiceAccountMe(t *testing.T) {
	f := newFakePortal(t, map[string][]fakeResp{
		"/token": {{200, tokenBody("a1", "r2"), nil}},
		"/me": {{200, `{"user":{"email":"c@x.com"},"organisation":{"name":"Acme","slug":"acme"},` +
			`"seat":{"id":7,"source":"complimentary","status":"active"},"device":{"id":42,"name":"Mac · ABCD"}}`, nil}},
	})
	s, _ := newTestPortalService(t, f, signedIn(t, f, "r1"))
	got := s.Account()
	want := AccountInfo{SignedIn: true, Email: "c@x.com", Organisation: "Acme", SeatSource: "complimentary", SeatStatus: "active", DeviceName: "Mac · ABCD", PricingURL: f.srv.URL + "/pricing"}
	if got != want {
		t.Errorf("got %+v, want %+v", got, want)
	}

	f2 := newFakePortal(t, map[string][]fakeResp{
		"/token": {{200, tokenBody("a1", "r2"), nil}},
		"/me":    {{200, `{"user":{"email":"c@x.com"},"organisation":null,"seat":null,"device":{"id":42,"name":"Mac · ABCD"}}`, nil}},
	})
	s2, _ := newTestPortalService(t, f2, signedIn(t, f2, "r1"))
	if got := s2.Account(); !got.SignedIn || got.SeatSource != "" || got.Organisation != "" || got.Email != "c@x.com" {
		t.Errorf("no seat: %+v", got)
	}
}

func TestServiceAccountReauthIsSignedOut(t *testing.T) {
	f := newFakePortal(t, map[string][]fakeResp{"/token": {{400, `{"error":"invalid_grant"}`, nil}}})
	s, _ := newTestPortalService(t, f, signedIn(t, f, "r1"))
	if got := s.Account(); got.SignedIn || got.Error != nil {
		t.Errorf("got %+v, want signed out", got)
	}
}

func convertReply(data string) string {
	return `{"format":"docx","filename":"document.docx","content_base64":"` + base64.StdEncoding.EncodeToString([]byte(data)) + `"}`
}

func TestServiceExportWritesFile(t *testing.T) {
	f := newFakePortal(t, map[string][]fakeResp{
		"/token":            {{200, tokenBody("a1", "r2"), nil}},
		"/services/convert": {{200, convertReply("PK\x03\x04docx"), nil}},
	})
	s, _ := newTestPortalService(t, f, signedIn(t, f, "r1"))
	out := filepath.Join(t.TempDir(), "paper.docx")
	if perr := s.Export(out, ConvertRequest{Format: "docx", Markdown: "# Hi", Images: map[string]string{"images/1.png": "iVBO"}}); perr != nil {
		t.Fatal(perr)
	}
	if b, _ := os.ReadFile(out); string(b) != "PK\x03\x04docx" {
		t.Errorf("wrote %q", b)
	}
	sent := f.bodies["/services/convert"][0]
	if sent["format"] != "docx" || sent["markdown"] != "# Hi" || sent["images"] == nil {
		t.Errorf("sent %v", sent)
	}
	if _, has := sent["bibliography"]; has {
		t.Error("an empty bibliography must be left out, not sent empty")
	}
}

func TestServiceExportSendsNoImagesForLatex(t *testing.T) {
	f := newFakePortal(t, map[string][]fakeResp{
		"/token":            {{200, tokenBody("a1", "r2"), nil}},
		"/services/convert": {{200, convertReply(`\documentclass{article}`), nil}},
	})
	s, _ := newTestPortalService(t, f, signedIn(t, f, "r1"))
	out := filepath.Join(t.TempDir(), "paper.tex")
	if perr := s.Export(out, ConvertRequest{Format: "latex", Markdown: "x", Images: map[string]string{"a.png": "x"}}); perr != nil {
		t.Fatal(perr)
	}
	if _, has := f.bodies["/services/convert"][0]["images"]; has {
		t.Error("images sent with latex, which the portal refuses")
	}
}

func TestServiceExportErrorPassesThrough(t *testing.T) {
	f := newFakePortal(t, map[string][]fakeResp{
		"/token":            {{200, tokenBody("a1", "r2"), nil}},
		"/services/convert": {{402, `{"error":"no_seat","pricing_url":"https://p/pricing"}`, nil}},
	})
	s, _ := newTestPortalService(t, f, signedIn(t, f, "r1"))
	out := filepath.Join(t.TempDir(), "paper.docx")
	perr := s.Export(out, ConvertRequest{Format: "docx", Markdown: "x"})
	if perr == nil || perr.Code != "no_seat" || perr.PricingURL != "https://p/pricing" {
		t.Fatalf("got %+v", perr)
	}
	if _, err := os.Stat(out); !os.IsNotExist(err) {
		t.Error("a file was written for a failed export")
	}
}

func TestReadExportImage(t *testing.T) {
	dir := t.TempDir()
	doc := filepath.Join(dir, "paper.md")
	png := []byte("\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR")
	os.WriteFile(filepath.Join(dir, "a.png"), png, 0o644)
	os.WriteFile(filepath.Join(dir, "d.svg"), []byte(`<svg xmlns="http://www.w3.org/2000/svg"/>`), 0o644)
	os.WriteFile(filepath.Join(dir, "big.png"), make([]byte, 9<<20), 0o644)
	s := newPortalServiceWith(nil, nil, nil)

	if got := s.ReadExportImage(doc, "a.png"); got.Mime != "image/png" || got.Base64 != base64.StdEncoding.EncodeToString(png) || got.Error != "" {
		t.Errorf("png: %+v", got)
	}
	if got := s.ReadExportImage(doc, "d.svg"); got.Mime != "image/svg+xml" || got.Error != "" {
		t.Errorf("svg: %+v", got)
	}
	if got := s.ReadExportImage(doc, "big.png"); got.Error != "too_large" || got.Base64 != "" {
		t.Errorf("big: Error %q, %d bytes", got.Error, len(got.Base64))
	}
	if got := s.ReadExportImage("", "a.png"); got.Error == "" {
		t.Error("an untitled document resolved a relative image")
	}
	if got := s.ReadExportImage(doc, "missing.png"); got.Error == "" {
		t.Error("a missing image gave no error")
	}
}

func TestOpenPortalURLRefusesOtherHosts(t *testing.T) {
	f := newFakePortal(t, nil)
	s, opened := newTestPortalService(t, f, &memoryStore{})
	if perr := s.OpenPortalURL(f.srv.URL + "/pricing"); perr != nil {
		t.Errorf("same origin refused: %+v", perr)
	}
	if perr := s.OpenPortalURL("https://elsewhere.example/pricing"); perr == nil || perr.Code != "misconfigured" {
		t.Errorf("other host: %+v", perr)
	}
	if len(*opened) != 1 || !strings.HasSuffix((*opened)[0], "/pricing") {
		t.Errorf("opened %v", *opened)
	}
}

func TestStartPairingEmitsApproval(t *testing.T) {
	f := newFakePortal(t, nil)
	f.script = map[string][]fakeResp{
		"/device/authorize": {{200, `{"device_code":"dc","user_code":"BDFG-HJKL","verification_uri_complete":"` + f.srv.URL + `/device?user_code=BDFG-HJKL","expires_in":900,"interval":5}`, nil}},
		"/device/token":     {{200, tokenBody("a1", "r1"), nil}},
		"/me":               {{200, `{"user":{"email":"c@x.com"},"organisation":null,"seat":null,"device":{"id":42,"name":"Mac"}}`, nil}},
	}
	a, _ := newTestAuth(f, &memoryStore{})
	events := make(chan PairingEvent, 1)
	opened := []string{}
	s := newPortalServiceWith(a, func(name string, data any) {
		if name == "portal:pairing" {
			events <- data.(PairingEvent)
		}
	}, func(u string) error { opened = append(opened, u); return nil })
	info := s.StartPairing()
	if info.Error != nil || info.UserCode != "BDFG-HJKL" {
		t.Fatalf("StartPairing = %+v", info)
	}
	select {
	case ev := <-events:
		if ev.State != "approved" || ev.Email != "c@x.com" {
			t.Errorf("event %+v", ev)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("no portal:pairing event")
	}
	if len(opened) != 1 || !strings.Contains(opened[0], "user_code=BDFG-HJKL") {
		t.Errorf("opened %v", opened)
	}
	name, _ := f.bodies["/device/authorize"][0]["device_name"].(string)
	if !strings.Contains(name, " · ") {
		t.Errorf("device_name %q has no suffix", name)
	}
}

func TestPandocExportTarget(t *testing.T) {
	if dir, name := pandocExportTarget("docx", "/a/b/paper.md"); dir != "/a/b" || name != "paper.docx" {
		t.Errorf("docx: %q %q", dir, name)
	}
	if dir, name := pandocExportTarget("latex", ""); dir != "" || name != "Untitled.tex" {
		t.Errorf("latex untitled: %q %q", dir, name)
	}
}

func TestRevealCommandSelectsTheFileInFinder(t *testing.T) {
	if got := strings.Join(revealCommand("/a/b c/paper.docx"), "|"); got != "open|-R|/a/b c/paper.docx" {
		t.Errorf("got %q", got)
	}
}

// A Cancel, or a second Connect, while the code is still being asked for
// must leave no pairing polling behind: a stray poller would collect a
// device for a code the person never compared. Final review, Important 3.
func TestCancelDuringStartLeavesNoPoller(t *testing.T) {
	release := make(chan struct{})
	var polls atomic.Int32
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v1/device/authorize":
			<-release
			fmt.Fprintf(w, `{"device_code":"dc","user_code":"AAAA-BBBB","verification_uri_complete":"https://%s/device","expires_in":900,"interval":1}`, r.Host)
		case "/api/v1/device/token":
			polls.Add(1)
			w.WriteHeader(400)
			w.Write([]byte(`{"error":"authorization_pending"}`))
		}
	}))
	defer srv.Close()
	a := newPortalAuth(testClient(srv), &memoryStore{})
	a.sleep = func(ctx context.Context, d time.Duration) error { return sleepCtx(ctx, 10*time.Millisecond) }
	s := newPortalServiceWith(a, func(string, any) {}, func(string) error { return nil })

	done := make(chan PairingInfo)
	go func() { done <- s.StartPairing() }()
	time.Sleep(50 * time.Millisecond)
	s.CancelPairing()
	close(release)
	info := <-done
	if info.Error == nil || info.Error.Code != "cancelled" {
		t.Fatalf("StartPairing = %+v, want cancelled", info)
	}
	time.Sleep(100 * time.Millisecond)
	if n := polls.Load(); n != 0 {
		t.Errorf("%d polls after a cancelled start", n)
	}
}

func TestSecondStartCancelsTheFirst(t *testing.T) {
	var polls atomic.Int32
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v1/device/authorize":
			fmt.Fprintf(w, `{"device_code":"dc","user_code":"AAAA-BBBB","verification_uri_complete":"https://%s/device","expires_in":900,"interval":1}`, r.Host)
		case "/api/v1/device/token":
			polls.Add(1)
			w.WriteHeader(400)
			w.Write([]byte(`{"error":"authorization_pending"}`))
		}
	}))
	defer srv.Close()
	a := newPortalAuth(testClient(srv), &memoryStore{})
	a.sleep = func(ctx context.Context, d time.Duration) error { return sleepCtx(ctx, 20*time.Millisecond) }
	s := newPortalServiceWith(a, func(string, any) {}, func(string) error { return nil })
	var wg sync.WaitGroup
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); s.StartPairing() }()
	}
	wg.Wait()
	time.Sleep(30 * time.Millisecond)
	s.CancelPairing()
	before := polls.Load()
	time.Sleep(150 * time.Millisecond)
	if after := polls.Load(); after != before {
		t.Errorf("polling went on after CancelPairing: %d then %d", before, after)
	}
}

// The Word export reads images the document names, through the same rules as
// the preview: an image, never any other file.
func TestReadExportImageReadsOnlyImages(t *testing.T) {
	dir := t.TempDir()
	doc := filepath.Join(dir, "main.md")
	if err := os.WriteFile(filepath.Join(dir, "notes.txt"), []byte("SECRET"), 0o600); err != nil {
		t.Fatal(err)
	}
	got := (&PortalService{}).ReadExportImage(doc, "notes.txt")
	if got.Error != "not_found" || got.Base64 != "" {
		t.Errorf("ReadExportImage(notes.txt) = %+v, want not_found and no bytes", got)
	}
}
