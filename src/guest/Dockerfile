FROM alpine:3.19 AS builder

RUN apk add --no-cache \
    wine \
    e2fsprogs \
    busybox-static

RUN rm -f /sbin/init && \
    printf '#!/bin/sh\nmount -t proc proc /proc\nmount -t sysfs sysfs /sys\nmount -t devtmpfs devtmpfs /dev\nexec wine /usr/bin/wasivst-host.exe < /dev/vport0p0 > /dev/vport0p0\n' > /sbin/init && \
    chmod +x /sbin/init

COPY wasivst-host-placeholder.exe /usr/bin/wasivst-host.exe

RUN mkdir -p /rootfs && \
    cp -a /bin /sbin /lib /usr /etc /rootfs/ && \
    mkdir -p /rootfs/dev /rootfs/proc /rootfs/sys /rootfs/tmp && \
    mkfs.ext4 -d /rootfs /rootfs.ext4 256M

FROM scratch
COPY --from=builder /rootfs.ext4 /rootfs.ext4
