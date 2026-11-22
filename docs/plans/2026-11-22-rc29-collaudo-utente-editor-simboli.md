# rc.29 della 2.26: correzioni del collaudo, utente corrente, editor dei simboli rifatto (notte 22→23-11-2026)

## Contesto
Collaudo della rc.28 sul TC620 (22-11): test 1-9 superati, 12 anomalie in `tmp/test-changes/2026-11-22/anomalie.md`;
test 10 (LDAP) pronto, server `ldap.soligo.net` creato. Il maintainer va a dormire e vuole **la rc.29 pronta per le
9:00**, con dentro (decisioni del 22-11 sera, tutte prese con lui):
- le correzioni piccole (anomalie 1, 2, 6, 9, 10, 11, 12);
- **«utente corrente»** nelle pagine e negli script (eccezione alla regola dev/rc, come gli effetti);
- **il rifacimento dell'editor dei simboli**: effetti come proprietà di forme e gruppi, gruppi veri, foto ritagliata
  su una forma, «foto per stato» diretta, colonna destra come ispettore della selezione, editor in finestra staccata.

**Ripiego deciso**: si lavora a blocchi; ogni blocco entra in `release/2.26` (squash) solo quando è verde. Alle ~8:00
si costruisce la rc.29 con i blocchi finiti; un blocco a metà resta sul suo ramo e va in STATUS.

**Primo passo**: questo piano in `docs/plans/2026-11-22-rc29-collaudo-utente-editor-simboli.md` (riga in
`docs/plans/README.md`; il piano fase 8 effetti e i semi toccati rimandano qui), commit meta sul primo ramo.

## Ordine e rami (uno alla volta, ciascuno da `release/2.26`, squash, eliminato, cherry-pick `-x` in `main`)
1. `fix/rc29-collaudo` — blocco A (correzioni)
2. `feat/current-user` — blocco B
3. `feat/symbol-fx-groups` — blocco C (formato: gruppi, effetti, maschera)
4. `feat/symbol-inspector` — blocco D (colonna destra)
5. `feat/symbol-editor-window` — blocco E (finestra staccata)
6. CasaDomotica, rc.29, pubblicazione — blocco F

---

## A. Correzioni del collaudo (`fix/rc29-collaudo`)
1. **Avvisi ripetuti per rc** (an. 1): `sws-web/src/aggiornamento.rs` `senza_ripetizioni` (:273) unisce anche le voci
   con la stessa `compatibilita` e testi diversi (l'avviso una volta, sotto l'ultima versione del tratto, con
   l'intervallo «2.26.0-rc.24 … rc.28»); `AggiornamentoRuntime.tsx` `confermaAggiornamento` (:107) e la lista (:214)
   raggruppano per testo uguale; LVGL `lvgl_avviso.rs:886` idem. Test Rust sul raggruppamento + vitest.
2. **Foto e disegno che non riempiono il riquadro** (an. 2):
   - `ai/immagini.rs` `DA_SIMBOLO` (:224): l'oggetto riempie l'inquadratura da bordo a bordo, niente aria attorno;
   - `simboli_progetto.rs` `ai_photo` (:426): ritaglio automatico dei bordi trasparenti o di colore uniforme
     (tolleranza piccola) con il crate `image` già presente (modello: `sized_image.rs:103`), poi si salva; test con
     un PNG finto bordato;
   - `ai/tools.rs` `regole` (:1431): «usa tutto il riquadro, al più un'unità di margine, **se la richiesta non dà misure
     sue**»;
   - comando **«Riempi il riquadro»** in «Ruota e allinea» (`TransformBlock`, `SymbolEditor.tsx:1662`) → funzione
     `fillFrame` in `model.ts` accanto ad `align`: scala uniforme di tutto il disegno sul riquadro (margine 1),
     centratura, bocche riportate sul loro bordo. Solo a mano. Vitest.
3. **Foto oltre il riquadro** (an. 6): in `simboli_prj.rs` `regole` (:1657) la regola «esce dal disegno» non vale più
   per `image` (le forme restano vincolate; test :2197 aggiornato). Taglio al riquadro verificato: web (l'`<svg>` del
   simbolo con `overflow="hidden"` esplicito), LVGL (resvg nel riquadro), editor (l'eccedenza mostrata attenuata). I
   messaggi in inglese della regola immagini passano in italiano come gli altri della stessa funzione (sono testi per
   l'utente e per l'IA; la loro traduzione vera è un seme a parte: codici + file di lingua).
4. **Simboli dopo il deploy** (an. 9): `RuntimeViewer.tsx` `useProjectWatcher` (:154) chiama
   `ricaricaSimboliProgetto()` (`libreria.ts:137`) insieme a `loadProjectData`. Vitest.
5. **Ruolo minimo per funzione** (an. 10):
   - `FunctionDef.min_role: Option<String>` (`project.rs:1766`, come `TagDef.write_min_role` :104; assente = Operator);
   - `run_function` (`router.rs:8060`) controlla col ruolo dell'utente (modello `tag_write_allowed` :268); la rotta
     passa da `require_operator` a `optional_auth`+controllo per funzione (sul viewer e sull'IDE); 403 JSON
     `{code:"function_role", function, role}` → `apiError.function_role` tradotto («Per questo comando serve il ruolo
     … : accedi»);
   - web: `ruoloCheServe` (`auth/permessoScrittura.ts:109`) considera anche il ruolo della funzione di
     `on_press_fn` (terza fonte); il tocco senza ruolo apre l'accesso come per i tag (`RuntimeView.tsx:272`);
   - LVGL: `ruolo_che_serve` (`lvgl_render.rs:17363`) idem; i ruoli delle funzioni arrivano con le soglie
     (`fetch_soglie_scrittura`, `client.rs:1060`, rotta estesa);
   - IDE: select «Ruolo minimo per eseguirla» in `LogicaEditor.tsx` (:236) dopo la descrizione;
   - TS type, `synoptic_schema` rigenerato se tocca, test Rust (403 / 200 per ruolo), vitest.
6. **Anteprima nella libreria aziendale** (an. 11): `LeftPanel.tsx:1142` compila le descrizioni della libreria con
   `api.compilaSimboli` (come `sincronizzaSimboli`), cache per `slug+version`, foto mappate su
   `/api/library/:company/symbols/:slug/images/:name`; `AnteprimaLib` al posto di ◆/◇.
7. **Cambio password** (an. 12):
   - `ChangePasswordScreen.tsx:81`: `err instanceof AuthError` → `clearAuth()` e ritorno all'accesso con «la sessione
     è stata chiusa (per esempio la password è stata reimpostata): rientra»;
   - **dopo un accesso col PIN, entro 10 minuti, nella stessa sessione, la password attuale non si chiede**:
     `sws-identita` tabella `sessioni` + colonna `metodo` (`pin`/`password`, migrazione `user_version`+1),
     `accedi_con_pin` la scrive; `cambia_password_propria` salta `verifica_password` se la sessione è `pin` e
     `creata_ms` < 10 min; `whoami` espone `pin_recente`; la schermata nasconde il campo. Test Rust (pin recente sì,
     pin vecchio no, password no).
8. Il residuo di STATUS «log rumorosi all'aggiornamento» si riprova al prossimo aggiornamento (non è codice).

## B. Utente corrente (`feat/current-user`)
**Decisioni**: segnaposto nei testi; nome = «Nome visualizzato» degli utenti del progetto, `displayName` poi
`givenName` per il dominio, altrimenti il nome di accesso; ultimo accesso = **il precedente** a questo; anonimo =
vuoto; gli script ricevono chi li ha lanciati.
- **Segnaposto**: `{{user.name}}`, `{{user.username}}`, `{{user.role}}` (parola di sistema tradotta),
  `{{user.last_login}}` (data e ora nella lingua dei contenuti, vuoto al primo accesso). Risolti **nel client**, nei
  due motori, accanto a `sys:` (`i18n/projectI18n.ts:59`; LVGL `resolve_msg` `lvgl_render.rs:16091`), con la sessione
  passata dentro; tolto il ritorno anticipato quando manca la tabella lingue (`projectI18n.ts:94`,
  `lvgl_render.rs:16168`) per i soli segnaposto. Casi nuovi in `tests/fixtures/risoluzione-token.json`; parole dei
  ruoli in `testi-sistema.json` + `testi_sistema.rs` + `testiSistema.ts`. Niente sostituzione lato server
  (`cornici.rs`): le pagine sono in cache e LVGL le scarica senza token.
- **Backend**: `StoredUser.display_name: Option<String>` (`sws-auth/src/lib.rs:148`, con `CreateUser`/`UserPatch`/
  `UserSummary`); `Session` con `display_name` e `previous_login_ms`; file di stato del dispositivo
  `config/last_logins.json` (nome nuovo, inglese) letto al login (→ `previous_login_ms`) e riscritto con l'ora attuale,
  per utenti locali, del dispositivo e LDAP; `LoginOk` e `whoami` portano `display_name` e `previous_login_ms`.
- **LDAP** (`ldap_auth.rs:113`): attributi `memberOf`, `displayName`, `givenName`; `Outcome::In` porta il nome;
  `issue_external_session` lo salva; `LdapConfig.name_attribute: Option<String>` facoltativo; campo nella
  `LdapSection.tsx`.
- **Web**: store `authDisplayName`, `authPreviousLogin` (da login e whoami, `RuntimeViewer.tsx:219`);
  `SvgObject` già legge `authRole` (`SvgCanvas.tsx:3884`), stessa strada.
- **LVGL**: `client.rs` `LoginOk` e `whoami` con i due campi; `SessionState` (`session.rs:86`) li tiene e li salva;
  `chiedi_ridisegno` ridisegna al cambio di sessione.
- **IDE**: campo «Nome visualizzato» nella scheda Utenti; nell'oggetto testo un menu «Inserisci segnaposto» con le
  quattro voci; anteprima in edit con l'utente dell'IDE.
- **Script**: nome fornito nuovo `user` in `sws-pyscript` (`NOMI_FORNITI` :68, oggetto con `name`, `username`, `role`;
  `None` se lanciata da un evento, da uno script globale o da un anonimo); `run_function` passa l'`AuthUser`;
  `functions.run` dentro uno script propaga il chiamante; `/api/script/nomi` e completamento IDE aggiornati.
- Manuale widget/testo e `docs/manual` per i segnaposto; test Rust (last_logins, LDAP con nome, script `user`),
  vitest (risolutore), fixture condivise.

## C. Gruppi, effetti come proprietà, maschera (`feat/symbol-fx-groups`)
**Decisioni**: fiamma = la forma guizza (altezza e luminosità, base ferma); fumo = sbuffi dal bordo alto che salgono
allargandosi; bagliore = alone attorno al contorno; bollicine = salgono dentro la forma, tagliate dal contorno.
Ingresso = uno degli ingressi del simbolo (o uno nuovo), condizione + intensità facoltativa. Gli effetti-parte di oggi
**si buttano**. Gruppi «Ctrl+G».
- **Formato `prj:`** (`sws-core/src/simboli_prj.rs`, specchio `model.ts`/`DescrizioneSimbolo`):
  - campo facoltativo `group: Option<String>` su `Forma`, `Luce`, `Riflesso`, `Image`, `Tratto`: stesse lettere = un
    gruppo (dentro uno strato). Compilato come `<g data-group="…">` annidato nello strato (rientro di 4 spazi: lo
    spezzatore riga per riga dei due motori guarda solo le righe a 2 spazi — verificato da un test);
  - op nuovo `Ingresso { id }`: un ingresso del simbolo senza strato (manifesto `parts` con `kind:"input"`, così la
    pagina lo collega come le altre parti);
  - op nuovo `Effetto { kind, group, input, when: {op, value}, level?: {min, max}, color?, period_ms?, count? }`:
    `kind` ∈ glow/flame/smoke/bubbles, `group` = il gruppo bersaglio (una forma sola con un effetto riceve un gruppo
    di uno), `input` = id di una parte o di un `Ingresso`. Il compilatore calcola il riquadro del gruppo (il calcolo
    dei limiti delle forme c'è già per «esce dal disegno») e scrive nel manifesto un `fx[]` col riquadro derivato
    (fumo: sopra il bordo alto; bollicine: il riquadro + clipPath con le forme del gruppo; fiamma: il gruppo e la sua
    base; bagliore: il gruppo) — così i disegnatori di oggi (`effects.tsx`, `symbol_fx.rs`) si riusano;
  - `TIPI_PARTE` perde glow/bubbles/smoke/flame: una parte vecchia di quei tipi si ignora con un avviso in
    `validate.rs`; l'editor all'apertura la toglie e lo dice;
  - `Image.clip: Option<{tag, geo}>`: la forma usata come maschera, dentro l'immagine (niente riferimenti che si
    rompono); compilata in `<defs><clipPath>` nella testa (che entrambi i motori portano in ogni strato) e
    `clip-path` sull'immagine. resvg 0.45 la rispetta (verificato dal codice; test di rasterizzazione in
    `check_simboli_lvgl.sh`).
- **Valutatore** condiviso (`symbol_behaviour.rs` + `behaviour.ts`, fixture `symbol-pieces.json`): effetto attivo per
  condizione sul valore dell'ingresso, intensità 0..1 fra `min` e `max`.
- **Web** (`SimboloLib.tsx`, `effects.tsx`): bagliore come filtro sul `<g data-group>`; fiamma come animazione
  `scaleY`+luminosità ancorata alla base del gruppo; fumo e bollicine coi disegnatori di oggi sul riquadro derivato
  (bollicine con clipPath); intensità = più sbuffi/bolle, fiamma più alta. `prefers-reduced-motion` ferma anche SMIL
  (oggi no). Animati solo con `!isEditMode || previewEffects`.
- **LVGL** (`simbolo_lib.rs`): bagliore = alone pre-sfocato del solo gruppo; fiamma = fotogrammi del gruppo
  trasformato; fumo/bollicine = fotogrammi come oggi sul riquadro derivato; tutto nel budget `ANIM_BUDGET_DEFAULT`.
  L'intensità su LVGL: 3 livelli di fotogrammi al più (dichiarato nel manuale).
- **Editor**: «Raggruppa» (Ctrl+G) / «Separa» (Ctrl+Shift+G); un clic seleziona il gruppo, doppio clic entra nel
  gruppo; il gruppo nella lista strati è una riga richiudibile; sposta/ridimensiona/ruota il gruppo intero;
  «Ritaglia con la forma» (foto + forma selezionate) e «Togli ritaglio»; `matrixOps` trasforma anche `clip`.
  **Effetti visibili nella scheda Prova** (oggi non lo sono): controlli per ogni ingresso, anche quelli degli effetti.
- Schema dell'IA (`ai/tools.rs`) aggiornato: gruppi, `Ingresso`, `Effetto`, `clip`; `synoptic_schema` rigenerato.
- `.swsym` e libreria aziendale portano i campi nuovi senza modifiche (sono la descrizione).

## D. Colonna destra = ispettore della selezione (`feat/symbol-inspector`)
- Le schede Pezzo/Struttura spariscono: la colonna segue la selezione (`sel`, `SymbolEditor.tsx:139`).
  - **Niente selezionato** → il simbolo: Nome e categoria, Misura, Materiale del corpo, Ingressi (elenco, rinomina,
    aggiungi), Bocche, **IA** (`AiPanel`, `AiPhoto`).
  - **Forma / gruppo / più forme** → sezioni solo se pertinenti: Posizione e misura, Ruota e allinea (+ «Riempi il
    riquadro»), Aspetto (riempimento, contorno), **Movimento** (oggi «Animazione»: gira/scorre/lampeggia con un
    ingresso), **Effetti** (aggiungi bagliore/fiamma/fumo/bollicine, ingresso, condizione, intensità, colore),
    **Maschera** (foto: «Ritaglia con la forma»), **Cambia con un ingresso** (foto: righe «quando … → questa foto» con
    anteprima; l'editor crea lo strato Signal da sé, `SignalEntries` riusato), Strato e ordine.
  - **Uno strato** (clic sulla riga) → le sue proprietà (nome, tipo di parte, ingresso).
  - **Una bocca** → `PortProps`.
- **Prova** diventa un interruttore della barra («Prova»): la colonna mostra `TryProps`, con gli effetti.
- Sezioni richiudibili che ricordano lo stato (`useSezioneAperta`), larghezza già ridimensionabile.
- `SymbolEditor.tsx` (1957 righe) si spezza: `inspector/` con un file per sezione; test vitest dell'ispettore
  (cosa compare per forma, foto, gruppo, niente).

## E. Editor dei simboli in una finestra staccata (`feat/symbol-editor-window`)
- Entrata Vite nuova `index-symbols.html` → `symbols-main.tsx` (`avvia()`), come chat e registro (`vite.config.ts:98`);
  apertura con `apriFinestra` (`src/apriFinestra.ts`), nome di finestra per simbolo; **di default staccato**, «Apri
  qui» come alternativa; l'IDE ricorda l'ultima scelta (localStorage); finestra bloccata → si apre dentro come oggi.
- **Il ponte** come la chat (`ai/ponte.ts`, `BroadcastChannel("sws.symbols.ponte.v1")`): la finestra è solo
  interfaccia; **letture e scritture passano dall'IDE**, che resta padrone dello store, del lock e della versione
  (`If-Match`): messaggi `ciao/stato` (simboli del progetto, pagine che usano il simbolo, attacchi), `salva`
  (→ `writeSymbols` + correzioni di tubi e `symbol_parts` sulla pagina, oggi in `open.ts`/`SymbolEditor.tsx:874-955`),
  `esito`, `ide-chiuso`. Salvando, le pagine aperte nell'IDE si aggiornano subito (lo fa già `avviaSincroniaSimboli`).
- Nella finestra: «Riporta nell'IDE»; con l'IDE chiuso, avviso e salvataggio disabilitato.
- Le dipendenze dallo store di `SymbolEditor` passano da un adattatore (store dentro / ponte fuori). Vitest del ponte.

## F. CasaDomotica, rc.29, pubblicazione
- **CasaDomotica sul VPS** (permesso dato): backup prima; Home: «Benvenuto {{user.name}} — ultimo accesso
  {{user.last_login}}»; `tapparelle_tutte` con ruolo minimo Viewer; la stufa/caldaia con la fiamma come proprietà
  (blocco C); configurazione LDAP del test 10 **no** (la mette il maintainer: è il test). Niente `podman restart` del
  container di progetto. Deploy sul TC620 dal cloud.
- **rc.29**: ~8:00, `release/2.26` → versione `chore(rc)` (HOWTO §19, `scripts/build_rc.sh`), push di `release/2.26`,
  `main` (cherry-pick) e del tag (permesso dato), immagini su ghcr, gateway VPS e CasaDomotica sulla rc.29, Tiny TY
  `latest`, **TC620 aggiornato alla rc.29** (permesso dato: con l'aggiornamento del pannello, che prende l'istantanea;
  se dal cloud non si può, `ricarica.sh --canale rc` dopo `--prova`, dicendolo).
- `NOVITA.yaml` (it/en, tutte le voci: versione -rc) e `CHANGELOG.md` per ogni blocco; `STATUS.md` con «Il collaudo,
  cosa guardare» per la mattina (incluso il test 10 LDAP e il test 11 effetti rifatti), `deploy/vps/STATO.md`.

## Verifica (ogni blocco, prima dello squash)
`cargo check`, `cargo test`, `pnpm build`, `pnpm exec vitest run`, `./scripts/check_static.sh` (in particolare
`check_synoptic_schema`, `check_lvgl_parity`, `check_i18n_parita`, `check_testi_sistema`, `check_simboli_lvgl`,
`check_novita`, `check_rotte_preauth`), tutti verdi. Prova a mano su un runtime di prova dichiarato (porta 8661,
terminato a fine prova) con un progetto in `tmp/`: segnaposto con utente locale e anonimo, funzione col ruolo,
effetti e maschera nell'editor e in Prova, finestra staccata col salvataggio che aggiorna la pagina. La conferma del
maintainer domattina con `/test-changes` sulla rc.29.
