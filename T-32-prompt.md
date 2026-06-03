Nuovo task SWS: Sparkline — mini-trend compatto senza assi per embedding in dashboard.

### Contesto del progetto
SWS è un PoC SCADA web-based (Rust + React). Leggi in ordine:
1. docs/CONTEXT.md
2. STATUS.md
3. docs/OPEN_QUESTIONS.md

Poi comunica al maintainer cosa era in sospeso nell'ultima sessione e cosa farai in questa.

### Definizione

Trend compatto senza assi, etichette o controlli. Mostra solo la forma della serie temporale
degli ultimi N secondi — una linea nella sua forma pura. Progettato per essere embedded in
celle grid (tipo Bloomberg terminal), status panel, tabelle di riepilogo.
Dimensione tipica: 80×24 px (ma liberamente ridimensionabile).

Si differenzia da `trend` (già esistente) perché:
- Nessun asse X/Y
- Nessun label, nessun tooltip, nessun pulsante espandi
- Nessuna modalità storica (solo finestra mobile live)
- Molto più leggero, adatto per centinaia di istanze su schermo

### Tipo da aggiungere a `SynopticObjectType`

```
"sparkline"
```

### Nuove props in `SynopticObject` (types/index.ts)

```typescript
// ── Sparkline (type === "sparkline") ──────────────────────────────────────
/** Secondi di storico da mostrare. Default 60. */
spark_window_s?: number;
/** Colore linea (CSS color). Default "#3b82f6". */
spark_color?: string;
/** Riempi area sotto la linea. Default false. */
spark_fill?: boolean;
/** Opacità del fill 0..1. Default 0.2. */
spark_fill_opacity?: number;
/** Mostra ultimo valore come testo a destra. Default false. */
spark_show_last?: boolean;
/** Spessore linea px. Default 1.5. */
spark_stroke_width?: number;
```

Riusa props già esistenti: `tag`, `y_min`, `y_max`, `format`.

### Renderer in `sws-editor/src/components/SvgCanvas.tsx`

**Approccio consigliato: `<canvas>` in `<foreignObject>`** — riusa la logica di `TrendCanvas`
(già esistente) che usa Canvas 2D.

```
case "sparkline":
  In edit mode: <rect> con label "[Sparkline]" e linea sinusoidale stilizzata (statica)
  In view mode:
    <foreignObject x=obj.x y=obj.y width=obj.width height=obj.height>
      <SparklineCanvas
        tag={obj.tag}
        windowS={obj.spark_window_s ?? 60}
        color={obj.spark_color ?? "#3b82f6"}
        fill={obj.spark_fill}
        fillOpacity={obj.spark_fill_opacity ?? 0.2}
        showLast={obj.spark_show_last}
        strokeWidth={obj.spark_stroke_width ?? 1.5}
        yMin={obj.y_min}
        yMax={obj.y_max}
      />
    </foreignObject>
```

Creare `SparklineCanvas.tsx` come componente separato, derivato da `TrendCanvas.tsx`:
- Rimuovere: assi, label, bottone espandi, modalità storica, multi-serie
- Mantenere: Canvas 2D, storico in-memory (ring buffer locale), resize observer
- Aggiungere: fill area (Path2D), testo last value in overlay se `showLast`

Il componente si sottoscrive a `tagStore[tag]` e mantiene un buffer locale dei campioni
nell'ultimo `windowS` secondi (stessa logica già in TrendCanvas).

### Pannello proprietà in `EditorShell.tsx`

Aggiungere sezione quando `obj.type === "sparkline"`:
- TagInput "Tag"
- Input numerico: Finestra (secondi)
- Color picker: Colore linea
- Checkbox: Riempi area
- Slider/Input: Opacità fill (0..1)
- Checkbox: Mostra ultimo valore
- Input numerico: Spessore linea
- Input numerici: Y min | Y max (auto se vuoti)
- Input testo: Formato valore (per show_last)

### Palette (`handleAddObject`)

```typescript
case "sparkline":
  return {
    id: uid(), type: "sparkline",
    x: 100, y: 100, width: 120, height: 32,
    spark_window_s: 60,
    spark_color: "#3b82f6",
    spark_fill: false,
    spark_show_last: false,
    spark_stroke_width: 1.5,
  };
```

### File da modificare

- `sws-editor/src/types/index.ts` — nuove props + union type
- `sws-editor/src/components/SvgCanvas.tsx` — `case "sparkline":` con `<foreignObject>`
- `sws-editor/src/components/SparklineCanvas.tsx` — **nuovo file** derivato da TrendCanvas
- `sws-editor/src/editor/EditorShell.tsx` — palette + pannello proprietà
- Nessuna modifica backend

### Riferimento: TrendCanvas.tsx

Leggi `sws-editor/src/components/TrendCanvas.tsx` prima di iniziare — `SparklineCanvas`
ne è una versione semplificata. Cerca in particolare:
- Come mantiene il ring buffer locale dei campioni
- Come usa `ResizeObserver` per adattarsi al canvas
- Come disegna la linea su Canvas 2D

### Workflow git

```bash
git checkout main && git pull
git checkout -b feat/T-32-sparkline
```

### Subtask

1. [ ] Nuove props in `types/index.ts`
2. [ ] `SparklineCanvas.tsx` — componente derivato da TrendCanvas
3. [ ] Renderer `case "sparkline":` in `SvgCanvas.tsx`
4. [ ] Palette + valori default
5. [ ] Pannello proprietà in `EditorShell.tsx`
6. [ ] `pnpm build` verde

### Verifica end-to-end

```bash
./scripts/dev.sh
# Tag float con history attiva (es. caldaia.temp)
# Canvas → palette → Sparkline → size 120×32 px
# Viewer 8443: linea che si aggiorna in tempo reale
# Verifica con fill=true: area colorata sotto la linea
# Verifica con show_last=true: valore numerico a destra
# Verifica embedding in cella grid: griglia 3×2 con sparkline in ogni cella
```
