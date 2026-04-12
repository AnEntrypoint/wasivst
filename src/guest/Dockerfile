FROM alpine:3.19 AS builder

RUN apk add --no-cache \
    wine \
    e2fsprogs \
    busybox-static

COPY init /sbin/init
RUN chmod +x /sbin/init

COPY wasivst-host-placeholder.exe /usr/bin/wasivst-host.exe

RUN mkdir -p /rootfs && \
    cp -a /bin /sbin /lib /usr /etc /rootfs/ && \
    mkdir -p /rootfs/dev /rootfs/proc /rootfs/sys /rootfs/tmp && \
    mkfs.ext4 -d /rootfs /rootfs.ext4 256M

FROM scratch
COPY --from=builder /rootfs.ext4 /rootfs.ext4
