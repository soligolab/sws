Nuovo task SWS: Multi-state Indicator (MSI) — oggetto SCADA per stato discreto.

### Contesto del progetto
SWS è un PoC SCADA web-based (Rust + React). Leggi in ordine:
1. docs/CONTEXT.md
2. STATUS.md
3. docs/OPEN_QUESTIONS.md

Poi comunica al maintainer cosa era in sospeso nell'ultima sessione e cosa farai in questa.

### Definizione

Il Multi-state Indicator (MSI) è l'oggetto SCADA più comune per rappresentare lo **stato
discreto di una macchina** o processo. Un tag intero (o stringa) viene mappato a una
rappresentazione visiva: colore di sfondo + etichetta testuale.
Esempi tipici: `0=Spento`, `1=In marcia`, `2=Allarme`, `3=Manutenzione`.

### Tipo da aggiungere a `SynopticObjectType`

```
"multistate"
```

### Nuova interfaccia in `sws-editor/src/types/index.ts`

```typescript
export interface MultistateEntry {
  value: number | string | boolean;
  label: string;
  color: string;           // background fill
  text_color?: string;     // auto-contrast if omitted
  border_color?: string;
  opacity?: number;
  icon?: string;           // symbol_id from built-in library (opzionale)
}
```

### Nuove props in `SynopticObject` (types/index.ts)

```typescript
// ── Multi-state Indicator (type === "multistate") ─────────────────────────
multistate_states?: MultistateEntry[];
multistate_default?: MultistateEntry;
/** "fill" = rect colorato + label | "badge" = pill shape | "text" = solo testo */
multistate_style?: "fill" | "badge" | "text";
/** Mostra il valore raw del tag sotto la label. Default false. */
multistate_show_value?: boolean;
```

### Renderer in `sws-editor/src/components/SvgCanvas.tsx`

```
case "multistate":
  1. Leggi obj.tag → liveValue dal tagStore
  2. Cerca entry in multistate_states dove entry.value === liveValue (confronto ==, non ===)
  3. Se non trovato: usa multistate_default (fallback: fill grigio + valore raw)
  4. Calcola text_color: se non definito, auto-contrast (luminanza < 0.5 → white, else black)
  5. Disegna:
     - style "fill":  <rect> fill=state.color, rx=4; <text> centrato state.label
     - style "badge": <rect> fill=state.color, rx=height/2
     - style "text":  solo <text> fill=state.color (no rect)
  6. Se border_color: <rect> stroke=border_color, strokeWidth=2
  7. Se multistate_show_value: <text> y=bottom-4 fontSize=10 fill="#aaa" valore raw
  8. Quality dot standard (come gli altri tipi)
```

### Pannello proprietà in `EditorShell.tsx`

Aggiungere sezione quando `obj.type === "multistate"`:
- TagInput "Tag"
- Select "Stile": Fill / Badge / Testo
- Checkbox "Mostra valore raw"
- Tabella stati: colonne Valore | Etichetta | Colore | ✕
  - Per ogni entry in multistate_states: input valore, input testo, color picker, pulsante rimuovi
  - Pulsante "+ Aggiungi stato" che appende `{ value: 0, label: "Stato", color: "#6b7280" }`
- Sezione "Stato default": input etichetta + color picker

### Palette (`handleAddObject`)

```typescript
case "multistate":
  return {
    id: uid(), type: "multistate",
    x: 100, y: 100, width: 160, height: 48,
    multistate_style: "fill",
    multistate_states: [
      { value: 0, label: "Spento",    color: "#6b7280" },
      { value: 1, label: "In marcia", color: "#22c55e" },
      { value: 2, label: "Allarme",   color: "#ef4444" },
    ],
    multistate_default: { value: -1, label: "N/D", color: "#374151" },
  };
```

### YAML di esempio (per test manuale)

```yaml
- id: stato_motore
  type: multistate
  x: 100
  y: 50
  width: 160
  height: 48
  tag: motore.stato
  multistate_style: fill
  multistate_states:
    - value: 0
      label: "Fermo"
      color: "#6b7280"
    - value: 1
      label: "In marcia"
      color: "#22c55e"
    - value: 2
      label: "Allarme"
      color: "#ef4444"
      border_color: "#b91c1c"
    - value: 3
      label: "Manutenzione"
      color: "#f59e0b"
  multistate_default:
    value: -1
    label: "Sconosciuto"
    color: "#374151"
```

### File da modificare

- `sws-editor/src/types/index.ts` — `MultistateEntry` interface + props + union type
- `sws-editor/src/components/SvgCanvas.tsx` — `case "multistate":`
- `sws-editor/src/editor/EditorShell.tsx` — palette + pannello proprietà
- Nessuna modifica backend richiesta (props opzionali, serde ignora campi sconosciuti)

### Workflow git

```bash
git checkout main && git pull
git checkout -b feat/T-27-multistate-indicator
# sviluppo + pnpm build verde
# verifica manuale (vedi sotto)
# squash merge quando il maintainer conferma che funziona
```

### Subtask

1. [ ] `MultistateEntry` + props in `types/index.ts`
2. [ ] Renderer `case "multistate":` in `SvgCanvas.tsx`
3. [ ] Palette + valori default in `handleAddObject`
4. [ ] Pannello proprietà in `EditorShell.tsx`
5. [ ] `pnpm build` verde

### Verifica end-to-end

```bash
./scripts/dev.sh
# IDE su http://localhost:5173
# Apri progetto → Variabili → aggiungi tag "motore.stato" (int)
# Canvas → palette "SCADA" → Multi-state → configura 3 stati
# Viewer su https://localhost:8443
TOKEN=$(curl -sk -X POST https://localhost:8444/api/auth/login \
  -H 'Content-Type: application/json' -d '{"username":"admin","password":"admin"}' | jq -r .token)
# Cicla i valori 0, 1, 2, 3 e verifica che il display cambi colore+label
for V in 0 1 2 3; do
  curl -sk -X PUT https://localhost:8444/api/tags/motore.stato \
    -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
    -d "{\"value\":$V}"
  sleep 1
done
```
