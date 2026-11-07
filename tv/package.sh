#!/usr/bin/env bash
# Builds the Samsung Tizen and LG webOS apps: the launcher page
# (tv/launcher) plus each platform's manifest and icons, into tv/dist.
#   tv/dist/webos/   → ares-package → app.rivo.tv_<ver>_all.ipk
#   tv/dist/tizen/   → tizen package -t wgt (needs a Samsung certificate)
# With VERSION set (CI passes the tag) the manifests carry that version.
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
OUT=$HERE/dist
VERSION=${VERSION:-0.1.0}
rm -rf "$OUT" && mkdir -p "$OUT/webos" "$OUT/tizen"

cp "$HERE/launcher/index.html" "$HERE/webos/icon.png" "$HERE/webos/largeIcon.png" "$OUT/webos/"
sed "s/\"version\": \"[^\"]*\"/\"version\": \"$VERSION\"/" "$HERE/webos/appinfo.json" > "$OUT/webos/appinfo.json"

cp "$HERE/launcher/index.html" "$HERE/tizen/icon.png" "$OUT/tizen/"
# Tizen pages reach webapis (the TV's own IP for the scan) through this script.
sed -i 's|<title>Rivo</title>|<title>Rivo</title>\n<script src="$WEBAPIS/webapis/webapis.js"></script>|' "$OUT/tizen/index.html"
sed "s/ version=\"[^\"]*\" viewmodes/ version=\"$VERSION\" viewmodes/" "$HERE/tizen/config.xml" > "$OUT/tizen/config.xml"

if command -v ares-package >/dev/null 2>&1; then
  ares-package "$OUT/webos" -o "$OUT"
fi
(cd "$OUT/tizen" && zip -qr ../Rivo-tizen-unsigned.zip .)
echo "built $OUT"
ls -1 "$OUT"
