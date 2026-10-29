package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"time"
)

// The portal's citation styles (hermesportal docs/api/styles.md): an index
// of every style in the CSL repository at /styles/index.json, and each file
// at /styles/<id>.csl. Plain GETs, no account. Like the device API they
// answer no CORS, so they are called from Go.

const (
	maxStyleIndex     = 32 << 20
	maxStyleFile      = 2 << 20
	styleIndexTimeout = 30 * time.Second
	styleFileTimeout  = 15 * time.Second
	maxStyleRedirects = 3
)

// styleIDPattern is the contract's ID: the file name without .csl. Checked
// before a request so a document's csl: value never builds another path.
var styleIDPattern = regexp.MustCompile(`^[a-z0-9]+(-[a-z0-9]+)*$`)

// styleEntry is one style in the index. Nullable keys are pointers; keys
// this editor does not use (issn, eissn) are left out and ignored.
type styleEntry struct {
	ID         string   `json:"id"`
	Title      string   `json:"title"`
	TitleShort *string  `json:"title_short"`
	Parent     *string  `json:"parent"`
	Format     *string  `json:"format"`
	Fields     []string `json:"fields"`
	Updated    *string  `json:"updated"`
	SHA256     string   `json:"sha256"`
}

type styleIndexDoc struct {
	Version int               `json:"version"`
	Commit  string            `json:"commit"`
	BuiltAt string            `json:"built_at"`
	Styles  []styleEntry      `json:"styles"`
	Renamed map[string]string `json:"renamed"`
}

type styleClient struct {
	origin  string
	http    *http.Client
	version string
}

// newStyleClient talks to origin's /styles. base supplies the transport
// (a test server's TLS client); nil means Go's default.
func newStyleClient(origin, version string, base *http.Client) *styleClient {
	c := &http.Client{CheckRedirect: sameOriginRedirect(origin)}
	if base != nil {
		c.Transport = base.Transport
	}
	return &styleClient{origin: origin, http: c, version: version}
}

// sameOriginRedirect follows the 301 a renamed style answers with, but only
// on the host being talked to. Anything else stops at the 3xx, which get
// reports as a misconfiguration.
func sameOriginRedirect(origin string) func(*http.Request, []*http.Request) error {
	return func(req *http.Request, via []*http.Request) error {
		if len(via) >= maxStyleRedirects || req.URL.Scheme+"://"+req.URL.Host != origin {
			return http.ErrUseLastResponse
		}
		return nil
	}
}

// get makes one GET. It returns the body for a 2xx, notModified for a 304,
// and the contract's error otherwise.
func (c *styleClient) get(ctx context.Context, path, etag string, limit int64, timeout time.Duration) (data []byte, newETag string, notModified bool, perr *PortalError) {
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.origin+path, nil)
	if err != nil {
		return nil, "", false, &PortalError{Code: "misconfigured"}
	}
	ua := "HalmosEditor"
	if c.version != "" {
		ua += "/" + c.version
	}
	req.Header.Set("User-Agent", ua)
	if etag != "" {
		req.Header.Set("If-None-Match", etag)
	}
	// No Accept-Encoding: Go's transport asks for gzip and undoes it itself,
	// which it stops doing once the header is set by hand.
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, "", false, &PortalError{Code: "network"}
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusNotModified {
		return nil, etag, true, nil
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, limit+1))
	if err != nil {
		return nil, "", false, &PortalError{Status: resp.StatusCode, Code: "network"}
	}
	if int64(len(body)) > limit {
		return nil, "", false, &PortalError{Status: resp.StatusCode, Code: "server_error"}
	}
	if resp.StatusCode >= 300 && resp.StatusCode < 400 {
		return nil, "", false, &PortalError{Status: resp.StatusCode, Code: "misconfigured"}
	}
	if resp.StatusCode >= 300 {
		return nil, "", false, decodePortalError(resp, body)
	}
	return body, resp.Header.Get("ETag"), false, nil
}

// fetchIndex gets the index, revalidating with etag when one is given.
func (c *styleClient) fetchIndex(ctx context.Context, etag string) ([]byte, string, bool, *PortalError) {
	return c.get(ctx, "/styles/index.json", etag, maxStyleIndex, styleIndexTimeout)
}

// fetchStyle gets one style file. A renamed ID's redirect is followed.
func (c *styleClient) fetchStyle(ctx context.Context, id string) ([]byte, *PortalError) {
	if !styleIDPattern.MatchString(id) {
		return nil, &PortalError{Code: "not_found"}
	}
	data, _, _, perr := c.get(ctx, "/styles/"+id+".csl", "", maxStyleFile, styleFileTimeout)
	return data, perr
}

// parseStyleIndex reads the index, refusing a version this editor does not
// know and any entry it could not install.
func parseStyleIndex(data []byte) (*styleIndexDoc, error) {
	var idx styleIndexDoc
	if err := json.Unmarshal(data, &idx); err != nil {
		return nil, err
	}
	if idx.Version != 1 {
		return nil, fmt.Errorf("style index version %d", idx.Version)
	}
	for _, st := range idx.Styles {
		if st.ID == "" || st.SHA256 == "" {
			return nil, errors.New("style index entry without id or sha256")
		}
	}
	return &idx, nil
}

// checkStyleFile accepts a downloaded style only when it is the file the
// index describes and is a CSL style at all.
func checkStyleFile(data []byte, want string) error {
	sum := sha256.Sum256(data)
	if hex.EncodeToString(sum[:]) != want {
		return errors.New("style file does not match the index")
	}
	dec := xml.NewDecoder(bytes.NewReader(data))
	for {
		tok, err := dec.Token()
		if err != nil {
			return errors.New("style file is not XML")
		}
		if start, ok := tok.(xml.StartElement); ok {
			if start.Name.Local != "style" {
				return errors.New("style file is not a CSL style")
			}
			return nil
		}
	}
}
