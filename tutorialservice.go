package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// TutorialService is the editor's side of Help → Getting Started: it gets
// the tutorial from the portal (tutorialclient.go) or, offline, on any error
// or when the portal's needs a newer editor, from the copy bundled with the
// app (tutorialbundle.go), and writes it to a new folder. The frontend's
// GettingStarted.svelte asks and opens the entry it returns.
type TutorialService struct {
	client   *styleClient // nil when the portal origin is misconfigured
	version  string
	memory   string // <data>/hermes/tutorial.json: the last tutorial folder
	docsDir  string // where the folder is suggested: ~/Documents
	deadline time.Duration
	now      func() time.Time
}

const (
	tutorialFolderName = "Halmos Tutorial"
	tutorialMarkerName = ".halmos-tutorial.json"
	tutorialDeadline   = 30 * time.Second
)

// TutorialState is what the dialog shows: an earlier tutorial that is still
// there (Existing, with its entry), and the folder a fresh one would use.
type TutorialState struct {
	Existing      string `json:"existing"`
	ExistingEntry string `json:"existingEntry"`
	Suggested     string `json:"suggested"`
}

// TutorialResult is the written tutorial's entry. Bundled says the copy that
// came with the app was used; NeedsUpdate says the reason was that the portal's
// needs a newer editor, which is the one reason worth telling the user.
type TutorialResult struct {
	Entry       string `json:"entry"`
	Bundled     bool   `json:"bundled"`
	NeedsUpdate bool   `json:"needsUpdate"`
}

// tutorialMarker is .halmos-tutorial.json, written last in the folder so a
// second run knows what it holds.
type tutorialMarker struct {
	Revision string `json:"revision"`
	Source   string `json:"source"`
	Entry    string `json:"entry"`
	Created  string `json:"created"`
}

func NewTutorialService(dataDir string) *TutorialService {
	var client *styleClient
	if origin, err := portalOrigin(); err != nil {
		log.Printf("tutorial: portal origin: %v", err)
	} else {
		client = newStyleClient(origin, appVersion(), nil)
	}
	docs := ""
	if home, err := os.UserHomeDir(); err == nil {
		docs = filepath.Join(home, "Documents")
	}
	return newTutorialServiceWith(dataDir, docs, client, appVersion(), tutorialDeadline)
}

func newTutorialServiceWith(dataDir, docsDir string, client *styleClient, version string, deadline time.Duration) *TutorialService {
	return &TutorialService{
		client: client, version: version, memory: filepath.Join(dataDir, "tutorial.json"),
		docsDir: docsDir, deadline: deadline, now: time.Now,
	}
}

// nextTutorialFolder is "Halmos Tutorial" in parent, or the first of
// "Halmos Tutorial 2", "3", … that nothing there is called.
func nextTutorialFolder(parent string) string {
	for n := 1; ; n++ {
		name := tutorialFolderName
		if n > 1 {
			name = fmt.Sprintf("%s %d", tutorialFolderName, n)
		}
		p := filepath.Join(parent, name)
		if _, err := os.Lstat(p); errors.Is(err, os.ErrNotExist) {
			return p
		}
	}
}

// State reports the remembered tutorial, if its folder still holds the
// marker and the entry, and the folder a fresh one would go in.
func (s *TutorialService) State() TutorialState {
	st := TutorialState{Suggested: nextTutorialFolder(s.docsDir)}
	folder := s.remembered()
	if folder == "" {
		return st
	}
	b, err := os.ReadFile(filepath.Join(folder, tutorialMarkerName))
	if err != nil {
		return st
	}
	var m tutorialMarker
	if json.Unmarshal(b, &m) != nil || checkTutorialName(m.Entry) != nil {
		return st
	}
	entry := filepath.Join(folder, m.Entry)
	if info, err := os.Stat(entry); err != nil || !info.Mode().IsRegular() {
		return st
	}
	st.Existing, st.ExistingEntry = folder, entry
	return st
}

func (s *TutorialService) remembered() string {
	b, err := os.ReadFile(s.memory)
	if err != nil {
		return ""
	}
	var v struct {
		Folder string `json:"folder"`
	}
	if json.Unmarshal(b, &v) != nil || !filepath.IsAbs(v.Folder) {
		return ""
	}
	return v.Folder
}

func (s *TutorialService) remember(folder string) {
	b, _ := json.Marshal(map[string]string{"folder": folder})
	if err := os.MkdirAll(filepath.Dir(s.memory), 0o755); err != nil {
		log.Printf("tutorial: %v", err)
		return
	}
	if err := writeFileAtomic(s.memory, b, 0o644); err != nil {
		log.Printf("tutorial: %v", err)
	}
}

// ChooseLocation asks where the tutorial's folder goes and returns the
// folder it would use there; "" when the panel is cancelled. The folder is
// inside the place picked, so choosing the Desktop never scatters files
// across it.
func (s *TutorialService) ChooseLocation() (string, error) {
	parent, err := application.Get().Dialog.OpenFile().
		SetTitle("Choose where to put the tutorial").
		SetButtonText("Choose").
		CanChooseFiles(false).
		CanChooseDirectories(true).
		CanCreateDirectories(true).
		SetDirectory(s.docsDir).
		PromptForSingleSelection()
	if err != nil || parent == "" {
		return "", err
	}
	return nextTutorialFolder(parent), nil
}

// Create writes a tutorial to folder, which must not exist or be empty, and
// returns its entry. Getting it never fails: any trouble online ends in the
// bundled copy. Only writing it can fail.
func (s *TutorialService) Create(folder string) (TutorialResult, error) {
	if !filepath.IsAbs(folder) {
		return TutorialResult{}, errors.New("the folder is not a full path")
	}
	folder = filepath.Clean(folder)
	content, needsUpdate := s.online()
	if content == nil {
		bundled, err := bundledTutorial(s.version)
		if err != nil {
			return TutorialResult{}, err
		}
		content = bundled
	}
	if err := writeTutorial(folder, content, s.now()); err != nil {
		return TutorialResult{}, err
	}
	s.remember(folder)
	return TutorialResult{Entry: filepath.Join(folder, content.Entry), Bundled: content.Source == "bundled", NeedsUpdate: needsUpdate}, nil
}

// online is the portal's tutorial, or nil when the bundled copy should be
// used; needsUpdate when that is because the portal's needs a newer editor.
func (s *TutorialService) online() (content *tutorialContent, needsUpdate bool) {
	if s.client == nil {
		return nil, false
	}
	ctx, cancel := context.WithTimeout(context.Background(), s.deadline)
	defer cancel()
	m, files, perr := fetchTutorial(ctx, s.client)
	if perr != nil {
		log.Printf("tutorial: using the bundled copy: %s %s", perr.Code, perr.Reason)
		return nil, false
	}
	// An unbundled build has no version and takes the portal's.
	if s.version != "" && m.MinEditor != "" {
		cmp, err := compareVersions(m.MinEditor, s.version)
		if err != nil {
			log.Printf("tutorial: min_editor %q: %v", m.MinEditor, err)
			return nil, false
		}
		if cmp > 0 {
			return nil, true
		}
	}
	order := make([]string, len(m.Files))
	for i, f := range m.Files {
		order[i] = f.Name
	}
	return &tutorialContent{Revision: m.Revision, Entry: m.Entry, Source: "online", Files: files, Order: order}, false
}

// writeTutorial creates folder (or takes it when empty), images/ in it when
// a name needs it, and each file, never replacing one; the marker last.
func writeTutorial(folder string, c *tutorialContent, now time.Time) error {
	if err := os.MkdirAll(folder, 0o755); err != nil {
		return err
	}
	entries, err := os.ReadDir(folder)
	if err != nil {
		return err
	}
	if len(entries) > 0 {
		return fmt.Errorf("%s already has files in it", filepath.Base(folder))
	}
	for _, name := range c.Order {
		if err := checkTutorialName(name); err != nil {
			return err
		}
		if strings.HasPrefix(name, "images/") {
			if err := os.Mkdir(filepath.Join(folder, "images"), 0o755); err != nil && !errors.Is(err, os.ErrExist) {
				return err
			}
		}
		if err := writeNewFile(filepath.Join(folder, filepath.FromSlash(name)), c.Files[name]); err != nil {
			return err
		}
	}
	marker, _ := json.MarshalIndent(tutorialMarker{
		Revision: c.Revision, Source: c.Source, Entry: c.Entry, Created: now.UTC().Format(time.RFC3339),
	}, "", "  ")
	return writeNewFile(filepath.Join(folder, tutorialMarkerName), append(marker, '\n'))
}

// writeNewFile writes a file that must not exist yet.
func writeNewFile(path string, data []byte) error {
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644)
	if err != nil {
		return err
	}
	if _, err := f.Write(data); err != nil {
		f.Close()
		return err
	}
	return f.Close()
}
