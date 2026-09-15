#!/usr/bin/env bash
# I due motori traducono gli stessi campi?
#
# PERCHÉ ESISTE
#
# Lo stesso progetto viene disegnato da due motori indipendenti: il web
# (`sws-editor/src/i18n/projectI18n.ts`) e il viewer LVGL
# (`sws-lvgl-viewer/src/lvgl_render.rs`). Ognuno ha la propria lista dei campi
# in cui risolvere i token `{{chiave}}` dei contenuti di progetto, e le due
# liste sono scritte a mano, lontane, in due linguaggi diversi.
#
# Il 15-09-2026 divergevano di cinque campi: il web risolveva `pipe_label`,
# `bar_y_label`, `pie_center_text`, `options[].label`, `bar_series[].label`,
# `pie_slices[].label`, `format` e `confirm_message`; LVGL no. Effetto: un
# progetto tradotto correttamente mostrava `{{chiave}}` sul pannello e il testo
# giusto nell'IDE — cioè il difetto si vedeva solo in campo, davanti al
# cliente, e mai sulla macchina di chi l'aveva fatto.
#
# `check_lvgl_parity.sh` non lo intercetta: quello verifica che i campi siano
# **dichiarati** in `model.rs`, e dice da sé che «un campo dichiarato non
# significa disegnato». Qui si guarda chi li **traduce**.
#
# Uso:  ./scripts/check_i18n_parita.sh
set -uo pipefail
cd "$(dirname "$0")/.."

TS="sws-editor/src/i18n/projectI18n.ts"
RS="sws-runtime/crates/sws-lvgl-viewer/src/lvgl_render.rs"
ESITO=0
ok()  { printf '  \033[32m✓\033[0m %s\n' "$1"; }
ko()  { printf '  \033[31m✗\033[0m %s\n' "$1"; ESITO=1; }

for f in "$TS" "$RS"; do
    [ -f "$f" ] || { echo "manca $f"; exit 2; }
done

# ── chi traduce cosa, estratto dal codice e non da una dichiarazione ─────────
# Web: i nomi fra virgolette dentro l'array TEXT_FIELDS, più gli array
# annidati, riconosciuti da `obj.<campo>?.some(`.
campi_web() {
    sed -n '/^const TEXT_FIELDS/,/^\];/p' "$TS" \
        | grep -o '"[a-z_]*"' | tr -d '"'
    grep -o 'obj\.[a-z_]*?\.some(' "$TS" | sed 's/^obj\.//; s/?\.some($//' | sed 's/$/[]/'
}
# LVGL: `out.<campo> = Some(resolve_msg(` per i campi semplici; per gli array
# annidati, `out.<campo> = Some(` con dentro una `resolve_msg` sulla label.
campi_lvgl() {
    grep -o 'out\.[a-z_]* = Some(resolve_msg(' "$RS" | sed 's/^out\.//; s/ = Some(resolve_msg($//'
    awk '/out\.[a-z_]* = Some\($/ { campo=$1; sub(/^out\./,"",campo); attesa=1; next }
         attesa && /label: resolve_msg/ { print campo "[]"; attesa=0 }
         attesa && /^\s*\}/ { attesa=0 }' "$RS"
}

web=$(campi_web | sort -u)
lvgl=$(campi_lvgl | sort -u)

echo "=== 1. i campi che il web traduce e il pannello no ==="
solo_web=$(comm -23 <(echo "$web") <(echo "$lvgl"))
if [ -z "$solo_web" ]; then
    ok "nessuno: tutto ciò che si traduce nell'IDE si traduce anche sul pannello"
else
    while read -r c; do
        [ -n "$c" ] && ko "\`$c\`: tradotto nell'IDE, grezzo sul pannello"
    done <<< "$solo_web"
fi

echo "=== 2. i campi che il pannello traduce e il web no ==="
solo_lvgl=$(comm -13 <(echo "$web") <(echo "$lvgl"))
if [ -z "$solo_lvgl" ]; then
    ok "nessuno"
else
    while read -r c; do
        [ -n "$c" ] && ko "\`$c\`: tradotto sul pannello, grezzo nell'IDE"
    done <<< "$solo_lvgl"
fi

# ── il debito dichiarato: testo che l'operatore legge e che NESSUNO traduce ──
#
# Non è una divergenza fra i due motori — è un buco in entrambi, quindi il
# confronto qui sopra non lo vedrebbe mai. Sta scritto qui perché un debito
# elencato si chiude; un debito che nessuno conta cresce.
#
# Ogni riga va tolta quando quel campo entra in ENTRAMBE le liste. Quando
# questo elenco è vuoto, la Fase 1 del piano multilingua è finita.
NON_COPERTI=(
    table_label_header      # intestazione della colonna etichette di `table`
    xy_x_label              # titolo asse X di `xy_plot`
    xy_y_label              # titolo asse Y di `xy_plot`
    pie_group_label         # etichetta della fetta «altro» di `pie_chart`
)
echo "=== 3. testo visibile che non traduce nessuno dei due ==="
if [ ${#NON_COPERTI[@]} -eq 0 ]; then
    ok "nessuno: ogni campo di testo visibile passa dal risolutore"
else
    printf '  \033[33m•\033[0m %d campi dichiarati non coperti (debito noto, non un fallimento):\n' "${#NON_COPERTI[@]}"
    for c in "${NON_COPERTI[@]}"; do printf '      %s\n' "$c"; done
    # Un campo dichiarato non coperto che INVECE è coperto va tolto dall'elenco,
    # o l'elenco diventa una bugia che sopravvive al proprio motivo.
    for c in "${NON_COPERTI[@]}"; do
        if grep -qx "$c" <<< "$web" || grep -qx "$c" <<< "$lvgl"; then
            ko "\`$c\` è dichiarato non coperto ma qualcuno lo traduce: togli la riga"
        fi
    done
fi

# ── chi dichiara la lingua, e chi la consuma ────────────────────────────────
#
# L'11-09-2026 un contesto React (`GruppoAttivo`) è stato dichiarato, consumato
# in due punti, e **mai montato da nessuno**: la barra compariva e il menù non
# si aggiornava. Un contesto senza Provider non è un errore di compilazione, e
# nemmeno un test sul componente figlio lo vede — il default lo copre.
#
# Qui il default del contesto della lingua è inerte di proposito (senza
# Provider non si traduce), quindi un Provider dimenticato si manifesterebbe
# esattamente come il difetto che questa fase ha appena corretto: token grezzi
# sotto gli occhi dell'operatore.
CANVAS="sws-editor/src/canvas/SvgCanvas.tsx"
CONSUMATORI=(
    "sws-editor/src/runtime-view/RuntimeView.tsx"
    "sws-editor/src/editor/EditorShell.tsx"
)
echo "=== 4. il contesto della lingua è montato davvero ==="
if grep -q "useLinguaContenuti" "$CANVAS"; then
    ok "\`SvgObject\` consuma il contesto"
else
    ko "\`SvgObject\` non consuma il contesto: nessun oggetto si tradurrebbe"
fi
for f in "${CONSUMATORI[@]}"; do
    if grep -q "LinguaContenutiProvider" "$f"; then
        ok "$(basename "$f") monta il Provider"
    else
        ko "$(basename "$f") disegna oggetti ma non monta il Provider: token grezzi"
    fi
done
# La vecchia via: localizzare l'array di primo livello e passare oggetti già
# risolti. Funzionava per gli oggetti in cima e per nessun figlio. Se
# ricompare, sono di nuovo due strade per la stessa cosa.
if grep -rn "localizeObjects(" sws-editor/src >/dev/null 2>&1; then
    ko "\`localizeObjects(\` è tornato in sws-editor/src: la localizzazione di primo livello salta i figli di griglie e faceplate"
    grep -rn "localizeObjects(" sws-editor/src | sed 's/^/      /'
else
    ok "nessuna localizzazione di primo livello superstite"
fi

echo
if [ "$ESITO" = 0 ]; then
    echo -e "\033[32mi18n di progetto: i due motori traducono gli stessi campi.\033[0m"
else
    echo -e "\033[31mi18n di progetto: le due liste non coincidono.\033[0m"
fi
exit "$ESITO"
