package main

import (
	"path/filepath"
	"reflect"
	"testing"
	"time"
)

func strp(s string) *string { return &s }

func TestLibraryWriteThenRead(t *testing.T) {
	lib := &styleLibrary{dir: filepath.Join(t.TempDir(), "styles")}
	at := time.Date(2026, 10, 29, 9, 0, 0, 0, time.UTC)
	err := lib.writeStyles(
		map[string][]byte{"a": []byte("<style>a</style>"), "b": []byte("<style>b</style>")},
		[]installedStyle{{ID: "a", Title: "A", SHA256: "1", InstalledAt: at}, {ID: "b", Title: "B", SHA256: "2", InstalledAt: at}},
	)
	if err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"a", "b"} {
		data, err := lib.readStyle(id)
		if err != nil || string(data) != "<style>"+id+"</style>" {
			t.Fatalf("%s: %q %v", id, data, err)
		}
	}
	got, err := lib.installed()
	if err != nil || len(got) != 2 || !got["a"].InstalledAt.Equal(at) || got["b"].Title != "B" {
		t.Fatalf("installed %+v %v", got, err)
	}
}

func TestLibraryEmpty(t *testing.T) {
	lib := &styleLibrary{dir: filepath.Join(t.TempDir(), "styles")}
	got, err := lib.installed()
	if err != nil || len(got) != 0 {
		t.Fatalf("%v %v", got, err)
	}
	if _, err := lib.readStyle("nature"); err == nil {
		t.Fatal("read a style that is not there")
	}
}

func TestLibraryKeepsChosenOverParent(t *testing.T) {
	lib := &styleLibrary{dir: t.TempDir()}
	now := time.Now()
	if err := lib.writeStyles(map[string][]byte{"nature": []byte("n")},
		[]installedStyle{{ID: "nature", Title: "Nature", SHA256: "1", InstalledAt: now}}); err != nil {
		t.Fatal(err)
	}
	if err := lib.writeStyles(map[string][]byte{"nature": []byte("n"), "nature-communications": []byte("nc")},
		[]installedStyle{
			{ID: "nature-communications", Title: "Nature Communications", Parent: "nature", SHA256: "2", InstalledAt: now},
			{ID: "nature", Title: "Nature", SHA256: "1", InstalledAt: now, AsParent: true},
		}); err != nil {
		t.Fatal(err)
	}
	got, _ := lib.installed()
	if got["nature"].AsParent || got["nature-communications"].Parent != "nature" {
		t.Fatalf("%+v", got)
	}
}

func TestLibraryIndexCache(t *testing.T) {
	lib := &styleLibrary{dir: t.TempDir()}
	if data, _, _, err := lib.cachedIndex(); err == nil || data != nil {
		t.Fatal("empty cache read something")
	}
	t1 := time.Date(2026, 10, 29, 9, 0, 0, 0, time.UTC)
	if err := lib.storeIndex([]byte(`{"version":1}`), `"e1"`, t1); err != nil {
		t.Fatal(err)
	}
	data, etag, at, err := lib.cachedIndex()
	if err != nil || string(data) != `{"version":1}` || etag != `"e1"` || !at.Equal(t1) {
		t.Fatalf("%q %q %v %v", data, etag, at, err)
	}
	t2 := t1.Add(2 * time.Hour)
	if err := lib.touchIndex(t2); err != nil {
		t.Fatal(err)
	}
	data, etag, at, _ = lib.cachedIndex()
	if string(data) != `{"version":1}` || etag != `"e1"` || !at.Equal(t2) {
		t.Fatalf("after touch %q %q %v", data, etag, at)
	}
}

func searchIndex() *styleIndexDoc {
	return &styleIndexDoc{Version: 1, Styles: []styleEntry{
		{ID: "bmj", Title: "BMJ", TitleShort: strp("BMJ"), Format: strp("numeric"), Fields: []string{"medicine"}, SHA256: "1"},
		{ID: "nature", Title: "Nature", Format: strp("numeric"), Fields: []string{"science", "generic-base"}, SHA256: "2"},
		{ID: "nature-communications", Title: "Nature Communications", Parent: strp("nature"), Format: strp("numeric"), Fields: []string{"science"}, SHA256: "3"},
		{ID: "natural-hazards", Title: "Natural Hazards", Format: strp("author-date"), Fields: []string{"geology"}, SHA256: "4"},
		{ID: "the-lancet", Title: "The Lancet", TitleShort: strp("Lancet"), Format: strp("numeric"), Fields: []string{"medicine"}, SHA256: "5"},
	}, Renamed: map[string]string{"old-nature": "nature"}}
}

func ids(results []StyleSummary) []string {
	out := []string{}
	for _, r := range results {
		out = append(out, r.ID)
	}
	return out
}

func TestSearchRanking(t *testing.T) {
	idx := searchIndex()
	cases := map[string][]string{
		"nature":  {"nature", "nature-communications"},
		"Nature":  {"nature", "nature-communications"},
		"lancet":  {"the-lancet"},
		"bmj":     {"bmj"},
		"comm":    {"nature-communications"},
		"natur":   {"natural-hazards", "nature", "nature-communications"},
		"hazards": {"natural-hazards"},
		"unicorn": {},
	}
	for q, want := range cases {
		got, total := searchStyles(idx, nil, q, "", "", 100)
		if !reflect.DeepEqual(ids(got), want) || total != len(want) {
			t.Errorf("%q: got %v (%d), want %v", q, ids(got), total, want)
		}
	}
	// An exact abbreviation outranks a title that merely starts with it.
	idx.Styles = append(idx.Styles, styleEntry{ID: "lancet-oncology", Title: "Lancet Oncology", SHA256: "6"})
	got, _ := searchStyles(idx, nil, "lancet", "", "", 100)
	if !reflect.DeepEqual(ids(got), []string{"the-lancet", "lancet-oncology"}) {
		t.Errorf("abbreviation rank: %v", ids(got))
	}
}

func TestSearchFiltersAndLimit(t *testing.T) {
	idx := searchIndex()
	got, _ := searchStyles(idx, nil, "", "medicine", "", 100)
	if !reflect.DeepEqual(ids(got), []string{"bmj", "the-lancet"}) {
		t.Errorf("field: %v", ids(got))
	}
	got, _ = searchStyles(idx, nil, "", "", "author-date", 100)
	if !reflect.DeepEqual(ids(got), []string{"natural-hazards"}) {
		t.Errorf("format: %v", ids(got))
	}
	got, total := searchStyles(idx, nil, "", "", "numeric", 2)
	if len(got) != 2 || total != 4 {
		t.Errorf("limit: %d of %d", len(got), total)
	}
}

func TestSearchEmptyQueryInstalledFirst(t *testing.T) {
	lib := map[string]installedStyle{
		"the-lancet": {ID: "the-lancet", SHA256: "5"},
		"nature":     {ID: "nature", SHA256: "2", AsParent: true},
	}
	got, _ := searchStyles(searchIndex(), lib, "", "", "", 100)
	want := []string{"the-lancet", "bmj", "natural-hazards", "nature", "nature-communications"}
	if !reflect.DeepEqual(ids(got), want) {
		t.Fatalf("got %v", ids(got))
	}
	if !got[0].Installed || !got[3].Installed {
		t.Fatal("installed not marked")
	}
}

func TestSearchMarksParentAndUpdate(t *testing.T) {
	lib := map[string]installedStyle{"bmj": {ID: "bmj", SHA256: "old"}}
	got, _ := searchStyles(searchIndex(), lib, "", "", "", 100)
	byID := map[string]StyleSummary{}
	for _, s := range got {
		byID[s.ID] = s
	}
	nc := byID["nature-communications"]
	if nc.Parent != "nature" || nc.ParentTitle != "Nature" || nc.Format != "numeric" || !reflect.DeepEqual(nc.Fields, []string{"science"}) {
		t.Errorf("dependent: %+v", nc)
	}
	if !byID["bmj"].Update || byID["the-lancet"].Update || byID["bmj"].TitleShort != "BMJ" {
		t.Errorf("update: %+v", byID["bmj"])
	}
}

func TestStyleFields(t *testing.T) {
	want := []string{"generic-base", "geology", "medicine", "science"}
	if got := styleFields(searchIndex()); !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v", got)
	}
}

func TestHasUpdateFollowsRename(t *testing.T) {
	idx := searchIndex()
	if !hasUpdate(idx, installedStyle{ID: "old-nature", SHA256: "x"}) {
		t.Error("renamed with a different sha")
	}
	if hasUpdate(idx, installedStyle{ID: "old-nature", SHA256: "2"}) {
		t.Error("renamed with the same sha")
	}
}

func TestHasUpdateRemovedUpstream(t *testing.T) {
	if hasUpdate(searchIndex(), installedStyle{ID: "gone", SHA256: "x"}) {
		t.Fatal("removed style offered an update")
	}
}
