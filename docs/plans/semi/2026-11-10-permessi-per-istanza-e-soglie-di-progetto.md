# Permessi: il ruolo di scrittura per una sola istanza, e le soglie di progetto per allarmi, ricette e funzioni (seme)

> Nato il 10-11-2026 da `Appunti.txt` (punti del 03-11-2026 e del 04-11-2026), quando il maintainer ha chiesto di
> trasformare gli appunti in semi e piani e di eliminare il file.

**Stato: seme — decisione.** Quando questo lavoro comincerà, il primo passo è una sessione di plan approfondita e
dedicata, per sviscerarne tutti i dettagli. Quello che segue è l'idea e le misure nel codice, non un progetto.

## L'idea

Due domande sui permessi, tenute insieme perché toccano gli stessi punti del codice: la mappa delle soglie di
scrittura (`build_tag_write_roles`, che dal 04-11-2026 è `sws_core::soglie_di_scrittura`), le rotte sotto
`require_operator`, e il viewer LVGL, che ricava i ruoli dal progetto che legge dal server.

### A. Il ruolo di scrittura per una sola istanza di un tipo (03-11-2026)

Confermato dal maintainer il 03-11-2026: «serve».

Oggi il ruolo di una foglia (`pompa1.comando`) sta solo nel membro del tipo (`write_min_role` nella scheda Tipi),
quindi vale per tutte le istanze: aprire `.comando` a tutti su `pompa1` lo apre anche su `pompa2`. Non c'è un posto
dove dire «solo su `pompa1`».

L'appunto del 03-11 diceva che il `write_min_role` messo sulla variabile `pompa1` «vale solo per la radice, non per
le foglie», perché `build_tag_write_roles` in `sws-web/src/projects.rs` «mette la radice e i ruoli dei membri,
nient'altro». Il codice del 10-11-2026 dice una cosa un po' diversa, vedi sotto: il ruolo sull'istanza copre le
foglie **il cui membro non dichiara un ruolo**; dove il membro lo dichiara, vince il membro. Il limite resta lo
stesso: non si può aprire, né chiudere, **una** foglia su **una** istanza.

Dal 03-11-2026 la riga della foglia nella scheda Tag mostra il ruolo e, col clic, apre il tipo sul membro.

### B. Soglie di progetto per riconoscere un allarme, applicare una ricetta, eseguire una funzione (04-11-2026, sessione T1)

Trovato nella sessione T1 della serie del 04-11 (regola R7 dei template, [§Regole dei template — R6, R7, R8 nel
README dei piani](../README.md)). **Riconoscere un allarme, applicare una ricetta, eseguire una funzione restano a
Operator** anche in un template dove ogni comando è aperto a Viewer (R7): le rotte stanno sotto `require_operator`
(`router.rs`, `operator_routes`). In una demo il visitatore vede gli allarmi e non li può riconoscere.

Nota dell'appunto: «se serve, è una soglia per progetto, non una modifica dei template».

## Cosa c'è nel codice (misurato il 10-11-2026)

### La mappa delle soglie

- `build_tag_write_roles` (`sws-runtime/crates/sws-web/src/projects.rs`, riga 1317) dal 04-11-2026 chiama solo
  `sws_core::soglie_di_scrittura` (`sws-runtime/crates/sws-core/src/percorso.rs`, riga 690). La regola è stata
  spostata in `sws-core`; il commento sopra `build_tag_write_roles` dice: «La regola sta in `sws_core` dal 04-11-2026,
  perché la legge anche il pannello LVGL per il lucchetto.»
- `soglie_di_scrittura` mette nella mappa: il `write_min_role` di ogni tag (radice o tag piatto) e, per le foglie di
  un'istanza, il `write_min_role` del **membro**, se c'è. Niente altro.
- `soglia_di_scrittura` (stesso file) risolve un percorso in quest'ordine: la voce esatta (tag, o foglia col ruolo
  del membro), poi la radice se il percorso ha `.` o `[`, poi `Operator`. Stesso ordine di `TagDb::write_role_of`
  (`sws-runtime/crates/sws-core/src/tag.rs`): «un ruolo messo sull'istanza vale per tutti i suoi membri».
- Il test `la_soglia_del_membro_della_radice_e_quella_predefinita` (`percorso.rs`, riga ~732) fissa chi vince oggi:
  tipo `pompa` con membro `comando: Viewer` e `portata` senza ruolo; `p1` con `write_min_role: Supervisor`, `p2`
  senza. Risultato: `p1.comando` → `Viewer` (il membro vince sull'istanza), `p1.portata` → `Supervisor` (l'istanza
  copre la foglia senza ruolo), `p2.comando` → `Viewer`, `p2.portata` → `Operator`.
- I campi: `write_min_role` sul tag (`sws-runtime/crates/sws-core/src/project.rs`, riga 104, «l'enforcement che il
  server può davvero garantire — il min_role degli oggetti è UX») e sul membro del tipo (riga 181). Nessun altro campo
  di ruolo nel progetto: non c'è una mappa per istanza e non c'è un'impostazione di progetto.

### Chi legge la mappa

- **Server.** `tag_write_allowed` (`sws-runtime/crates/sws-web/src/router.rs`, riga 249) legge `db.write_role_of`;
  una soglia assente vale Operator. Dal 25-10-2026 è l'unico controllo su `PUT /api/tags/:id` (`write_tag`, riga ~3880)
  e sul WebSocket (riga ~9422): la rotta non sta più sotto `require_operator`, piano archiviato
  [«Chiunque, anche senza login»](../../archive/2026-10-25-scrittura-senza-login.md), provato sul WP630 il 28-10-2026.
- **Viewer web.** `sogliaScritturaTag` in `sws-editor/src/auth/permessoScrittura.ts`: stesso ordine (esatto, membro,
  radice, `Operator`). Il membro c'è dal 04-11-2026: prima si guardava solo la radice e un membro aperto a Viewer
  apriva lo stesso il login (trovato in T1). Il lucchetto: `ruoloCheServe` (stesso file, riga 109) e
  `sws-editor/src/canvas/LucchettoRuolo.tsx`. Test: `sws-editor/tests/permessoScrittura.test.ts`,
  `sws-editor/tests/ruoloFoglia.test.tsx`, `sws-editor/tests/lucchettoRuolo.test.tsx`.
- **Viewer LVGL.** Non chiede i ruoli a una rotta sua: `fetch_soglie_scrittura`
  (`sws-runtime/crates/sws-lvgl-viewer/src/client.rs`, riga ~880) scarica `GET /api/project` (solo `tags` e `types`)
  e calcola in locale `sws_core::soglie_di_scrittura`. La mappa sta in `LUCCHETTI` (`lvgl_render.rs`, riga ~12548,
  una volta per pagina), la legge `ruolo_che_serve` (riga ~15890, «stesso conto di `ruoloCheServe` nel web») e la
  disegna `lucchetto_ruolo` (forma A, pastiglia in alto a destra, scelta dal maintainer il 04-11-2026). Quindi
  «LVGL legge i ruoli dal server» vuol dire: legge il progetto e applica la stessa funzione di `sws-core`. Un dato
  nuovo per istanza arriva a LVGL solo se sta nel progetto e in `soglie_di_scrittura`.

### L'editor

- Scheda Tipi (`sws-editor/src/config/schede/TipiTab.tsx`, riga 379): il `select` del `write_min_role` del membro,
  `patchMembro(i, { write_min_role })`.
- Scheda Tag (`sws-editor/src/config/schede/TagsTab.tsx`, righe ~640-690): le foglie di una variabile strutturata
  sono «in sola lettura: unità, decimali e intervallo stanno nei membri del tipo, e si cambiano lì (una sezione per
  dato)». Il bottone `ruolo-<percorso>` (03-11-2026) mostra `cfg.tagFogliaScrive` col ruolo del membro, o
  `cfg.tagFogliaScrivePredefinito`, e al clic fa `navigateToConfig("types", "<tipo>#<membro>")`, anche se il membro
  sta in un tipo annidato.

### Le rotte che restano a Operator

- Porta del viewer (`router.rs`, `build_runtime_inner`, riga ~2051): `POST /api/alarms/:id/ack`,
  `POST`/`DELETE /api/alarms/:id/shelve`, `GET /api/alarms/shelved`, `POST /api/recipes/:id/apply`,
  `POST /api/script/run/:name`, con `route_layer(require_operator)`.
- Porta IDE/admin (riga ~711): le stesse più `/api/script/check`, `/api/script/nomi`, i log (`/api/logs`,
  `/api/logs/files`, `/api/logs/file`, `/ws/logs`), i browse delle sorgenti (MQTT, OPC-UA, Home Assistant),
  `/api/sources/stato`, `/api/simboli-lib`, `/api/system`.
- `require_operator` (riga ~2961) fa solo `check_role(&req, Role::Operator)`. `ack_alarm` (riga ~5169) non ha altri
  controlli suoi. `apply_recipe` (riga ~8891) controlla **anche** `tag_write_allowed` su ogni setpoint (riga 8921):
  una ricetta passa due porte. `run_function` (riga ~7686) una sola.
- `examples/templates/README.md`, §R7 (riga 98): «Non si possono aprire a Viewer, perché il runtime le tiene a
  Operator: riconoscere un allarme, applicare una ricetta, eseguire una funzione». E: «Nessun bottone chiama una
  funzione Python (`on_press_fn`): una funzione la esegue solo un Operator, e il pannello LVGL non la esegue
  affatto». Le due eccezioni di R7 (`openplc-laboratorio`, `homeassistant-pro`) stanno in `R7_PERMESSI` di
  `scripts/check_templates.sh` (riga 162).

## Da decidere col maintainer (le opzioni già visibili)

### A. L'eccezione per istanza

1. **Dove si scrive.** Una mappa `percorso → ruolo` sulla variabile (`pompa1: { … , ruoli_foglie: { comando: Viewer } }`)?
   Oppure la riga della foglia nella scheda Tag diventa modificabile, cosa che oggi la regola «una sezione per dato»
   vieta, perché il dato sta nel membro? Se si sceglie la seconda, va detto che la riga scrive un dato **diverso** dal
   membro (l'eccezione dell'istanza), non lo stesso.
2. **Chi vince fra membro e istanza.** Oggi vince il membro (test sopra). Con un'eccezione per istanza l'ordine
   diventa: foglia dell'istanza, membro, radice, `Operator`? O l'istanza può solo **aprire** (abbassare la soglia) e
   non chiudere? Da decidere prima del codice.
3. **Tre lettori, una regola.** Server (`soglie_di_scrittura` + `write_role_of`), viewer web (`sogliaScritturaTag`,
   copia in TypeScript) e LVGL (`soglie_di_scrittura` sul progetto scaricato). La copia web va allineata a mano; LVGL
   segue da sé se il dato sta nel progetto. Il validatore (`sws-runtime/crates/sws-web/src/validate.rs`, riga ~1070,
   che oggi fonde `m.write_min_role` e `t.write_min_role` nel tag sintetico) è un quarto punto.

### B. La soglia di progetto

1. **Una soglia o tre.** Riconoscere (e silenziare) un allarme, applicare una ricetta, eseguire una funzione: un solo
   ruolo minimo di progetto, o uno per azione? La ricetta ha già la seconda porta per setpoint.
2. **Dove sta.** Oggi il progetto non ha nessun campo di ruolo fuori dai tag. Serve un posto nel progetto (viaggia
   con export, template e deploy) e la rotta che lo legge al posto del middleware fisso.
3. **I template e R7.** Il README dei template dice che queste tre azioni «non si possono aprire a Viewer». Se la
   soglia di progetto nasce, R7 e la guardia `check_templates.sh` cambiano? L'appunto dice di no: «una soglia per
   progetto, non una modifica dei template». Da confermare col maintainer.
4. **LVGL.** Il pannello non esegue funzioni; per allarmi e ricette va visto cosa mostra a chi non può (oggi il
   lucchetto esiste solo per i comandi che scrivono tag).

## Documenti collegati

- [«Chiunque, anche senza login» — il permesso di comandare sta nel tag](../../archive/2026-10-25-scrittura-senza-login.md),
  archiviato: da lì viene la regola «vince il più severo» fra tag e oggetto.
- [README dei piani, §Regole dei template — R6, R7, R8](../README.md): la sessione T1 e il punto 4 «trovato in T1».
- [Il progetto letto da un anonimo](2026-10-26-progetto-letto-da-un-anonimo.md): è la stessa `GET /api/project` da
  cui LVGL ricava le soglie.
