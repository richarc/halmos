package main

import (
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"testing"
)

// emittedEventNames is every event name the package emits: the string
// literal passed first to an emit function, and the names checkDocument
// returns for the document watcher to emit.
func emittedEventNames(t *testing.T) map[string]bool {
	t.Helper()
	emitters := map[string]bool{"Emit": true, "emit": true, "emitDoc": true, "docEmit": true}
	names := map[string]bool{}
	literal := func(e ast.Expr) (string, bool) {
		lit, ok := e.(*ast.BasicLit)
		if !ok || lit.Kind != token.STRING {
			return "", false
		}
		s, err := strconv.Unquote(lit.Value)
		return s, err == nil
	}
	files, _ := filepath.Glob("*.go")
	fset := token.NewFileSet()
	for _, f := range files {
		if strings.HasSuffix(f, "_test.go") {
			continue
		}
		file, err := parser.ParseFile(fset, f, nil, 0)
		if err != nil {
			t.Fatal(err)
		}
		ast.Inspect(file, func(n ast.Node) bool {
			switch n := n.(type) {
			case *ast.CallExpr:
				var fn string
				switch f := n.Fun.(type) {
				case *ast.Ident:
					fn = f.Name
				case *ast.SelectorExpr:
					fn = f.Sel.Name
				}
				if emitters[fn] && len(n.Args) > 0 {
					if s, ok := literal(n.Args[0]); ok {
						names[s] = true
					}
				}
			case *ast.FuncDecl:
				if n.Name.Name == "checkDocument" {
					ast.Inspect(n.Body, func(m ast.Node) bool {
						if r, ok := m.(*ast.ReturnStmt); ok && len(r.Results) > 0 {
							if s, ok := literal(r.Results[0]); ok && s != "" {
								names[s] = true
							}
						}
						return true
					})
				}
			}
			return true
		})
	}
	return names
}

// registeredEvents reads events.go's RegisterEvent[T]("name") calls: name to
// the type argument as written.
func registeredEvents(t *testing.T) map[string]string {
	t.Helper()
	src, err := os.ReadFile("events.go")
	if err != nil {
		t.Fatal(err)
	}
	file, err := parser.ParseFile(token.NewFileSet(), "events.go", src, 0)
	if err != nil {
		t.Fatal(err)
	}
	reg := map[string]string{}
	ast.Inspect(file, func(n ast.Node) bool {
		call, ok := n.(*ast.CallExpr)
		if !ok || len(call.Args) != 1 {
			return true
		}
		idx, ok := call.Fun.(*ast.IndexExpr)
		if !ok {
			return true
		}
		sel, ok := idx.X.(*ast.SelectorExpr)
		if !ok || sel.Sel.Name != "RegisterEvent" {
			return true
		}
		lit, ok := call.Args[0].(*ast.BasicLit)
		if !ok {
			t.Errorf("RegisterEvent needs a constant name for the binding generator")
			return true
		}
		name, _ := strconv.Unquote(lit.Value)
		reg[name] = string(src[idx.Index.Pos()-1 : idx.Index.End()-1])
		return true
	})
	return reg
}

// Wails cancels a registered event whose data has the wrong type and warns
// about an unregistered one, so every emitted name must be registered, and
// nothing registered may be left unused.
func TestEveryEmittedEventIsRegistered(t *testing.T) {
	emitted, reg := emittedEventNames(t), registeredEvents(t)
	var missing, unused []string
	for n := range emitted {
		if _, ok := reg[n]; !ok {
			missing = append(missing, n)
		}
	}
	for n := range reg {
		if !emitted[n] {
			unused = append(unused, n)
		}
	}
	sort.Strings(missing)
	sort.Strings(unused)
	if len(missing) > 0 || len(unused) > 0 {
		t.Fatalf("not registered: %v; registered but never emitted: %v", missing, unused)
	}
}

func TestRegisteredPayloadTypes(t *testing.T) {
	reg := registeredEvents(t)
	for name, want := range map[string]string{
		"document:changed": "DiskChange",
		"document:moved":   "DocMove",
		"document:deleted": "DocDeleted",
		"portal:pairing":   "PairingEvent",
		"close:confirm":    "string",
		"file:open":        "string",
		"menu:open-recent": "string",
		"bib:changed":      "application.Void",
	} {
		if reg[name] != want {
			t.Errorf("%s registered with %q, want %q", name, reg[name], want)
		}
	}
}
