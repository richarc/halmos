package main

import (
	"embed"
	"encoding/json"
	"io/fs"
)

// The tutorial bundled with the app: docs/tutorial/ itself, the same files
// the portal serves, used offline, on any error, and when the portal's
// tutorial needs a newer editor.
//
//go:embed docs/tutorial
var tutorialFS embed.FS

// tutorialContent is a tutorial ready to write: from the portal or from
// the bundle. Order is the manifest's, entry first.
type tutorialContent struct {
	Revision string
	Entry    string
	Source   string // "online" or "bundled"
	Files    map[string][]byte
	Order    []string
}

// bundledTutorial reads docs/tutorial/tutorial.json and the files it lists,
// with the checks a manifest gets.
func bundledTutorial(version string) (*tutorialContent, error) {
	root, err := fs.Sub(tutorialFS, "docs/tutorial")
	if err != nil {
		return nil, err
	}
	raw, err := fs.ReadFile(root, "tutorial.json")
	if err != nil {
		return nil, err
	}
	var desc struct {
		Entry string   `json:"entry"`
		Files []string `json:"files"`
	}
	if err := json.Unmarshal(raw, &desc); err != nil {
		return nil, err
	}
	files := make(map[string][]byte, len(desc.Files))
	for _, name := range desc.Files {
		if err := checkTutorialName(name); err != nil {
			return nil, err
		}
		data, err := fs.ReadFile(root, name)
		if err != nil {
			return nil, err
		}
		files[name] = data
	}
	if err := checkTutorialNames(desc.Entry, desc.Files, func(i int) int64 { return int64(len(files[desc.Files[i]])) }); err != nil {
		return nil, err
	}
	if version == "" {
		version = "dev"
	}
	return &tutorialContent{Revision: "bundled-" + version, Entry: desc.Entry, Source: "bundled", Files: files, Order: desc.Files}, nil
}
