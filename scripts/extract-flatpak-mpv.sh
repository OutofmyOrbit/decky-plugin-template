#!/bin/bash
# Extracts mpv + its shared library dependencies out of the mpv Flatpak
# (io.mpv.Mpv, must already be installed) into a standalone bundle that runs
# directly as a subprocess - no `flatpak run` / bubblewrap sandbox involved.
#
# Run this ON THE STEAM DECK (or another machine with the Flatpak installed),
# then copy the bundle's contents into this repo's bin/ folder:
#   scp -r deck@<ip>:~/mpv-bundle/* ./bin/
#
# Usage: bash extract-flatpak-mpv.sh
set -euo pipefail

APP_ID="io.mpv.Mpv"
OUT="$HOME/mpv-bundle"
MPV_BINARY="mpv-bin"

if ! command -v flatpak >/dev/null; then
  echo "flatpak not found" >&2
  exit 1
fi
if ! flatpak info "$APP_ID" >/dev/null 2>&1; then
  echo "$APP_ID is not installed. Install it first: flatpak install flathub $APP_ID" >&2
  exit 1
fi

rm -rf "$OUT"
mkdir -p "$OUT/lib"

APP_FILES="$(flatpak info --show-location "$APP_ID")/files"
METADATA="$(dirname "$APP_FILES")/metadata"
RUNTIME_REF="$(grep '^runtime=' "$METADATA" | cut -d= -f2)"
RUNTIME_FILES="$(flatpak info --show-location "$RUNTIME_REF")/files"

echo "app files:     $APP_FILES"
echo "runtime ref:   $RUNTIME_REF"
echo "runtime files: $RUNTIME_FILES"

if [ ! -x "$APP_FILES/bin/$MPV_BINARY" ]; then
  echo "mpv binary not found at $APP_FILES/bin/$MPV_BINARY" >&2
  exit 1
fi
cp "$APP_FILES/bin/$MPV_BINARY" "$OUT/mpv.bin"
chmod +x "$OUT/mpv.bin"

# Resolve dependencies using ldd run *inside* the sandbox, so the paths and
# symbol versions match exactly what mpv sees when Flatpak actually runs it.
# `set -e` is relaxed here because ldd exits non-zero for static binaries.
set +e
LDD_OUT="$(flatpak run --command=ldd "$APP_ID" "/app/bin/$MPV_BINARY" 2>&1)"
LDD_STATUS=$?
set -e
echo "--- ldd output ---"
echo "$LDD_OUT"
echo "------------------"

if [ $LDD_STATUS -ne 0 ] || echo "$LDD_OUT" | grep -qi "not a dynamic executable"; then
  echo "mpv is a static binary (no shared library dependencies) - shipping it standalone."
  mv "$OUT/mpv.bin" "$OUT/mpv"
  chmod +x "$OUT/mpv"
  rmdir "$OUT/lib" 2>/dev/null || true

  echo
  echo "Bundle written to $OUT"
  echo "Test it directly (should print a version, with no flatpak/sandbox involved):"
  echo "  $OUT/mpv --version"
  echo "Then test real audio, e.g.: $OUT/mpv --no-video /path/to/some/audio/file"
  echo
  echo "Once it works, copy it into this repo's bin/ folder:"
  echo "  $OUT/mpv  ->  bin/mpv"
  exit 0
fi

LIBRARY_COUNT=0
while IFS= read -r path; do
  [ -z "$path" ] && continue
  name="${path##*/}"
  if [[ "$path" == *ld-linux* ]]; then
    destination="$OUT/ld.so"
  else
    destination="$OUT/lib/$name"
  fi
  if flatpak run --command=cat "$APP_ID" "$path" > "$destination"; then
    LIBRARY_COUNT=$((LIBRARY_COUNT + 1))
    echo "Bundled $path"
  else
    rm -f "$destination"
    echo "WARN: unable to extract $path" >&2
  fi
done < <(printf '%s\n' "$LDD_OUT" | sed -nE \
  -e 's|.*=> ([^ ]*/[^ ]+).*|\1|p' \
  -e 's|^[[:space:]]*([^[:space:]]*/[^[:space:]]+)[[:space:]]+\(0x.*|\1|p' | sort -u)

if [ "$LIBRARY_COUNT" -eq 0 ]; then
  echo "No shared libraries were extracted; bundle is incomplete." >&2
  exit 1
fi

if [ ! -f "$OUT/ld.so" ]; then
  echo "Could not locate the dynamic linker (ld-linux*) - bundle is incomplete." >&2
  exit 1
fi
chmod +x "$OUT/ld.so"

cat > "$OUT/mpv" <<'WRAP'
#!/bin/bash
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "$HERE/ld.so" --library-path "$HERE/lib" "$HERE/mpv.bin" "$@"
WRAP
chmod +x "$OUT/mpv"

echo
echo "Bundle written to $OUT"
echo "Test it directly (should print a version, with no flatpak/sandbox involved):"
echo "  $OUT/mpv --version"
echo "Then test real audio, e.g.: $OUT/mpv --no-video /path/to/some/audio/file"
echo
echo "Once it works, copy its contents into this repo's bin/ folder:"
echo "  $OUT/mpv $OUT/mpv.bin $OUT/ld.so $OUT/lib/  ->  bin/"
