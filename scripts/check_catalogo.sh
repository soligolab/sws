#!/usr/bin/env bash
# check_catalogo.sh — il catalogo dei dispositivi noti si legge e dice il vero.
#
# PERCHÉ ESISTE (04-10-2026, piano docs/plans/2026-10-04-catalogo-dispositivi.md)
#
# Il catalogo è fatto di file JSON letti a caldo dal runtime: apposta, perché
# correggere un registro sia cambiare un file. Il prezzo è che nessun
# compilatore li guarda. Un file sbagliato non rompe il catalogo (il runtime lo
# riporta e va avanti), ma un dispositivo aggiunto da lì porterebbe nel
# progetto un formato che il motore Modbus non conosce, un bit 16, due membri
# con lo stesso nome — e lo si scoprirebbe al collaudo, sul campo.
#
# Controlla i file del **prodotto** (catalogo/dispositivi/): JSON valido, id
# uguale al percorso, include che esistono e non girano in tondo, registri con
# nome, indirizzo e accesso, formato e tipo fra i tipi scalari (la fixture di
# check_tipi_scalari), bit 0-15 senza doppioni, nomi di membro unici dopo gli
# include, descrizioni in italiano e inglese, immagini presenti e leggere.
set -euo pipefail
cd "$(dirname "$0")/.."
exec python3 - "$PWD" <<'PY'
import json, os, re, sys

root = sys.argv[1]
CAT = f"{root}/catalogo/dispositivi"
fx = json.load(open(f"{root}/tests/fixtures/tipi-scalari.json", encoding="utf-8"))
SCALARI = {t["nome"] for t in fx["tipi"]} | {a for t in fx["tipi"] for a in t.get("alias", [])}
NUMERICI = {n for n in SCALARI if n not in ("string", "datetime", "bool")}
AREE = {"holding", "input", "coil", "discrete"}
NOME = re.compile(r"^[a-z_][a-z0-9_]*$")
MAX_IMMAGINE = 100 * 1024

fail = []
def problema(m):
    fail.append(m)
    print(f"  \033[31m✗\033[0m {m}")
def ok(m):
    print(f"  \033[32m✓\033[0m {m}")

file = {}
for marca in sorted(os.listdir(CAT)):
    d = os.path.join(CAT, marca)
    if not os.path.isdir(d):
        continue
    for f in sorted(os.listdir(d)):
        if f.endswith(".json"):
            idf = f"{marca}/{f[:-5]}"
            try:
                file[idf] = json.load(open(os.path.join(d, f), encoding="utf-8"))
            except Exception as e:
                problema(f"{idf}.json non è JSON valido: {e}")

def due_lingue(x, dove):
    if not isinstance(x, dict) or not str(x.get("it", "")).strip() or not str(x.get("en", "")).strip():
        problema(f"{dove}: la descrizione vuole «it» ed «en»")

def risolti(idf, aperti=()):
    if idf in aperti:
        problema(f"include circolare: {' → '.join(aperti + (idf,))}")
        return []
    m = file.get(idf)
    if m is None:
        problema(f"«{idf}» incluso ma non esiste")
        return []
    out = []
    for inc in m.get("includi", []):
        for r in risolti(inc, aperti + (idf,)):
            out = [x for x in out if x.get("nome") != r.get("nome")] + [r]
    for r in m.get("registri", []):
        out = [x for x in out if x.get("nome") != r.get("nome")] + [r]
    return out

print("=== 1. ogni file ha l'id del suo percorso e registri sensati ===")
for idf, m in file.items():
    if m.get("id") != idf:
        problema(f"{idf}.json dice id «{m.get('id')}»")
    if "descrizione" in m:
        due_lingue(m["descrizione"], idf)
    for r in m.get("registri", []):
        dove = f"{idf}: registro «{r.get('nome')}»"
        if not isinstance(r.get("nome"), str) or not NOME.match(r["nome"]):
            problema(f"{dove}: nome mancante o non valido (minuscole, cifre, _)")
        if not isinstance(r.get("indirizzo"), int) or not 0 <= r["indirizzo"] <= 65535:
            problema(f"{dove}: indirizzo mancante o fuori da 0-65535")
        if r.get("accesso") not in ("r", "rw"):
            problema(f"{dove}: accesso vuole «r» o «rw»")
        if r.get("area", "holding") not in AREE:
            problema(f"{dove}: area «{r.get('area')}» sconosciuta")
        if "formato" in r and r["formato"] not in NUMERICI:
            problema(f"{dove}: formato «{r['formato']}» non è un tipo numerico")
        if "tipo" in r and r["tipo"] not in SCALARI:
            problema(f"{dove}: tipo «{r['tipo']}» non è un tipo scalare")
        if "descrizione" in r:
            due_lingue(r["descrizione"], dove)
        bits = r.get("bit")
        if bits is not None:
            if r.get("formato", "u16") not in ("u16", "i16"):
                problema(f"{dove}: i bit vogliono un registro a 16 bit")
            visti = set()
            for b in bits:
                n = b.get("bit")
                if not isinstance(n, int) or not 0 <= n <= 15:
                    problema(f"{dove}: bit {n} fuori da 0-15")
                if n in visti:
                    problema(f"{dove}: bit {n} ripetuto")
                visti.add(n)
                if not isinstance(b.get("nome"), str) or not NOME.match(b["nome"]):
                    problema(f"{dove}: un bit senza nome valido")
                due_lingue(b.get("descrizione"), f"{dove} bit {n}")
if not fail:
    ok(f"{len(file)} file, id e registri a posto")

print("=== 2. i modelli: include risolti, membri unici, immagine ===")
prima = len(fail)
modelli = [i for i in file if not i.split("/")[1].startswith("_")]
for idf in modelli:
    m = file[idf]
    for k in ("marca", "modello"):
        if not str(m.get(k, "")).strip():
            problema(f"{idf}: manca «{k}»")
    due_lingue(m.get("descrizione"), idf)
    regs = risolti(idf)
    if not regs:
        problema(f"{idf}: nessun registro dopo gli include")
    membri = []
    for r in regs:
        membri += [b["nome"] for b in r["bit"]] if r.get("bit") else [r.get("nome")]
    doppi = sorted({x for x in membri if membri.count(x) > 1})
    if doppi:
        problema(f"{idf}: membri ripetuti dopo gli include: {doppi}")
    img = m.get("immagine")
    if img:
        p = os.path.join(CAT, idf.split("/")[0], img)
        if not os.path.isfile(p):
            problema(f"{idf}: l'immagine «{img}» non c'è")
        elif os.path.getsize(p) > MAX_IMMAGINE:
            problema(f"{idf}: l'immagine pesa {os.path.getsize(p)//1024} KB (massimo {MAX_IMMAGINE//1024})")
if len(fail) == prima:
    ok(f"{len(modelli)} modelli completi")

print()
if fail:
    print(f"\033[31mcatalogo: {len(fail)} problemi.\033[0m")
    sys.exit(1)
print("\033[32mil catalogo dei dispositivi si legge e dice il vero.\033[0m")
PY
