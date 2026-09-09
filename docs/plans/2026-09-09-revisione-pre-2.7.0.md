# Revisione del codice prima della 2.7.0 — referto del 2026-09-09

> Richiesta del maintainer: una revisione generale con attenzione a (1) sicurezza,
> (2) funzioni parzialmente implementate o non usate, (3) codice duplicato. Lavoro
> autonomo, correzioni sul ramo `chore/revisione-pre-2.7.0`.
>
> Tre colonne, come promesso: **corretto**, **da decidere tu**, **lasciato stare e perché**.
> Le decisioni non le ho prese: stanno in `docs/OPEN_QUESTIONS.md` (Q46–Q49) con una
> raccomandazione ciascuna.

## In una riga

Il codice è più sano di quanto la dimensione faccia temere: nessun `unsafe` fuori dal
viewer LVGL, SQL parametrizzato, nomi di file e percorsi validati quasi ovunque, zip
protetti dal traversal, nessun `eval`, un solo `TODO`. I difetti veri stavano **ai bordi**:
dove si lancia un processo (ssh, git), dove si inietta markup nel DOM, e nelle dipendenze.

**Numeri, prima → dopo:**

| | prima | dopo |
|---|---|---|
| `cargo audit`, vulnerabilità | 16 | **5** (tutte a monte, vedi §1.4) |
| `cargo audit`, avvisi | 8 | 3 |
| `pnpm audit` | 25 | **0** |
| `cargo clippy --workspace --all-targets -D warnings` | 43 avvisi, CI rossa | **0**, CI verde |
| dipendenze dichiarate e mai usate | 9 | 0 |
| test Rust | 463 | 470 |
| vitest | 194 | 204 |
| duplicazione (jscpd, ≥8 righe) | 26 blocchi, 0,73 % | i 10 più grandi eliminati |

Tutto quanto segue è su `chore/revisione-pre-2.7.0`, 17 commit, ognuno con la motivazione
per esteso. `main` non è stato toccato.

---

## 1. Sicurezza

### 1.1 Corretto

**La password SSH stava su argv.** `sshpass -p <password>`: leggibile in `ps aux` e in
`/proc/<pid>/cmdline` da **qualunque** utente della macchina dell'editor, per tutta la
durata di scp/ssh. Ora `sshpass -e` con `SSHPASS` nell'ambiente, che vede solo lo stesso
uid. In `packaging.rs` e `deploy.rs`. Guardia in `check_chiave_host.sh`, provata rossa.

**`user@host` non era controllato dove conta.** `host_sicuro` esisteva ma era applicato
solo a `ssh-keygen -R`. I quattro handler che fanno davvero ssh (`deploy_device`,
`deploy_device_container`, `manage_device_container`, `deploy_remote`) non controllavano
né host né utente — e `{user}@{host}` è un argomento **posizionale** di ssh: un utente
`-oProxyCommand=…` è un comando eseguito su questa macchina prima ancora di collegarsi.
Sono endpoint Admin, ma in modalità senza utenti Admin è chiunque raggiunga la porta.
Ora `destinazione_ssh_sicura(user, host)` in tutti e quattro; la guardia conta i controlli
contro gli handler (se il conteggio scende, uno è scoperto).

**I nomi dei tag git erano opzioni.** `git tag -a NAME`, `git push origin NAME`,
`git tag -d NAME` con NAME dall'URL e l'unico controllo «non vuoto»: `--delete`, `--force`,
`--mirror` sarebbero stati letti come flag. Ora `ref_sicuro` (regole di
`check-ref-format`), `url_remote_sicuro` sull'URL del remote, e `--` prima dei posizionali.

**La sanificazione degli SVG era cinque regex, e un pannello non la chiamava.** I simboli
custom sono markup incollato dall'utente e iniettato con `dangerouslySetInnerHTML` — nel
canvas dell'editor e nel viewer degli operatori anonimi. Scappatoie trovate senza sforzo:
`onload=alert(1)` senza virgolette, `xlink:href`, `href='javascript:…'` con l'apice,
`<script src=x>` senza chiusura, `<animate attributeName="href">`. E l'anteprima in
ConfigView iniettava il markup **così com'era**. Ora `sanitizeSvg` passa da `DOMParser` con
una lista di elementi/attributi **ammessi** (regex solo come ripiego, riscritte), l'anteprima
la usa, e il server **rifiuta** il salvataggio di un simbolo con codice dentro
(`svg_ostile`, 400). 10 vitest con i bypass, tutti rossi sulla versione precedente.

**Dipendenze.** `cargo update` entro i range (192 crate), poi le crate dichiarate e mai
usate — la peggiore era `rumqttd`, un **broker MQTT embedded** che nessuna riga di codice
menziona e che da solo portava rustls 0.21 + webpki 0.101 (3 CVE) e due crate unmaintained.
pyo3 0.23 → 0.29 (2 CVE; la migrazione era già stata messa in conto il 2026-08-25 con tre
`#[allow(deprecated)]` «finché non si aggiorna»). Lato npm, `pnpm update` + vitest 4: tutti
i 25 avvisi erano in dipendenze di **sviluppo**, niente nel bundle servito.

### 1.2 Da decidere tu (in `OPEN_QUESTIONS.md`)

- **Q46 — `/api/fs/browse-dirs` e `/api/fs/mkdir` senza autenticazione.** Elencano
  qualunque directory assoluta del server e ne creano di nuove, pre-auth, sul router
  completo. Il codice lo dichiara e lo giustifica (la WelcomeScreen prima che esista un
  progetto). Sul dispositivo (`--no-admin`) non ci sono. Raccomandazione: **restringere a una
  radice** (la home, o l'antenato di `projects_root`) — chiude la lettura del filesystem
  senza toccare il flusso.
- **Q47 — `/api/script/exec`: esecuzione di codice arbitrario senza più nessun
  consumatore.** Il client `api.execScript` non era chiamato da nessuno (tolto); la rotta
  server resta, montata due volte, e sullo stack di sviluppo è a livello **Operator**.
  Raccomandazione: **rimuoverla**. Un endpoint che esegue Python e che nessuno usa è solo
  superficie d'attacco.
- **Q48 — `/api/deploy/remote` scarica un binario che non esiste.** La WelcomeScreen
  («Installa runtime») chiama un endpoint che scarica
  `github.com/…/releases/latest/download/sws-runtime-linux-{arch}`: **404 per entrambe le
  architetture**, verificato. Installa un binario nativo con `systemctl restart` di sistema
  — la postura opposta al container rootless di produzione. Ed è una seconda implementazione
  di ssh/scp accanto a `packaging.rs` (`validate_remote_path` identica in entrambi).
  Raccomandazione: **togliere endpoint e modale**, o ripuntare al deploy container.
- **Q49 — TLS senza verifica del certificato, in quattro posti.** `remote.rs`
  (`danger_accept_invalid_certs`), `remote_relay.rs` e `viewer/tls.rs` (verificatore che
  accetta tutto, copiato in due crate), plugin MQTT (`insecure_skip_verify` con WARN). È una
  scelta PoC documentata (self-signed su LAN fidata), coerente con Q44 solo finché il
  servizio resta locale. Raccomandazione: **pinning del certificato** del dispositivo alla
  prima connessione (TOFU, come già fa ssh con `accept-new`) — stesso modello mentale che il
  maintainer ha appena scelto per SSH.

### 1.3 Lasciato stare, e perché

- **CORS `allow_origin(Any)`** su entrambe le porte. Il token viaggia nell'header
  `Authorization`, non in un cookie: un sito terzo può chiamare l'API solo se ha già il
  token. In modalità senza utenti la porta è aperta comunque. Da rivedere se un giorno
  l'autenticazione passa dai cookie.
- **`RestrictedPython NOT available — scripts run with full privileges`** nel log di ogni
  avvio: gli script di progetto girano senza sandbox se il modulo Python manca. È dichiarato
  a voce alta; la decisione (installarlo nell'immagine, o rifiutare gli script senza) è di
  prodotto, non di questa revisione.
- **`Command::new("sh").arg("-c")`** in due punti: il comando kiosk (da configurazione del
  runtime, non dalla rete) e `run_local_cmd` (comandi costruiti da `build_manage_cmd`, i cui
  campi passano da `validate_remote_path` con test dedicati). Verificato, non toccato.
- **Zip:** `upload_project_zip` rifiuta `..` e `/` iniziale; `sync_yaml_dir_from_zip` accetta
  solo `<prefix>/*.yaml` senza sottocartelle. A posto.

### 1.4 Le cinque vulnerabilità che restano, e perché non si chiudono da qui

| crate | advisory | via | perché resta |
|---|---|---|---|
| `rsa 0.9.10` | RUSTSEC-2023-0071 (Marvin, timing) | `async-opcua` | **nessuna versione corretta esiste** |
| `rustls-webpki 0.102.8` | 4 advisory (name constraints, CRL) | `rumqttc 0.24` | `rumqttc 0.25` la porta ancora (provato); e con `insecure_skip_verify` attivo la verifica dei certificati è comunque disattivata |

Vanno segnate e ricontrollate a ogni release, non ignorate.

---

## 2. Funzioni parzialmente implementate o non usate

### 2.1 Corretto

- **`SourceSupervisor::stop_all`** — «Useful at shutdown», e nessuno la chiamava: il
  processo usciva sul segnale lasciando ai peer il compito di accorgersene (niente
  DISCONNECT MQTT → il broker pubblica il Last Will come se fossimo morti). Ora si chiama
  dopo il loop di accept.
- **Nove dipendenze dichiarate e mai usate** (vedi §1.1).
- **`isLegacyTrend`, `getUiLang`** — esportate, mai importate, mai usate nel proprio file.
  `noUnusedLocals` non le vedeva perché erano `export`. Tolte.
- **`api.execScript`, `api.listDatastores`** e il tipo `DatastoreListItem` — nessun
  chiamante. Tolte.
- **`#[allow(unused_imports)] use PathBuf as _; // for future extensions`** — il futuro non
  è arrivato. Tolta (e stava dopo `mod tests`, altro avviso).

### 2.2 Da decidere tu

- **Backend ODBC dello storico: uno stub dichiarato.** `record` e `query` non fanno niente;
  l'editor lo offre come «ODBC — non implementato» con una nota onesta. Ma un utente che lo
  seleziona perde lo storico in silenzio a runtime. Raccomandazione: o non offrirlo finché
  non c'è, o farlo fallire in `test()` e all'avvio con un errore che si vede.
- **Tre funzioni client con una rotta server e nessuna interfaccia**: `deleteProjectImage`
  (le immagini di progetto non si possono cancellare dall'IDE), `getRecipeHistory` (lo
  storico delle ricette esiste sul server e nessuna schermata lo mostra),
  `readOpcUaHistory` (lettura storica OPC UA implementata, mai esposta). Non sono codice
  morto: sono **funzioni a metà**. Da finire o da togliere, ma da scegliere.
- **`router::build` con 26 argomenti**, `projects.rs:488` e `validate.rs:668` con 11. Ho messo
  `#[allow(too_many_arguments)]` con il perché accanto, come già fa il resto del codice, ma
  quello di `build` è il vero odore: una struct di configurazione lo risolverebbe e
  renderebbe leggibile `main.rs`.

### 2.3 Lasciato stare

- I sette `#[allow(dead_code)]` sono tutti **documentati** (campi letti «per completezza
  dello schema ma non ancora disegnati» nel viewer LVGL, con rimando alla Q che li copre).
- Le 61 occorrenze di `any` in TypeScript: quasi tutte in confini con librerie o in cast di
  eventi. Un lavoro a parte, se mai.

---

## 3. Codice duplicato

### 3.1 Corretto

| cosa | dove | ora |
|---|---|---|
| «adesso in ms Unix» scritto **9 volte** in 7 crate | ovunque | `sws_core::now_ms` (restano sws-auth e sws-audit, che non dipendono da sws-core) |
| `validate_remote_path` identica | `deploy.rs`, `packaging.rs` | — vedi Q48: il doppione è il modulo intero |
| lettura di `users.yaml` | `sws-auth` ×2 | `carica_users_file` |
| prologo dei tre handler `/api/backups/:name/*` | `backups.rs` | `progetto_e_nome_backup` |
| sonda «senza utenti» + schermata + stili | `ChatWindow`, `LogWindow` | `useAccessoSenzaUtenti`, `finestraStaccata.tsx` |
| ciclo di vita dei socket condivisi | `tagStream`, `alarmStream`, `logStream` | `socketCondiviso` |
| cinque barre di avviso | `App.tsx` | `BarraAvviso` |
| bootstrap delle quattro pagine | `main`, `admin-main`, `chat-main`, `log-main` | `avvia()` |
| telaio login / cambio password | due schermate | `schermataAccesso.ts` |
| stessa `match` su `TagValue` | `sws-pyscript` ×2 | `tag_value_to_py` |

### 3.2 Da decidere tu

- **Modbus TCP e RTU: il loop di polling è copiato per intero** (`sws-plugin-modbus`, ~35
  righe). Unificabile in una funzione sola, ma è un driver di protocollo e non ho un
  dispositivo Modbus per provarlo: non lo tocco alla cieca. Stesso discorso per due blocchi
  interni al plugin MQTT.
- **Il verificatore TLS che accetta tutto è copiato in due crate** (`viewer/tls.rs`,
  `remote_relay.rs`). Condividerlo vuol dire una crate in più o rustls dentro sws-core:
  nessuna delle due mi sembra valga 15 righe — a meno che Q49 non lo cambi.
- **Quattro chiamate a `whoami()` con forme diverse** (App ×2, RuntimeViewer, RuntimeView),
  oltre alle due unificate. Simili ma non identiche: ognuna decide qualcosa di suo dopo.

### 3.3 Lasciato stare

`bbox_of` in Rust e `objectBBox` in TypeScript sono **deliberatamente** duplicate e tenute
allineate da `check_off_page.sh`: è il pattern giusto per una tabella di verità che deve
vivere da entrambi i lati.

---

## 4. Un fatto sulla CI, non sul codice

`cargo fmt --check` è nella CI e fallisce su **~70 file** — praticamente tutto il
workspace. La CI è rossa da molto prima di questa revisione, e non per clippy (che ora è
verde). Non ho lanciato `cargo fmt`: un diff di settanta file in mezzo a una revisione
seppellirebbe le correzioni vere. Raccomandazione: **un commit `cargo fmt` da solo, subito
dopo il merge di questo ramo**, così la storia di ogni file ha un solo commit «rumore» e la
CI torna a dire qualcosa.

Un secondo dettaglio: la CI usa la toolchain **1.75**, qui gira la 1.94. Clippy verde sulla
1.94 non garantisce la 1.75 — di solito è il contrario (meno lint), ma va visto sulla CI
vera al primo push.

---

## 5. Cosa provare a mano prima di fidarsi

Le correzioni di sicurezza hanno test e guardie, ma tre cose vanno viste con gli occhi:

1. **Deploy container sul WP630** dopo la modifica a `sshpass -e`: deve funzionare esattamente
   come prima. Se `sshpass` sulla macchina dell'editor fosse così vecchio da non avere `-e`
   (pre-2010), fallirebbe con «invalid option» — improbabile, ma è l'unico rischio.
2. **Un simbolo SVG custom esistente** deve rendersi identico a prima nel canvas e nel viewer
   LVGL (che non usa questa sanificazione: `svg_raster.rs` ignora gli script per costruzione).
   Se un simbolo del progetto usa un elemento fuori dalla lista degli ammessi, sparisce: la
   lista è in `customSvg.ts`, si allunga in un minuto.
3. **Le finestre staccate** (chat, log) dopo il refactor: aprire, chiudere, riaprire, con e
   senza utenti definiti.
