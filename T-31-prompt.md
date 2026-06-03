Nuovo task SWS: Text List — mappa valore tag a etichetta testuale (enum display).

### Contesto del progetto
SWS è un PoC SCADA web-based (Rust + React). Leggi in ordine:
1. docs/CONTEXT.md
2. STATUS.md
3. docs/OPEN_QUESTIONS.md

Poi comunica al maintainer cosa era in sospeso nell'ultima sessione e cosa farai in questa.

### Definizione

Mappa un valore di tag (int, string, bool) a un'etichetta testuale. Text-only, nessuna grafica
di sfondo. Più leggero del Multi-state Indicator (T-27): utile per status testuali brevi
("Aperto" / "Chiuso"), codici di stato macchina inline in celle grid, display enumerazioni.

Si differenzia da `multistate` (T-27) perché è solo testo, nessun rect colorato.
Si differenzia da `text` perché il testo è dinamico basato su lookup-table, non su format string.

**Questo è il task più semplice della serie — buon warm-up prima di quelli più complessi.**

### Tipo da aggiungere a `SynopticObjectType`

```
"text_list"
```

### Nuove interfacce in `sws-editor/src/types/index.ts`

```typescript
export interface TextListEntry {
  /** Valore del tag che attiva questa entry (confronto == non ===). */
  value: number | string | boolean;
  /** Testo da mostrare. */
  label: string;
  /** Colore testo (CSS color). Se omesso, usa obj.color. */
  color?: string;
}
```

### Nuove props in `SynopticObject` (types/index.ts)

```typescript
// ── Text List (type === "text_list") ──────────────────────────────────────
text_list_entries?: TextListEntry[];
/** Testo da mostrare se nessuna entry corrisponde. Default: valore raw del tag. */
text_list_default?: string;
/** Colore testo del fallback. Default: obj.color o "#94a3b8". */
text_list_default_color?: string;
```

Riusa props già esistenti: `tag`, `font_size`, `font_family`, `font_weight`, `font_style`,
`text_anchor`, `color`.

### Renderer in `sws-editor/src/components/SvgCanvas.tsx`

```
case "text_list":
  1. Leggi obj.tag → liveValue dal tagStore
  2. Cerca entry in text_list_entries dove entry.value == liveValue
     (confronto == per gestire "1" === 1 nei YAML deserializzati)
  3. Se trovato: label = entry.label, textFill = entry.color ?? obj.color ?? "#f1f5f9"
  4. Se non trovato: label = text_list_default ?? String(liveValue), textFill = text_list_default_color ?? "#94a3b8"
  5. Disegna: <text> centrato (text_anchor default "middle") con label e fill=textFill
     Applica font_size, font_family, font_weight, font_style come per obj type "text"
  6. Quality dot standard
```

**Nota**: è essenzialmente un `text` object il cui contenuto viene risolto via lookup-table.
Può riusare quasi tutto il codice del renderer `text`.

### Pannello proprietà in `EditorShell.tsx`

Aggiungere sezione quando `obj.type === "text_list"`:
- TagInput "Tag"
- Font size | Font family | Font weight | Allineamento (riusa sezione testo esistente)
- Tabella entry: colonne Valore | Etichetta | Colore testo | ✕
  - input (valore), input testo (etichetta), color picker opzionale, pulsante rimuovi
  - Pulsante "+ Aggiungi entry"
- Input testo: "Testo default (fallback)"
- Color picker: "Colore default"

### Palette (`handleAddObject`)

```typescript
case "text_list":
  return {
    id: uid(), type: "text_list",
    x: 100, y: 100, width: 120, height: 32,
    font_size: 16,
    text_anchor: "middle",
    text_list_entries: [
      { value: 0, label: "Chiuso",  color: "#94a3b8" },
      { value: 1, label: "Aperto",  color: "#22c55e" },
    ],
    text_list_default: "N/D",
    text_list_default_color: "#ef4444",
  };
```

### YAML di esempio

```yaml
- id: stato_valvola
  type: text_list
  x: 200
  y: 80
  width: 100
  height: 28
  tag: valvola1.stato
  font_size: 14
  text_anchor: middle
  text_list_entries:
    - value: 0
      label: "Chiusa"
      color: "#94a3b8"
    - value: 1
      label: "Aperta"
      color: "#22c55e"
    - value: 2
      label: "In movimento"
      color: "#f59e0b"
  text_list_default: "Errore"
  text_list_default_color: "#ef4444"
```

### File da modificare

- `sws-editor/src/types/index.ts` — `TextListEntry` interface + props + union type
- `sws-editor/src/components/SvgCanvas.tsx` — `case "text_list":` (semplice, ~20 righe)
- `sws-editor/src/editor/EditorShell.tsx` — palette + pannello proprietà
- Nessuna modifica backend

### Workflow git

```bash
git checkout main && git pull
git checkout -b feat/T-31-text-list
```

### Subtask

1. [ ] `TextListEntry` + props in `types/index.ts`
2. [ ] Renderer `case "text_list":` in `SvgCanvas.tsx`
3. [ ] Palette + valori default
4. [ ] Pannello proprietà in `EditorShell.tsx`
5. [ ] `pnpm build` verde

### Verifica end-to-end

```bash
./scripts/dev.sh
# Tag "valvola.stato" (int)
# Canvas → palette → Lista testi → configura 3 entry (0=Chiusa, 1=Aperta, 2=In moto)
# Viewer 8443:
TOKEN=...
curl -sk -X PUT https://localhost:8444/api/tags/valvola.stato ... -d '{"value":0}'
# → mostra "Chiusa" in grigio
curl -sk -X PUT https://localhost:8444/api/tags/valvola.stato ... -d '{"value":1}'
# → mostra "Aperta" in verde
curl -sk -X PUT https://localhost:8444/api/tags/valvola.stato ... -d '{"value":99}'
# → mostra "N/D" in rosso (fallback)
```
