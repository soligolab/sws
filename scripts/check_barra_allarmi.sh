#!/usr/bin/env bash
#
# I due motori dicono la stessa cosa su chi finisce nella barra allarmi?
#
# PERCHÉ ESISTE
#
# `alarm_banner` è disegnato due volte: dal web (`AlarmBanner.tsx`, che serve sia
# l'editor sia il runtime nel browser) e dal viewer LVGL sul pannello
# (`lvgl_render.rs`). Fino all'11-09-2026 i due si erano allineati per caso su
# due risposte diverse — il web mostrava gli allarmi **da confermare**, il
# pannello quelli **attivi** — quindi lo stesso progetto si comportava in due
# modi a seconda di dove girava. Nessun test lo notava: sono due linguaggi, due
# crate, due file lontani.
#
# L'audit del 2026-08-06 §3 lo aveva segnalato come «da confermare col
# maintainer»; il maintainer ha deciso l'11-09-2026 per la semantica ISA-18.2
# (**da confermare**: `active_unacked` + `normal_unacked`), e questa guardia
# tiene le due metà legate.
#
# COSA NON DICE
#
# Che il banner si disegni bene: verifica la **selezione**, non il rendering.
# E non verifica il caso di ripiego `isa_state` vuoto, che esiste solo lato
# Rust (server più vecchio del viewer) e non ha gemello nel web.
set -euo pipefail
cd "$(dirname "$0")/.."

exec python3 - <<'PY'
import re, sys

TS   = "sws-editor/src/components/AlarmBanner.tsx"
RUST = "sws-runtime/crates/sws-lvgl-viewer/src/lvgl_render.rs"
BELL_TS   = "sws-editor/src/components/AlarmBellPanel.tsx"
VIEWER_TS = "sws-editor/src/canvas/SvgCanvas.tsx"

ISA = {"normal", "active_unacked", "active_acked", "normal_unacked"}
esito = 0

def ok(msg):  print(f"  \033[32m✓\033[0m {msg}")
def ko(msg):
    global esito
    esito = 1
    print(f"  \033[31m✗\033[0m {msg}")

def corpo(path, inizio, fine):
    """Il testo fra la riga che contiene `inizio` e la prima che matcha `fine`."""
    src = open(path, encoding="utf-8").read()
    i = src.find(inizio)
    if i < 0:
        return None
    m = re.search(fine, src[i:])
    return src[i:i + m.end()] if m else None

print("=== 1. le due funzioni esistono e sono nominate ===")
c_rust = corpo(RUST, "pub(crate) fn nella_barra(", r"\n}")
c_ts   = corpo(TS,   "export function nellaBarra(", r"\n}")
if c_rust: ok(f"{RUST} :: nella_barra")
else:      ko(f"{RUST} non ha più `pub(crate) fn nella_barra` — rinominata o rimossa")
if c_ts:   ok(f"{TS} :: nellaBarra")
else:      ko(f"{TS} non ha più `export function nellaBarra` — rinominata o rimossa")

if not (c_rust and c_ts):
    print("\n\033[31mimpossibile confrontare: manca una delle due metà.\033[0m")
    sys.exit(1)

print("=== 2. nominano gli stessi stati ISA ===")
s_rust = {x for x in re.findall(r'"([a-z_]+)"', c_rust) if x in ISA}
s_ts   = {x for x in re.findall(r'"([a-z_]+)"', c_ts)   if x in ISA}
print(f"  LVGL: {', '.join(sorted(s_rust)) or '(nessuno)'}")
print(f"  web : {', '.join(sorted(s_ts))   or '(nessuno)'}")
if not s_rust or not s_ts:
    ko("una delle due non nomina alcuno stato ISA: il confronto non significa niente")
elif s_rust == s_ts:
    ok(f"stessa selezione su entrambi i motori ({len(s_rust)} stati)")
else:
    ko(f"divergenza: solo LVGL {sorted(s_rust - s_ts)}, solo web {sorted(s_ts - s_rust)}")

print("=== 3. è davvero la semantica decisa (da confermare, non attivi) ===")
atteso = {"active_unacked", "normal_unacked"}
if s_ts == atteso:
    ok("la barra mostra gli allarmi da confermare (ISA-18.2, decisione dell'11-09-2026)")
else:
    ko(f"atteso {sorted(atteso)}, trovato {sorted(s_ts)}")

print("=== 4. campanella e viewer restano sugli allarmi attivi ===")
# La divergenza è voluta, ma solo in un verso: se anche questi passassero a
# `isa_state` la decisione andrebbe ripresa, non subita.
casi = [
    (BELL_TS,   "filter((a) => a.active)",     "alarm_bell (web)"),
    (VIEWER_TS, "if (!a.active) return false", "alarm_viewer (web)"),
]
for path, ago, nome in casi:
    if ago in open(path, encoding="utf-8").read(): ok(f"{nome} filtra su `active`")
    else: ko(f"{nome}: non trovo più il filtro su `active` in {path}")

src_rust = open(RUST, encoding="utf-8").read()
for fn, nome in [("fn update_alarm_bell", "alarm_bell (LVGL)"),
                 ("fn update_alarm_viewer", "alarm_viewer (LVGL)")]:
    blocco = corpo(RUST, fn, r"\n}")
    if blocco and ".filter(|a| a.active)" in blocco: ok(f"{nome} filtra su `active`")
    else: ko(f"{nome}: non trovo più `.filter(|a| a.active)`")

print()
if esito == 0:
    print("\033[32mbarra allarmi: i due motori dicono la stessa cosa.\033[0m")
else:
    print("\033[31mbarra allarmi: i due motori divergono.\033[0m")
sys.exit(esito)
PY
