#!/bin/sh
# sonda-dispositivo.sh — raccoglie FATTI su un dispositivo, non li giudica.
#
# L'editor la manda via ssh PRIMA di installare il container (Q52, 2026-09-09):
#
#     ssh user@host 'sh -s' < sonda-dispositivo.sh
#
# Lo script viaggia su stdin, una sessione sola, nessun file lasciato sul
# dispositivo. Per questo NESSUN comando qui sotto deve leggere stdin: stdin È
# lo script, e un comando che lo consumasse mangerebbe le righe successive.
# Ogni comando esterno prende `</dev/null`.
#
# Stampa una riga `SONDA chiave=valore` per fatto. Il giudizio (cos'è un
# errore, cos'è un avviso, che rimedio proporre) sta in Rust
# (`sws-web/src/sonda.rs`, `valuta_sonda`), dove si prova con `cargo test`
# senza un dispositivo. Qui solo POSIX sh: gira anche su busybox, dove
# `hostname`, `loginctl`, `timeout` possono mancare — ogni fatto ha un ripiego.
#
# Esce SEMPRE 0: un fatto mancante è un fatto, non un errore della sonda.
# Le righe citate (Lnnn) rimandano a install-container.sh, di cui questa sonda
# anticipa i controlli.
set -u

# La cartella dati: quella scelta nel modulo dell'editor se arriva come primo
# argomento (`sh -s -- /altro/percorso`), altrimenti il default dell'installer
# (L64). Controllare quella giusta conta: un percorso su una partizione piena
# o non scrivibile si scopre qui, non a metà installazione.
DATA="${1:-/data/user/sws}"
T=""
command -v timeout >/dev/null 2>&1 && T="timeout 15"

# r chiave valore — una riga, senza a capo dentro il valore.
r() {
    printf 'SONDA %s=%s\n' "$1" "$(printf '%s' "$2" | tr -d '\r\n')"
}

r sonda_versione 1
r hostname "$(hostname 2>/dev/null </dev/null || uname -n)"
r arch "$(uname -m)"
r kernel "$(uname -r)"
U="$(id -un)"
UIDN="$(id -u)"
r utente "$U"
r uid "$UIDN"

# os-release in una subshell: `.` porta dentro decine di variabili e non le
# vogliamo nel resto dello script.
(
    if [ -r /etc/os-release ]; then . /etc/os-release; fi
    r os_name "${PRETTY_NAME:-${NAME:-}}"
    r os_id "${ID:-}"
    r os_version "${VERSION_ID:-}"
)

# ── podman ─────────────────────────────────────────────────────────────────────
if command -v podman >/dev/null 2>&1; then                       # L149
    r podman 1
    V="$($T podman version --format '{{.Client.Version}}' 2>/dev/null </dev/null)"
    [ -n "$V" ] || V="$(podman --version 2>/dev/null </dev/null | awk '{print $3}')"
    r podman_versione "$V"
    STORAGE_ROOT="$($T podman info --format '{{.Store.GraphRoot}}' 2>/dev/null </dev/null)"   # L265
    [ -n "$STORAGE_ROOT" ] || STORAGE_ROOT="$HOME"
else
    r podman 0
    STORAGE_ROOT="$HOME"
fi
r storage_root "$STORAGE_ROOT"
r spazio_kb "$(df -Pk "$STORAGE_ROOT" 2>/dev/null </dev/null | awk 'NR==2{print $4}')"   # L266

# ── mappature per il rootless ──────────────────────────────────────────────────
if grep -qs "^$U:" /etc/subuid || grep -qs "^$UIDN:" /etc/subuid; then r subuid 1; else r subuid 0; fi
if grep -qs "^$U:" /etc/subgid || grep -qs "^$UIDN:" /etc/subgid; then r subgid 1; else r subgid 0; fi

# ── sessione utente e linger ───────────────────────────────────────────────────
if command -v loginctl >/dev/null 2>&1; then                     # L394
    if loginctl show-user "$U" 2>/dev/null </dev/null | grep -q '^Linger=yes'; then
        r linger yes
    else
        r linger no
    fi
else
    r linger sconosciuto
fi

# Stesso presupposto dell'installer lanciato via ssh: senza sessione grafica
# XDG_RUNTIME_DIR può non essere impostata, ma la cartella c'è se il linger o
# una sessione la hanno creata.
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$UIDN}"
if [ -d "$XDG_RUNTIME_DIR" ]; then r xdg_runtime_dir 1; else r xdg_runtime_dir 0; fi
S="$(systemctl --user is-system-running 2>/dev/null </dev/null)"
r systemd_user "${S:-non-raggiungibile}"

# ── cartella dati ──────────────────────────────────────────────────────────────
r data_path "$DATA"
if [ -d "$DATA" ]; then
    if [ -w "$DATA" ]; then r data_stato scrivibile; else r data_stato non-scrivibile; fi
else
    P="$DATA"
    while [ ! -d "$P" ] && [ "$P" != / ]; do P="$(dirname "$P")"; done
    if [ -w "$P" ]; then r data_stato assente-creabile; else r data_stato assente-non-creabile; fi
fi

# ── SWS già presente? ──────────────────────────────────────────────────────────
if command -v podman >/dev/null 2>&1 && $T podman container exists sws-runtime 2>/dev/null </dev/null; then   # L351
    r container_sws 1
    r container_sws_immagine "$($T podman container inspect sws-runtime --format '{{.ImageName}}' 2>/dev/null </dev/null)"
    A="$(systemctl --user is-active sws-runtime 2>/dev/null </dev/null)"                 # L356
    r container_sws_attivo "${A:-sconosciuto}"
else
    r container_sws 0
fi

r fine 1
exit 0
