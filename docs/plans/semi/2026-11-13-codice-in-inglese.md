# Il codice in inglese, ovunque

> **Seme — in corso, gradualmente** (decisione del 13-11 qui sotto). Nato il 13-11-2026 da una richiesta del maintainer. **Quando questo lavoro comincia, il primo
> passo è una sessione di plan approfondita e dedicata, per sviscerarne tutti i dettagli**: le misure qui sotto sono
> grezze e invecchiano col codice. Fino ad allora il codice non si tocca (parole del maintainer: «il codice lo
> tocchiamo dopo»).

## L'idea

Parole del maintainer: «fare un refactory completo del codice perché ho visto in molti file di codice riferimenti in
italiano mentre il codice deve essere in inglese ovunque (per esempio ho visto che è in italiano lo yaml dove registri
il pairing)».

Oggi il codice mescola le due lingue: nomi di file, moduli, funzioni, variabili, campi, rotte e file di configurazione
in italiano accanto ad altri in inglese. È un'abitudine cresciuta sessione dopo sessione: il maintainer scrive in
italiano, e il codice nuovo ha seguito il codice vicino.

## Misurato il 13-11-2026 (grezzo, con `grep`)

- **Rust**: 185 file `.rs` fuori da `target` e `vendor`; **almeno 35** hanno il nome in italiano (`abbinamento.rs`,
  `aggiornamento.rs`, `cornici.rs`, `schermo.rs`, `ritmo.rs`, `identita`, `amministrazione.rs`, …). Dentro, funzioni
  e variabili italiane sono la norma, non l'eccezione.
- **Editor**: 374 file `.ts`/`.tsx` in `sws-editor/src`; una stima per suffisso ne trova **circa 77** col nome
  italiano (`salvaPannello.ts`, `faceplateDaSelezione.ts`, …).
- **Il modello del progetto** (`sws-core/src/project.rs`): 366 campi pubblici, **almeno 22** in italiano
  (`pannello`, `luminosita`, `cornice_predefinita`, `simboli`, `regole`, …). Questi **sono il formato di
  `project.yaml`**.
- **File su disco** scritti dal runtime: `abbinamento.json` (l'abbinamento che il maintainer ha visto),
  `aggiornamento.yaml`, `pannelli.yaml`, `dispositivi_conosciuti.yaml`, `utenti_dispositivo.yaml`,
  `mqtt_broker_conosciuti.yaml`, `lvgl_tls_conosciuti.yaml`, `sicurezza.yaml`, `traduzione.yaml`, …
- **API**: 178 rotte in `router.rs`, **almeno 24** con parole italiane (`/api/project/pannello`,
  `/api/identita/primo-amministratore`, …).
- **Gli script e le guardie** (`scripts/check_*.sh`) cercano spesso nomi di funzioni e di file con `grep`: rinominare
  il codice li fa diventare rossi, o peggio verdi per la ragione sbagliata.

## Perché non è un «cerca e sostituisci»

Tre strati, con rischi diversi:

1. **Il codice interno** (moduli, funzioni, variabili, componenti): nessun effetto fuori dal binario. Costo:
   tantissimi file, conflitti con qualunque ramo aperto, guardie da aggiornare. Rischio basso.
2. **I formati su disco**: `project.yaml`, i file di `config/`, i nomi dei file. Ci sono **pannelli installati** e
   **progetti nel cloud** che li hanno già scritti così. Un campo rinominato senza alias perde il dato in silenzio
   (serde ignora la chiave vecchia). Serve un alias in lettura (`#[serde(alias = "pannello")]`), una migrazione dei
   file, e la regola per quante versioni tenere l'alias.
3. **Le API fra processi diversi**: IDE ↔ pannello, viewer LVGL ↔ runtime, gateway ↔ pannello. Un IDE nuovo parla
   con pannelli vecchi e viceversa: una rotta rinominata va servita sotto i due nomi per un periodo.

Più tutto quello che sta intorno: `NOVITA.yaml`, CHANGELOG, il manuale (che cita nomi di file e di campi), i template
in `examples/templates/`, i fixture dei test.

## Deciso il 13-11-2026, lo stesso giorno

- **Gradualmente** (l'opzione B): «per ora lo si può fare gradualmente man mano che si lavora». La regola è in
  `CLAUDE.md`, «Il codice si scrive in inglese, ovunque»: il codice nuovo nasce in inglese, quello che si tocca si
  traduce, e restano in italiano solo i file di lingua (più documenti, commit e risposte, che non sono codice).
- **La compatibilità la fanno i progetti**: «per ora basta aggiornare i progetti sul cloud/ide e riscaricarli
  all'occorrenza sul device». Niente alias in lettura per le chiavi di `project.yaml`. Fanno eccezione i file di stato
  del dispositivo in `config/`, che un deploy non riscrive: lì il runtime sposta il file vecchio all'avvio.

Resta aperto, per quando si farà il passaggio completo: le API fra IDE e pannelli di versioni diverse, e una guardia
contro le parole italiane nei nomi nuovi.

## Le opzioni che si vedono già

- **A — tutto insieme, uno strato alla volta**: prima il codice interno (un ramo per crate o per area), poi i formati
  con alias e migrazione, poi le API con doppio nome. Pulito alla fine, ma settimane di lavoro che non portano niente
  a chi usa il prodotto, e ogni altro ramo si ferma.
- **B — progressivo**: da subito il codice **nuovo** in inglese, e un file si traduce quando lo si tocca per altro.
  Costa poco e non blocca niente, ma per mesi il codice resta misto, ed è la cosa che il maintainer vuole togliere.
- **C — misto**: subito il codice nuovo in inglese (B), poi un passaggio dedicato sui formati su disco e sulle API (gli
  strati 2 e 3, quelli che una volta pubblicati costano di più a cambiare), e il codice interno a ondate, per area,
  quando un'area è ferma.

## Da decidere nella sessione di plan

- Cosa vuol dire «ovunque»: anche **commenti** e **messaggi di log**? E i documenti in `docs/` e il CHANGELOG, che
  oggi sono in italiano per scelta? (I testi che vede l'utente stanno nelle tabelle i18n e non c'entrano.)
- Da quando il codice nuovo nasce in inglese, e cosa fare dentro un file ancora italiano (la regola «scrivi come il
  codice intorno» oggi spinge nella direzione opposta).
- Per i formati su disco: alias per quante versioni, chi migra i file (il runtime all'avvio? il deploy?), e come si
  prova su un pannello che arriva da una versione vecchia.
- Per le API: per quanto tempo i due nomi, e come se ne accorgono IDE e gateway.
- Una guardia che impedisca di tornare indietro (per esempio un elenco di parole italiane vietate nei nomi nuovi), e
  come convive con le guardie che oggi cercano i nomi italiani.
