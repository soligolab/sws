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
FROM ubuntu:24.04

# build-essential: rusqlite è compilato con la feature `bundled`, cioè compila
#   il sorgente C di SQLite — serve un compilatore C.
# python3-dev: PyO3 con `auto-initialize` vuole libpython **e** gli header.
#   Su ubuntu:24.04 significa Python 3.12, cioè esattamente ciò contro cui il
#   binario deve linkare per girare nell'immagine finale.
# pkg-config: richiesto da alcuni build script del workspace.
# Niente libssl-dev: reqwest usa `rustls-tls` e non OpenSSL (scelta congelata in
#   docs/CONTEXT.md §5), quindi installarlo sarebbe superficie in più per niente.
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        build-essential \
        ca-certificates \
        curl \
        pkg-config \
        python3 \
        python3-dev && \
    rm -rf /var/lib/apt/lists/*

# rustup e non il pacchetto `rustc` di Ubuntu: quello di distribuzione resta
# indietro e il workspace dichiara MSRV 1.75 con edition 2021. Il canale stabile
# tiene il passo senza dover inseguire la versione impacchettata.
ENV RUSTUP_HOME=/usr/local/rustup \
    CARGO_HOME=/usr/local/cargo \
    PATH=/usr/local/cargo/bin:$PATH
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
      | sh -s -- -y --no-modify-path --profile minimal --default-toolchain stable && \
    rustc --version && cargo --version

WORKDIR /src/sws-runtime
