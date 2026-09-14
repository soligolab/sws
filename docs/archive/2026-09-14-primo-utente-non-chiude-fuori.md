# Creare il primo utente non deve chiudere fuori chi lo sta creando

> **Esito, 14-09-2026 — realizzato, confermato dal vivo e su `main`.** Tutti e quattro i passi
> fatti; la scheda aperta è **Q56**. Conferma del maintainer con `users.yaml` al suo posto e
> l'unico account un Operator — cioè esattamente la condizione che prima chiudeva fuori: «ora il
> progetto WP630 si apre».
>
> Scostamenti dal piano, dichiarati:
> - **Nessuna variante nuova in `UserError`.** La guardia vive nel handler e costruisce lì il 409,
>   sulla forma di `user_error_to_response`: aggiungere un caso a `sws-auth` avrebbe portato dentro
>   l'autenticazione un concetto che è di `sws-web` (l'esistenza degli IDE), che è proprio ciò che
>   il passo 2 voleva evitare.
> - **Il messaggio non è una riscrittura del titolo del modale**, perché nel caso del guasto il
>   modale non compare più affatto. L'avviso è sulla schermata di accesso
>   (`LoginScreen`, prop `motivo`), dov'è l'utente dopo la correzione.
> - **In più**, non previsto: la scheda Utenti traduce anche il 409 nuovo, altrimenti sarebbe
>   finito nel ramo «l'utente esiste già», che dice il falso.
>
> Guardia: `scripts/check_primo_utente.sh`, registrata in `check_static.sh` fra le `CON_STACK`.
> Provata rossa ripristinando le due decisioni vecchie: riproduce il guasto esatto — 401 sull'IDE
> subito dopo la creazione.

Ramo `fix/primo-utente-non-chiude-fuori`, da `main`.

## Contesto

Il maintainer, nell'IDE locale su un progetto senza utenti, ha creato **un** utente (`user`,
Operator) dalla scheda Configurazione → Utenti. L'editor ha risposto **«Sessione scaduta»**, e da
quel momento il progetto `TestWP630` è **inaccessibile**: l'unico account è un Operator, e
`canConfigureProject` (`sws-editor/src/auth/permissions.ts:13`) vuole Supervisor o Admin. Il seed
di recupero non aiuta — `applica_seed_di_recupero` (`sws-auth/src/lib.rs:294`) entra **solo se il
risultato sarebbe zero utenti**, ed è una scelta giusta per il dispositivo che qui toglie l'unica
rete.

**La catena, verificata nel codice.** La modalità no-auth non è uno stato salvato: è ricalcolata a
ogni richiesta da `has_users()` (`lib.rs:481`), letta in cima a `require_auth`
(`router.rs:1106-1117`) e `optional_auth` (`router.rs:1223-1232`), che iniettano un Admin
sintetico. Quindi:

1. la `POST /api/auth/users` entra ancora in no-auth → passa;
2. `create_user` inserisce l'utente (`lib.rs:662`) — **da quell'istante** l'istanza è autenticata;
3. la risposta è 200: l'utente **è stato creato davvero**;
4. il `GET /api/auth/users` subito dopo (`ConfigView.tsx:5992`) presenta il token sentinella
   `"no-auth"`, che lato server **non è mai esistito** — è inventato dal frontend
   (`App.tsx:408`, `:573`, `useAccessoSenzaUtenti.ts:26`) → `validate` non lo trova → **401**.

E il modale di ri-autenticazione **non può riuscire**: `ReAuthModal` usa come username quello in
sessione (`ReAuthModal.tsx:79`, campo non editabile a `:147`), cioè `admin` — l'utente
**sintetico**, che in `users.yaml` non c'è. Qualunque password dà credenziali errate.

L'obiezione del maintainer è il punto: *«sarebbe un utente per il dispositivo target, non per
l'IDE»*. Oggi `users.yaml` è per-progetto e lo **stesso elenco** governa il dispositivo e il
runtime dell'IDE che tiene quel progetto aperto (`projects.rs:766`, `main.rs:566`). Un elenco, due
consumatori, nessuna distinzione.

**Due decisioni prese dal maintainer il 2026-09-14:**

1. **Su un'istanza IDE la porta admin resta in no-auth.** `users.yaml` continua a viaggiare col
   deploy e a governare il **dispositivo**; non chiude più fuori dall'editor. Il runtime sa già di
   essere un IDE: `AppState.ide_only` (`router.rs:95`), vero quando manca `--viewer-port`.
2. **Guardia in `create_user` sulle istanze non-IDE**: a zero utenti, il primo account dev'essere
   un Admin. È simmetrica al rifiuto che esiste già dall'altro lato — `replace_users_file`
   respinge una lista vuota «per non lasciare il dispositivo senza account»
   (`projects.rs:1718`).

## Passo 0 — sbloccare, e mettere il piano nel repo

`mv ~/sws/.run-editor/projects/TestWP630/users.yaml /tmp/users-TestWP630.yaml` a editor fermo: il
file va **spostato, non cancellato** (contiene il lavoro). Questo piano va in
`docs/plans/2026-09-14-primo-utente-non-chiude-fuori.md` e si committa.

## Passo 1 — l'IDE non si autentica

Una funzione pura in `sws-web/src/router.rs`, accanto ai due middleware:

```rust
/// L'istanza deve trattare questa richiesta come no-auth?
pub fn senza_autenticazione(ide_only: bool, ha_utenti: bool) -> bool
```

`ide_only` vince sempre; altrimenti vale `!ha_utenti`, cioè il comportamento di oggi. I due
`if !s.auth.has_users().await` di `require_auth` e `optional_auth` la chiamano, e **restano gli
unici due punti** che decidono — oggi la regola è duplicata in due `if` identici, e questa è
l'occasione per non triplicarla.

Test puri: IDE con utenti → no-auth; IDE senza → no-auth; runtime con utenti → autenticato;
runtime senza → no-auth. È il primo che conta, ed è il caso che oggi non esiste.

## Passo 2 — il primo account di un dispositivo dev'essere un Admin

Nel **handler** `create_user` (`router.rs:1460`), non nel crate `sws-auth`: la guardia dipende da
`ide_only`, che è di `sws-web`, e l'autenticazione non deve sapere che esistono gli IDE.

```rust
/// Rifiutare questa creazione perché lascerebbe l'istanza senza nessuno che
/// possa amministrarla?
pub fn primo_utente_non_amministratore(ide_only: bool, ha_utenti: bool, ruolo: Role) -> bool
```

Vero solo quando `!ide_only && !ha_utenti && ruolo != Admin`. Risposta **409** con un `error`
parlante (`primo_utente_non_admin`) e un `detail` che dice cosa fare — sulla forma di
`user_error_to_response` (`router.rs:1563`), dove `LastAdmin` è già un 409 con lo stesso spirito.

Sull'IDE la guardia **non** scatta: lì gli utenti non governano niente, e impedire di creare un
operatore prima di un admin sarebbe una regola senza scopo.

## Passo 3 — l'editor smette di mentire

Tre cose, tutte piccole, tutte nel punto in cui oggi si dice il falso:

- **`ReAuthModal` che non può riuscire.** Con lo username in sessione uguale a `admin` sintetico —
  cioè quando il token è `"no-auth"` — il modale non deve nemmeno comparire: si va dritti al
  `LoginScreen`, che lo username lo fa scrivere. Il controllo è lo stesso già in uso,
  `authToken === "no-auth"`.
- **Il messaggio.** Dopo un 401 su `/api/auth/users` in quel frangente, «Sessione scaduta» è
  falso: la sessione non è scaduta, **l'autenticazione si è accesa adesso**. Va detto così.
- **La scheda Utenti dichiari a chi servono.** Una riga sopra l'elenco: questi account vivono in
  `users.yaml` **dentro il progetto**, viaggiano col deploy e governano il **dispositivo**;
  l'IDE locale non li usa. Oggi la scheda dice dove stanno (`ConfigView.tsx:6062`) ma non **per
  chi** sono, ed è esattamente l'informazione che mancava.

## Passo 4 — la conseguenza che resta, in `OPEN_QUESTIONS`

Il passo 1 ha un prezzo dichiarato: **un IDE raggiungibile in rete non ha password**, e da ora in
modo permanente invece che solo finché non si definiscono utenti. Sulla macchina del maintainer è
`localhost`; su un host esposto no. Non si decide qui: si aggiunge **Q56** (l'ultima è Q55,
verificato il 2026-09-14) imparentata con **Q44**, che già dice — riga 237 — che in uno scenario ospitato gli utenti
«devono stare **sopra** i progetti», e con **Q54** (un dispositivo che crea utenti propri), che
guarda il verso opposto. `Decided: not yet`, regola 3 di `CLAUDE.md`.

## File coinvolti

- `sws-runtime/crates/sws-web/src/router.rs` — le due funzioni pure, i due middleware, il handler
  `create_user`, `user_error_to_response`
- `sws-editor/src/App.tsx`, `src/components/ReAuthModal.tsx`, `src/config/ConfigView.tsx`
  (scheda utenti), `src/i18n/{it,en}.json`
- `docs/OPEN_QUESTIONS.md`, `STATUS.md`, `CHANGELOG.md`

## Verifica

`cargo test --workspace`, `cargo clippy -- -D warnings`, `cargo fmt --check`; `pnpm test`,
`pnpm build`, `npx tsc --noEmit`, `npx eslint`; `./scripts/check_static.sh`.

**Una guardia che provi la catena, non i pezzi** — è la forma di difetto che questa settimana è
passata tre volte: `scripts/check_primo_utente.sh`, su due runtime veri avviati dallo script.

1. Istanza **IDE** (`--admin-port` senza `--viewer-port`): creare un Operator come primo utente →
   201, e la richiesta **successiva** senza token valido continua a rispondere 200. È il caso del
   maintainer, e oggi fallirebbe con 401.
2. Istanza **runtime** (con `--viewer-port`): creare un Operator come primo utente → **409**, e
   `users.yaml` **non** creato. Poi crearne uno Admin → 201.
3. Provata rossa rimettendo `!s.auth.has_users().await` al posto della funzione nuova.

A mano, con `./scripts/start_editor.sh`: riaprire `TestWP630` dopo aver rimesso al suo posto
`users.yaml` — l'IDE deve aprirlo **senza chiedere niente**, e la scheda Utenti deve mostrare
`user`/Operator, modificabile. Poi un deploy su un dispositivo vero (`user@wp630-a-p3-07a077.local`
è disponibile in questa sessione) per verificare che sul **pannello** quegli utenti valgano ancora,
cioè che la separazione sia davvero fra IDE e dispositivo e non fra IDE e progetto.

## Rischi dichiarati

- **L'IDE senza password è una regressione di sicurezza in uno scenario ospitato**, non su
  `localhost`. È la decisione del maintainer, il prezzo è scritto qui e la scheda del passo 4
  esiste perché non venga dimenticato quando Q44 tornerà sul tavolo.
- **Un progetto già «armato» resta tale per un dispositivo**: questo lavoro non tocca
  `users.yaml`, toglie solo l'IDE dai suoi consumatori. `TestWP630` continuerà a chiedere il login
  **sul pannello**, che è ciò che il maintainer voleva.
- **La guardia del passo 2 cambia un comportamento esistente sui dispositivi**: chi oggi crea un
  primo Operator via API riceverà un 409 dove prima riceveva un 201. È il punto, ma va nel
  CHANGELOG come cambiamento di comportamento, non come correzione silenziosa.
