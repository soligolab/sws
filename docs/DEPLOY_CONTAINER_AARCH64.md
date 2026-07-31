# Deploy del runtime in container podman su device aarch64

> Percorso per i device **Pixsys OS** (aarch64) dove il runtime deve girare in
> un container podman rootless, invece che come servizio systemd nativo.
>
> **In breve**: `build_container.sh --push` sulla macchina di sviluppo,
> `install-container.sh --pull` sul dispositivo. Il resto di questo documento
> spiega il perché di ogni pezzo — serve quando qualcosa non torna, non per un
> aggiornamento di routine.
>
> Per un device **x86_64** (non aarch64), stesso installer e stessa esperienza, vedi
> `docs/DEPLOY_CONTAINER_X86_64.md` — non `docs/DEPLOY_PX30.md`, che copre target
> ARM64 generici (Raspberry Pi, Jetson...) buildati da un laptop x86, non un target
> x86_64.
>
> Non sostituisce il percorso **binario nativo Yocto**
> (`docs/YOCTO_CROSSCOMPILE.md`) — resta preferibile quando si può installare come
> servizio di sistema invece che in container.
>
> Il **container x86 legacy** (`docs/DEPLOY_PX30.md`, `compose.yaml`,
> `sws-runtime/docker/Dockerfile`) è un flusso storico, **non** quello descritto
> qui. La sua pubblicazione automatica in CI è disattivata: costruiva un'immagine
> che non parte, all'indirizzo che il README pubblicizza.

## Come è fatta l'immagine

`deploy/container/Containerfile.aarch64` **non compila nulla**. Copia dentro il binario
già cross-compilato dall'SDK Pixsys, la SPA e i template. Una build Rust dentro
un'immagine arm64 emulata richiederebbe ore; così dura secondi (a parte
l'`apt-get`, che sotto QEMU resta lento la prima volta).

### Perché `ubuntu:24.04` e non `debian:bookworm-slim`

Non è una preferenza: il binario cross-compilato lo impone. Verificabile con

```bash
readelf -d sws-runtime/target/aarch64-unknown-linux-gnu/release/sws-runtime | grep NEEDED
readelf -V sws-runtime/target/aarch64-unknown-linux-gnu/release/sws-runtime | grep -o 'GLIBC_[0-9.]*' | sort -uV | tail -1
```

che danno `libpython3.12.so.1.0` e `GLIBC_2.39`. Quindi la base deve avere
**insieme** Python 3.12 e glibc ≥ 2.39:

| Base | glibc | Python | Esito |
|---|---|---|---|
| `debian:bookworm-slim` | 2.36 | 3.11 | ❌ doppiamente incompatibile |
| `debian:trixie-slim` | 2.41 | 3.13 | ❌ manca `libpython3.12` |
| **`ubuntu:24.04`** | **2.39** | **3.12** | ✅ |

Se l'SDK Pixsys passa a un'altra minor di Python, questa scelta va rifatta:
ricontrollare con `readelf -d` e aggiornare base e pacchetto `libpython3.12t64`
nel Containerfile.

### Vincolo sul kernel dell'host

Il binario è marcato `for GNU/Linux 5.15.0` e **i container condividono il
kernel dell'host**: su un BSP con kernel più vecchio non parte, né in container
né nativo. Verificare con `uname -r` prima di iniziare. (Su Pixsys OS 2.0.0-dev
il kernel è 6.12, quindi il vincolo è ampiamente soddisfatto.)

### Differenze rispetto all'immagine legacy

Il Dockerfile legacy ha quattro difetti che questo percorso evita:

| Legacy | Qui |
|---|---|
| compila Rust nell'immagine (ore in emulazione) | binario precompilato, copia |
| builder senza `libpython3-dev` → link pyo3 fallisce | nessuna compilazione |
| `CMD` senza `--viewer-port`/`--www` → viewer mai in ascolto, healthcheck su 8443 sempre rosso | flag completi nel `CMD`, healthcheck su **http** (il runtime parte in HTTP finché non c'è `config/tls.crt`) |
| entrypoint che pretende `SWS_ADMIN_PASSWORD` (precede il no-auth mode) | nessun entrypoint script |
| template non copiati → `GET /api/templates` sempre vuoto | `examples/templates` dentro l'immagine |

Inoltre l'immagine installa **RestrictedPython**: senza, il motore script parte
non sandboxato con un warning all'avvio.

## La procedura in tre fasi

**Compilare** sulla macchina di sviluppo (l'unica con l'SDK) → **pubblicare** sul
registry → **installare** sul dispositivo con un comando. La strada offline con
l'archivio resta, per i dispositivi che il registry non lo vedono.

```
 macchina di sviluppo                 ghcr.io                   dispositivo
 ────────────────────                 ───────                   ───────────
 build_container.sh --push  ────────►  immagine  ────────────►  install-container.sh --pull
   (SDK Yocto + podman)                pubblica                   (nessuna credenziale)
```

## 1. Compilare

Prerequisiti: SDK Pixsys in `/usr/local/oecore-x86_64/`, `podman`, binfmt
aarch64 registrato (`ls /proc/sys/fs/binfmt_misc/qemu-aarch64`), rete verso
Docker Hub per `ubuntu:24.04`.

```bash
./scripts/build_container.sh                     # cross-build + immagine + archivio
./scripts/build_container.sh --no-rust           # riusa il binario aarch64 esistente
./scripts/build_container.sh --no-spa            # riusa sws-editor/dist così com'è
./scripts/build_container.sh --no-save --push    # solo pubblicazione, niente archivio
```

L'immagine contiene **tutto ciò che serve**: binario, template e la SPA. Un solo
artefatto, quindi nessun modo di ritrovarsi sul dispositivo una SPA di una
versione diversa dal binario — è già costato una caccia al fantasma quando
viaggiavano separate.

| Artefatto | Quando serve | Dimensione |
|---|---|---|
| immagine sul registry | strada normale (`--push`) | 64,8 MB in totale, ma vedi sotto |
| `dist/sws-runtime-<versione>-aarch64-image.tar.gz` | dispositivi senza rete | ~59 MB |

Lo script rifiuta di procedere se il binario in
`target/aarch64-unknown-linux-gnu/release/` non è ARM aarch64: senza quel
controllo un binario host finirebbe nell'immagine e l'errore salterebbe fuori
solo al `podman run` sul device.

### L'ordine dei layer non è estetico

| Layer | Dimensione | Cambia |
|---|---|---|
| base `ubuntu:24.04` | 103 MB | mai |
| apt + python + RestrictedPython | 59 MB | quasi mai |
| **binario** | 35 MB (14,3 compressi) | a ogni modifica Rust |
| **SPA** | 0,4 MB | a ogni modifica frontend |

Un layer che cambia invalida tutti quelli **sotto** di sé, e col registry si
trasferisce solo ciò che è cambiato. Da qui due regole già pagate a caro prezzo:
la SPA sta **dopo** il binario (invertirli farebbe ritrasferire 14 MB per un
ritocco al frontend) e le `LABEL` stanno **in fondo** — messe dopo il `FROM`
invalidano il layer `apt`, che sotto emulazione QEMU si ricostruisce in 15
minuti contro i 2,7 secondi di una build con la cache calda. Misurato, non
supposto.

## 2. Pubblicare

Serve una volta sola: un token GitHub e il login sulla macchina di sviluppo.

**Token**: `github.com` → Settings → Developer settings → Personal access tokens
→ **Tokens (classic)** → *Generate new token (classic)*, scope **`write:packages`**
(spuntandolo arriva anche `read:packages`; `repo` solo se il repository è
privato). Scadenza a termine, non "No expiration". I token *fine-grained* hanno
un supporto disomogeneo per i package: per GHCR usare i classic.

**Login** (una volta, sulla macchina che pubblica):

```bash
podman login ghcr.io -u <utente-github>
# incolla il token alla richiesta Password: — MAI in --password, che lo
# lascerebbe nella history della shell e nell'output di ps
```

**Pubblicazione**:

```bash
./scripts/build_container.sh --push
```

Due tag per la stessa immagine:

| Tag | A cosa serve |
|---|---|
| `ghcr.io/soligolab/sws-runtime:<versione>-arm64` | mobile: è quello che i dispositivi seguono |
| `ghcr.io/soligolab/sws-runtime:<sha>-arm64` | immutabile: dice da quale commit nasce |

Il suffisso `-arm64` è deliberato: l'immagine **non** è una manifest list
multi-arch, e un tag nudo farebbe fallire un pull su x86 con un `no matching
manifest` incomprensibile invece di dire che quell'immagine è solo per arm64.

Lo script si rifiuta di pubblicare **con l'albero di lavoro sporco** o senza
login, e controlla entrambe le cose *prima* della cross-compilazione: scoprire
dopo minuti di build che manca il login è tempo buttato. La ragione della prima
guardia: il tag di provenienza indicherebbe un commit che non contiene ciò che
stai pubblicando, e fra sei mesi «cosa c'è sul dispositivo» non avrebbe risposta.

### Rendere pubblico il package (solo la prima volta)

I package su GHCR nascono **privati**, e un package privato costringerebbe a
mettere un token anche sui dispositivi. Da rendere pubblico a mano:

`https://github.com/users/soligolab/packages/container/sws-runtime/settings` →
Danger Zone → *Change visibility* → **Public** (chiede di riscrivere
`sws-runtime` per conferma).

> Il percorso `github.com/orgs/soligolab/...` dà 404: `soligolab` è un account
> utente, non un'organizzazione.

**Come si verifica che sia davvero pubblico.** Non con un `curl` nudo: GHCR
pretende un bearer token anche per le immagini pubbliche, quindi risponde `401`
in ogni caso e quel `401` **non dimostra niente**. La verifica giusta, da
eseguire dal dispositivo:

```bash
TOK=$(curl -s "https://ghcr.io/token?scope=repository:soligolab/sws-runtime:pull&service=ghcr.io" \
      | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer $TOK" \
     https://ghcr.io/v2/soligolab/sws-runtime/manifests/latest-arm64   # 200 = pubblico
```

## 3. Installare sul dispositivo

```bash
scp deploy/container/install-container.sh \
    deploy/container/sws-runtime.container  user@<device>:/tmp/
ssh user@<device> 'cd /tmp && ./install-container.sh --pull'
```

Nessuna credenziale sul dispositivo: l'immagine è pubblica. **Verificato**: il
dispositivo di prova non è loggato su `ghcr.io` (`podman login --get-login`
risponde *not logged into*) e scarica lo stesso.

Un **aggiornamento** successivo è lo stesso comando: base e apt sono già lì,
quindi si trasferisce solo il layer cambiato.

```bash
ssh user@<device> 'cd /tmp && ./install-container.sh --pull'                    # ultima versione
ssh user@<device> 'cd /tmp && ./install-container.sh --pull <registry>:<sha>-arm64'  # versione precisa
```

L'installer gira **come utente normale, senza sudo** (podman rootless) ed è
idempotente: prepara le directory dati, procura l'immagine, verifica che
contenga la SPA, installa l'unit quadlet, abilita il linger e attende `/health`.
I dati esistenti non si toccano; il container precedente **va** rimosso, perché
continuerebbe a usare l'immagine vecchia anche dopo aver scaricato la nuova
sullo stesso tag.

Il pull avviene **prima** di fermare il servizio: se la rete non c'è, il
dispositivo resta esattamente com'era invece di restare senza runtime.

### Ripiego offline

Per un dispositivo che il registry non lo raggiunge, l'immagine viaggia come
archivio — ed è l'unico file da copiare, la SPA è dentro:

```bash
./scripts/build_container.sh                    # produce dist/…-aarch64-image.tar.gz
scp dist/sws-runtime-<versione>-aarch64-image.tar.gz \
    deploy/container/install-container.sh \
    deploy/container/sws-runtime.container  user@<device>:/tmp/
ssh user@<device> 'cd /tmp && ./install-container.sh --image sws-runtime-<versione>-aarch64-image.tar.gz'
```

### Aggiornare il dispositivo automaticamente: perché non lo facciamo

`podman auto-update` funzionerebbe: basterebbe
`Label=io.containers.autoupdate=registry` nella unit e
`systemctl --user enable --now podman-auto-update.timer` (Pixsys OS fornisce già
quelle unit, disabilitate). **Scelta esplicita di non attivarlo**: su una
macchina in servizio un riavvio del runtime che nessuno ha chiesto è peggio di
un aggiornamento tardivo, e un push sbagliato arriverebbe sul campo da solo.
Gli aggiornamenti si fanno a comando.

### Dove stanno i dati

Bind mount su un percorso esplicito dell'host, non volumi nominati: i dati
restano visibili e copiabili senza passare da `podman volume inspect`, e `/data`
è la partizione scrivibile sui device Pixsys — stessa collocazione
dell'installazione nativa.

```
/data/user/sws/projects   progetti (dati utente)
/data/user/sws/config     certificati TLS, registro progetti
/data/user/sws/logs       log JSONL rotati
```

Qui ci sono **solo i dati**. La SPA non è più fra questi: dal 2026-07-30 sta
nell'immagine, e la unit non monta più `www` — montare una directory dell'host
sopra `/var/sws/www` nasconderebbe la SPA dell'immagine, con l'effetto di una
interfaccia vuota e nessun indizio del perché. Una `/data/user/sws/www` lasciata
da un'installazione precedente è innocua: l'installer la segnala e **non** la
tocca.

Funziona sotto rootless perché il container gira come root e in rootless
l'UID 0 del container è mappato sull'utente dell'host: i file creati risultano
di `user`, proprietario di `/data/user/sws`. Con podman **rootful** il mapping
sarebbe diverso e i permessi andrebbero rivisti.

`/data/user` è scrivibile dall'utente, `/data` no: da qui la scelta del percorso.

### Aggiornare il frontend

Non esiste più una strada separata: si aggiorna l'immagine, e basta.

```bash
ssh user@<device> 'cd /tmp && ./install-container.sh --pull'
```

Trasferisce il solo layer della SPA (~0,4 MB) e riavvia il container, che
impiega un paio di secondi. Il prezzo rispetto al vecchio `--www-only`, che
scriveva nel bind mount senza riavviare, è quel riavvio; in cambio non esiste
più il modo di avere sul dispositivo una SPA e un binario di versioni diverse.

### Recuperare i progetti da un'installazione pre-2026-07-28

Le versioni precedenti tenevano i dati in volumi nominati
(`sws-projects`, `sws-config`, `sws-logs`) invece che in bind mount. Se dopo un
aggiornamento i progetti sembrano spariti, sono lì:

```bash
./install-container.sh --pull --migrate-volumes
```

**È opt-in di proposito.** Prima la migrazione scattava da sola quando la
cartella di destinazione era vuota — che è esattamente lo stato in cui
`--uninstall --purge` lascia il dispositivo. Risultato visto dal vivo il
2026-07-30: un deploy che doveva essere pulito si è ritrovato in servizio un
progetto di due giorni prima, ripescato dal vecchio volume. Quando i volumi
esistono ancora, l'installer lo dice senza toccarli.

Opzioni:

| Flag | Effetto |
|---|---|
| `--pull [REF]` | scarica dal registry. Senza `REF`: `ghcr.io/soligolab/sws-runtime:latest-<arch>`, con `<arch>` dedotta **qui sul dispositivo** da `uname -m` |
| `--pull-only [REF]` | procura l'immagine ed esce, senza toccare il servizio in esecuzione |
| `--image ARCHIVIO` | carica da archivio: dispositivi senza rete verso il registry |
| `--data DIR` | directory dati alternativa (default `/data/user/sws`) |
| `--migrate-volumes` | recupera i dati dai volumi nominati pre-2026-07-28 |
| `--bridge` | rete bridge con porte pubblicate, **al prezzo della discovery mDNS** (vedi sotto) |
| `--host-network` | non serve più: `Network=host` è il default. Accettata per compatibilità |
| `--no-autostart` | solo `podman run`, nessuna unit systemd: non riparte dopo il reboot |
| `--uninstall` | rimuove servizio e container, **conserva i dati** |
| `--uninstall --purge` | rimuove anche i dati, quindi i progetti |
| `--www`, `--www-only` | dismesse: falliscono spiegando che la SPA è nell'immagine |

Senza né `--pull` né `--image` l'installer riusa l'immagine già presente sul
dispositivo: utile per riscrivere la unit (per esempio passando a `--bridge`)
senza ritrasferire niente.

### Dall'IDE, senza toccare il terminale

Configurazione → Runtime → **Installa su dispositivo** → *Container (Podman)*
fa le stesse cose via SSH. La sorgente si sceglie lì:

- **Registry** (default): sul dispositivo arrivano solo l'installer e la unit
  (pochi kB) e il resto lo scarica lui. Il campo *Riferimento immagine* è
  facoltativo — vuoto significa `latest-<arch>`, con l'architettura decisa dal
  dispositivo.
- **Archivio locale**: copia via `scp` un `.tar.gz` da `dist/` (~59 MB). Serve
  dove il registry non si raggiunge.

La spunta **Installazione pulita** aggiunge un `--uninstall --purge` prima
dell'installazione, con conferma. Dal registry l'immagine viene procurata prima
di cancellare (`--pull-only`): se il pull fallisce non si cancella niente e il
dispositivo resta com'è, invece di restare senza dati **e** senza runtime.

### Avvio automatico al boot

Un container rootless **non** riparte dopo un reboot, nemmeno con
`--restart=unless-stopped`: quel flag vale finché il servizio utente di podman è
vivo, e al boot nessuno lo avvia. Servono due cose, che l'installer configura:

1. `loginctl enable-linger <utente>` — senza, i servizi utente muoiono al logout
   e non partono al boot;
2. l'unit **quadlet** `deploy/container/sws-runtime.container`, copiata in
   `~/.config/containers/systemd/`, da cui systemd genera `sws-runtime.service`.

Da lì il container si gestisce come qualunque servizio, sempre senza sudo:

```bash
systemctl --user status  sws-runtime
systemctl --user restart sws-runtime
journalctl --user -u sws-runtime -f
```

Quadlet e non `podman generate systemd`: è il meccanismo supportato da podman
4.4+ e l'unit non va rigenerata quando cambia l'immagine.

### Discovery mDNS: la rete host è il default

Sulla rete rootless di podman (`slirp4netns`) il multicast non esce verso la
LAN, quindi "Cerca runtime" nell'IDE non trova il dispositivo. Per questo
`Network=host` è il **default** dell'installer dal 2026-07-30: chi installa
senza flag ottiene la configurazione che funziona. `--bridge` torna al
comportamento precedente, e l'installer in quel caso lo dice esplicitamente.

Misurato sul dispositivo il 2026-07-30, dallo stesso editor e a pochi minuti di
distanza: in bridge `GET /api/discover` risponde `[]`; in host network
restituisce il runtime con `admin_url http://192.168.1.84:8444`. Un altro
indizio che la rete host è effettiva: l'istanza annunciata passa dall'ID del
container (`e6ddc6b11b87`) all'hostname del dispositivo.

Attenzione a due dettagli emersi provandolo:

- Il runtime annuncia lo **schema** reale (`http` finché non c'è un
  certificato). Le versioni precedenti annunciavano sempre `https`, quindi anche
  quando la discovery funzionava l'URL offerto non rispondeva.
- Lo stesso runtime compare **due volte** in `/api/discover`. La causa non è
  "un'entry per indirizzo" come si era annotato: misurato il 2026-07-30, le due
  voci portano lo **stesso** indirizzo. È `browse_mdns_blocking`
  (`sws-web/src/discover.rs`) che accumula una voce per ogni evento
  `ServiceResolved` senza deduplicare per `fullname`, e mDNS ne emette più di
  uno. Difetto solo cosmetico, non ancora corretto.

## Verifica

Esito misurato sul device il 2026-07-28 (Pixsys OS 2.0.0-dev, kernel 6.12.19,
podman 5.0.2-dev rootless):

| Verifica | Esito |
|---|---|
| `podman ps` → `healthy` | ok |
| `podman stop` | **1,3 s**, exit code 0 — prima 10 s e SIGKILL |
| deploy dall'IDE su `:8444` | ok — export, pulizia, upload, attivazione |
| connect su `:8443` (viewer) | rifiutato con il messaggio che indica la porta admin |
| progetto dopo reinstall dell'immagine | conservato (volumi nominati) |
| log in `/var/sws/logs` nel volume | ok — `runtime-2026-07-28.jsonl` |
| unit systemd utente | `active`, `NRestarts=0` |
| discovery mDNS da altra macchina della LAN | ok in rete host, `[]` in bridge |

Aggiunte il **2026-07-30**, sullo stesso dispositivo (WP620, `192.168.1.84`):

| Verifica | Esito |
|---|---|
| immagine sul dispositivo = immagine costruita | stesso ID, da `main` con albero pulito verificato prima e dopo |
| deploy pulito (`--uninstall --purge` + install) | ok, ma **ripescava i dati dai volumi nominati** — corretto con `--migrate-volumes` |
| `--bridge` → `GET /api/discover` dall'editor | `[]` (nessun rilevamento) |
| default host network → `GET /api/discover` | trova il runtime, `admin_url http://192.168.1.84:8444` |
| `healthy` in rete host | ok, ~1 s dopo l'avvio |
| avvio al boot dopo un riavvio reale | ok (2026-07-29, container già `healthy` a 1h07 di uptime) |

Procedura dal registry, provata la sera del **2026-07-30** sullo stesso device:

| Verifica | Esito |
|---|---|
| `--push` con albero sporco | **rifiutato**, nessuna pubblicazione |
| pull con ogni immagine locale cancellata (`podman rmi -f` + `image prune -af`) | scarica davvero, 1 min 05 s per l'installazione completa |
| **credenziali sul dispositivo** | nessuna: `podman login --get-login ghcr.io` → *not logged into*, e il pull riesce lo stesso |
| SPA servita dall'immagine | mount solo `projects`/`logs`/`config`, bundle nuovo servito su `:8444` |
| progetto e storico dopo l'aggiornamento | `Test034` intatto, `historian: swapped to project SQLite samples=386` |
| `healthy` dopo il pull | 13 s |
| discovery dall'editor del dev server | trova il runtime (due voci: difetto cosmetico noto) |
| ripiego offline `--image` | ok, stessa installazione dall'archivio |
| `--www` / `--www-only` | falliscono con il messaggio che rimanda a `--pull` |
| `--pull` insieme a `--image` | rifiutato |
| `--host-network` (compatibilità) | accettata, nessun errore |

Non provato di proposito: `--uninstall --purge` seguito da installazione, che
sarebbe la prova diretta della correzione sui volumi. Il dispositivo aveva sopra
il progetto di prova del maintainer e distruggerlo per un test non valeva il
prezzo; i volumi nominati su quel device non esistono più, quindi la trappola lì
non è nemmeno riproducibile. Da rifare sul prossimo dispositivo che debba essere
azzerato davvero.


```bash
podman ps                    # STATUS deve diventare "healthy" entro ~20 s
podman logs sws-runtime      # nessun errore di init Python; controllare
                             # se compare il warning RestrictedPython
curl -fs http://localhost:8443/health
curl -fs http://localhost:8444/health
```

Poi dal browser: `http://<device>:8443` (viewer) e `http://<device>:8444` (IDE).
Un runtime appena installato non ha progetti: si carica dall'editor con
ConfigView → Runtime → Connetti su `http://<device>:8444` → Deploy. Nota la
porta: le route di lifecycle progetto esistono **solo** sulla 8444, e `http`,
non `https`, finché non si genera un certificato.

Per verificare la persistenza: `podman restart sws-runtime` e ricontrollare che
il progetto ci sia ancora.

## Nota: `/` sulla porta admin risponde 404 (ma funziona)

`curl http://<device>:8444/` restituisce **404 con il corpo di
`index-admin.html`**: è il comportamento di `ServeDir::not_found_service` di
tower-http, che serve il file di fallback conservando lo status. Il browser
rende il body e l'IDE si carica regolarmente — non è un problema del container,
si riproduce identico sull'editor di sviluppo. Va saputo perché rende inutile
`curl -f` come test di vivacità dell'IDE: usare `/health`, che risponde 200 su
entrambe le porte. Effetto collaterale minore: il service worker cacha solo le
risposte 200, quindi `/` non entra nella cache offline.

## Limiti noti

- **Modbus RTU**: la seriale non è passata al container. Serve
  `--device /dev/ttyUSB0` (l'utente del device è già nel gruppo `dialout`).
- **mDNS**: funziona in rete host, che è il default (vedi sopra). Con `--bridge`
  il multicast non esce e il dispositivo non viene rilevato.
- **TLS**: il runtime parte in HTTP. Si abilita da ConfigView → Stato →
  Certificato TLS; il certificato finisce in `/data/user/sws/config` e
  sopravvive al riavvio e alla sostituzione del container.
- L'immagine gira come **root nel container** (che sotto rootless è comunque un
  utente non privilegiato sull'host), coerente con `User=root` dell'unit
  systemd nativa. Da stringere quando il PoC diventa prodotto.
