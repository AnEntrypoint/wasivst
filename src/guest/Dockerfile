FROM alpine:3.19 AS builder

RUN apk add --no-cache \
    wine \
    e2fsprogs \
    busybox-static \
    curl \
    unzip

RUN rm -f /sbin/init && \
    printf '#!/bin/sh\nmount -t proc proc /proc\nmount -t sysfs sysfs /sys\nmount -t devtmpfs devtmpfs /dev\nexec wine /usr/bin/wasivst-host.exe < /dev/ttyS0 > /dev/ttyS0\n' > /sbin/init && \
    chmod +x /sbin/init

COPY wasivst-host-placeholder.exe /usr/bin/wasivst-host.exe

# Embed Dexed VST3 at a fixed Wine-accessible path
RUN curl -L -o /tmp/dexed-win.zip https://github.com/asb2m10/dexed/releases/download/v1.0.1/Dexed-1.0.1-win.zip && \
    unzip -o /tmp/dexed-win.zip -d /tmp/dexed && \
    mkdir -p /usr/share/plugins && \
    cp "/tmp/dexed/Dexed.vst3/Contents/x86_64-win/Dexed.vst3" /usr/share/plugins/Dexed.vst3.dll && \
    rm -rf /tmp/dexed /tmp/dexed-win.zip

RUN mkdir -p /rootfs && \
    cp -a /bin /sbin /lib /usr /etc /rootfs/ && \
    mkdir -p /rootfs/dev /rootfs/proc /rootfs/sys /rootfs/tmp && \
    mkfs.ext4 -d /rootfs /rootfs.ext4 768M

FROM scratch
COPY --from=builder /rootfs.ext4 /rootfs.ext4
