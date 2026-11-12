# Manutenzione e verifiche rimandate — dipendenze, immagine, CI e quattro cose da riguardare

> Nato il 10-11-2026 da `Appunti.txt` (punti del 23-10, 28-10, 04-11 e 05-11-2026), quando il maintainer
> ha chiesto di trasformare gli appunti in semi e piani e di eliminare il file.

**Stato: piano — pronto, lavori piccoli e indipendenti.** Ogni punto è un ramo breve o una verifica che
si fa in una sessione, senza dipendere dagli altri. Si può prendere uno alla volta, nell'ordine che
conviene.

## Da dove viene

Il maintainer teneva le piccole cose da finire in `docs/plans/Appunti.txt`: «le cose che devono essere
verificate e trasformate in plan da eseguire». Il 10-11-2026 il file era arrivato a 451 righe e ha
deciso di chiuderlo: «trasformalo in semi e piani, accorpando; una volta fatto elimina Appunti.txt».
Questo piano raccoglie i punti di manutenzione: dipendenze, immagine del container, CI, un test
instabile e due difetti piccoli; più tre verifiche che solo il maintainer può chiudere.

Le date dei punti originali, come stavano negli appunti:

- le etichette duplicate dell'immagine: entrate il 23-10-2026 (commit `fcd6dbf4`), senza data nel testo;
- il test che fallisce una volta su sei: visto il 28-10-2026;
- `zip` 2.4 → 9.x e il template che rinomina i file col token: 04-11-2026;
- le lingue dei contenuti, la CI di GitHub, «Disabilita TLS» e la prova vera di Twilio: 05-11-2026.

Il punto su `rusqlite` che stava negli stessi appunti (righe 448-451) non è qui: è stato fatto il
10-11-2026 (commit `5539e708`, rusqlite 0.41, SQLite 3.54.1, per RUSTSEC-2026-0459).

## Da fare

> **Decise l'11-11-2026 sera:**
> - le etichette duplicate si tolgono **adesso**, nella prossima rc;
> - «Disabilita TLS» toglie **anche il marcatore** della fiducia del browser, e riabilitando TLS la fiducia si rifà.

### 1. Aggiornare `zip` da 2.4 a 9.x in `sws-runtime`

> **Fatto l'11-11-2026** (ramo `fix/zip-9`, nella 2.26.0-rc.14). `zip` è passato a 9.5.1 nei due crate. L'unica
> differenza d'API che ci tocca: `file_names()` e `name()` danno un `Result`. Un nome illeggibile si salta: tutto
> il codice legge le voci per nome. Le quattro righe sono tolte da `audit.toml` e `cargo audit` resta verde. Passano
> 52 test su backup, xlsx, boot, logica PLC e import. Il collaudo qui sotto resta da fare sul pannello e nel cloud.

**Contesto (04-11-2026).** Quattro avvisi RustSec sull'estrazione degli archivi — RUSTSEC-2026-0367,
0368, 0369 e 0429 — sono ignorati in `sws-runtime/.cargo/audit.toml`, perché SWS non chiama mai
`extract()`: legge le voci per nome e ne scrive il contenuto da sé (`ZipArchive::extract` e
`ZipStreamReader::extract` non compaiono nel codice, verificato il 04-11-2026). La correzione sta solo
nella 9.0, sette versioni maggiori più avanti, con un'API diversa (`ZipWriter`, `SimpleFileOptions`,
`ZipArchive`). Il commento in `audit.toml` dice già: «Da togliere quando zip sale».

**Misure del 10-11-2026.**

- `zip` è dichiarato in due crate: `sws-runtime/crates/sws-web/Cargo.toml` (riga 31,
  `version = "2"`, `default-features = false`, feature `deflate`) e
  `sws-runtime/crates/sws-banco/Cargo.toml` (riga 19, `version = "2"`, `default-features = false`).
- Lo usano otto file, non solo i tre citati negli appunti: `sws-runtime/crates/sws-web/src/logica_plc.rs`,
  `boot.rs`, `remote.rs`, `backups.rs`, `projects.rs`, `report/xlsx.rs`, `router.rs` e
  `sws-runtime/crates/sws-banco/src/main.rs`.

**Cosa fare.** Un ramo solo: alzare la versione nei due `Cargo.toml`, adattare gli otto file all'API
nuova, far passare `cargo check`, `cargo test` e `cargo clippy -- -D warnings`. A salita fatta, togliere
le quattro righe `RUSTSEC-2026-0367/0368/0369/0429` e il loro commento da `sws-runtime/.cargo/audit.toml`,
e far girare `cargo audit`: deve restare verde senza quelle eccezioni.

**Collaudo.** Un backup del progetto esportato e reimportato (`backups.rs`, `projects.rs`); un report
xlsx generato e aperto (`report/xlsx.rs`); un deploy dal cloud di un progetto con logica PLC
(`logica_plc.rs`, `remote.rs`); una pagina di boot caricata (`boot.rs`); il banco di prova
(`sws-banco`) che legge il suo pacchetto.

### 2. Togliere le etichette duplicate dall'immagine del container

**Contesto (23-10-2026).** Nell'immagine l'etichetta `net.soligo.sws.changelog` è byte per byte uguale
a `net.soligo.sws.novita.it` (1 587 byte), e `net.soligo.sws.compat` è uguale a
`net.soligo.sws.compat.it` (180 byte). 1 767 byte su 5 710 sono la stessa cosa scritta due volte.
Esistono come ripiego per i runtime da rc.3 a rc.8 della **2.12.0** (fine settembre 2026: la
2.12.0-rc.3 è stata la prima immagine con le Novità nelle etichette, il 28-09-2026), che leggono solo
le etichette vecchie. Non c'entrano le rc.3–rc.8 della 2.26.0 di novembre.
Toglierle alleggerisce immagine e registry. Dal 22-10-2026 non pesano più nel journal dei pannelli,
perché nei container non entrano affatto (commit `fcd6dbf4`, «le etichette delle Novita non entrano
nei container»).

**Dove stanno (10-11-2026).**

- Le scrive il `LABEL` finale di `deploy/container/Containerfile.aarch64` (righe 227-232:
  `net.soligo.sws.changelog="$SWS_NOVITA_IT"`, `net.soligo.sws.compat="$SWS_COMPAT_IT"`) e di
  `deploy/container/Containerfile.x86_64` (righe 160-165). Il commento sopra (riga 207 e riga 143) dice il
  perché: «i runtime rc.3-rc.8 leggono solo quelle, e senza vedrebbero un'immagine nuova senza novità».
- Le legge `novita_da_etichette` in `sws-runtime/crates/sws-web/src/aggiornamento.rs` (righe 232-256;
  negli appunti era «intorno a riga 221»): se c'è `net.soligo.sws.novita.it` usa le nuove, altrimenti
  ripiega su `changelog` e `compat`. Il test `le_novita_brevi_prima_e_il_changelog_come_ripiego` (riga
  891) copre il ripiego.

**Quando si può fare.** Solo quando nessun pannello gira più una versione fra rc.3 e rc.8: un pannello
fermo lì che si aggiornasse direttamente a un'immagine senza le etichette vecchie vedrebbe «nessuna
novità». Prima di togliere, verificare sul gateway (`sws.soligo.net`) le versioni dei pannelli
registrati.

**Cosa fare.** Togliere le due righe dal `LABEL` nei due Containerfile e il commento che le spiega;
togliere il ripiego da `novita_da_etichette` e il suo test, o lasciarlo e dirlo nel commento (vedi «Da
decidere»). Si prova solo dopo una build: `podman inspect` dell'immagine nuova deve mostrare cinque
etichette `net.soligo.sws.*` e non sette, e il pannello aggiornato deve mostrare le novità.

### 3. Il test che fallisce una volta su sei

**Contesto (28-10-2026).** `sws-editor/tests/abbinaPannelloCloud.test.tsx`, caso «si abbina col solo
codice, poi riepilogo e Rinomina» (riga 35 il 10-11-2026). Fallito una volta in una corsa intera di
vitest (1740 prove su 1741 verdi), poi verde in due corse intere e in tre corse da solo. Non tocca
niente di quello che si stava cambiando quel giorno (il riordino di `WelcomeScreen`, commit
`59a7c94f`).

**Il sospetto, non verificato.** Il test usa i tempi predefiniti di `findByTestId` (righe 41 e 45) e di
`waitFor` (righe 52 e 53), cioè 1 secondo. La catena «risposta finta → stato → ridisegno → rinomina →
seconda risposta finta» sotto il carico di 1700 prove in parallelo può sforarli. Non è stato toccato
apposta: una correzione che non si riesce a riprodurre è un'ipotesi scritta come codice. È la stessa
famiglia delle quattro guardie che fallivano a caso lo stesso giorno (28-10-2026): un controllo che
fallisce a caso insegna a ignorarlo.

**Cosa fare.** Prima vederlo fallire con la traccia completa, per sapere quale `await` scade. Due
strade per riprodurlo: far girare la suite intera più volte di seguito (`pnpm exec vitest run`, ~26 s
a corsa) e tenere i log; oppure far girare quel file con un timeout più corto per forzare lo scadere e
leggere dove si ferma. Solo dopo, correggere: un timeout dichiarato su quei quattro `await`, o
un'attesa esplicita sulla chiamata `rinominaPannelloCloud` prima di controllare `onAbbinato`.

### 4. Il template salvato la prima volta rinomina i file delle pagine col token

**Contesto (04-11-2026).** Un template ha `Impianto.yaml` con dentro `name: '{{t0001}}'`. Al primo
salvataggio il file diventa `{{t0001}}.yaml`: il nome del file segue il nome della pagina, che è il
token di traduzione. È estetico: la pagina funziona. La correzione provata il 04-11 — il file col testo
del token tradotto — cancellava pagine nei rinomini e dava 409 falsi, ed è stata tolta.

**Cosa c'è oggi (10-11-2026).**

- `save_synoptic` in `sws-runtime/crates/sws-web/src/router.rs` (riga 8124) costruisce il nome del
  file con `format!("{}.yaml", safe_filename(&name))` e rifiuta con 409 un file che contiene un'altra
  pagina («il file … contiene un'altra pagina (id …)», commento del 04-11-2026).
- `trova_file_pagina` in `sws-runtime/crates/sws-web/src/synoptic.rs` (riga 1064) trova il file di una
  pagina per nome del file, per nome della pagina o per id (`Come::Leggere`), e per cancellare pretende
  che dentro ci sia proprio quella pagina (`Come::Cancellare`). È quello che resta del lavoro del 04-11.
- `list_synoptics` (`router.rs`, riga 7793, `GET /api/synoptics`) elenca ogni `*.yaml` sotto
  `synoptics/`.

**Cosa fare, se serve.** Va pensata con `list_synoptics` e con le versioni di Q30 (`docs/OPEN_QUESTIONS.md`,
Q30: «`patch_project` è un leggi-modifica-scrivi senza lock», il controllo di versione che `save_synoptic`
già applica ai sinottici). Una strada: il nome del file resta quello di partenza finché l'id non cambia,
e la rinomina del file avviene solo su richiesta esplicita. Prima di scrivere codice, decidere col
maintainer se il difetto vale un ramo (vedi «Da decidere»).

### 5. «Disabilita TLS» non torna in chiaro

**Contesto (05-11-2026, archiviando la fiducia del browser).** Il difetto è certo dal codice.
`remove_tls_cert` (`sws-runtime/crates/sws-web/src/system.rs`, riga 1000) cancella `tls.crt` e
`tls.key` e riavvia il runtime. Al nuovo avvio `sws-runtime/crates/sws-runtime/src/main.rs` (righe
555-566) trova il marcatore `fiducia-browser` senza certificato, ne genera uno con `genera_certificato`
e riparte in HTTPS («primo avvio con la fiducia del browser: certificato generato, HTTPS acceso»).
Negli appunti il file era indicato come `main.rs` senza percorso: è quello del crate `sws-runtime`, non
di `sws-web`.

**I testi che promettono il chiaro (10-11-2026).**

- `sws-editor/src/i18n/it.json`, chiave `tlsDisabilita`: «Disabilita TLS» (riga 2913).
- `system.rs`, commento di `remove_tls_cert`: «remove the TLS cert files and reboot into plain HTTP».
- `sws-runtime/crates/sws-web/src/remote.rs`, `remote_tls_rimuovi` (riga 2453, `DELETE
  /api/remote/system/tls`): «toglie il certificato del dispositivo e lo fa ripartire in chiaro».
- `deploy/container/fiducia-browser.sh`, riga 74: «nessun tls.crt: tolta la fiducia, il pannello torna
  in chiaro».

**Il marcatore che non si riusa.** `tls-scelta` («ha scelto no») non si può riusare com'è:
`deploy/container/install-container.sh` lo cancella a ogni installazione (riga 559, `rm -f
"$DATA/config/certificato-dispositivo" "$DATA/config/tls-scelta"`) e subito dopo riscrive
`fiducia-browser` se c'è `certutil` (riga 562). Il piano archiviato
[fiducia nel browser del pannello](../archive/2026-10-26-fiducia-nel-browser-del-pannello.md) diceva
alla riga 88 che si poteva riusare: non è più vero.

**Cosa fare.** Ramo piccolo: runtime (`main.rs` del crate `sws-runtime`, `system.rs`), installatore
(`install-container.sh`), testi (`it.json` e gli altri cataloghi lingua, `fiducia-browser.sh`).
Provabile solo dopo una build, su un pannello con la fiducia del browser installata. Prima però va
deciso cosa vuol dire «disabilitare» dove il TLS è acceso di default (vedi «Da decidere»).

## Da verificare

### 6. Le lingue dei contenuti: email e Telegram in `es`, la chiave Google dopo un ricaricamento

**Cosa resta (05-11-2026).** Due verifiche del capitolo multilingua che solo il maintainer può chiudere:
un allarme di prova che manda email e Telegram in `es` con oggetto e intestazione tradotti; la chiave
Google della traduzione automatica che deve sopravvivere a un ricaricamento del browser. L'IDE in
inglese è stato letto a schermo dal maintainer il 05-11-2026 — barra di attività, Configurazione, Git,
Allarmi, Backup, Notifiche, Connessione — e passa.

**Da dove viene.** Il collaudo a mano che chiude il capitolo è descritto in
[multilingua, chiusura](../archive/2026-09-18-multilingua-chiusura.md) (sezione finale: «email in `de` e
Telegram in `es` … la chiave Google che sopravvive al ricaricamento») e ripreso in
[traduzioni inglesi, revisione](../archive/2026-09-19-traduzioni-inglesi-revisione.md) («Cosa non è
stato verificato»). L'archivio dice che le due verifiche sono «in Appunti»: ora sono qui.

**Dove guardare nel codice.** I destinatari raggruppati per lingua in
`sws-runtime/crates/sws-web/src/notifications.rs` (`etichette(lingua)`, riga 162; «I destinatari
raggruppati per lingua: la loro, altrimenti quella del canale», riga 299); la lingua del canale Telegram
in `sws-runtime/crates/sws-web/src/telegram.rs` (`set_lingua`, riga 222); la chiave Google in
`sws-runtime/crates/sws-web/src/traduttore.rs`, salvata in un file a parte `google_translate.key`
(`nome_file_chiave`, riga 118) e mai dentro la configurazione (riga 94).

**Come si prova.** Un progetto con un destinatario email e uno Telegram in `es`, un allarme di prova:
oggetto e intestazione in spagnolo. Poi: fornitore Google con la chiave, ricaricare la pagina
dell'IDE, la chiave c'è ancora.

### 7. La CI di GitHub: è verde?

**Cosa dicevano gli appunti (misura del 05-11-2026 dall'API pubblica).** La CI era rossa dal
05-10-2026, anche dopo «la CI torna verde» (commit `72466f1a`, 04-11-2026): le ultime 100 esecuzioni
fallite, compresa quella della 2.25.0 (`b8849b4d`, 04-11), sempre al passo `cargo clippy -- -D warnings`
del lavoro «Rust lint»; per questo «Rust build & test» e l'SBOM venivano saltati. In locale lo stesso
comando era verde (05-11, theobroma). Ipotesi da verificare: la CI usa una clippy più nuova (stable
dell'ultimo giorno) con avvisi nuovi. Rimedio possibile: fissare la toolchain anche nella CI, o
correggere gli avvisi nuovi. Il log dell'esecuzione 41859020115 si legge solo autenticati.

**Cosa si sa in più il 10-11-2026.**

- Dal 04-11-2026 la chiusura di giornata esegue in locale gli stessi comandi della CI: `cargo fmt
  --check`, `cargo clippy -- -D warnings`, `cargo audit`, `pnpm lint`, `pnpm type-check` (skill
  `finalizza-giornata`, `.claude/skills/finalizza-giornata/SKILL.md` §3b, «I controlli della CI, prima
  che li faccia lei»). Il 10-11-2026 erano tutti verdi su theobroma.
- Il workflow `.github/workflows/ci.yml` fissa già la toolchain: `dtolnay/rust-toolchain@stable` con
  `toolchain: "1.94"` in tutti e quattro i job Rust (dal 09-09-2026, commit `6a8ce23b`). L'ipotesi
  «clippy stable dell'ultimo giorno» quindi non regge com'è scritta: se il job è rosso, o la 1.94 vede
  avvisi che la toolchain locale non vede, o il passo rosso non è quello che si pensa. Su theobroma la
  toolchain predefinita è `stable` (installate `stable` e `1.88`, la MSRV di `sws-runtime/Cargo.toml`,
  `rust-version = "1.88"`).
- Qui `gh` non è installato: il log dell'esecuzione va letto dal browser, autenticati su GitHub.

**Cosa fare.** Aprire la pagina Actions del repository e guardare le esecuzioni dopo il 04-11-2026
(il 10-11-2026 si stava costruendo la 2.26.0-rc.11). Se «Rust lint» è ancora rosso, leggere il log e confrontare
la versione di clippy del job con quella locale (`cargo clippy --version` su theobroma). Se è verde,
chiudere il punto e dirlo in `STATUS.md`.

### 8. La prova vera di SMS, chiamate e reperibilità con Twilio

**Cosa resta (05-11-2026, tolto da `COLLAUDI_IN_SOSPESO.md` §A-quinquies, che oggi non c'è più).** Il
piano [SMS, voce e reperibilità](../archive/2026-10-26-sms-voce-reperibilita.md) è archiviato dal
29-10-2026, dato per completo dal maintainer. La prova vera si fa appena l'account Twilio passa a
pagamento: l'account di prova manda solo i messaggi predefiniti di Twilio e risponde con il codice
572006 a un testo di SWS. Serve un pannello collegato al cloud.

**Cosa provare, nell'ordine.**

1. «Invia SMS di prova» con Account SID e token.
2. Lo stesso con una chiave API «Standard», riscrivendo una volta il segreto: la correzione `2607e411`
   (29-10-2026) ha chiuso il difetto per cui il segreto si perdeva salvando.
3. Due reperibili di turno con 2 minuti di attesa e Voce sullo scatto: squilla il primo, poi il
   secondo; il tasto 1 riconosce l'allarme (nel registro compare «telefono: …») e ferma la catena.
4. Il webhook SMS `https://<gateway>/telefono/<pannello>/sms` con SMS sullo scatto: la risposta «OK»
   riconosce l'allarme.
5. Senza reperibili di turno nessuno viene chiamato, e il log lo dice.

## Da decidere col maintainer

- **Punto 2, il ripiego nel runtime.** Quando le etichette vecchie escono dall'immagine, il ripiego in
  `novita_da_etichette` si toglie insieme (codice più semplice) o resta per leggere le immagini
  vecchie ancora nel registry (le novità delle rc.3–rc.8 restano leggibili se un pannello le attraversa)?
- **Punto 4, il nome del file col token.** È un difetto estetico: vale un ramo, o si dichiara e basta
  nel manuale dei template?
- **Punto 5, cosa vuol dire «disabilitare» il TLS** dove il TLS è acceso di default con la fiducia del
  browser (strada nata il 26-10-2026, piano archiviato il 05-11-2026). Due
  letture: (a) «Disabilita TLS» toglie il certificato e il marcatore `fiducia-browser`, il pannello
  riparte in chiaro e ci resta finché qualcuno non riaccende; (b) il tasto sparisce dove la fiducia del
  browser è installata, perché lì il chiaro non ha senso. In entrambi i casi il testo deve dire quello
  che succede.
- **Punto 7, se la CI resta rossa.** Correggere gli avvisi che la 1.94 vede, o allineare la toolchain
  del job a quella delle macchine di sviluppo?

## Collaudo

- Punto 1: `cargo audit` verde senza le quattro eccezioni `zip`; backup, report xlsx, deploy con logica
  PLC, pagina di boot e banco di prova funzionano come prima.
- Punto 2: `podman inspect` dell'immagine mostra cinque etichette `net.soligo.sws.*`; un pannello che si
  aggiorna vede le novità.
- Punto 3: dieci corse intere di `vitest` senza un rosso su `abbinaPannelloCloud.test.tsx`.
- Punto 4: un template salvato la prima volta tiene `Impianto.yaml`, e rinominare una pagina non ne
  cancella un'altra né dà 409.
- Punto 5: su un pannello con la fiducia del browser, «Disabilita TLS» porta al comportamento deciso, e
  il testo del tasto lo dice.
- Punti 6–8: sono verifiche; l'esito va in `STATUS.md` e, se c'è un'anomalia, in
  `docs/COLLAUDI_IN_SOSPESO.md`.
