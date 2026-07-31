# Deploy del runtime in container podman su device aarch64

> Percorso per i device **Pixsys OS** (aarch64) dove il runtime deve girare in
> un container podman rootless, invece che come servizio systemd nativo.
>
> Per un device **x86_64** (non aarch64), stesso installer e stessa esperienza, vedi
> `docs/DEPLOY_CONTAINER_X86_64.md` — non `docs/DEPLOY_PX30.md`, che copre target
> ARM64 generici (Raspberry Pi, Jetson...) buildati da un laptop x86, non un target
> x86_64.
>
> Non sostituisce il percorso **binario nativo Yocto**
> (`docs/YOCTO_CROSSCOMPILE.md`) — resta preferibile quando si può installare come
> servizio di sistema invece che in container.

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

## Build (sulla macchina di sviluppo)

Prerequisiti: SDK Pixsys in `/usr/local/oecore-x86_64/`, `podman`, binfmt
aarch64 registrato (`ls /proc/sys/fs/binfmt_misc/qemu-aarch64`), rete verso
Docker Hub per `ubuntu:24.04`.

```bash
./scripts/build_container.sh              # cross-build + immagine + archivio
./scripts/build_container.sh --no-rust    # riusa il binario aarch64 esistente
./scripts/build_container.sh --no-save    # solo immagine, niente archivio
```

Produce **due** artefatti:

| Artefatto | Contenuto | Dimensione |
|---|---|---|
| `dist/sws-runtime-<versione>-aarch64-image.tar.gz` | immagine: binario + template | ~59 MB |
| `dist/sws-www-<versione>.tar.gz` | la SPA | ~0,4 MB |

La SPA **non è nell'immagine**: sta in un bind mount sul dispositivo, così una
modifica al solo frontend non impone di ricostruire e ritrasferire 59 MB. È un
problema già capitato: dati di progetto aggiornati e SPA vecchia sul
dispositivo, con conseguente caccia al fantasma.

Lo script rifiuta di procedere se il binario in
`target/aarch64-unknown-linux-gnu/release/` non è ARM aarch64: senza quel
controllo un binario host finirebbe nell'immagine e l'errore salterebbe fuori
solo al `podman run` sul device.

## Installazione sul device

```bash
scp dist/sws-runtime-<versione>-aarch64-image.tar.gz \
    dist/sws-www-<versione>.tar.gz \
    deploy/container/install-container.sh \
    deploy/container/sws-runtime.container  user@<device>:/tmp/
ssh user@<device>
cd /tmp && ./install-container.sh \
    --image sws-runtime-<versione>-aarch64-image.tar.gz \
    --www   sws-www-<versione>.tar.gz
```

L'installer gira **come utente normale, senza sudo** (podman rootless) ed è
idempotente: prepara le directory dati, carica l'immagine, srotola la SPA,
installa l'unit quadlet, abilita il linger e attende `/health`. I dati
esistenti non si toccano; il container precedente **va** rimosso, perché
continuerebbe a usare l'immagine vecchia anche dopo un `podman load` sullo
stesso tag.

### Dove stanno i dati

Bind mount su un percorso esplicito dell'host, non volumi nominati: i dati
restano visibili e copiabili senza passare da `podman volume inspect`, e `/data`
è la partizione scrivibile sui device Pixsys — stessa collocazione
dell'installazione nativa.

```
/data/user/sws/projects   progetti (dati utente)
/data/user/sws/config     certificati TLS, registro progetti
/data/user/sws/logs       log JSONL rotati
/data/user/sws/www        la SPA
```

Funziona sotto rootless perché il container gira come root e in rootless
l'UID 0 del container è mappato sull'utente dell'host: i file creati risultano
di `user`, proprietario di `/data/user/sws`. Con podman **rootful** il mapping
sarebbe diverso e i permessi andrebbero rivisti.

`/data/user` è scrivibile dall'utente, `/data` no: da qui la scelta del
percorso. L'installer migra automaticamente i dati dai volumi nominati della
versione precedente, altrimenti dopo l'aggiornamento i progetti sembrerebbero
spariti.

### Aggiornare solo il frontend

```bash
scp dist/sws-www-<versione>.tar.gz user@<device>:/tmp/
ssh user@<device> 'cd /tmp && ./install-container.sh --www-only sws-www-<versione>.tar.gz'
```

Meno di un secondo, **senza riavviare il container**: il runtime legge i file
statici a ogni richiesta, quindi basta ricaricare la pagina nel browser.

Lo script sostituisce il **contenuto** della directory, non la directory: un
`mv` di quella montata romperebbe il bind mount, perché il container ne tiene
l'inode e continuerebbe a vedere quella vecchia — cioè 404 su tutta la SPA
finché non si riavvia il container. Verificato sul dispositivo, era esattamente
quello che succedeva.

Opzioni:

| Flag | Effetto |
|---|---|
| `--image ARCHIVIO` | carica l'immagine; senza, usa quella già presente |
| `--www ARCHIVIO` | srotola la SPA; obbligatorio al primo giro (non è nell'immagine) |
| `--www-only ARCHIVIO` | aggiorna solo la SPA e esce |
| `--data DIR` | directory dati alternativa (default `/data/user/sws`) |
| `--bridge` | rete bridge con porte pubblicate, **al prezzo della discovery mDNS** (vedi sotto) |
| `--host-network` | non serve più: `Network=host` è il default. Accettata per compatibilità |
| `--no-autostart` | solo `podman run`, nessuna unit systemd: non riparte dopo il reboot |
| `--uninstall` | rimuove servizio e container, **conserva i dati** |
| `--uninstall --purge` | rimuove anche i dati, quindi i progetti |

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
| immagine sul dispositivo = immagine costruita | stesso ID `8aec2579…`, da `main` `35efe1c` con albero pulito |
| deploy pulito (`--uninstall --purge` + install) | ok, ma **ripesca i dati dai volumi nominati** — vedi Limiti noti |
| `--bridge` → `GET /api/discover` dall'editor | `[]` (nessun rilevamento) |
| default host network → `GET /api/discover` | trova il runtime, `admin_url http://192.168.1.84:8444` |
| `healthy` in rete host | ok, ~1 s dopo l'avvio |
| avvio al boot dopo un riavvio reale | ok (2026-07-29, container già `healthy` a 1h07 di uptime) |


```bash
podman ps                    # STATUS deve diventare "healthy" entro ~20 s
podman logs sws-runtime      # nessun errore di init Python; controllare
                             # se compare il warning RestrictedPython
curl -fs http://localhost:8443/health
curl -fs http://localhost:8444/health
```

Poi dal browser: `http://<device>:8443` (viewer) e `http://<device>:8444` (IDE).
Un runtime appena installato non ha progetti: si carica dall'editor con
ConfigView → Runtime → Connetti su `http://<device>:8444` → Deploy.

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
- **`--uninstall --purge` seguito da un'installazione non dà un dispositivo
  pulito.** Visto dal vivo il 2026-07-30: il purge svuota i bind mount, e al
  passo 1 l'installer migra i dati dai volumi nominati della versione
  pre-2026-07-28 proprio perché la cartella di destinazione è vuota. Il
  dispositivo si è ritrovato con un progetto `test1` di due giorni prima, aperto
  come progetto attivo. Rimedio finché il codice non cambia: dopo il purge
  eliminare anche i volumi (`podman volume rm sws-projects sws-config sws-logs`),
  esportandoli prima con `podman volume export` se contengono qualcosa che serve.
- **TLS**: il runtime parte in HTTP. Si abilita da ConfigView → Stato →
  Certificato TLS; il certificato finisce nel volume `sws-config` e sopravvive
  al riavvio del container.
- L'immagine gira come **root nel container** (che sotto rootless è comunque un
  utente non privilegiato sull'host), coerente con `User=root` dell'unit
  systemd nativa. Da stringere quando il PoC diventa prodotto.
