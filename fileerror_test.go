package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"path/filepath"
	"testing"
)

func TestFileErrorCodes(t *testing.T) {
	path := func(err error) error { return &fs.PathError{Op: "open", Path: "/x", Err: err} }
	for _, c := range []struct {
		err  error
		code string
	}{
		{path(fs.ErrNotExist), "not-found"},
		{path(fs.ErrPermission), "permission"},
		{path(fs.ErrExist), "exists"},
		{errNotBibliography, "not-bibliography"},
		{fmt.Errorf("wrapped: %w", errNotBibliography), "not-bibliography"},
		{errors.New("disk on fire"), "other"},
	} {
		var fe *FileError
		if !errors.As(fileError(c.err, "/x"), &fe) || fe.Code != c.code || fe.Path != "/x" {
			t.Errorf("%v: got %+v, want %s", c.err, fe, c.code)
		}
		if !errors.Is(fileError(c.err, "/x"), c.err) {
			t.Errorf("%v: the original error must stay reachable", c.err)
		}
	}
	if fileError(nil, "/x") != nil {
		t.Error("nil must stay nil")
	}
}

func TestMarshalErrorFileError(t *testing.T) {
	got := marshalError(fmt.Errorf("saving: %w", fileError(fs.ErrPermission, "/a/b.md")))
	var v map[string]any
	if err := json.Unmarshal(got, &v); err != nil {
		t.Fatalf("%s: %v", got, err)
	}
	if v["code"] != "permission" || v["path"] != "/a/b.md" {
		t.Fatalf("got %s", got)
	}
	if marshalError(errors.New("plain")) != nil {
		t.Error("a plain error is left to Wails' default")
	}
}

func TestOpenPathMissingFileIsNotFound(t *testing.T) {
	s := newTestService(t)
	_, err := s.OpenPath(filepath.Join(t.TempDir(), "gone.md"))
	var fe *FileError
	if !errors.As(err, &fe) || fe.Code != "not-found" {
		t.Fatalf("got %v", err)
	}
}
