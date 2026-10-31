package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/wailsapp/wails/v3/pkg/application"
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

// wrapsFileError is a binding whose error carries context around a
// FileError, the way any binding may come to.
type wrapsFileError struct{}

func (*wrapsFileError) Fail() error {
	return fmt.Errorf("saving paper.md: %w", fileError(fs.ErrPermission, "/a/paper.md"))
}

// Wails reads MarshalError from each service's options, not from the app's,
// so the code reaches the frontend only through serviceOptions.
func TestWrappedFileErrorReachesTheFrontendAsCause(t *testing.T) {
	testApp()
	b := application.NewBindings(nil, nil)
	if err := b.Add(application.NewServiceWithOptions(&wrapsFileError{}, serviceOptions)); err != nil {
		t.Fatal(err)
	}
	m := b.Get(&application.CallOptions{MethodName: "hermes.wrapsFileError.Fail"})
	if m == nil {
		t.Fatal("method not bound")
	}
	_, err := m.Call(context.Background(), nil)
	var cerr *application.CallError
	if !errors.As(err, &cerr) {
		t.Fatalf("got %v", err)
	}
	cause, _ := json.Marshal(cerr.Cause)
	var v map[string]any
	if json.Unmarshal(cause, &v) != nil || v["code"] != "permission" {
		t.Fatalf("cause %s", cause)
	}
}

// Every service main.go registers carries serviceOptions.
func TestEveryServiceCarriesTheErrorMarshaller(t *testing.T) {
	src, err := os.ReadFile("main.go")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(src), "application.NewService(") {
		t.Error("main.go registers a service without serviceOptions")
	}
	if n := strings.Count(string(src), ", serviceOptions)"); n < 8 {
		t.Errorf("%d services carry serviceOptions, want all 8", n)
	}
}
