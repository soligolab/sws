# Q51 + Q52 — la scheda Runtime per l'utente: strumenti dev nascosti, installazione guidata (destinazione → credenziali → sondaggio → installa)

Ramo unico: `feat/Q51-Q52-installa-guidata` da `main`. Decisioni del maintainer (2026-09-09):
un ramo solo; **tutto il flusso** di Q52; la tabella mDNS generica vive **nel modulo Installa**
(«Cerca runtime» della sezione connessione resta com'è).

## Contesto

- **Q51.** In Configurazione → Runtime, «Pacchetto runtime» e «Installa su dispositivo → Binario»
  richiedono il checkout del repo (`scripts/package.sh`, `dist/`): per l'utente finale sono pulsanti
  che falliscono sempre. Il server sa già se gira da un checkout (`repo_root`, reso opzionale da
  Q48) ma l'editor non può distinguerlo: `GET /api/build/packages` risponde `[]` in entrambi i casi.
- **Q52.** Il modulo parte in modalità **Binario** e con utente **`root`** (contro la specifica
  delle credenziali dell'8 settembre). Nessuna precompilazione dal dispositivo connesso. Il discovery
  esistente trova solo runtime SWS (`_sws._tcp`). Specifica del maintainer: «SWS è agnostico… con
  mDNS mi dai una tabella dei dispositivi, se lo riconosco lo seleziono, tu mi chiedi le credenziali
  e connettendoti cerchi di capire che dispositivo è e se è pronto a ricevere il container».
- **Non è solo IDE**: tre rotte nuove lato server. Rilevato in pianificazione, detto al maintainer.

Regole che valgono: nessuna password in localStorage (`check_password_browser.sh`); ssh sempre
`StrictHostKeyChecking=accept-new` + `sshpass -e` (`check_chiave_host.sh`); chiave cambiata →
pulsante, mai automatico; nessun comando di produzione presuppone root/sudo; le guardie si
provano rosse prima che verdi; `--no-admin` non deve montare nulla di nuovo.

---

## Server (`sws-runtime/crates/sws-web`)

### 1. Q51 — `GET /api/build/stato` → `{ "repo": bool }`
- `packaging.rs`, dopo `new_repo_root` (L92-94): `pub(crate) fn stato_build_json(repo: &Option<PathBuf>) -> serde_json::Value` + handler `stato_build(State(s))` che legge `s.repo_root.as_ref()`.
- `router.rs`, in `admin_routes` dopo L368 (`/api/build/packages`). `deploy_only_app` non la monta → 404 sulla stretta.
- Test puro: `q51_stato_build_dice_se_il_repo_c_e`.

### 2. Q52a — `POST /api/device/probe {host, port=22, user, password}` → JSON checklist
**Principio: la sonda sul dispositivo raccoglie fatti, il Rust giudica.**
- Nuovo `deploy/container/sonda-dispositivo.sh`, **POSIX sh**, eseguito con `ssh … 'sh -s'` e lo script su **stdin** (una sessione, nessun file lasciato sul dispositivo; ogni comando esterno prende `</dev/null` perché stdin è lo script). Stampa righe `SONDA chiave=valore`, esce sempre 0. Fatti: `hostname`, `arch` (`uname -m`), `kernel`, `utente`, `uid`, `os_name/os_id/os_version` (`/etc/os-release`), `podman` + `podman_versione`, `storage_root` (`podman info --format '{{.Store.GraphRoot}}'`, install-container.sh L265), `spazio_kb` (`df -Pk … awk 'NR==2{print $4}'`, L266), `subuid/subgid` (`grep "^$U:" /etc/subuid`), `linger` (`loginctl show-user … Linger=yes`, L394), `xdg_runtime_dir`, `systemd_user` (`systemctl --user is-system-running`), `data_path=/data/user/sws` + `data_stato` (scrivibile / assente-creabile / non-scrivibile), `container_sws` (`podman container exists sws-runtime`, L351) + immagine + `systemctl --user is-active`, `fine=1`. Fallback per busybox (`uname -n`, `sconosciuto`, `timeout` opzionale).
- `packaging.rs`: `pub(crate) const SONDA_DISPOSITIVO_SH: &str = include_str!(…)` — **costante separata** da `CONTAINER_DEPLOY_EMBEDDED` (i test L1853/L1911 pretendono che quella lista coincida con ciò che l'installer legge).
- Tipi: `ProbeBody` (deny_unknown_fields), `Esito {Ok, Avviso, Errore}`, `Controllo {id, esito, titolo, dettaglio, rimedio: Option}`, `Dispositivo`, `SwsInstallato`, `Sonda {ok_ssh, chiave_host_cambiata, sshpass, dispositivo, controlli, variante_immagine, sws, pronto, diagnostica}`.
- Funzioni pure: `analizza_righe_sonda(&[String]) -> Fatti` (ignora banner/Warning/ERROR, ultima occorrenza vince), `variante_immagine(arch, os_id, os_name)` (aarch64 → `latest-arm64` se os-release contiene «pixsys», altrimenti `latest-arm64-generic`: **è una proposta**, l'utente la cambia; x86_64 → `latest-amd64`; altro → None come install-container.sh L183-199), `versione_podman_ok` (≥ 4.4), `versione_da_tag_immagine` (CalVer dal tag; `latest-*` → None: l'immagine non ha label di versione), `valuta_sonda(&Fatti)`, `pronto()` = ok_ssh ∧ `fine=1` ∧ nessun Errore.
- Regole di `valuta_sonda` (testi che rispecchiano l'installer): podman assente → Errore; podman < 4.4 → Errore; subuid/subgid mancanti → Errore con `usermod --add-subuids …` da un amministratore; linger spento → **Avviso** (l'installer prova ad abilitarlo); `systemctl --user` non raggiungibile → Errore; spazio < 1,5 GB → Errore (formula 500 MB × 3 di L276); cartella dati assente-creabile → Avviso, non scrivibile → Errore; arch non riconosciuta → Errore; uid 0 → Avviso «stai installando come root: il percorso è rootless»; SWS già presente → Avviso informativo (versione, attivo/fermo: «sarà aggiornato»); manca `fine=1` → Errore «sonda interrotta».
- Handler `sonda_dispositivo(State, Extension<AuthUser>, EJson<ProbeBody>)`: `destinazione_ssh_sicura`, porta ≠ 0; raccolta righe con closure che accumula in `Arc<Mutex<Vec<String>>>` passata a **`run_ssh_cmd_stdin` esistente** (L1641: sshpass/SSHPASS, BatchMode, ConnectTimeout, accept-new e il riconoscimento «chiave cambiata» restano in UN posto); `chiave_host_cambiata` = presenza della riga `AZIONE: chiave-host-cambiata` che l'helper già emette (L1775); `tokio::time::timeout(30 s)`; **ritocco all'helper: `cmd.kill_on_drop(true)`** così il timeout non lascia un ssh orfano; `diagnostica` = righe non-SONDA solo quando `ok_ssh` è falso; audit `device.probe` con host/port/user/esiti, **mai la password**.
- `router.rs`: in `admin_routes` dopo `/api/device/hostkey/forget` (L384-387).

### 3. Q52b — `GET /api/discover/dispositivi` → tabella LAN
- `discover.rs`: `TIPI_SERVIZIO = [_ssh._tcp, _sftp-ssh._tcp, _workstation._tcp, _sws._tcp]` con nomi brevi `ssh/sftp/workstation/sws`. **Niente meta-query** `_services._dns-sd._udp` (mdns-sd 0.20.3 la accetta ma poi tratta i tipi come istanze da risolvere; la lista che interessa è fissa): quattro `daemon.browse` concorrenti sullo stesso daemon, multiplex con `try_recv` + sleep 25 ms, deadline 3 s, `spawn_blocking` come oggi.
- `Osservazione {servizio, host, port, v4, any, txt}` ridotta da `ServiceResolved`; `raggruppa_per_host(Vec<Osservazione>, &local_nets) -> Vec<DispositivoLan>`: chiave hostname lowercase senza punto finale, indirizzo con `pick_address_from` esistente (chi non ha indirizzo si scarta), `servizi` ordinati/dedup, `sws {presente, versione, container, admin_url}` dalle TXT con le stesse regole di L147-159 (estrarre `sws_da_txt` e riusarla in `browse_mdns_blocking`), uscita ordinata per hostname. Un host con solo `workstation` compare comunque: il sondaggio dirà se ssh risponde.
- `router.rs`: in `admin_routes` (installare è Admin); `/api/discover` supervisor resta.

### 4. Guardie e test server
- `packaging.rs`: `la_sonda_incorporata_e_identica_al_file_nel_repo`, `la_sonda_dichiara_sh_posix` (shebang `#!/bin/sh`, niente `[[`/`local `/`BASH_SOURCE`), `le_righe_sonda_si_leggono_e_il_rumore_ssh_si_ignora`, `arch_diventa_variante_immagine`, `podman_troppo_vecchio_e_un_errore_con_rimedio`, `linger_spento_e_un_avviso_non_un_errore`, `spazio_sotto_1_5_gb_e_un_errore`, `cartella_dati_assente_ma_creabile_e_un_avviso`, `pronto_solo_senza_errori_e_con_la_riga_fine`, `versione_da_tag_immagine`.
- `discover.rs`: `raggruppa_i_servizi_dello_stesso_host` (case-insensitive), `sws_presente_porta_versione_e_admin_url`, `host_senza_indirizzo_non_compare`, `l_uscita_e_ordinata_per_hostname`.
- `scripts/check_no_admin.sh` L94-96: aggiungere `"GET /api/build/stato" "POST /api/device/probe" "GET /api/discover/dispositivi"` alla lista «404 sulla stretta, non-404 sulla normale». Rossa prima delle rotte.
- Nuova guardia `scripts/check_sonda.sh` (registrata in `check_static.sh` fra le STATICHE): `sh -n`/`bash -n`, `shellcheck -s sh` se c'è, esegue la sonda **su questo PC** e pretende exit 0, ogni riga `SONDA `, presenti `arch=`, `podman=`, `fine=1`. (Il giro completo via ssh su 127.0.0.1 resta manuale: richiede una password.)

---

## Editor (`sws-editor`)

### 5. `src/api/client.ts`
Tipi `BuildStato`, `EsitoControllo`, `ControlloDispositivo`, `VarianteImmagine`, `SondaggioDispositivo`, `DispositivoRete` accanto a `DiscoveredRuntime` (L185). Helper su `request<T>`: `buildStato()`, `deviceProbe(b)`, `discoverDispositivi()`. Il componente passa a usare gli helper già esistenti `api.deviceHostKeyForget` (L1381) e `api.deployDeviceContainer` (Q48) al posto delle due `fetch` grezze (L8447, L8481).

### 6. Nuovo `src/config/installazione/`
- `sondaggio.ts` (puro): `REGISTRY_IMMAGINE`, `hostDaUrl(target)`, `imageRefDaVariante(v)`, `imageRefAutomatico(ref)` (vuoto o nostro registry → il sondaggio può sovrascrivere), `esitoComplessivo(controlli)`, `etichettaDispositivo(d)` («wp630 · aarch64 · Yocto 4.0 · user (uid 1000)»), `installazioneConsentita(s)` = `s === null || (s.ok_ssh && s.pronto)`. Il server decide `pronto`; il client non ricalcola. **Nessun «Installa comunque»**: il caso dev è coperto dal ramo Binario visibile solo con repo.
- `ListaControlli.tsx` (props: `sondaggio`): riga dispositivo o `cfg.probeNoSsh`; riga SWS installato/assente; una riga per controllo ✓/⚠/✗ + titolo — dettaglio, rimedio sotto in piccolo; bordo colorato con `esitoComplessivo`.
- `TabellaDispositivi.tsx` (props: `dispositivi | null`, `inCorso`, `errore`, `onScegli(host)`): tabella hostname / indirizzo / servizi a pill / pill «SWS vX»; click riga → `onScegli(hostname || indirizzo)`; vuoto → `cfg.devicesNone`; errori con `cfg.discoverUnreachable/Failed` esistenti.
- Test `tests/sondaggio.test.ts` (modello `tests/containerDeploy.test.ts`).

### 7. `RuntimeConnectionTab` (ConfigView.tsx)
- **Stato** (L8174-8225): `deviceUser` → `"user"`; `deployMode` → `"container"`; nuovi `repoDisponibile: boolean|null`, `hostTouched`, `dispositivi/cercandoDispositivi/erroreDispositivi`, `sondaggio/sondando/erroreSondaggio`, `varianteSuggerita`, `ultimaAzione = useRef<"sondaggio"|"deploy"|null>`. `const repo = repoDisponibile === true` (null → come false: **nessun lampeggio di UI dev**).
- **Q51**: un solo `useEffect` al mount sostituisce L8368/L8379: `api.buildStato()` (catch → false: runtime vecchio o irraggiungibile = UI utente); se `repo` allora `fetchPackages` + `fetchContainerPackages`, altrimenti niente (risponderebbero `[]`). Secondo effetto: `repoDisponibile === false` → `setDeployMode("container")`, `setContainerSource("registry")`. Sezione «Pacchetto runtime» (L9167-9220) avvolta in `{repo && …}`.
- **Prefill host**: effetto su `[status, remoteConnectedStore, target, hostTouched, deviceHost]`: se non toccato e vuoto e connesso → `setDeviceHost(hostDaUrl(target))`. L'input Host imposta `hostTouched`. `scegliHost(h)` (tabella e click sui runtime scoperti L8838): `hostTouched`, host, azzera `sondaggio` e `chiaveHostCambiata`. Cambio di host/porta/utente azzera `sondaggio` (una checklist verde su credenziali diverse mentirebbe).
- `cercaDispositivi()` copia 1:1 di `handleDiscover` (L8349) su `api.discoverDispositivi`.
- `eseguiSondaggio()`: `ultimaAzione = "sondaggio"`, `api.deviceProbe`, set sondaggio, `chiave_host_cambiata` → box giallo, se `variante_immagine` e `imageRefAutomatico(imageRef)` → `setImageRef(imageRefDaVariante(v))` + `varianteSuggerita`.
- `handleDimenticaChiaveHost` generalizzato: dopo il forget rilancia `eseguiSondaggio` o `handleContainerDeploy` secondo `ultimaAzione`. `handleContainerDeploy` imposta `ultimaAzione = "deploy"` e usa `api.deployDeviceContainer(containerDeployPayload(...))` con la stessa lettura streaming. Il box giallo diventa uno solo, fuori dal ramo container, sotto il blocco Sondaggio.
- **JSX della sezione** (sostituisce L9226-9596, via il wrapper `{( … )}` no-op): titolo; toggle Binario/Container **solo se `repo`**; **1 · Destinazione** (host, porta, «Cerca dispositivi in rete», `TabellaDispositivi`); **2 · Credenziali SSH** (utente, password `autoComplete="off"`, placeholder `cfg.passwordSession`); **3 · Verifica del dispositivo** («Verifica dispositivo», errore, `ListaControlli`, box giallo); **4 · Immagine** (ramo binario come oggi solo se `repo`; selettore registry/archivio solo se `repo`; pulsanti variante che azzerano `varianteSuggerita`; nota «Variante X suggerita dalla verifica»; imageRef; tmp dir, data path, cleanInstall come oggi L9386-9418); **5 · Installa** (pulsante `disabled` se `!installazioneConsentita(sondaggio)` con title `cfg.installBlockedByProbe`; etichetta «Aggiorna» se `sondaggio?.sws.installato`; log streaming esistente; blocco «Gestione container» L9508+ **intatto**).

### 8. i18n
Chiavi nuove sotto `cfg` in it.json e en.json: `installTitle, runtimePackageTitle («Pacchetto runtime (solo sviluppo)»), buildFull, deployModeBinary («Binario nativo (solo sviluppo)»), deployModeContainer, selectedPackage, selectedImage, deviceModel, dataPathOnDevice, requiresSshpass, stepTarget, stepCredentials, stepProbe, stepImage, stepInstall, devicesSearch, devicesSearching, devicesNone, devicesSwsPresent, devicesColHost, devicesColAddress, devicesColServices, probeRun, probeRunning, probeNoSsh, probeSwsInstalled, probeSwsActive, probeSwsStopped, probeSwsAbsent, imageVariantSuggested, installBtn, installUpdateBtn, installBlockedByProbe, noRuntimeFound`. Le etichette hardcoded delle due sezioni toccate passano alle chiavi. Riuso: `sshHost, port, sshUser, sshPassword, passwordSession(Title), imageSource*, imageRef*, imageVariant*, cleanInstall*, hostKey*, discoverUnreachable/Failed`.
- Nuovo `tests/i18nParita.test.ts`: appiattisce it.json/en.json e pretende gli stessi insiemi di chiavi (due `expect` separate: solo-in-it, solo-in-en). **Scritto prima** delle chiavi Q52, così la prima corsa è rossa per natura; se it/en divergono già oggi lo dice e si corregge.

---

## Documenti, alla fine
- `docs/OPEN_QUESTIONS.md`: Q51 e Q52 **Decided** (2026-09-09, maintainer: un ramo, tutto il flusso, tabella nel modulo Installa), con ciò che è stato realizzato e i limiti dichiarati (mDNS mostra solo chi si annuncia; variante arm64/generic è una proposta; versione SWS dal tag solo se CalVer).
- `CHANGELOG.md` [Unreleased]; `STATUS.md` con le prove a mano; `scripts/README.md` riga per `check_sonda.sh`; `docs/HOWTO.md` §5 o nuovo capitolo breve «Installare su un dispositivo dall'editor» se il flusso lo merita.

## Ordine di lavoro
1. Ramo. `check_no_admin.sh` con le tre rotte → **rosso**. `tests/i18nParita.test.ts` → corsa iniziale.
2. Q51 server (funzione, handler, rotta, test) → editor (`buildStato`, `repoDisponibile`, gating). `cargo test`, `check_no_admin` ancora rosso per le altre due.
3. `sonda-dispositivo.sh` + `check_sonda.sh` (rosso finché lo script non esiste, poi verde in locale).
4. Server probe: tipi, funzioni pure **con test scritti prima**, handler, `kill_on_drop`, rotta.
5. Server discovery: `Osservazione`, `raggruppa_per_host` + test, browse, handler, rotta. `check_no_admin` → verde.
6. Editor: client, `installazione/*`, test, riscrittura sezione, i18n → tsc, lint, vitest, build, `check_password_browser.sh`.
7. Gate completo: `cargo test --workspace`, clippy `-D warnings`, fmt, `check_static.sh` (15 guardie), `check_chiave_host.sh`, `check_no_admin.sh`, `check_sonda.sh`. Prima di toccare `scripts/`: `pgrep -af build_container` (regola del 2026-09-09).
8. Docs; commit sul ramo; merge/push solo su istruzione.

## Verifica end-to-end (manuale, maintainer)
1. `start_editor.sh` (repo presente): «Pacchetto runtime» visibile; toggle Binario/Container con **Container** preselezionato; «Archivio locale» presente; Network: `build/stato → {repo:true}` poi `packages`.
2. Runtime da una cartella senza `scripts/` (o il container amd64): nessuna sezione dev, nessun toggle, nessuna opzione archivio, nessuna chiamata a `build/packages`, nessun lampeggio.
3. Connesso a `https://wp630…:8444`: Host SSH precompilato con l'hostname; digitare e riconnettersi: il valore resta.
4. «Cerca dispositivi in rete»: la WP630 in tabella con pill servizi e «SWS vX»; click → host impostato.
5. «Verifica dispositivo» con `user`: riga «wp630 · aarch64 · …», checklist, SWS installato/assente, imageRef → `…:latest-arm64` con nota «suggerita»; pulsante «Aggiorna».
6. Password sbagliata: `probeNoSsh` + dettaglio; Installa spento con title.
7. Dopo factory reset: sondaggio → box giallo → «Dimentica e riprova» rilancia il **sondaggio**; poi Installa → se ricompare, rilancia il **deploy**.
8. Cambiare porta/utente dopo un sondaggio verde: checklist sparisce, Installa torna «non verificato».
9. Deploy completo verso la WP630 con log streamato; «Gestione container» intatto.

## Rischi dichiarati
- mdns-sd 0.20.3: `_ssh._tcp` è annunciato solo da host con Avahi `publish-ssh`/macOS: la tabella è incompleta per costruzione (in Q52).
- Sonda POSIX su busybox: fallback per `hostname`, `loginctl`, `timeout`; `podman info` lento su SD → `timeout 15` remoto + 30 s Rust + `kill_on_drop`.
- Euristica «pixsys» in os-release per arm64 vs arm64-generic non verificata sul campo: proposta modificabile; da fissare nel test dopo il primo sondaggio reale.
- `ConfigView.tsx` enorme: crescita netta vicina a zero grazie ai due componenti estratti e alle `fetch` tolte.
