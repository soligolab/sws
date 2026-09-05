#!/usr/bin/env bash
#
# Q30 — chi riscrive `project.yaml` e chi se ne accorge.
#
# PERCHÉ ESISTE
#
# `PATH_VERSIONATI`, in `sws-editor/src/api/client.ts`, porta scritto:
#
#     Rispecchia gli handler che in router.rs chiamano patch_project_se:
#     se cambia lì, cambia qui.
#
# Informazione duplicata tenuta insieme da una frase in prosa. Il 2026-09-05 ha
# mentito: `POST /api/project/migrate` riscrive `project.yaml` — il pulsante
# «⚠ Aggiorna progetto» — e non era in nessuna lista, quindi il client buttava
# la versione nuova e da lì ogni salvataggio prendeva un 409 con scritto
# «qualcun altro ha modificato il progetto mentre lavoravi». Non era qualcun
# altro: era lo stesso client, un pulsante prima. **Un conflitto inventato
# insegna a ignorare i conflitti veri**, che è esattamente ciò che Q30 esisteva
# per evitare.
#
# Nessuno l'ha visto per due settimane perché niente lo diceva. Ora lo dice
# questa guardia.
#
# COSA CONTROLLA
#
# Classifica ogni rotta che scrive un file di progetto guardando il **corpo**
# del suo handler, e pretende che il client la copra nel modo giusto:
#
#   SE     l'handler chiama `patch_project_se` → confronta `If-Match`
#          ⇒ deve stare in `PATH_VERSIONATI` (il client manda la versione)
#   PLAIN  chiama `patch_project` → scrive senza confronto, ma la risposta
#          porta l'`ETag` nuovo
#          ⇒ deve stare in `PATH_RIPORTANO_VERSIONE` (il client la incassa)
#   RAW    scrive il file per conto suo, e la risposta **non** porta la versione
#          ⇒ per i file per-entità (sinottici, faceplate, ricette) è coperta da
#            `VERSIONI_FILE`; per gli altri serve un rimedio nel componente che
#            la chiama, e va dichiarato qui sotto in `RIMEDI_RAW`
#
# Una rotta nuova che scrive e non è classificata fa fallire questa guardia: è
# lo stesso principio di `check_static.sh`, dove una guardia non classificata
# fa fallire lui.
#
# Uso:  ./scripts/check_versione_progetto.sh
set -euo pipefail
cd "$(dirname "$0")/.."

exec python3 - "$PWD" <<'PY'
import re, sys, os

root = sys.argv[1]
SRC  = f"{root}/sws-runtime/crates/sws-web/src"
CLIENT = f"{root}/sws-editor/src/api/client.ts"

# I rimedi per le rotte RAW, cioè quelle la cui risposta non porta la versione.
# Ogni voce dice **dove** il client rimedia: la guardia non può verificarlo (il
# rimedio sta in un componente, non nel client), ma può pretendere che ogni
# rotta RAW nuova venga guardata da qualcuno invece di passare in silenzio.
RIMEDI_RAW = {
    "/api/project/import":
        "MainMenu.handleImport rilegge con getProject() subito dopo l'import",
    "/api/projects/:name/rename":
        "MainMenu.handleRename rilegge con getProject() (la risposta è {name}, senza ETag)",
    "/api/projects/upload":
        "ConfigView chiama dimenticaVersioneProgetto() e poi openProject()",
}

FAMIGLIE = ("/api/project", "/api/projects", "/api/synoptics", "/api/faceplates", "/api/recipes")

def testo(nome):
    with open(os.path.join(SRC, nome), encoding="utf-8") as f:
        return f.read()

MODULI = {}
for n in os.listdir(SRC):
    if n.endswith(".rs"):
        MODULI[n] = testo(n)

def estrai(testo_, pattern, cosa, dove):
    m = re.search(pattern, testo_, re.S)
    if not m:
        print(f"  \033[31m✗\033[0m non trovo {cosa} in {dove}")
        print( "      La forma della dichiarazione è cambiata: questo controllo non sta")
        print( "      più guardando niente, e va aggiornato — non è che i percorsi siano")
        print( "      spariti.")
        sys.exit(1)
    return m.group(1)

# ── Le due liste del client ──────────────────────────────────────────────────
cl = open(CLIENT, encoding="utf-8").read()
versionati = set(re.findall(r'"(/api/[^"]+)"',
    estrai(cl, r'const PATH_VERSIONATI(?::[^=]+)? = \[(.*?)\];', "PATH_VERSIONATI", "client.ts")))
riportano = set(re.findall(r'"(/api/[^"]+)"',
    estrai(cl, r'const PATH_RIPORTANO_VERSIONE(?::[^=]+)? = \[(.*?)\];', "PATH_RIPORTANO_VERSIONE", "client.ts")))
# La regola con cui il client riconosce i file per-entità.
per_file_re = estrai(cl, r'function chiaveFile\(path: string\): string \| null \{\s*return (/\^.*?/)\.test',
                     "chiaveFile", "client.ts")
per_file_fam = re.findall(r'\((\w+(?:\|\w+)*)\)', per_file_re)
per_file_fam = per_file_fam[0].split("|") if per_file_fam else []

# ── Le rotte del server, classificate dal corpo del loro handler ─────────────
rotte = set(re.findall(r'\.route\(\s*"(/api/[^"]*)"\s*,\s*(\w+)\(([\w:]+)\)', MODULI["router.rs"]))

def corpo(handler):
    n = handler.split("::")[-1]
    pat = r'\n(?:pub(?:\(crate\))? )?(?:async )?fn ' + re.escape(n) + r'\b.*?\n\}'
    for t in MODULI.values():
        m = re.search(pat, t, re.S)
        if m:
            return m.group(0)
    return None

male = False
classificate = {"SE": set(), "PLAIN": set(), "RAW": set()}
senza_corpo = []

for path, _metodo, handler in sorted(rotte):
    if not path.startswith(FAMIGLIE):
        continue
    b = corpo(handler)
    if b is None:
        senza_corpo.append((path, handler))
        continue
    if "patch_project_se(" in b:
        classificate["SE"].add(path)
    elif "patch_project(" in b:
        classificate["PLAIN"].add(path)
    elif ("patch_project_name(" in b or "stamp_saved_by(" in b or "scrivi_atomico" in b):
        classificate["RAW"].add(path)

# ── I tre confronti ──────────────────────────────────────────────────────────
for path in sorted(classificate["SE"] - versionati):
    print(f"  \033[31m✗\033[0m {path} confronta If-Match sul server ma non è in PATH_VERSIONATI")
    print( "      Il client non manda la versione, quindi la protezione di Q30 su quella")
    print( "      sezione non c'è: due schede aperte insieme si cancellano a vicenda in")
    print( "      silenzio, che è il difetto che Q30 esisteva per chiudere.")
    male = True

for path in sorted(versionati - classificate["SE"]):
    print(f"  \033[31m✗\033[0m {path} è in PATH_VERSIONATI ma sul server non confronta If-Match")
    print( "      O la rotta è stata rinominata, o l'handler non passa più da")
    print( "      patch_project_se. Il client manda un If-Match che nessuno guarda: una")
    print( "      riga che dichiara una protezione inesistente.")
    male = True

for path in sorted(classificate["PLAIN"] - riportano):
    print(f"  \033[31m✗\033[0m {path} riscrive project.yaml e la sua risposta porta l'ETag,")
    print( "      ma il percorso non è in PATH_RIPORTANO_VERSIONE: il client butta la")
    print( "      versione nuova e il salvataggio SUCCESSIVO prende un 409 contro se")
    print( "      stesso, con scritto «qualcun altro ha modificato il progetto». È")
    print( "      esattamente il difetto del 2026-09-05 su «⚠ Aggiorna progetto».")
    male = True

for path in sorted(riportano - classificate["PLAIN"]):
    print(f"  \033[31m✗\033[0m {path} è in PATH_RIPORTANO_VERSIONE ma non riscrive più project.yaml")
    male = True

for path in sorted(classificate["RAW"]):
    fam = path.split("/")[2] if len(path.split("/")) > 2 else ""
    if fam in per_file_fam:
        continue            # coperta da VERSIONI_FILE, chiave = percorso
    if path not in RIMEDI_RAW:
        print(f"  \033[31m✗\033[0m {path} scrive un file di progetto e la risposta non porta la versione,")
        print( "      e non è dichiarata in RIMEDI_RAW in questo script. Dopo quella chiamata")
        print( "      il client resta su una versione che non esiste più, e il primo")
        print( "      salvataggio prende un 409 che non ha nessuna corsa dietro. Scrivi qui")
        print( "      dove il client rimedia (una getProject(), o")
        print( "      dimenticaVersioneProgetto()) — o rimediaci, se non lo fa nessuno.")
        male = True

for path in sorted(set(RIMEDI_RAW) - classificate["RAW"]):
    print(f"  \033[31m✗\033[0m {path} è dichiarata in RIMEDI_RAW ma non scrive più niente: togliela")
    male = True

if senza_corpo:
    print(f"  \033[33m•\033[0m {len(senza_corpo)} handler senza corpo trovato (non classificabili):")
    for path, h in senza_corpo:
        print(f"      {path} → {h}")
    print( "      Se una di queste scrive project.yaml, questa guardia non la vede.")

if male:
    sys.exit(1)

print(f"  \033[32m✓\033[0m versione del progetto: {len(classificate['SE'])} sezioni con If-Match, "
      f"{len(classificate['PLAIN'])} che riportano la versione,")
print(f"    {len(classificate['RAW'])} scritture dirette con rimedio dichiarato — client e server d'accordo")
PY
