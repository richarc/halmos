package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// Where the version feed lives and what it points at. A file in this
// repository rather than the Releases API: static, no rate limit, and it
// carries nothing but a version. When the documentation site ships the feed
// moves there; nothing else assumes where it is.
const (
	updateFeedURL       = "https://raw.githubusercontent.com/richarc/halmos/main/updates/latest.json"
	releasesBaseURL     = "https://github.com/richarc/halmos/releases"
	updateCheckInterval = 24 * time.Hour
	updateFetchTimeout  = 10 * time.Second
	// The feed is one short line. A body larger than this is not the feed.
	maxUpdateFeedBytes = 4 << 10
)

// UpdateResult is what CheckForUpdates hands the frontend. Checked false
// means the throttle applied and nothing was fetched; Current is filled
// either way so a manual "up to date" message can name the version.
type UpdateResult struct {
	Checked   bool   `json:"checked"`
	Available bool   `json:"available"`
	Current   string `json:"current"`
	Latest    string `json:"latest"`
	URL       string `json:"url"`
}

// updateState is the throttle: when the feed was last asked, whether or not
// the answer was usable. Kept in its own file rather than in Settings so a
// daily timestamp does not rebuild the menu and notify the frontend.
type updateState struct {
	CheckedAt time.Time `json:"checkedAt"`
}

// Exactly three numeric parts, an optional leading v (tags carry one,
// config.yml does not). No pre-release or build suffixes: Hermes has never
// shipped one, and accepting them would mean defining an order for them.
var versionPattern = regexp.MustCompile(`^v?(\d+)\.(\d+)\.(\d+)$`)

// compareVersions reports -1, 0 or 1 as a is older than, equal to, or newer
// than b. Either side failing to parse is an error rather than a guess.
func compareVersions(a, b string) (int, error) {
	pa, err := parseVersion(a)
	if err != nil {
		return 0, err
	}
	pb, err := parseVersion(b)
	if err != nil {
		return 0, err
	}
	for i := range pa {
		if pa[i] != pb[i] {
			if pa[i] < pb[i] {
				return -1, nil
			}
			return 1, nil
		}
	}
	return 0, nil
}

func parseVersion(v string) ([3]int, error) {
	var parts [3]int
	m := versionPattern.FindStringSubmatch(v)
	if m == nil {
		return parts, fmt.Errorf("not a version: %q", v)
	}
	for i := range parts {
		n, err := strconv.Atoi(m[i+1])
		if err != nil {
			return parts, err
		}
		parts[i] = n
	}
	return parts, nil
}

// parseUpdateFeed reads the version out of the feed body and validates it.
// Strict on purpose: the version is about to become part of a URL, and
// anything the pattern rejects never gets that far. Unknown keys are refused
// too — the feed has exactly one field, and a second one is a sign of a file
// that is not ours.
func parseUpdateFeed(body []byte) (string, error) {
	var feed struct {
		Version string `json:"version"`
	}
	dec := json.NewDecoder(bytes.NewReader(body))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&feed); err != nil {
		return "", fmt.Errorf("the version feed could not be read: %w", err)
	}
	if dec.More() {
		return "", errors.New("the version feed carries more than one value")
	}
	if !versionPattern.MatchString(feed.Version) || strings.HasPrefix(feed.Version, "v") {
		return "", fmt.Errorf("the version feed carries an unusable version %q", feed.Version)
	}
	return feed.Version, nil
}

// releaseURL is the release page for a version that parseUpdateFeed has
// already validated. Derived, never read from the feed.
func releaseURL(version string) string {
	return releasesBaseURL + "/tag/v" + version
}
