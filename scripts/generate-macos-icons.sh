#!/usr/bin/env bash
# Generate native macOS .icns from the reproducible 1024px application icon.
# Run on macOS after: npm run prepare:icons
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "macOS icon generation requires sips and iconutil on a Mac" >&2
  exit 1
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE="$ROOT/src-tauri/icons/1024x1024.png"
TARGET="$ROOT/src-tauri/icons/icon.icns"

if [[ ! -f "$SOURCE" ]]; then
  echo "Icon source missing: $SOURCE (run npm run prepare:icons)" >&2
  exit 1
fi

WORK="$(mktemp -d "${TMPDIR:-/tmp}/audio-analyzer-icons.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT
ICONSET="$WORK/AudioAnalyzer.iconset"
mkdir -p "$ICONSET"

create_icon() {
  local pixels="$1" filename="$2"
  sips -s format png -z "$pixels" "$pixels" "$SOURCE" --out "$ICONSET/$filename" >/dev/null
}

create_icon 16 icon_16x16.png
create_icon 32 icon_16x16@2x.png
create_icon 32 icon_32x32.png
create_icon 64 icon_32x32@2x.png
create_icon 128 icon_128x128.png
create_icon 256 icon_128x128@2x.png
create_icon 256 icon_256x256.png
create_icon 512 icon_256x256@2x.png
create_icon 512 icon_512x512.png
create_icon 1024 icon_512x512@2x.png

iconutil -c icns -o "$TARGET" "$ICONSET"
test -s "$TARGET"
echo "Generated macOS app icon: $TARGET"
