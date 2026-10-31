package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"hermes/internal/fileio"
)

// UpdateService is Help → Check for Updates… and the once-a-day check. The
// feed, version and clock are fields so tests can point it at an httptest
// server with a fixed clock and version.
type UpdateService struct {
	settings        *settingsStore
	updateFeed      string
	updateStatePath string
	now             func() time.Time
	version         func() string
}

// NewUpdateService checks against the app's own version, with its state
// file in dataDir beside the settings.
func NewUpdateService(dataDir string, settings *settingsStore) *UpdateService {
	return &UpdateService{
		settings:        settings,
		updateFeed:      updateFeedURL,
		updateStatePath: filepath.Join(dataDir, "update-check.json"),
		now:             time.Now,
		version:         appVersion,
	}
}

// CheckForUpdates compares the running version with the feed's. force skips
// the once-a-day throttle and the setting gate; the Help menu's manual item
// passes true, the automatic check at launch passes false.
//
// The privacy rules are all here: the request is the same bare URL every
// time with no query string and no custom header, and it happens at most
// once per interval. Nothing about the installation travels.
func (s *UpdateService) CheckForUpdates(force bool) (UpdateResult, error) {
	current := s.version()
	if current == "" {
		return UpdateResult{}, errors.New("this build has no version to compare")
	}
	result := UpdateResult{Current: current}

	now := s.now()
	if !force {
		// The frontend decides whether to ask, but the promise "nothing is
		// fetched while the setting is off" is kept here, at the layer that
		// opens the socket.
		if s.settings.get().UpdateCheck != "on" {
			return result, nil
		}
		if state, err := s.readUpdateState(); err == nil {
			since := now.Sub(state.CheckedAt)
			if since >= 0 && since < updateCheckInterval {
				return result, nil
			}
		}
	}
	// Recorded before the fetch, so a machine that cannot reach the feed is
	// not asked again on every launch that day. A manual check has no
	// once-a-day promise to record, so a failed write here is not a reason
	// to refuse it — the state simply is not recorded and the fetch goes
	// ahead. The automatic path stays fail-closed: without the record the
	// throttle cannot be kept, so it returns the error instead.
	if err := s.writeUpdateState(updateState{CheckedAt: now}); err != nil && !force {
		return result, err
	}

	latest, err := s.fetchLatestVersion()
	if err != nil {
		return result, err
	}
	cmp, err := compareVersions(current, latest)
	if err != nil {
		return result, err
	}
	result.Checked = true
	result.Latest = latest
	result.URL = releaseURL(latest)
	result.Available = cmp < 0
	return result, nil
}

// refuseDowngrade is the client's CheckRedirect policy: a redirect may move
// the request, but never off https once it started there, and not forever.
// net/http's default CheckRedirect caps a chain at 10 redirects; supplying a
// custom one (as the https guard requires) drops that cap, so it is
// reinstated here.
func refuseDowngrade(req *http.Request, via []*http.Request) error {
	if len(via) >= 10 {
		return errors.New("the version feed redirected too many times")
	}
	if via[0].URL.Scheme == "https" && req.URL.Scheme != "https" {
		return errors.New("the version feed redirected off https")
	}
	return nil
}

func (s *UpdateService) fetchLatestVersion() (string, error) {
	client := &http.Client{
		Timeout: updateFetchTimeout,
		// The URL is a constant, so only a redirect could move the request,
		// and it must not move it to plain http.
		CheckRedirect: refuseDowngrade,
	}
	resp, err := client.Get(s.updateFeed)
	if err != nil {
		return "", fmt.Errorf("the version feed could not be reached: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("the version feed returned %s", resp.Status)
	}
	// One byte over the limit is read so an oversized body is detected
	// rather than silently truncated into something that might parse.
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxUpdateFeedBytes+1))
	if err != nil {
		return "", err
	}
	if len(body) > maxUpdateFeedBytes {
		return "", errors.New("the version feed is larger than a version feed should be")
	}
	return parseUpdateFeed(body)
}

func (s *UpdateService) readUpdateState() (updateState, error) {
	var state updateState
	data, err := os.ReadFile(s.updateStatePath)
	if err != nil {
		return state, err
	}
	err = json.Unmarshal(data, &state)
	return state, err
}

func (s *UpdateService) writeUpdateState(state updateState) error {
	data, err := json.Marshal(state)
	if err != nil {
		return err
	}
	// No MkdirAll needed: xdg.DataFile("hermes/recents.json") in main.go
	// creates <data>/hermes before the service exists (adrg/xdg's
	// pathutil.Create does os.MkdirAll on the parent); the tests' temp
	// dir exists too.
	return fileio.WriteFileAtomic(s.updateStatePath, data, 0o644)
}
