"""Prepara i sorgenti del sito del manuale (piano manuale pubblico, M1, 12-11-2026).

Uso: python3 -I prepara.py <docs/manual> <capitoli_pubblici.txt> <cartella di lavoro>

Copia i capitoli pubblici e le schermate in <lavoro>/docs, con MAIN.md come index.md, e riscrive i link
che sul sito non andrebbero da nessuna parte: verso un capitolo non pubblicato e verso un file del repo
(che non è pubblico) diventano testo, col nome tra virgolette basse. Scrive <lavoro>/mkdocs.yml con la
navigazione nell'ordine dell'elenco. Stampa quanti link ha riscritto."""
import os, re, shutil, sys

sorgente, elenco, lavoro = sys.argv[1:4]
voci = [l.rstrip("\n") for l in open(elenco, encoding="utf-8")]
capitoli = [v for v in voci if v and not v.startswith(("#", "=="))]
pubblici = set(capitoli)
docs = os.path.join(lavoro, "docs")
shutil.rmtree(lavoro, ignore_errors=True)
os.makedirs(docs)
if os.path.isdir(os.path.join(sorgente, "screenshots")):
    shutil.copytree(os.path.join(sorgente, "screenshots"), os.path.join(docs, "screenshots"))

def nome_sito(f):
    return "index.md" if f == "MAIN.md" else f

LINK = re.compile(r"(!?)\[([^\]]*)\]\(([^)\s]+)\)")
riscritti = {"capitolo": 0, "repo": 0}

def riscrivi(m):
    immagine, testo, dest = m.group(1), m.group(2), m.group(3)
    if immagine or dest.startswith(("http://", "https://", "mailto:", "#")):
        return m.group(0)
    percorso, _, ancora = dest.partition("#")
    if percorso.startswith("screenshots/"):
        return m.group(0)
    if percorso.endswith(".md") and "/" not in percorso:
        if percorso in pubblici:
            nuovo = nome_sito(percorso) + (("#" + ancora) if ancora else "")
            return f"[{testo}]({nuovo})"
        riscritti["capitolo"] += 1
        return f"«{testo}»"
    # un file del repo: il repo non è pubblico
    riscritti["repo"] += 1
    return f"«{testo}»"

ESCLUSO = re.compile(r"\]\((?!https?:)([^)#\s/]+\.md)")

def senza_righe_escluse(testo):
    # Una riga di tabella che porta a un capitolo non pubblicato (l'indice di MAIN.md) si toglie:
    # sul sito sarebbe una voce che non porta da nessuna parte.
    righe = []
    for r in testo.split("\n"):
        if r.lstrip().startswith("|") and any(m not in pubblici for m in ESCLUSO.findall(r)):
            riscritti["righe"] += 1
            continue
        righe.append(r)
    return "\n".join(righe)

riscritti["righe"] = 0
for c in capitoli:
    testo = open(os.path.join(sorgente, c), encoding="utf-8").read()
    testo = senza_righe_escluse(testo)
    testo = LINK.sub(riscrivi, testo)
    open(os.path.join(docs, nome_sito(c)), "w", encoding="utf-8").write(testo)

def titolo(f):
    for riga in open(os.path.join(sorgente, f), encoding="utf-8"):
        if riga.startswith("# "):
            return riga[2:].strip().replace('"', "'")
    return f

nav, sezione = [], None
for v in voci:
    if not v:
        continue
    if v.startswith("=="):
        sezione = {v[2:].strip(): []}
        nav.append(sezione)
    elif v.startswith("#"):
        continue
    elif sezione is None:
        nav.append({titolo(v): nome_sito(v)})
    else:
        list(sezione.values())[0].append({titolo(v): nome_sito(v)})

def yaml_nav(voci, rientro=2):
    righe = []
    for voce in voci:
        (k, v), = voce.items()
        if isinstance(v, list):
            righe.append(" " * rientro + f'- "{k}":')
            righe += yaml_nav(v, rientro + 4)
        else:
            righe.append(" " * rientro + f'- "{k}": {v}')
    return righe

config = f"""site_name: "SWS — SCADA Web Studio"
site_url: https://sws.soligo.net/manuale/
docs_dir: docs
site_dir: site
use_directory_urls: false
theme:
  name: material
  language: it
  features:
    - navigation.sections
    - navigation.top
    - search.highlight
    - content.code.copy
markdown_extensions:
  - admonition
  - tables
  - attr_list
  - toc:
      permalink: true
      slugify: !!python/object/apply:pymdownx.slugs.slugify
        kwds:
          case: lower
  - pymdownx.superfences:
      custom_fences:
        - name: mermaid
          class: mermaid
          format: !!python/name:pymdownx.superfences.fence_code_format
validation:
  links:
    not_found: warn
    anchors: warn
nav:
""" + "\n".join(yaml_nav(nav)) + "\n"
open(os.path.join(lavoro, "mkdocs.yml"), "w", encoding="utf-8").write(config)
print(f"{len(capitoli)} capitoli; righe di tabella tolte: {riscritti['righe']}; link riscritti come testo: "
      f"{riscritti['capitolo']} verso capitoli non pubblici, {riscritti['repo']} verso il repo")
