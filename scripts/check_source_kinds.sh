#!/usr/bin/env bash
#
# I `kind` delle sorgenti dicono le stesse cose in Rust e nell'IDE?
#
# PERCHÉ ESISTE
#
# `enum SourceDef` (`sws-core/src/project.rs`) e `SourceDef` in
# `sws-editor/src/types/index.ts` sono due elenchi scritti a mano dello stesso
# vocabolario. Il 21-09-2026 se ne è trovato uno diverso da sempre: il TypeScript
# scriveva `kind: 'en_ip'` e Rust leggeva `"enip"`. Una sorgente EtherNet/IP
# creata dall'IDE aveva quindi un `kind` che il runtime non riconosce — e il modo
# in cui si rompe non fa rumore: la sorgente c'è nel progetto e non parte.
#
# Stesso schema di `check_lvgl_types.sh`: due elenchi a mano si disallineano.
#
# Uso:  ./scripts/check_source_kinds.sh     (esce != 0 se i due elenchi divergono)
set -euo pipefail
cd "$(dirname "$0")/.."

exec python3 - "$PWD" <<'PY'
import re, sys

root = sys.argv[1]
RS = f"{root}/sws-runtime/crates/sws-core/src/project.rs"
TS = f"{root}/sws-editor/src/types/index.ts"

def die(msg):
    print(f"  \033[31m✗\033[0m {msg}")
    print("      La forma della dichiarazione è cambiata: questo controllo non sta più")
    print("      guardando niente, e va aggiornato.")
    sys.exit(1)

rs = open(RS, encoding="utf-8").read()
m = re.search(r"pub enum SourceDef \{(.*?)\n\}", rs, re.S)
if not m:
    die(f"non trovo `enum SourceDef` in {RS}")
rust = set(re.findall(r'#\[serde\(rename = "([a-z0-9_]+)"\)\]', m.group(1)))

ts = open(TS, encoding="utf-8").read()
u = re.search(r"export type SourceDef =\s*([^;]+);", ts)
if not u:
    die(f"non trovo `export type SourceDef` in {TS}")
tipi = [t.strip() for t in u.group(1).split("|")]
tsk = set()
for nome in tipi:
    b = re.search(r"export interface %s \{(.*?)\n\}" % re.escape(nome), ts, re.S)
    if not b:
        die(f"non trovo `interface {nome}` in {TS}")
    k = re.search(r"kind: ['\"]([a-z0-9_]+)['\"]", b.group(1))
    if not k:
        die(f"`{nome}` non ha `kind: '…'` in {TS}")
    tsk.add(k.group(1))

print("\033[1mI `kind` delle sorgenti: Rust contro IDE\033[0m\n")
solo_rust = sorted(rust - tsk)
solo_ts = sorted(tsk - rust)
if solo_ts:
    print(f"  \033[31m✗\033[0m l'IDE scrive {solo_ts} e il runtime non li riconosce")
    print("      Una sorgente così è nel progetto e non parte, senza nessun messaggio.")
if solo_rust:
    print(f"  \033[31m✗\033[0m il runtime conosce {solo_rust} e l'IDE non sa crearli")
if solo_ts or solo_rust:
    sys.exit(1)
print(f"  \033[32m✓\033[0m {len(rust)} tipi di sorgente, identici da entrambe le parti")
print("\n\033[32mI `kind` sono d'accordo.\033[0m")
PY
