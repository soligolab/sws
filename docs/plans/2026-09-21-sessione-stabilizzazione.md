# Sessione di stabilizzazione — piano a passi (21-09-2026)

Scelta del maintainer: **si tocca tutto il blocco A (bug e rischi), B (difetti delle funzioni nuove) e C (collaudi sul TC620)**, **un passo alla volta**, ciascuno con
il suo ramo, il suo collaudo e la sua conferma prima del merge (regola «un ramo alla volta»). Nessun passo comincia se il precedente non è mergiato e i suoi rami eliminati.
Fuori: blocchi D/E (debito, semi) — restano in `docs/plans/README.md`.

Regola comune a ogni passo: `cargo check` + `pnpm build` + `./scripts/check_static.sh` verdi, test nuovi che falliscono senza la correzione, prova dal vivo dove c'è un
comportamento visibile, `CHANGELOG.md`/`STATUS.md` aggiornati, push solo su richiesta.

## Passo 0 — Pulizia e bug piccoli  (ramo `fix/pulizia-2110`)
1. **EtherNet/IP `kind`**: `types/index.ts:1208` e `ConfigView.tsx:1546` usano `'en_ip'`, Rust `#[serde(rename = "enip")]` (`project.rs:362`). Correggere il TS, e aggiungere
   una **guardia** `scripts/check_source_kinds.sh` che confronta i `kind` delle sorgenti fra `enum SourceDef` (Rust) e `SourceDef` (TS) — la classe di difetto è «due elenchi a mano».
   Test: creare una sorgente EnIP dal codice dell'IDE e rileggerla con il parser Rust (round-trip).
2. **Registro dell'IDE**: `known_projects.json` con voci che puntano a cartelle inesistenti (5 `flashtest…`): il runtime dovrebbe **ignorare/potare** le voci morte al caricamento
   (oggi `open_project` dà 404 «project not found» se il registro vince su una cartella che non c'è più — successo il 20-09). Aggiungere: se il percorso registrato non esiste, ripiegare su
   `projects_root/<nome>` e ripulire la voce. Test in `project_registry.rs`.
3. **`start_editor_develop.sh`** cerca ancora i progetti in `.run-editor/projects` mentre il maintainer li tiene in `~/sws_projects`: decidere (una riga in `HOWTO`/`CLAUDE.md` o cambiare il default).
4. **Push** di `main` (2 commit di documentazione dopo il tag) e verifica del container 2.11.0 sul registro (arm64 pubblicato, amd64 in corso al momento della scrittura).
5. **CI**: leggere `.github/workflows/ci.yml` e, se `gh` non c'è, dire al maintainer cosa guardare su GitHub.

## Passo 1 — Le 26 guardie con stack  (nessun ramo, solo lancio; fix su `fix/guardie-stack` se serve)
Lanciare a mano tutte le guardie elencate in `CON_STACK` di `check_static.sh` (e2e `check_e2e.sh`, screenshot) contro un runtime di scarto con un progetto a più pagine. Mai girate contro albero,
pannello sinistro fisso, navigatore, sorgente Host. Per ogni rosso: capire se è la guardia o il codice; correggere. Aspettativa da verificare per prima:
`e2e/screenshots.spec.ts` (clic sull'icona «Pagine», che non c'è più) e `check_e2e.sh --screenshots`.

## Passo 2 — I segreti del progetto  (ramo `feat/segreti-di-progetto`; piano dettagliato del 21-09-2026, sessione di plan fatta)

### Misurato (inventario del 21-09-2026)
- **Sette campi con segreti in chiaro in `project.yaml`** (`sws-core/src/project.rs`): `TelegramConfig.bot_token` (1163, `String` non Option), `SmtpConfig.password` (1151),
  `MqttConfig.password` (471, ha `password_env`), `OpcUaAuth::UsernamePassword.password` (709, ha `password_env`), `HomeAssistantConfig.token` (377, ha `token_env`),
  `DatastoreBackendConfig::Postgres.password` (136), `DatastoreBackendConfig::Odbc.connection_string` (~140, può contenere `PWD=`). Nessun segreto in S7/EnIP/Modbus/Host/Sparkplug/`MqttTlsConfig`.
  Fuori dal progetto e già a posto: chiavi AI e traduttore (`config_dir`, `segreti.rs`, 0600); `users.yaml` (hash); `opcua-pki/` (chiave privata: **fuori scope**, viaggia come oggi).
- **La maschera `MASKED_PASSWORD` (`router.rs:2662`) copre solo Mqtt, Smtp, Telegram**: HA token, password OPC-UA, Postgres e ODBC vanno **in chiaro al browser** (`GET /api/project`) e, con `leggi_progetto`
  (`ai/tools.rs:290`), **al fornitore LLM esterno**. Ripristino del segnaposto in `update_project_sources` (solo MQTT), `update_project_notifications`, browse OPC-UA/MQTT, `detect_telegram_chats`, import (4111).
- **Percorsi**: *verbatim* (un file nuovo viaggia da solo) — `duplicate_project`, create-da-template (`copy_dir_all`), download backup (`zip_directory`); *elenco esplicito* (va aggiunto) — `BACKED_UP` in `backups.rs:33-41`
  (create/restore), `build_export_zip` (`router.rs:3927`, usato da export **e** dal deploy `remote_deploy`→`build_project_zip`), `import_project_zip`, `upload_project_zip` (`projects.rs:1537`, scrive con umask, non 0600),
  `DESIGN_ARTIFACTS` (`projects.rs:1005`); *git* — `commit` fa `git add -A`, `init_remote` non scrive nessun `.gitignore` (non esiste in tutto il repo); *scrittura di project.yaml* — `patch_project(_se)` (~20 chiamanti), `stamp_and_serialize`/`save_to`
  (`std::fs::write`, non atomico), 4 siti `scrivi_atomico` (2995, 4893, 5233, 5338) + 4 in `projects.rs` + import 4187; **`Project::load` (`project.rs:1533`) è il punto unico di lettura**.
- **Perdite nei log**: `telegram.rs:71,79` e `router.rs:7390-7405` mettono il token nell'URL e restituiscono/loggano l'errore di `reqwest` (il `Display` può contenere l'URL); `postgres_backend.rs:306` costruisce `password={p}`.
- **Permessi**: `segreti.rs:40` fa chmod 0600 dopo `fs::write` (non atomico); `scrivi_atomico`/`scrivi_atomico_sync` (`router.rs:3075/3055`) usano l'umask. `tls.key` è 0644 (nota a `ai/client.rs:274`).

### Disegno
**Un solo file, un solo punto.** `secrets.yaml` nella cartella del progetto, 0600, mappa piatta chiave→valore con chiavi stabili per **id** (non per posizione):
`notifications.telegram.bot_token`, `notifications.smtp.password`, `sources.<id>.password` (MQTT), `sources.<id>.token` (HA), `sources.<id>.auth_password` (OPC-UA client),
`datastores.<id>.password`, `datastores.<id>.connection_string`. Un solo modulo, `sws-core/src/segreti.rs`, con la **tabella dei campi segreti** (chiave, come leggerlo e come scriverlo nel `Project`):
- `estrai(&mut Project) -> Segreti` toglie i valori dal `Project` (campo vuoto / `None`, `skip_serializing_if`) e li ritorna;
- `applica(&mut Project, &Segreti)` li rimette (un valore già in chiaro in `project.yaml` **vince**: è il caso del progetto vecchio, che poi si migra);
- `Project::load` = parse di `project.yaml` + `applica` di `secrets.yaml` se c'è → **tutti i lettori** (AI, browse, plugin, `soft_reload_project`, `open_project`) vedono i valori veri senza cambiare;
- **una sola funzione di scrittura** `scrivi_progetto(dir, &Project)` = `estrai` → scrive `secrets.yaml` (atomico, temp creato 0600, poi rename) **prima**, poi `project.yaml` (atomico). Tutti gli 8+ siti di scrittura la usano (`patch_project(_se)`, deploy meta.name, import…);
  se il processo muore fra i due file resta il segreto in entrambi: si autoripara al salvataggio successivo.
- `TelegramConfig.bot_token` diventa `#[serde(default, skip_serializing_if = "String::is_empty")]`.
- Il fingerprint del progetto (`/api/project/fingerprint`) **non** include `secrets.yaml`; l'ETag di sezione resta quello di `project.yaml` (un cambio di solo segreto non alza la versione: accettato, dichiarato).

**Dove viaggia** (decisioni del maintainer: deve viaggiare col progetto; non deve finire dove non deve):
| Percorso | `secrets.yaml` |
|---|---|
| Deploy IDE→dispositivo (`build_project_zip`→`upload_project_zip`) | **incluso** (il dispositivo senza token spegne le notifiche); scritto 0600; se lo zip non lo porta **il dispositivo tiene il suo** |
| Backup (auto e manuale), ripristino, download backup | **incluso** (`BACKED_UP`), il ripristino lo rimette |
| Duplica progetto | incluso (copia verbatim) |
| Export `.sws` per condividere | **escluso di default**; `GET /api/project/export?segreti=1` (casella «Includi i segreti» nell'IDE, spenta) lo include |
| Import `.sws` | lo scrive solo se presente **e** richiesto; altrimenti ignorato |
| Template (`examples/templates`) | nessun segreto (già `token_env`); la guardia lo verifica |
| Git (`init_remote`, `commit`) | **escluso**: `.gitignore` con `secrets.yaml` scritto a `init` e **riscritto/aggiunto al prossimo commit** dei repository esistenti; avviso se `secrets.yaml` è già tracciato (`git ls-files`) |

**Migrazione automatica** (progetti con segreti in chiaro): all'apertura (`open_project`) e a ogni scrittura, se `project.yaml` contiene un segreto non presente in `secrets.yaml`: **backup prima** (`backup_now`), poi `scrivi_progetto` (sposta), riga di audit
`project.change {what:"secrets_migrated", n}` e una voce in `avvisi` di `/api/system` («N segreti spostati in secrets.yaml»); l'IDE rifissa la baseline del sorvegliante (l'apertura già lo fa).
**I vecchi backup e i commit già fatti restano in chiaro**: non si riscrive la storia — per questo il token vero va **ruotato** (a carico del maintainer).

**Le perdite chiuse insieme** (senza, spostare il file non basterebbe):
1. **Maschera per tutti i sette campi** (`mask_project_secrets`) e **ripristino** del segnaposto in tutti i gestori che salvano quelle sezioni (`update_project_sources` per HA/OPC-UA/MQTT, `update_project_datastores`, notifications già a posto, import), più browse/lettura OPC-UA e history che lo risolvono già.
2. **AI**: `leggi_progetto` maschera tutto (ora i quattro sono in chiaro all'LLM); `proponi_modifica`/`componi_da_patch` risolvono il segnaposto per tutti i campi prima di salvare.
3. **Errori con URL**: `reqwest::Error::without_url()` (o sostituzione del token) in `telegram.rs` e `router.rs:7390-7405`; connect string Postgres mai nei log.
4. **Permessi**: `scrivi_atomico` con modalità; `tls.key` a 0600 (piccolo, nello stesso passo, se il maintainer è d'accordo).

### Sotto-passi (ognuno un commit sul ramo, con i suoi test)
- **2a** `segreti.rs` + `Project::load`/`scrivi_progetto` + scrittore atomico 0600. Test: round-trip per ognuno dei sette campi; `project.yaml` serializzato **non contiene** nessun valore-sentinella; `applica` con segreto assente → invariato; tutti i template caricano come prima; precedenza «in chiaro vince».
- **2b** tutti i siti di scrittura passano da `scrivi_progetto` (elenco puntuale sopra; una `grep` in guardia che non ne restino di diretti). Test: patch di sezione non riscrive segreti in `project.yaml`.
- **2c** migrazione + backup + audit + avviso. Test: progetto vecchio con token in chiaro → dopo l'apertura `project.yaml` senza, `secrets.yaml` con, backup presente; secondo avvio: nessuna nuova migrazione.
- **2d** viaggio: `BACKED_UP`, export (`?segreti=`) + casella nell'IDE, deploy (include), upload 0600 + «tiene il suo se assente», import. Test: export senza/con; deploy fra due runtime di scarto (come `check_deploy_preserve`) con il token che arriva; backup+ripristino.
- **2e** git: `.gitignore` a `init`, aggiunta al commit, avviso se tracciato. Test con `git` vero in una cartella temporanea.
  **Deciso il 22-09-2026 scrivendo il codice**: sul repository già esistente il `.gitignore` **non basta** — git non ignora un file che è già nell'indice, e `git add -A` avrebbe
  continuato a committare `secrets.yaml` a ogni deploy. Quindi `commit()` fa anche `git rm --cached -- secrets.yaml` (il file resta sul disco, esce dallo snapshot) e l'avviso
  cambia senso: non «resta ignorato» ma «da questo commit non viaggia più; nei commit vecchi resta, ruota le credenziali».
- **2f** maschere/ripristini estesi, AI, redazione degli errori, `tls.key`. Test per gestore (GET maschera, PUT col segnaposto conserva, PUT con valore nuovo sostituisce), test della redazione dell'errore Telegram (URL con token → nessun token nel messaggio).
- **2g** guardia statica `check_segreti.sh`: (1) ogni campo di `project.rs` il cui nome somiglia a `pass|token|secret|key|pwd|connection_string` è nella tabella di `segreti.rs` (o in un elenco di eccezioni motivato) — la classe «campo segreto nuovo dimenticato»; (2) nessuna scrittura diretta di `project.yaml` fuori da `scrivi_progetto`; (3) nessun `tracing!`/`format!` che nomina `bot_token`/`password` senza redazione; (4) i template non hanno segreti. Guardia con stack `check_segreti_e2e.sh` (runtime di scarto: salva un token via API → `project.yaml` senza, `secrets.yaml` 0600 con, export senza, deploy con). Documentazione: HOWTO (un capitolo «Dove stanno le password»), manuale sicurezza, CHANGELOG.
- **2h** prova dal vivo su un runtime di scarto e, nel Passo 6, sul TC620 (deploy di `CasaDomotica` con Telegram; la notifica parte; export senza segreti).

### Da confermare col maintainer prima di scrivere codice
1. Portata: **tutti e sette i campi + le perdite** (consigliato) o solo Telegram/SMTP per cominciare.
2. Deploy: se lo zip non porta `secrets.yaml`, il dispositivo **tiene il suo** (consigliato) o lo cancella.
3. `.gitignore` anche nei repository già esistenti (consigliato) o solo a `init`. → **sì, anche negli esistenti** (22-09-2026), e con `git rm --cached` quando serve (vedi 2e).
4. `tls.key` a 0600 nello stesso passo (consigliato, piccolo).
5. Backup vecchi con il token in chiaro: solo avvertire (consigliato; il rimedio vero è ruotare il token) o offrire «ripulisci i backup precedenti».

## Passo 3 — Il viewer LVGL segue l'albero  (ramo `fix/lvgl-albero`)  [punto B7]
1. `resolve_start_page` (`sws-lvgl-viewer/src/client.rs:~357`): senza pagina iniziale dichiarata usa oggi `names.first()` (alfabetico). Passare da `GET /api/pages/nav`:
   home dichiarata → altrimenti la **prima dell'albero** (`riconcilia` + `appiattisci` di `sws-core::page_tree`). Test con la fixture condivisa.
2. **Navigatore**: la lettura dell'elenco a ogni render è una richiesta HTTP bloccante con un client nuovo (B8). Ridurla: rileggere solo al cambio di progetto (Q20) e alla prima apertura, altrimenti usare
   l'ultimo elenco; nei figli di griglia/faceplate non si rilegge. Provare con `--istantanea`/`--tocca` e misurare i tempi di cambio pagina.
3. Prova sul TC620 nel Passo 6.

## Passo 4 — L'albero nella cronologia e nel salvataggio  (ramo `fix/albero-annulla`)  [punti B9, B10]
Oggi l'albero si scrive subito sul server (debounce 300 ms) e non è annullabile; una pagina nuova non salvata è nell'albero scritto. **Proposta (default del piano): l'albero entra nella cronologia
come le pagine e si scrive in `saveAll`** insieme a loro: Ctrl+Z annulla spostamenti/eliminazioni/aggiunte, «Salva» scrive pagine e albero insieme, niente id orfani sul server, e il viewer vede l'albero
solo quando vede le pagine. Costo: `HistoryEntry` guadagna `pageTree`; `impostaAlberoPagine` non chiama più `persistiAlbero`; `saveAll` fa `api.updatePageLayout` se l'albero è cambiato rispetto
all'ultimo scritto (nuovo `savedPageTree`); il «dirty» dell'IDE conta anche l'albero. Test: undo/redo di un trascinamento; salvataggio unico; ricarica dopo l'annulla. **Alternativa** (scrittura immediata
+ conferma sull'eliminazione) da riprendere solo se il maintainer preferisce che l'albero sia «subito live».

## Passo 5 — Il resto del blocco B  (un ramo `fix/rifiniture-navigazione`)
- **B11 catalogo Host**: `GET /api/host/catalog` risponde per la macchina dell'IDE. Se l'IDE è collegato a un runtime remoto, instradare la richiesta al remoto (come le altre rotte `/api/remote/*`) e dichiararlo nella scheda;
  senza remoto vale il locale. Test sul proxy.
- **B12 barra del viewer**: `RuntimeView.tsx:381` mappa `pages` invece di `paginePerNavigazione(pages)`: verificare se nell'anteprima dell'IDE compaiono le pagine di boot; correggere e coprire con un test.
- **B13 `homeassistant-pro`**: il banner allarmi (`pro1_alarm_banner`, y 683.9–774) copre la barra di navigazione (y 738–782): spostare/ridurre il banner o alzare la barra (regole del parco R1–R5).
- **B14 schermo pieno**: `hide_viewer_chrome` + navigatore. Nota nel manuale 05 e, se il maintainer vuole, un avviso nell'IDE quando una pagina non ha nessun mezzo di navigazione.

## Passo 6 — Collaudo sul TC620  (nessun ramo; produce solo `STATUS.md` e, se serve, correzioni)
Lista di controllo con i comandi (il maintainer esegue, Claude legge i risultati solo con il via libera per il dispositivo di quel giorno):
1. Temperatura della sorgente Host (`thermal_zone` ≈ 60 °C) e stabilità di CPU/RAM/rete a 2 s.
2. Navigatore web e **LVGL** sul pannello vero: barra in fondo, colonna verticale, `children_of_current`, pagina nascosta da un navigatore e raggiunta da un altro.
3. Albero: ordine e gerarchia dopo un deploy e un riavvio del runtime.
4. **Immagine di boot dentro il container** (`docs/plans/2026-09-19-boot-image-collaudo-container.md`): con il runtime nel container, abilitare una pagina di boot e verificare `boot-image/status`.
5. **Q55**: una scrittura autenticata verso un 200 dal viewer LVGL (thread di rete) — osservare che completi; se sì, annotare la chiusura dell'ipotesi.
6. Segreti (dopo il Passo 2): deploy di un progetto con Telegram e verifica che la notifica parta; export senza segreti.

## Ordine e durata (stima)
0 → 1 → 2 → 3 → 4 → 5 → 6. Il Passo 2 è il più grosso (una sessione da solo); 0, 1, 3, 4 e 5 stanno ciascuno in mezza sessione; il 6 dipende dal container ricostruito e dal maintainer.

## Rischi
- Il Passo 2 tocca ogni percorso che legge o scrive `project.yaml` (deploy, backup, export, git, AI): serve una lista di controllo dei percorsi prima del codice.
- Il Passo 4 cambia il significato di «l'albero è live»: va confermato prima.
- Il Passo 1 può far emergere regressioni non previste: il tempo del Passo 1 va lasciato elastico.
