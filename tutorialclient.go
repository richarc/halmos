package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"
)

// The portal's Getting Started tutorial (hermesportal docs/api/tutorial.md):
// a manifest at /tutorial/manifest.json naming each file with its size and
// SHA-256, and each file at /tutorial/<revision>/<name>. Plain GETs on the
// same origin as the styles, so styleClient's GET serves both.

const (
	maxTutorialText     = 1 << 20
	maxTutorialImage    = 2 << 20
	maxTutorialTotal    = 16 << 20
	maxTutorialManifest = 1 << 20
	tutorialTimeout     = 15 * time.Second
)

var (
	tutorialTextName  = regexp.MustCompile(`^[a-z0-9][a-z0-9-]*\.(md|bib|csv|tsv|json)$`)
	tutorialImageName = regexp.MustCompile(`^images/[a-z0-9][a-z0-9-]*\.(png|jpg)$`)
	tutorialHash      = regexp.MustCompile(`^[0-9a-f]{64}$`)
	tutorialRevision  = regexp.MustCompile(`^[0-9a-f]{1,64}$`)
)

type tutorialFile struct {
	Name   string `json:"name"`
	Size   int64  `json:"size"`
	SHA256 string `json:"sha256"`
	URL    string `json:"url"`
}

type tutorialManifest struct {
	Version   int            `json:"version"`
	Revision  string         `json:"revision"`
	Title     string         `json:"title"`
	Entry     string         `json:"entry"`
	MinEditor string         `json:"min_editor"`
	Files     []tutorialFile `json:"files"`
}

// checkTutorialName accepts only the contract's two shapes: a file at the
// top of the folder, or an image in images/. Nothing else can be joined to
// the folder, so no name can lead out of it.
func checkTutorialName(name string) error {
	if tutorialTextName.MatchString(name) || tutorialImageName.MatchString(name) {
		return nil
	}
	return fmt.Errorf("tutorial file name %q is not allowed", name)
}

func isTutorialImage(name string) bool { return strings.HasPrefix(name, "images/") }

// checkTutorialNames is the part of the checks the bundled copy shares:
// names, no duplicates, the entry, and the sizes.
func checkTutorialNames(entry string, names []string, size func(i int) int64) error {
	if len(names) == 0 {
		return errors.New("tutorial has no files")
	}
	seen := map[string]bool{}
	var total int64
	for i, name := range names {
		if err := checkTutorialName(name); err != nil {
			return err
		}
		if seen[name] {
			return fmt.Errorf("tutorial file %q is listed twice", name)
		}
		seen[name] = true
		limit := int64(maxTutorialText)
		if isTutorialImage(name) {
			limit = maxTutorialImage
		}
		n := size(i)
		if n < 0 || n > limit {
			return fmt.Errorf("tutorial file %q is %d bytes", name, n)
		}
		total += n
	}
	if total >= maxTutorialTotal {
		return fmt.Errorf("tutorial is %d bytes", total)
	}
	if !seen[entry] || isTutorialImage(entry) {
		return fmt.Errorf("tutorial entry %q is not one of its documents", entry)
	}
	return nil
}

// checkTutorialManifest refuses the whole manifest on any rule the contract
// sets, before a single file is requested.
func checkTutorialManifest(m *tutorialManifest) error {
	if m.Version != 1 {
		return fmt.Errorf("tutorial manifest version %d", m.Version)
	}
	if !tutorialRevision.MatchString(m.Revision) {
		return fmt.Errorf("tutorial revision %q", m.Revision)
	}
	names := make([]string, len(m.Files))
	for i, f := range m.Files {
		names[i] = f.Name
		if !tutorialHash.MatchString(f.SHA256) {
			return fmt.Errorf("tutorial file %q has no usable sha256", f.Name)
		}
		if !strings.HasPrefix(f.URL, "/tutorial/") || strings.Contains(f.URL, "..") {
			return fmt.Errorf("tutorial file %q is not served from /tutorial/", f.Name)
		}
	}
	return checkTutorialNames(m.Entry, names, func(i int) int64 { return m.Files[i].Size })
}

// fetchTutorial gets the manifest, checks it, then gets every file and
// checks each against its size and hash. A manifest or file that breaks a
// rule is a PortalError with Code "invalid"; network and HTTP errors come
// back as styleClient.get reports them.
func fetchTutorial(ctx context.Context, c *styleClient) (*tutorialManifest, map[string][]byte, *PortalError) {
	data, _, _, perr := c.get(ctx, "/tutorial/manifest.json", "", maxTutorialManifest, tutorialTimeout)
	if perr != nil {
		return nil, nil, perr
	}
	var m tutorialManifest
	if err := json.Unmarshal(data, &m); err != nil {
		return nil, nil, &PortalError{Code: "invalid"}
	}
	if err := checkTutorialManifest(&m); err != nil {
		return nil, nil, &PortalError{Code: "invalid", Reason: err.Error()}
	}
	files := make(map[string][]byte, len(m.Files))
	for _, f := range m.Files {
		body, _, _, perr := c.get(ctx, f.URL, "", f.Size, tutorialTimeout)
		if perr != nil {
			return nil, nil, perr
		}
		sum := sha256.Sum256(body)
		if int64(len(body)) != f.Size || hex.EncodeToString(sum[:]) != f.SHA256 {
			return nil, nil, &PortalError{Code: "invalid", Reason: f.Name + " does not match the manifest"}
		}
		files[f.Name] = body
	}
	return &m, files, nil
}
