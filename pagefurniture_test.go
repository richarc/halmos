package main

import (
	"strings"
	"testing"
)

func TestPageFurnitureNormalisedIsOneLine(t *testing.T) {
	got := PageFurniture{
		Header: "  {title}\n\tdraft\x00 ",
		Footer: "Page {page}\r\nof {pages}",
		Title:  "A\u2028Title",
	}.normalised()
	want := PageFurniture{Header: "{title} draft", Footer: "Page {page} of {pages}", Title: "A Title"}
	if got != want {
		t.Fatalf("got %+v, want %+v", got, want)
	}
}

func TestPageFurnitureNormalisedCapsTheLength(t *testing.T) {
	got := PageFurniture{Header: strings.Repeat("é", 500)}.normalised()
	if n := len([]rune(got.Header)); n != maxFurnitureRunes {
		t.Fatalf("header is %d runes, want %d", n, maxFurnitureRunes)
	}
}

func TestPageFurnitureEmpty(t *testing.T) {
	if !(PageFurniture{Title: "T"}).empty() {
		t.Fatal("a title alone draws nothing")
	}
	if (PageFurniture{Footer: "{page}"}).empty() {
		t.Fatal("a footer is something to draw")
	}
}
