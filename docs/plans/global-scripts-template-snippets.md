# Piano: Aggiungere template snippet alla GlobalScriptsTab

## Context

La GlobalScriptsTab (tab "Script" in ConfigView) non ha mai avuto il dropdown
"Inserisci template…" che invece esiste nel FunctionEditor (sezione FUNZIONI del
pannello sinistro dell'editor canvas). Il FunctionEditor ha 6 snippet Python
preimpostati che semplificano la scrittura di funzioni. La GlobalScriptsTab ha
`editorRef` già dichiarato ma non usato per l'insert.

Il gap è stato confermato esaminando l'intera git history: i template non sono
stati rimossi, non sono mai stati aggiunti alla GlobalScriptsTab.

## File da modificare

`sws-editor/src/config/ConfigView.tsx` — unico file toccato.

## Implementazione

### 1. Aggiungere la costante `GLOBAL_SCRIPT_SNIPPETS` (vicino alla funzione `newScript`)

Snippet adattati per i global script (usano `log()` invece di `print()`,
coprono i 4 trigger type: startup, interval, cron, tag_change):

```ts
const GLOBAL_SCRIPT_SNIPPETS = {
  read_write:
`# Leggi un tag e scrivilo condizionalmente.
v = tags.read("sensor.temp") or 0
if v > 80:
    tags.write("alarm.overheat", True)
    log(f"Allarme: temperatura {v}°C")
`,
  toggle:
`# Toggle periodico di un tag booleano.
current = tags.read("pump.running") or False
tags.write("pump.running", not current)
`,
  accumulator:
`# Accumulatore: incrementa un contatore a ogni tick.
v = tags.read("counter") or 0
tags.write("counter", v + 1)
`,
  watchdog:
`# Watchdog: scrivi un timestamp heartbeat ogni intervallo.
import time
tags.write("watchdog.ts", int(time.time()))
`,
  reset_many:
`# Reset multi-tag (utile su trigger startup o cron).
for t in ("counter", "errors", "downtime_min"):
    tags.write(t, 0)
log("Reset completato.")
`,
  tag_change_reaction:
`# Reagisce al cambio di un tag (usa trigger = tag_change).
# Il valore aggiornato è già nel tag al momento dell'esecuzione.
v = tags.read("motor.run") or False
tags.write("motor.status_led", v)
log(f"motor.run cambiato → {v}")
`,
} as const;
```

### 2. Aggiungere `insertSnippet` dentro `GlobalScriptsTab`

Subito dopo la dichiarazione di `editorRef` (riga ~5254):

```ts
const insertSnippet = (key: keyof typeof GLOBAL_SCRIPT_SNIPPETS) => {
  editorRef.current?.insertAtCursor(GLOBAL_SCRIPT_SNIPPETS[key]);
};
```

### 3. Aggiungere il `<select>` nell'area header dell'editor a destra

Nella sezione "Right: editor" di GlobalScriptsTab, prima del code editor
(dopo il blocco trigger, riga ~5426), aggiungere una riga con il select:

```tsx
{/* Template snippets */}
<div style={{ display: "flex", alignItems: "center", gap: 8 }}>
  <select
    style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 4,
      color: "#e2e8f0", padding: "4px 8px", fontSize: 12, cursor: "pointer" }}
    value=""
    onChange={(e) => {
      const k = e.target.value as keyof typeof GLOBAL_SCRIPT_SNIPPETS | "";
      if (k) insertSnippet(k);
      e.target.value = "";
    }}
  >
    <option value="">Inserisci template…</option>
    <option value="read_write">Leggi e scrivi condizionale</option>
    <option value="toggle">Toggle booleano</option>
    <option value="accumulator">Accumulatore / contatore</option>
    <option value="watchdog">Watchdog heartbeat</option>
    <option value="reset_many">Reset multi-tag</option>
    <option value="tag_change_reaction">Reazione a cambio tag</option>
  </select>
</div>
```

## Posizione esatta nell'JSX di GlobalScriptsTab

Il blocco "Right: editor" parte con:
```
{cur ? (
  <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 12, ... }}>
    {/* ID + enabled */}     ← riga ~5349
    {/* Trigger type */}     ← riga ~5367
    {/* ← INSERIRE QUI il blocco template */}
    {/* Code editor */}      ← riga ~5427
```

## Verifica

1. `pnpm build` nel dir `sws-editor/` deve essere verde.
2. Aprire ConfigView → tab "Script" → creare/selezionare uno script.
3. Verificare che il select "Inserisci template…" appaia sopra l'editor.
4. Selezionare ogni template e verificare che il testo venga inserito nel cursore.
5. Verificare che il select non sia presente quando `cur === null` (nessuno script selezionato).

## Note

- Il `<select>` usa `value=""` + reset `e.target.value = ""` (pattern da FunctionEditor.tsx).
- `GLOBAL_SCRIPT_SNIPPETS` va dichiarato fuori dal componente (costante modulo).
- Nessuna modifica backend richiesta.
- Complessità stimata: ~45 minuti incluso test manuale.
