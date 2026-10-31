package main

import (
	"encoding/json"
	"errors"
	"io/fs"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// FileError is a file binding's error with a code the frontend can branch
// on, so it never has to read an os error's text. It reaches the frontend
// as the rejected call's cause, through marshalError.
type FileError struct {
	Code string `json:"code"` // not-found, permission, exists, not-bibliography, other
	Path string `json:"path"`
	Err  error  `json:"-"`
}

func (e *FileError) Error() string { return e.Err.Error() }
func (e *FileError) Unwrap() error { return e.Err }

// fileError wraps err with its code; nil stays nil.
func fileError(err error, path string) error {
	if err == nil {
		return nil
	}
	code := "other"
	switch {
	case errors.Is(err, fs.ErrNotExist):
		code = "not-found"
	case errors.Is(err, fs.ErrPermission):
		code = "permission"
	case errors.Is(err, fs.ErrExist):
		code = "exists"
	case errors.Is(err, errNotBibliography):
		code = "not-bibliography"
	}
	return &FileError{Code: code, Path: path, Err: err}
}

// marshalError is each service's MarshalError: a FileError or PortalError anywhere
// in the chain becomes the cause the frontend reads. Anything else returns
// nil, which leaves it to Wails' default.
func marshalError(err error) []byte {
	var fe *FileError
	var pe *PortalError
	var v any
	switch {
	case errors.As(err, &fe):
		v = fe
	case errors.As(err, &pe):
		v = pe
	default:
		return nil
	}
	b, jerr := json.Marshal(v)
	if jerr != nil {
		return nil
	}
	return b
}

// serviceOptions is given to every service in main.go. Wails reads
// MarshalError from each service's options (Bindings.Add), never from the
// app's, so this is the only place it takes effect.
var serviceOptions = application.ServiceOptions{MarshalError: marshalError}
