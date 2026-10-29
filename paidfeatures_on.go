//go:build !nopaid

package main

// paidFeatures decides whether the app offers what needs a Halmos account:
// Account… in the app menu, and Export Word… and Export LaTeX…, which convert
// through the portal. Off in release builds until v1.1.0 switches billing on
// (`wails3 task release` builds with the nopaid tag, paidfeatures_off.go); on
// here, in development builds, so that work can still be built and tested.
// Only the menu items go: the code stays in the build, and a Mac already
// paired keeps its Keychain item untouched.
const paidFeatures = true
