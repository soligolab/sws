# Collaudo 2.26.0-rc.29 sul WP630 (user@wp630-a-p3-07a077.local) — 23-11-2026

Progetto sul pannello: `tiny-ty` (fatto per il Tiny TY: sorgente `host-ty`, `soc-thermal`, `eth0`).
Il WP630 ha `ethernet0`/`ethernet1` e le zone `cpu-thermal`/`gpu-thermal`: tre metriche non esistono.

## A. Un tag calcolato da un ingresso Bad risulta Good (preesistente, non della rc.29)

Visto dal maintainer nella pagina SystemInfo: eth0 a 0.0, senza nessun segno di Bad.

Letto da `GET /api/tags` sul pannello (11:5x):
- `ty.eth0_rx_bps` 0.0 **Bad**, `ty.eth0_tx_bps` 0.0 **Bad** (metrica che sul WP630 non esiste)
- `ty.eth0_rx_kbs` 0.0 **Good**, `ty.eth0_tx_kbs` 0.0 **Good** — espressione `round(tags['ty.eth0_rx_bps'] / 1024, 1)`

Causa, nel codice della rc.29: `sws-runtime/crates/sws-runtime/src/main.rs` (~1080), il valutatore dei tag derivati
passa all'espressione **solo i valori** (`v.value`) e su esito positivo scrive sempre
`db.set_tipizzato(id, value, TagQuality::Good)`. La qualità degli ingressi non arriva mai al risultato. Solo l'errore
di valutazione marca Bad (18-11-2026).

Effetto: un valore inventato (lo 0.0 di un tag mai letto, o l'ultimo valore di una sorgente caduta) mostrato come buono;
anche gli allarmi e lo storico sui tag calcolati se lo bevono.

## B. La qualità Bad su un oggetto si vede solo se l'oggetto la chiede (scelta di progetto da rivedere)

Visto dal maintainer: il grafico della temperatura vuoto, senza segnalazioni.

`ty.temperatura` è 0.0 **Bad** (09:24:45, mai aggiornato). Nel viewer web lo stato Bad è *opt-in* per oggetto
(`bad_value_style: "gray"`, commento «F4 — lampeggio, stato allarme, stale e Bad-gray (tutti opt-in)» in
`sws-editor/src/canvas/SvgCanvas.tsx` ~2181). Nessun oggetto di `tiny-ty` lo imposta (0 occorrenze di
`bad_value_style`/`stale_after_s` nelle pagine). Quindi un dato Bad non si distingue da uno buono, se il progettista
non se ne è ricordato oggetto per oggetto.

## C. Salvando dalla finestra dell'editor dei simboli, l'IDE mostra la barra «progetto cambiato sul runtime» (rc.29, blocco E)

Visto dal maintainer nel test 3 (IDE nel cloud, `tiny-ty`): a ogni salvataggio dalla finestra compare la barra marrone
«Il progetto sul runtime è cambiato (deploy o modifica esterna). Questa pagina mostra ancora la versione precedente.»
(il testo era in inglese: l'IDE era in inglese, `it.json` la traduzione ce l'ha). Per il maintainer non serve: basta
l'indicazione «non salvato» dell'IDE.

Causa, nel codice della rc.29:
- la finestra scrive i simboli da sé; l'impronta del progetto (`GET /api/project/fingerprint`) cambia;
- `useProjectWatcher` in `App.tsx` (~843) scarta i cambi entro 20 s da un salvataggio **dell'IDE**
  (`lastLocalSaveAt`, aggiornato solo da `saveStatus === "ok"`);
- il messaggio `saved` del ponte (`symbols/editor/ponteSimboli.ts` ~80) aggiorna simboli e versione nell'IDE ma non
  dice niente alla guardia: al giro successivo (3 s) il cambio sembra esterno.

Correzione probabile: alla ricezione di `saved`, trattarlo come un salvataggio dell'IDE (aggiornare `lastLocalSaveAt`,
o meglio rifissare la baseline dell'impronta). Più un test vitest.

## D. «+ nuovo ingresso…» non chiede il nome e gli ingressi «si scambiano» fra gli effetti (rc.29, blocco C)

Visto dal maintainer nel test 5 (effetti: superato). Causa: `addIngresso` (`symbols/editor/model.ts:1141`) mette ogni
ingresso nuovo in testa a `ops`; `inputIds` li elenca in quell'ordine; «Aggiungi effetto» (`FxProps.tsx:44`) prende
`ids[0]`, cioè l'ultimo creato: un effetto nuovo finisce sull'ingresso di quello precedente. Difetti vicini: un
`ingresso` non si rinomina né si cancella da «Ingressi»; rinominare una parte non aggiorna `effetto.input`;
`freePartId` ignora gli `ingresso`; «Aggiungi» tipo «Ingresso» crea una `parte kind:"input"` che il compilatore
rifiuta; duplicare/incollare tiene il `group`; `groupOps` perde il secondo bagliore/fiamma; il testo
`symbolEditor.fx.oldRemoved` cita il «pannello Pezzo» che non c'è più.

Regola chiesta dal maintainer: ciò che si crea chiede prima il nome (ingressi, parti, gruppi, bocche, simboli) — terza
regola UI di `CLAUDE.md`, per tutto l'IDE. Correzione dettagliata nella parte 1 del piano
([`docs/plans/2026-11-23-assistente-dei-simboli.md`](../2026-11-23-assistente-dei-simboli.md)).

## E. L'editor dei simboli si ferma con «e.find is not a function» (rc.29)

Visto dal maintainer durante il test 6 (foto ritagliata su una forma, foto oltre il riquadro, «Riempi il riquadro»):
il test era passato, poi «a un certo punto, non ho capito cosa ho fatto» la rete di sicurezza
(`SymbolEditorBoundary.tsx`) ha fermato l'editor: «The symbol editor stopped because of an error — e.find is not a
function». Le modifiche non salvate del simbolo sono perse.

Cosa dice il messaggio: durante il disegno dell'editor si chiama `.find` su un valore **definito ma non array** (un
oggetto, una stringa, un Set…). Su `undefined` il messaggio sarebbe «Cannot read properties of undefined».

Il progetto sul pannello non è cambiato dalle 11:48 (letto via ssh alle 16:04): l'IDE nel cloud lavora sulla sua
copia, quindi il simbolo salvato non si legge da qui. `componentDidCatch` scrive nella console del browser
«symbol editor stopped» con lo stack dei componenti.

**Causa probabile** (analisi del codice di `origin/release/2.26`, confermata a mano sulle righe):
- «Togli ritaglio» (`unclipPhoto`, `symbols/editor/model.ts:1204`) rimette la forma come
  `{ op: "forma", tag, geo, extra: { fill: "none" } }`: `extra` come **oggetto**, mentre ovunque è una lista di coppie
  `[["fill","none"]]`. È l'unico punto del codice che lo scrive così.
- Il compilatore Rust accetta anche l'oggetto (`simboli_prj.rs` ~276-299), quindi il disegno è normale, Salva funziona,
  nessun avviso.
- Appena quella forma diventa l'**unica selezione**, la colonna «Selezione» chiama `fillOf(one)`
  (`SymbolEditor.tsx:1629` → `model.ts:375`): `(op.extra)?.find(...)` su un oggetto. Nel bundle minificato è proprio
  `(e=t.extra)==null?void 0:e.find(...)` → «e.find is not a function».
- Perché «non ho capito cosa ho fatto»: la forma ripristinata sta **sopra** la foto (indice foto+1) e senza
  riempimento è quasi invisibile; un clic sulla foto dentro il suo contorno (`hitsAt`, il più alto vince) seleziona la
  forma, non la foto. Anche un clic sulla sua riga nella lista strati.
- Dopo il salvataggio l'oggetto resta nello store dell'IDE (e passa dalla finestra all'IDE col ponte); solo
  ricaricando il progetto dal server torna in coppie, e il difetto sparisce: per questo sembra non riproducibile.

Difetti vicini: con lo stesso `extra`, `setExtra`/`setFill`/`setGeo` falliscono nei gestori (cambiare colore della
forma ripristinata non fa niente); `clipPhoto` tiene solo `tag` e `geo` (si perdono colore, `extra` e `group`, quindi
«Togli ritaglio» non rende la forma di prima); nessun test copre `clipPhoto`/`unclipPhoto`. Va nel ramo
`fix/rc30-collaudo`, zona `symbols/editor/*`.

**Verifica (16:3x)**: tre ricerche indipendenti (chiamate a `.find`, percorsi del test 6, forme dei dati) sono
arrivate allo stesso punto; tre verifiche avversarie non l'hanno smontato. Nel bundle costruito da sorgenti identici
`fillOf` è `(e=t.extra)==null?void 0:e.find(...)`, e con `extra: {fill:"none"}` dà esattamente il messaggio visto. Le
altre `e.find` del bundle sono escluse: stanno in gestori di clic (React 19 non le porta alla rete di sicurezza), fuori
dall'editor, o su valori sempre array.

Correzione proposta:
1. `unclipPhoto` scrive `extra: [["fill","none"]]` (e `mat: null`); meglio, un costruttore tipizzato delle forme
   (`geo`/`extra` come `Pairs`) usato da `newRect`/`newEllipse`/`newPath` e da `unclipPhoto`, così `tsc` ferma l'errore.
2. Normalizzare `geo`/`extra` in coppie dove una descrizione entra nell'editor: apertura del draft
   (`openSymbolEditorFor`/stato iniziale), `readSymbolFile`/`readSymbolZip`, risultati dell'IA. Rust accetta per
   contratto anche la forma a oggetto: un `.swsym` scritto così, o esportato dopo un «Togli ritaglio» della rc.29,
   rompe allo stesso modo.
3. Vitest: «Togli ritaglio» rende coppie e `fillOf` → `{none:true}`; render dell'ispettore con la forma ripristinata
   selezionata da sola, senza `symbol-editor-crashed`; `readSymbolFile` con `geo`/`extra` a oggetto.

Difetto a margine trovato nello stesso giro: `matrixOp` (`model.ts` ~696) non tratta `image`, quindi «Ruota e
allinea» → Ruota/Specchia su una foto non fa niente.

## Funzione nuova (non anomalia): l'assistente dei simboli

«Disegno con l'IA» e «Genera foto» sostituiti da una chat con intervista guidata e generazione in più passi: parte 2
dello stesso piano, 2.27.0-dev.
