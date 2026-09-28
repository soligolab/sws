#!/usr/bin/env python3
"""La sezione di CHANGELOG di una versione, e i suoi avvisi di compatibilità.

## Perché esiste (decisione 42 del piano dell'aggiornamento, 28-09-2026)

Il changelog **viaggia dentro l'immagine** come etichetta OCI: prima di
aggiornare un pannello si vuole leggere cosa cambia, e il runtime lo fa senza
scaricare l'immagine — legge le etichette dal registry, pochi KB. Questo
script è la metà che prepara il testo al momento della build.

Per una `-rc` la sezione è `[Unreleased]`: una pre-release racconta ciò che
non è ancora stato numerato.

## Gli avvisi di compatibilità stanno a parte

Sono la cosa che non si deve perdere saltando versioni (decisione 43), quindi
escono in un'etichetta loro invece di restare annegati nel resto. Si scrivono
in una sottosezione `### ⚠ Compatibilità` della versione.

Uso:
    changelog_sezione.py 2.12.0-rc.3          # il testo della sezione
    changelog_sezione.py 2.12.0-rc.3 --compat # i soli avvisi di compatibilità
"""
import re
import sys

TITOLO_COMPAT = "⚠ Compatibilità"


def _pre_release(versione: str) -> bool:
    """`2.12.0-rc.3` e `2.12.0-dev.5` sì, `2.12.0` no."""
    return "-" in versione


def sezione(testo: str, versione: str) -> str:
    """Il corpo della sezione di quella versione, senza la sua intestazione.

    Per una pre-release si legge `[Unreleased]`, che è dove il lavoro vive
    finché non gli si dà un numero. Stringa vuota se la sezione non c'è: un
    changelog incompleto non deve fermare una build.
    """
    voluta = "[Unreleased]" if _pre_release(versione) else f"[{versione}]"
    righe = testo.split("\n")
    inizio = next(
        (i for i, r in enumerate(righe) if r.startswith("## ") and voluta in r),
        None,
    )
    if inizio is None:
        return ""
    fine = next(
        (i for i in range(inizio + 1, len(righe)) if righe[i].startswith("## ")),
        len(righe),
    )
    return "\n".join(righe[inizio + 1:fine]).strip()


def compatibilita(testo: str, versione: str) -> str:
    """I soli avvisi di compatibilità della versione, senza l'intestazione.

    Cerca la sottosezione `### ⚠ Compatibilità` **dentro** la sezione della
    versione: un avviso scritto in un'altra versione non riguarda questo
    salto, e mescolarli renderebbe la finestra di aggiornamento un elenco di
    paure vecchie.
    """
    corpo = sezione(testo, versione)
    if not corpo:
        return ""
    righe = corpo.split("\n")
    inizio = next(
        (i for i, r in enumerate(righe) if r.startswith("### ") and TITOLO_COMPAT in r),
        None,
    )
    if inizio is None:
        return ""
    fine = next(
        (i for i in range(inizio + 1, len(righe)) if righe[i].startswith("### ")),
        len(righe),
    )
    return "\n".join(righe[inizio + 1:fine]).strip()


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__.strip().split("Uso:")[-1].strip(), file=sys.stderr)
        return 2
    versione = sys.argv[1]
    solo_compat = "--compat" in sys.argv[2:]
    percorso = next((a for a in sys.argv[2:] if not a.startswith("--")), "CHANGELOG.md")
    try:
        testo = open(percorso, encoding="utf-8").read()
    except OSError as e:
        print(f"CHANGELOG non leggibile: {e}", file=sys.stderr)
        return 1
    print(compatibilita(testo, versione) if solo_compat else sezione(testo, versione))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
