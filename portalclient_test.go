package main

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

// testClient points a portalClient at an httptest TLS server.
func testClient(srv *httptest.Server) *portalClient {
	c := newPortalClient(srv.URL, "9.9.9")
	c.http = srv.Client()
	c.http.CheckRedirect = refuseRedirect
	return c
}

func TestDoSendsJSONWithLength(t *testing.T) {
	var got *http.Request
	var body []byte
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got = r
		body, _ = io.ReadAll(r.Body)
		w.Write([]byte(`{"ok":true}`))
	}))
	defer srv.Close()
	out, perr := testClient(srv).do(context.Background(), "POST", "/device/authorize",
		map[string]string{"client_id": "halmos-editor"}, "x", time.Second)
	if perr != nil {
		t.Fatalf("do: %+v", perr)
	}
	if string(out) != `{"ok":true}` {
		t.Errorf("body = %s", out)
	}
	if got.URL.Path != "/api/v1/device/authorize" {
		t.Errorf("path = %s", got.URL.Path)
	}
	if ct := got.Header.Get("Content-Type"); ct != "application/json" {
		t.Errorf("Content-Type = %q", ct)
	}
	if got.ContentLength != int64(len(body)) || len(got.TransferEncoding) != 0 {
		t.Errorf("Content-Length %d for %d bytes, Transfer-Encoding %v", got.ContentLength, len(body), got.TransferEncoding)
	}
	if a := got.Header.Get("Authorization"); a != "Bearer x" {
		t.Errorf("Authorization = %q", a)
	}
	if ua := got.Header.Get("User-Agent"); ua != "HalmosEditor/9.9.9" {
		t.Errorf("User-Agent = %q", ua)
	}
	var sent map[string]string
	if json.Unmarshal(body, &sent) != nil || sent["client_id"] != "halmos-editor" {
		t.Errorf("sent %s", body)
	}
}

func TestDoDecodesErrors(t *testing.T) {
	cases := []struct {
		name   string
		status int
		body   string
		header map[string]string
		want   PortalError
	}{
		{"no seat", 402, `{"error":"no_seat","error_description":"x","pricing_url":"https://p/pricing"}`, nil,
			PortalError{Status: 402, Code: "no_seat", PricingURL: "https://p/pricing"}},
		{"rate limited", 429, `{"error":"rate_limited"}`, map[string]string{"Retry-After": "120"},
			PortalError{Status: 429, Code: "rate_limited", RetryAfterSeconds: 120}},
		{"nesting", 400, `{"error":"invalid_request","reason":"markdown_nesting"}`, nil,
			PortalError{Status: 400, Code: "invalid_request", Reason: "markdown_nesting"}},
		{"image limit", 413, `{"error":"payload_too_large","limit":"image"}`, nil,
			PortalError{Status: 413, Code: "payload_too_large", Limit: "image"}},
		{"busy default wait", 503, `{"error":"busy"}`, nil,
			PortalError{Status: 503, Code: "busy", RetryAfterSeconds: 2}},
		{"not json", 500, `<html>oops</html>`, nil,
			PortalError{Status: 500, Code: "server_error"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				for k, v := range tc.header {
					w.Header().Set(k, v)
				}
				w.WriteHeader(tc.status)
				w.Write([]byte(tc.body))
			}))
			defer srv.Close()
			_, perr := testClient(srv).do(context.Background(), "GET", "/me", nil, "", time.Second)
			if perr == nil || *perr != tc.want {
				t.Errorf("got %+v, want %+v", perr, tc.want)
			}
		})
	}
}

func TestDoRefusesRedirects(t *testing.T) {
	hit := false
	target := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { hit = true }))
	defer target.Close()
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, target.URL+r.URL.Path, http.StatusMovedPermanently)
	}))
	defer srv.Close()
	_, perr := testClient(srv).do(context.Background(), "POST", "/token", map[string]string{}, "", time.Second)
	if perr == nil || perr.Code != "misconfigured" {
		t.Errorf("got %+v, want misconfigured", perr)
	}
	if hit {
		t.Error("the redirect was followed")
	}
}

func TestDoNetworkError(t *testing.T) {
	srv := httptest.NewTLSServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	c := testClient(srv)
	srv.Close()
	_, perr := c.do(context.Background(), "GET", "/me", nil, "", time.Second)
	if perr == nil || perr.Code != "network" {
		t.Errorf("got %+v, want network", perr)
	}
}

func TestValidateOrigin(t *testing.T) {
	if got, err := validateOrigin("https://x.trycloudflare.com"); err != nil || got != "https://x.trycloudflare.com" {
		t.Errorf("valid origin refused: %q %v", got, err)
	}
	for _, bad := range []string{"", "http://x.com", "https://x.com/path", "https://x.com?q=1", "https://x.com#f", "https://", "x.com"} {
		if _, err := validateOrigin(bad); err == nil {
			t.Errorf("validateOrigin(%q) accepted", bad)
		}
	}
}

func TestSameOrigin(t *testing.T) {
	o := "https://www.halmoseditor.com"
	if !sameOrigin("https://www.halmoseditor.com/device?user_code=AB", o) {
		t.Error("same origin refused")
	}
	for _, u := range []string{"https://halmoseditor.com/pricing", "http://www.halmoseditor.com/x",
		"https://www.halmoseditor.com:8443/x", "https://evil.com/?https://www.halmoseditor.com", "not a url"} {
		if sameOrigin(u, o) {
			t.Errorf("sameOrigin(%q) = true", u)
		}
	}
}
