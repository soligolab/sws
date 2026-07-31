# Installa su dispositivo → container dal registry, con installazione pulita

## Contesto

La sezione **Configurazione → Runtime → "Installa su dispositivo"**, in modalità
**Container (Podman)**, oggi sa fare una cosa sola: copiare via `scp` un archivio da
`dist/` e installarlo con `install-container.sh --image`. Il menù "Immagine
selezionata" elenca gli archivi presenti in `dist/`, e basta.

Questo ha due conseguenze concrete, entrambe viste oggi:

- **Si installa quello che c'è, non quello che serve.** Il 2026-07-31 il WP630 è stato
  installato dall'IDE scegliendo l'unico archivio disponibile, `0.1.0-dev` del 30 luglio:
  il dispositivo ha preso un frontend di un giorno prima, e la correzione dello slider
  che si stava cercando lì dentro non c'era. Il menù non sbagliava — elencava fedelmente
  l'unica cosa presente.
- **Si trasferiscono 59 MB ogni volta.** Dal 2026-07-30 esiste il percorso registry
  (`install-container.sh --pull`), che scarica solo i layer cambiati (~14 MB per un
  binario nuovo, ~0,4 MB per il solo frontend) ed è documentato come *la strada normale*.
  L'IDE è l'unico posto da cui non si può usare.

Manca inoltre un modo di rimettere un dispositivo in stato vergine: `--uninstall --purge`
esiste nello script ma nessun endpoint lo espone.

**Esito voluto**: scegliendo "Container (Podman)" si installa **dal registry** per
default, con l'archivio locale come seconda opzione per i dispositivi senza rete, e con
una spunta esplicita per azzerare i dati del dispositivo prima di installare.

## Decisioni prese col maintainer

1. **Entrambe le sorgenti**, con un selettore in UI. Registry di default.
2. **Tag mobile** `latest-<arch>` di default, con campo facoltativo per inchiodare una
   versione.
3. **L'architettura la deduce l'installer** sul dispositivo da `uname -m` — non l'IDE.
   Il dispositivo è l'unico che sa con certezza cosa è, e il beneficio vale anche da riga
   di comando. Un riferimento esplicito continua a vincere.
4. **Installazione pulita dietro una spunta**, conservativa di default, con conferma.
5. **L'immagine si procura prima di cancellare i dati**: nuova flag `--pull-only`, così
   quando il purge cancella, l'immagine è già sul dispositivo.

---

## 1. `deploy/container/install-container.sh`

### 1a. Architettura dedotta dal dispositivo

Oggi la riga 52 cabla `REGISTRY_REF="ghcr.io/soligolab/sws-runtime:latest-arm64"`: su un
dispositivo x86_64 quel default scarica un'immagine che non parte.

- Sostituire con `REGISTRY_IMAGE="ghcr.io/soligolab/sws-runtime"`, `REGISTRY_REF=""` e
  `REGISTRY_REF_EXPLICIT=0`.
- Nel parsing di `--pull` (righe 84-87), impostare `REGISTRY_REF_EXPLICIT=1` quando
  l'argomento viene consumato. La guardia `[ "${2#-}" = "$2" ]` resta invariata.
- **Nel passo 0 di validazione** (dopo il controllo `--pull` + `--image`, riga 140), e non
  prima: comporre il riferimento da `uname -m` — `aarch64|arm64` → `latest-arm64`,
  `x86_64|amd64` → `latest-amd64`. Architettura sconosciuta (es. `armv7l`, userspace a
  32 bit su SoC aarch64) → **errore, exit 1, dispositivo intatto**, con il suggerimento di
  passare il riferimento per esteso o di installare da archivio.

Il passo 0 è il posto giusto per convenzione del file: è dove si fallisce senza aver
toccato niente. Prima no, perché `--uninstall` esce alla riga 129 e non deve mai
richiedere un'architettura nota.

### 1b. Nuova flag `--pull-only`

Esegue il passo `[2/6]` (procura l'immagine) ed esce `0`, senza toccare il servizio in
esecuzione. Serve a rendere sicura l'installazione pulita: vedi §3.

Il blocco `--uninstall` (righe 116-130) **non va toccato**: `--uninstall --purge --data PATH`
fa già esattamente il lavoro.

### 1c. Documentazione nel file

Aggiornare l'intestazione (righe 24-38): la riga d'uso di `--pull` deve dire che il tag è
`latest-<arch>` dedotto sul dispositivo, e va aggiunta `--pull-only`.

---

## 2. `packaging.rs` — parte pura (prima di tutto il resto)

### 2a. Tipo interno

```rust
/// Da dove arriva l'immagine sul dispositivo. `Registry` con riferimento vuoto
/// significa "decidilo tu": l'architettura la deduce install-container.sh.
enum ImageSpec { Archive(String), Registry(String) }
```

L'enum garantisce **per costruzione** che `--pull` e `--image` non compaiano mai insieme
nello stesso comando — l'installer li rifiuta (righe 137-140).

### 2b. `resolve_image_spec(source: Option<&str>, image_tarball: &str, image_ref: &str) -> Result<ImageSpec, String>`

- `Some("archive")` → tarball obbligatorio, altrimenti `Err`.
- `Some("registry")` → valida il riferimento se non vuoto.
- `None` → **archivio se il tarball non è vuoto**, altrimenti registry. È la
  compatibilità con un client vecchio (vedi §2d).
- Altro → `Err` in italiano, così l'utente vede il nostro messaggio e non un 422 di serde.

**Validazione del riferimento**: finisce interpolato in un comando shell remoto,
esattamente come `remote_dir`. Ammettere solo `[A-Za-z0-9._:/@-]` (`:` e `@` servono per
tag e digest), rifiutare vuoto-ma-presente e **rifiutare i riferimenti che iniziano con
`-`**: l'installer li scarterebbe in silenzio come flag (riga 86) ripiegando sul default,
che è il tipo di errore peggiore.

### 2c. Costruzione dei comandi

Estrarre il prefisso condiviso in `fn install_sh(remote_dir: &str) -> String`
(`cd … && chmod +x install-container.sh && ./install-container.sh`) così le varianti non
divergono. Poi tre funzioni pure:

| funzione | produce |
|---|---|
| `build_install_cmd(remote_dir, &ImageSpec, data_path)` | `--image F` \| `--pull` \| `--pull REF`, più `--data` se presente |
| `build_pull_only_cmd(remote_dir, &ImageSpec)` | `--pull-only [REF]`; **`None` in modalità archivio**, dove non serve |
| `build_purge_cmd(remote_dir, data_path)` | `--uninstall --purge`, **più `--data` se presente** |

**Il `--data` nel comando di purge è la riga più importante del piano.** L'uninstall fa
`rm -rf "$DATA"`, e `DATA` viene dal parsing delle flag: senza ripetere il `--data`
scelto nel pannello, il purge cancellerebbe `/data/user/sws` — il default — lasciando
intatti i dati veri e distruggendo quelli di un'altra installazione. È il caso peggiore
possibile e va coperto da un test dedicato.

### 2d. `DeviceContainerDeployRequest`

`image_tarball` diventa `#[serde(default)] String`; si aggiungono
`image_source: Option<String>`, `image_ref: String` (`#[serde(default)]`) e
`clean_install: bool` (`#[serde(default)]`, quindi `false`).

`image_source` è **`Option` e non un default a `"registry"`**: con un default a registry
un IDE vecchio si vedrebbe ignorare in silenzio il proprio archivio, e il dispositivo
scaricherebbe dal registry un'immagine che nessuno ha chiesto — peggio di un errore.

---

## 3. `packaging.rs` — handler `deploy_device_container`

**Prima dello spawn**, come errori HTTP veri e non come righe di stream:

1. `validate_remote_path` su `remote_dir` e `data_path` — invariato.
2. `resolve_image_spec(...)` → `400` col messaggio della funzione.
3. `resolve_dist_file` **solo** in modalità archivio: con la sorgente registry `dist/`
   può non esistere affatto, ed è il caso di chi installa senza aver mai fatto una build.
4. `install-container.sh` e `sws-runtime.container` restano obbligatori in entrambe.

**Nel task**, la sequenza diventa:

| passo | quando | note |
|---|---|---|
| `mkdir -p remote_dir` | sempre | invariato |
| **scp** | sempre installer + quadlet; **l'immagine solo in modalità archivio** | in registry si passa da tre file a due piccoli: i 59 MB spariscono |
| **`--pull-only`** | solo se `clean_install` **e** sorgente registry | procura l'immagine *prima* di cancellare i dati |
| **`--uninstall --purge --data …`** | solo se `clean_install` | preceduto da una riga `WARN` che nomina il percorso effettivo |
| **installazione** | sempre | `build_install_cmd` con lo `ImageSpec` risolto |
| health check + `DONE` | sempre | invariati |

Prima dello scp, una riga esplicita sulla sorgente: `==> immagine: archivio <nome>` oppure
`==> immagine: registry (<ref>)` / `registry (latest-<arch>, deciso dal dispositivo)`.

**Se il purge fallisce si interrompe** (`return`), senza installare, con un errore che
dichiara lo stato reale invece di lasciarlo indovinare:

> `ERROR: azzeramento fallito. Il servizio è stato rimosso e i dati potrebbero essere
> cancellati solo in parte. Ripeti SENZA "installazione pulita" per rimettere in servizio
> il runtime.`

`run_ssh_cmd` non va modificata: inoltra già stdout/stderr dell'installer, quindi il
motivo vero (permessi, mount occupato) arriva nella UI, e l'esito booleano basta per
entrambi i passi nuovi.

---

## 4. UI — `sws-editor/src/config/ConfigView.tsx`

Tutto dentro `RuntimeConnectionTab` (riga 6754); il pannello sta alle righe 7464-7627.

**Stato nuovo**, accanto a `dataPath` (riga 6818): `containerSource` (`"registry" | "archive"`,
default `"registry"`), `imageRef`, `cleanInstall`.

**Guard e `disabled` da cambiare** — sono la parte che oggi impedisce di usare il registry:

- **riga 7465**: togliere il condizionale `packages.length > 0 || containerPackages.length > 0`.
  Col registry l'installazione non dipende più da `dist/`, quindi una `dist/` vuota non
  deve far sparire il pannello.
- **righe 7476-7482**: togliere `disabled={containerPackages.length === 0}` e il `title`
  dal bottone "Container (Podman)".
- **righe 7607-7608**: la condizione diventa
  `containerDeploying || !deviceHost || !deviceUser || (containerSource === "archive" && !selectedContainerPkg)`.
  `!deviceUser` è un'aggiunta: oggi il bottone è attivo ma `handleContainerDeploy` esce in
  silenzio con l'utente vuoto.

**Selettore di sorgente**, al posto del blocco "Immagine selezionata" (7498-7512): due
bottoncini con lo stesso stile del selettore `deployMode` sopra, nessun componente nuovo.
"Archivio locale" con `disabled` quando `containerPackages` è vuoto. In modalità archivio
resta il `<select>` esistente; in modalità registry, un campo **facoltativo** per il
riferimento con nota "vuoto = ultima pubblicata per l'architettura del dispositivo".

**Spunta "Installazione pulita"** nel footer container, sopra il bottone, nello stile del
blocco "danger" già usato per l'eliminazione del progetto remoto (righe 7316-7336).
Visibile in **entrambe** le sorgenti: agisce sui dati del dispositivo, non sull'immagine, e
i dispositivi offline sono proprio quelli su cui serve di più. Deve mostrare il percorso
effettivo (`dataPath || "/data/user/sws"`).

**`handleContainerDeploy`** (7041-7072):

1. Guard: `!deviceHost || !deviceUser`; la ricerca del pacchetto solo in modalità archivio.
2. Conferma con `window.confirm` se `cleanInstall`, stesso pattern di `handlePushUsers`
   (riga 7124). Il testo deve nominare progetti, **utenti** (`users.yaml` sta nella
   cartella del progetto), configurazione e storico, il percorso, e dire che non è
   reversibile.
3. Payload con `image_source`, `image_tarball` (solo archivio), `image_ref` (solo
   registry), `clean_install`.
4. Su `!res.ok` leggere il corpo con `await res.text()` e mostrarlo: oggi i messaggi in
   italiano del backend vengono buttati via e resta solo lo status.
5. `setCleanInstall(false)` a fine ciclo: la spunta non deve sopravvivere per inerzia a
   una seconda installazione.

**Correzione a costo zero, stesso file** (riga 7001): chiamare anche
`fetchContainerPackages()` quando lo stream di build manda `DONE`, come già fa
`fetchPackages`. È il buco per cui le immagini appena costruite non compaiono senza
ricaricare la pagina — quello che è successo oggi.

**i18n**: nuove chiavi in `sws-editor/src/i18n/it.json` e `en.json` per sorgente
immagine, riferimento e relativo aiuto, installazione pulita e testo di conferma,
messaggio "nessuna immagine in dist/".

---

## 5. Verifica

**Test Rust** (`cargo test -p sws-web`, modulo `tests` righe 760-822):

- `build_install_cmd` in modalità archivio deve produrre **la stringa di oggi, invariata**
  — è la regressione sul percorso offline già collaudato sul WP630.
- `--pull` senza riferimento, `--pull REF` con `--data` in coda, e nessun comando che
  contenga `--pull` e `--image` insieme.
- **`build_purge_cmd` porta lo stesso `--data`** — il test che protegge dal cancellare la
  directory sbagliata.
- `resolve_image_spec`: default registry, client vecchio che resta su archivio, archivio
  senza tarball = errore, riferimenti pericolosi rifiutati (`"; rm -rf /"`, `$(id)`,
  backtick, spazi, ref che inizia con `-`), tag e digest accettati, sorgente sconosciuta
  rifiutata.

**Test frontend** (`pnpm test`): estrarre la mappatura modalità → payload in una funzione
pura piccola, sullo stampo di `src/runtimeUrl.ts` che ha già il suo test, e coprire
registry senza ref / registry con ref / archivio.

**Compatibilità**: un `curl` col payload vecchio (solo `image_tarball` + credenziali) deve
produrre esattamente il comando di prima.

**Script**: `bash -n install-container.sh`, più un `--pull` a vuoto su questa macchina
x86_64 (deve comporre `latest-amd64`, non `latest-arm64`).

**A mano sull'hardware**, perché nessun test automatico le copre:

- pull su device aarch64 senza riferimento → deve prendere `latest-arm64`;
- installazione da archivio, invariata rispetto a oggi;
- **installazione pulita con `--data` non standard**: controllare *quale* directory è
  stata svuotata;
- registry col cavo staccato → il runtime in servizio deve restare in piedi (lo script
  fallisce al passo `[2/6]`, prima di rimuovere il container al `[4/6]`).

---

## 6. Ordine di esecuzione

1. `install-container.sh`: architettura da `uname -m`, `--pull-only`, intestazione.
   Isolato e verificabile subito.
2. `packaging.rs` parte pura + test. Verde prima di toccare l'handler.
3. `packaging.rs` richiesta e handler: validazioni anticipate, scp condizionale, passi di
   pull-only e purge.
4. Prova di compatibilità col payload vecchio.
5. UI, i18n, test frontend.
6. Documentazione: tabella delle flag in `docs/DEPLOY_CONTAINER_AARCH64.md` (riga 313,
   oggi dichiara `latest-arm64` come default), `docs/DEPLOY_CONTAINER_X86_64.md`,
   `CHANGELOG.md` sotto `[Unreleased]`, `STATUS.md` a fine sessione.

## 7. Nota di processo

Il maintainer è in partenza per le ferie e lavora da due macchine. Secondo `CLAUDE.md`
§"Piani di lavoro", questo piano va copiato in
`docs/plans/2026-07-31-installa-da-registry.md` e committato: i piani in `~/.claude/plans/`
sono per macchina e non viaggiano con git — è già successo il 2026-07-30 che un'analisi
scritta a casa non sia arrivata in ufficio.
