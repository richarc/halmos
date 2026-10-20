package main

import (
	"errors"
	"sync"
)

// storedCredential is what pairing leaves behind: the refresh token that
// keeps this Mac signed in to the portal, and the device it names. It lives
// in the Keychain only (keychain_darwin.go), never in settings.json — the
// refresh token is a long-lived credential for the person's account and any
// seat they hold (docs/api/device-flow.md in the portal, "What the
// credentials disclose").
type storedCredential struct {
	RefreshToken string `json:"refreshToken"`
	DeviceID     int    `json:"deviceId"`
	DeviceName   string `json:"deviceName"`
}

// credentialStore keeps one credential per portal origin, so a token issued
// by a development portal is never sent to production, or the reverse.
type credentialStore interface {
	Load(origin string) (storedCredential, bool, error)
	Save(origin string, c storedCredential) error
	Delete(origin string) error
}

// memoryStore is the test double. failSave makes Save fail, to show a
// rotated token that could not be kept is never used.
type memoryStore struct {
	mu       sync.Mutex
	items    map[string]storedCredential
	failSave bool
	// failSaves fails that many Saves, then succeeds: a Keychain hiccup.
	failSaves int
}

func (m *memoryStore) Load(origin string) (storedCredential, bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	c, ok := m.items[origin]
	return c, ok, nil
}

func (m *memoryStore) Save(origin string, c storedCredential) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.failSave {
		return errors.New("memoryStore: save refused")
	}
	if m.failSaves > 0 {
		m.failSaves--
		return errors.New("memoryStore: save refused once")
	}
	if m.items == nil {
		m.items = map[string]storedCredential{}
	}
	m.items[origin] = c
	return nil
}

func (m *memoryStore) Delete(origin string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.items, origin)
	return nil
}
