#!/usr/bin/env python3
"""
Genera `sws-runtime/crates/sws-web/src/synoptic_schema.rs`.

PERCHÉ ESISTE

Un assistente che scrive YAML per il progetto deve sapere quali campi esistono.
Se glielo diciamo a mano, l'elenco diverge dal codice e il modello scrive campi
plausibili che serde scarta in silenzio — che è esattamente come sono nati i
difetti trovati il 2026-08-31 (`objects:` invece di `child:` in una cella di
griglia, `points:` su una `line`). La lezione di `check_lvgl_types.sh` e
`check_lvgl_symbols.sh` è la stessa, e non c'è motivo di impararla una terza
volta: l'elenco si genera dalla fonte autorevole.

DA DOVE VIENE OGNI PEZZO

  campi degli oggetti     sws-web/src/synoptic.rs        (il mirror autorevole)
  tipi di oggetto         sws-editor/src/types/index.ts  (la union TS)
  enum dei campi          sws-editor/src/types/index.ts  (le union inline)
  sorgenti e tag          sws-core/src/project.rs
  uso reale per tipo      examples/templates/**/*.yaml

L'ultimo pezzo merita una parola. «Quali campi valgono per un `button`» non è
scritto da nessuna parte: il mirror è piatto, 238 campi per tutti i tipi. Ma
«quali campi ha un button nei progetti che funzionano» si misura, e si
mantiene da sé. È meno di una specifica e più di un indovinello.

Uso:
    ./scripts/gen_synoptic_schema.py            scrive il file
    ./scripts/gen_synoptic_schema.py --stdout   lo stampa (per il confronto)
"""

import json
import os
import re
import sys
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

SYNOPTIC_RS = f"{ROOT}/sws-runtime/crates/sws-web/src/synoptic.rs"
PROJECT_RS = f"{ROOT}/sws-runtime/crates/sws-core/src/project.rs"
TYPES_TS = f"{ROOT}/sws-editor/src/types/index.ts"
SYMBOLS_TSX = f"{ROOT}/sws-editor/src/symbols/library.tsx"
TEMPLATES = f"{ROOT}/examples/templates"
OUT = f"{ROOT}/sws-runtime/crates/sws-web/src/synoptic_schema.rs"


def die(msg):
    print(f"  \033[31m✗\033[0m {msg}", file=sys.stderr)
    print("      La forma della dichiarazione è cambiata: questo generatore non sta più",
          file=sys.stderr)
    print("      guardando quello che crede, e va aggiornato — non è che i campi siano spariti.",
          file=sys.stderr)
    sys.exit(1)


def lit(s):
    """Letterale di stringa Rust. L'escaping JSON è compatibile con Rust per
    tutto ciò che compare qui (virgolette, backslash, a capo); ensure_ascii=False
    tiene gli accenti come sono, e Rust li accetta."""
    return json.dumps(s, ensure_ascii=False)


# ── Campi di una struct Rust ──────────────────────────────────────────────────

def rust_type(t):
    """Riduce il tipo Rust a qualcosa che un modello capisca senza spiegazioni."""
    t = t.strip().rstrip(",")
    inner = t
    m = re.match(r"Option<(.*)>$", t)
    if m:
        inner = m.group(1).strip()
    if inner.startswith("Vec<"):
        el = rust_type(inner[4:-1])
        return f"{el}[]"
    if inner in ("String", "TagId"):
        return "string"
    if inner in ("bool",):
        return "bool"
    if re.match(r"^(f32|f64|u8|u16|u32|u64|i8|i16|i32|i64|usize)$", inner):
        return "number"
    if inner.startswith("HashMap") or inner.startswith("std::collections::HashMap"):
        return "object"
    if inner.startswith("BTreeMap") or inner.startswith("std::collections::BTreeMap"):
        return "object"
    if inner in ("Value", "serde_json::Value"):
        return "any"
    return inner  # un tipo nostro: lo lasciamo com'è, dice più di "any"


def struct_body(text, name):
    m = re.search(r"pub struct %s \{(.*?)\n\}" % re.escape(name), text, re.S)
    if not m:
        die(f"struct {name} non trovata")
    return m.group(1)


ATTR = re.compile(r"#\[[^\]]*\]\s*")


def parse_fields(body):
    """[(nome, tipo, obbligatorio, doc, gruppo)] nell'ordine di dichiarazione.

    `doc` sono i `///` che precedono il campo; `gruppo` è l'ultimo commento `//`
    di sezione visto sopra (in synoptic.rs sono intestazioni tipo `// Thresholds`,
    e dicono al modello a cosa serve un blocco di campi).

    Tre cose che sembrano dettagli e non lo sono:

      * in synoptic.rs l'attributo serde sta **sulla stessa riga** del campo,
        non sopra — vanno tolti in testa, non saltati per riga;
      * `#[serde(rename = "type")] pub obj_type` in YAML si chiama `type`. Il
        nome Rust non è quello che il modello deve scrivere;
      * `#[serde(default)]` rende opzionale anche un campo non-Option
        (`TagDef::description` è una `String` che si può omettere)."""
    out = []
    doc, group, pending = [], "", ""
    for raw in body.split("\n"):
        line = raw.strip()
        if line.startswith("///"):
            doc.append(line[3:].strip())
            continue
        if line.startswith("//"):
            txt = line.lstrip("/").strip().strip("─-— ")
            # Le righe di soli trattini separano, non intitolano.
            if txt:
                group = txt
            continue
        if line == "":
            doc, pending = [], ""
            continue
        # Attributi in testa alla riga (o su righe proprie, che si accumulano).
        attrs = pending
        while True:
            m = ATTR.match(line)
            if not m:
                break
            attrs += m.group(0)
            line = line[m.end():]
        if not line:
            pending = attrs      # attributo su riga propria: vale per il prossimo campo
            continue
        pending = ""
        m = re.match(r"pub ([a-z_0-9]+)\s*:\s*(.+?),?$", line)
        if m:
            name, ty = m.group(1), m.group(2)
            ren = re.search(r'rename\s*=\s*"([^"]+)"', attrs)
            if ren:
                name = ren.group(1)
            has_default = re.search(r"\bdefault\b", attrs) is not None
            required = not ty.strip().startswith("Option<") and not has_default
            out.append((name, rust_type(ty), required, " ".join(doc), group))
            doc = []
    return out


def fields_of(path, struct):
    return parse_fields(struct_body(open(path, encoding="utf-8").read(), struct))


# ── Tipi di oggetto ed enum dalla union TypeScript ────────────────────────────

def object_types():
    ts = open(TYPES_TS, encoding="utf-8").read()
    m = re.search(r"export type SynopticObjectType =(.*?);", ts, re.S)
    if not m:
        die("union SynopticObjectType non trovata in types/index.ts")
    types = re.findall(r'"([a-z_0-9]+)"', m.group(1))
    if len(types) < 20:
        die(f"trovati solo {len(types)} tipi di oggetto: la union si legge male")
    return types


def field_enums():
    """I campi di SynopticObject dichiarati in TS come union di stringhe.
    Sono i valori che un modello DEVE indovinare giusti: `button_mode: toggle`
    contro `button_mode: switch` è la differenza fra un bottone e niente."""
    ts = open(TYPES_TS, encoding="utf-8").read()
    body = re.search(r"export interface SynopticObject \{(.*?)\n\}", ts, re.S)
    if not body:
        die("interface SynopticObject non trovata in types/index.ts")
    out = {}
    for line in body.group(1).split("\n"):
        m = re.match(r'\s*([a-z_0-9]+)\??:\s*((?:"[^"]*"\s*\|\s*)+"[^"]*")\s*;', line)
        if m:
            out[m.group(1)] = re.findall(r'"([^"]*)"', m.group(2))

    # `symbol_id` non è una union in TypeScript — i simboli stanno in una
    # libreria, non nei tipi — quindi qui arrivava come stringa libera **senza
    # documentazione**. L'assistente non aveva modo di sapere quali simboli
    # esistono: il 2026-09-06 il maintainer gli ha chiesto una caldaia e si è
    # sentito rispondere che l'oggetto non esiste, mentre `boiler` è in palette
    # da sempre.
    #
    # La libreria dell'editor è la fonte di ciò che la palette offre davvero, ed
    # è la stessa che usa `check_lvgl_symbols.sh`. Diventa la quinta fonte di
    # questo generatore, e `check_synoptic_schema.sh` la tiene allineata come le
    # altre quattro.
    simboli = re.findall(r'id:\s*"([a-z_0-9]+)"',
                         open(SYMBOLS_TSX, encoding="utf-8").read())
    if len(simboli) < 10:
        die(f"letti solo {len(simboli)} simboli da {SYMBOLS_TSX}: la forma delle voci è cambiata")
    out["symbol_id"] = sorted(set(simboli))
    return out


# ── Sorgenti ──────────────────────────────────────────────────────────────────

def source_kinds():
    """kind serde → nome della struct di configurazione."""
    rs = open(PROJECT_RS, encoding="utf-8").read()
    m = re.search(r"pub enum SourceDef \{(.*?)\n\}", rs, re.S)
    if not m:
        die("enum SourceDef non trovato in project.rs")
    # `[A-Za-z0-9]+` e non `[A-Za-z]+`: la variante `S7` ha una cifra nel nome,
    # e con la versione senza cifre spariva in silenzio — sette sorgenti su otto.
    pairs = re.findall(r'#\[serde\(rename = "([a-z_0-9]+)"\)\]\s*\n\s*[A-Za-z0-9]+\((\w+)\)',
                       m.group(1))
    declared = len(re.findall(r'#\[serde\(rename = "[a-z_0-9]+"\)\]', m.group(1)))
    if len(pairs) != declared:
        die(f"{declared} varianti dichiarate in SourceDef ma solo {len(pairs)} lette")
    return pairs


# ── Uso reale nei template ────────────────────────────────────────────────────

def template_usage():
    """Per ogni tipo di oggetto: i campi visti nei progetti veri, e un esempio.

    L'esempio scelto è quello con **più campi valorizzati**: un `button` spoglio
    non insegna niente, uno completo mostra dove vanno label, tag e write_value."""
    try:
        import yaml
    except ImportError:
        die("manca PyYAML (python3-yaml): serve per leggere i template")
    usage, best = defaultdict(set), {}
    for proj in sorted(os.listdir(TEMPLATES)):
        sdir = f"{TEMPLATES}/{proj}/synoptics"
        if not os.path.isdir(sdir):
            continue
        for fn in sorted(os.listdir(sdir)):
            if not fn.endswith(".yaml"):
                continue
            try:
                page = yaml.safe_load(open(f"{sdir}/{fn}", encoding="utf-8"))
            except Exception as e:
                die(f"{proj}/synoptics/{fn} non si legge: {e}")
            for obj in (page or {}).get("objects") or []:
                if not isinstance(obj, dict):
                    continue
                t = obj.get("type")
                if not t:
                    continue
                usage[t] |= set(obj.keys())
                # id/x/y li ha chiunque: non contano per decidere chi insegna di più.
                score = len(set(obj.keys()) - {"id", "type", "x", "y", "width", "height"})
                if t not in best or score > best[t][0]:
                    best[t] = (score, obj)
    examples = {}
    for t, (_, obj) in best.items():
        examples[t] = yaml.safe_dump(obj, allow_unicode=True, sort_keys=False,
                                     default_flow_style=False).rstrip()
    return usage, examples


def source_examples():
    """Uno snippet reale per ogni `kind` di sorgente.

    Il punteggio NON è la lunghezza. Scegliendo la sorgente più lunga, per mqtt
    vinceva l'esempio Sparkplug: `topics: []` e un blocco `sparkplug:` che
    insegna esattamente il contrario di quel che serve. Vince invece la sorgente
    il cui **mapping tag↔device** usa più campi distinti — che per mqtt pesca i
    rulli Shelly di `casa-locale`, l'unico esempio in casa di una sorgente MQTT
    che *scrive* (`publish_topic`) e non solo legge.

    Per la stessa ragione le liste lunghe non si tagliano alle prime due voci ma
    alle due che insieme coprono più campi: la voce che porta `publish_topic`
    poteva essere la settima."""
    import yaml
    MAPPING_KEYS = ("topics", "registers", "nodes", "entities", "tags", "metrics")
    # I campi che rendono un mapping BIDIREZIONALE. Valgono tre volte gli altri:
    # che una sorgente si legga il modello lo dà per scontato, che si possa
    # anche scrivere no — ed è esattamente la differenza fra una luce che si
    # guarda e una che si accende. Senza questo peso, per mqtt vinceva la
    # sorgente zigbee (sola lettura) sui rulli Shelly, a parità di tutto il resto.
    SCRITTURA = {"publish_topic", "write_domain", "write_service", "writable"}
    best = {}
    for proj in sorted(os.listdir(TEMPLATES)):
        pf = f"{TEMPLATES}/{proj}/project.yaml"
        if not os.path.isfile(pf):
            continue
        try:
            doc = yaml.safe_load(open(pf, encoding="utf-8"))
        except Exception as e:
            die(f"{proj}/project.yaml non si legge: {e}")
        for src_def in (doc or {}).get("sources") or []:
            if not isinstance(src_def, dict):
                continue
            k = src_def.get("kind")
            if not k:
                continue
            trimmed = dict(src_def)
            coperti = set()
            for key in MAPPING_KEYS:
                voci = trimmed.get(key)
                if not isinstance(voci, list) or not voci:
                    continue
                scelte = pick_covering(voci, 3)
                for v in scelte:
                    if isinstance(v, dict):
                        coperti |= set(v.keys())
                trimmed[key] = scelte
            peso = sum(3 if c in SCRITTURA else 1 for c in coperti)
            score = (peso, len(trimmed))
            if k not in best or score > best[k][0]:
                best[k] = (score, trimmed)
    return {k: yaml.safe_dump(v, allow_unicode=True, sort_keys=False,
                              default_flow_style=False).rstrip()
            for k, (_, v) in best.items()}


def pick_covering(voci, quante):
    """Le `quante` voci che insieme coprono più chiavi distinte, nell'ordine
    originale. Greedy: a ogni giro prende quella che aggiunge di più."""
    if len(voci) <= quante:
        return voci
    scelti, coperte = [], set()
    for _ in range(quante):
        migliore, guadagno = None, -1
        for i, v in enumerate(voci):
            if i in scelti or not isinstance(v, dict):
                continue
            g = len(set(v.keys()) - coperte)
            if g > guadagno:
                migliore, guadagno = i, g
        if migliore is None:
            break
        scelti.append(migliore)
        coperte |= set(voci[migliore].keys())
    return [voci[i] for i in sorted(scelti)]


# ── Emissione ─────────────────────────────────────────────────────────────────

def emit_fields(const_name, fields, doc):
    out = [f"/// {doc}", f"pub const {const_name}: &[Field] = &["]
    for name, ty, required, fdoc, group in fields:
        out.append(
            f"    Field {{ name: {lit(name)}, ty: {lit(ty)}, required: {str(required).lower()}, "
            f"group: {lit(group)}, doc: {lit(fdoc)} }},")
    out.append("];")
    return "\n".join(out)


def main():
    obj_fields = fields_of(SYNOPTIC_RS, "SynopticObject")
    page_fields = fields_of(SYNOPTIC_RS, "SynopticPage")
    tag_fields = fields_of(PROJECT_RS, "TagDef")
    types = object_types()
    enums = field_enums()
    kinds = source_kinds()
    usage, examples = template_usage()
    src_examples = source_examples()

    if len(obj_fields) < 200:
        die(f"solo {len(obj_fields)} campi in SynopticObject: la struct si legge male")

    p = []
    p.append("// @generated da scripts/gen_synoptic_schema.py — NON modificare a mano.")
    p.append("// Rigenera con `./scripts/gen_synoptic_schema.py`; la guardia")
    p.append("// `scripts/check_synoptic_schema.sh` fallisce se questo file è vecchio.")
    p.append("//")
    p.append("// Serve all'assistente IA dell'editor: senza un vocabolario chiuso il")
    p.append("// modello inventa nomi di campo plausibili, serde li scarta in silenzio,")
    p.append("// e il difetto si vede solo sul pannello.")
    p.append("")
    p.append("/// Un campo di una struttura del progetto, con la sua documentazione.")
    p.append("#[derive(Debug, Clone, Copy, serde::Serialize)]")
    p.append("pub struct Field {")
    p.append("    pub name: &'static str,")
    p.append("    /// Tipo ridotto: string | number | bool | any | object | <tipo>[] | <struct>")
    p.append("    pub ty: &'static str,")
    p.append("    pub required: bool,")
    p.append("    /// Intestazione di sezione sotto cui il campo è dichiarato (può essere vuota).")
    p.append("    pub group: &'static str,")
    p.append("    /// Il commento di documentazione del campo, così com'è nel sorgente.")
    p.append("    pub doc: &'static str,")
    p.append("}")
    p.append("")
    p.append(emit_fields("OBJECT_FIELDS", obj_fields,
                         "I campi di un oggetto sinottico (da sws-web/src/synoptic.rs)."))
    p.append("")
    p.append(emit_fields("PAGE_FIELDS", page_fields,
                         "I campi di una pagina sinottica."))
    p.append("")
    p.append(emit_fields("TAG_FIELDS", tag_fields,
                         "I campi di una definizione di tag (da sws-core/src/project.rs)."))
    p.append("")

    p.append("/// Tutti i tipi di oggetto che l'editor sa creare (dalla union TS).")
    p.append("pub const OBJECT_TYPES: &[&str] = &[")
    for t in types:
        p.append(f"    {lit(t)},")
    p.append("];")
    p.append("")

    p.append("/// Campi il cui valore è scelto da un insieme chiuso: `(campo, valori)`.")
    p.append("pub const FIELD_ENUMS: &[(&str, &[&str])] = &[")
    for k in sorted(enums):
        vals = ", ".join(lit(v) for v in enums[k])
        p.append(f"    ({lit(k)}, &[{vals}]),")
    p.append("];")
    p.append("")

    p.append("/// I `kind` di sorgente e i campi di ciascuna configurazione.")
    p.append("pub const SOURCE_KINDS: &[&str] = &[")
    for kind, _ in kinds:
        p.append(f"    {lit(kind)},")
    p.append("];")
    p.append("")
    p.append("pub const SOURCE_FIELDS: &[(&str, &[Field])] = &[")
    for kind, struct in kinds:
        p.append(f"    ({lit(kind)}, {const_of(kind)}),")
    p.append("];")
    p.append("")
    for kind, struct in kinds:
        flds = fields_of(PROJECT_RS, struct)
        p.append(emit_fields(const_of(kind).lstrip("&"), flds,
                             f"Campi della sorgente `{kind}` ({struct})."))
        p.append("")
        # Le sotto-struct che contano davvero per scrivere una sorgente: i mapping.
        for sub in mapping_struct(struct):
            p.append(emit_fields(f"SOURCE_{kind.upper()}_{sub.upper()}_FIELDS",
                                 fields_of(PROJECT_RS, sub),
                                 f"Campi di `{sub}`, usato dentro la sorgente `{kind}`."))
            p.append("")

    p.append("/// Campi effettivamente usati per tipo, misurati sui template.")
    p.append("pub const TYPE_USAGE: &[(&str, &[&str])] = &[")
    for t in sorted(usage):
        vals = ", ".join(lit(f) for f in sorted(usage[t]))
        p.append(f"    ({lit(t)}, &[{vals}]),")
    p.append("];")
    p.append("")

    p.append("/// Un esempio YAML reale per tipo, preso dal template che lo usa meglio.")
    p.append("pub const TYPE_EXAMPLES: &[(&str, &str)] = &[")
    for t in sorted(examples):
        p.append(f"    ({lit(t)}, {lit(examples[t])}),")
    p.append("];")
    p.append("")

    p.append("/// Un esempio YAML reale per `kind` di sorgente.")
    p.append("pub const SOURCE_EXAMPLES: &[(&str, &str)] = &[")
    for k in sorted(src_examples):
        p.append(f"    ({lit(k)}, {lit(src_examples[k])}),")
    p.append("];")
    p.append("")

    text = "\n".join(p) + "\n"
    if "--stdout" in sys.argv:
        sys.stdout.write(text)
    else:
        open(OUT, "w", encoding="utf-8").write(text)
        print(f"scritto {os.path.relpath(OUT, ROOT)}: "
              f"{len(obj_fields)} campi oggetto, {len(types)} tipi, "
              f"{len(enums)} enum, {len(kinds)} sorgenti, "
              f"{len(examples)} esempi di oggetto, {len(src_examples)} di sorgente")


def const_of(kind):
    return f"SOURCE_{kind.upper()}_FIELDS"


# Quali sotto-struct valgono la pena per ogni sorgente: quelle che descrivono
# il legame tag↔device, cioè la parte che un assistente deve saper scrivere.
MAPPINGS = {
    "MqttConfig":       ["TopicMapping"],
    "ModbusTcpConfig":  ["RegisterMapping"],
    "ModbusRtuConfig":  ["RegisterMapping"],
    "OpcUaClientConfig": ["OpcUaNodeMapping"],
    "OpcUaServerConfig": ["OpcUaServerNodeMapping"],
    "HomeAssistantConfig": ["EntityMapping"],
    "S7Config":         ["S7TagMapping"],
    "EnIpConfig":       ["EnIpTagMapping"],
}


def mapping_struct(struct):
    return MAPPINGS.get(struct, [])


if __name__ == "__main__":
    main()
