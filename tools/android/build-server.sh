#!/usr/bin/env bash
# Builds the Rivo server (with the web UI embedded) for Android arm64 into
# the Rivo Server app's jniLibs as librivo.so. Run after `npm run build` in web/.
#   tools/android/build-server.sh <jniLibs/arm64-v8a dir>
set -euo pipefail
OUT=$(realpath -m "${1:?output dir}")
mkdir -p "$OUT"
cd "$(dirname "$0")/../../server"
# -checklinkname=0: github.com/wlynxg/anet reads net internals so that
# interface lookups work on Android 11+.
GOOS=android GOARCH=arm64 CGO_ENABLED=0 go build -trimpath \
  -ldflags="-checklinkname=0 -s -w" -o "$OUT/librivo.so" ./cmd/homecinema
