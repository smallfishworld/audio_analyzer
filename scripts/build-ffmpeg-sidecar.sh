#!/usr/bin/env bash
# Rebuild native LGPL-only FFmpeg/ffprobe from an authenticated upstream source tarball.
# Hosts: macOS clang or Windows MSYS2 UCRT64 GCC. No third-party codec dependencies.
set -euo pipefail
ROOT="$(cd "$(dirname "\${BASH_SOURCE[0]}")/.." && pwd)"
VER="9.0.2"
SRC_SHA256="8c3850283eb25fa026482078a04051e0be17347b09ef81a0849bec15a96e002e"
TARGET="\${1:?Usage: build-ffmpeg-sidecar.sh TARGET_TRIPLE}"
WORK="\${RUNNER_TEMP:-\${TMPDIR:-/tmp}}/aa-ffmpeg-\${TARGET}"
mkdir -p "$WORK" "$ROOT/src-tauri/binaries" "$ROOT/src-tauri/third-party/ffmpeg"
ARCHIVE="$WORK/ffmpeg-\${VER}.tar.xz"
if [[ ! -s "$ARCHIVE" ]]; then
  curl --fail --location --retry 3 --proto '=https' --tlsv1.2 \
    "https://ffmpeg.org/releases/ffmpeg-\${VER}.tar.xz" -o "$ARCHIVE"
fi
printf "%s  %s\n" "$SRC_SHA256" "$ARCHIVE" | sha256sum --check --status
mkdir -p "$WORK/src"
tar -xf "$ARCHIVE" -C "$WORK/src"
cd "$WORK/src/ffmpeg-\${VER}"
FLAGS=(
  "--prefix=$WORK/install"
  --disable-gpl --disable-nonfree --disable-version3
  --disable-autodetect --disable-network
  --disable-doc --disable-debug --disable-ffplay
  --disable-shared --enable-static --disable-x86asm
)
case "$TARGET" in
  x86_64-pc-windows-gnu)
    FLAGS+=(--target-os=mingw32 --arch=x86_64 --extra-ldexeflags=-static)
    SUFFIX=".exe";;
  *-apple-darwin)
    FLAGS+=(--cc=clang)
    SUFFIX="";;
  *) echo "Unsupported FFmpeg sidecar target: $TARGET" >&2; exit 1;;
esac
./configure "\${FLAGS[@]}" | tee "$WORK/configure.log"
grep -Eq '^License: LGPL' "$WORK/configure.log" || {
  echo "FFmpeg configure did not confirm LGPL" >&2; exit 1;
}
make -j "\${FFMPEG_BUILD_JOBS:-4}" ffmpeg ffprobe
DEST="$ROOT/src-tauri/third-party/ffmpeg"
for name in ffmpeg ffprobe; do
  bin="$name\${SUFFIX}"
  test -s "$bin"
  cp "$bin" "$ROOT/src-tauri/binaries/$name-$TARGET\${SUFFIX}"
  "$ROOT/src-tauri/binaries/$name-$TARGET\${SUFFIX}" -version | head -n 2
  "$ROOT/src-tauri/binaries/$name-$TARGET\${SUFFIX}" -buildconf \
    | tee "$WORK/$name-buildconf.txt"
  if "$ROOT/src-tauri/binaries/$name-$TARGET\${SUFFIX}" -buildconf \
    | grep -E -e '--enable-gpl' -e '--enable-nonfree'; then
    echo "Forbidden FFmpeg build options detected" >&2; exit 1
  fi
done
cp "$ARCHIVE" "$DEST/ffmpeg-\${VER}.tar.xz"
cp COPYING.LGPLv2.1 "$DEST/COPYING.LGPLv2.1"
cp LICENSE.md "$DEST/FFMPEG-LICENSE.md"
{
  echo "Audio Analyzer bundled FFmpeg $VER"
  echo "Source: https://ffmpeg.org/releases/ffmpeg-\${VER}.tar.xz"
  echo "Source SHA-256: $SRC_SHA256"
  echo "Target: $TARGET"
  echo "License: LGPL 2.1 or later (GPL/nonfree components disabled)"
  echo "Separate command-line tool, no linking into Rust executable."
  echo
  echo "Configure arguments:"
  printf '%s\n' "\${FLAGS[@]}"
  echo
  echo "Exact build command: bash scripts/build-ffmpeg-sidecar.sh $TARGET"
  echo "Upstream source modifications: none"
} > "$DEST/BUILD-INFO.txt"
sha256sum "$ROOT/src-tauri/binaries/ffmpeg-$TARGET\${SUFFIX}" \
          "$ROOT/src-tauri/binaries/ffprobe-$TARGET\${SUFFIX}" \
          "$DEST/ffmpeg-\${VER}.tar.xz" > "$DEST/SHA256SUMS.txt"
echo "Staged LGPL FFmpeg/ffprobe, matching source and licenses for $TARGET"
