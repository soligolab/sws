#!/usr/bin/env python3
"""Porta le pagine di un template al formato 1280×800 (regola R1).

PERCHÉ NON UN ROUND-TRIP YAML

Rileggere e riscrivere il file con PyYAML sarebbe più breve e butterebbe via
**tutti i commenti**, che in questi template sono metà del valore: spiegano
perché un tag è derivato, perché una pagina ha quel `home_page_id`, cosa
verificare col broker. Quindi la trasformazione è testuale, riga per riga, e
tocca solo i cinque campi geometrici.

COME SCALA

Fattore **uniforme**, il minore fra i due — così un gauge resta tondo e un
simbolo non si schiaccia — e il contenuto si centra nello spazio che avanza.
Scalare x e y con fattori diversi (1,45 e 1,21 nel caso di 880×660) allungherebbe
ogni widget in orizzontale.

`font_size` scala anche lui: se no il testo rimpicciolisce rispetto a tutto il
resto, e su un pannello si legge peggio di prima.

Uso:
    ./scripts/riflussa_pagina.py examples/templates/<nome> [--prova]
"""
import glob
import os
import re
import sys

LARGA, ALTA = 1280, 800
GEOMETRICI = ("x", "y", "width", "height", "font_size")
RIGA = re.compile(r"^(?P<ind>\s+)(?P<campo>x|y|width|height|font_size)(?P<sep>:\s*)(?P<val>-?\d+(?:\.\d+)?)(?P<coda>\s*(?:#.*)?)$")
PAGINA = re.compile(r"^(?P<campo>width|height)(?P<sep>:\s*)(?P<val>-?\d+(?:\.\d+)?)(?P<coda>\s*(?:#.*)?)$")


def numero(v, originale):
    """Mantiene la forma del numero: chi era intero resta intero."""
    return str(int(round(v))) if "." not in originale else f"{v:.1f}"


def riflussa(percorso, prova=False):
    righe = open(percorso, encoding="utf-8").read().split("\n")
    larga = alta = None
    for r in righe:
        m = PAGINA.match(r)
        if m:
            if m.group("campo") == "width":
                larga = float(m.group("val"))
            else:
                alta = float(m.group("val"))
    if larga is None or alta is None:
        return None
    if (larga, alta) == (LARGA, ALTA):
        return 0
    k = min(LARGA / larga, ALTA / alta)
    dx = (LARGA - larga * k) / 2
    dy = (ALTA - alta * k) / 2

    fuori, toccate = [], 0
    for r in righe:
        m = PAGINA.match(r)
        if m:
            nuovo = LARGA if m.group("campo") == "width" else ALTA
            fuori.append(f"{m.group('campo')}{m.group('sep')}{nuovo}{m.group('coda')}")
            continue
        m = RIGA.match(r)
        if m:
            v, campo = float(m.group("val")), m.group("campo")
            # x/y sono assoluti solo al primo livello; dentro una cella di
            # griglia sono relativi al genitore, che è già scalato — quindi lo
            # scostamento si applica solo alla colonna di primo livello.
            primo = len(m.group("ind")) <= 2
            if campo == "x":
                v = v * k + (dx if primo else 0)
            elif campo == "y":
                v = v * k + (dy if primo else 0)
            else:
                v = v * k
            fuori.append(f"{m.group('ind')}{campo}{m.group('sep')}"
                         f"{numero(v, m.group('val'))}{m.group('coda')}")
            toccate += 1
            continue
        fuori.append(r)
    if not prova:
        open(percorso, "w", encoding="utf-8").write("\n".join(fuori))
    return toccate


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    prova = "--prova" in sys.argv
    if not args:
        print(__doc__)
        sys.exit(2)
    for base in args:
        for f in sorted(glob.glob(f"{base}/synoptics/*.yaml")):
            n = riflussa(f, prova)
            stato = "già 1280×800" if n == 0 else (
                    "nessuna dimensione di pagina" if n is None else f"{n} valori scalati")
            print(f"  {os.path.basename(f)}: {stato}")
