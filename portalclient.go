package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"time"
)

// The portal's device API (hermesportal docs/api/device-flow.md). Every call
// to it is made from Go: the API answers no CORS on purpose, and the
// webview is not a client it serves.

// productionPortalOrigin is the www host on purpose: the apex and the old
// hermeseditor.com hosts answer 301, and a POST body does not survive it.
const productionPortalOrigin = "https://www.halmoseditor.com"

const (
	portalClientID       = "halmos-editor"
	portalTimeout        = 15 * time.Second
	portalConvertTimeout = 60 * time.Second
	maxPortalResponse    = 1 << 20
	// A conversion's result can be up to 44 MiB of document, base64-encoded.
	maxConvertResponse = 64 << 20
)

// PortalError is every failure a portal call can end in, in the shape the
// frontend branches on. Code is the contract's fixed `error` word, or one of
// the editor's own: network, misconfigured, reauth, signed_out, server_error.
// It never carries a token or anything from the request.
type PortalError struct {
	Status            int    `json:"status"`
	Code              string `json:"code"`
	Reason            string `json:"reason,omitempty"`
	Limit             string `json:"limit,omitempty"`
	PricingURL        string `json:"pricingURL,omitempty"`
	RetryAfterSeconds int    `json:"retryAfterSeconds,omitempty"`
}

func (e *PortalError) Error() string {
	if e.Reason != "" || e.Limit != "" {
		return fmt.Sprintf("portal: %d %s (%s%s)", e.Status, e.Code, e.Reason, e.Limit)
	}
	return fmt.Sprintf("portal: %d %s", e.Status, e.Code)
}

// validateOrigin accepts an https origin with nothing after the host: the
// form a development portal behind a tunnel is given in.
func validateOrigin(s string) (string, error) {
	u, err := url.Parse(s)
	if err != nil || u.Scheme != "https" || u.Host == "" || u.User != nil ||
		(u.Path != "" && u.Path != "/") || u.RawQuery != "" || u.Fragment != "" || u.Opaque != "" {
		return "", fmt.Errorf("portal origin must be https://host with no path: %q", s)
	}
	return "https://" + u.Host, nil
}

// sameOrigin reports whether rawURL is on origin, so a URL the server sends
// (a verification or pricing page) is opened only on the host being talked to.
func sameOrigin(rawURL, origin string) bool {
	u, err := url.Parse(rawURL)
	if err != nil || u.Scheme == "" || u.Host == "" {
		return false
	}
	return u.Scheme+"://"+u.Host == origin
}

// refuseRedirect stops the client following any redirect; do reports the
// 3xx as a misconfiguration rather than re-sending a body to another host.
func refuseRedirect(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }

type portalClient struct {
	origin  string
	http    *http.Client
	version string
}

func newPortalClient(origin, version string) *portalClient {
	return &portalClient{
		origin:  origin,
		http:    &http.Client{CheckRedirect: refuseRedirect},
		version: version,
	}
}

// do sends one request to <origin>/api/v1<path>. A non-nil body is sent as
// JSON from a bytes.Reader, so it carries a Content-Length and is never
// chunked — the portal refuses both alternatives before reading.
func (c *portalClient) do(ctx context.Context, method, path string, body any, bearer string, timeout time.Duration) ([]byte, *PortalError) {
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	var reader io.Reader
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			return nil, &PortalError{Code: "invalid_request"}
		}
		reader = bytes.NewReader(data)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.origin+"/api/v1"+path, reader)
	if err != nil {
		return nil, &PortalError{Code: "misconfigured"}
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if bearer != "" {
		req.Header.Set("Authorization", "Bearer "+bearer)
	}
	ua := "HalmosEditor"
	if c.version != "" {
		ua += "/" + c.version
	}
	req.Header.Set("User-Agent", ua)

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, &PortalError{Code: "network"}
	}
	defer resp.Body.Close()
	limit := int64(maxPortalResponse)
	if path == "/services/convert" {
		limit = maxConvertResponse
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, limit+1))
	if err != nil {
		return nil, &PortalError{Status: resp.StatusCode, Code: "network"}
	}
	if int64(len(data)) > limit {
		return nil, &PortalError{Status: resp.StatusCode, Code: "server_error"}
	}
	if resp.StatusCode >= 300 && resp.StatusCode < 400 {
		return nil, &PortalError{Status: resp.StatusCode, Code: "misconfigured"}
	}
	if resp.StatusCode < 300 {
		return data, nil
	}
	return nil, decodePortalError(resp, data)
}

func decodePortalError(resp *http.Response, data []byte) *PortalError {
	var body struct {
		Error      string `json:"error"`
		Reason     string `json:"reason"`
		Limit      string `json:"limit"`
		PricingURL string `json:"pricing_url"`
	}
	perr := &PortalError{Status: resp.StatusCode}
	if err := json.Unmarshal(data, &body); err != nil || body.Error == "" {
		perr.Code = "server_error"
	} else {
		perr.Code, perr.Reason, perr.Limit, perr.PricingURL = body.Error, body.Reason, body.Limit, body.PricingURL
	}
	if resp.StatusCode == http.StatusTooManyRequests || resp.StatusCode == http.StatusServiceUnavailable {
		perr.RetryAfterSeconds = 2
		if n, err := strconv.Atoi(resp.Header.Get("Retry-After")); err == nil && n > 0 {
			perr.RetryAfterSeconds = n
		}
	}
	return perr
}
