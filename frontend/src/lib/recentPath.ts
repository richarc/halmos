// The start screen lists each recent file by name, with its folder on the
// line below. Folders under the home folder read as ~/…, the way Finder and
// the shell abbreviate them. Plain string work on '/': this runs in the
// webview, and recent paths are always absolute macOS paths from Go.
export function splitRecent(path: string, home: string): { name: string; folder: string } {
  const cut = path.lastIndexOf('/')
  const name = path.slice(cut + 1)
  const folder = cut <= 0 ? '/' : path.slice(0, cut)

  const h = home.endsWith('/') ? home.slice(0, -1) : home
  if (h === '') return { name, folder }
  if (folder === h) return { name, folder: '~' }
  if (folder.startsWith(h + '/')) return { name, folder: '~' + folder.slice(h.length) }
  return { name, folder }
}
