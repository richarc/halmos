package main

import (
	"errors"
	"sync"
	"testing"
)

func TestMemoryStore(t *testing.T) {
	s := &memoryStore{}
	if _, ok, err := s.Load("https://a"); ok || err != nil {
		t.Fatalf("empty Load = ok %v, err %v", ok, err)
	}
	c := storedCredential{RefreshToken: "r1", DeviceID: 4, DeviceName: "Mac · ABCD"}
	if err := s.Save("https://a", c); err != nil {
		t.Fatal(err)
	}
	got, ok, err := s.Load("https://a")
	if !ok || err != nil || got != c {
		t.Fatalf("Load = %+v %v %v", got, ok, err)
	}
	if _, ok, _ := s.Load("https://b"); ok {
		t.Error("credentials must be kept per origin")
	}
	if err := s.Delete("https://a"); err != nil {
		t.Fatal(err)
	}
	if _, ok, _ := s.Load("https://a"); ok {
		t.Error("Delete left the credential")
	}
	s.failSave = true
	if err := s.Save("https://a", c); err == nil {
		t.Error("failSave must make Save fail")
	}
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
