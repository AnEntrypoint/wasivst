# Build a minimal Alpine Linux rootfs with Wine 64-bit and wasivst-host.
# Output: /rootfs.ext4 (mounted by QEMU WASM guest)

FROM alpine:3.19 AS builder

RUN apk add --no-cache \
    wine wine-libs \
    e2fsprogs \
    busybox-static

COPY wasivst-host /usr/bin/wasivst-host
COPY init /sbin/init
RUN chmod +x /sbin/init /usr/bin/wasivst-host

RUN mkdir -p /rootfs && \
    cp -a /bin /sbin /lib /usr /etc /rootfs/ && \
    mkdir -p /rootfs/dev /rootfs/proc /rootfs/sys /rootfs/tmp && \
    mkfs.ext4 -d /rootfs /rootfs.ext4 256M

FROM scratch
COPY --from=builder /rootfs.ext4 /rootfs.ext4
