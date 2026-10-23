#!/usr/bin/env bash
#
# Le etichette di contenuto dell'immagine non entrano nei container.
#
# Perché. L'immagine porta ~5,9 kB di etichette e le tre grosse sono testo:
# `novita.it`, `novita.en` e `changelog` fanno 4 717 byte da sole. Podman
# scrive TUTTE le etichette di un container dentro OGNI evento che manda al
# journal, e il controllo di salute ne produce due ogni 30 secondi. Misurato su
# una finestra vera: 29 664 byte di journal per ciclo con le etichette, 8 652
# senza — il 71 % in meno. Sul pannello del maintainer il journal era saturato
# dai messaggi di aggiornamento (22-10-2026).
#
# Svuotarle nei container non toglie niente: il controllo degli aggiornamenti
# legge le etichette dal REGISTRY, non dal container che gira.
#
# Questa guardia tiene allineati i QUATTRO posti che devono dire la stessa cosa:
# i due quadlet del pannello, quello del gateway sul VPS, e l'elenco in Rust da
# cui nascono i container dei progetti. Uno che resta indietro non si vede: il
# container parte lo stesso, e il journal ricomincia a crescere in silenzio.
#
# Uso: ./scripts/check_etichette_container.sh   (statica, nessuno stack)
set -uo pipefail
cd "$(dirname "$0")/.."

male=0
ok() { if [ "$1" = 1 ]; then printf '  \033[32m✓\033[0m %s\n' "$2"; else printf '  \033[31m✗\033[0m %s\n' "$2"; male=1; fi; }

QUADLET=(deploy/container/sws-runtime.container
         deploy/container/sws-lvgl-viewer.container
         deploy/vps/quadlet/sws-gateway.container)
RUST=sws-runtime/crates/sws-web/src/gateway/podman.rs

# Le etichette `net.soligo.sws.*` che l'immagine dichiara.
nelle_immagini=$(grep -ho 'net\.soligo\.sws\.[a-z.]*' deploy/container/Containerfile.aarch64 deploy/container/Containerfile.x86_64 \
  | sed 's/\.$//' | sort -u)
# Quelle che un quadlet azzera (`Label=nome=`).
azzerate_quadlet() { grep -ho '^Label=net\.soligo\.sws\.[a-z.]*=$' "$1" | sed 's/^Label=//; s/=$//' | sort -u; }
# E quelle che l'elenco in Rust azzera.
azzerate_rust=$(sed -n '/ETICHETTE_DA_SVUOTARE/,/\];/p' "$RUST" | grep -o '"net\.soligo\.sws\.[a-z.]*"' | tr -d '"' | sort -u)

# `quadlet` è un numero, lo legge il controllo aggiornamenti dal registry, e
# pesa decine di byte: resta. Se un giorno diventasse testo, va spostata sopra.
ESENTI="net.soligo.sws.quadlet"

echo "== le etichette pesanti non entrano nei container =="

atteso=$(comm -23 <(echo "$nelle_immagini") <(echo "$ESENTI" | sort -u))
[ -n "$atteso" ] && ok 1 "l'immagine dichiara $(echo "$atteso" | wc -l) etichette di contenuto da azzerare" \
                 || ok 0 "nessuna etichetta di contenuto trovata nei Containerfile — la guardia non sta misurando niente"

for q in "${QUADLET[@]}"; do
    [ -f "$q" ] || { ok 0 "manca $q"; continue; }
    got=$(azzerate_quadlet "$q")
    if [ "$got" = "$atteso" ]; then
        ok 1 "$(basename "$q"): le azzera tutte"
    else
        ok 0 "$(basename "$q"): disallineato — manca «$(comm -23 <(echo "$atteso") <(echo "$got") | tr '\n' ' ')» di troppo «$(comm -13 <(echo "$atteso") <(echo "$got") | tr '\n' ' ')»"
    fi
done

if [ "$azzerate_rust" = "$atteso" ]; then
    ok 1 "ETICHETTE_DA_SVUOTARE (i container dei progetti sul VPS) dice lo stesso"
else
    ok 0 "ETICHETTE_DA_SVUOTARE disallineato — manca «$(comm -23 <(echo "$atteso") <(echo "$azzerate_rust") | tr '\n' ' ')»"
fi

# L'etichetta con cui il gateway ritrova i suoi container NON va azzerata: è
# l'unica che si legge davvero dal container, e senza il gateway non riadotta
# più niente dopo un riavvio.
rif=$(grep -o 'ETICHETTA_RIFERIMENTO: &str = "[^"]*"' "$RUST" | sed 's/.*"\(.*\)"/\1/')
if echo "$azzerate_rust" | grep -qx "$rif"; then
    ok 0 "«$rif» è fra quelle azzerate: il gateway non ritroverebbe più i container dei progetti"
else
    ok 1 "«$rif» non è azzerata: il gateway continua a ritrovare i suoi container"
fi
for q in "${QUADLET[@]}"; do
    grep -q "^Label=$rif=" "$q" && { ok 0 "$(basename "$q") azzera «$rif»"; }
done

# Il controllo di salute del viewer: misurava il runtime (Network=host) e non
# lo leggeva nessuno. Se qualcuno lo riaccende, deve essere una scelta.
V=deploy/container/sws-lvgl-viewer.container
if grep -q '^HealthCmd=none' "$V"; then
    ok 1 "il viewer non ha un controllo di salute (misurava il runtime, e nessuno lo leggeva)"
else
    ok 0 "il viewer ha di nuovo un controllo di salute: con Network=host misura il runtime, e raddoppia il journal"
fi
# E quello del runtime invece DEVE restare: ci sta sopra `Notify=healthy`, cioè
# il ritorno automatico a una versione che non diventa sana.
R=deploy/container/sws-runtime.container
grep -q '^Notify=healthy' "$R" && ! grep -q '^HealthCmd=none' "$R" \
  && ok 1 "il runtime lo tiene, ed è giusto: ci sta sopra Notify=healthy" \
  || ok 0 "il runtime ha perso Notify=healthy o ha spento il controllo di salute: l'aggiornamento non torna più indietro da solo"

[ "$male" -eq 0 ] && echo -e "\033[32mle etichette pesanti restano nell'immagine e non nei container.\033[0m"
exit "$male"
