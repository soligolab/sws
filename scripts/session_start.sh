#!/usr/bin/env bash
#
# La prima cosa da lanciare prima di riprendere il lavoro.
#
# PERCHÉ ESISTE
#
# Il maintainer lavora da tre macchine (frodo, ufficio, casa) e ogni ripresa
# comincia con lo stesso rito manuale. Il 2026-09-02 quel rito è andato storto
# due volte nella stessa sessione, e in due modi che `git pull` non sa
# raccontare:
#
#  1. `main` divergente con un commit locale che aggiungeva un file **già
#     presente su origin** con un hash diverso — la versione pre-riscrittura
#     dello stesso lavoro. `git pull` si è fermato chiedendo come riconciliare,
#     e nessuna delle tre risposte che suggerisce era quella giusta: merge e
#     rebase avrebbero portato dentro il doppione.
#  2. Undici tag **rifiutati** da `git fetch --tags` («sovrascriverebbe il tag
#     esistente»), lasciati puntati alla storia vecchia. Serve `--force`, e il
#     problema si vede solo sui tag vecchi: quelli nuovi passano senza, quindi è
#     facile crederlo risolto.
#
# LE INVARIANTI, che sono la ragione per cui è sicuro
#
#  * **non pusha mai** e **non cancella mai un ramo**. La regola 1 di CLAUDE.md
#    dice che non si pusha senza un'istruzione esplicita nella sessione: uno
#    script che lo offresse in un [y/N] la aggirerebbe di fatto, perché una
#    conferma non è un'istruzione, è un riflesso.
#  * **nessun `reset --hard`** se i commit locali portano contenuto che origin
#    non ha. La prova è `git diff --quiet origin/<ramo> <ramo>`: alberi
#    identici = i commit locali non aggiungono niente.
#  * **niente che tocchi l'albero di lavoro** se l'albero è sporco.
#  * ogni comando eseguito viene **stampato prima**.
#  * se `fetch` fallisce lo dice, e non finge di aver confrontato.
#
# Uso: ./scripts/session_start.sh [-y] [--no-fetch]
set -u

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO" || exit 1

YES=0
FETCH=1
for arg in "$@"; do
  case "$arg" in
    -y|--yes)    YES=1 ;;
    --no-fetch)  FETCH=0 ;;
    -h|--help)
      cat <<EOF
Uso: $0 [-y|--yes] [--no-fetch]

  -y, --yes     Accetta senza chiedere le **riparazioni**: fast-forward, reset di
                commit che non aggiungono contenuto, riallineamento dei tag,
                pnpm install. NON allarga cosa propone: la prova sull'albero
                resta condizione necessaria per un reset, quindi -y non può far
                scattare un reset su commit che portano contenuto.
                Il cambio di ramo chiede **sempre**, anche con -y: dove stai
                lavorando non è una riparazione.
  --no-fetch    Non contattare origin. Il confronto usa i remote-tracking ref
                così come sono, e lo script lo dichiara.

Non pusha, non cancella rami, non tocca l'albero se è sporco.
EOF
      exit 0 ;;
    *) echo "Argomento sconosciuto: $arg (usa --help)" >&2; exit 1 ;;
  esac
done

# ── Stile ────────────────────────────────────────────────────────────────────
if [ -t 1 ]; then
  B=$'\e[1m'; V=$'\e[32m'; G=$'\e[33m'; R=$'\e[31m'; C=$'\e[36m'; Z=$'\e[0m'
else
  B=""; V=""; G=""; R=""; C=""; Z=""
fi
titolo() { printf '\n%s── %s %s\n' "$B" "$1" "$Z"; }
ok()     { printf '  %s✓%s %s\n' "$V" "$Z" "$1"; }
info()   { printf '    %s\n' "$1"; }
avviso() { printf '  %s!%s %s\n' "$G" "$Z" "$1"; }
grave()  { printf '  %s✗%s %s\n' "$R" "$Z" "$1"; }

# Stampa il comando e poi lo esegue. Stampare prima non è cosmetica: è ciò che
# permette di vedere cosa sta accadendo invece di fidarsi dello script.
esegui() {
  printf '    %s$ %s%s\n' "$C" "$*" "$Z"
  "$@"
}

# `no` quando non c'è un terminale e non è stato passato -y: uno script lanciato
# da cron o in pipe non deve indovinare un sì.
chiedi() {
  [ "$YES" -eq 1 ] && return 0
  chiedi_sempre "$1"
}

# Chiede **anche con -y**. Serve per le cose che non sono riparazioni di una
# divergenza ma preferenze di lavoro: cambiare ramo è la principale.
#
# Trovato usandolo: con `-y` su un ramo di lavoro lo script portava via a `main`
# senza dire niente. Il lavoro non si perde — il ramo resta — ma ritrovarsi
# altrove è precisamente il genere di sorpresa che rende uno strumento
# inaffidabile, e uno strumento inaffidabile non lo si lancia più. `-y` deve
# accettare le riparazioni, non decidere dove stai lavorando.
chiedi_sempre() {
  if [ ! -t 0 ]; then
    info "(nessun terminale: salto)"
    return 1
  fi
  local risposta
  read -r -p "    ${1} [y/N] " risposta
  case "$risposta" in [yYsS]*) return 0 ;; *) return 1 ;; esac
}

azioni_fatte=0
da_guardare=0

# ── 1. Chi sono e dove sono ──────────────────────────────────────────────────
#
# Per primo, e non per cortesia: il rischio numero uno di questo progetto è il
# contesto perso **fra le macchine**. Leggere «ufficio» in testa all'uscita
# evita di credere di essere su frodo.
titolo "Macchina"
info "$(whoami)@$(hostname)  —  $REPO"
RAMO="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?')"
info "ramo: ${B}${RAMO}${Z}"

# ── 2. Aggiorna i riferimenti remoti ─────────────────────────────────────────
titolo "Confronto con origin"
RETE=1
if [ "$FETCH" -eq 1 ]; then
  if esegui git fetch --prune --quiet; then
    ok "riferimenti remoti aggiornati"
  else
    RETE=0
    grave "fetch fallito: origin non raggiungibile"
    info "Il confronto qui sotto usa i riferimenti remoti come sono ora, e"
    info "può quindi essere **vecchio**. Non è la stessa cosa di «in pari»."
  fi
else
  RETE=0
  avviso "--no-fetch: confronto sui riferimenti remoti esistenti, può essere vecchio"
fi

# ── 3. L'albero di lavoro ────────────────────────────────────────────────────
SPORCO=0
if [ -n "$(git status --porcelain)" ]; then
  SPORCO=1
  titolo "Albero di lavoro"
  grave "ci sono modifiche non committate"
  git status --porcelain | sed 's/^/      /'
  info ""
  info "Finché è così, questo script non propone niente che tocchi l'albero:"
  info "né checkout, né fast-forward, né reset. Committa o metti da parte prima."
  da_guardare=$((da_guardare+1))
fi

# ── 4. Se non sei su main ────────────────────────────────────────────────────
if [ "$RAMO" != "main" ] && [ "$RAMO" != "?" ]; then
  titolo "Non sei su main"
  info "sei su ${B}${RAMO}${Z}"
  if [ "$SPORCO" -eq 0 ]; then
    # `chiedi_sempre`: vedi il commento su quella funzione.
    if chiedi_sempre "Passare a main?"; then
      if esegui git checkout main; then
        RAMO="main"; azioni_fatte=$((azioni_fatte+1))
      fi
    else
      info "Resti su ${RAMO}: il confronto qui sotto riguarda quel ramo."
      da_guardare=$((da_guardare+1))
    fi
  fi
fi

# ── 5. Il ramo corrente contro il suo upstream ───────────────────────────────
#
# `--left-right --count A...B` dà: a sinistra i commit che ha solo A (per noi
# origin, quindi «indietro»), a destra quelli che ha solo B («avanti»).
UP="$(git rev-parse --abbrev-ref --symbolic-full-name '@{upstream}' 2>/dev/null || true)"
if [ -z "$UP" ]; then
  titolo "Ramo ${RAMO}"
  avviso "nessun upstream: questo ramo non ha una controparte su origin"
  N_LOC="$(git rev-list --count "origin/main..${RAMO}" 2>/dev/null || echo '?')"
  info "${N_LOC} commit che origin/main non ha. Se è lavoro da conservare va"
  info "pushato a mano — questo script non pusha."
  # Non conta fra le «cose da guardare»: un ramo di lavoro appena creato è uno
  # stato normale, non una decisione in sospeso. Il segnale che conta è più
  # sotto, sui rami senza upstream **anteriori alla riscrittura**.
else
  CONTA="$(git rev-list --left-right --count "${UP}...${RAMO}" 2>/dev/null || echo '0 0')"
  INDIETRO="$(printf '%s' "$CONTA" | awk '{print $1}')"
  AVANTI="$(printf '%s' "$CONTA" | awk '{print $2}')"

  titolo "Ramo ${RAMO} contro ${UP}"

  if [ "$INDIETRO" -eq 0 ] && [ "$AVANTI" -eq 0 ]; then
    if [ "$RETE" -eq 1 ]; then ok "in pari"; else avviso "in pari, secondo riferimenti non aggiornati"; fi

  elif [ "$AVANTI" -gt 0 ] && [ "$INDIETRO" -eq 0 ]; then
    # Solo avanti. Nessuna azione: il push richiede un'istruzione esplicita.
    avviso "hai ${AVANTI} commit non pushati"
    git log --oneline "${UP}..${RAMO}" | sed 's/^/      /'
    info ""
    info "Questo script non pusha (regola 1 di CLAUDE.md). Se vanno pubblicati,"
    info "  git push origin ${RAMO}"
    da_guardare=$((da_guardare+1))

  elif [ "$INDIETRO" -gt 0 ] && [ "$AVANTI" -eq 0 ]; then
    avviso "sei indietro di ${INDIETRO} commit"
    git log --oneline "${RAMO}..${UP}" | head -10 | sed 's/^/      /'
    # `merge --ff-only` e non `pull`: su una divergenza `pull` tenterebbe un
    # merge, che è precisamente la cosa da non fare in silenzio.
    if [ "$SPORCO" -eq 0 ] && chiedi "Avanzare a ${UP} (fast-forward)?"; then
      esegui git merge --ff-only "$UP" && azioni_fatte=$((azioni_fatte+1))
    else
      da_guardare=$((da_guardare+1))
    fi

  else
    # ── Divergente: il caso che ha fatto nascere questo script ──────────────
    grave "divergente: ${AVANTI} commit solo tuoi, ${INDIETRO} solo su origin"
    info "i tuoi:"
    git log --oneline "${UP}..${RAMO}" | sed 's/^/      /'
    info ""

    if git diff --quiet "$UP" "$RAMO"; then
      # Gli alberi sono identici: i commit locali non aggiungono NIENTE. È la
      # firma del doppione pre-riscrittura, e la prova si mostra invece di
      # affermarla.
      ok "l'albero è identico a ${UP}: quei commit non aggiungono contenuto"
      info "prova: \`git diff ${UP} ${RAMO}\` non produce nulla — stesso contenuto,"
      info "hash diversi. È la versione pre-riscrittura di lavoro già su origin."
      if [ "$SPORCO" -eq 0 ] && chiedi "Buttare i commit locali e allinearsi a ${UP}?"; then
        esegui git reset --hard "$UP" && azioni_fatte=$((azioni_fatte+1))
      else
        da_guardare=$((da_guardare+1))
      fi
    else
      # C'è contenuto locale vero: il reset NON viene offerto.
      grave "quei commit portano contenuto che ${UP} non ha"
      git diff --stat "$UP" "$RAMO" | tail -5 | sed 's/^/      /'
      info ""
      info "Il reset **non** viene offerto: butterebbe lavoro. Si mette al sicuro"
      info "su un ramo, poi lo si guarda con calma."
      SALVA="salvataggio-$(hostname -s 2>/dev/null || echo macchina)-$(date +%Y%m%d)"
      if chiedi "Creare il ramo ${SALVA} sui commit locali?"; then
        esegui git branch "$SALVA" "$RAMO" && azioni_fatte=$((azioni_fatte+1))
        info "Fatto. Ora ${RAMO} si può allineare a mano quando hai deciso:"
        info "  git reset --hard ${UP}"
      fi
      da_guardare=$((da_guardare+1))
    fi
  fi
fi

# ── 6. main, se sei altrove ──────────────────────────────────────────────────
if [ "$RAMO" != "main" ]; then
  if git rev-parse -q --verify refs/heads/main >/dev/null; then
    CONTA_M="$(git rev-list --left-right --count 'origin/main...main' 2>/dev/null || echo '0 0')"
    MI="$(printf '%s' "$CONTA_M" | awk '{print $1}')"
    MA="$(printf '%s' "$CONTA_M" | awk '{print $2}')"
    titolo "main (solo diagnosi, non sei là)"
    if [ "$MI" -eq 0 ] && [ "$MA" -eq 0 ]; then
      ok "main è in pari con origin/main"
    else
      avviso "main: ${MA} commit solo locali, ${MI} solo su origin — rilancia da main"
      da_guardare=$((da_guardare+1))
    fi
  fi
fi

# ── 7. I tag ─────────────────────────────────────────────────────────────────
#
# Il caso dell'ufficio: `git fetch --tags` **rifiuta** i tag che esistono già
# localmente con un altro sha, e li lascia puntati alla storia vecchia. Quindi
# `git describe` mente. Si vede solo sui tag vecchi: quelli nuovi passano.
titolo "Tag"
if [ "$RETE" -eq 0 ]; then
  avviso "origin non contattato: confronto dei tag saltato"
else
  DIVERGENTI=""
  while read -r sha ref; do
    [ -z "${ref:-}" ] && continue
    nome="${ref#refs/tags/}"
    case "$nome" in *"^{}") continue ;; esac
    locale="$(git rev-parse -q --verify "refs/tags/${nome}" 2>/dev/null)" || continue
    [ "$locale" != "$sha" ] && DIVERGENTI="${DIVERGENTI} ${nome}"
  done < <(git ls-remote --tags origin 2>/dev/null)

  if [ -z "$DIVERGENTI" ]; then
    ok "tutti allineati a origin"
  else
    N="$(printf '%s' "$DIVERGENTI" | wc -w)"
    grave "${N} tag puntano a commit diversi da quelli di origin:"
    info "$(printf '%s' "$DIVERGENTI" | tr ' ' '\n' | grep -v '^$' | paste -sd' ')"
    info ""
    info "Sono rimasti alla storia vecchia (riscrittura del 2026-08-31): finché"
    info "sono così, \`git describe\` e \`git show <tag>\` mostrano commit che su"
    info "GitHub non esistono più. \`git fetch --tags\` senza --force li rifiuta."
    if chiedi "Riallinearli a origin?"; then
      esegui git fetch --tags --force && azioni_fatte=$((azioni_fatte+1))
    else
      da_guardare=$((da_guardare+1))
    fi
  fi
fi

# ── 8. I rami locali ─────────────────────────────────────────────────────────
titolo "Rami locali"
# La data della riscrittura della storia. Un ramo senza upstream **anteriore** a
# questa porta con ogni probabilità hash della storia vecchia; uno creato dopo è
# solo un ramo di lavoro, e segnalarlo sarebbe rumore che insegna a ignorare
# l'avviso.
RISCRITTURA="2026-08-31"
SOSPETTI=""
while IFS='|' read -r r u d s; do
  eti=""
  if [ -z "$u" ]; then
    if [ "$d" \< "$RISCRITTURA" ]; then
      eti="(nessun upstream, pre-riscrittura)"
      SOSPETTI="${SOSPETTI} ${r}"
    else
      eti="(nessun upstream)"
    fi
    printf '  %s!%s %-30s %-38s %s  %s\n' "$G" "$Z" "$r" "$eti" "$d" "$(printf '%s' "$s" | cut -c1-30)"
  else
    printf '    %-30s %-38s %s  %s\n' "$r" "$u" "$d" "$(printf '%s' "$s" | cut -c1-30)"
  fi
done < <(git for-each-ref --sort=-committerdate \
           --format='%(refname:short)|%(upstream:short)|%(committerdate:short)|%(subject)' refs/heads)
if [ -n "$SOSPETTI" ]; then
  N_S="$(printf '%s' "$SOSPETTI" | wc -w)"
  info ""
  if [ "$N_S" -eq 1 ]; then
    info "Un ramo senza upstream e anteriore al ${RISCRITTURA}:$(printf '%s' "$SOSPETTI")"
  else
    info "${N_S} rami senza upstream e anteriori al ${RISCRITTURA}:$(printf '%s' "$SOSPETTI")"
  fi
  info "Portano con ogni probabilità storia pre-riscrittura: un push o un merge da"
  info "lì rimetterebbe dentro dei doppioni. Questo script non li cancella."
  da_guardare=$((da_guardare+1))
fi

# ── 9. L'ambiente, prima di lavorare ─────────────────────────────────────────
titolo "Pronto a lavorare?"
for strumento in cargo pnpm node python3; do
  if command -v "$strumento" >/dev/null 2>&1; then
    ok "$strumento"
  else
    avviso "$strumento non è nel PATH"
    da_guardare=$((da_guardare+1))
  fi
done

if [ -d "$REPO/sws-editor/node_modules" ]; then
  ok "sws-editor/node_modules"
else
  avviso "sws-editor/node_modules assente — serve alle build dei container, che"
  info "compilano la SPA da sé"
  if chiedi "Lanciare pnpm install?"; then
    ( cd "$REPO/sws-editor" && esegui pnpm install ) && azioni_fatte=$((azioni_fatte+1))
  else
    da_guardare=$((da_guardare+1))
  fi
fi

# I quattro file che dichiarano la versione. Un disallineamento qui è il difetto
# che la 2.3.4 ha già dovuto correggere una volta (un Cargo.lock che continuava
# a dire 2.1.0), e non si vede da nessun'altra parte.
VERS="$( { grep -m1 -oE '^version = "[0-9.]+"' "$REPO/sws-runtime/Cargo.toml";
           grep -m1 -oE '"version": "[0-9.]+"'  "$REPO/sws-editor/package.json";
           grep -m1 -oE '^version = "[0-9.]+"' "$REPO/sws-runtime/crates/sws-kiosk/Cargo.toml";
           grep -m1 -oE '^version = "[0-9.]+"' "$REPO/sws-runtime/crates/sws-lvgl-viewer/Cargo.toml";
         } 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | sort -u )"
N_VERS="$(printf '%s\n' "$VERS" | grep -c .)"
if [ "$N_VERS" -eq 1 ]; then
  ok "versione dichiarata: ${VERS} (coerente nei quattro file)"
else
  grave "i quattro file che dichiarano la versione non sono d'accordo: $(printf '%s' "$VERS" | paste -sd' ')"
  da_guardare=$((da_guardare+1))
fi

# ── 10. Da dove si riprende ──────────────────────────────────────────────────
#
# In coda, e non in testa: se le azioni sopra hanno portato uno STATUS.md nuovo,
# quello che si legge deve essere il nuovo.
titolo "Da dove si riprende"
info "$(git log --oneline -1)"
DESCR="$(git describe --tags 2>/dev/null || echo '(nessun tag)')"
info "git describe: ${DESCR}"
if [ -f "$REPO/STATUS.md" ]; then
  info ""
  awk '
    /^## ▶ Da fare nella prossima sessione/ { dentro=1; next }
    dentro && /^## /                        { exit }
    dentro && /^### /                       { if (visto) exit; visto=1; print "  " $0; next }
    visto && righe < 6                      { print "  " $0; righe++ }
  ' "$REPO/STATUS.md"
  info ""
  info "Il resto in STATUS.md, docs/CONTEXT.md e docs/OPEN_QUESTIONS.md."
fi

# ── Chiusura ─────────────────────────────────────────────────────────────────
printf '\n'
if [ "$da_guardare" -eq 0 ]; then
  printf '%s%sTutto in pari.%s' "$B" "$V" "$Z"
  if [ "$azioni_fatte" -eq 1 ]; then printf ' Una azione fatta.'
  elif [ "$azioni_fatte" -gt 1 ]; then printf ' %s azioni fatte.' "$azioni_fatte"; fi
  printf '\n'
  exit 0
else
  if [ "$da_guardare" -eq 1 ]; then
    printf '%s%sUna cosa da guardare%s' "$B" "$G" "$Z"
  else
    printf '%s%s%s cose da guardare%s' "$B" "$G" "$da_guardare" "$Z"
  fi
  if [ "$azioni_fatte" -eq 1 ]; then printf ' — una azione fatta'
  elif [ "$azioni_fatte" -gt 1 ]; then printf ' — %s azioni fatte' "$azioni_fatte"; fi
  printf '. Vedi sopra.\n'
  exit 0
fi
