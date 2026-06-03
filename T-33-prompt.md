Nuovo task SWS: Pie / Donut Chart — grafico a torta proporzionale multi-tag.

### Contesto del progetto
SWS è un PoC SCADA web-based (Rust + React). Leggi in ordine:
1. docs/CONTEXT.md
2. STATUS.md
3. docs/OPEN_QUESTIONS.md

Poi comunica al maintainer cosa era in sospeso nell'ultima sessione e cosa farai in questa.

### Definizione

Grafico a torta o ciambella per mostrare valori proporzionali di più tag in tempo reale.
Ogni slice corrisponde a un tag; gli angoli vengono calcolati dal rapporto valore/totale.
Utile per: distribuzione consumi energetici per zona, ripartizione produzione per linea,
composizione di un batch, quota di utilizzo risorse.

### Tipo da aggiungere a `SynopticObjectType`

```
"pie_chart"
```

### Nuove interfacce in `sws-editor/src/types/index.ts`

```typescript
export interface PieSlice {
  tag: string;
  label: string;
  color: string;
}
```

### Nuove props in `SynopticObject` (types/index.ts)

```typescript
// ── Pie / Donut Chart (type === "pie_chart") ──────────────────────────────
pie_slices?: PieSlice[];
/** "pie" = cerchio pieno | "donut" = anello. Default "pie". */
pie_mode?: "pie" | "donut";
/** Raggio interno come frazione del raggio esterno (0.3..0.8). Solo per donut. Default 0.5. */
pie_inner_ratio?: number;
/** Mostra etichetta percentuale su ogni slice > 5%. Default true. */
pie_show_labels?: boolean;
/** Testo statico al centro del donut. Ignorato se pie_center_tag è definito. */
pie_center_text?: string;
/** Tag il cui valore è mostrato al centro del donut (sovrascrive pie_center_text). */
pie_center_tag?: string;
/** Format string per il valore centrale (es. "%.1f kW"). */
pie_center_format?: string;
/** Mostra legenda sotto il grafico. Default false. */
pie_show_legend?: boolean;
```

### Renderer in `sws-editor/src/components/SvgCanvas.tsx`

SVG puro con `<path>` d'arco per ogni slice:

```
case "pie_chart":
  cx = obj.x + obj.width/2
  cy = obj.y + obj.height/2
  r = Math.min(obj.width, obj.height) / 2 - 4   (padding 4px)
  ri = pie_mode === "donut" ? r * (pie_inner_ratio ?? 0.5) : 0
  
  Raccogli valori:
    values = pie_slices.map(s => Math.max(0, tagStore[s.tag]?.value ?? 0))
    total = sum(values)   se total === 0: mostra cerchio grigio pieno
  
  Calcola angoli (inizio da -90° = top):
    startAngle = -Math.PI / 2
    Per ogni slice i:
      sweepAngle = (values[i] / total) * 2 * Math.PI
      endAngle = startAngle + sweepAngle
      
      pathD = describePieSlice(cx, cy, r, ri, startAngle, endAngle)
      <path d=pathD fill=slice.color />
      
      Se pie_show_labels e sweepAngle > 0.1 rad (>≈5.7%):
        midAngle = startAngle + sweepAngle/2
        lx = cx + (r * 0.7) * cos(midAngle)
        ly = cy + (r * 0.7) * sin(midAngle)
        <text x=lx y=ly textAnchor="middle" fontSize=10>
          {Math.round(values[i]/total*100)}%
        </text>
      
      startAngle = endAngle
  
  Se pie_mode === "donut":
    Cerchio bianco/trasparente al centro (ri):
    Se pie_center_tag: mostra valore tag
    Else se pie_center_text: mostra testo statico
    Font size auto: min(ri * 0.5, 24)
  
  Se pie_show_legend:
    Legenda sotto: colonna di <rect> + <text> per ogni slice

Funzione helper describePieSlice(cx, cy, r, ri, start, end) → SVG path d:
  // Per slice a torta piena (ri=0): triangolo + arco
  // Per slice donut: due archi (esterno + interno) + segmenti
  // Usa largeArcFlag = sweepAngle > π ? 1 : 0
```

### Pannello proprietà in `EditorShell.tsx`

Aggiungere sezione quando `obj.type === "pie_chart"`:
- Select "Modalità": Torta / Ciambella (donut)
- Slider "Raggio interno" (0.3..0.8, solo se donut)
- Checkbox: Mostra etichette % | Mostra legenda
- Tabella slice: Tag | Etichetta | Colore | ✕
  - TagInput, input testo, color picker, rimuovi
  - Pulsante "+ Aggiungi slice"
- (se donut) Input testo: Testo centro | TagInput: Tag centro | Input: Formato

### Palette (`handleAddObject`)

```typescript
case "pie_chart":
  return {
    id: uid(), type: "pie_chart",
    x: 100, y: 100, width: 180, height: 180,
    pie_mode: "pie",
    pie_show_labels: true,
    pie_show_legend: false,
    pie_slices: [
      { tag: "", label: "Zona A", color: "#3b82f6" },
      { tag: "", label: "Zona B", color: "#22c55e" },
      { tag: "", label: "Zona C", color: "#f59e0b" },
    ],
  };
```

### YAML di esempio

```yaml
- id: consumo_zone
  type: pie_chart
  x: 60
  y: 60
  width: 200
  height: 200
  pie_mode: donut
  pie_inner_ratio: 0.55
  pie_show_labels: true
  pie_center_tag: totale.potenza
  pie_center_format: "%.0f W"
  pie_slices:
    - tag: zona_a.potenza
      label: "Zona A"
      color: "#3b82f6"
    - tag: zona_b.potenza
      label: "Zona B"
      color: "#22c55e"
    - tag: zona_c.potenza
      label: "Zona C"
      color: "#f59e0b"
```

### File da modificare

- `sws-editor/src/types/index.ts` — `PieSlice` interface + props + union type
- `sws-editor/src/components/SvgCanvas.tsx` — `case "pie_chart":` + helper `describePieSlice`
- `sws-editor/src/editor/EditorShell.tsx` — palette + pannello proprietà
- Nessuna modifica backend

### Nota matematica per describePieSlice

```typescript
function describeArc(cx: number, cy: number, r: number, start: number, end: number): string {
  const x1 = cx + r * Math.cos(start);
  const y1 = cy + r * Math.sin(start);
  const x2 = cx + r * Math.cos(end);
  const y2 = cy + r * Math.sin(end);
  const largeArc = end - start > Math.PI ? 1 : 0;
  return `M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2}`;
}

// Per slice donut:
function describePieSlice(cx, cy, r, ri, start, end): string {
  const outerArc = describeArc(cx, cy, r, start, end);
  const innerStart = `L ${cx + ri * Math.cos(end)} ${cy + ri * Math.sin(end)}`;
  const innerArc = describeArc(cx, cy, ri, end, start).replace('M', '');
  const largeArc = end - start > Math.PI ? 1 : 0;
  // ricostruisci come path chiuso
  return `${outerArc} ${innerStart} A ${ri} ${ri} 0 ${largeArc} 0 ${cx + ri * Math.cos(start)} ${cy + ri * Math.sin(start)} Z`;
}
```

### Workflow git

```bash
git checkout main && git pull
git checkout -b feat/T-33-pie-donut-chart
```

### Subtask

1. [ ] `PieSlice` + props in `types/index.ts`
2. [ ] Helper `describePieSlice` + renderer `case "pie_chart":` in `SvgCanvas.tsx`
3. [ ] Palette + valori default
4. [ ] Pannello proprietà in `EditorShell.tsx`
5. [ ] `pnpm build` verde

### Verifica end-to-end

```bash
./scripts/dev.sh
# 3 tag float (zona_a.potenza, zona_b.potenza, zona_c.potenza)
# Canvas → palette → Grafico torta → size 200×200, modalità donut
# Scrivi valori via API:
TOKEN=...
curl ... -d '{"value":300}'  # zona_a
curl ... -d '{"value":150}'  # zona_b
curl ... -d '{"value":450}'  # zona_c
# Viewer 8443:
# 1. 3 slice proporzionali (300/150/450 = 33%/17%/50%)
# 2. Etichette % visibili nelle slice grandi
# 3. Testo "900 W" al centro del donut
# 4. Cambio valore → ridisegno immediato
```
