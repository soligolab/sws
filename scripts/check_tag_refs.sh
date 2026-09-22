#!/usr/bin/env bash
#
# I campi-tag scalari di un oggetto sinottico: la stessa lista in Rust e in TS?
#
# PERCHÉ ESISTE
#
# `CAMPI_TAG` (`sws-web/src/validate.rs`) e `TAG_FIELDS`
# (`sws-editor/src/runtime-view/collectTagIds.ts`) sono due elenchi scritti a
# mano dello stesso vocabolario: i campi di un oggetto sinottico il cui valore
# è direttamente un id di tag. Il 21-09-2026 si sono trovati diversi da tempo:
# `motion_tag`, `pipe_flow_tag`, `symbol_spin_tag` e `gauge_sp_tag` erano
# validati lato server ma mancavano da `collectTagIds`. Il sintomo non fa
# rumore: l'oggetto riceve lo snapshot iniziale del tag e poi si CONGELA,
# senza nessun errore (il commento in testa a `collectTagIds.ts` lo spiega per
# gli altri campi — questa guardia tiene i due elenchi allineati da qui in
# avanti).
#
# Stesso schema di `check_source_kinds.sh`: due elenchi a mano si disallineano.
#
# Un secondo controllo, più leggero: i campi "a collezione" con riferimenti a
# tag (`CAMPI_TAG_COLLEZIONE` in validate.rs — trend_tags, xy_series,
# table_rows, bar_series, pie_slices) non hanno un elenco gemello in TS
# (`collectTagIds.ts` li legge con codice inline, uno per uno), quindi qui si
# verifica solo che ciascuno sia CITATO nel file — una prova che nessuno dei
# due lati ha dimenticato una collezione, non un confronto valore per valore.
#
# Uso:  ./scripts/check_tag_refs.sh     (esce != 0 se i due elenchi divergono)
set -euo pipefail
cd "$(dirname "$0")/.."

exec python3 - "$PWD" <<'PY'
import re, sys

root = sys.argv[1]
RS = f"{root}/sws-runtime/crates/sws-web/src/validate.rs"
TS = f"{root}/sws-editor/src/runtime-view/collectTagIds.ts"

def die(msg):
    print(f"  \033[31m✗\033[0m {msg}")
    print("      La forma della dichiarazione è cambiata: questo controllo non sta più")
    print("      guardando niente, e va aggiornato.")
    sys.exit(1)

rs = open(RS, encoding="utf-8").read()
ts = open(TS, encoding="utf-8").read()

print("\033[1mI campi-tag scalari: Rust (validate.rs) contro IDE (collectTagIds.ts)\033[0m\n")

m = re.search(r'const CAMPI_TAG: &\[&str\] = &\[(.*?)\];', rs, re.S)
if not m:
    die(f"non trovo `CAMPI_TAG` in {RS}")
campi_tag_rs = set(re.findall(r'"([a-z0-9_]+)"', m.group(1)))

m = re.search(r'const TAG_FIELDS = \[(.*?)\] as const;', ts, re.S)
if not m:
    die(f"non trovo `TAG_FIELDS` in {TS}")
campi_tag_ts = set(re.findall(r'"([a-z0-9_]+)"', m.group(1)))

fatti = passati = 0
def esito(ok, msg):
    global fatti, passati
    fatti += 1
    if ok: passati += 1
    segno = "\033[32m✓" if ok else "\033[31m✗"
    print(f"  {segno}\033[0m {msg}")

solo_rs = sorted(campi_tag_rs - campi_tag_ts)
solo_ts = sorted(campi_tag_ts - campi_tag_rs)
esito(
    not solo_rs and not solo_ts,
    f"CAMPI_TAG ({len(campi_tag_rs)}) e TAG_FIELDS ({len(campi_tag_ts)}) coincidono"
    + (f" — solo in Rust: {solo_rs}" if solo_rs else "")
    + (f" — solo in TS: {solo_ts}" if solo_ts else ""),
)

m = re.search(r'const CAMPI_TAG_COLLEZIONE: &\[\(&str, &\[&str\]\)\] = &\[(.*?)\];', rs, re.S)
if not m:
    die(f"non trovo `CAMPI_TAG_COLLEZIONE` in {RS}")
collezioni_rs = re.findall(r'\("([a-z0-9_]+)"', m.group(1))

mancanti = [c for c in collezioni_rs if c not in ts]
esito(
    not mancanti,
    f"le {len(collezioni_rs)} collezioni di CAMPI_TAG_COLLEZIONE compaiono anche in collectTagIds.ts"
    + (f" — mancano: {mancanti}" if mancanti else ""),
)

# ── 3. Un posto solo installa i tag nel runtime (Fase 0d, 22-09-2026) ───────
# Sei siti facevano a mano semina/rimozione/scale/ruoli/tipi/calcolati nel
# TagDb, e divergevano (la ricarica da git saltava scale, tipi e ruoli). Ora
# lo fa `projects::apply_tags`; qualunque altro punto di sws-web che chiami
# direttamente uno di questi metodi è un settimo sito che sta nascendo.
import glob, os
METODI = re.compile(r'\.(set_scales|set_write_roles|set_data_types|set_computed_tags)\(|build_generator_tags\(|\.initial_value\(\)')
intrusi = []
for f in sorted(glob.glob(f"{root}/sws-runtime/crates/sws-web/src/**/*.rs", recursive=True)):
    testo = open(f, encoding="utf-8").read()
    # apply_tags stesso e i test sono ammessi
    corpo = testo
    m_fn = re.search(r'pub async fn apply_tags\(.*?\n\}\n', testo, re.S)
    if m_fn:
        corpo = testo[:m_fn.start()] + testo[m_fn.end():]
    corpo = re.split(r'#\[cfg\(test\)\]', corpo)[0]
    for i, riga in enumerate(corpo.split("\n"), 1):
        if riga.strip().startswith("//") or re.match(r'\s*(pub(\(crate\))?\s+)?(async\s+)?fn\s', riga):
            continue  # commenti e definizioni, non chiamate
        if METODI.search(riga):
            intrusi.append(f"{os.path.relpath(f, root)}:{i}: {riga.strip()[:90]}")
esito(
    not intrusi,
    "nessun sito installa i tag nel TagDb fuori da `projects::apply_tags`"
    + ("".join("\n      " + x for x in intrusi)),
)

print()
if passati == fatti:
    print(f"\033[32mcampi-tag: due elenchi, {passati}/{fatti} controlli verdi.\033[0m")
    sys.exit(0)
print(f"\033[31m{fatti - passati} controlli rossi su {fatti}.\033[0m")
sys.exit(1)
PY
