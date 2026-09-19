#!/usr/bin/env bash
#
# L'interfaccia dell'IDE parla dal catalogo, o ha ancora italiano cablato?
#
# PERCHÉ ESISTE
#
# Il 18-09-2026 una misura ha detto che `it.json` ed `en.json` sono in parità
# perfetta — 1271 chiavi, protette da `tests/i18nParita.test.ts` — e che
# nonostante questo l'IDE ha **~320 stringhe italiane fuori dal catalogo**: 204
# in un solo file, 26 dentro `confirm`/`alert`/`prompt`, 31 in `title` e
# `placeholder`. La parità del catalogo era protetta; la **copertura** del
# catalogo — quante stringhe ci finiscono dentro — non la guardava nessuno, e
# un debito che nessuno conta cresce.
#
# Questa guardia conta. Non pretende di trovare tutto: un'euristica su un
# linguaggio che non viene parsato ha falsi negativi («OK», «Reset»). Serve a
# **non tornare indietro**: ogni file ha il suo tetto, misurato il giorno in cui
# la guardia è nata, e il tetto può solo scendere.
#
# TRE ASSI, E QUESTA NE GUARDA UNO
#
# (a) la lingua dell'interfaccia dell'IDE — menu, schede, dialoghi: it.json/en.json,
#     `t()`. **È questo.**
# (b) i contenuti di progetto — «Testo», «Bottone», «Vai alla pagina» come valori
#     predefiniti degli oggetti sono asse (b) e NON vanno in `t()`: li esclude il
#     punto 5, leggendo i campi da `projectI18n.ts` come fa `check_i18n_parita.sh`.
# (c) il testo di sistema del viewer — `testi_sistema.rs`, `viewerChrome.*`: ha
#     la sua guardia.
#
# Uso:
#   ./scripts/check_i18n_ui.sh                        # verifica contro i tetti
#   ./scripts/check_i18n_ui.sh --elenca <file>        # tutti i candidati, con riga
#   ./scripts/check_i18n_ui.sh --autotest             # l'euristica su un frammento noto
set -uo pipefail
cd "$(dirname "$0")/.."
exec python3 - "$PWD" "$@" <<'PY'
import os, re, sys

root = sys.argv[1]
argv = sys.argv[2:]
SRC = f"{root}/sws-editor/src"
PI18N = f"{SRC}/i18n/projectI18n.ts"

# ── Debito dichiarato ────────────────────────────────────────────────────────
#
# Stringhe italiane fuori da `t()` per file, misurate dal PRIMO giro di questa
# guardia il 18-09-2026. Se un file cresce la guardia fallisce; se cala chiede
# di abbassare il numero; un file a zero va tolto. Vuoto = capitolo chiuso: se
# ricompare una riga, è un file tornato indietro.
TETTI = {
    "src/config/ConfigView.tsx": 334,  # F6: -50 (26 dialoghi + 21 title, alcuni contati doppi da concatenazioni)
    "src/editor/EditorShell.tsx": 70,  # F6: -1 (1 dialogo)
    "src/store/index.ts": 35,
    "src/editor/LeftPanel.tsx": 15,  # F6: -8 (2 dialoghi + 6 title, alcuni contati doppi)
    "src/canvas/SvgCanvas.tsx": 11,  # F6: -8 (6 dialoghi + 6 title, alcuni contati doppi)
    "src/config/credenzialiDispositivo.ts": 8,
    "src/api/client.ts": 5,  # +1 F5: un percorso di rotta ("/api/traduzione/config"), non testo utente — vedi URL_CONFIG_TRADUZIONE nel file
    "src/canvas/TrendCanvas.tsx": 4,
    "src/components/AlarmBellPanel.tsx": 4,
    "src/components/ChatPanel.tsx": 4,
    "src/types/ai.ts": 4,
    "src/ai/riassunto.ts": 3,
    "src/components/LogPanel.tsx": 3,
    "src/components/ReAuthModal.tsx": 3,
    "src/pageLayout.ts": 3,
    "src/runtime-view/RuntimeView.tsx": 3,
    "src/search/tagUsage.ts": 3,
    "src/App.tsx": 2,
    "src/canvas/percorsoMovimento.ts": 2,
    "src/components/ImageBrowser.tsx": 2,
    "src/components/LoginScreen.tsx": 2,
    "src/config/installazione/sondaggio.ts": 2,
    "src/viewer/RuntimeViewer.tsx": 2,
    "src/ws/reconnectingWs.ts": 2,
    "src/ai/diffRighe.ts": 1,
    "src/canvas/XyPlotCanvas.tsx": 1,
    "src/components/ChangePasswordScreen.tsx": 1,
    "src/components/DataTable.tsx": 1,
    "src/components/RecipePanel.tsx": 1,
    "src/components/TagInput.tsx": 1,
    "src/components/WelcomeScreen.tsx": 1,
    "src/config/installazione/ListaControlli.tsx": 1,
    "src/tagCatalog.ts": 1,
}

# `confirm`/`alert`/`prompt` con testo letterale: bloccano l'utente con una
# frase che non può cambiare lingua. F6 (19-09-2026) ha azzerato gli ultimi
# quattro file che ne portavano ancora: da qui in avanti è tolleranza zero,
# un `confirm`/`alert`/`prompt` con un letterale ovunque nel codice è
# `problema`, non un debito dichiarabile.
DIALOGHI = {}

# ── I campi di testo dei contenuti (asse b) ──────────────────────────────────
#
# Un letterale che è il VALORE di uno di questi campi (`text: "Testo"`,
# `label: "Bottone"`) è contenuto predefinito di un oggetto, non interfaccia.
# L'elenco si legge dalla fonte — `TEXT_FIELDS` in projectI18n.ts, la stessa
# estrazione di `check_i18n_parita.sh` — così non marcisce.
def campi_contenuto():
    testo = open(PI18N, encoding="utf-8").read()
    m = re.search(r"const TEXT_FIELDS[^=]*=\s*\[(.*?)\];", testo, re.S)
    if not m:
        print("  \033[31m✗\033[0m TEXT_FIELDS non trovato in projectI18n.ts: la guardia non sa più cos'è contenuto")
        sys.exit(1)
    campi = set(re.findall(r'"([a-z_]+)"', m.group(1)))
    # I valori dentro gli array annidati (options[].label, table_rows[].label…)
    # passano tutti da `label`, che è già nell'elenco. `name` è il nome di
    # pagina/oggetto: contenuto anche lui.
    campi |= {"label", "name"}
    return campi

CAMPI = campi_contenuto()

# ── Lo scanner ───────────────────────────────────────────────────────────────
#
# A caratteri, non regex sul file intero: distingue stringhe, template,
# commenti riga/blocco e JSX `{/* */}`. Restituisce i letterali con riga e
# contesto, e il sorgente con commenti e letterali SOSTITUITI da spazi (a
# lunghezza uguale, a capo conservati) per la ricerca del testo JSX.
def scansiona(src):
    letterali = []          # (riga, testo, contesto_prima)
    pulito = list(src)      # senza commenti né letterali
    senza_commenti = list(src)
    i, n = 0, len(src)

    def cancella(buf, a, b):
        for k in range(a, b):
            if buf[k] != "\n":
                buf[k] = " "

    while i < n:
        c = src[i]
        due = src[i:i+2]
        if due == "//":
            j = src.find("\n", i)
            j = n if j < 0 else j
            cancella(pulito, i, j); cancella(senza_commenti, i, j)
            i = j
        elif due == "/*":
            j = src.find("*/", i + 2)
            j = n if j < 0 else j + 2
            cancella(pulito, i, j); cancella(senza_commenti, i, j)
            i = j
        elif c in "\"'":
            j = i + 1
            while j < n and src[j] != c:
                if src[j] == "\\": j += 1
                if src[j] == "\n": break
                j += 1
            testo = src[i+1:j]
            letterali.append((src.count("\n", 0, i) + 1, testo, src[max(0, i-80):i]))
            cancella(pulito, i, j + 1)
            i = j + 1
        elif c == "`":
            j = i + 1
            pezzi = []
            inizio = j
            while j < n and src[j] != "`":
                if src[j] == "\\":
                    j += 2; continue
                if src[j:j+2] == "${":
                    pezzi.append(src[inizio:j])
                    prof = 1; j += 2
                    while j < n and prof:
                        if src[j] == "{": prof += 1
                        elif src[j] == "}": prof -= 1
                        j += 1
                    inizio = j
                    continue
                j += 1
            pezzi.append(src[inizio:j])
            testo = " ".join(p.strip() for p in pezzi if p.strip())
            letterali.append((src.count("\n", 0, i) + 1, testo, src[max(0, i-80):i]))
            cancella(pulito, i, j + 1)
            i = j + 1
        elif c == "/" and src[max(0, i - 1):i].strip() in (
            "", "(", "[", "{", ",", ";", ":", "!", "&", "|", "?", "=", "+", "-", "*", "%", "^", "~", "<", ">",
        ):
            # Un letterale regex — `/[",\n]/`, `/"/g` — non un commento né una
            # divisione. Senza questo ramo un `"` dentro le parentesi quadre
            # della classe di caratteri veniva letto come apertura di stringa,
            # e la ricerca del suo chiusa finiva per inghiottire il resto del
            # file fino al prossimo apice sopravvissuto per caso — un backtick
            # vero decine di migliaia di caratteri più avanti, scambiato per
            # l'apertura di un nuovo template literal mai chiuso. La
            # precedenza (carattere non alfanumerico prima dello slash, non
            # `)`/`]`/`}` — quelli sì che sarebbero una divisione) è la stessa
            # euristica usata dai tokenizer JS "sloppy". Trovato il 19-09-2026
            # quando F6 ha tolto un dialogo fra la regex CSV e un commento con
            # backtick: il conteggio di apici che pareggiava per caso è
            # diventato dispari, e la guardia è esplosa con un IndexError.
            j = i + 1
            in_class = False
            chiuso = False
            while j < n:
                cj = src[j]
                if cj == "\\":
                    j += 2
                    continue
                if cj == "\n":
                    break
                if cj == "[":
                    in_class = True
                elif cj == "]":
                    in_class = False
                elif cj == "/" and not in_class:
                    j += 1
                    chiuso = True
                    break
                j += 1
            if not chiuso:
                # L'euristica ha abboccato a una divisione vera (raro coi
                # caratteri ammessi sopra, ma possibile): niente panico, si
                # tratta `/` come un carattere qualunque e si va avanti.
                i += 1
                continue
            while j < n and src[j].isalpha():  # flag: g, i, m, u, s, y…
                j += 1
            cancella(pulito, i, j); cancella(senza_commenti, i, j)
            i = j
        else:
            i += 1
    return letterali, "".join(pulito), "".join(senza_commenti)

# ── È italiano? ──────────────────────────────────────────────────────────────
ACCENTI = re.compile(r"[àèéìòùÀÈÉÌÒÙ]")
FORTI = re.compile(r"\b(della|delle|degli|dell|nessun[ao]?|già|elimina(re|ta|to)?|salva(re|to|taggio)?|"
                   r"annulla(re)?|conferma(re|to)?|aggiungi|rimuovi|carica(re|to|mento)?|modifica(re|to)?|"
                   r"traduci|traduzione|fallit[ao]|pagin[ae]|oggett[oi]|progett[oi]|allarm[ei]|chiave|"
                   r"fornitore|operazione|irreversibile|ricarica|verrà|scarica|nuov[oa]|vuot[oa]|errore|"
                   r"sorgent[ei]|dispositiv[oi]|variabil[ei]|tutt[ei]|nessuna|attesa|impostazioni|"
                   r"seleziona|inserisci|motivo|obbligatorio|ancora|riga|voce|collegament[oi]|"
                   r"connessione|avvi[oa]|marcia|fermo|dati|valore|storico|finestra|campion[ei]|"
                   r"esporta|importa|cerca|filtra|ordina|apri|chiudi|indietro|avanti|pronto)\b", re.I)
DEBOLI = re.compile(r"\b(il|lo|la|gli|le|un|una|con|per|non|che|del|dei|sul|nel|anche|tutto|se|di|da|in|è)\b", re.I)

def e_italiano(s):
    if not re.search(r"[A-Za-zÀ-ÿ]", s):
        return False
    if ACCENTI.search(s):
        return True
    if FORTI.search(s):
        return True
    # Due parole deboli **distinte**: «Lo-Lo» (soglia di allarme) ne ha una
    # sola ripetuta e non è italiano.
    return len({w.lower() for w in DEBOLI.findall(s)}) >= 2

# Un identificatore travestito da stringa: `"non-trovato"`, `"senza-login"`,
# `"my_memory"`. Niente spazi, solo minuscole e separatori.
IDENTIFICATORE = re.compile(r"^[a-z0-9]+([._:/-][a-z0-9]+)+$")

# ── Esclusioni sul contesto che precede il letterale ─────────────────────────
#
# Ognuna con il perché. Aggiungerne una senza motivo scritto è il modo di
# far scendere il conto senza far scendere il debito.
ESCLUSIONI = [
    # già tradotto: è l'argomento di t() / i18n.t() / tr()
    (re.compile(r"(?:^|[^\w.])(?:i18n\.)?tr?\(\s*$"), "argomento di t()"),
    # la CHIAVE di una voce del testo di sistema («dati», «valore»): passa dalla
    # tabella condivisa con il pannello LVGL, nella lingua dei contenuti — è
    # l'altro asse, non una scritta dell'IDE
    (re.compile(r"\btestoSistema\(\s*$"), "chiave del testo di sistema"),
    # rivolto allo sviluppatore, non all'operatore
    (re.compile(r"console\.(?:log|warn|error|info|debug)\(\s*$"), "console"),
    (re.compile(r"new Error\(\s*$"), "Error — ATTENZIONE: se finisce in un alert(e.message) è debito vero"),
    # import, confronti e switch: è un valore, non una scritta
    (re.compile(r"\bfrom\s*$"), "import"),
    (re.compile(r"(?:===|!==|==|!=)\s*$"), "confronto"),
    (re.compile(r"\bcase\s*$"), "case"),
    # chiave del catalogo scritta a mano (t(k) dove k è il letterale)
    (re.compile(r"\b(?:key|chiave|id|type|kind|mode|value|className|style|href|src|d)\s*[:=]\s*$"), "valore tecnico"),
]

def esclusa(contesto, testo):
    ctx = contesto.rstrip()
    for rx, _ in ESCLUSIONI:
        if rx.search(ctx):
            return True
    # valore di un campo di contenuto: `text: "…"`, `label: "…"`
    m = re.search(r"\b([a-z_]+)\s*:\s*$", ctx)
    if m and m.group(1) in CAMPI:
        return True
    if IDENTIFICATORE.match(testo.strip()):
        return True
    return False

JSX_TESTO = re.compile(r">\s*([^<>{}]*?)\s*<")
# Fra un `=>` e un `<Generico>` la regex del testo JSX pesca codice: se dentro
# ci sono `;`, `const`, `return`, `??`, `===` non è una scritta, è TypeScript.
CODICE = re.compile(r";|\b(const|let|return|import|export|function)\b|=>|\?\?|===|!==")
DIALOGO = re.compile(r"(?<![\w.])(?:window\.)?(confirm|alert|prompt)\(\s*([\"'`])")

def normalizza(t):
    return re.sub(r"\s+", " ", t).strip()

def candidati(percorso):
    src = open(percorso, encoding="utf-8").read()
    letterali, pulito, senza_commenti = scansiona(src)
    fuori = []
    for riga, testo, ctx in letterali:
        if e_italiano(testo) and not esclusa(ctx, testo):
            fuori.append((riga, normalizza(testo)))
    for m in JSX_TESTO.finditer(pulito):
        t = m.group(1)
        if CODICE.search(t):
            continue
        if e_italiano(t):
            fuori.append((pulito.count("\n", 0, m.start(1)) + 1, normalizza(t)))
    dialoghi = [(senza_commenti.count("\n", 0, m.start()) + 1, m.group(1))
                for m in DIALOGO.finditer(senza_commenti)]
    return sorted(set(fuori)), dialoghi

# File che CONTENGONO testo in più lingue per mestiere, e che quindi hanno
# italiano dentro per definizione — non è interfaccia cablata, è la tabella.
# Ognuno con il perché; la sua parità la guarda un'altra guardia.
FUORI_PERIMETRO = {
    # il testo di sistema del viewer (asse c): stessa tabella del pannello LVGL,
    # verificata da check_testi_sistema.sh contro tests/fixtures/testi-sistema.json
    "i18n/testiSistema.ts",
}

def file_del_perimetro():
    for base, _, nomi in os.walk(SRC):
        for nome in nomi:
            if not nome.endswith((".ts", ".tsx")):
                continue
            if ".test." in nome or ".spec." in nome:
                continue
            percorso = os.path.join(base, nome)
            if os.path.relpath(percorso, SRC) in FUORI_PERIMETRO:
                continue
            yield percorso

def rel(p):
    return os.path.relpath(p, f"{root}/sws-editor")

# ── Autotest dell'euristica ──────────────────────────────────────────────────
#
# Un frammento con una cosa per caso: chi ritocca l'euristica deve continuare
# a ottenere esattamente 2 stringhe e 1 dialogo, o ha cambiato cosa conta.
FRAMMENTO = r'''
import { x } from "modulo";
// Un commento in italiano che non deve contare: nessun problema qui.
/* Neppure questo: la pagina è vuota. */
const a = t("cfg.salva");
const b = i18n.t("editor.nuovaPagina");
addObject({ type: "text", text: "Testo", label: "Bottone" });
const c = window.confirm(t("welcome.confirmDelete"));
const d = window.confirm("Eliminare la pagina?");
const e = "non-trovato";
if (v === "Allarme") {}
console.warn("Salvataggio fallito");
const f = <div title="Salva le modifiche">{t("x")}</div>;
const g = <span>Nessun dato disponibile</span>;
const h = `Importati ${n} tag. Ricarica la pagina`;
'''
ATTESI_STRINGHE = {"Salva le modifiche", "Nessun dato disponibile", "Eliminare la pagina?",
                   "Importati tag. Ricarica la pagina"}

if argv[:1] == ["--autotest"]:
    import tempfile
    with tempfile.NamedTemporaryFile("w", suffix=".tsx", delete=False, encoding="utf-8") as f:
        f.write(FRAMMENTO); tmp = f.name
    stringhe, dialoghi = candidati(tmp)
    os.unlink(tmp)
    trovate = {t for _, t in stringhe}
    ok = trovate == ATTESI_STRINGHE and len(dialoghi) == 1
    print(("  \033[32m✓\033[0m" if ok else "  \033[31m✗\033[0m") +
          f" autotest: stringhe {sorted(trovate)} | dialoghi {len(dialoghi)}")
    if not ok:
        print(f"      attese: {sorted(ATTESI_STRINGHE)} e 1 dialogo")
    sys.exit(0 if ok else 1)

if argv[:1] == ["--elenca"]:
    for p in argv[1:]:
        percorso = p if os.path.isabs(p) else f"{root}/sws-editor/{p}"
        stringhe, dialoghi = candidati(percorso)
        print(f"\033[1m{rel(percorso)}\033[0m — {len(stringhe)} stringhe, {len(dialoghi)} dialoghi")
        for riga, t in stringhe:
            print(f"  {riga:5}  {t[:100]!r}")
        for riga, quale in dialoghi:
            print(f"  {riga:5}  window.{quale}( con testo letterale")
    sys.exit(0)

# ── La verifica ──────────────────────────────────────────────────────────────
fail, debiti, note = [], [], []
def problema(m): print(f"  \033[31m✗\033[0m {m}"); fail.append(m)
def debito(m):   print(f"  \033[33m•\033[0m {m}"); debiti.append(m)
def nota(m):     print(f"  \033[36m↓\033[0m {m}"); note.append(m)
def ok(m):       print(f"  \033[32m✓\033[0m {m}")

misure, dialoghi_per_file = {}, {}
for percorso in sorted(file_del_perimetro()):
    stringhe, dialoghi = candidati(percorso)
    r = rel(percorso)
    if stringhe:
        misure[r] = len(stringhe)
    if dialoghi:
        dialoghi_per_file[r] = len(dialoghi)

print("=== 1. stringhe italiane fuori da t(), per file ===")
tot_stringhe = sum(misure.values())
for r in sorted(set(misure) | set(TETTI)):
    n, tetto = misure.get(r, 0), TETTI.get(r)
    if tetto is None:
        if n:
            problema(f"{r}: {n} stringhe italiane fuori dal catalogo e nessun tetto dichiarato")
    elif n > tetto:
        problema(f"{r}: {n} stringhe, il tetto è {tetto} — è CRESCIUTO (--elenca {r} per vederle)")
    elif n == 0:
        problema(f"{r}: è a zero, togli la riga da TETTI")
    elif n < tetto:
        nota(f"{r}: scese a {n} su {tetto} dichiarate, abbassa il tetto")
    else:
        debito(f"{r}: {n} stringhe ancora fuori dal catalogo")
if not misure:
    ok("nessuna stringa italiana fuori dal catalogo, in nessun file")

print("=== 2. confirm/alert/prompt con testo letterale ===")
tot_dialoghi = sum(dialoghi_per_file.values())
for r in sorted(set(dialoghi_per_file) | set(DIALOGHI)):
    n, tetto = dialoghi_per_file.get(r, 0), DIALOGHI.get(r)
    if tetto is None:
        if n:
            problema(f"{r}: {n} dialoghi con testo letterale — un dialogo che non cambia lingua "
                     f"blocca l'utente con una frase che non capisce")
    elif n > tetto:
        problema(f"{r}: {n} dialoghi, il tetto è {tetto} — è CRESCIUTO")
    elif n == 0:
        problema(f"{r}: nessun dialogo letterale, togli la riga da DIALOGHI")
    elif n < tetto:
        nota(f"{r}: scesi a {n} su {tetto}, abbassa il tetto")
    else:
        debito(f"{r}: {n} dialoghi ancora con testo letterale")
if not dialoghi_per_file:
    ok("ogni dialogo passa da t()")

print()
if fail:
    print(f"\033[31m{len(fail)} problemi: {tot_stringhe} stringhe e {tot_dialoghi} dialoghi fuori dal catalogo.\033[0m")
    sys.exit(1)
if debiti or note:
    print(f"\033[33m{tot_stringhe} stringhe e {tot_dialoghi} dialoghi ancora fuori dal catalogo, "
          f"tutti dichiarati — devono scendere a zero.\033[0m")
print("\033[32ml'interfaccia dell'IDE non ha perso terreno.\033[0m")
PY
