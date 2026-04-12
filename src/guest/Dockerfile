FROM alpine:3.19 AS builder

RUN apk add --no-cache \
    wine wine-libs \
    e2fsprogs \
    busybox-static \
    meson ninja gcc g++ musl-dev \
    python3 py3-pip

COPY init /sbin/init
RUN chmod +x /sbin/init

COPY wasivst-host-placeholder /usr/bin/wasivst-host
RUN chmod +x /usr/bin/wasivst-host

RUN mkdir -p /rootfs && \
    cp -a /bin /sbin /lib /usr /etc /rootfs/ && \
    mkdir -p /rootfs/dev /rootfs/proc /rootfs/sys /rootfs/tmp && \
    mkfs.ext4 -d /rootfs /rootfs.ext4 256M

FROM scratch
COPY --from=builder /rootfs.ext4 /rootfs.ext4
