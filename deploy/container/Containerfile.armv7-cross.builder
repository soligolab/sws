# Builder per i binari armv7 dei Tiny TY (RV1106, Cortex-A7, Ubuntu 22.04
# armhf): cross-compilazione da x86_64, come il builder aarch64.
#
# PERCHÉ NON SI COPIA QUELLO aarch64 (piano docs/plans/2026-10-30-sws-lvgl-sul-
# tiny-ty.md, passo 1): quello parte da ubuntu:24.04, glibc 2.39, e un binario
# costruito lì non parte su un sistema con glibc 2.35. Sui Tiny TY non c'è
# podman: il binario gira **sul sistema del dispositivo**, quindi il sysroot
# deve essere quel sistema — Ubuntu 22.04 armhf, glibc 2.35, Python 3.10.
#
# Due stadi, come Containerfile.aarch64-cross.builder (lì il perché del sysroot
# separato invece del multiarch):
#  1. `sysroot` — ubuntu:22.04 arm/v7 (QEMU, solo per apt-get);
#  2. il builder x86_64 con `crossbuild-essential-armhf`.
#
# Si usa solo da scripts/build_armv7.sh.

# ── Stadio 1: il sysroot armhf ───────────────────────────────────────────────
FROM --platform=linux/arm/v7 ubuntu:22.04 AS sysroot
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        libc6-dev \
        linux-libc-dev \
        libpython3.10-dev \
        libsdl2-dev \
        libdrm-dev \
        libfreetype-dev && \
    rm -rf /var/lib/apt/lists/*

# ── Stadio 2: il builder x86_64 ──────────────────────────────────────────────
# Stessa 22.04 anche qui, così gcc cross (11) e gli header del sysroot sono
# della stessa famiglia. libfreetype-dev x86_64 serve a lvgl-sys, che si
# compila anche per l'host (vedi il builder aarch64).
FROM --platform=linux/amd64 ubuntu:22.04

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        build-essential \
        ca-certificates \
        clang \
        cmake \
        crossbuild-essential-armhf \
        curl \
        file \
        libclang-dev \
        libfreetype-dev \
        pkg-config && \
    rm -rf /var/lib/apt/lists/*

COPY --from=sysroot / /sysroot/armhf

ENV RUSTUP_HOME=/usr/local/rustup \
    CARGO_HOME=/usr/local/cargo \
    PATH=/usr/local/cargo/bin:$PATH
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
      | sh -s -- -y --no-modify-path --profile minimal --default-toolchain stable && \
    rustup target add armv7-unknown-linux-gnueabihf && \
    rustc --version && cargo --version

# pyo3: la configurazione scritta a mano, come per aarch64. Python 3.10
# condiviso di Ubuntu 22.04, puntatori a 32 bit.
RUN printf 'implementation=CPython\nversion=3.10\nshared=true\nabi3=false\nlib_name=python3.10\nlib_dir=/sysroot/armhf/usr/lib/arm-linux-gnueabihf\npointer_width=32\nbuild_flags=\nsuppress_build_script_link_lines=false\n' \
      > /opt/pyo3-armv7.cfg && cat /opt/pyo3-armv7.cfg

# Le variabili per-target, come per aarch64 (lì il perché di ognuna).
ENV SYSROOT_ARMHF=/sysroot/armhf \
    CARGO_TARGET_ARMV7_UNKNOWN_LINUX_GNUEABIHF_LINKER=arm-linux-gnueabihf-gcc \
    CARGO_TARGET_ARMV7_UNKNOWN_LINUX_GNUEABIHF_RUSTFLAGS="-C link-arg=--sysroot=/sysroot/armhf -L /sysroot/armhf/usr/lib/arm-linux-gnueabihf" \
    CC_armv7_unknown_linux_gnueabihf=arm-linux-gnueabihf-gcc \
    CXX_armv7_unknown_linux_gnueabihf=arm-linux-gnueabihf-g++ \
    AR_armv7_unknown_linux_gnueabihf=arm-linux-gnueabihf-ar \
    CFLAGS_armv7_unknown_linux_gnueabihf="--sysroot=/sysroot/armhf" \
    CXXFLAGS_armv7_unknown_linux_gnueabihf="--sysroot=/sysroot/armhf" \
    HOST_CC=gcc \
    PKG_CONFIG_ALLOW_CROSS=1 \
    PKG_CONFIG_SYSROOT_DIR_armv7_unknown_linux_gnueabihf=/sysroot/armhf \
    PKG_CONFIG_PATH_armv7_unknown_linux_gnueabihf=/sysroot/armhf/usr/lib/arm-linux-gnueabihf/pkgconfig:/sysroot/armhf/usr/share/pkgconfig \
    PYO3_CONFIG_FILE=/opt/pyo3-armv7.cfg \
    OECORE_TARGET_SYSROOT=/sysroot/armhf \
    BINDGEN_EXTRA_CLANG_ARGS_armv7_unknown_linux_gnueabihf="--target=armv7-unknown-linux-gnueabihf --sysroot=/sysroot/armhf"

WORKDIR /src/sws-runtime
