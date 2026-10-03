#!/usr/bin/env bash
#
# `deploy/container/immagini.sh` su un pannello finto (03-10-2026).
#
# Un podman finto tiene le immagini in una cartella (una sottocartella per ID,
# con nomi, versione, byte e data di creazione) e registra ogni chiamata;
# systemctl finto registra e basta. Si provano i tre comandi dello script:
# `stato` (prima volta e dopo un cambio d'immagine), `pulisci` (tiene attuale,
# precedente e quelle in uso) e `ritorna` (dati dall'istantanea, quadlet o tag).
#
# Lo lancia scripts/check_quadlet.sh. Uso diretto: tests/shell/immagini.sh
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
LOG="$T/chiamate.log"
DB="$T/img"
mkdir -p "$T/bin" "$DB" "$T/unit" "$T/data/config" "$T/data/projects"
export SWS_IMMAGINI_UNIT_DIR="$T/unit"

cat > "$T/bin/podman" <<EOF
#!/usr/bin/env bash
DB="$DB"
echo "podman \$*" >> "$LOG"
case "\$1 \$2" in
  "inspect sws-runtime") cat "$T/attuale" ;;
  "images -a") for d in "\$DB"/*; do [ -d "\$d" ] && echo "sha256:\$(basename "\$d")"; done ;;
  "ps -a") cat "$T/inuso" 2>/dev/null ;;
  "image exists") [ -d "\$DB/\$3" ] ;;
  "image inspect")
     [ -d "\$DB/\$3" ] || exit 1
     case "\$5" in
       *RepoTags*) cat "\$DB/\$3/nomi" ;;
       *image.version*) cat "\$DB/\$3/versione" ;;
       *Size*) cat "\$DB/\$3/byte" ;;
       *Created*) cat "\$DB/\$3/creata" ;;
     esac ;;
  "rmi -f") rm -rf "\$DB/\$3" ;;
  "tag "*) : ;;
  "info --format") echo "$T/storage" ;;
esac
EOF
cat > "$T/bin/systemctl" <<EOF
#!/usr/bin/env bash
echo "systemctl \$*" >> "$LOG"
EOF
# df finto: lo spazio libero cresce di 100 per ogni immagine tolta.
cat > "$T/bin/df" <<EOF
#!/usr/bin/env bash
echo Avail; echo \$(( 10000 - 100 * \$(ls "$DB" | wc -l) ))
EOF
chmod +x "$T/bin/podman" "$T/bin/systemctl" "$T/bin/df"
export PATH="$T/bin:$PATH"

immagine() {  # immagine <id> <versione> <byte> <creata> <nomi>
    mkdir -p "$DB/$1"
    echo "$2" > "$DB/$1/versione"; echo "$3" > "$DB/$1/byte"; echo "$4" > "$DB/$1/creata"; echo "$5" > "$DB/$1/nomi"
}
immagine aaa 2.12.0-dev.1 100 10 "localhost/sws-runtime:2.12.0-dev.1-arm64"
immagine bbb 2.12.0-rc.14 100 20 "localhost/sws-runtime:2.12.0-rc.14-arm64"
immagine ccc 2.12.0-rc.16 100 30 "localhost/sws-runtime:2.12.0-rc.16-arm64"
immagine ddd 2.12.0-rc.12 100 25 "ghcr.io/soligolab/sws-runtime:rc-arm64"
immagine eee 2.12.0-rc.17 100 40 "localhost/sws-runtime:2.12.0-rc.17-arm64"
echo eee > "$T/attuale"
printf 'eee\neee\n' > "$T/inuso"

C="$T/data/config"
cat > "$T/unit/sws-runtime.container" <<EOF
[Container]
Image=localhost/sws-runtime:2.12.0-rc.17-arm64
Environment=SWS_IMAGE=localhost/sws-runtime:2.12.0-rc.17-arm64
Volume=$T/data/config:/var/sws/config
Volume=$T/data/projects:/var/sws/projects
EOF
sed 's/^Environment=.*//' "$T/unit/sws-runtime.container" > "$T/unit/sws-lvgl-viewer.container"
S="$REPO/deploy/container/immagini.sh"
esci=0
prova() { if eval "$2"; then echo "  ✓ $1"; else echo "  ✗ $1"; esci=1; fi; }
j() { python3 -c "import json,sys; d=json.load(open('$C/immagini.json')); print($1)"; }

# ── stato, prima volta: la precedente è la più recente fra le altre ──────────
bash "$S" stato "$C" > "$T/out.log"
prova "stato prima volta: attuale eee"                 "[ \"\$(j \"d['attuale']['id']\")\" = eee ]"
prova "stato prima volta: precedente la più recente"   "[ \"\$(j \"d['precedente']['versione']\")\" = 2.12.0-rc.16 ]"
prova "stato: da togliere = le altre tre"              "[ \"\$(j \"d['da_togliere']\")\" = 3 ]"

# ── stato dopo un aggiornamento: quella di prima diventa la precedente ────────
immagine fff 2.12.0-rc.18 100 50 "localhost/sws-runtime:2.12.0-rc.18-arm64"
echo fff > "$T/attuale"; printf 'fff\n' > "$T/inuso"
bash "$S" stato "$C" > "$T/out.log"
prova "dopo un cambio: precedente = l'attuale di prima" "[ \"\$(j \"d['precedente']['id']\")\" = eee ]"

# ── ritorna, con istantanea, da archivio ─────────────────────────────────────
mkdir -p "$C/istantanea/config" "$C/istantanea/projects/casa/history" "$T/data/projects/casa/history" "$T/data/projects/casa/backups"
echo "vecchio" > "$C/istantanea/config/aggiornamento.yaml"
echo "nuovo"   > "$C/aggiornamento.yaml"
echo "db vecchio" > "$C/istantanea/projects/casa/history/historian.db"
echo "name: vecchio" > "$C/istantanea/projects/casa/project.yaml"
echo "db nuovo" > "$T/data/projects/casa/history/historian.db"
echo "wal nuovo" > "$T/data/projects/casa/history/historian.db-wal"
echo "copia" > "$T/data/projects/casa/history/historian-prima-della-pulizia-x.db"
echo "name: nuovo" > "$T/data/projects/casa/project.yaml"
echo "backup" > "$T/data/projects/casa/backups/b"
: > "$LOG"
bash "$S" ritorna "$C" 2.12.0-rc.18 > "$T/out.log"
prova "ritorna: config rimessa"                        "grep -q vecchio '$C/aggiornamento.yaml'"
prova "ritorna: progetto rimesso"                      "grep -q vecchio '$T/data/projects/casa/project.yaml'"
prova "ritorna: storico rimesso"                       "grep -q 'db vecchio' '$T/data/projects/casa/history/historian.db'"
prova "ritorna: via il -wal della versione nuova"      "[ ! -e '$T/data/projects/casa/history/historian.db-wal' ]"
prova "ritorna: la copia «prima della pulizia» resta"  "[ -f '$T/data/projects/casa/history/historian-prima-della-pulizia-x.db' ]"
prova "ritorna: i backups/ restano"                    "[ -f '$T/data/projects/casa/backups/b' ]"
prova "ritorna: quadlet sulla precedente (archivio)"   "grep -q '^Image=localhost/sws-runtime:2.12.0-rc.17-arm64$' '$T/unit/sws-runtime.container' && grep -q '^Image=localhost/sws-runtime:2.12.0-rc.17-arm64$' '$T/unit/sws-lvgl-viewer.container'"
prova "ritorna: ferma prima, riavvia dopo"             "grep -n 'stop' '$LOG' | head -1 | grep -q sws-runtime && tail -1 '$LOG' | grep -q 'start sws-runtime'"
prova "ritorna: esito con dati e versione scartata"    "python3 -c \"import json; d=json.load(open('$C/ritorno.json')); assert d['esito']=='riuscito' and d['dati'] and d['scartata']=='2.12.0-rc.18'\""
prova "ritorna: lo stato ora dice attuale eee"         "grep -q '^attuale=eee' '$C/immagini.stato' && grep -q '^precedente=fff' '$C/immagini.stato'"

# ── ritorna dal registro: la precedente senza nome localhost si ritagga ──────
echo ddd > "$T/attuale"
printf 'attuale=ddd\nprecedente=bbb\n' > "$C/immagini.stato"
sed -i 's|^Image=.*|Image=ghcr.io/soligolab/sws-runtime:rc-arm64|' "$T/unit/sws-runtime.container"
echo "ghcr.io/soligolab/sws-runtime:2.12.0-rc.14-arm64" > "$DB/bbb/nomi"
rm -rf "$C/istantanea"
: > "$LOG"
bash "$S" ritorna "$C" 2.12.0-rc.12 > "$T/out.log"
prova "registro: podman tag della precedente sul canale" "grep -q 'podman tag bbb ghcr.io/soligolab/sws-runtime:rc-arm64' '$LOG'"
prova "registro: senza istantanea, dati=false"         "python3 -c \"import json; assert not json.load(open('$C/ritorno.json'))['dati']\""

# ── pulisci: tiene attuale, precedente e quelle in uso ───────────────────────
echo fff > "$T/attuale"; printf 'fff\naaa\n' > "$T/inuso"
printf 'attuale=fff\nprecedente=eee\n' > "$C/immagini.stato"
mkdir -p "$C/istantanea/config"
bash "$S" pulisci "$C" > "$T/out.log"
prova "pulisci: resta l'attuale"                       "[ -d '$DB/fff' ]"
prova "pulisci: resta la precedente"                   "[ -d '$DB/eee' ]"
prova "pulisci: resta quella in uso da un container"   "[ -d '$DB/aaa' ]"
prova "pulisci: tolte le altre"                        "[ ! -d '$DB/bbb' ] && [ ! -d '$DB/ccc' ] && [ ! -d '$DB/ddd' ]"
prova "pulisci: tolta l'istantanea"                    "[ ! -d '$C/istantanea' ]"
prova "pulisci: esito nel JSON"                        "[ \"\$(j \"d['pulizia']['liberati_byte']\")\" = 300 ] && [ \"\$(j \"len(d['pulizia']['tolte'])\")\" = 3 ]"
bash "$S" pulisci "$C" > "$T/out.log"
prova "pulisci di nuovo: niente da togliere"           "[ \"\$(j \"d['pulizia']['liberati_byte']\")\" = 0 ]"

if [ "$esci" -ne 0 ]; then
    echo "  ultima uscita:"; sed 's/^/      /' "$T/out.log"
    echo "  chiamate:"; sed 's/^/      /' "$LOG" | tail -20
fi
exit "$esci"
