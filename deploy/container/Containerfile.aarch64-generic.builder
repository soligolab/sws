# Immagine di sola compilazione per il percorso container aarch64 generico
# (senza SDK Pixsys).
#
# Gemella di Containerfile.x86_64.builder — stesso identico contenuto, nessuna
# riga specifica per l'architettura (nessun controllo `arch`/`uname`, i
# pacchetti apt esistono identici su entrambe le architetture Ubuntu, rustup
# si auto-rileva da sé): costruita con `--platform linux/arm64` invece di
# `linux/amd64` produce un builder aarch64 altrettanto valido.
#
# Differenza reale, non di contenuto ma di ESECUZIONE: su una macchina di
# build x86_64 (come quella dello sviluppatore), `--platform linux/arm64`
# gira sotto emulazione QEMU — build-arch e target-arch non coincidono, a
# differenza del gemello x86_64. L'intera compilazione (apt, rustup, cargo
# build) gira emulata: niente headache di cross-linking (PyO3/rusqlite
# compilano "come se" fossero su hardware arm64 vero), ma sensibilmente più
# lenta di una build nativa. Vedi scripts/build_container_aarch64_generic.sh.
#
# PyO3 gira con `auto-initialize`, quindi il binario linka la `libpython`
# della macchina che lo compila — compilando QUI dentro, linka sempre la
# Python di `ubuntu:24.04` (3.12), la stessa base dell'immagine finale
# Containerfile.aarch64-generic.
FROM ubuntu:24.04

# build-essential: rusqlite è compilato con la feature `bundled`, cioè compila
#   il sorgente C di SQLite — serve un compilatore C.
# python3-dev: PyO3 con `auto-initialize` vuole libpython **e** gli header.
#   Su ubuntu:24.04 significa Python 3.12, cioè esattamente ciò contro cui il
#   binario deve linkare per girare nell'immagine finale.
# pkg-config: richiesto da alcuni build script del workspace.
# cmake: aws-lc-sys (dietro rustls, via reqwest) passa al builder CMake
#   quando gira con AWS_LC_SYS_NO_ASM=1 (necessario qui — vedi
#   scripts/build_container_aarch64_generic.sh — l'assembly ARM NEON+SHA3
#   fa crashare `cc` sotto emulazione QEMU). Il gemello x86_64.builder non
#   lo ha: lì gira senza NO_ASM, quindi resta sul builder cc diretto.
# Niente libssl-dev: reqwest usa `rustls-tls` e non OpenSSL (scelta congelata in
#   docs/CONTEXT.md §5), quindi installarlo sarebbe superficie in più per niente.
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        build-essential \
        ca-certificates \
        cmake \
        curl \
        pkg-config \
        python3 \
        python3-dev && \
    rm -rf /var/lib/apt/lists/*

# rustup e non il pacchetto `rustc` di Ubuntu: quello di distribuzione resta
# indietro e il workspace dichiara MSRV 1.75 con edition 2021. Il canale stabile
# tiene il passo senza dover inseguire la versione impacchettata. Sotto QEMU
# l'installer rustup.rs si auto-rileva correttamente come aarch64 (legge
# `uname -m` dell'ambiente emulato), nessuna variabile da forzare a mano.
ENV RUSTUP_HOME=/usr/local/rustup \
    CARGO_HOME=/usr/local/cargo \
    PATH=/usr/local/cargo/bin:$PATH
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
      | sh -s -- -y --no-modify-path --profile minimal --default-toolchain stable && \
    rustc --version && cargo --version

WORKDIR /src/sws-runtime
