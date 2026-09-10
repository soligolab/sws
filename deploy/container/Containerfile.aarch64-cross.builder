# Builder per l'immagine aarch64: cross-compilazione da x86_64, senza SDK
# Pixsys e senza QEMU (Q53, 2026-09-10).
#
# PERCHÉ ESISTE
#
# Fino a oggi l'immagine aarch64 nasceva in due modi: con l'SDK Yocto Pixsys
# (build_container.sh — veloce, ottimizzata, ma legata a una macchina con l'SDK
# installato) oppure dentro un container arm64 emulato con QEMU
# (build_container_aarch64_generic.sh — 51 minuti, e `aws-lc-sys` sotto
# emulazione costringe a `opt-level 0`: il binario pubblicato come
# `-arm64-generic` era NON ottimizzato, «[unoptimized]» nel registro di build).
# Entrambe le immagini partono comunque da `ubuntu:24.04` e girano contro la
# glibc e la libpython dell'immagine, non del pannello: la «libc del
# dispositivo» non è mai stata la differenza. L'ottimizzazione sì.
#
# Qui il compilatore gira nativo su x86_64 e produce codice aarch64 con la
# toolchain Ubuntu (`crossbuild-essential-arm64`); le librerie contro cui si
# linka sono i pacchetti `:arm64` di Ubuntu 24.04 installati in multiarch — lo
# stesso sysroot che l'SDK forniva, ma da Ubuntu, riproducibile su qualunque
# PC, e identico alla base dell'immagine finale (Containerfile.aarch64):
# glibc 2.39, Python 3.12. Ottimizzato, in minuti.
#
# COME SI USA: solo da scripts/build_container_aarch64_cross.sh, che monta il
# repo in /src e lancia `cargo build --target aarch64-unknown-linux-gnu`.
FROM ubuntu:24.04

# Multiarch: i pacchetti arm64 stanno su ports.ubuntu.com, non su
# archive.ubuntu.com. Il file deb822 dell'immagine base va limitato ad amd64
# (altrimenti apt cerca arm64 anche là e fallisce), e si aggiunge la sorgente
# ports per arm64.
RUN dpkg --add-architecture arm64 && \
    sed -i 's/^Types: deb$/Types: deb\nArchitectures: amd64/' /etc/apt/sources.list.d/ubuntu.sources && \
    printf 'Types: deb\nURIs: http://ports.ubuntu.com/ubuntu-ports\nSuites: noble noble-updates noble-security\nComponents: main universe restricted multiverse\nArchitectures: arm64\nSigned-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg\n' \
      > /etc/apt/sources.list.d/ubuntu-ports-arm64.sources

# Lato host (x86_64):
#   build-essential, clang, libclang-dev, cmake, pkg-config: i build script dei
#     crate (rusqlite bundled, ring, aws-lc-sys, lvgl-sys con bindgen). `lvgl`
#     dichiara `lvgl-sys` fra le build-dependencies, quindi LVGL si compila
#     ANCHE per l'host: serve un gcc x86_64 normale.
#   crossbuild-essential-arm64: gcc/g++/binutils per aarch64-linux-gnu.
#   python3: pyo3-build-config lo esegue per leggere la configurazione; con
#     PYO3_CONFIG_FILE non gli serve una libpython host.
#   libfreetype-dev (host): il build script di `lvgl` linka lvgl-sys PER L'HOST
#     e lvgl-sys linka `-lfreetype` (LVGL_EXTRA_LINK nel .cargo/config del
#     viewer): senza la FreeType x86_64 il link del build script muore con
#     «unable to find library -lfreetype». Visto al primo giro (2026-09-10).
# Lato target (:arm64), le librerie contro cui si linka il binario:
#   libc6-dev, linux-libc-dev: header e libc aarch64 in layout multiarch
#     (/usr/include/aarch64-linux-gnu, /usr/lib/aarch64-linux-gnu) — è dove
#     clang, per bindgen, li cerca con --target aarch64.
#   libpython3.12-dev: pyo3 linka libpython3.12 (auto-initialize).
#   libsdl2-dev, libdrm-dev, libfreetype-dev: il viewer LVGL (SDL2 di sistema,
#     libdrm via bindgen, FreeType per il testo — Q24).
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        build-essential \
        ca-certificates \
        clang \
        cmake \
        crossbuild-essential-arm64 \
        curl \
        file \
        libclang-dev \
        libfreetype-dev \
        pkg-config \
        python3 \
        libc6-dev:arm64 \
        linux-libc-dev:arm64 \
        libpython3.12-dev:arm64 \
        libsdl2-dev:arm64 \
        libdrm-dev:arm64 \
        libfreetype-dev:arm64 && \
    rm -rf /var/lib/apt/lists/*

# rustup e non il pacchetto di Ubuntu: il workspace dichiara rust-version 1.88
# e la CI gira sulla 1.94. Toolchain stable più il target aarch64.
ENV RUSTUP_HOME=/usr/local/rustup \
    CARGO_HOME=/usr/local/cargo \
    PATH=/usr/local/cargo/bin:$PATH
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
      | sh -s -- -y --no-modify-path --profile minimal --default-toolchain stable && \
    rustup target add aarch64-unknown-linux-gnu && \
    rustc --version && cargo --version

# ── pyo3 in cross ─────────────────────────────────────────────────────────────
# `PYO3_CROSS_LIB_DIR` da solo non basta: pyo3-build-config vuole trovare il
# `_sysconfigdata*.py` del target accanto alla libpython, e su Ubuntu quel file
# sta in /usr/lib/python3.12/ (libpython3.12-stdlib), nella STESSA cartella di
# quello dell'host — installarlo per arm64 darebbe due file e «found multiple».
# Primo tentativo fallito con «Could not find _sysconfigdata*.py» (2026-09-10).
# Si dà a pyo3 la configurazione già scritta: è ciò che il sysconfigdata gli
# direbbe, e qui è nota — Python 3.12 condiviso di ubuntu:24.04, 64 bit.
RUN printf 'implementation=CPython\nversion=3.12\nshared=true\nabi3=false\nlib_name=python3.12\nlib_dir=/usr/lib/aarch64-linux-gnu\npointer_width=64\nbuild_flags=\nsuppress_build_script_link_lines=false\n' \
      > /opt/pyo3-aarch64.cfg && cat /opt/pyo3-aarch64.cfg

# ── L'ambiente della cross-compilazione ──────────────────────────────────────
# Le stesse cose che scripts/yocto/build.sh esporta per l'SDK, tradotte per la
# toolchain Ubuntu. Per-target (suffisso `_aarch64_unknown_linux_gnu`) e non
# globali: `lvgl-sys` si compila anche per l'host, e un CC globale aarch64 lo
# farebbe morire su `-m64` (visto il 2026-08-24 con l'SDK).
#
# Il linker: il gcc cross di Ubuntu cerca da sé in /usr/lib/aarch64-linux-gnu
# (layout multiarch), ma lo si dice anche a rustc con -L, per i crate che
# passano `-l` senza pkg-config (sdl2-sys).
ENV CARGO_TARGET_AARCH64_UNKNOWN_LINUX_GNU_LINKER=aarch64-linux-gnu-gcc \
    CARGO_TARGET_AARCH64_UNKNOWN_LINUX_GNU_RUSTFLAGS="-L /usr/lib/aarch64-linux-gnu" \
    CC_aarch64_unknown_linux_gnu=aarch64-linux-gnu-gcc \
    CXX_aarch64_unknown_linux_gnu=aarch64-linux-gnu-g++ \
    AR_aarch64_unknown_linux_gnu=aarch64-linux-gnu-ar \
    HOST_CC=gcc \
    PKG_CONFIG_ALLOW_CROSS=1 \
    PKG_CONFIG_PATH_aarch64_unknown_linux_gnu=/usr/lib/aarch64-linux-gnu/pkgconfig:/usr/share/pkgconfig \
    PYO3_CONFIG_FILE=/opt/pyo3-aarch64.cfg \
    PYO3_PYTHON=/usr/bin/python3 \
    BINDGEN_EXTRA_CLANG_ARGS_aarch64_unknown_linux_gnu="--target=aarch64-unknown-linux-gnu -I/usr/include/aarch64-linux-gnu"

WORKDIR /src/sws-runtime
