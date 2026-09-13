# Q36 — `min_role` non esiste sul pannello LVGL

> Trasferito da `docs/OPEN_QUESTIONS.md` (Q36) il 2026-09-12, aperta il 2026-09-05.
> **Decisa dal maintainer il 2026-09-12: opzione 3, una sessione vera nel client LVGL.**
> **Non confondere con** `docs/plans/2026-09-12-ruolo-minimo-avviso-noauth.md`: quello è
> l'avviso nell'editor per il caso no-auth sul motore **web**, già deciso e pronto da
> costruire. Questa scheda è diversa e più grande: il motore **LVGL** non ha alcun concetto
> di sessione, con o senza auth.

## Decisa (2026-09-12, maintainer): opzione 3 — una sessione vera nel client LVGL

Il pannello smette di essere anonimo per costruzione: mostra una schermata di login,
autentica contro lo stesso `/api/auth/login` del web, tiene il token e lo allega alle
scritture, e applica lo stesso gate `min_role`/`min_role_effect` del browser.

### Fattibilità verificata nel codice prima di scrivere il disegno

- **La tastiera virtuale regge testo e password**: `lvgl-sys` espone
  `LV_KEYBOARD_MODE_TEXT_LOWER`/`TEXT_UPPER` (oggi il pannello usa solo `MODE_NUMBER`, per il
  setpoint) e `lv_textarea_set_password_mode`/`_password_bullet`/`_password_show_time` esistono
  già nel binding — **non manca nulla lato libreria** per un form utente/password a schermo.
  Il dubbio aperto nella scheda originale ("che tastierino userebbe?") è quindi risolto: la
  stessa infrastruttura `lv_keyboard` già in uso per il setpoint numerico
  (`lvgl_render.rs:4537-4700`), in modalità testo.
- **`client::put_tag`** (`sws-lvgl-viewer/src/client.rs:303`) non prende alcun parametro di
  autenticazione — conferma diretta che oggi ogni scrittura è anonima. Chiamato da due soli
  punti, entrambi in `main.rs` (righe 691, 962).
- **Altre due scritture nello stesso crate** hanno lo stesso problema e vanno nello stesso
  lotto: `client::apply_recipe` (POST, riga 92-104) e `client::ack_alarm` (POST, riga
  869-881). Tre funzioni in tutto da far passare per il token, non una.
- **Il pannello non sa oggi se il runtime ha utenti definiti**: non esiste nel crate una
  chiamata a `/api/system` (dove vive `auth_required`, `sws-web/src/system.rs:116`). Va
  aggiunta una `client::fetch_system()` per saperlo all'avvio, sul modello delle altre
  `fetch_*` in `client.rs`.
- **Riferimento di forma per lo stato di sessione**: `sws-editor/src/store/index.ts` tiene
  `authToken`, `authUser`, `authRole`, `mustChangePassword`, `expiresAtMs`, persistiti in
  `localStorage` sotto `AUTH_KEY = "sws.auth"` con un controllo di scadenza al rilancio (riga
  ~98: se `Date.now() >= expires_at_ms`, scarta il token persistito). È la forma di riferimento
  per uno `struct SessionState` lato Rust — non lo stesso codice, stesso concetto.
- **Riferimento per il gate da portare**: `ROLE_RANK`/`isRoleAllowed()` in
  `SvgCanvas.tsx:481-487`, usato come `if (!inEdit && !roleOk && obj.min_role_effect ===
  "hide") return null;` (riga ~1686). Da rifare in Rust confrontando `Role` (già un `enum`
  ordinato in `sws-auth`, derivabile via `PartialOrd`/`Ord` — nessun bisogno di reinventare la
  mappa `ROLE_RANK`, basta `role >= min_role`) dentro `lvgl_render.rs`, nello stesso punto dove
  oggi si decide se disegnare un oggetto.

### Disegno, ancora aperto su tre punti — vedi «Domande al maintainer»

- **Login**: schermata dedicata con `lv_textarea` (utente) + `lv_textarea` in
  `password_mode(true)` (password) + `lv_keyboard` in `MODE_TEXT_LOWER`, POST a
  `/api/auth/login` via un nuovo `client::login(base_url, username, password) ->
  anyhow::Result<LoginOk>` (stessa forma di `sws-auth::LoginOk`: token, username, role,
  expires_at_ms).
- **Stato**: un `SessionState { token: Option<String>, username: Option<String>, role:
  Option<Role>, expires_at_ms: Option<u64> }` condiviso (stesso meccanismo di condivisione già
  usato per `SharedAlarms`/le altre strutture `Arc<Mutex<..>>` del crate), letto da
  `put_tag`/`apply_recipe`/`ack_alarm` (aggiungerebbero un header `Authorization: Bearer` se
  presente) e da `lvgl_render.rs` per il gate `min_role`.
- **Gate**: in `lvgl_render.rs`, nello stesso punto in cui un oggetto viene costruito/aggiornato
  a schermo, saltare la creazione (effetto "hide") o disabilitare l'input (effetto "disable",
  se esiste già un pattern di widget disabilitato nel crate — da verificare, es. per i tag in
  errore) quando `role < min_role`.

### Le tre domande, decise dal maintainer il 2026-09-12

1. **Trigger del login**: **anonimo di default, login su richiesta** (non all'avvio). Il
   pannello si apre come oggi; un controllo persistente a schermo (icona in un angolo, sempre
   presente) apre la schermata di login quando toccato. Corollario simmetrico col punto 3
   (logout esplicito): lo stesso controllo, da loggato, mostra utente/ruolo correnti e fa da
   pulsante di logout — un solo widget con due stati, non due controlli separati. Da confermare
   in fase di costruzione se la posizione va bene (proposta: angolo in alto, sovrapposto a
   tutte le pagine, sullo stesso livello del layer allarmi/notifiche se esiste).
2. **Durata della sessione**: **il token sopravvive al riavvio del processo**, salvato su
   disco. Percorso naturale: `~/.config/sws/lvgl_session.json`, stessa cartella già in uso per
   la chiave IA (`~/.config/sws/kimi.key`, vedi memoria di macchina) — non un percorso nuovo,
   un file in più nella stessa convenzione. Contiene `token`, `username`, `role`,
   `expires_at_ms`; letto all'avvio, scartato se scaduto (stesso controllo già fatto
   dall'editor in `store/index.ts:98`).
3. **Logout**: **sì, pulsante dedicato** — vedi punto 1, stesso widget del login.

### File coinvolti

- `sws-lvgl-viewer/src/client.rs`: nuovo `login()` (POST `/api/auth/login`), nuovo
  `fetch_system()` (per sapere `auth_required` — utile a decidere se mostrare il controllo di
  login o nasconderlo quando il runtime non ha utenti), `put_tag`/`apply_recipe`/`ack_alarm`
  che accettano un token opzionale e aggiungono `Authorization: Bearer` quando presente.
- `sws-lvgl-viewer/src/main.rs`: `SessionState` condiviso, lettura/scrittura di
  `~/.config/sws/lvgl_session.json` all'avvio e ad ogni login/logout, passaggio del token ai
  tre call-site di scrittura (righe attuali 691, 962 per `put_tag`, più i corrispondenti per
  `apply_recipe`/`ack_alarm`).
- `sws-lvgl-viewer/src/lvgl_render.rs`: schermata di login (`lv_textarea` × 2, una in
  `password_mode(true)`, + `lv_keyboard` in `MODE_TEXT_LOWER`, sul modello del
  form numerico già esistente a righe 4537-4700); widget persistente login/logout; il gate
  `min_role`/`min_role_effect` nel punto dove un oggetto viene costruito/aggiornato, con
  `role >= min_role` da `sws-auth::Role` (già `Ord`).
- `sws-lvgl-viewer/src/model.rs`: i due campi `min_role`/`min_role_effect` già dichiarati,
  nessuna modifica di schema qui — il gap era solo nel motore di rendering.

### Verifica

1. `cargo check`/`cargo build` verdi per `sws-lvgl-viewer`.
2. Login da schermo con un utente vero, verificare che `put_tag` porti l'header
   `Authorization` (log lato server o tcpdump) e che una scrittura sotto `min_role` che prima
   falliva ora passi.
3. Un oggetto con `min_role: Admin` e `min_role_effect: hide` sparisce/si disabilita sul
   pannello quando il ruolo loggato è sotto, esattamente come nel browser.
4. Riavvio del processo `sws-lvgl-viewer`: la sessione resta valida senza richiedere un nuovo
   login (finché non scaduta).
5. Logout dal pulsante dedicato: il pannello torna anonimo, le scritture gated tornano a
   fallire come oggi.

Branch: `feat/Q36-sessione-lvgl`. Stima: il lotto più grande fra le questioni "pronte" di
questa sessione — nuova schermata LVGL, tre funzioni di rete da modificare, stato persistito
su disco, gate di rendering nuovo. Da valutare se spezzare in due branch (sessione+login prima,
gate `min_role` dopo) quando si prende in mano.

## Il problema

`grep min_role` su `sws-lvgl-viewer/src/` dà solo le dichiarazioni di campo in `model.rs`:
`lvgl_render.rs` non le usa mai. Un oggetto `min_role: Admin` sul pannello si disegna e riceve
tocchi come qualunque altro, mentre nel browser verrebbe nascosto o reso inerte.

**Non è un buco di sicurezza** — l'enforcement vero è per-tag (`TagDef.write_min_role`,
verificato dal server), e `min_role` sugli oggetti è dichiarato "UX, non un confine di
sicurezza" (`sws-core/src/project.rs:79`). È una **UX di sicurezza che sul pannello non
esiste**: con utenti definiti, un client LVGL è un Viewer anonimo e si vede respingere *tutte*
le scritture (non solo quelle sotto `min_role`), con un fallimento muto per chi tocca lo
schermo — un'esperienza peggiore, non un rischio.

## Opzioni, dalla più piccola alla più grande

1. **Lasciare il gap, dichiarato** — già fatto: il commento accanto ai due campi in `model.rs`
   dice che sono conosciuti e non resi. Zero lavoro in più.
2. **Un ruolo da configurazione del pannello**: il viewer LVGL nasce con un ruolo dichiarato nel
   suo file di avvio e applica gli stessi gate del browser. Piccolo, ma è un ruolo *del
   dispositivo*, non di chi lo tocca in quel momento.
3. **Una sessione vera nel client LVGL**, oggi anonimo per costruzione. Il lavoro grosso — tira
   dentro l'autenticazione su un pannello senza tastiera (che tastierino virtuale userebbe?).

**Default per il PoC**: opzione 1 (stato attuale).

## Prossimo passo

Chiedere al maintainer se il caso reale che ha fatto emergere la domanda giustifica l'opzione 2
(un ruolo di dispositivo dichiarato all'avvio) — è il gradino di mezzo, non richiede
autenticazione vera sul pannello ma darebbe comunque un gate coerente con la UX del browser.

## File coinvolti (solo se si sceglie 2 o 3)

`sws-lvgl-viewer/src/model.rs` (i due campi già dichiarati), `sws-lvgl-viewer/src/lvgl_render.rs`
(dove applicare il gate), il file/flag di avvio del viewer (opzione 2) o un meccanismo di sessione
nuovo (opzione 3, molto più grande — da non sottovalutare in stima).

---

## Testo originale della scheda (spostato da `docs/OPEN_QUESTIONS.md` il 2026-09-12)

## Q36 — `min_role` non esiste sul pannello LVGL

*Aperta il 2026-09-05. Il sospetto era scritto in `docs/archive/2026-08-21-scada-widgets.md:122-126`
(«il viewer LVGL ha il concetto di ruolo? verificare») e la verifica non era mai stata fatta.
Adesso è fatta.*

`grep min_role` su tutto `sws-lvgl-viewer/src/` dà **due righe**: le dichiarazioni di campo in
`model.rs`. `lvgl_render.rs` non le menziona mai, e nel crate non esiste alcun concetto di ruolo.
Un oggetto `min_role: Admin` viene disegnato sul pannello come qualsiasi altro, con i suoi handler
di tocco registrati, mentre **nel browser** viene nascosto o reso inerte
(`SvgCanvas.tsx`, gate `min_role_effect`).

Non è un buco di sicurezza, ed è importante dire perché: l'enforcement vero è **per-tag**,
`tag_write_allowed` applica `TagDef.write_min_role` lato server, e la divisione è già dichiarata in
`sws-core/src/project.rs:79` — *«è l'enforcement che il server può davvero garantire — il min_role
degli oggetti è UX»*. È una **UX di sicurezza che sul pannello non esiste**. L'esito pratico
dipende dalla modalità auth: senza utenti definiti il client LVGL passa per Admin sintetico e
l'oggetto è operabile; con utenti definiti è un Viewer anonimo e gli vengono respinte **tutte** le
scritture, non solo quelle sotto `min_role`, con un fallimento muto per chi tocca lo schermo.

**Options**

1. **Lasciare il gap, dichiarandolo** (fatto: il commento accanto ai due campi in `model.rs` dice
   che sono conosciuti e non resi, come prescrive la policy in testa a quel file).
2. **Un ruolo da configurazione del pannello**: il viewer LVGL nasce con un ruolo dichiarato nel
   suo file di avvio e applica i gate come il browser. Piccolo, ma è un ruolo *del dispositivo*,
   non di chi lo tocca.
3. **Una sessione vera nel client LVGL**, che oggi è anonimo per costruzione. È il lavoro grosso, e
   tira dentro l'autenticazione su un pannello senza tastiera.

**Default for PoC**: opzione 1. **Decided**: not yet.
