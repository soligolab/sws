# Gli utenti appartengono al progetto — il deploy li porta sul dispositivo

Ramo `feat/utenti-nel-progetto`, da `main`. Rovescia la decisione del 2026-07-30.
Presuppone mergiato `feat/T-57-credenziali-sws-vs-ssh` (stesso sottosistema).

## Contesto

Il maintainer, dopo il guasto di stamattina, ha ripensato la regola: **gli utenti partono dal
progetto, e ricaricare il progetto sul pannello deve poterli sovrascrivere.** Riconosce il caso
futuro in cui una vista del progetto crea utenti sul dispositivo, che allora divergerebbero.

La decisione del 2026-07-30 («il deploy non tocca gli account del dispositivo») nasceva da una
preoccupazione giusta — un deploy che cambia chi accede a un pannello in servizio è un effetto
collaterale sgradito — ma **non è mai stata una regola**: `remote.rs:1330-1360` salta
`users.yaml` solo quando si ridistribuisce un progetto **con lo stesso nome** (`deploy=true` →
`projects.rs:1513`). Al primo deploy, o con un nome diverso, gli utenti del progetto finiscono
già sul dispositivo. Il comportamento dipende da una coincidenza di nomi, invisibile a chi preme
il pulsante. La scelta di oggi lo rende uniforme e dichiarato.

Quattro decisioni prese dal maintainer l'11-09-2026:

1. **Sostituisce per default, con casella per saltare.** «Sostituisci anche gli utenti», accesa;
   spenta serve al caso futuro degli utenti creati sul dispositivo.
2. **Progetto senza utenti ⇒ dispositivo senza utenti.** Il dispositivo rispecchia il progetto.
   Conseguenza accettata: no-auth mode, pannello accessibile senza password.
3. **Il seed da env diventa di solo recupero**: entra solo se il risultato sarebbe zero utenti,
   non più additivo a ogni apertura di progetto.
4. **Conferma esplicita** quando il deploy toglierebbe ogni account a un dispositivo che ne ha.
5. **L'auto-deploy a ogni salvataggio non porta gli utenti** — solo il pulsante Deploy.

## Forma scelta

**L'interruttore viaggia sull'upload, non sulla cancellazione.** `DELETE …?preserve_state=true`
resta identico. Se la cancellazione togliesse `users.yaml` e poi l'upload fallisse, il pannello
resterebbe aperto per un errore invece che per una scelta; e coprirebbe comunque solo il ramo
«stesso nome», che è uno dei tre. Tutta la decisione sta in `upload_project_zip`: una sola
transizione, gli account vecchi ci sono fino all'istante in cui arrivano i nuovi.

**Parametro a tre stati**, `replace_users: Option<bool>` in `UploadQuery`: assente = import
normale (WelcomeScreen, comportamento storico); `Some(true)` = sostituisci, e se il bundle non ha
l'entry **rimuovi** quella del dispositivo; `Some(false)` = non toccare.

**La conferma si decide sul server, con un 428.** `POST /api/remote/deploy` legge gli utenti del
progetto (da disco) e quelli del dispositivo (**col token ancora valido**) prima di iniziare; se
il deploy lascerebbe senza account un dispositivo che ne ha, risponde `428` con l'elenco e non
tocca niente. L'editor chiede conferma e ripete con `confirm_no_users: true`. Nessuna richiesta
in più sul percorso normale, e la stessa lettura serve al log.

## Passi

**1. `sws-auth/src/lib.rs` — seed di recupero.** `new_persistent` (L286-348) e `swap_store`
(L414-466) contengono lo stesso blocco: estrarre `applica_seed_di_recupero(&mut users, seed)`
che entra **solo se `users.is_empty()`**, e `scrivi_users_file`. Scrivere il file solo se il seed
ha aggiunto qualcosa (oggi si riscrive a ogni apertura, rimescolando l'ordine). Copre da sola
boot, auto-open, `open_project` e `replace_users_file`. Cinque test puri con `tempfile`: il seed
non entra se il file ha utenti; entra se non resterebbe nessuno; senza seed e senza file si resta
in no-auth; `swap_store` non reintroduce l'admin tolto dal progetto; il file non si riscrive se
nulla cambia.

**2. `sws-web/src/projects.rs` — il lato dispositivo.** Campo `replace_users` in `UploadQuery`
(~L1355) con la doc riscritta (L1361-1364 dichiara la regola vecchia). Due funzioni pure accanto
a `DESIGN_ARTIFACTS` (L901): `salta_users_yaml(replace_users)` e
`deve_svuotare_utenti(replace_users, bundle_ha_utenti)`. Lo skip a L1513 diventa condizionale.
Dopo il loop di estrazione, il passo esplicito che rimuove `users.yaml` dal dispositivo quando il
bundle non ne ha (`build_export_zip`, `router.rs:3767-3770`, scrive l'entry solo se il file
esiste): non fatale se fallisce, il progetto è già arrivato. Correggere il commento di
`delete_project` (L933-937) e la doc di `replace_users_file` (L1625-1639).

**3. `sws-web/src/remote.rs` — il lato IDE.** `DeployBody { replace_users (default true),
confirm_no_users }` con `deny_unknown_fields` (convenzione Q9), preso come `Option<Json<…>>` così
un corpo assente vale «default», non «tutto spento». `serve_conferma(sostituisci,
utenti_progetto, utenti_dispositivo: Option<usize>)` pura — con elenco non leggibile si chiede,
perché l'errore da evitare è lasciare un pannello aperto senza saperlo.
`leggi_utenti_dispositivo()` è la metà «rete» dell'attuale `report_user_divergence`, chiamata
**prima** dello spawn. `url_upload(base, nome, preserva, sostituisci)`: unico punto in cui i
parametri si compongono — il retry dopo il 409 (~L1420) è dove storicamente se ne perde uno.

`report_user_divergence` (L408-482) **va smontata**: oggi è chiamata dopo `open_project`, che via
`swap_store` azzera le sessioni, quindi la sua `GET /api/auth/users` prende 401 e stampa «Il
deploy non ha modificato gli account del dispositivo» — falso due volte. Al suo posto:
`differenza_utenti()` pura, `riferisci_piano_utenti()` prima della cancellazione, e dopo
l'attivazione tre righe che dichiarano il fatto: sessioni decadute, credenziali possibilmente
cambiate, e lo stato reale letto con `senza_utenti()` (già esistente, L326) — che copre gratis il
caso del seed di recupero, dove il pannello resta protetto e dire «aperto» sarebbe impreciso.

**4. Editor.** `client.ts`: `deployToRuntime({ replaceUsers, confirmNoUsers })` che restituisce la
`Response` grezza (il corpo è un log in streaming) — oggi la `fetch` è duplicata in
`ConfigView.tsx:8686` e `store/index.ts:558`, che è come i due percorsi divergono.
`store/index.ts` `autoDeployIfConnected` (L553) passa `replaceUsers: false` (decisione 5) con il
perché scritto sopra. `ConfigView.tsx`: stato `sostituisciUtenti` (default `true`), casella nella
sezione «Deploy progetto» sul modello del blocco `cleanInstall` (L9612-9622), e `handleDeploy`
spezzato in `eseguiDeploy(confermato)` che sul 428 mostra `window.confirm` e si richiama **una
sola volta**. Correggere i due commenti che diranno il falso: L8850-8853 e il `title` a L9118.
Quattro chiavi i18n in **entrambe** le lingue (`tests/i18nParita.test.ts`): `deployReplaceUsers`,
`deployReplaceUsersHint`, `deployNoUsersConfirm`, `deployNoUsersUnknown`.

**5. `scripts/check_deploy_preserve.sh` — un'asserzione si inverte.** Oggi pretende «utenti del
dispositivo conservati»: diventa il contrario. Riscrivere anche l'intestazione: l'invariante ora
è «storico, backup e ricette sopravvivono, gli utenti no». Tre casi nuovi in coda alla sezione 4
(dove il target è di nuovo pulito): casella spenta → utenti intatti; progetto senza utenti senza
conferma → **428 e `users.yaml` immutato**; con conferma → file rimosso e `/api/system` senza
token che risponde `auth_required:false`. Restano verdi: storico 500→500, ricette, backup, pagine.

**6. Documenti.** `CHANGELOG.md` `[Unreleased]`: la regola nuova, la casella, il caso «progetto
senza utenti», il seed di recupero e la sua interazione con la scelta 2, il log che prima diceva
il falso, e la nota di compatibilità (un dispositivo non aggiornato ignora `replace_users` e
tiene i suoi utenti). Alla voce del 2026-07-30 (`CHANGELOG.md:2779-2806`, release già uscita) non
si riscrive la storia: si aggiunge una riga in corsivo «**Rovesciata l'11-09-2026**». `STATUS.md`:
voce di sessione, con il fatto che `check_deploy_preserve.sh` ha un'asserzione invertita — chi la
rilegge fra un mese non deve pensare a una regressione. `docs/OPEN_QUESTIONS.md`: **proporre** Q54
(primo numero libero) «Un dispositivo che crea utenti propri: cosa succede al deploy successivo?»
— opzioni: casella a mano, fusione per username, marcatura «utente locale» che il deploy non
tocca. `Decided: not yet`, regola 3 di CLAUDE.md.

Ordine: 1 → 2 → 3 verificabili senza editor; 4; 5 è il passo che dice se funziona davvero; 6.
Commit con `-s`, niente push, niente merge senza conferma.

## Rischi dichiarati

- **Il pannello che resta aperto** è l'unico esito praticamente irreversibile. Tre difese: il 428
  con i nomi che spariscono, la riga di log che dichiara lo stato reale dopo l'attivazione, e il
  seed di recupero dove è configurato. Su un dispositivo in container il seed non c'è.
- **Dispositivo non aggiornato**: ignora il parametro, l'IDE dice «sostituiti» e non lo sono. Non
  rilevabile a buon mercato: va nel CHANGELOG.
- **Token morto dopo il deploy**: non è nuovo (le sessioni cadevano già a ogni `open_project`), ma
  ora le credenziali giuste possono essere **cambiate**. Il log lo dice; un re-login automatico
  richiederebbe di conservare la password — fuori scope, da non fare di nascosto.

## Verifica

`cargo test --workspace`, `cargo clippy -- -D warnings`, `cargo fmt --check`; `pnpm build`,
`pnpm test`, `pnpm lint`. Guardie: `check_deploy_preserve.sh` (riscritta ed eseguita),
`check_no_admin.sh`, `check_static.sh`, `check_documenti.sh` dopo Q54. `scripts/test_t34.sh` va
rieseguita: fa `curl -sf` su `/api/remote/deploy` senza corpo e un 428 inatteso la farebbe fallire.

A mano, con i due runtime locali (`start_runtime.sh` + `start_editor.sh`): deploy con casella
accesa da un progetto con utenti → sul dispositivo si entra con le credenziali **del progetto**;
casella spenta → valgono ancora le vecchie; salvataggio con connessione attiva → gli utenti del
dispositivo **non** cambiano; progetto senza utenti → la conferma compare una sola volta e non
riparte in ciclo. Poi, sul WP630, un giro vero.

Controllo finale: `grep -rn "il deploy non .*tocca\|non li tocca\|non modifica gli account"
sws-runtime/crates sws-editor/src CHANGELOG.md` non deve restituire niente che parli al presente.
