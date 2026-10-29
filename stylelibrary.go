package main

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// styleLibrary is the folder of citation styles installed from the CSL
// repository, <data>/hermes/styles: one <id>.csl per style, library.json
// describing them, and the cached index (index.json, index-meta.json).
type styleLibrary struct {
	dir string
}

// installedStyle is one library.json entry. AsParent is true while the
// style is there only because a dependent style needs it; such a style is
// not offered in the Citation Style menu.
type installedStyle struct {
	ID          string    `json:"id"`
	Title       string    `json:"title"`
	Parent      string    `json:"parent,omitempty"`
	SHA256      string    `json:"sha256"`
	InstalledAt time.Time `json:"installedAt"`
	AsParent    bool      `json:"asParent,omitempty"`
}

type styleIndexMeta struct {
	ETag      string    `json:"etag"`
	FetchedAt time.Time `json:"fetchedAt"`
}

func (l *styleLibrary) path(name string) string { return filepath.Join(l.dir, name) }

func (l *styleLibrary) ensureDir() error { return os.MkdirAll(l.dir, 0o700) }

// installed reads library.json; a library never written is empty.
func (l *styleLibrary) installed() (map[string]installedStyle, error) {
	data, err := os.ReadFile(l.path("library.json"))
	if errors.Is(err, os.ErrNotExist) {
		return map[string]installedStyle{}, nil
	}
	if err != nil {
		return nil, err
	}
	var list []installedStyle
	if err := json.Unmarshal(data, &list); err != nil {
		return nil, err
	}
	out := make(map[string]installedStyle, len(list))
	for _, st := range list {
		out[st.ID] = st
	}
	return out, nil
}

func (l *styleLibrary) readStyle(id string) ([]byte, error) {
	if !styleIDPattern.MatchString(id) {
		return nil, os.ErrNotExist
	}
	return os.ReadFile(l.path(id + ".csl"))
}

// writeStyles writes every file, then library.json with entries merged in,
// so an interrupted install leaves no entry naming a file that is not there.
// A style the author chose stays chosen when it is installed again as a
// parent.
func (l *styleLibrary) writeStyles(files map[string][]byte, entries []installedStyle) error {
	if err := l.ensureDir(); err != nil {
		return err
	}
	current, err := l.installed()
	if err != nil {
		return err
	}
	for id, data := range files {
		if !styleIDPattern.MatchString(id) {
			return errors.New("bad style id")
		}
		if err := writeFileAtomic(l.path(id+".csl"), data, 0o600); err != nil {
			return err
		}
	}
	for _, e := range entries {
		if old, ok := current[e.ID]; ok && !old.AsParent {
			e.AsParent = false
		}
		current[e.ID] = e
	}
	list := make([]installedStyle, 0, len(current))
	for _, st := range current {
		list = append(list, st)
	}
	sort.Slice(list, func(i, j int) bool { return list[i].ID < list[j].ID })
	data, err := json.MarshalIndent(list, "", "  ")
	if err != nil {
		return err
	}
	return writeFileAtomic(l.path("library.json"), data, 0o600)
}

func (l *styleLibrary) cachedIndex() (data []byte, etag string, fetchedAt time.Time, err error) {
	data, err = os.ReadFile(l.path("index.json"))
	if err != nil {
		return nil, "", time.Time{}, err
	}
	var meta styleIndexMeta
	if raw, err := os.ReadFile(l.path("index-meta.json")); err == nil {
		_ = json.Unmarshal(raw, &meta)
	}
	return data, meta.ETag, meta.FetchedAt, nil
}

func (l *styleLibrary) storeIndex(data []byte, etag string, fetchedAt time.Time) error {
	if err := l.ensureDir(); err != nil {
		return err
	}
	if err := writeFileAtomic(l.path("index.json"), data, 0o600); err != nil {
		return err
	}
	return l.writeMeta(styleIndexMeta{ETag: etag, FetchedAt: fetchedAt})
}

// touchIndex records a 304: the cached index is current as of fetchedAt.
func (l *styleLibrary) touchIndex(fetchedAt time.Time) error {
	_, etag, _, err := l.cachedIndex()
	if err != nil {
		return err
	}
	return l.writeMeta(styleIndexMeta{ETag: etag, FetchedAt: fetchedAt})
}

func (l *styleLibrary) writeMeta(meta styleIndexMeta) error {
	data, err := json.Marshal(meta)
	if err != nil {
		return err
	}
	return writeFileAtomic(l.path("index-meta.json"), data, 0o600)
}

// StyleSummary is one style as the Find a Style window shows it.
type StyleSummary struct {
	ID          string   `json:"id"`
	Title       string   `json:"title"`
	TitleShort  string   `json:"titleShort"`
	Format      string   `json:"format"`
	Fields      []string `json:"fields"`
	Parent      string   `json:"parent"`
	ParentTitle string   `json:"parentTitle"`
	Installed   bool     `json:"installed"`
	Update      bool     `json:"update"`
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

// styleRank says how well a style matches a lowercased query, lower being
// better; -1 is no match. The ID or abbreviation exactly, then a title that
// starts with it, then a title word that does, then anywhere.
func styleRank(st *styleEntry, q string) int {
	title := strings.ToLower(st.Title)
	short := strings.ToLower(deref(st.TitleShort))
	switch {
	case st.ID == q || (short != "" && short == q):
		return 0
	case strings.HasPrefix(title, q):
		return 1
	}
	for _, w := range strings.FieldsFunc(title, func(r rune) bool {
		return r == ' ' || r == '-' || r == '(' || r == ')' || r == ':' || r == ',' || r == '/'
	}) {
		if strings.HasPrefix(w, q) {
			return 2
		}
	}
	if strings.Contains(title, q) || strings.Contains(st.ID, q) || strings.Contains(short, q) {
		return 3
	}
	return -1
}

func hasField(st *styleEntry, field string) bool {
	for _, f := range st.Fields {
		if f == field {
			return true
		}
	}
	return false
}

// searchStyles returns the best limit matches and how many matched in all.
// An empty query puts the chosen installed styles first, then the rest.
func searchStyles(idx *styleIndexDoc, lib map[string]installedStyle, query, field, format string, limit int) ([]StyleSummary, int) {
	q := strings.ToLower(strings.TrimSpace(query))
	titles := make(map[string]string, len(idx.Styles))
	for i := range idx.Styles {
		titles[idx.Styles[i].ID] = idx.Styles[i].Title
	}
	type hit struct {
		st   *styleEntry
		rank int
	}
	var hits []hit
	for i := range idx.Styles {
		st := &idx.Styles[i]
		if field != "" && !hasField(st, field) {
			continue
		}
		if format != "" && deref(st.Format) != format {
			continue
		}
		rank := 0
		if q != "" {
			rank = styleRank(st, q)
			if rank < 0 {
				continue
			}
		} else if inst, ok := lib[st.ID]; !ok || inst.AsParent {
			rank = 1
		}
		hits = append(hits, hit{st, rank})
	}
	sort.SliceStable(hits, func(i, j int) bool {
		a, b := hits[i], hits[j]
		if a.rank != b.rank {
			return a.rank < b.rank
		}
		at, bt := strings.ToLower(a.st.Title), strings.ToLower(b.st.Title)
		if at != bt {
			return at < bt
		}
		return a.st.ID < b.st.ID
	})
	total := len(hits)
	if len(hits) > limit {
		hits = hits[:limit]
	}
	out := make([]StyleSummary, 0, len(hits))
	for _, h := range hits {
		st := h.st
		fields := st.Fields
		if fields == nil {
			fields = []string{}
		}
		s := StyleSummary{
			ID: st.ID, Title: st.Title, TitleShort: deref(st.TitleShort), Format: deref(st.Format),
			Fields: fields, Parent: deref(st.Parent),
		}
		s.ParentTitle = titles[s.Parent]
		if inst, ok := lib[st.ID]; ok {
			s.Installed = true
			s.Update = inst.SHA256 != st.SHA256
		}
		out = append(out, s)
	}
	return out, total
}

// styleFields lists every field in the index once, sorted.
func styleFields(idx *styleIndexDoc) []string {
	seen := map[string]bool{}
	out := []string{}
	for _, st := range idx.Styles {
		for _, f := range st.Fields {
			if !seen[f] {
				seen[f] = true
				out = append(out, f)
			}
		}
	}
	sort.Strings(out)
	return out
}

// indexEntry finds a style by ID, or by the ID it was renamed to.
func indexEntry(idx *styleIndexDoc, id string) *styleEntry {
	for _, want := range []string{id, idx.Renamed[id]} {
		if want == "" {
			continue
		}
		// Linear, not a binary search: the contract sorts by id, but a
		// lookup that silently misses on an unsorted index is not worth it.
		for i := range idx.Styles {
			if idx.Styles[i].ID == want {
				return &idx.Styles[i]
			}
		}
	}
	return nil
}

// hasUpdate is true when the repository's copy of an installed style has
// changed. A style removed upstream has none.
func hasUpdate(idx *styleIndexDoc, st installedStyle) bool {
	e := indexEntry(idx, st.ID)
	return e != nil && e.SHA256 != st.SHA256
}
