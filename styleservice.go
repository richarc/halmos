package main

import (
	"bytes"
	"context"
	"encoding/xml"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

// StyleService is the editor's side of Find a Style…: the portal's index of
// the CSL repository, the library of styles installed from it
// (stylelibrary.go), and turning a document's `csl:` value into the CSL
// that formats it. A dependent style formats with its parent, so that is
// the XML returned for one.
type StyleService struct {
	lib    *styleLibrary
	client *styleClient // nil when the portal origin is misconfigured
	now    func() time.Time

	// Called after the library changes, so the Citation Style menu can list
	// what was installed. Set once during startup.
	onChanged func()

	// fetchMu serialises index fetches, so a second LoadIndex waits for the
	// first rather than downloading the index again; mu guards the fields
	// below and is never held across a request.
	fetchMu sync.Mutex
	mu      sync.Mutex
	// Background revalidations started by LoadIndex; tests wait on it.
	bg      sync.WaitGroup
	index   *styleIndexDoc
	indexAt time.Time
	etag    string
	// Styles fetched to show a sample, kept until the app quits; nothing is
	// written to the library until Use Style.
	preview map[string][]byte
}

const styleIndexMaxAge = time.Hour

// NewStyleService keeps its library under dataDir/styles and talks to the
// same portal as PortalService.
func NewStyleService(dataDir string) *StyleService {
	var client *styleClient
	if origin, err := portalOrigin(); err != nil {
		log.Printf("styles: %v", err)
	} else {
		client = newStyleClient(origin, appVersion(), nil)
	}
	return newStyleServiceWith(&styleLibrary{dir: filepath.Join(dataDir, "styles")}, client, time.Now)
}

func newStyleServiceWith(lib *styleLibrary, client *styleClient, now func() time.Time) *StyleService {
	return &StyleService{lib: lib, client: client, now: now, preview: map[string][]byte{}}
}

// StyleIndexStatus is what the window needs before its first search. Error
// is "" (Ready), "offline" or "busy"; a failed refresh with a cached index
// is still Ready.
type StyleIndexStatus struct {
	Ready   bool     `json:"ready"`
	Error   string   `json:"error"`
	Fields  []string `json:"fields"`
	Updates int      `json:"updates"`
}

// errorWord maps a portal failure onto the few the frontend explains.
func errorWord(perr *PortalError) string {
	switch perr.Code {
	case "not_found":
		return "not_found"
	case "rate_limited", "busy", "unavailable":
		return "busy"
	}
	return "offline"
}

// currentIndex returns the index in memory, reading the cached copy from
// disk the first time.
func (s *StyleService) currentIndex() *styleIndexDoc {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.index == nil {
		if data, etag, at, err := s.lib.cachedIndex(); err == nil {
			if idx, err := parseStyleIndex(data); err == nil {
				s.index, s.etag, s.indexAt = idx, etag, at
			}
		}
	}
	return s.index
}

// refreshIndex fetches the index when there is none or it is an hour old.
// It returns "" or the reason there is no index at all.
func (s *StyleService) refreshIndex() string {
	s.fetchMu.Lock()
	defer s.fetchMu.Unlock()
	idx := s.currentIndex()
	s.mu.Lock()
	etag, at := s.etag, s.indexAt
	s.mu.Unlock()
	if idx != nil && s.now().Sub(at) < styleIndexMaxAge {
		return ""
	}
	if s.client == nil {
		return s.missing(idx, "offline")
	}
	if idx == nil {
		etag = ""
	}
	data, newETag, notModified, perr := s.client.fetchIndex(context.Background(), etag)
	if perr != nil {
		return s.missing(idx, errorWord(perr))
	}
	now := s.now()
	if notModified {
		s.mu.Lock()
		s.indexAt = now
		s.mu.Unlock()
		_ = s.lib.touchIndex(now)
		return ""
	}
	parsed, err := parseStyleIndex(data)
	if err != nil {
		return s.missing(idx, "offline")
	}
	s.mu.Lock()
	s.index, s.etag, s.indexAt = parsed, newETag, now
	s.mu.Unlock()
	if err := s.lib.storeIndex(data, newETag, now); err != nil {
		log.Printf("styles: caching the index: %v", err)
	}
	return ""
}

// stale is true when the index in memory is an hour old.
func (s *StyleService) stale() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.now().Sub(s.indexAt) >= styleIndexMaxAge
}

// missing reports a failed fetch: no problem while a cached index serves.
func (s *StyleService) missing(idx *styleIndexDoc, word string) string {
	if idx != nil {
		return ""
	}
	if word == "not_found" {
		return "offline"
	}
	return word
}

// LoadIndex makes the index ready for Search. With no index it waits for
// the fetch; with a cached one an hour old it answers from the cache and
// revalidates in the background, so a slow network never holds the window
// on "Loading styles…".
func (s *StyleService) LoadIndex() StyleIndexStatus {
	word := ""
	if s.currentIndex() == nil {
		word = s.refreshIndex()
	} else if s.stale() {
		s.bg.Add(1)
		go func() {
			defer s.bg.Done()
			s.refreshIndex()
		}()
	}
	idx := s.currentIndex()
	if idx == nil {
		return StyleIndexStatus{Error: word, Fields: []string{}}
	}
	updates := 0
	if lib, err := s.lib.installed(); err == nil {
		for _, st := range lib {
			if hasUpdate(idx, st) {
				updates++
			}
		}
	}
	return StyleIndexStatus{Ready: true, Fields: styleFields(idx), Updates: updates}
}

type StyleSearchResult struct {
	Styles []StyleSummary `json:"styles"`
	Total  int            `json:"total"`
}

const styleSearchLimit = 100

// Search looks through the index LoadIndex made ready; it never fetches.
func (s *StyleService) Search(query, field, format string) StyleSearchResult {
	s.mu.Lock()
	idx := s.index
	s.mu.Unlock()
	if idx == nil {
		return StyleSearchResult{Styles: []StyleSummary{}}
	}
	lib, _ := s.lib.installed()
	styles, total := searchStyles(idx, lib, query, field, format, styleSearchLimit)
	return StyleSearchResult{Styles: styles, Total: total}
}

// Installed lists the styles the author chose, by title; parents installed
// only for a dependent style are left out. It reads library.json alone,
// never the index: the menu calls it on the main thread at every rebuild.
func (s *StyleService) Installed() []StyleSummary {
	lib, err := s.lib.installed()
	if err != nil {
		return []StyleSummary{}
	}
	out := []StyleSummary{}
	for _, st := range lib {
		if st.AsParent {
			continue
		}
		parentTitle := ""
		if p, ok := lib[st.Parent]; ok {
			parentTitle = p.Title
		}
		out = append(out, StyleSummary{ID: st.ID, Title: st.Title, Parent: st.Parent, ParentTitle: parentTitle, Fields: []string{}, Installed: true})
	}
	sort.Slice(out, func(i, j int) bool {
		a, b := strings.ToLower(out[i].Title), strings.ToLower(out[j].Title)
		if a != b {
			return a < b
		}
		return out[i].ID < out[j].ID
	})
	return out
}

// indexFor finds id in the index, fetching the index when it is not known
// (or is stale). word is the reason when it cannot be found.
func (s *StyleService) indexFor(id string) (entry *styleEntry, word string) {
	if idx := s.currentIndex(); idx != nil {
		if e := indexEntry(idx, id); e != nil {
			return e, ""
		}
	}
	if w := s.refreshIndex(); w != "" {
		return nil, w
	}
	if idx := s.currentIndex(); idx != nil {
		if e := indexEntry(idx, id); e != nil {
			return e, ""
		}
	}
	return nil, "not_found"
}

// download fetches one style and checks it is the file the index describes.
func (s *StyleService) download(e *styleEntry) ([]byte, string) {
	if s.client == nil {
		return nil, "offline"
	}
	data, perr := s.client.fetchStyle(context.Background(), e.ID)
	if perr != nil {
		return nil, errorWord(perr)
	}
	if err := checkStyleFile(data, e.SHA256); err != nil {
		return nil, "invalid"
	}
	return data, ""
}

type StyleInstallResult struct {
	ID    string `json:"id"`
	Title string `json:"title"`
	Error string `json:"error"`
}

// InstallStyle installs a style, and its parent for a dependent one. Both
// are downloaded and checked before anything is written. Installing a style
// that is already installed is how an update is applied.
func (s *StyleService) InstallStyle(id string) StyleInstallResult {
	return s.install(id, false)
}

// install does InstallStyle's work. asParent installs the style only as
// what another style formats with, so it stays out of the menu.
func (s *StyleService) install(id string, asParent bool) StyleInstallResult {
	e, word := s.indexFor(id)
	if e == nil {
		return StyleInstallResult{ID: id, Error: word}
	}
	files := map[string][]byte{}
	now := s.now()
	data, word := s.download(e)
	if word != "" {
		return StyleInstallResult{ID: e.ID, Title: e.Title, Error: word}
	}
	files[e.ID] = data
	entries := []installedStyle{{ID: e.ID, Title: e.Title, Parent: deref(e.Parent), SHA256: e.SHA256, InstalledAt: now, AsParent: asParent}}
	if e.Parent != nil {
		p, word := s.indexFor(*e.Parent)
		if p == nil {
			return StyleInstallResult{ID: e.ID, Title: e.Title, Error: word}
		}
		pdata, word := s.download(p)
		if word != "" {
			return StyleInstallResult{ID: e.ID, Title: e.Title, Error: word}
		}
		files[p.ID] = pdata
		entries = append(entries, installedStyle{ID: p.ID, Title: p.Title, SHA256: p.SHA256, InstalledAt: now, AsParent: true})
	}
	if err := s.lib.writeStyles(files, entries); err != nil {
		log.Printf("styles: installing %s: %v", e.ID, err)
		return StyleInstallResult{ID: e.ID, Title: e.Title, Error: "unwritable"}
	}
	s.changed()
	return StyleInstallResult{ID: e.ID, Title: e.Title}
}

func (s *StyleService) changed() {
	if s.onChanged != nil {
		s.onChanged()
	}
}

// UpdateAll rewrites every installed style whose repository copy changed,
// each under the ID it was installed as, so documents naming it still find
// it. Error is the first failure; the others are still tried.
func (s *StyleService) UpdateAll() StyleInstallResult {
	idx := s.currentIndex()
	lib, err := s.lib.installed()
	if idx == nil || err != nil {
		return StyleInstallResult{Error: "offline"}
	}
	var first StyleInstallResult
	wrote := false
	for _, st := range lib {
		e := indexEntry(idx, st.ID)
		if e == nil || e.SHA256 == st.SHA256 {
			continue
		}
		data, word := s.download(e)
		if word == "" {
			st.SHA256, st.Title, st.InstalledAt = e.SHA256, e.Title, s.now()
			if err := s.lib.writeStyles(map[string][]byte{st.ID: data}, []installedStyle{st}); err != nil {
				word = "unwritable"
			} else {
				wrote = true
			}
		}
		if word != "" && first.Error == "" {
			first = StyleInstallResult{ID: st.ID, Title: st.Title, Error: word}
		}
	}
	if wrote {
		s.changed()
	}
	return first
}

// StyleText is a style's formatting XML for the window's sample.
type StyleText struct {
	XML   string `json:"xml"`
	Title string `json:"title"`
	Error string `json:"error"`
}

// PreviewStyle returns the XML that formats id, from the library when it is
// installed and otherwise downloaded and kept in memory only.
func (s *StyleService) PreviewStyle(id string) StyleText {
	if xmlText, title, ok := s.installedXML(id); ok {
		return StyleText{XML: xmlText, Title: title}
	}
	e, word := s.indexFor(id)
	if e == nil {
		return StyleText{Error: word}
	}
	target := e
	if e.Parent != nil {
		p, word := s.indexFor(*e.Parent)
		if p == nil {
			return StyleText{Title: e.Title, Error: word}
		}
		target = p
	}
	s.mu.Lock()
	data, ok := s.preview[target.ID]
	s.mu.Unlock()
	if !ok {
		var word string
		if data, word = s.download(target); word != "" {
			return StyleText{Title: e.Title, Error: word}
		}
		s.mu.Lock()
		s.preview[target.ID] = data
		s.mu.Unlock()
	}
	return StyleText{XML: string(data), Title: e.Title}
}

// installedXML reads an installed style's formatting XML: its parent's for
// a dependent style. A renamed ID finds the style under its new name.
func (s *StyleService) installedXML(id string) (xmlText, title string, ok bool) {
	lib, err := s.lib.installed()
	if err != nil {
		return "", "", false
	}
	st, found := lib[id]
	if !found {
		if idx := s.currentIndex(); idx != nil && idx.Renamed[id] != "" {
			st, found = lib[idx.Renamed[id]]
		}
	}
	if !found {
		return "", "", false
	}
	from := st.ID
	if st.Parent != "" {
		from = st.Parent
	}
	data, err := s.lib.readStyle(from)
	if err != nil {
		return "", "", false
	}
	return string(data), st.Title, true
}

// ResolvedStyle is what formats a document's `csl:` value. Installed is true
// when resolving it installed a style from the repository, and Title is
// then that style's.
type ResolvedStyle struct {
	XML       string `json:"xml"`
	Title     string `json:"title"`
	Installed bool   `json:"installed"`
	Error     string `json:"error"`
}

// ResolveStyle turns a `csl:` value that is not a bundled style into the
// XML that formats it: a .csl path (resolved against the document, and
// through its parent when it is a dependent style), an installed style, or
// one in the repository. Only with fetch is anything downloaded and
// installed; without it a style that is not installed is "not_installed",
// so a value still being typed installs nothing. Error is also unreadable,
// parent_missing, not_found, offline, busy, invalid or unwritable.
func (s *StyleService) ResolveStyle(csl, docPath string, fetch bool) ResolvedStyle {
	if strings.HasSuffix(strings.ToLower(csl), ".csl") {
		data, err := os.ReadFile(resolveAgainstDoc(csl, docPath))
		if err != nil {
			return ResolvedStyle{Error: "unreadable"}
		}
		title, parent := styleInfo(data)
		if parent == "" {
			return ResolvedStyle{XML: string(data), Title: title}
		}
		// The parent is installed only as the file's parent: the author
		// chose the file, not it.
		got := s.resolveID(parent, fetch, true)
		if got.Error == "not_installed" {
			return ResolvedStyle{Title: title, Error: "not_installed"}
		}
		if got.XML == "" {
			return ResolvedStyle{Title: title, Error: "parent_missing"}
		}
		if got.Installed {
			return got
		}
		return ResolvedStyle{XML: got.XML, Title: title}
	}
	return s.resolveID(csl, fetch, false)
}

func (s *StyleService) resolveID(id string, fetch, asParent bool) ResolvedStyle {
	if xmlText, title, ok := s.installedXML(id); ok {
		return ResolvedStyle{XML: xmlText, Title: title}
	}
	if !styleIDPattern.MatchString(id) {
		return ResolvedStyle{Error: "not_found"}
	}
	if !fetch {
		return ResolvedStyle{Error: "not_installed"}
	}
	res := s.install(id, asParent)
	if res.Error != "" {
		return ResolvedStyle{Title: res.Title, Error: res.Error}
	}
	xmlText, title, ok := s.installedXML(res.ID)
	if !ok {
		return ResolvedStyle{Title: res.Title, Error: "unwritable"}
	}
	return ResolvedStyle{XML: xmlText, Title: title, Installed: true}
}

// styleInfo reads a style's title and, for a dependent style, its parent's
// ID: the last part of the independent-parent link,
// http://www.zotero.org/styles/<id>.
func styleInfo(data []byte) (title, parent string) {
	var doc struct {
		Info struct {
			Title string `xml:"title"`
			Links []struct {
				Href string `xml:"href,attr"`
				Rel  string `xml:"rel,attr"`
			} `xml:"link"`
		} `xml:"info"`
	}
	if err := xml.NewDecoder(bytes.NewReader(data)).Decode(&doc); err != nil {
		return "", ""
	}
	for _, l := range doc.Info.Links {
		if l.Rel == "independent-parent" {
			href := strings.TrimSuffix(strings.TrimRight(l.Href, "/"), ".csl")
			parent = href[strings.LastIndex(href, "/")+1:]
		}
	}
	return strings.TrimSpace(doc.Info.Title), parent
}
