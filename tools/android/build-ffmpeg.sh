#!/usr/bin/env bash
# Builds ffmpeg and ffprobe for Android arm64 with the NDK (LGPL, no GPL
# parts), as standalone PIE executables the Rivo Server app ships in jniLibs.
# H.264 encoding goes through the phone's hardware encoder (h264_mediacodec
# over the NDK MediaCodec API, which needs no Java VM).
#
#   ANDROID_NDK_HOME=... tools/android/build-ffmpeg.sh <out-dir>
set -euo pipefail
OUT=$(realpath -m "${1:?output dir}")
VER=${FFMPEG_VERSION:-7.1.1}
API=24
NDK=${ANDROID_NDK_HOME:-${ANDROID_NDK_LATEST_HOME:?set ANDROID_NDK_HOME}}
TC=$NDK/toolchains/llvm/prebuilt/linux-x86_64
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

curl -fsSL "https://ffmpeg.org/releases/ffmpeg-$VER.tar.xz" | tar -xJ -C "$WORK"
cd "$WORK/ffmpeg-$VER"
./configure \
  --target-os=android --arch=aarch64 --cpu=armv8-a --enable-cross-compile \
  --cc="$TC/bin/aarch64-linux-android$API-clang" \
  --cxx="$TC/bin/aarch64-linux-android$API-clang++" \
  --nm="$TC/bin/llvm-nm" --ar="$TC/bin/llvm-ar" --ranlib="$TC/bin/llvm-ranlib" \
  --strip="$TC/bin/llvm-strip" --sysroot="$TC/sysroot" \
  --enable-pic --enable-static --disable-shared \
  --disable-doc --disable-debug --disable-ffplay --disable-vulkan \
  --enable-jni --enable-mediacodec --enable-zlib \
  --extra-ldflags="-Wl,-z,max-page-size=16384"
make -j"$(nproc)"
mkdir -p "$OUT"
"$TC/bin/llvm-strip" -o "$OUT/libffmpeg.so" ffmpeg
"$TC/bin/llvm-strip" -o "$OUT/libffprobe.so" ffprobe
file "$OUT"/*.so 2>/dev/null || true
