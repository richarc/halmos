package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// maxPaletteRecents is how many recently run commands the palette offers.
const maxPaletteRecents = 5

// CommandList is what the palette shows: every enabled menu command, and
// the ids of the commands run from the palette most recently, newest first.
type CommandList struct {
	Commands []Command `json:"commands"`
	Recent   []string  `json:"recent"`
}

// CommandService is the command palette's binding: it lists the menu's
// commands and runs one by id.
type CommandService struct {
	reg  *commandRegistry
	path string
	// invoke runs a command's action; application.InvokeSync in the app,
	// so menu actions run on the main thread as they do from a click.
	invoke func(func())

	mu         sync.Mutex
	recent     []string
	recentRead bool
}

func newCommandService(reg *commandRegistry, dataDir string) *CommandService {
	return &CommandService{
		reg:    reg,
		path:   filepath.Join(dataDir, "palette-recents.json"),
		invoke: application.InvokeSync,
	}
}

// Commands lists the enabled commands and the recent ids.
func (c *CommandService) Commands() CommandList {
	c.mu.Lock()
	recent := append([]string{}, c.loadRecent()...)
	c.mu.Unlock()
	return CommandList{Commands: c.reg.list(), Recent: recent}
}

// RunCommand runs the command with the given id and reports whether it
// exists. A command that ran moves to the front of the recents.
func (c *CommandService) RunCommand(id string) bool {
	var ran bool
	c.invoke(func() { ran = c.reg.run(id) })
	if !ran {
		return false
	}

	c.mu.Lock()
	defer c.mu.Unlock()
	next := []string{id}
	for _, r := range c.loadRecent() {
		if r != id && len(next) < maxPaletteRecents {
			next = append(next, r)
		}
	}
	c.recent = next
	if data, err := json.Marshal(next); err == nil {
		if err := os.MkdirAll(filepath.Dir(c.path), 0o755); err == nil {
			_ = writeFileAtomic(c.path, data, 0o644)
		}
	}
	return true
}

// loadRecent reads the recents file the first time it is needed. A missing,
// empty or unreadable file is an empty list. c.mu must be held.
func (c *CommandService) loadRecent() []string {
	if c.recentRead {
		return c.recent
	}
	c.recentRead = true
	data, err := os.ReadFile(c.path)
	if err != nil {
		return nil
	}
	var ids []string
	if json.Unmarshal(data, &ids) != nil {
		return nil
	}
	if len(ids) > maxPaletteRecents {
		ids = ids[:maxPaletteRecents]
	}
	c.recent = ids
	return c.recent
}
