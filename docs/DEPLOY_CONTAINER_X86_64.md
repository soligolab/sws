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

`deploy/container/Containerfile.x86_64` **non compila nulla**. Copia dentro il
binario, la SPA e i template. La SPA è l'ultimo layer di contenuto, dopo il
binario, perché è quella che cambia più spesso.

Il binario però **non arriva dall'host**: lo produce
`deploy/container/Containerfile.x86_64.builder`, un'immagine di sola
compilazione con la toolchain Rust, dentro cui `scripts/build_container_x86_64.sh`
lancia il `cargo build`.

### Perché `ubuntu:24.04`, la stessa base dell'aarch64

**La base non si sceglie: la impone il binario.** PyO3 gira con
`auto-initialize`, quindi il binario linka la `libpython` dell'ambiente che lo
compila — è lo stesso vincolo del percorso aarch64, dove `readelf` sul binario
dell'SDK Pixsys dice `libpython3.12` + `GLIBC_2.39` e da lì viene `ubuntu:24.04`.

Finché il binario x86_64 si compilava sull'host, quel vincolo puntava a un
bersaglio mobile: la libpython era quella della macchina di sviluppo. Misurato
sul dev server di ufficio (Debian 12): `libpython3.11.so.1.0` e `GLIBC_2.34`.
Sulla macchina di casa, con un python3.13 da pyenv, `libpython3.13`. **Due
immagini diverse dallo stesso commit**, e nessuna delle due combaciava con la
base dell'arm64.

Compilando dentro il builder, che è pure `ubuntu:24.04`, il binario linka
sempre Python 3.12 e glibc 2.39 — cioè esattamente ciò che la base finale
offre. Le due architetture tornano gemelle, e chiunque ricostruisca ottiene lo
stesso risultato: il builder è per x86_64 quello che l'SDK Yocto Pixsys è per
aarch64, un ambiente di compilazione fisso.

**La verifica `readelf` non è sparita, è diventata automatica.**
`build_container_x86_64.sh` la esegue sul binario prodotto e si ferma se la
libpython richiesta non è quella della base:

```
ERRORE: il binario chiede libpython3.11, l'immagine finale offre libpython3.12.
        Il container partirebbe e morirebbe su 'cannot open shared object file'.
```

Prima quel controllo era una riga di documentazione che diceva «ricordati di
rifarlo a mano»: il difetto sarebbe emerso al primo `podman run` sul
dispositivo, con un messaggio che non spiega niente.

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

## Riproducibilità: risolta il 2026-07-31

Questo documento conteneva un «limite noto»: il binario x86_64 nativo dipendeva
dal glibc/Python della macchina che eseguiva `cargo build --release`, quindi
l'immagine era diversa da un laptop all'altro. Era accettato come compromesso,
con l'annotazione che il rimedio sarebbe stato compilare dentro un'immagine
builder a base fissa.

**È quello che si è fatto**: `Containerfile.x86_64.builder`. Il limite non c'è
più, e con esso è sparita la necessità di riverificare a mano la riga `FROM` a
ogni postazione.

Il prezzo è la prima compilazione, che dentro il container parte da zero. Le
successive riusano i layer del builder e la cache dei crate
(`.cargo-container-x86_64/`, `target-container-x86_64/`, entrambe ignorate da
git). Volendo saltarla del tutto c'è `--no-rust`, che riusa il binario già
prodotto — utile quando si tocca solo la SPA.

## Build (sulla macchina di sviluppo)

Prerequisiti: **nessun SDK e nessuna toolchain Rust sull'host** — la toolchain
vive nell'immagine builder. Servono solo `podman`, `pnpm` per la SPA, e rete
verso Docker Hub per `ubuntu:24.04`.

```bash
./scripts/build_container_x86_64.sh              # build nativa + immagine + archivio
./scripts/build_container_x86_64.sh --push       # ...e pubblica sul registry
./scripts/build_container_x86_64.sh --no-rust    # riusa il binario x86_64 esistente
./scripts/build_container_x86_64.sh --no-save    # solo immagine, niente archivio
```

Produce **un solo** artefatto, come il percorso aarch64:

| Artefatto | Contenuto | Dimensione (misurata) |
|---|---|---|
| `dist/sws-runtime-<versione>-x86_64-image.tar.gz` | immagine: binario + SPA + template | ~63 MB |

La SPA sta **dentro** l'immagine dal 2026-07-30 — non c'è più un secondo
archivio da abbinare. La ragione per tenerla fuori (non ritrasferire 59 MB per
una modifica al solo frontend) è caduta col passaggio al registry, dove i layer
si deduplicano; vedi `docs/DEPLOY_CONTAINER_AARCH64.md` §"Come è fatta
l'immagine".

Con `--push` l'immagine finisce su `ghcr.io/soligolab/sws-runtime` con due tag,
`<versione>-amd64` e `<commit>-amd64`. Il suffisso `-amd64` è speculare al
`-arm64` del percorso aarch64 e serve: non è una manifest list multi-arch, e un
tag nudo farebbe fallire un pull su arm64 con un `no matching manifest`
incomprensibile.

Lo script rifiuta di procedere se il binario in `target/release/` non è
x86-64 (stesso principio della guardia aarch64, verifica con `file`), e — con
`--push` — se l'albero di lavoro è sporco o manca il `podman login`.

## Installazione sul device

**Identica al percorso aarch64** — `deploy/container/install-container.sh`
non ha alcuna logica specifica per architettura, funziona invariato.

Dal registry, la strada normale:

```bash
scp deploy/container/install-container.sh \
    deploy/container/sws-runtime.container \
    deploy/container/sws-lvgl-viewer.container \
    deploy/container/sws-display.service \
    deploy/container/sws-display.path \
    deploy/container/sws-display-apply.sh  user@<device>:/tmp/
ssh user@<device>
cd /tmp && ./install-container.sh --pull ghcr.io/soligolab/sws-runtime:<versione>-amd64
```

Da archivio, per un dispositivo che non raggiunge il registry:

```bash
scp dist/sws-runtime-<versione>-x86_64-image.tar.gz \
    deploy/container/install-container.sh \
    deploy/container/sws-runtime.container \
    deploy/container/sws-lvgl-viewer.container \
    deploy/container/sws-display.service \
    deploy/container/sws-display.path \
    deploy/container/sws-display-apply.sh  user@<device>:/tmp/
ssh user@<device>
cd /tmp && ./install-container.sh --image sws-runtime-<versione>-x86_64-image.tar.gz
```

Per tutto il resto — dove stanno i dati, aggiornare il frontend, avvio
automatico al boot (quadlet + linger), discovery mDNS e perché la rete host è
il default, elenco flag — vedi
`docs/DEPLOY_CONTAINER_AARCH64.md` §"Installazione sul device" in poi: è
testo comune a entrambe le architetture, non duplicato qui.

## Verifica

### 2026-07-30 — superata, da leggere solo come storia

Le due voci qui sotto valgono per un'immagine costruita **prima** di due
cambiamenti sostanziali: la SPA è entrata nell'immagine (quel test usava un
`--www` a parte, flag che oggi non esiste più) e la base è passata da
`debian:trixie-slim` a `ubuntu:24.04` con la compilazione dentro il builder.
Restano qui perché descrivono controlli che vale la pena ripetere, non perché
provino qualcosa dell'immagine attuale.

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

### 2026-07-31 — immagine attuale

Immagine `2026.7.0-amd64` compilata dentro il builder, base `ubuntu:24.04`, SPA
nell'immagine. Provata su questa macchina (Debian 12, podman 4.3.1 rootless) con
porte 8591/8592 per non toccare le istanze di sviluppo.

| Verifica | Esito |
|---|---|
| `readelf` sul binario prodotto | `libpython3.12`, `GLIBC_2.39` — combacia con `ubuntu:24.04`, controllo eseguito dallo script |
| `/health` sulla porta viewer | ok |
| `/health` sulla porta admin | ok |
| `index.html` servito dall'immagine | ok |
| bundle JS dell'entry servito | ok (`assets/main-*.js`) |
| SPA admin (`index-admin.html`) | ok |
| `GET /api/templates` | 10 template |
| RestrictedPython | disponibile, **nessun** warning "NOT available" |
| `podman ps` | `healthy` |
| Python dentro l'immagine | 3.12.3, `libpython3.12.so.1.0` presente |

Il confronto che conta: lo stesso commit compilato **sull'host** produce un
binario che chiede `libpython3.11` + `GLIBC_2.34`, incompatibile con questa
base. Dentro il builder chiede `libpython3.12` + `GLIBC_2.39`. È la differenza
fra un'immagine che parte e una che muore su `cannot open shared object file`.

Non ancora provato: l'avvio automatico al boot (quadlet + linger) su questa
macchina, e `install-container.sh --pull` verso questa immagine da un host
x86_64 pulito.

## Limiti noti

Stessi del percorso aarch64 (`docs/DEPLOY_CONTAINER_AARCH64.md` §"Limiti
noti"): Modbus RTU non passato al container, mDNS solo in rete host, purge
seguito da migrazione da volumi nominati, TLS parte disattivato.

Il limite di riproducibilità che era specifico di questo percorso **non c'è
più** dal 2026-07-31, vedi la sezione sopra.
