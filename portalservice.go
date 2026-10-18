package main

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// PortalService is the frontend's way to the Halmos portal: connecting this
// Mac to the person's account, reading who it is connected as, and
// exporting to Word or LaTeX through the portal's Pandoc. Tokens and device
// codes never leave Go; the frontend sees only what it shows.
type PortalService struct {
	auth    *portalAuth
	emit    func(name string, data any)
	openURL func(url string) error

	// mu guards the pairing in progress. gen counts StartPairing and
	// CancelPairing calls, so a start that was cancelled or overtaken while
	// it waited for its code never begins polling.
	mu     sync.Mutex
	cancel context.CancelFunc
	gen    int
}

// NewPortalService talks to the production portal, or in a development
// build to HALMOS_PORTAL_URL. An override that is not a bare https origin
// leaves the service refusing every call rather than guessing.
func NewPortalService() *PortalService {
	origin, err := portalOrigin()
	var auth *portalAuth
	if err != nil {
		log.Printf("portal: %v", err)
	} else {
		auth = newPortalAuth(newPortalClient(origin, appVersion()), newKeychainStore(portalKeychainService))
	}
	return newPortalServiceWith(auth,
		func(name string, data any) { application.Get().Event.Emit(name, data) },
		func(u string) error { return application.Get().Browser.OpenURL(u) })
}

func newPortalServiceWith(auth *portalAuth, emit func(string, any), openURL func(string) error) *PortalService {
	return &PortalService{auth: auth, emit: emit, openURL: openURL}
}

var errMisconfigured = &PortalError{Code: "misconfigured"}

// AccountInfo is what Account… shows. Error is set when the account could
// not be read (offline, rate limited); SignedIn still says whether this Mac
// holds a credential.
type AccountInfo struct {
	SignedIn     bool   `json:"signedIn"`
	Email        string `json:"email"`
	Organisation string `json:"organisation"`
	SeatSource   string `json:"seatSource"`
	SeatStatus   string `json:"seatStatus"`
	DeviceName   string `json:"deviceName"`
	// PricingURL is the portal's pricing page, for "No subscription".
	PricingURL string       `json:"pricingURL"`
	Error      *PortalError `json:"error"`
}

type meResponse struct {
	User struct {
		Email string `json:"email"`
	} `json:"user"`
	Organisation *struct {
		Name string `json:"name"`
	} `json:"organisation"`
	Seat *struct {
		Source string `json:"source"`
		Status string `json:"status"`
	} `json:"seat"`
	Device struct {
		Name string `json:"name"`
	} `json:"device"`
}

// Account reads GET /me. Which seat pays can change between calls, so it is
// read each time rather than cached.
func (s *PortalService) Account() AccountInfo {
	if s.auth == nil {
		return AccountInfo{Error: errMisconfigured}
	}
	cred, ok, perr := s.auth.credential()
	if perr != nil {
		return AccountInfo{Error: perr}
	}
	if !ok {
		return AccountInfo{}
	}
	data, perr := s.auth.authedDo(context.Background(), "GET", "/me", nil, portalTimeout)
	if perr != nil {
		if perr.Code == "reauth" || perr.Code == "signed_out" {
			return AccountInfo{}
		}
		return AccountInfo{SignedIn: true, DeviceName: cred.DeviceName, Error: perr}
	}
	var me meResponse
	if err := json.Unmarshal(data, &me); err != nil {
		return AccountInfo{SignedIn: true, DeviceName: cred.DeviceName, Error: &PortalError{Status: 200, Code: "server_error"}}
	}
	info := AccountInfo{SignedIn: true, Email: me.User.Email, DeviceName: me.Device.Name,
		PricingURL: s.auth.client.origin + "/pricing"}
	if info.DeviceName == "" {
		info.DeviceName = cred.DeviceName
	}
	if me.Organisation != nil {
		info.Organisation = me.Organisation.Name
	}
	if me.Seat != nil {
		info.SeatSource, info.SeatStatus = me.Seat.Source, me.Seat.Status
	}
	return info
}

// PairingInfo is what the connect dialog shows while it waits. The device
// code stays in Go.
type PairingInfo struct {
	UserCode        string       `json:"userCode"`
	VerificationURL string       `json:"verificationURL"`
	ExpiresIn       int          `json:"expiresIn"`
	Error           *PortalError `json:"error"`
}

// PairingEvent is the payload of portal:pairing. State is approved, denied,
// expired or failed; Email is set on approval.
type PairingEvent struct {
	State string       `json:"state"`
	Email string       `json:"email,omitempty"`
	Error *PortalError `json:"error,omitempty"`
}

// StartPairing asks the portal for a code, opens its approval page in the
// browser and polls in the background, reporting the end with a
// portal:pairing event. A pairing already running is cancelled first.
func (s *PortalService) StartPairing() PairingInfo {
	if s.auth == nil {
		return PairingInfo{Error: errMisconfigured}
	}
	gen := s.cancelPairing()
	p, perr := s.auth.startPairing(context.Background(), deviceName(computerName(), rand.Reader))
	if perr != nil {
		return PairingInfo{Error: perr}
	}
	if !sameOrigin(p.VerificationURIComplete, s.auth.client.origin) {
		return PairingInfo{Error: errMisconfigured}
	}
	ctx, cancel := context.WithCancel(context.Background())
	s.mu.Lock()
	if s.gen != gen {
		// Cancelled, or another Connect started, while the code was asked for.
		s.mu.Unlock()
		cancel()
		return PairingInfo{Error: &PortalError{Code: "cancelled"}}
	}
	s.cancel = cancel
	s.mu.Unlock()
	if err := s.openURL(p.VerificationURIComplete); err != nil {
		log.Printf("portal: opening the approval page: %v", err)
	}
	go func() {
		defer cancel()
		_, perr := s.auth.pollPairing(ctx, p)
		switch {
		case perr == nil:
			ev := PairingEvent{State: "approved"}
			if info := s.Account(); info.Error == nil {
				ev.Email = info.Email
			}
			s.emit("portal:pairing", ev)
		case perr.Code == "cancelled":
		case perr.Code == "access_denied":
			s.emit("portal:pairing", PairingEvent{State: "denied"})
		case perr.Code == "expired_token":
			s.emit("portal:pairing", PairingEvent{State: "expired"})
		default:
			s.emit("portal:pairing", PairingEvent{State: "failed", Error: perr})
		}
	}()
	return PairingInfo{UserCode: p.UserCode, VerificationURL: p.VerificationURIComplete, ExpiresIn: p.ExpiresIn}
}

// CancelPairing stops polling, and any start still waiting for its code.
// Nothing is emitted for a cancel.
func (s *PortalService) CancelPairing() { s.cancelPairing() }

// cancelPairing is CancelPairing, returning the new generation.
func (s *PortalService) cancelPairing() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.gen++
	if s.cancel != nil {
		s.cancel()
		s.cancel = nil
	}
	return s.gen
}

// SignOut forgets this Mac's credential. The device stays listed on the
// portal until the person removes it there.
func (s *PortalService) SignOut() error {
	if s.auth == nil {
		return errMisconfigured
	}
	s.CancelPairing()
	return s.auth.signOut()
}

// OpenPortalURL opens a URL the portal sent (a pricing, billing or approval
// page) only if it is on the origin being talked to.
func (s *PortalService) OpenPortalURL(url string) *PortalError {
	if s.auth == nil || !sameOrigin(url, s.auth.client.origin) {
		return errMisconfigured
	}
	if err := s.openURL(url); err != nil {
		return &PortalError{Code: "network"}
	}
	return nil
}

// pandocExportTarget is where the export panel opens and the name it
// offers: beside the document — a .tex names its images by their paths, so
// it belongs there — named after it.
func pandocExportTarget(format, docPath string) (dir, name string) {
	ext := ".docx"
	if format == "latex" {
		ext = ".tex"
	}
	if docPath == "" {
		return "", "Untitled" + ext
	}
	base := filepath.Base(docPath)
	return filepath.Dir(docPath), strings.TrimSuffix(base, filepath.Ext(base)) + ext
}

// ChooseExportPath asks where File → Export Word… or Export LaTeX… should
// write, before anything is sent: a cancelled save sends nothing. "" means
// cancelled.
func (s *PortalService) ChooseExportPath(format, docPath string) (string, error) {
	dir, name := pandocExportTarget(format, docPath)
	title, filter, pattern := "Export Word", "Word documents", "*.docx"
	if format == "latex" {
		title, filter, pattern = "Export LaTeX", "LaTeX files", "*.tex"
	}
	dialog := application.Get().Dialog.SaveFile().
		SetMessage(title).
		SetFilename(name).
		AddFilter(filter, pattern)
	if dir != "" {
		dialog = dialog.SetDirectory(dir)
	}
	return dialog.PromptForSingleSelection()
}

// maxExportImageBytes is the portal's per-image limit (decoded).
const maxExportImageBytes = 8 << 20

// ExportImage is one image beside the document, for a Word export. Mime is
// detected from the bytes, except SVG, which the frontend rasterises.
type ExportImage struct {
	Base64 string `json:"base64"`
	Mime   string `json:"mime"`
	Error  string `json:"error"`
}

// ReadExportImage reads an image the document references, resolved the way
// the preview resolves it. Error is not_found, too_large or unreadable.
func (s *PortalService) ReadExportImage(docPath, src string) ExportImage {
	path, ok := localImagePath(src, docPath)
	if !ok {
		return ExportImage{Error: "not_found"}
	}
	info, err := os.Stat(path)
	if err != nil || info.IsDir() {
		return ExportImage{Error: "not_found"}
	}
	if info.Size() > maxExportImageBytes {
		return ExportImage{Error: "too_large"}
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return ExportImage{Error: "unreadable"}
	}
	mime := http.DetectContentType(data)
	if strings.EqualFold(filepath.Ext(path), ".svg") {
		mime = "image/svg+xml"
	}
	return ExportImage{Base64: base64.StdEncoding.EncodeToString(data), Mime: mime}
}

// ConvertRequest is POST /services/convert's body. Optional fields are left
// out when empty.
type ConvertRequest struct {
	Format       string            `json:"format"`
	Markdown     string            `json:"markdown"`
	Bibliography string            `json:"bibliography,omitempty"`
	CSL          string            `json:"csl,omitempty"`
	Images       map[string]string `json:"images,omitempty"`
}

// Export converts the document and writes the result to path, atomically,
// like a save. It returns nil on success.
func (s *PortalService) Export(path string, req ConvertRequest) *PortalError {
	if s.auth == nil {
		return errMisconfigured
	}
	if req.Format == "latex" {
		req.Images = nil // the portal refuses images with LaTeX
	}
	data, perr := s.auth.authedDo(context.Background(), "POST", "/services/convert", req, portalConvertTimeout)
	if perr != nil {
		return perr
	}
	var out struct {
		ContentBase64 string `json:"content_base64"`
	}
	if err := json.Unmarshal(data, &out); err != nil {
		return &PortalError{Status: 200, Code: "server_error"}
	}
	content, err := base64.StdEncoding.DecodeString(out.ContentBase64)
	if err != nil || len(content) == 0 {
		return &PortalError{Status: 200, Code: "server_error"}
	}
	if err := writeFileAtomic(path, content, 0o644); err != nil {
		return &PortalError{Code: "write_failed"}
	}
	return nil
}

// revealCommand selects a file in Finder.
func revealCommand(path string) []string { return []string{"open", "-R", path} }

// RevealExport shows an exported file in Finder (the toast's Show in
// Finder). Wails' Browser.OpenFile opens a file or folder, but cannot select
// one inside its folder.
func (s *PortalService) RevealExport(path string) error {
	c := revealCommand(path)
	return exec.Command(c[0], c[1:]...).Start()
}
