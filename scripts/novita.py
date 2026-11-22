#!/usr/bin/env python3
"""Le Novità di una versione, in una lingua, per le etichette dell'immagine.

Sostituisce `changelog_sezione.py` (28-09-2026): dall'immagine non esce più una
sezione del CHANGELOG — scritto per chi sviluppa, 63 000 caratteri per la 2.12 —
ma le voci brevi di `NOVITA.yaml`, in italiano e inglese (decisioni 55-58 del
piano dell'aggiornamento).

Una pre-release legge la voce della release a cui porta: `2.12.0-rc.8` → `2.12.0`
(decisione 56). Una versione che non c'è dà testo vuoto: una Novità mancante non
deve fermare una build — lo segnala `check_novita.sh`, prima.

Uso:
    novita.py 2.12.0-rc.8 it            # le voci, una per riga, con «- »
    novita.py 2.12.0-rc.8 en --compat   # i soli avvisi di compatibilità
    novita.py --controlla [versione]    # la guardia: due lingue, lunghezza, versione presente
"""
import sys
from pathlib import Path

import yaml

FILE = Path(__file__).resolve().parent.parent / "NOVITA.yaml"
LINGUE = ("it", "en")
MAX_CARATTERI = 220
MAX_VOCI = 15


def carica(percorso: Path = FILE) -> list:
    dati = yaml.safe_load(percorso.read_text(encoding="utf-8")) or {}
    return dati.get("versioni") or []


def base(versione: str) -> str:
    """`2.12.0-rc.8` → `2.12.0`: le rc mostrano la release a cui portano."""
    return versione.split("-", 1)[0]


def voce_della(versioni: list, versione: str) -> dict | None:
    b = base(versione)
    return next((v for v in versioni if str(v.get("versione")) == b), None)


def testo(versioni: list, versione: str, lingua: str, compat: bool = False) -> str:
    v = voce_della(versioni, versione)
    if not v:
        return ""
    righe = v.get("compatibilita" if compat else "voci") or []
    return "\n".join(f"- {r[lingua].strip()}" for r in righe if r.get(lingua))


def controlla(versioni: list, versione: str | None, rilasciate: set[str] | None = None) -> list[str]:
    """I problemi, in parole. Vuoto = tutto a posto.

    `rilasciate`: the versions that have a release tag. When given, the entry
    limit applies only to those blocks and to the declared final release.
    """
    problemi = []
    viste = set()
    # While the declared version is an rc, the block it leads to has no entry
    # limit: everything goes in, and the summary is done with the maintainer
    # before the final release, when the declared version loses its `-rc` and
    # this check turns red again (maintainer's rule, 2026-11-20).
    in_rc = base(versione) if versione and "-" in versione else None
    # Since 22-11-2026 a release can be stabilised on `release/X.Y` while `main`
    # already declares the next one (`2.27.0-dev.0`): the 2.26.0 block is still
    # unreleased, and its summary is still to be done. So, knowing the tags, a
    # block is limited only once it is released, or when it is the declared
    # final release itself.
    def limitato(nome: str) -> bool:
        if rilasciate is not None:
            return nome == versione or nome in rilasciate
        return nome != in_rc
    for v in versioni:
        nome = str(v.get("versione", "?"))
        if nome in viste:
            problemi.append(f"{nome}: la versione compare due volte")
        viste.add(nome)
        voci = v.get("voci") or []
        if not voci:
            problemi.append(f"{nome}: nessuna voce")
        if len(voci) > MAX_VOCI and limitato(nome):
            problemi.append(
                f"{nome}: {len(voci)} voci, al massimo {MAX_VOCI} — sono Novità, non il CHANGELOG. "
                "Prima della release ufficiale si sintetizzano insieme al maintainer"
            )
        for tipo in ("voci", "compatibilita"):
            for i, r in enumerate(v.get(tipo) or [], 1):
                for lingua in LINGUE:
                    t = (r or {}).get(lingua)
                    if not t or not str(t).strip():
                        problemi.append(f"{nome} {tipo} #{i}: manca «{lingua}»")
                    elif len(str(t)) > MAX_CARATTERI:
                        problemi.append(f"{nome} {tipo} #{i} ({lingua}): {len(str(t))} caratteri, al massimo {MAX_CARATTERI}")
    # A dev version may have no entries yet: they are written with the work.
    if versione and "-dev." not in versione and not voce_della(versioni, versione):
        problemi.append(f"la versione dichiarata {versione} non ha Novità (cercata come {base(versione)})")
    return problemi


def tag_rilasciati() -> set[str] | None:
    """The release tags in git (`2.25.2`, old `v2.1.0`), without pre-releases.
    None when git is not there: then the old rule holds."""
    import subprocess
    try:
        out = subprocess.run(["git", "-C", str(FILE.parent), "tag", "-l"],
                             capture_output=True, text=True, check=True).stdout
    except (OSError, subprocess.CalledProcessError):
        return None
    return {t.lstrip("v") for t in out.split() if "-" not in t}


def main(argv: list[str]) -> int:
    if argv and argv[0] == "--controlla":
        problemi = controlla(carica(), argv[1] if len(argv) > 1 else None, tag_rilasciati())
        for p in problemi:
            print(f"✗ {p}")
        return 1 if problemi else 0
    if len(argv) < 2 or argv[1] not in LINGUE:
        print(__doc__, file=sys.stderr)
        return 2
    print(testo(carica(), argv[0], argv[1], compat="--compat" in argv[2:]))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
