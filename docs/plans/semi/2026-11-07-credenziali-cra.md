# Le credenziali e il CRA — quando il cambio password può aspettare (seme)

> **Seme — decisione.** Quando questo lavoro comincia, il primo passo è una sessione di plan
> approfondita dedicata, per sviscerarne tutti i dettagli. Quello che segue è l'idea e le misure
> del 07-11-2026, non un progetto.

## Da dove nasce

Collaudo del 07-11-2026 sul TC620 di casa. Il deploy di CasaDomotica dal cloud, con la casella
«Sostituisci anche gli utenti» attiva (è il default), ha portato sul pannello l'unico utente del
progetto: `admin`, creato il 12-10 con `must_change_password: true`. Nel cloud nessuno entra con
quell'utente (si entra con la mail, dal gateway), quindi il segno era rimasto lì per un mese. Sul
pannello invece `admin` è quello che sblocca «Aggiorna ora» nel viewer: il primo accesso ha imposto
il cambio, e il deploy ha sostituito in silenzio gli account che il pannello aveva prima.

## Cosa ha chiesto il maintainer

- un caso «C»: la richiesta di cambio compare, ma si può rimandare («Più tardi»);
- se esiste una deroga del CRA (Reg. UE 2024/2847) per cui il «più tardi» possa diventare «per
  sempre».

## Cosa si sapeva il 07-11-2026 (da verificare con chi fa conformità)

- Il CRA non scrive «la prima password va cambiata». Chiede *secure by default* (Allegato I, parte
  I; unica eccezione esplicita: il prodotto su misura concordato con un utente business) e
  protezione dagli accessi non autorizzati. L'obbligo viene dalle norme usate per la presunzione di
  conformità: ETSI EN 303 645 (niente password predefinite universali), IEC 62443-4-2 CR 1.5
  (credenziali predefinite cambiate all'installazione); le norme armonizzate CRA erano in
  preparazione. Gli obblighi principali del CRA si applicano dall'11-12-2027.
- Il bersaglio delle norme è la password **nota**: uguale su tutti i dispositivi, o comunicata da
  qualcun altro. SWS non ha una password di fabbrica universale (`sws-auth` rifiuta di partire
  senza `SWS_ADMIN_PASSWORD` o una password scelta).

## Le opzioni già visibili

1. «Più tardi» per tutti: la richiesta torna a ogni accesso.
2. «Non chiedere più» solo per un Admin, dopo un avviso esplicito, scritto nell'audit, annullabile
   col ripristino. Il default resta sicuro; la scelta di spegnerlo è di chi gestisce l'impianto.
3. Il segno resta obbligatorio quando la password l'ha decisa un altro (un admin che crea l'account
   di un operatore).
4. Il deploy che sostituisce gli utenti lo dice prima, nominando quelli col cambio obbligatorio.

Il punto 4 e il «Più tardi» possono anticipare questo seme (rc.3 della 2.26.0); il «per sempre» e
la lettura delle norme sono decisione di prodotto.

## Due fatti in più, annotati il 10-11-2026 (da `Appunti.txt`)

> Trasferiti il 10-11-2026 da `docs/plans/Appunti.txt` (punti del 05-11-2026 e del 07-11-2026),
> quando il maintainer ha chiesto di trasformare gli appunti in semi e piani e di eliminare il
> file. Sono lo stesso tema del seme: il deploy che sostituisce gli utenti, e il cambio password
> obbligatorio che non blocca tutto quello che dovrebbe.

### 1. Un deploy con un nome nuovo cancella anche gli account del pannello (05-11-2026)

Annotato il 05-11-2026 dal censimento dei collaudi.

- Se il progetto arriva sul pannello con un **nome diverso** da quello che c'era, la cartella del
  progetto vecchio se ne va, e con lei il suo `users.yaml`. Con «Invia ora» gli utenti del
  progetto nuovo **non arrivano mai**. Codice: `sws-runtime/crates/sws-web/src/remote.rs` e
  `sws-runtime/crates/sws-web/src/projects.rs`.
- Risultato: un pannello senza Admin del dispositivo torna «in attesa» e chiede il codice di
  abbinamento.
- Il deploy scrive «Utenti: non toccati», **che non è vero** (al 10-11-2026 la riga è in
  `remote.rs:1367`, mostrata quando «Sostituisci anche gli utenti» è spenta). La conferma
  `sostituisce-progetti` (il 428 di `remote.rs:3251`, gestito dall'editor in
  `sws-editor/src/store/conferme428.ts`) parla **solo dello storico**, non degli utenti.
- Si lega all'opzione 4 qui sopra: il deploy che sostituisce gli utenti deve dirlo prima, e deve
  dirlo anche quando li cancella per via del nome, non solo quando la casella è accesa.

### 2. Un utente col cambio password da fare scrive un tag dal viewer (07-11-2026)

Annotato il 07-11-2026 provando la rc.3 della 2.26.0.

- Un utente con `must_change_password: true` ancora da onorare **scrive** un tag con
  `PUT /api/tags/<id>` sulla porta del viewer: risposta 204.
- Il blocco c'è in due posti soltanto: sul socket dei tag (`ruolo_adesso` in
  `sws-runtime/crates/sws-web/src/router.rs`, che tratta quell'utente da Viewer) e sulle rotte
  sotto il middleware `require_password_changed`. La PUT del viewer **non passa da nessuno dei
  due**. Al 10-11-2026: `require_password_changed` è applicato solo nel router di `build`
  (`router.rs:1271`, gruppo `blocking`); nel router del viewer (`build_runtime_inner`) la rotta
  `/api/tags/:id` sta in `read_routes` (`router.rs:2073`) senza quel middleware.
- Da allineare, in uno dei due modi: o la PUT guarda `must_change_password` come fa il socket, o
  si decide che sul viewer il blocco non serve. Con il «Più tardi» della rc.3 la sessione
  rimandata comanda comunque, quindi la seconda strada non è assurda.
- Visto con un Operator creato via API su un runtime di prova, **non sul pannello**.
