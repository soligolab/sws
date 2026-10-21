# Tubazioni: bocche vere dei simboli, instradamento, stili 2.5D

## Context

Richiesta del maintainer (15-10-2026): «l'oggetto pipe deve essere esteso e avere differenti stili grafici e poter
essere usato per interconnettere i nuovi oggetti grafici». Con la libreria 2.5D (138 simboli) la tubazione di oggi
stona e non si collega davvero.

Scelte del maintainer (15-10-2026):
- **agganci**: le bocche vere dei disegni, ricavate dal generatore e scritte nel manifesto. Il tubo si aggancia con
  una calamita e segue il simbolo;
- **stili**: tutti e quattro i gruppi proposti, cioè metallo 2.5D con flange; coibentato/PVC/inox; flessibile e
  canale HVAC; cavo e linea di segnale.

Questo piano, una volta approvato, va in `docs/archive/2026-10-15-tubazioni-bocche-e-stili.md`, con una riga in
`docs/plans/README.md`.

## Misurato oggi (main `a9ed87a9`)

- **Aggancio**: `computeAnchor` (`sws-editor/src/canvas/SvgCanvas.tsx:309`) e il gemello `ancora_di`
  (`lvgl_render.rs:2285`) conoscono solo i 5 punti del riquadro (alto, basso, sinistra, destra, centro). Ignorano
  rotazione, specchiatura e il `meet` del disegno: sulla pompa la mandata non sta al centro di un lato.
- **Collegare oggi**: si scrive a mano l'id dell'oggetto in un campo (`EditorShell.tsx` ~5262, «snapObjects»). Sul
  canvas non c'è nessuna calamita; esistono solo i punti gialli trascinabili (`SvgCanvas.tsx:1548`).
- **Instradamento**: `orthogonal` e `diagonal` sono nel tipo e nel pannello, ma `buildPipeD`
  (`SvgCanvas.tsx:303`) li disegna come spezzata dritta. Nessun instradamento viene calcolato.
- **Stili**: `flat | tube | wire`. Il «3D» è un `linearGradient` verticale su tutto l'oggetto, quindi sparisce sui
  tratti verticali. Su LVGL il corpo è una `lv_line`; estremità e flusso sono disegnati da `tubo.rs` (tiny-skia).
- **Il tubo vero esiste già nel generatore**: `tubo_o`/`tubo_v` e `flangia_o`/`flangia_v`
  (`scripts/simboli/disegni.py:42-57`) sono materiale `steel` con velatura perpendicolare (`metal-v` sui tratti
  orizzontali, `metal-h` sui verticali). Ci sono **91 flange** nei disegni (processo 37, sostitutivi 34, base 16,
  macchine 4, elettrico 0): sono le bocche.
- **Pezzi riusabili**:
  - `MATERIALI`/`VELI` del generatore;
  - lo stile di progetto (`applicaStile.ts` ↔ `sws-core/src/stile_simboli.rs`: materiali, volume, contorno);
  - `in_pixel(view_box, Quadro, x, y)` (`simbolo_lib.rs:203`), che porta un punto del viewBox in pixel col `meet`
    e la specchiatura;
  - la cache per colore `CacheCorpo`;
  - `svg_forma` + resvg (polilinee su LVGL).

## Ramo A — `feat/bocche-e-instradamento` (prima) — ✅ su `main` (`86cea9a4`, 15-10-2026; collaudato sul TC620)

1. **Bocche nel manifesto**.
   - Le `flangia_v`/`flangia_o` registrano una bocca sul `Simbolo` (`genera.py`), con:
     - lato, dato dal bordo del viewBox più vicino;
     - punto sul bordo esterno della piastra;
     - diametro, dato dal tronchetto adiacente.
   - Sono bocca solo le flange **sul bordo**: quelle interne o decorative restano disegno.
   - Id stabili per lato: `n-left`, `n-top`, `n-right-2` (secondo e successivi in ordine di coordinata).
   - Si possono dichiarare a mano dove l'inferenza sbaglia.
   - `voce()` scrive `ports: [{id, x, y, side, d}]`.
   - Specchi: `manifest.ts` (`SimboloLib.ports`) e `sws-core/src/simboli_lib.rs`.
   - `genera.py regole()` e `check_libreria_simboli` verificano che ogni bocca stia sul bordo, che gli id siano
     unici e che il diametro sia maggiore di 0.
2. **Dove sta una bocca a schermo**. Una funzione pura in TS e il suo gemello in Rust, con fixture condivisa
   `tests/fixtures/bocche-simbolo.json`, come `stato-simbolo.json`.
   - Applica `meet` e centratura nel riquadro, poi specchiatura, poi rotazione attorno al centro (stesso ordine di
     `applyTransform`).
   - Restituisce anche la direzione d'uscita, ruotata con l'oggetto.
   - `from_port`/`to_port` accettano, oltre ai 5 punti del riquadro, l'id di una bocca. Un id sconosciuto ricade
     sul centro, come oggi un oggetto inesistente.
   - `computeAnchor` e `ancora_di` le usano. Gli oggetti che non sono simboli restano col riquadro, che ora rispetta
     anche la rotazione.
3. **Instradamento vero**. `orthogonal` diventa un calcolo puro, TS e Rust con fixture:
   - si esce dalla bocca lungo la sua direzione per un tratto minimo;
   - poi L o Z a 90°, attraverso i punti intermedi dell'utente se ce ne sono;
   - si entra nella bocca d'arrivo dalla sua direzione.
   - `diagonal` fa lo stesso a 45°.
   - I progetti esistenti in `straight`/`bezier` non cambiano.
4. **Calamita in editor**. Trascinando il primo o l'ultimo punto giallo:
   - vicino a un simbolo compaiono le sue bocche (pallini) e i punti del riquadro;
   - rilasciando sopra una bocca si scrivono `from_obj_id`+`from_port` (o `to_…`);
   - trascinando via si sgancia.
   - Il campo con l'id resta nel pannello (regola UI 2: un posto per dato) ma diventa un menu degli oggetti della
     pagina e delle loro bocche, non testo libero.
   - Spostando o ruotando il simbolo, il tubo segue: già oggi, perché i capi si ricalcolano a ogni disegno.
5. **Validatore**: una bocca che non esiste sul simbolo agganciato produce un avviso, con l'elenco delle bocche
   valide nel suggerimento.

## Ramo B — `feat/stili-tubo` (dopo) — ✅ su `main` (`6e3a80c6`, 15-10-2026); resta il punto 6

1. **Stili a strati in una tabella sola**: `public/tubi/stili.json`, più specchio e fixture, come i colori
   predefiniti.
   - Ogni stile è:
     - una pila di tratti, ciascuno con materiale o colore, larghezza come frazione del diametro, tratteggio,
       opacità e velatura perpendicolare sì/no;
     - giunti (flangia ai capi, flangia alle curve, fascette a passo);
     - sezione: tonda, oppure rettangolare per il canale.
   - Stili nuovi:
     - `metallo` (steel, flange);
     - `inox`;
     - `coibentato` (lamierino con fascette);
     - `pvc` (colore da `stroke`);
     - `flessibile` (corrugato: tratteggio trasversale);
     - `canale` (HVAC, rettangolare con giunti);
     - `cavo` (guaina scura con riflesso);
     - `segnale` (linea ISA tratteggiata, sottile).
   - `flat`, `tube` e `wire` restano com'erano.
2. **Disegno**: una funzione pura (TS + Rust, fixture) produce l'SVG del tubo dalla spezzata e dallo stile, un
   segmento per tratto, con velatura **perpendicolare al tratto** (`gradientUnits=userSpaceOnUse`) e i giunti
   ai capi e alle curve.
   - **Web**: SVG inline.
   - **LVGL**: resvg una volta sola e in cache per colore di stato (schema di `CacheCorpo`); riempimento e flusso
     restano i livelli vivi di oggi (`tubo.rs`).
3. **Colori**: materiali e volume vengono dallo stile del progetto (`applicaStile`/`stile_simboli.rs`), così tubi
   e simboli cambiano insieme. Il colore di stato e d'allarme tinge il corpo come sul simbolo.
4. **Diametro**: con entrambi i capi agganciati a bocche, lo spessore predefinito è quello della bocca, scalato col
   simbolo. `stroke_width` lo sovrascrive.
5. **Estremità selezionabili** (richiesta del maintainer, 15-10-2026). `start_marker`/`end_marker` accettano:
   - `auto` (predefinito per i tubi nuovi): su una bocca, l'estremità consigliata dallo stile del tubo, nella misura
     della bocca; su un capo libero o sul riquadro, nessuna;
   - `flange` (due piastre bullonate 2.5D, sul diametro della bocca);
   - `welded` (saldato, a filo);
   - `union` (bocchettone/filettato);
   - `quick` (attacco rapido);
   - `reducer` (cono di riduzione; in `auto` si mette da solo quando tubo e bocca hanno diametri diversi);
   - `gland` (pressacavo);
   - `collar` (collare HVAC);
   - restano `arrow` e `dot`.

   Ogni stile ha la sua estremità consigliata: metallo e inox → flangia, PVC → bocchettone, flessibile → attacco
   rapido, cavo → pressacavo, canale → collare. Le estremità stanno nella stessa tabella degli stili e la stessa
   funzione pura le disegna. I progetti esistenti con `arrow`/`dot`/`flange` si disegnano come prima finché lo
   stile del tubo è uno dei tre storici.
6. **Seguire gli oggetti mossi da una variabile** (se il maintainer lo conferma): sul web il percorso usa le
   posizioni risolte dai binding; su LVGL si ricalcola quando cambia la posizione di un oggetto agganciato.
7. **Editor e contenuti**:
   - scelta dello stile con anteprima, come per le icone;
   - `pipe_style` esteso in tipi, `synoptic.rs`, `model.rs`, schema, validatore e `check_lvgl_parity`;
   - il template `comandi-pompa-pozzo` collega pompa e valvola con tubi `metallo`;
   - una voce in NOVITÀ e nel manuale (capitolo tubazioni).

## Fuori da questo piano

- Instradamento che aggira gli ostacoli: qui ci sono solo L e Z fra bocche e punti dell'utente. Se servirà, nascerà
  come seme.
- Bocche sui simboli elettrici: non hanno flange, e per i cavi bastano i punti del riquadro.

## Verifica (per ogni ramo)

- `cargo check`, `cargo test` (sws-core, sws-web, sws-lvgl-viewer), `pnpm build`, vitest e `./scripts/check_static.sh`.
- Le fixture condivise TS↔Rust sono la prova di parità; nel ramo A si rigenera la libreria (`genera.py`).
- Dal vivo:
  - un runtime di prova con un progetto pompa → valvola → serbatoio, ruotati e specchiati;
  - browser senza schermo e `--istantanea` LVGL, confrontati a occhio;
  - nell'IDE, il trascinamento con la calamita (Playwright);
  - poi il collaudo sul TC620 con l'immagine arm64 caricata a mano, come per il ramo dei comandi.
- Merge solo dopo l'ok del maintainer, un ramo alla volta.
