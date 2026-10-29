package main

import "testing"

// The real docs/tutorial/ passes the checks a manifest gets, so a bad name
// or a missing file fails here rather than on a user's first run.
func TestBundledTutorialIsValid(t *testing.T) {
	c, err := bundledTutorial("0.16.0")
	if err != nil {
		t.Fatal(err)
	}
	if c.Revision != "bundled-0.16.0" || c.Entry != "getting-started.md" || c.Source != "bundled" {
		t.Fatalf("got %+v", c)
	}
	if len(c.Order) == 0 || c.Order[0] != c.Entry {
		t.Fatalf("order %v", c.Order)
	}
	for _, name := range c.Order {
		if len(c.Files[name]) == 0 {
			t.Errorf("%s is empty or missing", name)
		}
	}
	if d, _ := bundledTutorial(""); d == nil || d.Revision != "bundled-dev" {
		t.Errorf("no version: %+v", d)
	}
}
