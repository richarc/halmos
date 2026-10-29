package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func testStyleClient(t *testing.T, h http.HandlerFunc) (*styleClient, *httptest.Server) {
	t.Helper()
	srv := httptest.NewTLSServer(h)
	t.Cleanup(srv.Close)
	return newStyleClient(srv.URL, "1.2.3", srv.Client()), srv
}

func sha(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

func TestFetchIndexSendsETagAndReads304(t *testing.T) {
	c, _ := testStyleClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/styles/index.json" {
			t.Errorf("path %q", r.URL.Path)
		}
		if got := r.Header.Get("User-Agent"); got != "HalmosEditor/1.2.3" {
			t.Errorf("user agent %q", got)
		}
		if r.Header.Get("If-None-Match") == `"abc"` {
			w.WriteHeader(http.StatusNotModified)
			return
		}
		if r.Header.Get("If-None-Match") != "" {
			t.Errorf("unexpected If-None-Match %q", r.Header.Get("If-None-Match"))
		}
		w.Header().Set("ETag", `"abc"`)
		_, _ = w.Write([]byte(`{"version":1}`))
	})
	data, etag, notModified, perr := c.fetchIndex(context.Background(), "")
	if perr != nil || notModified || string(data) != `{"version":1}` || etag != `"abc"` {
		t.Fatalf("first: %q %q %v %v", data, etag, notModified, perr)
	}
	data, _, notModified, perr = c.fetchIndex(context.Background(), etag)
	if perr != nil || !notModified || data != nil {
		t.Fatalf("second: %q %v %v", data, notModified, perr)
	}
}

func TestFetchIndexCapsSize(t *testing.T) {
	c, _ := testStyleClient(t, func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write(bytes.Repeat([]byte("x"), maxStyleIndex+1))
	})
	if _, _, _, perr := c.fetchIndex(context.Background(), ""); perr == nil || perr.Code != "server_error" {
		t.Fatalf("got %v", perr)
	}
}

func TestFetchStyleFollowsSameOriginRedirect(t *testing.T) {
	c, _ := testStyleClient(t, func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/styles/aaa.csl":
			http.Redirect(w, r, "/styles/new.csl", http.StatusMovedPermanently)
		case "/styles/new.csl":
			_, _ = w.Write([]byte("<style/>"))
		default:
			http.NotFound(w, r)
		}
	})
	data, perr := c.fetchStyle(context.Background(), "aaa")
	if perr != nil || string(data) != "<style/>" {
		t.Fatalf("got %q %v", data, perr)
	}
}

func TestFetchStyleRefusesOtherOrigin(t *testing.T) {
	c, _ := testStyleClient(t, func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "https://example.invalid/x.csl", http.StatusMovedPermanently)
	})
	if _, perr := c.fetchStyle(context.Background(), "aaa"); perr == nil || perr.Code != "misconfigured" {
		t.Fatalf("got %v", perr)
	}
}

func TestFetchStyleErrors(t *testing.T) {
	c, _ := testStyleClient(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/styles/busy.csl" {
			w.Header().Set("Retry-After", "60")
			w.WriteHeader(http.StatusTooManyRequests)
			_, _ = w.Write([]byte(`{"error":"rate_limited"}`))
			return
		}
		w.WriteHeader(http.StatusNotFound)
		_, _ = w.Write([]byte(`{"error":"not_found","error_description":"no"}`))
	})
	if _, perr := c.fetchStyle(context.Background(), "gone"); perr == nil || perr.Code != "not_found" {
		t.Fatalf("404: %v", perr)
	}
	_, perr := c.fetchStyle(context.Background(), "busy")
	if perr == nil || perr.Code != "rate_limited" || perr.RetryAfterSeconds != 60 {
		t.Fatalf("429: %v", perr)
	}
}

func TestFetchStyleRejectsBadID(t *testing.T) {
	requests := 0
	c, _ := testStyleClient(t, func(w http.ResponseWriter, r *http.Request) { requests++ })
	for _, id := range []string{"../x", "", "Nature", "a/b"} {
		if _, perr := c.fetchStyle(context.Background(), id); perr == nil || perr.Code != "not_found" {
			t.Errorf("%q: %v", id, perr)
		}
	}
	if requests != 0 {
		t.Fatalf("%d requests", requests)
	}
}

func TestFetchNetworkFailure(t *testing.T) {
	c, srv := testStyleClient(t, func(w http.ResponseWriter, r *http.Request) {})
	srv.Close()
	if _, perr := c.fetchStyle(context.Background(), "nature"); perr == nil || perr.Code != "network" {
		t.Fatalf("got %v", perr)
	}
}

const contractIndex = `{
  "version": 1,
  "commit": "3f2a",
  "built_at": "2026-10-29T04:47:12Z",
  "license": "CC BY-SA 3.0",
  "source": "https://github.com/citation-style-language/styles",
  "future_key": true,
  "styles": [
    {"id": "nature", "title": "Nature", "title_short": null, "parent": null, "format": "numeric",
     "fields": ["science", "generic-base"], "issn": "0028-0836", "eissn": "1476-4687",
     "updated": "2026-09-08T10:45:16+02:00", "sha256": "9c1e"},
    {"id": "nature-communications", "title": "Nature Communications", "title_short": null,
     "parent": "nature", "format": "numeric", "fields": ["science"], "issn": null,
     "eissn": "2041-1723", "updated": "2014-06-16T12:00:00+00:00", "sha256": "51d0"}
  ],
  "renamed": { "aaa": "american-anthropological-association" }
}`

func TestParseStyleIndex(t *testing.T) {
	idx, err := parseStyleIndex([]byte(contractIndex))
	if err != nil {
		t.Fatal(err)
	}
	if len(idx.Styles) != 2 || idx.Styles[1].Parent == nil || *idx.Styles[1].Parent != "nature" ||
		idx.Styles[0].Format == nil || *idx.Styles[0].Format != "numeric" || idx.Renamed["aaa"] == "" {
		t.Fatalf("parsed %+v", idx)
	}
	if _, err := parseStyleIndex([]byte(strings.Replace(contractIndex, `"version": 1`, `"version": 2`, 1))); err == nil {
		t.Error("version 2 accepted")
	}
	if _, err := parseStyleIndex([]byte(strings.Replace(contractIndex, `"id": "nature",`, `"id": "",`, 1))); err == nil {
		t.Error("empty id accepted")
	}
	if _, err := parseStyleIndex([]byte(strings.Replace(contractIndex, `"sha256": "9c1e"`, `"sha256": ""`, 1))); err == nil {
		t.Error("empty sha accepted")
	}
	if _, err := parseStyleIndex([]byte("not json")); err == nil {
		t.Error("garbage accepted")
	}
}

func TestCheckStyleFile(t *testing.T) {
	good := []byte(`<?xml version="1.0" encoding="utf-8"?>` + "\n" + `<style xmlns="http://purl.org/net/xbiblio/csl"></style>`)
	if err := checkStyleFile(good, sha(good)); err != nil {
		t.Errorf("good: %v", err)
	}
	if err := checkStyleFile(good, sha([]byte("other"))); err == nil {
		t.Error("wrong sha accepted")
	}
	html := []byte("<html></html>")
	if err := checkStyleFile(html, sha(html)); err == nil {
		t.Error("html accepted")
	}
	junk := []byte("not xml")
	if err := checkStyleFile(junk, sha(junk)); err == nil {
		t.Error("junk accepted")
	}
}
