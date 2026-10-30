#!/usr/bin/env bash
# Build a standard macOS drag-and-drop DMG from Tauri's signed .app.
# GitHub macOS runners sometimes return hdiutil exit 49168 (Resource busy).
# Reattempt only disk-image creation, not the full Rust/FFmpeg build.
set -euo pipefail

APP="${1:?Usage: package-macos-dmg.sh APP_PATH OUTPUT_DMG}"
DMG="${2:?Usage: package-macos-dmg.sh APP_PATH OUTPUT_DMG}"
[[ "$(uname -s)" == "Darwin" ]] || { echo "macOS required" >&2; exit 1; }
[[ -d "$APP" && "${APP##*.}" == "app" ]] || { echo "Not a .app bundle: $APP" >&2; exit 1; }
command -v hdiutil >/dev/null
command -v ditto >/dev/null

# Stage the entire signed app intact plus conventional Applications shortcut.
STAGE="$(mktemp -d "${TMPDIR:-/tmp}/audio-analyzer-dmg.XXXXXX")"
trap 'rm -rf "$STAGE"' EXIT
ditto "$APP" "$STAGE/$(basename "$APP")"
ln -s /Applications "$STAGE/Applications"

mkdir -p "$(dirname "$DMG")"
rm -f "$DMG"
sync

# Avoid Tauri's Finder/AppleScript-backed DMG wrapper and transient disk image
# collisions. There is no need to resign the app after DMG creation.
for attempt in 1 2 3 4 5 6; do
  echo "Creating macOS DMG (attempt $attempt/6)"
  rm -f "$DMG"
  if hdiutil create \
      -srcfolder "$STAGE" \
      -volname "Audio Analyzer" \
      -format UDZO \
      -fs HFS+ \
      -nospotlight \
      -ov "$DMG"; then
    test -s "$DMG"
    hdiutil verify "$DMG"
    echo "Verified DMG: $DMG"
    exit 0
  fi
  echo "::warning::macOS image generation attempt $attempt failed."
  hdiutil info || true
  sync
  sleep "$((attempt * 5))"
done
echo "::error::Could not create a valid macOS DMG after six attempts" >&2
exit 1
