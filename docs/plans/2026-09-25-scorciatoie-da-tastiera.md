# Un pannello di configurazione per le scorciatoie da tastiera — seme

> **Idea del maintainer, 25-09-2026**: «pannello di configurazione per l'uso di shortcut da
> tastiera». Vedere e cambiare le scorciatoie dell'IDE da una scheda di configurazione.
>
> **Quando si comincerà questo lavoro, il primo passo è una sessione di plan approfondita, in plan
> mode e senza scrivere codice, per sviscerarne ogni dettaglio.** Questo file è materiale, non un
> piano d'esecuzione: fra la domanda e il lavoro passa troppo tempo, e un disegno scritto prima è un
> disegno che mente.

## Misurato oggi (25-09-2026, `main` a `83524cd1`)

- **Le scorciatoie sono scritte a mano, in dieci ascoltatori `keydown` sparsi** (più diciassette file
  con `onKeyDown` locali ai campi). Non c'è un registro: ogni ascoltatore confronta `e.key` con
  lettere fisse.
  - `App.tsx:~600` — Ctrl/Cmd+S (Salva unico), globale, anche in Configurazione.
  - `editor/EditorShell.tsx:~449-580` — il grosso: Canc/Backspace, Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z,
    Ctrl+C / X / V (con i casi di cella di griglia e sotto-cella), Ctrl+D, Ctrl+A, Ctrl+G,
    Ctrl+] / Ctrl+[, frecce (1 px o un passo di griglia), `?` per la guida.
  - `canvas/SvgCanvas.tsx` (tre ascoltatori: zoom/pan, reset, Esc per la cattura di percorso),
    `editor/LeftPanel.tsx` (menu contestuale), `editor/EditorToolbar.tsx` (Esc), e i modali
    (`CharacterPickerModal`, `TrendExpanded`, il selettore simboli).
- **Esiste già una guida in sola lettura**: `ShortcutHelp` in `EditorShell.tsx:~1020`, aperta con `?`,
  con i testi in `shortcut.*` dei cataloghi i18n (circa trenta voci in sei gruppi: navigazione canvas,
  selezione, modifica, gruppi, altro). **Ma è un secondo elenco**: le combinazioni sono scritte nella
  guida e, separatamente, negli ascoltatori — nessuno controlla che coincidano.
- **Il contesto è cambiato il 25-09**: senza pulsanti Editor/Configurazione in testata, si passa
  dall'una all'altra solo con l'albero del pannello sinistro. Non c'è nessuna scorciatoia per farlo,
  né per muoversi nell'albero.
- Le preferenze IDE oggi vivono in `localStorage` (tema, lingua, larghezza dei pannelli, rami
  aperti con `sws.pannelli.*`), e la scheda «Preferenze IDE» sta nel ramo IDE dell'albero di
  configurazione (`config/schede.ts`). È il posto naturale per una foglia «Scorciatoie».

## Cosa la sessione di plan dovrà decidere

- **Solo vedere o anche cambiare.** Una scheda che elenca le scorciatoie (sostituendo la guida `?`
  o affiancandola) costa poco; renderle modificabili chiede un **registro unico delle azioni**
  (id, gruppo, combinazione predefinita, contesto in cui vale) da cui leggano sia gli ascoltatori sia
  la scheda — è lo stesso lavoro fatto il 24-09 per le schede di configurazione (quattro elenchi →
  `config/schede.ts`), e ne vale la stessa lezione: una lista in più resta indietro.
- **Dove si salvano**: per IDE (`localStorage`, come le altre preferenze) o per utente o per progetto.
  Un progetto aperto su due PC con scorciatoie diverse è un caso da pensare.
- **Contesti e conflitti**: la stessa combinazione vale in modo diverso nel canvas, in un campo di
  testo, in una cella di griglia, in un modale. Il pannello deve dire quando due azioni si pestano, e
  quali combinazioni il browser non restituisce (Ctrl+W, Ctrl+T, Ctrl+N).
- **Scorciatoie nuove** che l'albero unico rende utili: passare fra editor e Configurazione, cercare
  una voce dell'albero, aprire la pagina successiva/precedente.
- **Mac**: oggi `ctrl` vale `ctrlKey || metaKey` in alcuni ascoltatori e non in altri — da misurare.
- Se il **viewer** (operatori) debba avere scorciatoie proprie: oggi non ne ha, ed è un perimetro
  diverso (pannello touch, kiosk).
