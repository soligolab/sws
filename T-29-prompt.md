Nuovo task SWS: Bar Chart multi-tag — grafico a barre per confronto valori istantanei.

### Contesto del progetto
SWS è un PoC SCADA web-based (Rust + React). Leggi in ordine:
1. docs/CONTEXT.md
2. STATUS.md
3. docs/OPEN_QUESTIONS.md

Poi comunica al maintainer cosa era in sospeso nell'ultima sessione e cosa farai in questa.

### Definizione

Grafico a barre (verticale o orizzontale) per confrontare visivamente più tag in tempo reale.
Ogni barra corrisponde a un tag. Snapshot del valore istantaneo (non storico come `trend`).
Utile per: confrontare potenze di linee, consumi per zona, livelli serbatoio multipli.

### Tipo da aggiungere a `SynopticObjectType`

```
"bar_chart"
```

### Nuove interfacce in `sws-editor/src/types/index.ts`

```typescript
export interface BarChartSeries {
  tag: string;
  label: string;
  color: string;
  /** Override min/max per questa serie (usa chart min/max se omessi). */
  min?: number;
  max?: number;
}
```

### Nuove props in `SynopticObject` (types/index.ts)

```typescript
// ── Bar Chart (type === "bar_chart") ──────────────────────────────────────
bar_series?: BarChartSeries[];
/** "vertical" = barre dall'alto verso il basso | "horizontal" = sinistra a destra. Default "vertical". */
bar_orientation?: "vertical" | "horizontal";
/** Mostra etichetta valore su/sopra ogni barra. Default true. */
bar_show_values?: boolean;
/** Mostra etichette serie (nomi tag). Default true. */
bar_show_labels?: boolean;
/** Mostra linee orizzontali per soglie warn/alarm. Default true. */
bar_show_thresholds?: boolean;
/** Gap tra barre come frazione 0..1. Default 0.2. */
bar_gap?: number;
/** Etichetta asse Y. */
bar_y_label?: string;
```

Riusa props già esistenti: `min`, `max`, `unit`, `warn_low`, `warn_high`, `alarm_low`, `alarm_high`.

### Renderer in `sws-editor/src/components/SvgCanvas.tsx`

SVG puro (no canvas 2D). Layout:

```
case "bar_chart":
  Calcola area plot: padding 24px top, 32px bottom (labels), 8px left/right
  total = bar_series.length
  barWidth = (plotWidth / total) * (1 - bar_gap)
  
  Per ogni serie i:
    value = tagStore[series[i].tag]?.value ?? 0
    seriesMin = series[i].min ?? obj.min ?? 0
    seriesMax = series[i].max ?? obj.max ?? 100
    heightPx = plotHeight * clamp((value - seriesMin) / (seriesMax - seriesMin), 0, 1)
    
    Disegna:
    - <rect> barra: x=offset, y=plotBottom-heightPx, width=barWidth, height=heightPx, fill=series.color
    - Se bar_show_values: <text> sopra la barra con valore formattato + unit
    - Se bar_show_labels: <text> sotto l'asse con series.label
  
  Se bar_show_thresholds e warn_high definito:
    <line> orizzontale gialla a y corrispondente a warn_high
  Se alarm_high definito:
    <line> orizzontale rossa a y corrispondente a alarm_high
  
  Orientamento orizzontale: ruota logica (plotWidth ↔ plotHeight, misura da sinistra)
```

### Pannello proprietà in `EditorShell.tsx`

Aggiungere sezione quando `obj.type === "bar_chart"`:
- Select "Orientamento": Verticale / Orizzontale
- Input numerici: Min globale | Max globale | Unità
- Checkbox: Mostra valori | Mostra etichette | Mostra soglie
- Input: Gap tra barre (0.0..0.9)
- Tabella serie: colonne Tag | Etichetta | Colore | ✕
  - TagInput per tag, input testo per label, color picker, pulsante rimuovi
  - Pulsante "+ Aggiungi serie"
- Input numerici opzionali per warn_low/warn_high/alarm_low/alarm_high

### Palette (`handleAddObject`)

```typescript
case "bar_chart":
  return {
    id: uid(), type: "bar_chart",
    x: 80, y: 80, width: 240, height: 180,
    min: 0, max: 100,
    bar_orientation: "vertical",
    bar_show_values: true,
    bar_show_labels: true,
    bar_gap: 0.2,
    bar_series: [
      { tag: "", label: "Linea 1", color: "#3b82f6" },
      { tag: "", label: "Linea 2", color: "#22c55e" },
    ],
  };
```

### File da modificare

- `sws-editor/src/types/index.ts` — `BarChartSeries` + props + union type
- `sws-editor/src/components/SvgCanvas.tsx` — `case "bar_chart":`
- `sws-editor/src/editor/EditorShell.tsx` — palette + pannello proprietà
- Nessuna modifica backend

### Workflow git

```bash
git checkout main && git pull
git checkout -b feat/T-29-bar-chart
```

### Subtask

1. [ ] `BarChartSeries` + props in `types/index.ts`
2. [ ] Renderer `case "bar_chart":` SVG puro in `SvgCanvas.tsx`
3. [ ] Palette + valori default
4. [ ] Pannello proprietà in `EditorShell.tsx`
5. [ ] `pnpm build` verde

### Verifica end-to-end

```bash
./scripts/dev.sh
# Crea 3 tag float (es. linea1.potenza, linea2.potenza, linea3.potenza)
# Canvas → palette → Grafico barre → configura 3 serie
# Scrivi valori diversi via API e verifica che le barre cambino altezza
TOKEN=...
curl -sk -X PUT https://localhost:8444/api/tags/linea1.potenza ... -d '{"value":75}'
curl -sk -X PUT https://localhost:8444/api/tags/linea2.potenza ... -d '{"value":40}'
curl -sk -X PUT https://localhost:8444/api/tags/linea3.potenza ... -d '{"value":90}'
# Verifica: 3 barre con altezze proporzionali
# Verifica: linee soglia warn/alarm visibili se configurate
```
