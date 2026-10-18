package main

import (
	"io"
	"os"
	"os/exec"
	"strings"
	"unicode"
)

// deviceSuffixAlphabet has 32 letters and digits, with the look-alikes
// (I, O, 0, 1) left out, so a byte modulo 32 picks one without bias.
const deviceSuffixAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

const maxDeviceNameRunes = 80

// deviceName is the name this Mac asks to be connected as: its Computer
// Name and a short random suffix. The portal refuses a name the person
// already has among their live devices, and the editor cannot remove a
// device when it signs out, so without the suffix connecting again would
// collide with the old device. Cleaned to the portal's rules: no control,
// bidirectional-override or zero-width characters, whitespace collapsed, at
// most 80 characters.
func deviceName(computer string, rnd io.Reader) string {
	var b strings.Builder
	for _, r := range computer {
		if unicode.IsSpace(r) {
			b.WriteRune(' ')
			continue
		}
		if unicode.IsControl(r) || isInvisible(r) {
			continue
		}
		b.WriteRune(r)
	}
	name := strings.Join(strings.Fields(b.String()), " ")
	if name == "" {
		name = "Mac"
	}
	suffix := make([]byte, 4)
	buf := make([]byte, 4)
	_, _ = io.ReadFull(rnd, buf)
	for i, v := range buf {
		suffix[i] = deviceSuffixAlphabet[int(v)%len(deviceSuffixAlphabet)]
	}
	tail := " · " + string(suffix)
	keep := maxDeviceNameRunes - len([]rune(tail))
	if runes := []rune(name); len(runes) > keep {
		name = strings.TrimSpace(string(runes[:keep]))
	}
	return name + tail
}

// isInvisible reports bidirectional controls and zero-width characters,
// which the portal refuses in a device name.
func isInvisible(r rune) bool {
	switch {
	case r >= 0x202A && r <= 0x202E, r >= 0x2066 && r <= 0x2069,
		r == 0x200E, r == 0x200F, r == 0x061C,
		r >= 0x200B && r <= 0x200D, r == 0x2060, r == 0xFEFF:
		return true
	}
	return unicode.Is(unicode.Cf, r)
}

// computerName is the Mac's name as set in System Settings → General →
// Sharing, falling back to the host name.
func computerName() string {
	if out, err := exec.Command("scutil", "--get", "ComputerName").Output(); err == nil {
		if s := strings.TrimSpace(string(out)); s != "" {
			return s
		}
	}
	h, _ := os.Hostname()
	return h
}
