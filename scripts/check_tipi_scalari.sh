#!/usr/bin/env bash
#
# I tipi scalari delle variabili sono una tabella sola: le tre copie la
# contengono davvero, e nessuna select li rielenca a mano?
#
# PERCHÉ ESISTE
#
# D5 (22-09-2026): la variabile ha un tipo del runtime — bool, i8…i64, u8…u64,
# f32/f64, string(N), datetime — e i quattro nomi vecchi restano alias. La
# fonte è `tests/fixtures/tipi-scalari.json`, letta dal test Rust di
# `sws_core::tipo` e dal test TypeScript di `tag/tipiScalari.ts`. Ma i test
# non fanno parte della definition of done: questa guardia porta la parità
# dentro `check_static.sh` senza eseguire niente.
#
#   1. ogni nome della fixture compare in `sws-core/src/tipo.rs` (nel `parse`)
#      e in `sws-editor/src/tag/tipiScalari.ts`;
#   2. nessuna `<option value="bool|int|float|string">` scritta a mano in
#      ConfigView.tsx o nel modale rapido: le select passano da `<OpzioniTipo />`,
#      altrimenti una quinta copia dell'elenco nasce e invecchia da sola;
#   3. `validate.rs` non ha più la costante `TIPI_DATO`: il validatore chiede
#      al catalogo, non a un elenco suo.
#
# Uso:  ./scripts/check_tipi_scalari.sh
set -euo pipefail
cd "$(dirname "$0")/.."
exec python3 - "$PWD" <<'PY'
import json, re, sys

root = sys.argv[1]
FIXTURE = f"{root}/tests/fixtures/tipi-scalari.json"
RS = f"{root}/sws-runtime/crates/sws-core/src/tipo.rs"
TS = f"{root}/sws-editor/src/tag/tipiScalari.ts"
SELECT = [f"{root}/sws-editor/src/config/ConfigView.tsx", f"{root}/sws-editor/src/components/QuickCreateTagModal.tsx"]
VALIDATE = f"{root}/sws-runtime/crates/sws-web/src/validate.rs"

fatti = passati = 0
def esito(ok, msg):
    global fatti, passati
    fatti += 1
    if ok: passati += 1
    segno = "\033[32m✓" if ok else "\033[31m✗"
    print(f"  {segno}\033[0m {msg}")

fx = json.load(open(FIXTURE, encoding="utf-8"))
nomi = [t["nome"] for t in fx["tipi"]]
alias = [a for t in fx["tipi"] for a in t.get("alias", [])]
rs = open(RS, encoding="utf-8").read()
ts = open(TS, encoding="utf-8").read()

print("=== 1. ogni tipo della fixture compare nelle due implementazioni ===")
mancanti_rs = [n for n in nomi + alias if f'"{n}"' not in rs]
mancanti_ts = [n for n in nomi + alias if f'"{n}"' not in ts]
esito(not mancanti_rs, f"Rust: {len(nomi)} tipi e {len(alias)} alias in tipo.rs" + (f" — mancano {mancanti_rs}" if mancanti_rs else ""))
esito(not mancanti_ts, f"TypeScript: {len(nomi)} tipi e {len(alias)} alias in tipiScalari.ts" + (f" — mancano {mancanti_ts}" if mancanti_ts else ""))
m = re.search(r'pub const NOMI: &\[&str\] = &\[(.*?)\];', rs, re.S)
nomi_rs = re.findall(r'"([a-z0-9]+)"', m.group(1)) if m else []
esito(nomi_rs == nomi, "l'ordine di NOMI in Rust è quello della fixture" + ("" if nomi_rs == nomi else f" — Rust: {nomi_rs}"))

print("=== 2. nessuna select rielenca i tipi a mano ===")
intrusi = []
for f in SELECT:
    for i, riga in enumerate(open(f, encoding="utf-8").read().split("\n"), 1):
        # `bool`/`int` compaiono anche negli enum di protocollo (S7, EtherNet/IP):
        # si guardano i nomi che solo il catalogo dei tag ha.
        if re.search(r'<option value="(float|string|i\d+|u\d+|f\d+|datetime)"', riga):
            intrusi.append(f"{f.replace(root + '/', '')}:{i}")
esito(not intrusi, "le select dei tipi passano da <OpzioniTipo />" + ("".join("\n      " + x for x in intrusi)))

print("=== 3. il validatore chiede al catalogo ===")
val = open(VALIDATE, encoding="utf-8").read()
esito("TIPI_DATO" not in val, "validate.rs senza la costante TIPI_DATO")
esito("t.tipo().is_none()" in val or "TipoScalare::parse" in val, "validate.rs usa sws_core::tipo")

print()
if passati == fatti:
    print(f"\033[32mtipi scalari: una tabella, {passati}/{fatti} controlli verdi.\033[0m")
    sys.exit(0)
print(f"\033[31m{fatti - passati} controlli rossi su {fatti}.\033[0m")
sys.exit(1)
PY
