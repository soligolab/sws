#!/usr/bin/env bash
#
# Una release non deve poter restare a metà.
#
# PERCHÉ ESISTE
#
# La notte fra il 16 e il 17 settembre 2026 due sessioni hanno lavorato sullo
# stesso progetto da due macchine. Quella di casa ha chiuso la giornata
# dicendo, testualmente, «main e origin/main sono già allineati, nessun ramo
# aperto, working tree pulito, niente da committare né da pushare».
#
# Era vero nel suo checkout ed era falso nel repo. Il commit che si era portata
# dietro e aveva pushato era `chore(release): 2.8.0`, e il tag `2.8.0` esisteva
# solo nell'altro checkout: una release pubblicata a metà, con la storia su
# origin e il tag da nessuna parte.
#
# Nessuno dei controlli esistenti poteva vederlo. `session_start.sh` confronta i
# tag iterando su `git ls-remote --tags origin` e cercando l'omonimo locale: un
# tag che esiste **solo in locale** non compare in quella lista, quindi non
# viene mai esaminato. Sapeva dire «i tuoi tag puntano altrove», non «hai un tag
# che origin non ha». E nessuno collegava il `CHANGELOG.md` ai tag: la sezione
# `[2.7.3]` esiste dal 12-09-2026 e quel tag non è mai stato creato — cinque
# giorni, zero segnali.
#
# COSA VERIFICA
#
#   1. la versione dichiarata è la stessa nei quattro file che la portano;
#   2. quella versione ha una sezione nel CHANGELOG;
#   3. ogni versione rilasciata nel CHANGELOG ha un tag (`X` o, per le
#      storiche, `vX`);
#   4. ogni tag di versione locale esiste anche su origin.
#
# Il 4 è l'unico che vuole la rete. Se origin non risponde **lo dice** e non
# finge di averlo fatto: una guardia che salta in silenzio è peggio di una che
# non c'è, perché ci si fida.
#
# Uso: ./scripts/check_release_coerente.sh
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

fatti=0; passati=0; saltati=0
esito() {
  fatti=$((fatti+1))
  if [ "$1" = ok ]; then passati=$((passati+1)); echo "  ✓ $2"; else echo "  ✗ $2"; fi
}
nota() { echo "  • $2"; }

# ── Debito dichiarato ────────────────────────────────────────────────────────
#
# Versioni del CHANGELOG che sappiamo di non avere taggato, e per cui la
# decisione è del maintainer: recuperare il tag a posteriori o lasciarle come
# release di solo changelog. Dichiararle qui le rende **visibili** invece che
# silenziose — è la stessa scelta di `check_i18n_parita.sh`, e come là questo
# elenco deve tendere a vuoto.
#
#   2.7.3 — rilasciata il 12-09-2026, mai taggata. Scoperta il 17-09-2026
#           scrivendo questa guardia.
SENZA_TAG_DICHIARATE=(2.7.3)

dichiarata() {
    local v="$1" d
    for d in "${SENZA_TAG_DICHIARATE[@]}"; do [ "$d" = "$v" ] && return 0; done
    return 1
}

# ── 1. la versione è una sola ────────────────────────────────────────────────
echo "=== 1. la versione dichiarata è la stessa nei quattro file ==="

versione_di() {
    case "$1" in
        *.json) grep -m1 -oP '"version"\s*:\s*"\K[^"]+' "$1" ;;
        *)      grep -m1 -oP '^version\s*=\s*"\K[^"]+' "$1" ;;
    esac
}

PORTANO_VERSIONE=(
    sws-runtime/Cargo.toml
    sws-runtime/crates/sws-kiosk/Cargo.toml
    sws-runtime/crates/sws-lvgl-viewer/Cargo.toml
    sws-editor/package.json
)

VERSIONE="$(versione_di "${PORTANO_VERSIONE[0]}")"
discordi=""
for f in "${PORTANO_VERSIONE[@]}"; do
    v="$(versione_di "$f")"
    [ "$v" = "$VERSIONE" ] || discordi="${discordi} ${f}=${v:-vuota}"
done
if [ -z "$discordi" ]; then
    esito ok "tutti e quattro dicono $VERSIONE"
else
    esito no "non concordano (il primo dice $VERSIONE):$discordi"
fi

# ── 2. la versione dichiarata ha una sezione nel CHANGELOG ───────────────────
echo "=== 2. la versione dichiarata è raccontata nel CHANGELOG ==="
if grep -q "^## \[${VERSIONE}\]" CHANGELOG.md; then
    esito ok "\`## [$VERSIONE]\` c'è"
else
    esito no "\`## [$VERSIONE]\` manca: il codice dice $VERSIONE e il changelog non sa cosa sia"
fi

# ── 3. ogni versione rilasciata ha un tag ────────────────────────────────────
echo "=== 3. ogni versione rilasciata nel CHANGELOG ha un tag ==="

# `[Unreleased]` è escluso apposta: è la sezione in cui si scrive prima di
# rilasciare, e pretendere un tag per lei sarebbe pretendere di taggare il
# lavoro in corso.
mapfile -t RILASCIATE < <(grep -oP '^## \[\K[0-9][^]]*' CHANGELOG.md)

tag_di() {
    # Le release fino alla 2.1.0 usavano il prefisso `v`; dalla 2.1.1 in poi no.
    # Entrambe le forme valgono, perché rinominare i tag pubblicati romperebbe
    # i riferimenti già distribuiti.
    if   git rev-parse -q --verify "refs/tags/$1"  >/dev/null; then echo "$1"
    elif git rev-parse -q --verify "refs/tags/v$1" >/dev/null; then echo "v$1"
    fi
}

orfane=""; orfane_dichiarate=""
for v in "${RILASCIATE[@]}"; do
    [ -n "$(tag_di "$v")" ] && continue
    if dichiarata "$v"; then
        orfane_dichiarate="${orfane_dichiarate} ${v}"
    else
        orfane="${orfane} ${v}"
    fi
done

if [ -z "$orfane" ]; then
    esito ok "${#RILASCIATE[@]} versioni nel changelog, nessuna senza tag (fuori dal debito dichiarato)"
else
    esito no "versione rilasciata senza tag:$orfane"
    echo "      Una sezione nel CHANGELOG senza tag è una release che nessuno può"
    echo "      tirare fuori: \`git checkout <versione>\` non funziona, e \`git"
    echo "      describe\` la salta. O si crea il tag, o la si dichiara in"
    echo "      SENZA_TAG_DICHIARATE dentro questa guardia, con il perché."
fi
for v in $orfane_dichiarate; do
    nota "" "$v: senza tag, dichiarato — decisione del maintainer ancora aperta"
done

# ── 4. nessun tag di versione resta chiuso in questo checkout ────────────────
echo "=== 4. i tag di versione locali sono anche su origin ==="

REMOTI="$(timeout 20 git ls-remote --tags origin 2>/dev/null \
          | sed 's|.*refs/tags/||; s|\^{}$||' | sort -u)"
if [ -z "$REMOTI" ]; then
    saltati=$((saltati+1))
    echo "  ⚠ origin non risponde: questo controllo NON è stato fatto."
    echo "      È quello che avrebbe visto la release a metà del 16-09: senza"
    echo "      rete non lo si può sapere, e fingere di saperlo sarebbe peggio."
else
    solo_locali=""
    while read -r t; do
        [ -z "$t" ] && continue
        # Solo i tag di versione: `archive/…`, `pre-merge-…` e simili sono
        # segnalibri di lavoro, non release, e non devono stare su origin.
        case "$t" in
            [0-9]*|v[0-9]*) ;;
            *) continue ;;
        esac
        grep -qxF "$t" <<<"$REMOTI" || solo_locali="${solo_locali} ${t}"
    done < <(git tag)

    if [ -z "$solo_locali" ]; then
        esito ok "nessun tag di versione esiste solo qui"
    else
        esito no "tag di versione che origin non ha:$solo_locali"
        echo "      Una release a metà: la storia è pubblicata e il tag no. Chi"
        echo "      guarda origin vede un \`chore(release)\` e nessuna release."
        echo "      \`git push origin <tag>\`, o si toglie il tag se era un errore."
    fi
fi

# ── esito ────────────────────────────────────────────────────────────────────
echo
if [ "$passati" -eq "$fatti" ]; then
    [ "$saltati" -gt 0 ] \
        && echo "release: $passati/$fatti coerenti, $saltati non verificati (origin irraggiungibile)." \
        || echo "release: la versione, il changelog e i tag dicono la stessa cosa."
    exit 0
fi
echo "release: $((fatti - passati)) controlli su $fatti falliti."
exit 1
