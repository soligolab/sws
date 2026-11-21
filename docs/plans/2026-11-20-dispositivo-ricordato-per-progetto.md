# Il dispositivo ricordato per progetto — un difetto, con il rischio del deploy sbagliato

> Seme del 20-11-2026, dal maintainer: «Quando cambio progetto chiudendo e riaprendo uno nuovo la connessione rimane
> sul dispositivo precedente col rischio concreto di caricare il progetto sul dispositivo sbagliato. Ogni progetto deve
> ricordare a che dispositivo era connesso l'ultima volta che è stato chiuso e, all'apertura, chiedere se ci si vuole
> riconnettere a quel dispositivo specifico.»
>
> **Piano dal 20-11-2026 sera** (sessione di plan col maintainer, da `ufficio`): decisioni qui sotto, ramo
> `feat/device-per-project`, annidato su `chore/novita-no-limit-in-rc` ← `fix/symbol-editor-close-dialog`.

## Il difetto
Nell'IDE locale (PC del cliente, `start_editor.sh`) si chiude un progetto e se ne apre un altro: il collegamento al
pannello resta quello di prima. «Deploy» manda il progetto nuovo al pannello del progetto vecchio. Niente lo dice,
a parte l'indicatore in alto (`DispositivoCollegato`).

## Cosa c'è nel codice (misurato il 20-11-2026, su `main`)
- **Il collegamento è dell'istanza, non del progetto.** `AppState.remote_target` è uno solo per tutto l'IDE: lo scrive
  `connect_remote` (`remote.rs`), lo toglie solo `disconnect_remote`. `open_project`/`close_project` (`projects.rs`)
  non lo toccano.
- **Il browser ricorda un solo indirizzo**, non uno per progetto: `sws.runtime.targetUrl` e `sws.runtime.targetUser`
  in `localStorage` (`RT_URL_KEY`/`RT_USER_KEY`, `RuntimeConnectionTab.tsx`). Li scrivono la scheda Connessione e
  `DevicesTab`; il pulsante «Deploy» in alto li usa per il «riconnetti» a un clic (`App.tsx`). La password non si
  salva nel browser (09-09-2026).
- **Nel cloud il ricordo per progetto esiste già**: `config/dispositivo.yaml` (`DispositivoRicordato`) con indirizzo,
  utente e password, e `ripristina_se_serve` che si ricollega da solo.
- **Il deploy verso un pannello che ha un progetto con un altro nome chiede già conferma**, dal 03-10-2026: 428
  `sostituisce-progetti` in `remote.rs` (`leggi_progetti_dispositivo` + `progetti_da_sostituire`), testo in
  `conferme428.ts` (`testoSostituzione`). Vale in locale e nel cloud. Il punto 4 delle decisioni è quindi già fatto:
  si verifica al collaudo, non si scrive.
- `project.yaml` è versionato (`If-Match`/`VERSIONE_PROGETTO` in `api/client.ts`): una scrittura del backend fatta di
  nascosto farebbe fallire il salvataggio successivo dell'IDE con un 412. Il ricordo si scrive quindi con una **rotta
  di sezione** come le altre (`/api/project/impostazione-iniziale`, `/api/project/pannello`), che restituisce la
  versione nuova.

## Le decisioni (maintainer, 20-11-2026)
1. **Il ricordo sta in `project.yaml`**, chiave `last_device: { url, username }`, **senza password**: viaggia con git,
   backup ed export, e chi apre il progetto su un altro PC ritrova lo stesso pannello.
2. **Chiudere o cambiare progetto chiude sempre il collegamento** (IDE locale). Nessun progetto eredita il pannello del
   precedente.
3. **All'apertura**, se il progetto ricorda un pannello: «Ricollegarsi a `<indirizzo>`?» Sì/No. Con Sì si tenta senza
   password (va bene per un pannello senza utenti); se il pannello vuole la password si apre la scheda Connessione con
   indirizzo e utente già scritti.
4. **Avviso al deploy se il pannello ha un progetto con un altro nome**: c'è già (sopra).
5. **Cloud com'è**: `dispositivo.yaml` e il ricollegamento da solo restano. Anche lì però l'IDE scrive `last_device`,
   così un progetto scaricato dal cloud e aperto in locale ricorda il suo pannello.

## Come si fa
- **Modello** (`sws-core/src/project.rs`): `pub last_device: Option<LastDevice>` con
  `#[serde(default, skip_serializing_if = "Option::is_none")]`; `LastDevice { url: String, username: String }`
  (`username` vuoto = nessuno). Tipo TS in `types.ts`.
- **Rotta** `PUT /api/project/last-device` (corpo `LastDevice` o `null`), sul modello di `impostazione-iniziale`:
  versionata, nell'elenco `PATH_VERSIONATI`, nelle rotte d'autore dell'IDE. Valida: `url` `http(s)://`, lunghezze.
  `api.setLastDevice()` in `client.ts`.
- **Chiusura del collegamento** (`projects.rs`): in `open_project` e `close_project`, **fuori dal cloud**
  (`!s.supervisor.e_nel_cloud()`), `s.remote_target.write().await.take()`. `dispositivo.yaml` non si tocca (in locale
  non esiste). Nell'IDE, all'apertura e alla chiusura, `setRemoteConnected(false)`.
- **Scrittura del ricordo**: dove il collegamento riesce, cioè nello store (`setRemoteConnected(true, url)`), un helper
  `rememberDevice(url, username)` che chiama `api.setLastDevice` se il progetto aperto ha un valore diverso, e aggiorna
  `project.last_device` nello store **senza** sporcare il progetto. Un «Disconnetti» esplicito non lo cancella: il
  progetto ricorda l'ultimo pannello, non quello di adesso.
- **`localStorage` diventa lo specchio del progetto aperto**: all'apertura `RT_URL_KEY`/`RT_USER_KEY` prendono il
  `last_device` del progetto, o si svuotano se non ne ha. Così la scheda Connessione e il «riconnetti» della testata
  propongono il pannello di questo progetto e mai quello di un altro.
- **La domanda all'apertura** (helper in `config/`, chiamato dopo il caricamento del progetto, solo fuori dal cloud e
  solo se non già collegati): `conferma({ titolo, testo: «Questo progetto era collegato a <url> (utente <u>).
  Ricollegarsi?» })`. Sì → `api.remoteConnect(url, user)`; se fallisce o chiede la password →
  `navigateToConfig("runtime")`, coi campi già scritti dallo specchio.
- **Testi** in `it.json`/`en.json`.

## Verifica
- `cargo test`: `last_device` letto e scritto (assente in un progetto vecchio), la rotta rifiuta un URL non `http(s)`,
  `open_project`/`close_project` tolgono `remote_target` fuori dal cloud.
- vitest: lo specchio di `localStorage` all'apertura (con e senza ricordo), `rememberDevice` scrive solo se cambia, la
  domanda all'apertura (Sì → connect; No → niente).
- Collaudo (`start_editor_develop.sh`): progetto A collegato al TC620 → chiudi → apri B (senza ricordo): scollegato,
  la scheda Connessione è vuota → riapri A: domanda, Sì, collegato. Deploy di B sul pannello di A: la conferma
  «sostituisce progetti» compare.
- CasaDomotica: il suo `project.yaml` nel cloud prende `last_device` al primo collegamento dall'IDE; nessun esempio da
  aggiungere a mano.
