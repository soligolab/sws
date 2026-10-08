# Fase 3a — aziende, e una console di amministrazione separata dall'IDE

> **Destinazione nel repo**: `docs/plans/2026-10-06-aziende-e-console.md`, scritto col primo commit
> del ramo. È il dettaglio della **Fase 3** del
> [tronco cloud](2026-10-05-cloud-utenti-aziende-spazi.md), aperto con una
> sessione di plan dedicata su richiesta del maintainer.

## Contesto

Le Fasi 1 e 2 hanno dato all'IDE i suoi utenti e chiuso le rotte aperte. Ora servono le **aziende**
— il livello che possiede i progetti e a cui si assegnano marchio, quote e approvazione — e il posto
da cui si amministrano.

Il maintainer ha chiesto che quel posto sia **separato dall'IDE**, e ha aggiunto il vincolo che lo
decide davvero: *«potenzialmente potrei voler definire che una azienda sia fissata su una versione
ben precisa. L'avanzamento di versione sarà gestito dalla console di amministrazione azienda per
azienda»*.

**Da lì segue tutto.** Se la console decide su quale versione gira ogni azienda, non può vivere
dentro l'IDE: sarebbe fissata alla stessa versione che deve governare, far avanzare un'azienda
vorrebbe dire far avanzare la console con lei, e aziende su versioni diverse avrebbero console
diverse, ciascuna convinta di comandare. **Lo strumento che governa le versioni dev'essere
indipendente dalle versioni che governa.** La console appartiene quindi al gateway (Fase 4), non
all'IDE — ma si costruisce adesso come applicazione a sé, servita dal runtime attuale, e trasloca
col gateway senza essere riscritta.

Perimetro scelto dal maintainer: **3a** fa aziende e console, **3b** sposterà i progetti sotto la
cartella dell'azienda. Due rami corti, e il secondo — quello che può perdere dati — affrontato da
solo.

## Fatti misurati il 06-10-2026

1. **Il repo ha già quattro punti d'ingresso** (`sws-editor/vite.config.ts:51-67`): `index.html` →
   viewer, `index-admin.html` → IDE, `index-log.html` e `index-chat.html` → finestre staccate.
   Aggiungerne uno tocca **solo** `vite.config.ts` più l'HTML e il `.tsx`: `build_spa_if_needed.sh`
   li scopre con una glob `index*.html`, e `build_container.sh` copia l'intera `dist/`.
2. **Il bootstrap è condiviso**: `avvia(Radice, {apiLocale})` in `src/avvio.tsx` dà marchio, tema,
   i18n e store a chiunque lo chiami. Un punto d'ingresso nuovo li eredita senza una riga.
3. **La sessione si condivide per origine**: `localStorage["sws.auth"]`, idratato a caricamento del
   modulo (`src/store/index.ts:695`). Una seconda SPA sulla **stessa porta** è già autenticata; sul
   viewer (8443) no, perché è un'origine diversa — ed è giusto così.
4. **`/qualunque-cosa` sulla 8444 serve l'IDE** (`router.rs:1016-1035`): la console si raggiunge al
   nome esatto del file, `/index-console.html`, come già fanno chat e log. Un percorso pulito
   richiederebbe una rotta in Rust; non serve adesso.
5. **Il Rust non sa nulla dei marchi**: sono file statici serviti da `ServeDir`, e il frontend fa
   `fetch("/branding/active.json")` (`src/branding/index.ts:151`). Per far scegliere un marchio
   dalla console serve un endpoint che elenchi `www/branding/*/brand.json`.
6. **Non esiste un ruolo di amministratore di piattaforma**: i ruoli sono
   `Viewer < Operator < Supervisor < Admin`, per progetto, più i due di `sws-identita`.

## Il modello

`identita.db` passa a `user_version = 2`. Tabelle nuove:

- **`aziende`** — `id`, `nome`, `stato` (`in_prova` | `approvata` | `sospesa`), `marchio` (l'id di
  un marchio del catalogo, nullable), `versione_predefinita` (nullable), `implicita`, `creata_ms`,
  `aggiornata_ms`, e le colonne delle quote (`max_progetti`, `max_pannelli`, `max_byte`).

  > **`versione_predefinita` e non `versione_fissata`** (decisione 44, presa mentre si scriveva
  > questa fase). La versione sta sul **progetto**, non sull'azienda: un'azienda con decine di
  > pannelli non li ha tutti aggiornati, e ciò che si deploya su un parco di pannelli è il progetto.
  > Il dato per progetto esiste già ed è `saved_by` in `project.yaml`. Qui resta il predefinito per
  > i progetti nuovi e il tetto massimo.
- **`membri`** — `(azienda_id, utente_id)` chiave primaria, `ruolo` (`amministratore` |
  `sviluppatore`, decisione 18).
- **`utenti`** prende `amministratore_piattaforma`. È un asse diverso dal ruolo in azienda: chi
  approva le aziende (decisione 17) non è «un amministratore più forte», è un altro mestiere.

**Due campi che oggi non fanno niente, e vanno dichiarati come tali**: `versione_fissata` e le
quote. Il maintainer ha scelto di metterli ora perché aggiungere una colonna a una tabella popolata
è più scomodo che prevederla, e perché vedere la forma nell'interfaccia aiuta a progettare il resto.
Il rischio è che un campo inerte faccia credere di funzionare: **la console deve dirlo a schermo**,
non solo il codice in un commento.

### L'azienda implicita

Decisione del maintainer: le aziende esistono **sempre**, e un'installazione singola ne ha una sola,
creata da sé e mai mostrata. Una forma sola di sistema invece di due — è il vincolo della decisione
27, il cloud come *modo di far girare l'IDE* e non come prodotto diverso.

Regola d'interfaccia: **una sola azienda e `implicita = 1` ⇒ il concetto non compare**. L'IDE non
nomina mai l'azienda, e la console mostra utenti e impostazioni senza il livello sopra.

**Migrazione, e non è un caso di scuola**: l'installazione di sviluppo ha già un amministratore
creato in Fase 1 e nessuna azienda. All'apertura dell'archivio, se ci sono utenti e nessuna azienda,
se ne crea una implicita e vi si iscrivono tutti gli utenti esistenti. Da provare su una copia del
`identita.db` vero, non solo su un database nuovo.

## La console

Punto d'ingresso nuovo: `index-console.html` + `src/console-main.tsx` + `src/console/`, servito a
`/index-console.html`. **Non condivide nulla con l'IDE** salvo marchio, lingua e sessione: niente
`EditorShell`, niente store del progetto.

Quattro schermate, che sono le quattro cose per cui esiste:

| | |
|---|---|
| **Aziende** | elenco con stato; approvare o sospendere (decisione 17); assegnare il **marchio** dal catalogo (decisione 43); fissare la **versione predefinita** per i progetti nuovi, con scritto accanto che oggi non ha effetto |
| **Persone** | utenti dell'installazione: crearli, disattivarli, assegnarli a un'azienda con un ruolo. Disattivare, non cancellare — un id che sparisce rende illeggibile il registro di audit |
| **Posta** | configurazione SMTP (Infomaniak, `mail.infomaniak.com:587` STARTTLS). Il **segreto** va in un file 0600 in `<config_dir>`, fuori da git e dall'export, come `secrets.yaml` dei progetti. La console ne cambia il contenuto, non il posto |
| **Questa installazione** | versione, percorsi, se è singola o ospitata. La pagina che risponde a «cos'è questa macchina» |

La 2FA (decisione 19) **non** è in questa fase: sta in Fase 5 con la registrazione, ed è lì che
servono i codici di recupero.

## Le API

Modulo nuovo `sws-runtime/crates/sws-web/src/amministrazione.rs`, rotte sotto
`/api/amministrazione/*`, tutte dietro `require_auth` **più** una guardia nuova
`require_amministratore_piattaforma`. Nessuna di queste rotte è pre-auth, quindi
`check_rotte_preauth.sh` resta verde senza modifiche.

- `GET|POST /api/amministrazione/aziende`, `PATCH /api/amministrazione/aziende/:id`
- `GET|POST /api/amministrazione/utenti`, `PATCH /api/amministrazione/utenti/:id`
- `GET /api/amministrazione/marchi` — elenca `www/branding/*/brand.json` e ne legge `id` e `name`
- `GET|PUT /api/amministrazione/smtp` — la GET **maschera** la password, la PUT la scrive nel file
  dei segreti

## File

| file | cosa |
|---|---|
| `sws-runtime/crates/sws-identita/src/lib.rs` | schema v2, aziende, membri, azienda implicita, migrazione |
| `sws-runtime/crates/sws-web/src/amministrazione.rs` | **nuovo** — le rotte e la guardia di ruolo |
| `sws-runtime/crates/sws-web/src/router.rs` | registrazione delle rotte |
| `sws-editor/vite.config.ts`, `index-console.html`, `src/console-main.tsx`, `src/console/` | la console |
| `sws-editor/src/i18n/{it,en}.json` | le sue stringhe, in tutte e due le lingue — `check_i18n_ui.sh` non fa sconti |
| `scripts/check_amministrazione.sh` | **nuovo** — vedi sotto |

## Verifica

Definition of done di `CLAUDE.md`, più:

- **Test di `sws-identita`**: creazione azienda, appartenenze, unicità del nome, e soprattutto la
  **migrazione** — un archivio con utenti e nessuna azienda deve produrre l'azienda implicita con
  tutti dentro. Provato su una copia dell'`identita.db` reale.
- **`scripts/check_amministrazione.sh`, da provare rosso**: ogni rotta dichiarata in
  `amministrazione.rs` passa dalla guardia dell'amministratore di piattaforma. È la stessa idea di
  `check_rotte_preauth.sh` — un elenco che si verifica da sé invece di una disciplina da ricordare.
- **Test di router**: un utente senza quel ruolo riceve **403**, non 200 e non 404.
- **A schermo**: `/index-console.html` si apre già autenticati (stessa origine dell'IDE), mostra
  l'azienda implicita, permette di crearne una seconda, approvarla, assegnarle un marchio e una
  versione; e l'IDE **continua a non nominare le aziende** finché ce n'è una sola implicita.

## Quello che questa fase **non** fa

- **Non sposta i progetti** sotto la cartella dell'azienda: è la 3b, e porta con sé il registro
  indicizzato per nome (oggi due aziende con un progetto «impianto» si sovrascrivono,
  `project_registry.rs:49-61`), la regola `is_external` che diventerebbe vera per tutti
  (`projects.rs:1162`), e il confinamento mancante su `upload_project_zip`
  (`projects.rs:1815-1836`, che non usa `dentro_radice` e accetta qualunque percorso assoluto —
  **un buco già presente oggi**, da chiudere lì).
- **Non fa rispettare le quote**: le colonne ci sono, il conteggio no.
- **Non avvia niente per versione**: `versione_predefinita` è un dato finché non c'è il gateway. Con
  la decisione 44 quel gateway dovrà saper avviare **più versioni insieme**; su ghcr **le release
  restano e le immagini di prova si potano**, quindi un progetto si lega solo a una release — mai a
  una `rc`, che il giorno della potatura lo renderebbe non più apribile. Il selettore della console,
  quando mostrerà delle versioni, dovrà offrire **solo release**.
- **Non fa la 2FA** né la registrazione libera: Fase 5.
