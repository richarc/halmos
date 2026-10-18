package main

import (
	"bytes"
	"strings"
	"testing"
	"unicode/utf8"
)

func TestDeviceName(t *testing.T) {
	rnd := func() *bytes.Reader { return bytes.NewReader([]byte{0, 1, 2, 31}) }
	if got := deviceName("Craig's MacBook Pro", rnd()); got != "Craig's MacBook Pro · ABC9" {
		t.Errorf("got %q", got)
	}
	if got := deviceName("  Lab​  Mac‮\tB\x07 ", rnd()); got != "Lab Mac B · ABC9" {
		t.Errorf("cleaned = %q", got)
	}
	long := strings.Repeat("é", 100)
	got := deviceName(long, rnd())
	if utf8.RuneCountInString(got) != 80 || !strings.HasSuffix(got, " · ABC9") {
		t.Errorf("long name = %q (%d runes)", got, utf8.RuneCountInString(got))
	}
	if got := deviceName(" ​ ", rnd()); got != "Mac · ABC9" {
		t.Errorf("empty = %q", got)
	}
	for _, r := range deviceName("x", bytes.NewReader([]byte{200, 77, 9, 255}))[len("x · "):] {
		if !strings.ContainsRune(deviceSuffixAlphabet, r) {
			t.Errorf("suffix rune %q not in the alphabet", r)
		}
	}
}
