#!/usr/bin/env bash
#
# `session_start.sh` non deve poter perdere lavoro.
#
# PERCHÉ ESISTE
#
# Quello script contiene un `git reset --hard`, e un `reset --hard` sbagliato
# butta commit. La condizione che lo autorizza è una sola — `git diff --quiet`
# fra il ramo e il suo upstream, cioè «i commit locali non aggiungono contenuto»
# — e se quella condizione si rompe o viene aggirata, il danno è silenzioso e
# irreversibile. Un percorso così si merita una guardia.
#
# COME
#
# Si fabbrica una coppia origin/clone in una directory temporanea e si
# ricostruiscono i sei stati che lo script deve saper distinguere, poi si
# verifica il **verdetto**: cosa ha fatto, e soprattutto cosa NON ha fatto.
# Il caso 5 è quello che conta.
#
# **Mai sul repo vero.** Fabbricare una divergenza in ~/sws per poi resettarla è
# esattamente il modo di perdere il lavoro che quello script esiste per evitare.
#
# Uso: ./scripts/check_session_start.sh
set -u

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOTTO_ESAME="$REPO/scripts/session_start.sh"
SCR="${TMPDIR:-/tmp}/sws-check-session-start"

[ -x "$SOTTO_ESAME" ] || { echo "manca $SOTTO_ESAME" >&2; exit 1; }

fatti=0; passati=0
esito() {
  fatti=$((fatti+1))
  if [ "$1" = ok ]; then passati=$((passati+1)); echo "  ✓ $2"; else echo "  ✗ $2"; fi
}

# Un clone di prova con dentro lo script sotto esame. Lo script fa `cd` sulla
# radice ricavata da BASH_SOURCE, quindi va copiato **dentro** il repo di prova:
# è anche il modo in cui verrà usato davvero.
prepara() {
  rm -rf "$SCR"; mkdir -p "$SCR"
  (
    cd "$SCR" || exit 1
    # `--initial-branch=main` su **entrambi**, e non un `git branch -M` dopo.
    # `git init --bare` lascia HEAD su `refs/heads/master`: spingere `main` crea
    # il ref ma HEAD continua a puntare a un ramo che non esiste, e il clone
    # successivo nasce **vuoto** con il solo `remotes/origin/main`. La guardia
    # in quello stato dava 7/18 «verdi», e metà erano confronti fra due stringhe
    # vuote — verde per caso, che è peggio di rosso.
    git init -q --bare --initial-branch=main origin.git
    git clone -q origin.git altro
    cd altro || exit 1
    git config user.email prova@example.com; git config user.name Prova
    git checkout -q -b main 2>/dev/null || true
    echo base > base.txt
    git add base.txt
    git commit -q -m "base"
    git push -q -u origin main
  ) >/dev/null 2>&1
  git clone -q "$SCR/origin.git" "$SCR/work" >/dev/null 2>&1
  (
    cd "$SCR/work" || exit 1
    git config user.email prova@example.com; git config user.name Prova
    mkdir -p scripts
    cp "$SOTTO_ESAME" scripts/
    # Lo script copiato resterebbe **non tracciato**, quindi l'albero
    # risulterebbe sporco — e a quel punto `session_start.sh` si rifiuta
    # (giustamente) di toccarlo, e i casi «indietro» e «albero identico»
    # falliscono per la ragione sbagliata. Committarlo invece lo renderebbe un
    # commit locale, cioè «avanti», inquinando gli stati da fabbricare.
    # `info/exclude` è la sola via che lascia l'albero pulito senza aggiungere
    # storia. (La prima stesura non lo faceva: 15/18, e le tre rosse erano tutte
    # questa.)
    printf 'scripts/\n' >> .git/info/exclude
  )
}

# Un commit sul lato origin, passando dall'altro clone.
commit_su_origin() {
  ( cd "$SCR/altro" && git pull -q --ff-only && echo "$2" > "$1" \
      && git add "$1" && git commit -q -m "$3" && git push -q origin main ) >/dev/null 2>&1
}

lancia() { ( cd "$SCR/work" && ./scripts/session_start.sh -y 2>&1 ); }
sha_work()   { ( cd "$SCR/work" && git rev-parse HEAD ); }
sha_origin() { ( cd "$SCR/work" && git rev-parse origin/main ); }

# ── 1. In pari: non deve fare niente ────────────────────────────────────────
echo "=== 1. in pari ==="
prepara
PRIMA="$(sha_work)"
U="$(lancia)"
if printf '%s' "$U" | grep -q 'in pari'; then esito ok "dice «in pari»"; else esito no "non dice «in pari»"; fi
[ "$(sha_work)" = "$PRIMA" ] && esito ok "HEAD non è stato toccato" \
                             || esito no "HEAD è cambiato senza motivo"

# ── 2. Solo indietro: fast-forward ──────────────────────────────────────────
echo "=== 2. solo indietro ==="
prepara
commit_su_origin nuovo.txt "da origin" "avanti su origin"
U="$(lancia)"
if [ "$(sha_work)" = "$(sha_origin)" ]; then
  esito ok "ha fatto il fast-forward"
else
  esito no "non ha avanzato: $(sha_work) != $(sha_origin)"
fi
printf '%s' "$U" | grep -q 'indietro' && esito ok "lo aveva detto" || esito no "non l'ha detto"

# ── 3. Solo avanti: NON deve toccare niente ─────────────────────────────────
echo "=== 3. solo avanti ==="
prepara
( cd "$SCR/work" && echo mio > mio.txt && git add mio.txt \
    && git commit -q -m "solo mio" ) >/dev/null 2>&1
PRIMA="$(sha_work)"
U="$(lancia)"
[ "$(sha_work)" = "$PRIMA" ] && esito ok "il commit locale è ancora lì" \
                             || esito no "HA TOCCATO un commit non pushato"
printf '%s' "$U" | grep -q 'non pushat' && esito ok "nomina i commit non pushati" \
                                        || esito no "non li nomina"
printf '%s' "$U" | grep -qi 'git push origin' && esito ok "suggerisce il comando senza eseguirlo" \
                                              || esito no "non suggerisce niente"

# ── 4. Divergente con albero identico: il caso dell'ufficio ─────────────────
#
# Origin e locale aggiungono lo **stesso** file con lo **stesso** contenuto, con
# messaggi diversi: gli alberi coincidono, le storie no. È la firma del doppione
# pre-riscrittura, e lo script deve riconoscerla e allinearsi.
echo "=== 4. divergente, albero identico ==="
prepara
commit_su_origin doppio.txt "contenuto identico" "versione su origin"
( cd "$SCR/work" && git fetch -q origin && echo "contenuto identico" > doppio.txt \
    && git add doppio.txt && git commit -q -m "versione locale pre-riscrittura" ) >/dev/null 2>&1
LOCALE="$(sha_work)"
U="$(lancia)"
if [ "$(sha_work)" = "$(sha_origin)" ]; then
  esito ok "si è allineato a origin"
else
  esito no "non si è allineato"
fi
[ "$(sha_work)" != "$LOCALE" ] && esito ok "il commit doppione non è più su HEAD" \
                              || esito no "il doppione è rimasto"
printf '%s' "$U" | grep -q 'albero è identico' && esito ok "ha mostrato la prova" \
                                               || esito no "non ha mostrato la prova"

# ── 5. Divergente con contenuto vero: NON deve resettare ───────────────────
#
# **La prova che conta.** Se questa passa, un difetto in quello script non può
# perdere lavoro; se cade, può.
echo "=== 5. divergente, contenuto locale vero ==="
prepara
commit_su_origin daorigin.txt "roba di origin" "commit di origin"
( cd "$SCR/work" && git fetch -q origin && echo "lavoro mio, unico" > soloMio.txt \
    && git add soloMio.txt && git commit -q -m "lavoro che esiste solo qui" ) >/dev/null 2>&1
LOCALE="$(sha_work)"
U="$(lancia)"
if [ "$(sha_work)" = "$LOCALE" ]; then
  esito ok "NON ha resettato: il commit locale è ancora su HEAD"
else
  esito no "HA RESETTATO del lavoro vero — difetto grave"
fi
if ( cd "$SCR/work" && git rev-parse -q --verify "$LOCALE" >/dev/null ); then
  esito ok "il commit locale è comunque raggiungibile"
else
  esito no "il commit locale non è più raggiungibile"
fi
if ( cd "$SCR/work" && git for-each-ref --format='%(refname:short)' refs/heads \
       | grep -q '^salvataggio-' ); then
  esito ok "ha creato il ramo di salvataggio"
else
  esito no "nessun ramo di salvataggio"
fi
printf '%s' "$U" | grep -q 'non.*viene offerto' && esito ok "dice perché non offre il reset" \
                                                || esito no "non spiega"

# ── 6. Tag divergente: l'altro difetto dell'ufficio ────────────────────────
echo "=== 6. tag che punta alla storia vecchia ==="
prepara
# origin mette il tag su un suo commit...
commit_su_origin taggato.txt "x" "commit da taggare"
( cd "$SCR/altro" && git pull -q --ff-only && git tag -a 1.0.0 -m "1.0.0" \
    && git push -q origin 1.0.0 ) >/dev/null 2>&1
# ...e il clone ha lo stesso nome puntato altrove (la «storia vecchia»).
( cd "$SCR/work" && git tag -a 1.0.0 -m "1.0.0 vecchio" HEAD ) >/dev/null 2>&1
VECCHIO="$( cd "$SCR/work" && git rev-parse refs/tags/1.0.0 )"
U="$(lancia)"
NUOVO="$( cd "$SCR/work" && git rev-parse refs/tags/1.0.0 )"
REMOTO="$( cd "$SCR/work" && git ls-remote --tags origin 2>/dev/null \
             | awk '$2=="refs/tags/1.0.0"{print $1}' )"
printf '%s' "$U" | grep -q 'commit diversi da quelli di origin' \
  && esito ok "ha visto il tag divergente" || esito no "non l'ha visto"
if [ "$NUOVO" != "$VECCHIO" ] && [ "$NUOVO" = "$REMOTO" ]; then
  esito ok "l'ha riallineato a origin"
else
  esito no "il tag è ancora sbagliato ($NUOVO)"
fi

# ── 7. Albero sporco: niente che lo tocchi ─────────────────────────────────
echo "=== 7. albero sporco ==="
prepara
commit_su_origin altro.txt "y" "avanti su origin"
( cd "$SCR/work" && echo "non committato" > bozza.txt ) >/dev/null 2>&1
PRIMA="$(sha_work)"
U="$(lancia)"
[ "$(sha_work)" = "$PRIMA" ] && esito ok "non ha avanzato con l'albero sporco" \
                             || esito no "ha toccato l'albero mentre era sporco"
[ -f "$SCR/work/bozza.txt" ] && esito ok "il file non committato è ancora lì" \
                             || esito no "IL FILE NON COMMITTATO È SPARITO"

rm -rf "$SCR"
echo
if [ "$passati" = "$fatti" ]; then
  echo "tutte e $fatti le prove verdi."
else
  echo "$passati/$fatti verdi — vedi sopra." >&2
  exit 1
fi
