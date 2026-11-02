#!/usr/bin/env python3
"""Dal formato solarman al catalogo dei dispositivi di SWS (01-11-2026, piano
docs/archive/2026-11-01-inverter-solarman.md, fase 4).

Le «inverter definitions» dell'integrazione Home Assistant solarman (e dei suoi
fork) descrivono già decine di inverter: richieste a blocchi, registri, regole
di tipo, scale, tabelle di valori. Non si riscrivono a mano: si convertono, e
quello che la comunità non sa (o sbaglia) lo dice una **ricetta** accanto.

    da_solarman.py <definizione solarman .yaml> <ricetta .yaml> <uscita .json>

La ricetta (scripts/inverter/ricette/*.yaml) dice:
- da dove viene la definizione (progetto, file, commit, licenza): finisce nel
  catalogo, perché una mappa importata senza fonte non si può riverificare;
- per ogni punto, per nome solarman: il nome canonico (catalogo/canonico/
  inverter.json) e il gruppo, la scala nelle unità canoniche (kW → W), i limiti
  di plausibilità, il modo dei testi; oppure `escludi` col perché;
- i punti in più ricavati dallo stesso registro (lo stato normalizzato accanto
  al codice grezzo).

I punti che la ricetta non nomina vanno nel gruppo `diagnostics`, non importato
di default, col nome solarman in minuscolo: sono la «pagina dei punti grezzi».

Regole di solarman: 1 = U16, 2 = S16, 3 = U32, 4 = S32. In un valore a 32 bit
`registers` elenca **prima la parola bassa**: [0x21D, 0x21C] è la parola alta a
0x21C, cioè ABCD a partire dall'indirizzo più basso.
"""
import json
import re
import sys

import yaml

FORMATI = {1: "u16", 2: "i16", 3: "u32", 4: "i32"}
AREE = {3: "holding", 4: "input"}


def snake(nome):
    s = re.sub(r"[^a-z0-9]+", "_", nome.lower()).strip("_")
    return s if re.match(r"^[a-z_]", s) else f"p_{s}"


def due(it, en=None):
    return {"it": it, "en": en or it}


def area_di(indirizzo, blocchi):
    for b in blocchi:
        if b["da"] <= indirizzo <= b["a"]:
            return b["area"]
    sys.exit(f"il registro 0x{indirizzo:04X} non sta in nessuna richiesta della definizione")


def testi_da(lookup, modo):
    voci = {}
    for v in lookup:
        k = int(v["key"])
        if modo == "bit":
            if k == 0:
                continue  # «No error»: nessun bit acceso
            if k & (k - 1):
                sys.exit(f"modo bit, ma la chiave {k} non è una potenza di 2")
            k = k.bit_length() - 1
        voci[str(k)] = due(str(v["value"]).strip())
    return {**({"modo": "bit"} if modo == "bit" else {}), "voci": voci}


def converti(defn, ricetta):
    blocchi = [
        {"area": AREE[r["mb_functioncode"]], "da": r["start"], "a": r["end"]}
        for r in defn["requests"]
    ]
    punti = ricetta.get("punti", {})
    usati = set()
    registri, esclusi = [], []
    for gruppo in defn["parameters"]:
        for it in gruppo["items"]:
            nome_ha = it["name"]
            r = punti.get(nome_ha, {})
            usati.add(nome_ha)
            if "escludi" in r:
                esclusi.append({"nome": nome_ha, "registri": [f"0x{x:04X}" for x in it["registers"]], "perche": r["escludi"]})
                continue
            regs = it["registers"]
            formato = r.get("formato", FORMATI[it["rule"]])
            if len(regs) == 2 and regs[1] != regs[0] - 1:
                sys.exit(f"«{nome_ha}»: parola alta non all'indirizzo più basso, serve un ordine diverso")
            indirizzo = min(regs)
            out = {
                "nome": r.get("nome", snake(nome_ha)),
                "indirizzo": indirizzo,
                **({"area": area_di(indirizzo, blocchi)} if area_di(indirizzo, blocchi) != "holding" else {}),
                "formato": formato,
                "accesso": "r",
                "gruppo": r.get("gruppo", "diagnostics"),
            }
            if out["gruppo"] == "diagnostics":
                out["predefinito"] = False
            scala = r.get("scala", it.get("scale", 1))
            if scala != 1:
                out["scala"] = scala
            unita = r.get("unita", it.get("uom") or "")
            if unita:
                out["unita"] = unita
            for k in ("min", "max"):
                if k in r:
                    out[k] = r[k]
            if "lookup" in it and r.get("modo") != "numero":
                out["testi"] = testi_da(it["lookup"], r.get("modo", "valore"))
                out["tipo"] = "string"
            out["descrizione"] = due(r.get("it", nome_ha), nome_ha + (f" — {r['nota']}" if "nota" in r else ""))
            if "nota" in r:
                out["descrizione"]["it"] += f" — {r['nota']}"
            registri.append(out)
    for x in ricetta.get("aggiunti", []):
        registri.append({k: v for k, v in x.items()})
    ignoti = set(punti) - usati
    if ignoti:
        sys.exit(f"la ricetta nomina punti che la definizione non ha: {sorted(ignoti)}")
    nomi = [r["nome"] for r in registri]
    doppi = sorted({n for n in nomi if nomi.count(n) > 1})
    if doppi:
        sys.exit(f"nomi ripetuti: {doppi}")
    s = ricetta["sorgente"]
    return {
        "id": ricetta["id"],
        "descrizione": due(*ricetta["descrizione"]),
        "fonte": {
            "progetto": s["progetto"],
            "url": s["url"],
            "file": s["file"],
            "commit": s["commit"],
            "licenza": s["licenza"],
            "convertito_con": "scripts/inverter/da_solarman.py",
            "ricetta": ricetta["percorso"],
        },
        "esclusi": esclusi,
        "registri": registri,
    }


def main():
    if len(sys.argv) != 4:
        sys.exit(__doc__)
    defn = yaml.safe_load(open(sys.argv[1], encoding="utf-8"))
    ricetta = yaml.safe_load(open(sys.argv[2], encoding="utf-8"))
    ricetta["percorso"] = sys.argv[2]
    out = converti(defn, ricetta)
    with open(sys.argv[3], "w", encoding="utf-8") as f:
        f.write(json.dumps(out, ensure_ascii=False, indent=2) + "\n")
    print(f"{sys.argv[3]}: {len(out['registri'])} registri, {len(out['esclusi'])} esclusi")


if __name__ == "__main__":
    main()
