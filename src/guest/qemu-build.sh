#!/usr/bin/env bash
# Build QEMU x86-64 system emulator to WASM via Emscripten.
# Usage: bash qemu-build.sh <rootfs.ext4> <output.wasm>
set -euo pipefail

ROOTFS="${1:?rootfs.ext4 required}"
OUTPUT="${2:?output.wasm required}"
QEMU_VERSION="8.2.0"
QEMU_SRC="qemu-${QEMU_VERSION}"

mkdir -p dist

if [ ! -d "$QEMU_SRC" ]; then
  curl -L "https://download.qemu.org/${QEMU_SRC}.tar.xz" | tar -xJ
fi

cd "$QEMU_SRC"

emcmake ./configure \
  --target-list=x86_64-softmmu \
  --disable-kvm \
  --disable-sdl \
  --disable-gtk \
  --disable-vnc \
  --disable-spice \
  --disable-docs \
  --disable-tools \
  --enable-virtfs \
  --extra-cflags="-O2 -s USE_PTHREADS=1" \
  --extra-ldflags="-s USE_PTHREADS=1 -s ALLOW_MEMORY_GROWTH=1 -s PTHREAD_POOL_SIZE=4"

emmake make -j$(nproc) qemu-system-x86_64

# Bundle rootfs as a data file alongside the WASM
cp qemu-system-x86_64.wasm "../$OUTPUT"
cp ../"$ROOTFS" "../$(dirname $OUTPUT)/rootfs.ext4"
echo "QEMU WASM built: $OUTPUT"
