Nuovo task SWS: Inline Alarm Viewer — lista allarmi embeddable nel sinottico.

### Contesto del progetto
SWS è un PoC SCADA web-based (Rust + React). Leggi in ordine:
1. docs/CONTEXT.md
2. STATUS.md
3. docs/OPEN_QUESTIONS.md

Poi comunica al maintainer cosa era in sospeso nell'ultima sessione e cosa farai in questa.

### Definizione

Widget che mostra una lista compatta degli allarmi attivi direttamente nella pagina sinottica,
senza dover aprire il pannello allarmi separato (AlarmBanner/AlarmPanel esistente in RuntimeView).
Utile per pagine operatore di zona che devono mostrare gli allarmi locali senza uscire dalla pagina.

Modalità disponibili:
- "list": tabella compatta con righe per ogni allarme (default)
- "banner": singola riga scorrevole in ticker se ci sono più allarmi

### Tipo da aggiungere a `SynopticObjectType`

```
"alarm_viewer"
```

### Nuove props in `SynopticObject` (types/index.ts)

```typescript
// ── Alarm Viewer (type === "alarm_viewer") ────────────────────────────────
/** Numero massimo di righe allarmi. Default 5. */
alarm_viewer_max_rows?: number;
/** Filtra per severità. Default: tutte. */
alarm_viewer_severities?: AlarmSeverity[];   // AlarmSeverity già in types/index.ts
/** Filtra allarmi il cui id inizia con questo prefisso (utile per allarmi di zona). */
alarm_viewer_id_prefix?: string;
/** Mostra pulsante ACK per riga (richiede Operator+). Default true. */
alarm_viewer_show_ack?: boolean;
/** Mostra colonna timestamp. Default true. */
alarm_viewer_show_ts?: boolean;
/** Mostra "Nessun allarme attivo" quando la lista è vuota. Default true. */
alarm_viewer_show_empty?: boolean;
/** "list" = tabella | "banner" = ticker scorrevole. Default "list". */
alarm_viewer_mode?: "list" | "banner";
/** Colore sfondo quando non ci sono allarmi (default trasparente). */
alarm_viewer_bg_color?: string;
```

### Renderer in `sws-editor/src/components/SvgCanvas.tsx`

Usa `<foreignObject>` con un `<div>` React:

```
case "alarm_viewer":
  In edit mode: <foreignObject> con placeholder "[Alarm Viewer]" stilizzato
  In view mode (runtime):
    1. Prendi allarmi attivi da alarmStore (già disponibile via WebSocket /ws/alarms)
    2. Filtra per: severità (alarm_viewer_severities), prefisso id (alarm_viewer_id_prefix)
    3. Prendi al massimo alarm_viewer_max_rows righe, ordinati per ts attivazione DESC
    
    Modalità "list":
      <div overflow="hidden" height="100%">
        <div> scrollabile con righe allarme:
          Per ogni allarme:
            colore sfondo per severità (Critical=#ef4444, Warning=#f59e0b, Info=#3b82f6) @30% opacity
            - [ts HH:MM] [●] [messaggio allarme] [ACK] (se alarm_viewer_show_ack)
        Se lista vuota e alarm_viewer_show_empty:
          "Nessun allarme attivo" centrato in grigio
    
    Modalità "banner":
      Unica riga con animazione CSS marquee (scroll left) se > 1 allarme
      Colore sfondo del primo allarme attivo più grave
```

### ACK nell'inline viewer

Il pulsante ACK chiama `POST /api/alarms/:id/ack` (già esistente nel router).
Richiede ruolo Operator+: se l'utente è anonimo o Viewer, nascondere il pulsante
(usa `authStore.role` già disponibile).

### Pannello proprietà in `EditorShell.tsx`

Aggiungere sezione quando `obj.type === "alarm_viewer"`:
- Select "Modalità": Lista / Banner
- Input numerico: Max righe
- Input testo: Prefisso ID allarme
- MultiSelect "Severità": Critico | Avviso | Info (default tutte)
- Checkbox: Mostra ACK | Mostra timestamp | Mostra "nessun allarme"
- Color picker: Sfondo (vuoto)

### Palette (`handleAddObject`)

```typescript
case "alarm_viewer":
  return {
    id: uid(), type: "alarm_viewer",
    x: 80, y: 80, width: 360, height: 160,
    alarm_viewer_max_rows: 5,
    alarm_viewer_mode: "list",
    alarm_viewer_show_ack: true,
    alarm_viewer_show_ts: true,
    alarm_viewer_show_empty: true,
  };
```

### File da modificare

- `sws-editor/src/types/index.ts` — nuove props + union type
- `sws-editor/src/components/SvgCanvas.tsx` — `case "alarm_viewer":` con `<foreignObject>`
- `sws-editor/src/editor/EditorShell.tsx` — palette + pannello proprietà
- Nessuna modifica backend (usa WebSocket allarmi esistente)

### Dipendenze

- `alarmStore` (Zustand): già esistente, aggiornato via WebSocket `/ws/alarms`
- `AlarmSeverity` type: già in `types/index.ts`
- `POST /api/alarms/:id/ack`: già nel router

### Workflow git

```bash
git checkout main && git pull
git checkout -b feat/T-30-alarm-viewer-widget
```

### Subtask

1. [ ] Nuove props in `types/index.ts`
2. [ ] Renderer `case "alarm_viewer":` con `<foreignObject>` in `SvgCanvas.tsx`
3. [ ] Palette + valori default
4. [ ] Pannello proprietà in `EditorShell.tsx`
5. [ ] `pnpm build` verde

### Verifica end-to-end

```bash
./scripts/dev.sh
# Crea un allarme attivo (es. tag sopra soglia)
# Canvas → palette → Allarmi inline → size 360×160
# Viewer 8443:
# 1. Allarme attivo appare nel widget
# 2. Pulsante ACK funziona (cambia stato allarme)
# 3. "Nessun allarme" quando lista è vuota
# 4. Modalità banner: testo scorrevole con allarme
# 5. Filtro prefisso: solo allarmi della zona configurata
```
