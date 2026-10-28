package main

import (
	"strings"
	"sync"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// Command is one menu action as the command palette lists it. Path is the
// top menu's name followed by any submenu names, without the item's own
// label; Accelerator is Wails' display form ("Cmd+Shift+T"), or "" for none.
type Command struct {
	ID            string   `json:"id"`
	Path          []string `json:"path"`
	Label         string   `json:"label"`
	Accelerator   string   `json:"accelerator"`
	Checked       bool     `json:"checked"`
	NeedsDocument bool     `json:"needsDocument"`
	Detail        string   `json:"detail"`
}

// commandOpts are the optional parts of a registration. id overrides the
// default id, which is the path and label joined by " › "; it is needed
// where the label alone does not tell two items apart (Open Recent).
type commandOpts struct {
	needsDocument bool
	id            string
	detail        string
}

type commandEntry struct {
	id            string
	path          []string
	item          *application.MenuItem
	fn            func()
	needsDocument bool
	detail        string
}

// commandSet collects the actions of one menu build. The menu item is kept,
// not copied, so its label, accelerator, checked and enabled state are read
// when the set is listed, after any later SetChecked or SetEnabled.
type commandSet struct {
	entries []*commandEntry
	byID    map[string]*commandEntry
}

func newCommandSet() *commandSet {
	return &commandSet{byID: map[string]*commandEntry{}}
}

// item makes fn the menu item's click action and records it for the palette,
// so the menu and the palette run the same function. It returns it.
func (s *commandSet) item(it *application.MenuItem, path []string, fn func(), o commandOpts) *application.MenuItem {
	path = append([]string(nil), path...)
	id := o.id
	if id == "" {
		id = strings.Join(append(append([]string(nil), path...), it.Label()), " › ")
	}
	e := &commandEntry{id: id, path: path, item: it, fn: fn, needsDocument: o.needsDocument, detail: o.detail}
	s.entries = append(s.entries, e)
	s.byID[id] = e
	it.OnClick(func(*application.Context) { fn() })
	return it
}

// commandRegistry holds the command set of the menu currently installed. A
// menu rebuild builds a new set and swaps it in with replace.
type commandRegistry struct {
	mu  sync.Mutex
	set *commandSet
}

func (r *commandRegistry) replace(s *commandSet) {
	r.mu.Lock()
	r.set = s
	r.mu.Unlock()
}

// list returns the enabled commands in registration order.
func (r *commandRegistry) list() []Command {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := []Command{}
	if r.set == nil {
		return out
	}
	for _, e := range r.set.entries {
		if !e.item.Enabled() {
			continue
		}
		out = append(out, Command{
			ID:            e.id,
			Path:          append([]string(nil), e.path...),
			Label:         e.item.Label(),
			Accelerator:   e.item.GetAccelerator(),
			Checked:       e.item.Checked(),
			NeedsDocument: e.needsDocument,
			Detail:        e.detail,
		})
	}
	return out
}

// run calls the action registered under id and reports whether there was
// one. The action runs outside the lock, since it may rebuild the menu and
// so call replace.
func (r *commandRegistry) run(id string) bool {
	r.mu.Lock()
	var fn func()
	if r.set != nil {
		if e, ok := r.set.byID[id]; ok {
			fn = e.fn
		}
	}
	r.mu.Unlock()
	if fn == nil {
		return false
	}
	fn()
	return true
}
