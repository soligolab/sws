# La sessione che non sopravvive a un deploy, e nessuno lo dice

**Stato: piano d'esecuzione, decisioni prese.** Nato il 22-10-2026 da una segnalazione del
maintainer: «se su un progetto ho fatto il login per esempio come admin, e faccio un deploy da
sws.soligo.net, a video sembra di essere loggati ma non lo si è davvero, devo fare logout e poi
rifare il login».

Due sintomi, e vanno spiegati tutti e due: **la sessione smette di valere**, e **l'interfaccia non
se ne accorge**. Il dettaglio che ha ristretto il campo è il rimedio: logout + login sblocca, un
ricaricamento no — quindi la cosa rotta è persistita, non è stato in memoria della pagina.

## La catena, misurata il 22-10-2026

**Il nodo**: sulla porta del viewer (7443) un token morto **non dà 401**. `optional_auth`
(`sws-web/src/router.rs:2447`) lo declassa in silenzio ad anonimo con `Role::Viewer` — il
commento nel codice lo dice: *«Expired / unknown token → anonymous»*. Da lì:

1. tutte le letture restano **200** (`/api/project/fingerprint`, `/api/synoptics`,
   `/api/faceplates`, `/ws/tags`);
2. il watcher del progetto vede l'impronta cambiata e ricarica i dati, **senza mai richiedere chi
   sei**: `whoami` si chiama una volta sola al montaggio (`viewer/RuntimeViewer.tsx:125`, deps `[]`);
3. lo store reidrata `authToken`/`authUser`/`authRole` da `localStorage`, quindi i cancelli lato
   client continuano a credere di essere Admin (`SvgCanvas.tsx:690`, `:1897`, `:3131`): comandi
   abilitati, pagine con `min_role` visibili;
4. la prima richiesta che fallisce dà **403, non 401**, e il client sul 403 lancia un `Error`
   generico: `sws:session-expired` parte solo sul 401, e il suo unico ascoltatore è in `App.tsx`,
   che è il bundle **admin** — il viewer non lo ascolta affatto;
5. unica uscita: logout + login (`runtime-view/RuntimeView.tsx:343`).

**La causa a monte, che nessuno aveva isolato**: ogni deploy **chiude** il progetto sul pannello
(`remote.rs:2477` → `/api/projects/{}/open`, e `projects.rs` chiude prima), e `close_project`
(`projects.rs:1728`) fa `s.auth.clear()`, che azzera **tutte** le sessioni. Due righe sopra, gli
allarmi fanno `s.alarms.chiudi()` col commento *«messo da parte, non buttato»*. Il filtro «tieni
le sessioni degli utenti invariati» scritto l'11-10 — con un test verde che lo fissa
(`sws-auth/src/lib.rs:960`) — **non entra mai in funzione**, perché le sessioni sono già sparite
prima della riapertura. Su `close_project` non esiste **nessun** test.

**La parte che va oltre il sintomo**: il viewer scrive i tag via **WebSocket**, e quel socket ha
catturato il ruolo **all'handshake** (`router.rs:7923`, `handle_ws(..., user.role, ...)`). Il
deploy non lo chiude: manda `{"type":"project_changed"}`, che nel client **non ha nessun
gestore** (zero riscontri in tutto `sws-editor/src`). Quindi dopo il deploy i comandi sui tag
continuano a passare con privilegi che il server non riconoscerebbe più via HTTP. Il ruolo
catturato governa due controlli dentro il ciclo del socket: `role < Role::Operator` e
`tag_write_allowed(&db, &tag, role)`.

**E sul pannello LVGL** la sessione è un file su disco riconvalidato **solo contro l'orologio**
(`sws-lvgl-viewer/src/session.rs:131`): finché la data non è scaduta il token è «buono». È il
pezzo persistito che spiega perché un riavvio non sblocca. Un comando rifiutato finisce solo su
`stderr` (`net_worker.rs:197`).

**Due ipotesi scartate**, non addolcite: la connessione remota dell'IDE che resta verde è già
stata riparata il 16-10-2026 (`remote.rs:14-38`) — il viewer è la metà che non ha mai ricevuto
quella correzione; e il seed di recupero non ri-hasha l'admin a ogni apertura
(`sws-auth/src/lib.rs:298` esce subito se ci sono utenti).

**Quando NON succede**: `swap_store` tiene le sessioni degli utenti invariati, quindi il difetto
scatta solo se il `users.yaml` distribuito cambia la voce di quell'utente — e siccome gli hash
sono salati, un `users.yaml` scritto altrove differisce **sempre**. Predizione verificabile:
ridistribuendo due volte lo stesso progetto, la seconda volta il sintomo non compare.

## Le decisioni del maintainer (22-10-2026)

Tutti e quattro i rimedi si fanno: coprono cose diverse — due la causa, due il fatto che nessuno
se ne accorga.

1. **Il viewer web ricontrolla chi è dopo un ricaricamento del progetto**, e solo lì. È il momento
   esatto del deploy e in regime non aggiunge una sola richiesta. Scartate: il controllo periodico
   (traffico su un kiosk acceso h24, e nasconderebbe la prossima causa invece di mostrarla) e la
   reazione al 403 (legittimo per un Viewer che prova a scrivere).
2. **`close_project` mette le sessioni da parte**, non le butta: si spostano in un campo laterale
   e le mappe vive restano **vuote**, così fra il close e l'open nessun token vale e nessun login
   riesce — **esattamente come oggi**. Alla riapertura, se il percorso è lo stesso, si rimettono
   quelle degli utenti invariati. Scartata la variante «tenute in memoria e basta», che aprirebbe
   una finestra di pochi secondi in cui un token vale senza nessun progetto aperto: piccola, ma è
   un cambiamento di sicurezza, e qui non ne serve nessuno.
3. **Il server riconvalida il ruolo a ogni scrittura sul socket**, invece di fidarsi
   dell'handshake. È il rimedio corretto — l'autorizzazione non si decide una volta sola — e
   protegge anche i client che non aggiorniamo noi. Scartate: chiudere il socket su
   `project_changed` (chiude solo questa causa) e affidarsi al punto 1 (dipende dal fatto che sia
   il client a comportarsi bene).
4. **Sul pannello: riconvalida del token, e il rifiuto si vede.** Un comando rifiutato compare sul
   vetro con `lvgl_avviso` invece di finire solo su `stderr`, e la sessione si azzera. «È la
   differenza fra un difetto che si vede e uno che costa un collaudo»: finché resta su `stderr`,
   qualunque 403 futuro sarà di nuovo invisibile.

## Il lavoro

### 1. `close_project` mette da parte (`sws-auth`, `sws-web`)

- `sws-auth/src/lib.rs`, accanto a `clear()`: un `chiudi_mettendo_da_parte()` che sposta `users`,
  `sessions` e `store_path` in un campo laterale e **svuota le mappe vive**.
- `swap_store` (`lib.rs:483-494`): se le mappe vive sono vuote e il percorso messo da parte è **lo
  stesso** `new_path`, confronta `invariato()` contro lo snapshot e rimette le sessioni
  sopravvissute. Il vincolo sul percorso è ciò che rende il rimedio preciso: stesso progetto
  riaperto (il deploy) = sessioni tenute; progetto diverso = niente, come adesso.
- `sws-web/src/projects.rs:1728`: `s.auth.clear()` → la chiamata nuova. **E il commento di
  `close_project` a `:1679` («All sessions become invalid») da quel momento è falso**: va
  riscritto, o diventa la prossima trappola.
- Test, che oggi non esistono: chiudi + riapri lo stesso `users.yaml` → la sessione di un utente
  invariato vale ancora; con la password cambiata → non vale più; percorso diverso → niente.

### 2. Il viewer web richiede chi è (`sws-editor`)

In `viewer/RuntimeViewer.tsx`, nel `.then()` del callback di `useProjectWatcher`: ripetere
`api.whoami()` e `setAuth(tokenDelViewer(...), me.username, me.role)` — la riga che il montaggio
fa già. Riusa `auth/sessioneViewer.ts`, nato il 15-10-2026 per distinguere token vero da token
scaduto.

Funziona perché sulla 7443 `whoami` sta sotto `optional_auth`: con un token morto risponde **200
con `username: ""`**, quindi `tokenDelViewer` ritorna il sentinella `no-auth`.

Tre effetti, tutti voluti: i cancelli lato client si richiudono, l'interfaccia smette di dire che
sei admin, e **`authToken` cambia**, il che fa riaprire il flusso tag (`ws/tagStream.ts:145`) —
cioè butta via anche il ruolo stantio rimasto sul socket.

### 3. Il socket riconvalida (`sws-web`)

Il token viaggia come `?token=…` nell'URL del socket (`sws-editor/src/ws/wsUrl.ts:88`, «browsers
can't set auth headers»), quindi `ws_tags_handler` può estrarlo dalla query e passarlo a
`handle_ws` insieme a `s.auth`. Dentro il ciclo, i due controlli che oggi usano il `role`
catturato — `role < Role::Operator` e `tag_write_allowed(&db, &tag, role)` — rileggono il ruolo
dal token a ogni comando.

Costa una lettura da una mappa in memoria per messaggio, niente rispetto alla scrittura del tag.
Il ruolo dell'handshake resta come ripiego quando non c'è token (runtime senza utenti).

Test: un socket aperto con un token che poi viene invalidato deve ricevere `forbidden` alla
scrittura successiva.

### 4. Il pannello LVGL (`sws-lvgl-viewer`)

- `client.rs`, accanto a `fetch_system`: una `whoami(base_url, token)` che ritorna `username`.
  **Non** usare `/api/system` come sonda: è `require_operator`, e una sessione Viewer viva
  prenderebbe 403 facendosi buttare fuori per sbaglio.
- `main.rs`, nel ramo del `reload_flag` (il momento del deploy) e all'avvio dopo
  `SessionState::load()`: se c'è un token, `whoami`; se il nome torna vuoto, si azzera la
  sessione. Il ridisegno che segue mostra «Login» al posto del nome e rimette i `min_role` al
  loro posto da solo.
- `net_worker.rs:197`: un comando rifiutato con 401/403 azzera la sessione **e** mostra un avviso
  con `lvgl_avviso`.
- Test senza LVGL: nome vuoto azzera, nome pieno non tocca niente, senza token non chiama affatto.

## Verifica

- `cargo check`, `pnpm build`, `check_static.sh`, `cargo test`, `pnpm exec vitest run`.
- **La prova che conta è quella che ha trovato il difetto**: deploy da `sws.soligo.net` su un
  pannello con una sessione Admin aperta. Dopo: la barra deve dire la verità, i comandi che non
  si possono più fare devono sparire, e una scrittura rifiutata deve **vedersi**.
- **E la predizione da verificare**: ridistribuendo due volte lo stesso progetto, la seconda volta
  la sessione non deve cadere affatto (punto 1 del lavoro).
