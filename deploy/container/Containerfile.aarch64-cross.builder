# Builder per l'immagine aarch64: cross-compilazione da x86_64, senza SDK
# Pixsys e senza QEMU per la compilazione (Q53, 2026-09-10).
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
# COME È FATTO: due stadi.
#
#  1. `sysroot` — un `ubuntu:24.04` **arm64** (emulato con QEMU, solo per
#     `apt-get`: pochi minuti, una volta) in cui si installano le librerie di
#     sviluppo contro cui il binario linka: libc, libpython3.12, SDL2, libdrm,
#     FreeType. È lo stesso ruolo del sysroot dell'SDK Pixsys, ma da Ubuntu — e
#     la stessa base dell'immagine finale (Containerfile.aarch64), quindi glibc
#     2.39 e Python 3.12 combaciano per costruzione.
#  2. il builder **x86_64**, con la toolchain Ubuntu per arm64
#     (`crossbuild-essential-arm64`), che riceve l'intero stadio 1 in
#     /sysroot/aarch64 e lo passa a gcc, clang (bindgen), pkg-config e pyo3 con
#     `--sysroot`. Il compilatore gira nativo: ottimizzato, in minuti.
#
# PERCHÉ NON IL MULTIARCH (`apt-get install libc6-dev:arm64 …` nello stesso
# sistema x86_64), che era la prima forma: i pacchetti `Multi-Arch: same`
# (libc6, libpython3.12-stdlib, …) si installano per due architetture solo se
# la versione è IDENTICA, e amd64 e arm64 stanno su due mirror diversi
# (archive.ubuntu.com e ports.ubuntu.com) che ricevono gli aggiornamenti in
# momenti diversi. Il 2026-09-10 a mezzogiorno `libpython3.12-stdlib` era alla
# 0.17 su archive e alla 0.16 su ports: «Unable to correct problems, you have
# held broken packages». La stessa mattina funzionava. Con il sysroot separato
# ogni architettura viene dal proprio mirror e nessuno deve combaciare.
#
# COME SI USA: solo da scripts/build_container.sh, che lo costruisce con
# `--platform linux/amd64` (il tag locale `ubuntu:24.04` cambia architettura a
# ogni pull, e senza dirlo podman prenderebbe la base sbagliata — successo),
# monta il repo in /src e lancia `cargo build --target aarch64-unknown-linux-gnu`.

# ── Stadio 1: il sysroot arm64 ───────────────────────────────────────────────
FROM --platform=linux/arm64 ubuntu:24.04 AS sysroot
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        libc6-dev \
        linux-libc-dev \
        libpython3.12-dev \
        libsdl2-dev \
        libdrm-dev \
        libfreetype-dev && \
    rm -rf /var/lib/apt/lists/*

# ── Stadio 2: il builder x86_64 ──────────────────────────────────────────────
FROM --platform=linux/amd64 ubuntu:24.04

# build-essential, clang, libclang-dev, cmake, pkg-config: i build script dei
#   crate (rusqlite bundled, ring, aws-lc-sys, lvgl-sys con bindgen). `lvgl`
#   dichiara `lvgl-sys` fra le build-dependencies, quindi LVGL si compila ANCHE
#   per l'host: serve un gcc x86_64 normale — e libfreetype-dev x86_64, perché
#   lvgl-sys linka `-lfreetype` (LVGL_EXTRA_LINK nel .cargo/config del viewer):
#   senza, il build script di `lvgl` muore con «unable to find library
#   -lfreetype» (visto al primo giro).
# crossbuild-essential-arm64: gcc/g++/binutils per aarch64-linux-gnu.
# Niente python3 host: pyo3 legge PYO3_CONFIG_FILE e non esegue interpreti.
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
        pkg-config && \
    rm -rf /var/lib/apt/lists/*

# L'intero stadio 1, com'è: con i symlink di merged-usr (/lib → usr/lib), le
# .so, gli header, i .pc. Qualche centinaio di MB nell'immagine builder, che
# non viaggia da nessuna parte.
COPY --from=sysroot / /sysroot/aarch64

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
# `_sysconfigdata*.py` del target accanto alla libpython (primo tentativo
# fallito con «Could not find _sysconfigdata*.py»). Si dà a pyo3 la
# configurazione già scritta: è ciò che il sysconfigdata gli direbbe, e qui è
# nota — Python 3.12 condiviso di ubuntu:24.04, 64 bit, nel sysroot.
RUN printf 'implementation=CPython\nversion=3.12\nshared=true\nabi3=false\nlib_name=python3.12\nlib_dir=/sysroot/aarch64/usr/lib/aarch64-linux-gnu\npointer_width=64\nbuild_flags=\nsuppress_build_script_link_lines=false\n' \
      > /opt/pyo3-aarch64.cfg && cat /opt/pyo3-aarch64.cfg

# ── L'ambiente della cross-compilazione ──────────────────────────────────────
# Le stesse cose che scripts/yocto/build.sh esporta per l'SDK, tradotte per la
# toolchain Ubuntu e il sysroot in /sysroot/aarch64. Per-target (suffisso
# `_aarch64_unknown_linux_gnu`) e non globali: `lvgl-sys` si compila anche per
# l'host, e un CC o un --sysroot globali lo farebbero morire (visto il
# 2026-08-24 con l'SDK: `-m64` al gcc aarch64).
#
# gcc e il linker ricevono `--sysroot`: cercano header e librerie là, con il
# layout multiarch di Ubuntu (usr/lib/aarch64-linux-gnu) che gcc conosce.
# `-L` esplicito per i crate che passano `-l` senza pkg-config (sdl2-sys).
# pkg-config legge i .pc del sysroot e riscrive i percorsi con
# PKG_CONFIG_SYSROOT_DIR. bindgen (libdrm nel viewer, lvgl-sys) riceve target
# e sysroot; OECORE_TARGET_SYSROOT è il nome che il build.rs del viewer già
# conosce dall'SDK, e vale identico qui.
ENV SYSROOT_AARCH64=/sysroot/aarch64 \
    CARGO_TARGET_AARCH64_UNKNOWN_LINUX_GNU_LINKER=aarch64-linux-gnu-gcc \
    CARGO_TARGET_AARCH64_UNKNOWN_LINUX_GNU_RUSTFLAGS="-C link-arg=--sysroot=/sysroot/aarch64 -L /sysroot/aarch64/usr/lib/aarch64-linux-gnu" \
    CC_aarch64_unknown_linux_gnu=aarch64-linux-gnu-gcc \
    CXX_aarch64_unknown_linux_gnu=aarch64-linux-gnu-g++ \
    AR_aarch64_unknown_linux_gnu=aarch64-linux-gnu-ar \
    CFLAGS_aarch64_unknown_linux_gnu="--sysroot=/sysroot/aarch64" \
    CXXFLAGS_aarch64_unknown_linux_gnu="--sysroot=/sysroot/aarch64" \
    HOST_CC=gcc \
    PKG_CONFIG_ALLOW_CROSS=1 \
    PKG_CONFIG_SYSROOT_DIR_aarch64_unknown_linux_gnu=/sysroot/aarch64 \
    PKG_CONFIG_PATH_aarch64_unknown_linux_gnu=/sysroot/aarch64/usr/lib/aarch64-linux-gnu/pkgconfig:/sysroot/aarch64/usr/share/pkgconfig \
    PYO3_CONFIG_FILE=/opt/pyo3-aarch64.cfg \
    OECORE_TARGET_SYSROOT=/sysroot/aarch64 \
    BINDGEN_EXTRA_CLANG_ARGS_aarch64_unknown_linux_gnu="--target=aarch64-unknown-linux-gnu --sysroot=/sysroot/aarch64"

WORKDIR /src/sws-runtime
