#!/usr/bin/env bash
# check_catalogo.sh — il catalogo dei dispositivi noti si legge e dice il vero.
#
# PERCHÉ ESISTE (04-10-2026, piano docs/archive/2026-10-04-catalogo-dispositivi.md)
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
        # Il configuratore dei moduli (25-10-2026): `valori` è l'enumerazione che
        # l'IDE mostra come tendina, `setup: false` toglie un parametro dal setup
        # (cambiare indirizzo o baud dal progetto spezzerebbe la comunicazione).
        if "valori" in r:
            v = r["valori"]
            if not isinstance(v, dict) or not v:
                problema(f"{dove}: «valori» vuole un oggetto non vuoto")
            else:
                for k, testo in v.items():
                    if not re.fullmatch(r"-?\d+", k) or not -32768 <= int(k) <= 65535:
                        problema(f"{dove}: valore «{k}» non è un intero a 16 bit")
                    due_lingue(testo, f"{dove} valore {k}")
        if "setup" in r and not isinstance(r["setup"], bool):
            problema(f"{dove}: «setup» vuole true o false")
        # Inverter (01-11-2026, piano docs/archive/2026-11-01-inverter-solarman.md):
        # limiti di plausibilità e testi di enumerazioni e maschere di bit.
        for k in ("min", "max"):
            if k in r and not isinstance(r[k], (int, float)):
                problema(f"{dove}: «{k}» vuole un numero")
        if isinstance(r.get("min"), (int, float)) and isinstance(r.get("max"), (int, float)) and r["min"] > r["max"]:
            problema(f"{dove}: min {r['min']} maggiore di max {r['max']}")
        if "testi" in r:
            tx = r["testi"]
            modo = tx.get("modo", "valore") if isinstance(tx, dict) else None
            if modo not in ("valore", "bit") or not isinstance(tx.get("voci"), dict) or not tx["voci"]:
                problema(f"{dove}: «testi» vuole modo valore|bit e voci non vuote")
            else:
                for k, testo in tx["voci"].items():
                    if not re.fullmatch(r"\d+", k) or (modo == "bit" and int(k) > 31):
                        problema(f"{dove}: voce «{k}» non è un {'bit 0-31' if modo == 'bit' else 'valore intero'}")
                    due_lingue(testo, f"{dove} voce {k}")
            if r.get("tipo") != "string":
                problema(f"{dove}: con «testi» il tipo è «string»")
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
    # Il trasporto (25-10-2026, seme «Modbus TCP senza bus»): prima lo si
    # deduceva dall'assenza di `seriale`, e «Dal catalogo» lasciava mettere un
    # MCM280X (solo TCP) su un bus RTU. Dichiarato, e coerente col blocco.
    mb = m.get("modbus") or {}
    tr = mb.get("trasporto")
    if tr not in ("tcp", "rtu", "entrambi"):
        problema(f"{idf}: modbus.trasporto vuole «tcp», «rtu» o «entrambi» (trovato {tr!r})")
    elif tr == "tcp" and "seriale" in mb:
        problema(f"{idf}: trasporto «tcp» ma c'è il blocco «seriale»")
    elif tr in ("rtu", "entrambi") and "seriale" not in mb:
        problema(f"{idf}: trasporto «{tr}» senza il blocco «seriale» (baud, parità…)")
    tt = mb.get("trasporto_tcp")
    if tt is not None and (tt not in ("mbap", "rtu_su_tcp", "solarman_v5") or tr != "tcp"):
        problema(f"{idf}: modbus.trasporto_tcp vuole mbap, rtu_su_tcp o solarman_v5, e trasporto «tcp»")
    for k in ("porta", "intervallo_ms", "pausa_ms", "tentativi"):
        if k in mb and (not isinstance(mb[k], int) or mb[k] < 0):
            problema(f"{idf}: modbus.{k} vuole un intero non negativo")
    for j, b in enumerate(mb.get("blocchi", [])):
        massimo = 2000 if b.get("area") in ("coil", "discrete") else 125
        if not isinstance(b.get("da"), int) or not isinstance(b.get("a"), int) or not 0 <= b["da"] <= b["a"] <= 65535:
            problema(f"{idf}: modbus.blocchi[{j}] vuole 0 ≤ da ≤ a ≤ 65535")
        elif b["a"] - b["da"] + 1 > massimo:
            problema(f"{idf}: modbus.blocchi[{j}] è lungo {b['a'] - b['da'] + 1}, una richiesta ne porta {massimo}")
        if b.get("area", "holding") not in AREE or (b.get("ogni", 1) is not None and (not isinstance(b.get("ogni", 1), int) or b.get("ogni", 1) < 1)):
            problema(f"{idf}: modbus.blocchi[{j}] con area o «ogni» non validi")
    sr = mb.get("setup_ritardato")
    if sr is not None:
        if not all(isinstance(sr.get(k), int) for k in ("da", "a", "scostamento")) or not 0 <= sr["da"] <= sr["a"] <= 65535 \
                or not 0 <= sr["a"] + sr["scostamento"] <= 65535:
            problema(f"{idf}: modbus.setup_ritardato vuole da ≤ a e uno scostamento che resti in 0-65535")
    img = m.get("immagine")
    if img:
        p = os.path.join(CAT, idf.split("/")[0], img)
        if not os.path.isfile(p):
            problema(f"{idf}: l'immagine «{img}» non c'è")
        elif os.path.getsize(p) > MAX_IMMAGINE:
            problema(f"{idf}: l'immagine pesa {os.path.getsize(p)//1024} KB (massimo {MAX_IMMAGINE//1024})")
if len(fail) == prima:
    ok(f"{len(modelli)} modelli completi")

# ── 3. Gli inverter (01-11-2026): fonte, verifica, e il vocabolario canonico.
#    I punti del gruppo `main` sono quelli su cui lavorano allarmi,
#    sinottici, storico e MQTT: un nome fuori vocabolario, o un'unità diversa,
#    e la stessa pagina non vale più per due marche.
print("=== 3. gli inverter parlano il vocabolario canonico ===")
prima = len(fail)
VOC = json.load(open(f"{root}/catalogo/canonico/inverter.json", encoding="utf-8"))
canonici = [(re.compile("^" + re.escape(p["id"]).replace(r"\{n\}", r"\d+") + "$"), p) for p in VOC["punti"]]
for p in VOC["punti"]:
    due_lingue(p.get("descrizione"), f"vocabolario: «{p.get('id')}»")
inverter = [i for i in modelli if file[i].get("categoria") == "inverter"]
for idf in inverter:
    m = file[idf]
    if (m.get("modbus") or {}).get("blocchi") is None:
        problema(f"{idf}: un inverter senza modbus.blocchi farebbe una richiesta per registro")
    v = m.get("verifica") or {}
    if v.get("stato") not in ("non_verificata", "parziale", "verificata") or not v.get("data"):
        problema(f"{idf}: «verifica» vuole stato (non_verificata|parziale|verificata) e data")
    if "note" in v:
        due_lingue(v["note"], f"{idf}: verifica")
    regs = risolti(idf)
    if not any(r.get("gruppo") == VOC["gruppo"] for r in regs):
        problema(f"{idf}: nessun punto nel gruppo «{VOC['gruppo']}»")
    for r in regs:
        if r.get("gruppo") != VOC["gruppo"]:
            continue
        voce = next((p for rx, p in canonici if rx.match(r.get("nome", ""))), None)
        if voce is None:
            problema(f"{idf}: «{r.get('nome')}» sta in «{VOC['gruppo']}» ma non è nel vocabolario canonico")
        elif voce["unita"] and r.get("unita") != voce["unita"]:
            problema(f"{idf}: «{r['nome']}» in {r.get('unita')!r}, il vocabolario vuole {voce['unita']!r}")
for idf, m in file.items():
    fo = m.get("fonte")
    if fo is not None and not all(str(fo.get(k, "")).strip() for k in ("progetto", "url", "licenza")):
        problema(f"{idf}: una «fonte» vuole progetto, url e licenza")
    for e in m.get("esclusi", []):
        if not str(e.get("perche", "")).strip():
            problema(f"{idf}: escluso «{e.get('nome')}» senza il perché")
if len(fail) == prima:
    ok(f"{len(inverter)} inverter, {len(VOC['punti'])} punti nel vocabolario")

print()
if fail:
    print(f"\033[31mcatalogo: {len(fail)} problemi.\033[0m")
    sys.exit(1)
print("\033[32mil catalogo dei dispositivi si legge e dice il vero.\033[0m")
PY
