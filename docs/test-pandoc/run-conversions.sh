#!/usr/bin/env bash
#
# Step 6 of the saas-06-pandoc walk: converts test-document.md through the
# release running behind the tunnel (hermesportal's bin/release-e2e), once per
# bundled citation style, once with a custom style if given, and once to LaTeX.
#
#   ./run-conversions.sh                  # the five bundled styles + LaTeX
#   ./run-conversions.sh my-style.csl     # … plus a custom (independent) style
#
# Before running: bin/release-e2e is up and pandoc-server answers, and the
# simulator is paired against the tunnel (bin/halmos-sim pair, with the same
# two variables this script sets).
#
# Results go in out/. The server allows 6 conversions a minute per seat, so
# the script waits between them; the whole run takes about a minute and a half.
# Compile the LaTeX from this folder, so the images resolve:
#
#   latexmk -pdf -outdir=out out/test-document.tex
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
PORTAL="${HERMESPORTAL_DIR:-$HOME/Development/hermesportal}"
SIM="$PORTAL/bin/halmos-sim"
CSL_DIR="$HERE/../../frontend/src/assets/csl"
DOC="$HERE/test-document.md"
BIB="$HERE/zotero-export-text.bib"
OUT="$HERE/out"
PAUSE=12

die() { printf '\033[31mrun-conversions: %s\033[0m\n' "$*" >&2; exit 1; }
say() { printf '\n\033[36m== %s\033[0m\n' "$*"; }

[[ -x "$SIM" ]] || die "no simulator at $SIM (set HERMESPORTAL_DIR)"
[[ -f "$DOC" && -f "$BIB" ]] || die "test-document.md or zotero-export-text.bib is missing"
custom="${1:-}"
[[ -z "$custom" || -f "$custom" ]] || die "no such file: $custom"
[[ -z "$custom" || "$custom" == /* ]] || custom="$PWD/$custom"

# The tunnel hostname, read from hermesportal's .env rather than sourced.
if [[ -z "${HALMOS_SIM_BASE_URL:-}" ]]; then
  host="$(grep -E '^PADDLE_TUNNEL_HOSTNAME=' "$PORTAL/.env" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d "\"' ")"
  [[ -n "$host" ]] || die "PADDLE_TUNNEL_HOSTNAME is not set in $PORTAL/.env"
  export HALMOS_SIM_BASE_URL="https://$host" HALMOS_SIM_ALLOW_HOST="$host"
fi

status="$("$SIM" status 2>&1)" || die "$status"
echo "$status"
[[ "$status" == *"paired as"* ]] ||
  die "not paired: run  HALMOS_SIM_BASE_URL=$HALMOS_SIM_BASE_URL HALMOS_SIM_ALLOW_HOST=${HALMOS_SIM_ALLOW_HOST:-} $SIM pair"

mkdir -p "$OUT"
passed=() failed=()
first=1

# convert NAME FORMAT [CSL] — one conversion; the simulator writes beside the
# markdown, so the result is moved into out/ under NAME.
convert() {
  local name="$1" format="$2" csl="${3:-}" ext=docx
  [[ "$format" == latex ]] && ext=tex
  ((first)) || sleep "$PAUSE"
  first=0
  say "$name"
  if "$SIM" call convert "$DOC" --bib "$BIB" ${csl:+--csl "$csl"} --format "$format" &&
    mv "${DOC%.md}.$ext" "$OUT/$name.$ext"; then
    passed+=("$name.$ext")
  else
    failed+=("$name")
  fi
}

for style in apa chicago-author-date harvard-cite-them-right ieee vancouver; do
  convert "test-document-$style" docx "$CSL_DIR/$style.csl"
done
[[ -z "$custom" ]] || convert "test-document-custom" docx "$custom"
convert "test-document" latex "$CSL_DIR/apa.csl"

say "done"
echo "written to $OUT: ${passed[*]:-nothing}"
if ((${#failed[@]})); then
  echo "failed: ${failed[*]}"
  exit 1
fi
