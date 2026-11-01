package main

import (
	"reflect"
	"testing"
)

const versionM = `bin/Halmos Editor: go1.26.10
	path	hermes
	mod	hermes	(devel)
	dep	github.com/adrg/xdg	v0.5.3	h1:xRnxJXne7+oWDatRhR1JLnvuccuIeCoBu2rtuLqQB78=
	dep	github.com/wailsapp/wails/v3	v3.0.0
	=>	../wails/v3	(devel)
	dep	golang.org/x/sys	v0.1.0	h1:abc=
	build	-tags=production,nopaid
`

func noticesJSON(names ...string) []byte {
	s := `{"generatedBy":"halmos-notices","entries":[`
	for i, n := range names {
		if i > 0 {
			s += ","
		}
		s += `{"name":"` + n + `","version":"v","origin":"go"}`
	}
	return []byte(s + "]}")
}

func TestCheckNoticesReportsAModuleWithNoEntry(t *testing.T) {
	got, err := checkNotices(versionM, noticesJSON("golang.org/x/sys", "github.com/wailsapp/wails/v3"))
	if err != nil {
		t.Fatal(err)
	}
	if want := []string{"github.com/adrg/xdg"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("missing = %v, want %v", got, want)
	}
}

func TestCheckNoticesPassesWhenAllListed(t *testing.T) {
	got, err := checkNotices(versionM, noticesJSON("golang.org/x/sys", "github.com/wailsapp/wails/v3", "github.com/adrg/xdg"))
	if err != nil || len(got) != 0 {
		t.Fatalf("missing = %v, err = %v; want none", got, err)
	}
}

func TestCheckNoticesRefusesSomethingElse(t *testing.T) {
	if _, err := checkNotices(versionM, []byte(`{"entries":[]}`)); err == nil {
		t.Fatal("want an error for a file that is not the notices")
	}
}
