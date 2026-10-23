package main

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

// localImageRoute is the path renderer.ts rewrites a document-local image
// source to. It carries the document and the source as separate query
// parameters rather than a pre-resolved path, so the join happens here
// against resolveAgainstDoc — the same resolution ReadBibliography uses —
// instead of being reimplemented in TypeScript where the two would drift.
const localImageRoute = "/_hermes/image"

// localImages serves images that live beside the user's document.
//
// The webview loads the embedded frontend bundle, so a document-relative
// `<img src>` would otherwise resolve against that bundle and 404 — which is
// exactly what it did until this route existed. Everything that is not this
// route falls through untouched; the middleware sits in front of every asset
// request and must stay invisible to all of them.
func localImages(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != localImageRoute {
			next.ServeHTTP(w, r)
			return
		}

		query := r.URL.Query()
		path, mime, ok := localImageFile(query.Get("src"), query.Get("doc"))
		if !ok {
			http.NotFound(w, r)
			return
		}
		// The type comes from the allowlist, never from sniffing the bytes,
		// and the policy gives a document opened from here (an SVG, say) no
		// script, no requests and no same-origin access.
		w.Header().Set("Content-Type", mime)
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox")

		// The URL does not change when the file is edited in another
		// application, so the webview must ask again every time it needs the
		// image — but it need not be sent the bytes every time. no-cache
		// makes it revalidate, and ServeFile answers a revalidation of an
		// unchanged file (If-Modified-Since against the mtime it emits as
		// Last-Modified) with a 304 and no body. no-store, which this was,
		// forbade keeping a copy at all, so every render of a changed block
		// re-read the file and re-transferred it.
		w.Header().Set("Cache-Control", "no-cache")
		http.ServeFile(w, r, path)
	})
}

// localImagePath resolves an image source against the document holding it, or
// reports false when it cannot be resolved.
//
// Split from the handler so the resolution rules are reachable by a test
// without an HTTP round trip — the same reason quitRequest is separate from
// the menu closure it serves.
//
// The rules are deliberately the bibliography's: a relative source joins the
// document's folder, an absolute one stands, and `..` is allowed, because a
// figures directory shared between papers is an ordinary layout and images
// should not be stricter than `bibliography:` is.
func localImagePath(src, doc string) (string, bool) {
	if src == "" {
		return "", false
	}
	// A relative source has nothing to resolve against until the document has
	// been saved somewhere. renderer.ts does not rewrite in that case, so this
	// is the belt to its braces.
	if !filepath.IsAbs(src) && doc == "" {
		return "", false
	}
	return resolveAgainstDoc(src, doc), true
}

// imageTypes is everything the route serves, and the export readers read, by
// extension: the formats WebKit displays in an <img>, PDF included, because
// PDF figures are ordinary in papers written alongside LaTeX. A file with no
// extension is not served; sniffing would let any file's bytes decide.
var imageTypes = map[string]string{
	".png":  "image/png",
	".jpg":  "image/jpeg",
	".jpeg": "image/jpeg",
	".gif":  "image/gif",
	".webp": "image/webp",
	".svg":  "image/svg+xml",
	".avif": "image/avif",
	".bmp":  "image/bmp",
	".tif":  "image/tiff",
	".tiff": "image/tiff",
	".heic": "image/heic",
	".heif": "image/heif",
	".apng": "image/apng",
	".jfif": "image/jpeg",
	".ico":  "image/x-icon",
	".jxl":  "image/jxl",
	".pdf":  "application/pdf",
}

// localImageFile resolves an image source the way localImagePath does and
// reports the file to read and its type, or false for anything that is not
// an image.
//
// The route answers whatever the preview asks for, and a document can come
// from anyone, so resolution alone is not enough: `..` and absolute paths are
// allowed (a shared figures folder is ordinary), which without this would
// let a document name any file on disk. Both the name asked for and the file
// a symlink leads to must be images, so an image-named link to a private file
// is refused, and the real path is what gets read.
func localImageFile(src, doc string) (path, mime string, ok bool) {
	asked, ok := localImagePath(src, doc)
	if !ok {
		return "", "", false
	}
	if _, ok := imageTypes[strings.ToLower(filepath.Ext(asked))]; !ok {
		return "", "", false
	}
	real, err := filepath.EvalSymlinks(asked)
	if err != nil {
		return "", "", false
	}
	mime, ok = imageTypes[strings.ToLower(filepath.Ext(real))]
	if !ok {
		return "", "", false
	}
	if info, err := os.Stat(real); err != nil || !info.Mode().IsRegular() {
		return "", "", false
	}
	return real, mime, true
}
