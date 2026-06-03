Nuovo task SWS: Setpoint Input — campo numerico preciso per operatore.

### Contesto del progetto
SWS è un PoC SCADA web-based (Rust + React). Leggi in ordine:
1. docs/CONTEXT.md
2. STATUS.md
3. docs/OPEN_QUESTIONS.md

Poi comunica al maintainer cosa era in sospeso nell'ultima sessione e cosa farai in questa.

### Definizione

Il Setpoint Input è un campo di inserimento numerico preciso per l'operatore (setpoint di
processo, soglia, timer, ecc.). Diverso dallo `slider`: non ha range visuale, ammette valori
esatti digitati. Supporta validazione min/max, unità, conferma prima di scrivere al tag.

Use case tipici: impostare temperatura target di un forno, soglia pressione, tempo ciclo.

### Tipo da aggiungere a `SynopticObjectType`

```
"setpoint"
```

### Nuove props in `SynopticObject` (types/index.ts)

```typescript
// ── Setpoint Input (type === "setpoint") ──────────────────────────────────
/** Cifre decimali da mostrare e accettare. Default 2. */
setpoint_decimals?: number;
/** Se true, mostra dialog di conferma ("Confermi il valore X?") prima di scrivere. Default false. */
setpoint_confirm?: boolean;
/** Se true, il valore viene confermato solo con Enter (non al blur). Default false. */
setpoint_on_enter?: boolean;
/** Testo placeholder mostrato quando il campo è vuoto. */
setpoint_placeholder?: string;
```

Riusa props già esistenti in `SynopticObject`: `tag`, `min`, `max`, `unit`, `step`, `read_only`.

### Renderer in `sws-editor/src/components/SvgCanvas.tsx`

Usa `<foreignObject>` con un `<input type="number">` HTML stilizzato:

```
case "setpoint":
  In edit mode: <foreignObject> con <input type="number" disabled> che mostra il valore
  In view mode (runtime):
    1. Mostra valore corrente del tag come input editabile
    2. onChange: aggiorna stato locale (non scrive ancora al tag)
    3. Se setpoint_on_enter: scrive su Enter, altrimenti su blur
    4. Se setpoint_confirm: window.confirm("Confermi il valore X?") prima di PUT /api/tags/:tag
    5. Valida: clamp a [min, max] se definiti
    6. PUT /api/tags/:tag con nuovo valore
    7. read_only: input disabled
```

Stile suggerito per il `<input>`:
```css
width: 100%; height: 100%;
font-size: inherit; text-align: center;
background: #1e293b; color: #f1f5f9;
border: 1px solid #475569; border-radius: 4px;
padding: 0 8px;
```

Mostra unità come testo SVG a destra dell'input (fuori dal foreignObject) se `unit` è definito.

### Pannello proprietà in `EditorShell.tsx`

Aggiungere sezione quando `obj.type === "setpoint"`:
- TagInput "Tag"
- Input numerici: Min | Max | Step | Decimali
- Input testo: Unità
- Checkbox: "Richiedi conferma"
- Checkbox: "Conferma solo su Enter"
- Input testo: Placeholder
- Checkbox: "Solo lettura"

### Palette (`handleAddObject`)

```typescript
case "setpoint":
  return {
    id: uid(), type: "setpoint",
    x: 100, y: 100, width: 140, height: 40,
    setpoint_decimals: 1,
    setpoint_confirm: false,
  };
```

### File da modificare

- `sws-editor/src/types/index.ts` — nuove props
- `sws-editor/src/components/SvgCanvas.tsx` — `case "setpoint":` con `<foreignObject>`
- `sws-editor/src/editor/EditorShell.tsx` — palette + pannello proprietà
- Nessuna modifica backend

### Note implementative

- `<foreignObject>` ha storicamente bug su Safari/WebKit: testare su Chromium/Firefox prima,
  poi verificare su WebKit se disponibile.
- Il `<foreignObject>` deve avere le stesse coordinate x/y/width/height dell'oggetto.
- In edit mode (canvas editor), l'input deve essere non-interattivo (pointer-events: none)
  per non interferire con drag/drop del canvas.
- Alternativa più robusta (se foreignObject dà problemi): rect cliccabile che apre un
  `window.prompt()` o un modale React — più semplice ma meno integrato nel canvas.

### Workflow git

```bash
git checkout main && git pull
git checkout -b feat/T-28-setpoint-input
# sviluppo + pnpm build verde
# verifica manuale (vedi sotto)
```

### Subtask

1. [ ] Nuove props in `types/index.ts`
2. [ ] Renderer `case "setpoint":` con `<foreignObject>` in `SvgCanvas.tsx`
3. [ ] Palette + valori default
4. [ ] Pannello proprietà in `EditorShell.tsx`
5. [ ] `pnpm build` verde

### Verifica end-to-end

```bash
./scripts/dev.sh
# Apri progetto → Variabili → tag "caldaia.setpoint" (float)
# Canvas → palette → Setpoint → width=140, height=40
# Pannello: tag=caldaia.setpoint, min=0, max=120, step=0.5, unit=°C, decimali=1
# Viewer 8443:
# 1. Valore corrente mostrato nel campo
# 2. Modifica a 75.5 → Enter → tag aggiornato a 75.5
# 3. Verifica che PUT /api/tags/caldaia.setpoint sia chiamato
# 4. Abilita "Richiedi conferma" → modifica → compare dialog → OK → scrive
```
