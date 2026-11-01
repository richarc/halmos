// Command checknotices fails a release whose binary links a Go module the
// licence notices do not list. The notices come from `go list -deps` during
// the frontend build (frontend/scripts/notices/plugin.ts); this checks them
// against what the finished binary reports, with `go version -m`.
//
//	go run ./internal/tools/checknotices <binary> frontend/dist/acknowledgements.json
package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"strings"
)

type notices struct {
	GeneratedBy string `json:"generatedBy"`
	Entries     []struct {
		Name   string `json:"name"`
		Origin string `json:"origin"`
	} `json:"entries"`
}

// checkNotices returns the modules on the `dep` lines of versionM that have
// no Go entry in the notices, in the order they appear.
func checkNotices(versionM string, data []byte) ([]string, error) {
	var n notices
	if err := json.Unmarshal(data, &n); err != nil {
		return nil, err
	}
	if n.GeneratedBy != "halmos-notices" {
		return nil, errors.New("not a licence notices file")
	}
	listed := map[string]bool{}
	for _, e := range n.Entries {
		if e.Origin == "go" {
			listed[e.Name] = true
		}
	}
	var missing []string
	for _, line := range strings.Split(versionM, "\n") {
		f := strings.Fields(line)
		if len(f) >= 2 && f[0] == "dep" && !listed[f[1]] {
			missing = append(missing, f[1])
		}
	}
	return missing, nil
}

func main() {
	if len(os.Args) != 3 {
		fmt.Fprintln(os.Stderr, "usage: checknotices <binary> <acknowledgements.json>")
		os.Exit(2)
	}
	out, err := exec.Command("go", "version", "-m", os.Args[1]).Output()
	if err != nil {
		fmt.Fprintln(os.Stderr, "go version -m:", err)
		os.Exit(1)
	}
	data, err := os.ReadFile(os.Args[2])
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	missing, err := checkNotices(string(out), data)
	if err != nil {
		fmt.Fprintln(os.Stderr, os.Args[2]+":", err)
		os.Exit(1)
	}
	if len(missing) > 0 {
		fmt.Fprintln(os.Stderr, "The binary links Go modules the licence notices do not list:", strings.Join(missing, ", "))
		os.Exit(1)
	}
}
