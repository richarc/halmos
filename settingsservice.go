package main

import "reflect"

// SettingsService is the frontend's and the menu's way to the preferences in
// settingsStore (settings.go). DocumentService reads the same store for
// printing and export.
type SettingsService struct {
	settings *settingsStore
}

func NewSettingsService(store *settingsStore) *SettingsService {
	return &SettingsService{settings: store}
}

// Settings returns every persisted preference. Values are always valid: a
// missing or malformed file, and any field outside its allowed set, read back
// as that field's default.
func (s *SettingsService) Settings() Settings {
	return s.settings.get()
}

// UpdateSettings persists the given preferences and returns an error if they
// could not be written, so a caller can tell the user the choice did not
// stick. Out-of-range values are normalised rather than rejected.
func (s *SettingsService) UpdateSettings(next Settings) error {
	return s.settings.set(next)
}

// ChangeSettings writes only the fields where next differs from base, onto
// the stored value. base is what the caller read, next what it wants, so a
// setting changed in between (from the menu, say) is kept.
func (s *SettingsService) ChangeSettings(base, next Settings) error {
	return s.settings.update(func(cur *Settings) {
		b, n, c := reflect.ValueOf(base), reflect.ValueOf(next), reflect.ValueOf(cur).Elem()
		for i := 0; i < n.NumField(); i++ {
			if n.Field(i).Interface() != b.Field(i).Interface() {
				c.Field(i).Set(n.Field(i))
			}
		}
	})
}

// updateSettings is the menu's change of one setting, applied to the stored
// value under the store's lock.
func (s *SettingsService) updateSettings(change func(*Settings)) error {
	return s.settings.update(change)
}
