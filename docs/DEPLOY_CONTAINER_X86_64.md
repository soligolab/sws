# Deploy del runtime in container podman su device x86_64

> Percorso gemello di `docs/DEPLOY_CONTAINER_AARCH64.md`, stesso installer e
> stessa esperienza, per un device/macchina **x86_64** (amd64) invece che
> aarch64 — tipicamente le macchine di sviluppo del maintainer (casa/ufficio,
> vedi `docs/TEST_SETUPS.md`), ma vale per qualunque host x86_64 con Podman.
>
> Non è `docs/DEPLOY_PX30.md`, che copre target ARM64 generici (Raspberry Pi,
> Jetson...) buildati da un laptop x86 — qui il laptop x86 **è** il target,
> non solo la macchina di build.

## Come è fatta l'immagine

`deploy/container/Containerfile.x86_64` **non compila nulla**. Copia dentro un
binario già compilato **nativamente** (nessun SDK, nessun cross-compile — a
differenza di aarch64, qui l'architettura di build e quella target
coincidono), la SPA e i template.

### Perché `debian:trixie-slim` e non `debian:bookworm-slim` (su QUESTA macchina)

**Attenzione, a differenza del percorso aarch64: qui non c'è un SDK fisso.**
Il binario nativo linka contro il glibc/Python della macchina che lo builda —
diversa da un laptop all'altro. La riga `FROM` di `Containerfile.x86_64` **va
riverificata ad ogni macchina di build diversa**, con lo stesso comando già
usato per aarch64:

```bash
readelf -d sws-runtime/target/release/sws-runtime | grep NEEDED
readelf -V sws-runtime/target/release/sws-runtime | grep -o 'GLIBC_[0-9.]*' | sort -uV | tail -1
```

Misurato su questa macchina (Debian 12 con un python3.13 non di sistema, es.
pyenv): `libpython3.13.so.1.0` e `GLIBC_2.39`. Quindi qui la base deve avere
**insieme** Python 3.13 e glibc ≥ 2.39:

| Base | glibc | Python | Esito (su questa macchina) |
|---|---|---|---|
| `debian:bookworm-slim` | 2.36 | 3.11 | ❌ doppiamente incompatibile |
| **`debian:trixie-slim`** | **2.41** | **3.13** | ✅ |
| `ubuntu:24.04` | 2.39 | 3.12 | ❌ manca `libpython3.13` |

Su un'altra macchina di sviluppo (Python di sistema diverso) questa tabella
**cambia** — rifare la verifica, non copiare il risultato. È il limite di
riproducibilità descritto sotto.

### Vincolo sul kernel dell'host

Come per aarch64: i container condividono il kernel dell'host, quindi un
binario compilato su un kernel recente potrebbe non partire su un host con
kernel più vecchio. Verificare `uname -r` sulla macchina di build vs quella
target se sono macchine diverse (non rilevante se si builda e si esegue sulla
stessa macchina).

### Differenze rispetto all'immagine legacy

Stesse quattro correzioni del percorso aarch64 (vedi
`docs/DEPLOY_CONTAINER_AARCH64.md` §"Differenze rispetto all'immagine
legacy") — `CMD` completo con `--viewer-port`/`--www`, nessun entrypoint che
pretende `SWS_ADMIN_PASSWORD`, template copiati, RestrictedPython installato.

## Limite noto: riproducibilità legata alla macchina di build

A differenza del binario Yocto aarch64 (SDK fisso, stesso binario da qualunque
macchina lo costruisca), un binario x86_64 nativo dipende dal glibc/Python
della macchina che esegue `cargo build --release` — oggi diverso da laptop a
laptop del maintainer. Per l'uso previsto (verificare che il container si
comporti allo stesso modo su x86 e su aarch64, sulle proprie macchine di
sviluppo) è un compromesso accettabile: non serve un artefatto trasferibile a
device x86_64 sconosciuti in campo. **Se in futuro servirà** (es. spedire
un'immagine x86_64 a un cliente con un device diverso da quello di build), il
punto di ripartenza è compilare dentro un'immagine builder con una base
fissa — lo stage `builder` di `sws-runtime/docker/Dockerfile` (l'immagine
legacy) è già quel pattern, andrebbe solo ripulito dei suoi 4 difetti noti
invece di ricostruito da zero.

## Build (sulla macchina di sviluppo)

Prerequisiti: **nessun SDK** — solo `cargo`/toolchain Rust (già presente sulle
macchine di sviluppo del progetto), `podman`, rete verso Docker Hub per
`debian:trixie-slim` (o la base che risulta corretta dopo la verifica
`readelf` sopra).

```bash
./scripts/build_container_x86_64.sh              # build nativa + immagine + archivio
./scripts/build_container_x86_64.sh --no-rust    # riusa il binario x86_64 esistente
./scripts/build_container_x86_64.sh --no-save    # solo immagine, niente archivio
```

Produce gli stessi **due** artefatti del percorso aarch64:

| Artefatto | Contenuto | Dimensione (misurata) |
|---|---|---|
| `dist/sws-runtime-<versione>-x86_64-image.tar.gz` | immagine: binario + template | ~63 MB |
| `dist/sws-www-<versione>.tar.gz` | la SPA | ~0,4 MB |

Stessa ragione del percorso aarch64 per tenere la SPA fuori dall'immagine
(bind mount, aggiornabile senza ricostruire/ritrasferire l'immagine intera).

Lo script rifiuta di procedere se il binario in `target/release/` non è
x86-64 (stesso principio della guardia aarch64, verifica con `file`).

## Installazione sul device

**Identica al percorso aarch64** — `deploy/container/install-container.sh`
non ha alcuna logica specifica per architettura, funziona invariato:

```bash
scp dist/sws-runtime-<versione>-x86_64-image.tar.gz \
    dist/sws-www-<versione>.tar.gz \
    deploy/container/install-container.sh \
    deploy/container/sws-runtime.container  user@<device>:/tmp/
ssh user@<device>
cd /tmp && ./install-container.sh \
    --image sws-runtime-<versione>-x86_64-image.tar.gz \
    --www   sws-www-<versione>.tar.gz
```

Per tutto il resto — dove stanno i dati, aggiornare solo il frontend, avvio
automatico al boot (quadlet + linger), discovery mDNS e perché la rete host è
il default, elenco flag — vedi
`docs/DEPLOY_CONTAINER_AARCH64.md` §"Installazione sul device" in poi: è
testo comune a entrambe le architetture, non duplicato qui.

## Verifica

Eseguita su questa macchina il 2026-07-30 (Debian 12, podman 5.4.2 rootless),
in due passi: prima l'immagine da sola (`podman run` diretto), poi l'intero
installer (con porte/dati remappati su una copia temporanea per non
interferire con le istanze di sviluppo già attive sulla stessa macchina):

| Verifica | Esito |
|---|---|
| `podman run` diretto → `podman ps` | `healthy` |
| `curl http://localhost:8443/health` | `ok`, 200 |
| `curl http://localhost:8444/api/templates` | non vuoto (`casa-locale`, ...) |
| log all'avvio | `pyscript: RestrictedPython available — scripts will run sandboxed` (nessun warning "NOT available") |
| avvio senza `SWS_ADMIN_PASSWORD` | ok (no-auth mode) |
| `install-container.sh --bridge --no-autostart` (porte remappate) | `/health ok dopo 2s`, directory dati create correttamente, container `healthy` |
| istanze di sviluppo già attive sulla stessa macchina (porte reali 8443/8444/8460) | non toccate, verificate intatte dopo il test |

Non ancora provato: avvio automatico al boot (quadlet + linger) su questa
macchina — il percorso aarch64 lo ha già verificato su device reale
(`docs/DEPLOY_CONTAINER_AARCH64.md` §Verifica) e l'installer è lo stesso
identico script, quindi il rischio è basso, ma non è stato ripetuto qui.

## Limiti noti

Stessi del percorso aarch64 (`docs/DEPLOY_CONTAINER_AARCH64.md` §"Limiti
noti"): Modbus RTU non passato al container, mDNS solo in rete host, purge
seguito da migrazione da volumi nominati, TLS parte disattivato. Più il
limite di riproducibilità specifico di questo percorso, vedi sopra.
