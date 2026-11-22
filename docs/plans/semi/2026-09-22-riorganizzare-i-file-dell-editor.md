# Riorganizzare i file dell'editor — seme

> **Idea del maintainer, 22-09-2026**, nata dal fatto che negli ultimi giorni ho segnalato più
> volte che un file è enorme prima di toccarlo: «potrebbe essere utile una sessione di refactoring
> del codice per riorganizzare i file `.tsx` in una organizzazione più pulita».
>
> **Quando questo lavoro comincerà, il primo passo è una sessione di plan approfondita, in plan
> mode e senza scrivere codice, per sviscerarne ogni dettaglio.** Questo file è materiale, non un
> piano d'esecuzione.
>
> **24-09-2026**: la parte su `ConfigView.tsx` è entrata nel piano
> [configurazione ad albero](../../archive/2026-09-24-configurazione-ad-albero-piano.md), passo 1 — decisa insieme all'albero,
> come chiedeva questo seme. Il resto (`EditorShell`, `SvgCanvas`, lo store, i colori nelle righe di elenco) resta qui.

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

### La prova del 23-09-2026: due segnalazioni, una causa sola

Il maintainer, provando l'editor: «i campi min/max/step dello slider sono coperti dalle frecce»; «il
selettore del colore dell'alarm viewer non mostra l'esadecimale come il gauge». E la diagnosi, che è
il cuore di questo seme: «i componenti del pannello dovrebbero essere oggetti riutilizzabili identici
in ogni punto siano richiesti, per esempio il selettore colore deve essere definito una volta e usato
ovunque serva sempre uguale».

Misurato quel giorno, in `EditorShell.tsx`:

| | |
|---|---:|
| `<input type="color">` scritti a mano | **19** |
| di questi, su un campo diretto dell'oggetto (dovevano usare `colorInput`) | 5 |
| dentro righe di elenco (serie, fette, zone, celle, voci, parametri) | 14 |
| dichiarazioni di `numInput` | 2 |
| dichiarazioni di `textInput` | 2 |

I cinque sono stati convertiti subito e `check_colori.sh` ha un controllo nuovo che impedisce di
riaprirli. **I quattordici restano**, ed è il lavoro di questo seme: stanno in righe strette dove un
campo di testo accanto non entra, quindi non basta sostituire il componente — serve decidere come si
disegna una riga di elenco con dentro un colore. Il tetto dichiarato nella guardia li tiene contati.

La morale per la sessione di plan: **non è un problema di dimensione dei file, è di dove vivono i
componenti**. Finché un controllo è una espressione JSX dentro una funzione dentro un componente da
5 700 righe, il secondo posto che ne ha bisogno lo riscrive invece di importarlo — e nasce diverso.

## Cosa la sessione di plan dovrà decidere

- **Il criterio di divisione**: per scheda (una cartella `config/schede/` con un file per scheda),
  per dominio (tag, sorgenti, allarmi…), o per livello (contenitori / campi / logica pura).
- **Cosa resta condiviso e dove**: `S` (gli stili), `SaveBar`, `Section`, i campi (`CampoColore`,
  `CampoFormato`, `TagInput`, `BindableInput`) e gli helper del pannello proprietà, oggi
  dichiarati dentro i componenti che li usano. `CampoColore` è la prova che funziona: da quando
  esiste come file suo, i campi che ci passano si comportano tutti uguale — il problema è che in
  quattordici punti non ci passa nessuno.
- **Come si disegna un colore dentro una riga di elenco**: è il caso che ha resistito alla
  conversione del 23-09-2026. Serve una variante compatta di `CampoColore` (solo swatch, con
  l'esadecimale in un popover o in un tooltip?) oppure righe di elenco più alte.
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
- Si incrocia con il seme [«La configurazione diventa un albero laterale»](../../archive/2026-09-22-configurazione-ad-albero.md),
  che riorganizza la stessa superficie dal lato dell'interfaccia: **vanno decisi insieme**, o il
  secondo rifà quello che il primo ha appena spostato.

## Il lato Rust: dividere `sws-web` (aggiunto il 22-11-2026)

> Decisione del maintainer del 22-11-2026, mentre si portava in piano il seme della build veloce
> ([le rc più veloci e il portale di sviluppo](../2026-11-22-dev-rc-release-e-portale-di-sviluppo.md)): dividere `sws-web`
> «mettilo nel seme di riorganizzazione del codice». Vale anche qui la regola del seme: **prima una sessione di plan
> approfondita**.

**Perché conta.** Il profilo di release (`sws-runtime/Cargo.toml`, `[profile.release]`: `lto = "thin"`,
`codegen-units = 1`) ottimizza ogni crate come un blocco unico, su un core solo: si fa apposta, il binario viene più
veloce e più piccolo, e sul PX30 e sul Tiny TY conta. Ma quasi tutto il codice sta in un crate solo, e i crate sono in
catena (`sws-core` → `sws-web` → `sws-runtime`): cargo non li può compilare insieme. Il 05-11-2026 si è misurato dal
vivo `sws_web` su un core per circa 6 minuti e mezzo, poi `sws_runtime` col link per circa 9, con la macchina quasi
ferma (carico 1,5-1,8 su 8 core). Ogni immagine (arm64, amd64, Tiny TY armv7) costa così ~16-17 minuti di solo
runtime Rust, anche quando cambia un file solo.

**Misurato il 22-11-2026** (righe di `.rs`):

| crate | righe |
|---|---:|
| `sws-web` | 108 804 |
| `sws-core` | 20 598 |
| `sws-runtime` | 2 871 |

Dentro `sws-web`, le parti più grosse:

| parte | righe |
|---|---:|
| `ai/` | 21 901 |
| `router.rs` | 16 192 |
| `validate.rs` | 5 267 |
| `control_panel/` | 5 320 |
| `remote.rs` | 4 777 |
| `projects.rs` | 4 752 |
| `gateway/` | 3 340 |
| `tunnel/` | 3 259 |
| `packaging.rs` | 2 559 |
| `git_deploy.rs` | 2 352 |
| `synoptic_schema.rs` | 2 290 |
| `report/` | 1 623 |

`sws-web` dipende da `sws-core`, `sws-historian`, `sws-pyscript`, `sws-auth`, `sws-audit` e dai sette plugin delle
sorgenti.

**L'idea**: staccare le parti che stanno in piedi da sole in crate propri, compilati in parallelo e ricompilati solo
quando cambiano. Candidati a vista: `ai/` (la parte più grossa, e la più toccata nelle ultime settimane), `gateway/` e
`tunnel/` (servono solo al gateway del cloud), `report/`, `validate.rs` con `synoptic_schema.rs`. `router.rs` (16 192
righe, un file solo) è il nodo: le rotte di ogni parte dovrebbero passare nel crate della parte.

**Da decidere nella sessione di plan**: quali crate e in che ordine; quanto si guadagna davvero (misurare prima con
`cargo build --timings` dove va il tempo); se `codegen-units = 1` resta (il guadagno di velocità del binario contro il
tempo di build, da misurare sul PX30); come si incastra col seme [codice in inglese](2026-11-13-codice-in-inglese.md),
che rinomina gli stessi file (meglio un concetto alla volta: o prima la divisione o prima i nomi, non insieme).
