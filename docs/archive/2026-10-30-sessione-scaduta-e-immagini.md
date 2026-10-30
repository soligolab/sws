# Due difetti dal collaudo del 30-10-2026: «Session expired» e lo sfondo della planimetria

> **Fatto il 30-10-2026** su `feat/registrazione-e-pin`, **confermato dal maintainer** lo stesso giorno («i due punti
> che ti avevo indicato sono risolti»); archiviato. Due scostamenti dal testo qui sotto, decisi
> scrivendo il codice: `refresh_session` cerca il token nei tre archivi in fila, come `logout`, invece di passare da
> `fonte_auth_corrente` (un token sta in un archivio solo, e così le due rotte si leggono uguali). E il modale ha una
> sua casella «ricordami» invece di «tenere la scelta di prima»: a sessione scaduta quella scelta non si sa più.

## Contesto

Collaudo del maintainer sull'IDE 8460, punta di `feat/registrazione-e-pin`:

1. Login col PIN riuscito; aperto `specchio-prova` → modale «Session expired», che non si aspettava.
2. «Genera sfondo» della planimetria: il PNG c'è (`images/planimetria-cucina.png`, 1920×1080) e la pagina lo
   punta (`sfondo_immagine: /api/project/images/planimetria-cucina.png`), ma sul canvas al suo posto compare un
   segnaposto grande quanto la pagina.

## Cause misurate

### 1. «Session expired»: il rinnovo chiede all'archivio sbagliato

- `POST /api/auth/refresh` (`refresh_session`, `sws-web/src/router.rs:3014`) chiama solo
  `s.auth.touch(token)`, cioè gli utenti **del progetto**. Un token dell'IDE è dell'archivio
  `sws-identita` → **401 sempre** → `sws:session-expired` → `ReAuthModal`.
- Il rinnovo parte da `App.tsx:476`: `setTimeout(expiresAtMs - now - 5 min)`. Con «ricordami» la sessione dura
  30 giorni, il ritardo vale ~2,59·10⁹ ms, oltre il massimo di `setTimeout` (2³¹-1 ≈ 24,8 giorni). Il timer
  scatta **subito**. Il 401 arriva quindi appena dopo il login.
- Il modale si vede solo nell'editor (`App.tsx:1133`). Per questo è comparso all'apertura del progetto.
- Il log conferma: login alle 08:49:03, progetto aperto alle 08:49:58, un secondo login alle 08:50:22. Quel login
  ha **chiuso il progetto** (`entra` chiude sempre il progetto attivo), che si è riaperto alle 08:50:24.
- Il difetto c'è **già su `main`**, con la password: senza «ricordami» il rinnovo scatta dopo 7 h 55 e prende lo
  stesso 401. «Ricordami» lo ha solo reso immediato.
- Anche sul pannello: l'Admin nato dall'abbinamento sta in `auth_dispositivo`, che `refresh_session` non guarda.
- Correggere solo il server non basta: il rinnovo riuscito restituirebbe di nuovo 30 giorni. L'effetto
  ripartirebbe, scatterebbe subito di nuovo, e il rinnovo andrebbe in **ciclo continuo**.

### 2. Lo sfondo della planimetria: l'immagine chiede la sessione e `<image>` non la manda

- `curl http://localhost:8460/api/project/images/planimetria-cucina.png` senza token → **401**.
- `ImmagineSvg.tsx` (`serveScaricare`) scarica con la sessione e disegna da un `blob:` **solo nel cloud**
  (prefisso del gateway o schermo remoto). Il commento del 25-10 dice «in locale l'IDE non si autentica»: è falso
  da quando l'IDE ha i suoi utenti. In locale l'`<image href>` va diretto e prende 401.
- È lo stesso difetto corretto il 25-10 per il cloud (`c921ebd0`), come ha intuito il maintainer. Non riguarda
  solo la planimetria: vale per **ogni** immagine del progetto sul canvas dell'IDE locale.
- Difetto minore, stesso giro: `GeneraSfondo` (`PlanimetriaEditor.tsx:348`) non chiama `dimenticaImmagine(r.url)`
  dopo il caricamento, come fa invece `CampoSfondoArea`. Rigenerando con lo stesso nome, nel cloud resterebbe la
  copia vecchia.

## Modifiche

Commit sul ramo attuale `feat/registrazione-e-pin`: è la punta della catena, e «ricordami» è nato lì.

1. **`refresh_session`** (`router.rs`): sceglie l'archivio con `fonte_auth_corrente`, come fa il middleware.
   - `Installazione` → `identita`: serve un metodo che rinnovi e **restituisca la scadenza**. In `sws-identita`,
     `valida` diventa un sottile involucro di un nuovo `valida_con_scadenza(token) -> Option<(Utente, u64)>`, che
     calcola già `nuova_scadenza` a `lib.rs:~867`.
   - `Progetto` → `s.auth.touch(token)`, e in mancanza `s.auth_dispositivo.touch(token)`.
   - Altre fonti → 401, come oggi.
2. **`App.tsx:476`**: il ritardo si limita, per esempio `Math.min(…, 24 h)`. Scaduto il limite si rinnova e il
   timer riparte con la nuova scadenza. Niente più scatto immediato, niente ciclo.
3. **Modale di riautenticazione, con password o PIN** (scelta del maintainer, vedi «Decisione»):
   - `ReAuthModal.tsx` offre un collegamento «Entra con un PIN via e-mail» quando `/api/identita/stato` dice
     `pin: true`. Riusa `AccessoPin`, con l'indirizzo già compilato (`emailIniziale = authUser`). Per «ricordami»
     tiene la scelta del login di prima.
   - **Il progetto resta aperto se rientra la stessa persona.** Il corpo di `/api/auth/login` e di
     `/api/auth/pin/accesso` prende un campo nuovo, `riautentica: true`, che manda solo il modale.
   - `entra` salta `close_project` solo se `riautentica` è vero **e** l'email è quella di chi ha aperto il
     progetto. Per saperlo, `AppState` memorizza chi apre il progetto attivo (scritto in `open_project`,
     `projects.rs:1598`, azzerato alla chiusura).
   - Il login dalla schermata d'accesso continua a chiudere il progetto, com'è dal 07-10. Un'altra persona
     continua a non ereditare il progetto aperto. Se l'email non coincide, il progetto si chiude e il frontend
     passa alla schermata «nessun progetto attivo» (`noProject` del modale).
4. **`ImmagineSvg.tsx` / `serveScaricare`**: si scarica con la sessione anche quando c'è un token vero
   (`getAuthToken()` presente e diverso da `"no-auth"`), non solo nel cloud. Va aggiornato il commento di testa.
   Con un token vero ogni immagine `/api/…` passa dal `blob:`. Senza token resta tutto com'è (pannello, viewer
   anonimo).
5. **`PlanimetriaEditor.tsx:348`**: `dimenticaImmagine(r.url)` prima di `aggiornaPagina`.

## Test

- Rust (`router.rs`, con `stato_di_prova` di `test/socket-riconvalida`):
  - un token dell'IDE rinnovato prende 200 e una scadenza nel futuro;
  - un token «ricordami» prende circa +30 giorni;
  - un token inventato prende 401.
- vitest:
  - il ritardo del rinnovo con una scadenza a 30 giorni è ≤ 24 h;
  - `serveScaricare` è vero con un token vero ed è falso con `"no-auth"` o senza token.

## Verifica

- `cargo check`, `cargo test`, `pnpm build`, `pnpm exec vitest run`, `./scripts/check_static.sh`.
- IDE 8460 ricompilato (`riavvia-ide.sh`, marchio Pixsys).
- Il maintainer:
  - entra col PIN e con «ricordami», apre `specchio-prova`: nessun modale;
  - vede la planimetria come sfondo della pagina «Specchio»;
  - rigenera lo sfondo e vede quello nuovo senza ricaricare la pagina.

## Decisione

30-10-2026, il maintainer: nel modale **password o PIN**. Se a rientrare è la stessa persona, il progetto resta
aperto.

Test in più:
- Rust: un login con `riautentica` della stessa persona non chiude il progetto; un login con `riautentica` di
  un'altra persona lo chiude; un login senza `riautentica` lo chiude.
- vitest: il modale mostra il collegamento al PIN solo se `/api/identita/stato` dice `pin: true`.
