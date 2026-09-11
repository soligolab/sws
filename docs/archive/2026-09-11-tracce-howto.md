# L'HOWTO diventa un elenco di tracce, e la conversione del target è la prima

Ramo `feat/tracce-howto`, da `main`.

## Contesto

`docs/HOWTO.md` è cresciuto a 14 capitoli, uno per ogni «come faccio a…» posto al vivo. Riletto
tutto insieme, metà dei capitoli non è documentazione: è il **sintomo di una funzione che manca**.
Chi lo legge trova la ricetta e la esegue; nessuno risale mai alla domanda «perché devo farlo a
mano?».

Richiesta del maintainer (11-09-2026): trasformare quelle informazioni in **tracce per piani
futuri**, e in particolare guardare la conversione di un progetto da web a LVGL.

Le tracce vanno in `STATUS.md` come voci `T-xx`, l'abitudine già in uso — decisione del maintainer.

### La cosa che ho scoperto e che cambia il piano

**`SUPPORTED_TYPES` contiene già tutti e 35 i tipi** (`lvgl_render.rs:68-104`; il commento in
`LeftPanel.tsx:616` lo dice: «dal 2026-08-27 il motore copre tutti e 35»). Un referto di
compatibilità costruito sul *tipo di oggetto* direbbe quindi **sempre «zero problemi»**: sarebbe
un referto che mente per omissione.

Le incompatibilità vere sono a livello di **campo e valore**, e sono già tutte scritte nel codice:

| Cosa il pannello non fa | Dove è dichiarato |
|---|---|
| `bar_orientation: "horizontal"` | `lvgl_render.rs:2659` (`bail!`) |
| `pie_mode` ≠ `"donut"` | `lvgl_render.rs:4114` |
| `alarm_viewer_mode` ≠ `"list"` | `lvgl_render.rs:3610` |
| `routing` ≠ `"straight"` sulle pipe | `lvgl_render.rs:5307` |
| `symbol_id: "custom:*"` e 13 simboli della serie valvole | `lvgl_render.rs:6591`, `synoptic.rs:379-383` |
| `image` con `src` .png/.jpg | `lvgl_render.rs:7100` |
| `button_action` (Naviga a URL / Login / Logout) | `model.rs:508`, **mai usato** in `lvgl_render.rs` — sparisce in silenzio |
| `min_role`, stili delle tracce trend, `pie_show_legend` | «gap dichiarato» in `model.rs` |

E soprattutto: **il referto esiste già**. `RenderSummary` (`lvgl_render.rs:106-113`) raccoglie
`skipped_unsupported` — compresi i `bail!` qui sopra — e il viewer lo **stampa** a ogni pagina
(`sws-lvgl-viewer/src/main.rs:311-330`). Oggi finisce nello stderr di un processo che gira sul
pannello, e nessuno lo legge.

## Passo 0

Questo piano va in `docs/plans/2026-09-11-tracce-howto.md` e si committa. In `~/.claude/plans/`
non resta niente (regola dell'11-09-2026).

## Passo 1 — dieci tracce in `STATUS.md`

Sezione nuova dentro «▶ Da fare nella prossima sessione», in forma di tabella compatta: una riga
per traccia con **verdetto**, **cosa costa oggi** e **dove sta il codice**. Non una riga di
cronaca: una traccia che chi riprende può leggere e trasformare in piano.

| # | Traccia | Da quale capitolo | Perché |
|---|---|---|---|
| T-58 | Il target del progetto si cambia dall'IDE | §14 | 3 passi a mano su `project.yaml`, con la trappola del salvataggio che rimette il valore di prima |
| T-59 | Referto di compatibilità LVGL, chiesto al motore | §14, §4 | oggi l'alternativa è «apri ogni pagina e guardala sul pannello» |
| T-60 | Una fonte di verità sola su cosa il pannello disegna | §14 | oggi sono quattro copie tenute insieme da quattro guardie |
| T-61 | L'archivio di release dice da quale ramo viene | §10 | due `mv` rituali a ogni prova; un archivio sbagliato è già finito su un dispositivo (2026-07-31) |
| T-62 | «Mostrami questa pagina come la disegna il pannello», nell'IDE | §6 | `istantanea.rs` lo fa già per l'assistente, non per la persona |
| T-63 | Una guardia di parità di rendering riusabile | §8 | 30-60 minuti riscritti da capo a ogni sospetto WYSIWYG |
| T-64 | Dopo «dimentica la chiave», il software prova se entra | §9 | il passo 3 del capitolo è una sonda che esiste già (`sonda-dispositivo.sh`) e nessuno lancia |
| T-65 | `session_start.sh` dice lo stato della CI e lo spazio su disco | §11, §2 | la CI è stata rossa **per mesi** senza che nessuno lo leggesse; il disco pieno si presenta come «Bus error» del linker |
| T-66 | Un lock negli script di build | §5 | «non modificare uno script mentre gira» è oggi affidato alla disciplina; è già costato una build di 51 minuti |
| T-67 | Riscrivere HOWTO §1 | §1 | descrive un `podman run` di 15 flag che oggi è la quadlet `sws-lvgl-viewer.container` |

Tre capitoli non generano tracce e va detto perché, altrimenti qualcuno ci ritorna: §3, §7, §12 e
§13 sono **procedure legittime o già superate** — toccano hardware, credenziali o scelte umane.

**Il collegamento va nei due sensi**: ogni capitolo dell'HOWTO che ha prodotto una traccia prende
in coda una riga «*Traccia: T-xx*». Senza, fra sei mesi si rilegge la ricetta e si riesegue il
rituale senza sapere che è già registrato come lavoro da fare. E l'indice dell'HOWTO va aggiornato:
il §14 è stato aggiunto in fondo senza metterlo in cima (`HOWTO.md:13-27`).

## Passo 2 — T-58 scritto a misura di piano, così si può partire subito

È la traccia piccola che sblocca le altre due, e ha un gemello già scritto da copiare.

- **`PUT /api/project/target`** in `sws-web/src/router.rs`, accanto a
  `/api/project/page-layout` (L310): stesso genere di campo — una scelta di progetto, non di
  pagina — stessa forma di handler.
- Passando dalla rotta **sparisce la trappola** del capitolo: il progetto in memoria si aggiorna e
  `display_target::publish` (`display_target.rs:71`, già chiamata da `router.rs:5282`) riscrive
  `display-target` da sé. A mano invece il primo salvataggio rimetteva il valore di prima.
- **Selettore in Configurazione → Progetto.** Oggi `target.kind` è letto in **un solo punto**
  dell'editor (`LeftPanel.tsx:668`) e `ConfigView` non lo mostra affatto: per sapere di che tipo è
  il progetto aperto bisogna guardare la palette o il file.
- **Il verso rischioso è uno solo.** LVGL → web non perde niente (il browser disegna di più).
  web → LVGL sì: lì va chiesto il referto di T-59 **prima** di confermare, e la conversione resta
  possibile comunque — il referto informa, non vieta.

## Passo 3 — T-59, la forma decisa dal maintainer

**Il referto lo chiede al motore vero**, non a una lista di limiti scritta a parte.

`istantanea.rs` sa già fare tutto il lavoro pesante: copia il progetto, lo sterilizza
(`istantanea.rs:347` — sorgenti, script e notifiche spente), avvia un runtime usa e getta e il
viewer, e `note_utili()` (`istantanea.rs:429-440`) filtra lo stderr tenendo solo le righe che
«dicono qualcosa a chi guarda». Manca **una costante**: aggiungere `non supportati/ignorati` e
`fuori pagina` a `INTERESSANTI`, e iterare sulle pagine.

Il referto è così il motore che parla di sé: non può mentire e non invecchia quando il motore
cambia. Costo: un giro di viewer per pagina, ~0,3 s (misurato nel §6).

**La forma da copiare per la finestra** è «Verifica collegamenti» (`LeftPanel.tsx:408-470`,
`LinkReportModal`): conteggio nel titolo, una riga per rilievo, e il pulsante **«Vai»** che salta
alla pagina *e seleziona l'oggetto* (`onJumpTo`, righe 241-247). La logica pura sta fuori dalla UI
(`pageLayout.ts:374-414`), ed è lì che va la sua gemella.

## Verifica

Passo 1 e 2 sono documentazione: `./scripts/check_documenti.sh` e `./scripts/check_static.sh`.
Più due letture a occhio che nessuna guardia fa:

1. Ogni traccia dice **cosa manca**, non cosa si fa a mano. Una traccia che descrive il rituale
   invece della funzione è una riga di HOWTO spostata, non una traccia.
2. Ogni capitolo che ha prodotto una traccia la nomina, e ogni traccia nomina il capitolo. Il
   collegamento a senso unico è quello che si perde.

Se si implementa anche T-58: `cargo test --workspace`, `cargo clippy -- -D warnings`, `pnpm test`,
`pnpm build`, e la prova a mano — convertire un progetto LVGL in web dall'IDE, riaprirlo, e
verificare che `display-target` sul dispositivo cambi di conseguenza al deploy successivo.

## Rischi dichiarati

- **Dieci tracce sono un debito dichiarato, non pagato.** Registrarle non le fa. Il valore è che
  smettano di essere invisibili dentro una ricetta; il rischio è che la sezione «Da fare» di STATUS
  diventi un cimitero. Vanno ordinate per valore, e quelle che non si faranno mai è meglio non
  scriverle affatto.
- **T-59 ha bisogno di un runtime locale** per girare: nell'IDE su una macchina senza runtime il
  pulsante non può funzionare, e deve dirlo invece di fallire in silenzio.
- **T-60 è la traccia che rende inutili le altre due se fatta male**: se il referto di T-59
  diventasse una lista di limiti scritta a mano sarebbe la **quinta** copia della verità sul motore,
  e il giorno che il motore cambia il referto mente. È la ragione per cui il referto lo chiede al
  motore.

---

## Fuori piano — due difetti di T-53 segnalati dal maintainer mentre provava

Annotati qui perché non vadano persi; **si correggono per primi**, prima di toccare l'HOWTO.

1. **Il tracciato sparisce durante la cattura ＋.** Volontà: «vorrei vedere la linea e i crocini
   anche mentre li traccio». Il piano diceva «l'overlay diventa `pointerEvents: "none"`»; ho scritto
   `!captureTarget` nella condizione, cioè **non si disegna affatto**. Si toglie dalla condizione
   (`SvgCanvas.tsx:1861`) e si mette lo stile inerte sul `<g>`, esattamente come fa il layer degli
   oggetti a `SvgCanvas.tsx:1647`.

2. **Rilasciando un crocino si perde la selezione.** Causa probabile, trovata leggendo: al rilascio
   il `mouseup` cade sullo sfondo, quindi il `click` risale all'`<svg>` e `onClick`
   (`SvgCanvas.tsx:1591`) chiama `onSelect(null)` — l'oggetto si deseleziona, l'overlay sparisce e
   il pannello passa alle proprietà di pagina. `suppressClick` (L1385) oggi si alza **solo** per la
   selezione a rettangolo. Rimedio: alzarlo in `endDrag` quando un trascinamento c'era davvero.
   Da verificare che valga anche per i waypoint delle pipe e per le maniglie di ridimensionamento —
   se sì è un difetto più vecchio di T-53, e la correzione li copre tutti.

---

## Esito — 2026-09-11

**Passo 1 fatto**: le dieci tracce sono in `STATUS.md` come `T-58`…`T-67`, e ogni capitolo
dell'HOWTO che ne ha prodotta una la nomina in coda. L'indice, che si era dimenticato il §14, è a
posto, e il §1 è marcato scaduto.

**Passo 2 fatto**: T-58 è realizzato e confermato dal maintainer — con una correzione che il piano
sbagliava, e che è il caso di lasciare scritta: il piano diceva «selettore in **Configurazione →
Progetto**», ma **quella voce non esiste** (ConfigView ha sedici schede e nessuna è quella). Il
selettore sta nel pannello destro, sezione «IMPOSTAZIONI PROGETTO», accanto alle impostazioni di
pagina — dove vivono già le cose di livello progetto.

**Passo 3 non fatto**: T-59, il referto di compatibilità, resta da fare. La decisione presa qui —
**chiederlo al motore vero** invece di scrivere una lista di limiti — vale ancora, ed è la parte
di questo piano che serve a chi lo riprenderà.

I due difetti di T-53 annotati in coda («fuori piano») sono stati corretti lo stesso giorno.
