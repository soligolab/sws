# Riorganizzare i file dell'editor — seme

> **Idea del maintainer, 22-09-2026**, nata dal fatto che negli ultimi giorni ho segnalato più
> volte che un file è enorme prima di toccarlo: «potrebbe essere utile una sessione di refactoring
> del codice per riorganizzare i file `.tsx` in una organizzazione più pulita».
>
> **Quando questo lavoro comincerà, il primo passo è una sessione di plan approfondita, in plan
> mode e senza scrivere codice, per sviscerarne ogni dettaglio.** Questo file è materiale, non un
> piano d'esecuzione.

## Misurato oggi (22-09-2026)

`sws-editor/src` sono **52 789 righe in 144 file**, e **cinque file ne fanno metà**:

| file | righe | cosa contiene |
|---|---:|---|
| `config/ConfigView.tsx` | 11 737 | **sedici schede** di configurazione, una dietro l'altra nello stesso file (era 11 629 quando questo seme è nato) |
| `canvas/SvgCanvas.tsx` | 6 312 | il dispatcher di disegno di 36 tipi, più `formatValue` e gli helper condivisi col runtime |
| `editor/EditorShell.tsx` | 5 695 | la chiusura dell'editor, il pannello proprietà (due varianti), la creazione degli oggetti |
| `store/index.ts` | 2 627 | tutto lo stato: progetto, pagine, cronologia, salvataggio, tag, IA, tema, remoto |
| `editor/LeftPanel.tsx` | 2 023 | albero pagine, palette, struttura, funzioni, tag, sorgenti |

Cosa costa, concretamente e già misurato in questi giorni:

- **ogni modifica al pannello proprietà** tocca un file da 5 695 righe con due helper gemelli
  (`colorInput` esisteva due volte, `textInput` esiste due volte): le correzioni vanno fatte due
  volte, e una delle due si dimentica — è già successo con i colori;
- `ConfigTab` è dichiarato **due volte** (store e ConfigView), copia letterale senza import,
  perché importarlo da un file da 11 629 righe non se lo ricorda nessuno;
- i test di inventario (`pannelloProprieta.test.tsx`) esistono proprio perché **nessuno riesce a
  leggere il file intero** e serve una rete che dica se una sezione è sparita.

## Cosa la sessione di plan dovrà decidere

- **Il criterio di divisione**: per scheda (una cartella `config/schede/` con un file per scheda),
  per dominio (tag, sorgenti, allarmi…), o per livello (contenitori / campi / logica pura).
- **Cosa resta condiviso e dove**: `S` (gli stili), `SaveBar`, `Section`, i campi (`CampoColore`,
  `CampoFormato`, `TagInput`, `BindableInput`) e gli helper del pannello proprietà, oggi
  dichiarati dentro i componenti che li usano.
- **Come si divide senza rompere le reti**: `pannelloProprieta.test.tsx` (inventario dei campi per
  tipo), `check_i18n_ui.sh` (tetti per file — **i tetti sono per percorso**, quindi ogni file che
  si sposta va ridichiarato), `check_colori.sh` e `check_tipi_scalari.sh`, che cercano per nome di
  file. Sono la ragione per cui questo lavoro va fatto a passi piccoli e verificabili.
- **Se lo store si divide in fette** (zustand slices) e a che prezzo: oggi è un `create()` solo, e
  `saveAll` legge mezzo stato.
- **L'ordine**: `ConfigView` per primo (è il più grande e il più diviso per natura, sedici schede
  indipendenti), `EditorShell` per secondo (il pannello proprietà è la parte che si tocca di più).

## Vincoli da rispettare

- **Niente cambi di comportamento nello stesso passo di uno spostamento**: un file che si muove e
  intanto cambia è un file di cui nessuno sa più se il difetto c'era prima.
- Il `git log --follow` deve continuare a seguire i file: spostare, non riscrivere.
- Si incrocia con il seme [«La configurazione diventa un albero laterale»](2026-09-22-configurazione-ad-albero.md),
  che riorganizza la stessa superficie dal lato dell'interfaccia: **vanno decisi insieme**, o il
  secondo rifà quello che il primo ha appena spostato.
