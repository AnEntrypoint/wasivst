#!/usr/bin/env bash
# Fetch v86 WASM emulator via npm and prepare dist bundle.
# v86 is an x86-64 PC emulator; npm package includes pre-built WASM.
# Usage: bash qemu-build.sh <rootfs.ext4> <output-dir>
set -euo pipefail

ROOTFS="${1:?rootfs.ext4 required}"
OUTDIR="${2:?output directory required}"

mkdir -p "$OUTDIR"

npm pack v86 --pack-destination /tmp/v86-pack
tar -xzf /tmp/v86-pack/v86-*.tgz -C /tmp/v86-extract --strip-components=1 2>/dev/null || \
  tar -xzf /tmp/v86-pack/*.tgz -C /tmp/v86-extract --strip-components=1

cp /tmp/v86-extract/build/v86.wasm "$OUTDIR/wasivst-qemu.wasm"
cp /tmp/v86-extract/build/libv86.js "$OUTDIR/libv86.js"
cp "$ROOTFS" "$OUTDIR/rootfs.ext4"

echo "v86 WASM bundle ready in $OUTDIR"
