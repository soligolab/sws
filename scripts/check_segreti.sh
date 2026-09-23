#!/usr/bin/env bash
# I segreti di progetto stanno in un posto solo, e non escono da lì.
#
# PERCHÉ ESISTE
#
# Fino al 22-09-2026 sette campi con credenziali vivevano in chiaro dentro
# `project.yaml` — quindi nei backup, nell'export, nei commit git — e la
# maschera di redazione ne copriva **tre**: token HomeAssistant, password del
# client OPC-UA, password Postgres e stringa di connessione ODBC arrivavano in
# chiaro al browser e al fornitore LLM esterno. Il Passo 2 del piano di
# stabilizzazione li ha spostati in `secrets.yaml` (0600) e ha chiuso le
# perdite. Questa guardia impedisce che la cosa si riapra da sola.
#
# Le quattro classi di difetto che controlla — tutte già viste, nessuna
# inventata:
#
#   1. CAMPO SEGRETO NUOVO DIMENTICATO. Chi aggiunge un `api_key` a
#      `project.rs` fra sei mesi non penserà a `segreti.rs`: il campo
#      nascerebbe in chiaro ovunque e nessun test lo noterebbe. Ogni campo il
#      cui nome somiglia a un segreto deve stare nella tabella
#      (`CAMPI_COPERTI`) o nelle eccezioni motivate qui sotto.
#   2. UNA SCRITTURA DI `project.yaml` IN PIÙ. I punti che nominano quel file
#      sono un elenco chiuso, con un tetto per file: chi ne aggiunge uno deve
#      passare di qui e dire come ci viaggiano i segreti.
#   3. UN SEGRETO NEI LOG. Nessuna macro di log può interpolare una variabile
#      che si chiama token/password/secret/pwd, e chi compone l'URL di Telegram
#      (`/bot<token>/…`) deve nominare la redazione nello stesso file.
#   4. UN SEGRETO IN UN TEMPLATE. I template si copiano per fare progetti
#      nuovi: una credenziale lì dentro si moltiplica.
#
# Uso:  ./scripts/check_segreti.sh    (esce != 0 se una regola cade)
set -uo pipefail
cd "$(dirname "$0")/.."

CORE=sws-runtime/crates/sws-core/src
CRATES=sws-runtime/crates
rosso=0
ok()   { echo -e "  \033[32m✓\033[0m $*"; }
male() { echo -e "  \033[31m✗\033[0m $*"; rosso=1; }

# Il codice che gira, senza i test: un test DEVE poter scrivere una password
# finta e un `project.yaml` a mano. Si taglia al primo `#[cfg(test)]`, che in
# questo repo apre sempre il modulo di prova in fondo al file.
senza_test() { awk -v F="$1" '/^#\[cfg\(test\)\]/{exit} {print F":"FNR": "$0}' "$1"; }

# ── 1. ogni campo che somiglia a un segreto è nella tabella ──────────────────
#
# Eccezioni, con la ragione. `*_env` è il NOME di una variabile d'ambiente, non
# il suo contenuto: dirlo in chiaro è il punto di quel campo. `LangEntry.key` è
# il token `{{chiave}}` della tabella lingue.
ECCEZIONI=(
    "HomeAssistantConfig.token_env"
    "MqttConfig.password_env"
    "UsernamePassword.password_env"
    "LangEntry.key"
)

coperti=$(grep -oE '"[A-Za-z]+\.[a-z_]+"' "$CORE/segreti.rs" | tr -d '"')
if [ -z "$coperti" ]; then
    male "non trovo CAMPI_COPERTI in $CORE/segreti.rs: la guardia non sta guardando niente"
else
    # Il proprietario di un campo è la struct, l'enum o la **variante** che lo
    # precede: `Postgres { password: … }` conta come `Postgres.password`.
    dichiarati=$(awk '
        /^(pub )?(struct|enum) /            { split($0, a, " "); t = a[length(a)-1]; sub(/[<{].*/, "", t) }
        /^    [A-Z][A-Za-z0-9]* \{/         { t = $1 }
        /^\s*(pub )?[a-z_]*(pass|token|secret|key|pwd|connection_string)[a-z_]*:/ {
            campo = $0; sub(/^[ \t]*(pub )?/, "", campo); sub(/:.*/, "", campo)
            print t "." campo
        }
    ' "$CORE/project.rs" | sort -u)

    mancanti=""
    for d in $dichiarati; do
        grep -qx "$d" <<< "$coperti" && continue
        trovata=0
        for e in "${ECCEZIONI[@]}"; do [ "$e" = "$d" ] && trovata=1; done
        [ "$trovata" -eq 1 ] || mancanti="$mancanti $d"
    done
    if [ -z "$mancanti" ]; then
        ok "i campi con nome da segreto di project.rs sono tutti nella tabella o fra le eccezioni"
    else
        male "campo che somiglia a un segreto e non è nella tabella di segreti.rs:$mancanti"
        echo "      → o lo aggiungi a CAMPI_COPERTI (e a estrai/applica), o lo motivi in ECCEZIONI qui dentro"
    fi
fi

# ── 2. i punti che nominano project.yaml sono un elenco chiuso ───────────────
#
# file → quanti punti, fuori dai test, nominano "project.yaml". Il tetto
# scende, non sale: chi ne aggiunge uno spiega qui perché, e soprattutto come
# ci passano i segreti (la risposta giusta è «da scrivi_progetto»).
declare -A TETTO=(
    [sws-runtime/crates/sws-web/src/projects.rs]=9        # crea/duplica/rinomina/migra: ogni scrittura passa da scrivi_progetto
    [sws-runtime/crates/sws-web/src/router.rs]=6          # patch_project, export, import, impronta
    [sws-runtime/crates/sws-web/src/backups.rs]=1         # BACKED_UP: il nome del file, non una scrittura
    [sws-runtime/crates/sws-web/src/istantanea.rs]=2      # confronto fra istantanee (sola lettura)
    [sws-runtime/crates/sws-web/src/project_registry.rs]=1 # esiste? (sola lettura)
    [sws-runtime/crates/sws-runtime/src/main.rs]=1        # esiste? (sola lettura)
)
sforati=""
for f in $(grep -rl '"project\.yaml"' --include='*.rs' "$CRATES"/*/src); do
    n=$(senza_test "$f" | grep -c '"project\.yaml"')
    [ "$n" -eq 0 ] && continue
    tetto=${TETTO[$f]:-0}
    [ "$n" -le "$tetto" ] || sforati="$sforati\n      $f: $n (tetto $tetto)"
done
if [ -z "$sforati" ]; then
    ok "nessun punto nuovo che nomina project.yaml"
else
    male "project.yaml nominato in punti nuovi — di' qui come ci viaggiano i segreti:"
    echo -e "$sforati"
fi

# ── 3. niente segreti nei log, e l'URL di Telegram sempre redatto ────────────
LOG='(info|warn|error|debug|trace|println|eprintln)!'
VALORE='[{%](bot_token|token|password|passwd|pwd|secret)[}, ]'
trovate=""
for f in $(find "$CRATES" -name '*.rs' -not -path '*/target/*'); do
    r=$(senza_test "$f" | grep -E "$LOG" | grep -E "$VALORE" || true)
    [ -n "$r" ] && trovate="$trovate$r\n"
done
if [ -z "$trovate" ]; then
    ok "nessuna macro di log interpola un token o una password"
else
    male "un segreto sta finendo nei log:"; echo -e "$trovate" | sed 's/^/      /'
fi

# Il token Telegram sta NELL'URL: chi lo compone deve avere la redazione a
# portata di mano nello stesso file, altrimenti il primo `{e}` di reqwest se lo
# porta dietro (era così fino al 2f).
# Si cerca la COMPOSIZIONE (`…/bot{` con un'interpolazione dentro), non la
# menzione: un commento che spiega la forma dell'URL non è una perdita.
for f in $(grep -rl 'api\.telegram\.org/bot{' --include='*.rs' "$CRATES"/*/src); do
    if grep -q 'redigi' "$f"; then
        ok "$(basename "$f") compone l'URL di Telegram e usa la redazione"
    else
        male "$f compone l'URL di Telegram con il token e non nomina \`redigi\`"
    fi
done

# ── 4. nessun segreto nei template ───────────────────────────────────────────
sporchi=""
for t in examples/templates/*/; do
    [ -f "$t/project.yaml" ] || continue
    [ -f "$t/secrets.yaml" ] && sporchi="$sporchi\n      $t ha un secrets.yaml"
    # Un campo con un valore vero; `*_env` e i campi vuoti non contano.
    r=$(grep -nE '^\s*(bot_token|password|token|connection_string):\s*\S' "$t/project.yaml" || true)
    [ -n "$r" ] && sporchi="$sporchi\n      $t/project.yaml: $r"
done
if [ -z "$sporchi" ]; then
    ok "i template non portano credenziali"
else
    male "un template porta una credenziale — si copierebbe in ogni progetto nuovo:"
    echo -e "$sporchi"
fi

if [ "$rosso" -ne 0 ]; then
    echo -e "\033[31msegreti: qualcosa è uscito dal recinto.\033[0m"; exit 1
fi
echo -e "\033[32msegreti: un posto solo, e ci restano.\033[0m"
