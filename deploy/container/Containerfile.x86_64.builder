# Immagine di sola compilazione per il percorso container x86_64.
#
# Esiste per una ragione precisa: il binario decide la base dell'immagine
# finale, non il contrario. PyO3 gira con `auto-initialize`, quindi il binario
# linka la `libpython` della macchina che lo compila — su una Debian 12
# `libpython3.11.so.1.0`, su una macchina con pyenv `libpython3.13`, e così via.
# Finché si compilava sull'host, l'immagine x86_64 era diversa da una macchina
# all'altra e la riga `FROM` andava riverificata a mano ogni volta.
#
# Compilando QUI dentro, il binario linka sempre la Python di `ubuntu:24.04`
# (3.12), che è la stessa base dell'immagine aarch64. Le due architetture
# tornano gemelle e il limite di riproducibilità sparisce: chiunque ricostruisca
# ottiene lo stesso risultato, senza dipendere da com'è fatta la sua macchina.
#
# È l'equivalente x86_64 di ciò che sull'aarch64 fa l'SDK Yocto Pixsys: un
# ambiente di compilazione fisso.
#
# Costruita da `scripts/build_container_x86_64.sh`, che poi ci lancia dentro un
# container per il solo `cargo build`. Podman ne conserva i layer, quindi la
# toolchain si scarica una volta sola.
# The base by digest, not by tag (22-11-2026): the builds of the different
# architectures run in parallel now, and a local `ubuntu:24.04` tag flips its
# architecture at every pull with another --platform. The digest is the
# multi-arch index: --platform still picks the architecture. Updated by hand,
# like rustc below, when we decide to take Ubuntu's updates.
FROM docker.io/library/ubuntu:24.04@sha256:9c7f200c07e3d4a03e7249d2c16bf66a51120fb876aa2242cf31451412543289

# build-essential: rusqlite è compilato con la feature `bundled`, cioè compila
#   il sorgente C di SQLite — serve un compilatore C.
# python3-dev: PyO3 con `auto-initialize` vuole libpython **e** gli header.
#   Su ubuntu:24.04 significa Python 3.12, cioè esattamente ciò contro cui il
#   binario deve linkare per girare nell'immagine finale.
# pkg-config: richiesto da alcuni build script del workspace.
# Niente libssl-dev: reqwest usa `rustls-tls` e non OpenSSL (scelta congelata in
#   docs/CONTEXT.md §5), quindi installarlo sarebbe superficie in più per niente.
#
# Il viewer LVGL (10-11-2026, «l'istantanea anche nel cloud»): fino a questa data
# l'immagine x86_64 portava il solo runtime, e l'assistente dell'IDE nel cloud
# chiamava `istantanea_pagina` per sentirsi dire che il viewer non c'era. Il
# viewer serve lì non per uno schermo — nel cloud non ce n'è — ma per la foto
# della pagina disegnata dallo stesso motore del pannello. Servono le stesse
# cose che la cross-build aarch64 mette nel suo sysroot, qui native:
# clang + libclang-dev: bindgen, per `lvgl-sys` (LVGL vendorizzato) e per i
#   binding libdrm del viewer (build.rs).
# cmake: SDL2 si compila dal sorgente e si linka statico (feature
#   `sdl-statico` del viewer, il perché sta lì). Per questo NON c'è libsdl2-dev:
#   SDL di sistema qui non serve, e senza i suoi header -dev (X11, Wayland,
#   PulseAudio…) l'SDL statico esce più piccolo.
# libdrm-dev: header per bindgen e `-ldrm` (il percorso DRM/KMS diretto).
# libfreetype-dev: LVGL disegna il testo con FreeType (`LVGL_EXTRA_LINK`).
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        build-essential \
        ca-certificates \
        clang \
        cmake \
        curl \
        file \
        libclang-dev \
        libdrm-dev \
        libfreetype-dev \
        pkg-config \
        python3 \
        python3-dev && \
    rm -rf /var/lib/apt/lists/*

# rustup e non il pacchetto `rustc` di Ubuntu: quello di distribuzione resta
# indietro e il workspace dichiara MSRV 1.75 con edition 2021.
# A fixed version, not `stable` (22-11-2026, same in the other two builders): a
# builder rebuilt after a new stable changed rustc, and cargo then reused
# nothing — a cold build of every crate on every architecture. Moved by hand,
# in all three builders together, when we decide to.
ENV RUSTUP_HOME=/usr/local/rustup \
    CARGO_HOME=/usr/local/cargo \
    PATH=/usr/local/cargo/bin:$PATH
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
      | sh -s -- -y --no-modify-path --profile minimal --default-toolchain 1.100.0 && \
    rustc --version && cargo --version

WORKDIR /src/sws-runtime
