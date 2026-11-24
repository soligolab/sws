# I residui della rc.30, le sue scelte riviste, il Bad visibile di default (24-11-2026)

## Contesto

Il maintainer, 24-11-2026: «Implementa gli step 4 5 e 6». I tre punti vengono dall'elenco dei prossimi passi di
sviluppo dopo la chiusura della 2.26 alla rc.30:

- **4**: le correzioni rimaste dopo la rc.30 (piano [`2026-11-23-correzioni-collaudo-rc30.md`](2026-11-23-correzioni-collaudo-rc30.md),
  sezioni «Restano, piccoli, per dopo la rc» e «Restano, per dopo la rc»);
- **5**: le scelte prese senza il maintainer per la rc.30, riviste con lui;
- **6**: il Bad visibile di default su tutti gli oggetti (decisione B1 del 23-11-2026: «il Bad di default in
  2.27.0-dev, con un piano aperto subito»).

Tutto esce come 2.27.0-dev. Nessun ramo di release è aperto (la 2.26 è chiusa).

## Le decisioni del maintainer (24-11-2026)

| | Domanda | Decisione |
|---|---|---|
| 5.1 | Rotazione dello schermo | **Resta com'è**: il deploy chiede conferma (428 `rotate-screen`). |
| 5.3 | Admin del dispositivo per un pannello abbinato dal cloud | **Sì**: l'abbinamento dal cloud crea anche un Admin del dispositivo; il deploy dalla rete locale torna possibile. |
| 5.7 | Registro delle scritture dal viewer | **Resta com'è** (raggruppato, al più 20 righe al secondo). |
| C+2 | Un 428 durante un deploy partito da un salvataggio | **Si chiede la conferma**, come per il deploy a mano; «no» lo ferma. |
| B2 | Il Bad di default | **Attivo nei motori** (web e LVGL); un oggetto rinuncia con `"none"`. |
| B3 | L'aspetto del Bad | **Il grigio di oggi più un «?»** a piena intensità, fuori dal grigio. |
| B4 | Le scelte minori | Uncertain resta **solo il pallino giallo**; sul pannello LVGL il **pallino è di default sui 9 tipi** come sul web; **led e tabella** passano dal rosso al segno di B3. |

## Ordine e rami

I due rami dell'assistente dei simboli sono aperti e aspettano il collaudo della 2.27.0-dev.1. Il lavoro di questo
piano si **annida** sopra `feat/symbol-assistant-interview` (regola «un ramo alla volta», opzione 2), un ramo alla volta:

1. `fix/rc30-leftovers` — parte A (le correzioni) e parte B (le scelte riviste);
2. `feat/bad-by-default` — parte C.

## A. Le correzioni rimaste dopo la rc.30

1. **Rotazione in attesa**: `/api/system?screen_rotation=1` dice anche la rotazione già chiesta e in attesa
   (`rotation_attempt`, 10 minuti); un secondo deploy in quei minuti non la richiede.
2. **Pagina Utenti**: il salvataggio all'uscita da un campo non spegne la tabella mentre il fuoco va al campo dopo.
3. **Socket dei tag**: rifiuta le scritture sui tag calcolati, come la REST (T-69).
4. **`audit.jsonl` sul pannello**: si pota (tetto di dimensione) e all'avvio non si legge intero.
5. **«Togli ritaglio»** rende colore, materiale e gruppo della forma: `ClipShape` in `simboli_prj.rs` prende i campi
   che servono (formato nuovo, facoltativo), e `unclipPhoto` li rimette.
6. **Ritagliare una forma con un effetto**: `clipPhoto` toglie gli effetti rimasti senza forme, come fa `deleteOps`.
7. **Ruota e Specchia** su una selezione con una foto: la foto gira con le forme attorno al centro comune
   (`matrixOp` tratta `image`).
8. **Trend, qualità viva**: vale anche sulle finestre spostate o storiche; i cursori di misura saltano i campioni Bad.
9. **Trend, tag mai ricevuto**: niente linea a 0.
10. **Salvataggio durante un deploy esplicito**: non fa partire un secondo deploy automatico (oggi prende 409 e la
    testata copre l'errore).
11. **«Nuovo» dopo un salvataggio**: ciò che si crea non resta marcato come nuovo dopo un salvataggio nella stessa
    sessione (nit).
12. **`cfg.deployProjectSession`**: la via d'uscita per un pannello con utenti del progetto, senza Admin e senza cloud,
    viene dalla parte B (l'Admin creato all'abbinamento); per i pannelli già abbinati, il messaggio dice come crearlo.

## B. Le scelte della rc.30 riviste

1. **Admin del dispositivo all'abbinamento dal cloud** (5.3): l'abbinamento crea un Admin del dispositivo con le
   credenziali che la persona sceglie, o un codice da cambiare al primo accesso; il deploy locale torna possibile.
   Prima di scrivere: misurare l'abbinamento di oggi (`abbinamento.json`, `utenti_*`) e la regola dei file di stato
   del dispositivo (migrazione all'avvio).
2. **428 durante un deploy partito da un salvataggio** (C+2): l'IDE mostra la stessa domanda del deploy a mano
   (`conferme428.ts`); «sì» lo rimanda con la conferma, «no» lo ferma e lo dice.

## C. Il Bad visibile di default

1. **Web** (`SvgCanvas.tsx` e gli oggetti): un valore Bad mostra il grigio e un «?» a piena intensità fuori dal grigio,
   su tutti gli oggetti con un tag; `quality_display: "none"` per rinunciare.
2. **LVGL** (`lvgl_render.rs`): lo stesso segno, e il pallino della qualità di default sui 9 tipi come sul web.
3. **Uncertain**: solo il pallino giallo, nessun «?».
4. **Led e tabella**: il Bad passa dal rosso al segno di C.1 (il rosso resta dell'allarme).
5. **Edit mode**: le sinusoidi demo restano; il segno si vede col toggle «Anteprima effetti».
6. **Parità**: `check_lvgl_parity` e i gemelli `demo-items-*`; istantanee web e LVGL a confronto.
7. **NOVITA**: un avviso di compatibilità («i valori Bad ora si vedono su tutti gli oggetti»).

## Stato (24-11-2026)

- **Parti A e B fatte** sul ramo `fix/rc30-leftovers` (sette commit, `615a3104`…). A12 si chiude con B1 per i
  pannelli nuovi; per quelli abbinati dal cloud prima della 2.27 il messaggio del deploy locale lo dice.
  Restano fuori: A8 nel trend LVGL (il pannello non ha cursori di misura né finestre spostate; da controllare al
  collaudo).
- **In `main`** con lo squash del 24-11-2026 (insieme alle sessioni 1 e 2 dell'assistente dei simboli), uscite nella
  2.27.0-dev.3. **Parte C** da fare, su un ramo da `main`.

## Verifica (ogni ramo, prima dello squash)

`cargo check`, `cargo test`, `pnpm build`, `pnpm exec vitest run`, `./scripts/check_static.sh`, più i controlli della
CI (fmt, clippy, audit, lint, type-check). La conferma del maintainer con `/test-changes` su una dev.
