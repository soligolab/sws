# Login rifiutato sulla porta admin 8444 dopo l'aggiornamento SWS

> Copia committata del piano approvato l'11-09-2026: la verifica riprende in un'altra
> sessione (ufficio), il piano originale in `~/.claude/plans/` è per-macchina e non
> ci sarebbe arrivato.

## Contesto

Dopo l'aggiornamento del runtime sul TC620 (`tc620-a-p3-c6-07aff9.local`), il pannello
editor "Connessione runtime remoto" rifiuta utente `user` / password con:

> credenziali rifiutate da http://tc620-a-p3-c6-07aff9.local:8444: l'utente «user»
> non esiste o la password è sbagliata.

Eppure lo stesso `user`/password funziona perfettamente sia per `ssh
user@tc620-a-p3-c6-07aff9.local` sia per la sezione "2 · Credenziali SSH" del wizard
di deploy (che infatti supera la "Verifica dispositivo" senza problemi). Il maintainer
ha giustamente notato la contraddizione: stesso device, stesse credenziali, esito
diverso a seconda del pannello.

## Diagnosi (confermata leggendo il codice)

Sono **due sistemi di autenticazione indipendenti**, non uno solo:

1. **SSH/OS** — usato solo dalla sezione "Verifica dispositivo" del wizard di deploy,
   per collegarsi via SSH e ispezionare podman/mappature/spazio. Nessun rapporto con
   l'app SWS.

2. **Login applicativo SWS (porta 8444)** — indipendente dal sistema operativo:
   - Frontend: `sws-editor/src/config/ConfigView.tsx`, componente
     `RuntimeConnectionTab` (~riga 8102). Il browser NON chiama direttamente il
     device: chiama il proprio backend locale `POST /api/remote/connect`.
   - Il backend locale fa da proxy verso `{target}/api/auth/login` —
     `sws-runtime/crates/sws-web/src/remote.rs:59` (`connect_remote`), URL costruito
     alla riga ~104.
   - Sul device target, l'endpoint è gestito da
     `sws-runtime/crates/sws-web/src/router.rs:1307` (`async fn login`), che delega a
     `sws-auth` (`sws-runtime/crates/sws-auth/src/lib.rs:485`, `s.auth.login(&creds)`).
     Password Argon2id + JWT bearer — vedi `docs/manual/09_auth_rbac.md`.
   - Gli utenti applicativi sono persistiti in **`users.yaml`** dentro la directory
     dati del progetto sul device (`sws-auth/src/lib.rs`, `struct UserFile` ~riga 192,
     letto da `read_users_yaml` ~riga 53). **Non ha nulla a che vedere con `/etc/passwd`
     o SSH.**
   - Il messaggio esatto («l'utente «X» non esiste o la password è sbagliata») viene
     generato in `sws-runtime/crates/sws-web/src/remote.rs:160-165`, e scatta solo
     quando il device **non** è in no-auth mode (c'è un controllo `senza_utenti` a
     riga ~301 che verifica se `users.yaml` è vuoto/assente prima di dare la colpa
     all'utente). Il fatto che compaia questo errore, e non un accesso libero,
     **dimostra che sul device esiste già almeno un utente SWS**, e che `user` non è
     tra questi.

3. **Utente admin di bootstrap** — creato SOLO se al primo avvio del runtime è
   presente la variabile d'ambiente `SWS_ADMIN_PASSWORD`
   (`sws-runtime/crates/sws-runtime/src/main.rs:402-410`):
   ```rust
   let admin_user = std::env::var("SWS_ADMIN_USER").unwrap_or_else(|_| "admin".into());
   let admin_pwd  = std::env::var("SWS_ADMIN_PASSWORD").unwrap_or_default();
   ```
   Username di default `admin` (override con `SWS_ADMIN_USER`), nessuna password di
   default. Esistono anche `SWS_SUPERVISOR_USER/PASSWORD` e
   `SWS_OPERATOR_USER/PASSWORD` per seed opzionali. STATUS.md documenta l'uso tipico
   in locale: `admin/admin` via `SWS_ADMIN_PASSWORD=admin`. Il bootstrap
   (`sws-auth/src/lib.rs:280-337`) scrive questi account **solo se `users.yaml` non
   esiste ancora** — quindi su un device già provisionato in precedenza, cambiare
   `SWS_ADMIN_PASSWORD` non sovrascrive un `users.yaml` già presente.

**Conclusione**: il maintainer ha inserito nel pannello "Connetti" le credenziali SSH
del device (`user`/password del sistema operativo), ma quel pannello vuole un utente
applicativo SWS (tipicamente `admin`) definito in `users.yaml` sul device — che è
verosimilmente rimasto da un provisioning precedente e non coincide con `user`.

## Piano d'azione per la sessione in ufficio

1. **Verificare cosa c'è davvero in `users.yaml` sul device**, via SSH (le credenziali
   SSH funzionano già):
   ```
   ssh user@tc620-a-p3-c6-07aff9.local
   podman exec -it <container-sws> sh -c 'find / -name users.yaml 2>/dev/null'
   # poi: cat <path>/users.yaml
   ```
   Confermare quali utenti/ruoli esistono davvero (probabilmente `admin` da un
   provisioning precedente).

2. **Riprovare il login con l'utente applicativo corretto** (es. `admin` + la
   password impostata all'epoca via `SWS_ADMIN_PASSWORD`, es. `admin` in locale) nel
   pannello "Connessione runtime remoto" — non le credenziali SSH.

3. Se la password admin non è nota/persa: decidere come resettarla. Dato che il
   bootstrap NON sovrascrive un `users.yaml` esistente, serve un percorso esplicito
   (es. cancellare/editare `users.yaml` sul volume dati persistente e far ripartire il
   container con `SWS_ADMIN_PASSWORD` impostata, oppure — se esiste — un comando/API
   di reset password già presente nel crate `sws-auth`). Da verificare leggendo
   `sws-auth/src/lib.rs:280-337` con più calma per capire se esiste già un percorso di
   reset "pulito" prima di toccare a mano il file su un device di test.

4. **Nota UX per dopo** (non urgente, solo da annotare): il pannello "Connessione
   runtime remoto" e la sezione "Verifica dispositivo" hanno entrambi campi
   "Utente"/"Password" con wording quasi identico ma semantica diversa (credenziali
   app SWS vs credenziali SSH del device) — fonte di confusione già capitata una
   volta. Eventualmente da chiarire in UI (es. label "Utente SWS (app)" vs "Utente SSH
   (sistema)") — solo se il maintainer conferma che vale la pena, non è un bug
   funzionale.

Nessuna modifica al codice è necessaria per risolvere il problema attuale: è un
mismatch di credenziali tra due sistemi di auth distinti, non un bug. Il passo 1-2
sopra è probabilmente sufficiente a sbloccare la connessione.

---

## Esito — verifica in ufficio, 2026-09-11

**La diagnosi qui sopra non regge, e il guasto era un bug nostro.** Il maintainer ha
precisato che il pannello era appena stato installato pulito, senza progetto: in quel
caso utenti residui non ce ne possono essere, e «Connetti» doveva collegarsi senza
autenticazione.

Misurato sul WP630 (`wp630-a-p3-07a077.local`, 2.7.2 in container), porta 8444:

| Richiesta | Risposta |
|---|---|
| `GET /api/auth/whoami` | **404** |
| `GET /api/system` | 200, `auth_required: false` |
| `POST /api/auth/login` (utente inesistente) | 401 |

`senza_utenti()` (`remote.rs`) sondava `/api/auth/whoami`, che **non è montata** in
`deploy_only_app` — la porta di gestione di ogni runtime in container, che gira sempre
con `--no-admin`. Il 404 veniva letto come «non riuscita» e quindi «il dispositivo ha
utenti»: da lì il messaggio «l'utente «X» non esiste o la password è sbagliata» su un
pannello che non aveva alcun utente. La protezione scritta il 2026-09-08 non ha mai
funzionato sui container, cioè su tutti i dispositivi veri; funzionava solo sullo stack
di sviluppo, dove la porta admin serve il router completo.

Corretto in `feat/T-57-credenziali-sws-vs-ssh`: la sonda è `/api/system`, che esiste su
tutti i router e dichiara `auth_required`. Prova end-to-end contro il WP630 con le stesse
credenziali del caso reale: `ok: true` più la nota «non ha utenti definiti: connesso senza
autenticazione».

**Due affermazioni del piano da non riusare, verificate nel codice:**

1. «Il bootstrap scrive gli account solo se `users.yaml` non esiste ancora» — no: il seed
   è **per-account** (`sws-auth/src/lib.rs:303` e `:427`, `if !users.contains_key(&name)`).
   Un `users.yaml` esistente non impedisce di seminare un utente con nome nuovo.
2. Il deploy **non** sovrascrive `users.yaml` (`projects.rs:1513`, decisione del
   maintainer). Lo estrae solo al **primo** upload di un nome di progetto nuovo; i
   ri-deploy lo saltano.

Resta valida, ed è stata fatta, la nota UX del punto 4: le due coppie di credenziali ora
si chiamano «Utente SWS» e «Utente SSH», ognuna con la propria riga di spiegazione.
