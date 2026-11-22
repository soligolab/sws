# Dev, rc e release: build più veloci e il portale di sviluppo — piano

> **Stato: piano — approvato il 22-11-2026** («Partiamo»). Nato dal seme «build veloce e due portali» del 05-11-2026, il
> cui testo è in fondo a questo file (§ «Il seme del 05-11-2026»), portato in piano il 22-11-2026 su richiesta del maintainer («mi interessa in particolare per la fase in
> cui faccio delle rc»).
>
> **Il cambio di concetto, parole del maintainer**: «le rc dovrebbero essere finalizzate alla release, quindi solo
> bugfix, noi ora le usiamo come dev. Possiamo introdurre la dev e usare i multicore per rust, le performance e bugfix
> le sistemiamo nelle rc». E sulla versione: «dal mio punto di vista è comunque una versione ma non testata».
>
> **Scelte del maintainer del 22-11-2026**:
> - tre livelli: **dev** (lavoro di tutti i giorni, profilo Rust leggero su più core), **rc** (solo correzioni e
>   prestazioni verso la release, profilo release pieno), **release**;
> - **la 2.26.0 entra in stabilizzazione**: da ora solo correzioni (rc.27, rc.28…) fino al rilascio; il lavoro nuovo è
>   **2.27.0-dev.N**, compreso questo piano;
> - le correzioni della 2.26.0 stanno su un ramo **`release/2.26`**, da cui escono rc e release; `main` passa alla
>   2.27.0-dev; le correzioni si riportano in `main` con `cherry-pick`;
> - **la versione letta da fuori del binario** (il numero, rc o dev, resta la versione del prodotto: cambia solo dove è
>   scritto);
> - una build **dev** fa solo **amd64** (portale), arm64 e Tiny TY a richiesta; una **rc** fa sempre **tutte e tre, in
>   parallelo**;
> - il portale di sviluppo **sullo stesso VPS, con un secondo gateway**; nel dev **copie** dei progetti; il dev segue
>   **dev e rc**, `sws.soligo.net` **solo le release**;
> - prima la build, poi il portale («ci servirà per il portale»).

## Le misure di oggi (22-11-2026, `ufficio`: 4 core, 22 GB, 45 GB liberi su 915)

Una rc costa **~75 minuti di build**, tutta in fila, prima di VPS e pannello (log `tmp/build-rc25.log`,
`tmp/build-tinyty-rc25.log`):

| Gamba | runtime | viewer LVGL | resto | totale |
|---|---|---|---|---|
| arm64 (`build_container.sh`) | 17m20 | 5m22 | SPA, immagine, push, archivio ~3 min | ~26 min |
| amd64 (`build_container_x86_64.sh`) | 16m26 | 5m03 | idem | ~24 min |
| Tiny TY armv7 (`pacchetto_tiny_ty.sh`) | 16m33 | 4m11 | pacchetto ~2 min | ~24 min |

- **Perché un core solo**: `[profile.release]` ha `lto = "thin"` e `codegen-units = 1` (ogni crate è un blocco unico,
  ottimizzato su un core: binario più veloce e più piccolo, voluto per PX30 e Tiny TY), e i crate sono in catena
  (`sws-core` → `sws-web`, 108 804 righe → `sws-runtime`). Dividere `sws-web` è nel seme
  [riorganizzare il codice](semi/2026-09-22-riorganizzare-i-file-dell-editor.md).
- **La versione è compilata nel binario** (`env!("CARGO_PKG_VERSION")`: `sws-core::project::runtime_version()`, la
  costante `sws-web::aggiornamento::VERSIONE` usata in sei punti, `system.rs`, `mcp.rs`, `control_panel`, `main.rs`,
  il viewer LVGL), e per cargo la versione di `Cargo.toml` fa parte dell'identità di ogni crate: ogni `-rc.N` ricompila
  tutti i 16 crate `sws-*`. La rc.26 cambia solo la SPA e ricompila tutto il Rust tre volte.
- **Il builder arm64 si rifà ancora da capo**: nella rc.24 e nella rc.25 (a un'ora l'una dall'altra) usciva dalla
  cache; la mattina dopo, nella rc.26, lo stadio `sysroot` senza nome era stato tolto e si è rifatto con apt, e rustup
  ha reinstallato la `stable` (`tmp/build-rc26.log`, righe 8-1172).
- Le cartelle target dei builder: 17 GB arm64, 15 GB amd64, 3,4 GB armv7, 2,5 GB del vecchio `aarch64-generic`.
- Il VPS: 2 vCPU, 3,8 GB (3,1 disponibili), 25 GB di disco liberi; girano Traefik, Portainer, il manuale, il gateway e
  CasaDomotica. Il prefisso dei container di progetto è fisso (`gateway/podman.rs`, `NOME_PREFISSO = "sws-p-"`).

## Parte 0 — il ramo di release (subito, solo git e documenti)

> **Fatta il 22-11-2026** (`a8e6c3e3` in `main`): `release/2.26` da `049fa8bd` (la rc.26 più i documenti), `main` a
> `2.27.0-dev.0`, CHANGELOG diviso, le guardie (`novita.py` legge i tag, `check_release_coerente.sh` accetta la sezione
> «in stabilizzazione» finché c'è il ramo), `session_start.sh`, `/finalizza-giornata`, HOWTO §19 e `CLAUDE.md`
> (regola 2, eccezione a «un ramo alla volta», «Dev, rc e release»). Né `release/2.26` né i commit sono ancora su origin.

- `release/2.26` da `2.26.0-rc.26` (`c3180ab9`). Da lì le rc.27… con le sole correzioni (le anomalie aperte del
  collaudo: Kimi in streaming, Modbus e i testi dei log, i log rumorosi dell'aggiornamento, il 422 grezzo, e quelle che
  usciranno) e la 2.26.0.
- `main` passa a `2.27.0-dev.0` e apre il blocco 2.27.0 di `NOVITA.yaml` e di `CHANGELOG.md`.
- Una correzione si fa su un ramo `fix/…` **da `release/2.26`**, si squasha lì, poi `git cherry-pick` in `main`. Il
  messaggio dice da dove viene.
- **Regole da scrivere in `CLAUDE.md`** (con il maintainer): `release/X.Y` non è un ramo di lavoro, è un'eccezione alla
  regola «un ramo alla volta» come `backup/main-pre-riscrittura-2026-09-09`; si elimina dopo la release e il riporto in
  `main`. «Mai commit diretti su `main`» vale anche per `release/X.Y`. `session_start.sh` e `/finalizza-giornata`
  devono conoscere il ramo di release (oggi segnalerebbero un ramo aperto). HOWTO §19 riscritto: le tre versioni.
- **Finché il portale di sviluppo non c'è** (Parte 3), `sws.soligo.net` resta sulla rc.26 e prende le rc della
  2.26.0; le dev si provano nell'IDE locale 8460 e sui pannelli a richiesta.

## Parte 1 — la versione da fuori (`feat/version-outside`, in `main`, 2.27.0-dev)

**Obiettivo**: una dev o una rc che non tocca il Rust non ricompila il Rust.

> **Fatta il 22-11-2026 sul ramo `feat/version-outside`**: `VERSION` e `scripts/versione.sh`, `runtime_version()` da
> `SWS_VERSION`, `ENV` nei Containerfile, Tiny TY e Linux generico dal file `VERSIONE`, script di avvio locali, guardie
> e script di build che leggono `VERSION`, il canale `dev-<arch>` (runtime e IDE). Restano per la parte 2: **chi sposta
> `dev-<arch>`** (una rc della 2.26 non deve riportarlo sotto una dev della 2.27: si sposta con le dev, e con una rc o
> release solo se è la versione più alta), e **la scelta del canale all'installazione** (oggi l'IDE installa
> `latest-*` o `rc-*`). Trovato per strada, da correggere su `release/2.26`: `deploy/generic-linux/sws-runtime-launch.sh`
> è `#!/usr/bin/env sh` ma usa un array di bash (`NO_ADMIN_ARGS=(--no-admin)`, da `363e79ce`): con `/bin/sh` = dash
> (Debian, Ubuntu) il runtime generico non parte.

- **Un file solo per la versione del prodotto**: `VERSION` in radice (`2.27.0-dev.3`, `2.26.0-rc.27`). Lo leggono gli
  script (`build_container*.sh`, `pacchetto_tiny_ty.sh`, `check_release_coerente.sh`, `check_versione_progetto.sh`,
  `novita.py`) e `package.json` lo segue. **`Cargo.toml` porta solo il numero della release** (`2.27.0`) e cambia
  solo quando cambia la release.
- **Il runtime legge la versione all'avvio**: `sws-core::project::runtime_version()` prende `SWS_VERSION`
  dall'ambiente (una volta, `OnceLock`), con `CARGO_PKG_VERSION` di riserva. `aggiornamento::VERSIONE` diventa una
  funzione che chiama quella; gli altri usi passano da lì, viewer LVGL compreso.
- **Chi la imposta**: le immagini con `ENV SWS_VERSION=$SWS_VERSION` (l'`ARG` c'è già, oggi finisce solo
  nell'etichetta: la ereditano anche i container di progetto del gateway e quello del viewer LVGL); il Tiny TY dal
  file `VERSIONE` del pacchetto (c'è già), esportato da `sws-runtime-launch.sh` e `sws-lvgl-viewer-launch.sh`; gli
  script nativi (`start_runtime.sh`, `start_editor*.sh`) dal file `VERSION`.
- **L'ordine semver delle dev**: `2.27.0-dev.N` < `2.27.0-rc.1` < `2.27.0`. Il canale di aggiornamento dei pannelli
  impara il canale **dev** (`dev-arm64`, `dev-amd64`), accanto a rc e stabile; da verificare in `aggiornamento.rs` e
  nell'IDE («Aggiornamento del runtime»), e le NOVITA delle dev.
- **Da verificare nel ramo**: tutti i confronti di versione (aggiornamento, «Deploy verso un pannello ancora sulla
  rc.22», NOVITA per versione, `saved_by` di `project.yaml`) leggono la stessa funzione. Un test che avvia il runtime
  con una `SWS_VERSION` diversa da `Cargo.toml` e controlla `/api/system`.

## Parte 2 — gli script: dev leggera, rc in parallelo (`feat/build-dev-rc`, in `main`)

> **Fatta il 22-11-2026** (squash in `main` insieme alla parte 1, riportata su `release/2.26` col via del maintainer):
> `build_dev.sh`, `build_rc.sh`, `lib_build.sh`, `registro.py`; il profilo `dev-image`; l'impronta del Rust; i tag
> mobili per canale; builder con rustc 1.100.0, basi Ubuntu per digest e lo stadio `sysroot` col nome; la paginazione
> dei tag nel runtime. Le misure sono qui sotto. La prima build **pubblicata** con gli script nuovi sarà la rc.27.

- **Un profilo per le dev**: `[profile.dev-image]` con `inherits = "release"`, `lto = "off"` (non `false`, che vuol
  dire thin-local), `codegen-units = 16`, `incremental = true`. Stima: il runtime da ~16 a 3-5 minuti. **Mai per rc e
  release.** Costa disco (una seconda serie di dipendenze compilate per architettura): si misura, e si decide la
  pulizia (oggi 45 GB liberi, 95 %), a partire dal vecchio `target-container-aarch64-generic` (2,5 GB, non più
  usato dal 14-09).
- **Uno script per livello**:
  - `scripts/build_dev.sh [--push] [--arm64] [--tiny-ty]`: profilo leggero, amd64 sempre, le altre a richiesta.
    Tag `<versione>-<arch>`, `<commit>-<arch>` e il mobile `dev-<arch>`; mai `rc-*` né `latest-*`.
  - `scripts/build_rc.sh [--push]`: profilo release, SPA e patch vendorizzate una volta, poi **le tre gambe in
    parallelo**, ognuna col suo log (`tmp/build-<versione>-<gamba>.log`), i tempi di ogni passo alla fine. Una gamba
    che fallisce non ferma le altre, ma lo script esce in errore e non sposta nessun tag mobile. Rifiuta di partire
    fuori da `release/X.Y` e se `HEAD` non porta il tag della versione.
  - una release: lo stesso `build_rc.sh` con una versione senza suffisso, che sposta anche `latest-*`.
- **Il Rust si salta da solo** quando i sorgenti Rust (`sws-runtime/**`, `Cargo.lock`, i builder) hanno la stessa
  impronta dell'ultima build riuscita di quella gamba e di quel profilo (`target-container-*/.impronta`). `--rust` la
  forza.
- **Il builder che non si rifà**: lo stadio `sysroot` con un nome (`sws-runtime-builder:aarch64-sysroot`), le immagini
  `sws-runtime-builder:*` escluse dalla pulizia delle immagini vecchie (eccezione da scrivere nella memoria relativa),
  rustc fissato a una versione nei tre Containerfile dei builder (oggi `stable`), cambiata a mano quando si decide.
- **Il conflitto sul tag `ubuntu:24.04`** fra gambe parallele (`pull --platform` diversi dello stesso tag): `FROM` col
  digest per architettura.
- **I due difetti del seme**, ancora veri: `--no-rust` sull'arm64 salta anche la `pnpm build`, e il ramo `*)` sposta
  `latest-*` senza controllo.
- **I tag nel registry**: con le dev ne arrivano molti di più, e i pannelli leggono `tags/list?n=1000` senza
  paginazione (`aggiornamento.rs`). Paginazione e una regola di potatura dei tag `<commit>-*` e delle dev vecchie.
- **La prima misura del parallelo** (22-11-2026, rc.26, 4 core): il pacchetto del Tiny TY lanciato alle 08:42 accanto
  alla gamba arm64. Il runtime arm64 è passato da 17m20 (rc.25, da solo) a **17m59**; quello armv7 da 16m33 a
  **20m19**, il viewer armv7 da 4m11 a 4m51. Il Tiny TY intero (col builder rifatto) in 30 minuti, finito alle 09:12
  mentre l'arm64 pubblicava: in fila sarebbe partito dopo l'amd64, verso le 09:35. Due gambe insieme costano poco
  l'una all'altra, come ci si aspettava dal link su un core; con tre si misura. Primo passo del ramo:
  `cargo build --timings` per sapere quanto del tempo è il link.

### Le misure della parte 2 (22-11-2026, `ufficio`, 4 core; `build_dev.sh --tutte`, senza push)

| Prova | Tempo | Cosa è successo |
|---|---|---|
| prima dev col profilo `dev-image`, a freddo | **61 min** | tre gambe insieme; cargo ha compilato tutte le dipendenze (oltre mille crate) col profilo nuovo, per tre architetture. Runtime: arm64 43m11, amd64 33m48, armv7 35m20. Si paga una volta |
| la stessa, rilanciata senza toccare il Rust | **1 min 7 s** | «Rust invariato… binari riusati» sulle tre gambe: SPA, tre immagini e il pacchetto del Tiny TY |
| una riga cambiata in `sws-web`, solo amd64 | **1 min 20 s** | `sws-web` e `sws-runtime` ricompilati in **17,7 s** (profilo leggero, incrementale), poi l'immagine. Col profilo release lo stesso giro costava ~16 minuti |

Disco: il profilo `dev-image` ha aggiunto ~15 GB fra le tre cartelle target. Il 22-11 il disco era arrivato al 99 %
per `sws-runtime/target` (la build nativa, 228 GB di copie vecchie lasciate dai cambi di versione): tolti i file di
`deps` più vecchi di un giorno e la cartella incremental, da 11 a 202 GB liberi.

## Parte 3 — il portale di sviluppo (`feat/dev-portal`, in `main`)

**Obiettivo**: `dev.sws.soligo.net` segue dev e rc; `sws.soligo.net` resta sull'ultima release e non si ferma più a
ogni prova.

- **Codice**: il prefisso dei container per gateway (`--gateway-prefisso`, default `sws-p-`; il dev `sws-d-`), usato nei
  nomi, negli alias DNS e nella pulizia all'avvio, che tocca solo i propri. Oggi due gateway sullo stesso podman si
  cancellano i container a vicenda. Un test.
- **VPS**: un secondo quadlet `sws-gateway-dev.container`, con la sua configurazione (`~/sws-vps/gateway-dev-config`:
  `identita.db`, segreto, abbinamenti) e la sua radice dei progetti (`~/sws-vps/progetti-dev`); un router Traefik per
  `dev.sws.soligo.net`, **il DNS su Cloudflare prima del router** (Let's Encrypt blocca dopo poche richieste fallite).
  Copia maestra in `deploy/vps/quadlet/`, stato in `deploy/vps/STATO.md`, `check_etichette_container.sh` col quadlet
  nuovo. `build_dev.sh --deploy` e `build_rc.sh --deploy` aggiornano il gateway dev a fine build.
- **Account**: `identita.db` del dev parte come copia di quello stabile (lo schema migra solo in avanti: la copia va
  dallo stabile al dev, mai al contrario).
- **Progetti**: copie, con `scripts/copia_progetto_in_dev.sh <azienda> <progetto>` (lo storico a scelta). CasaDomotica
  vera e il TC620 di casa restano sullo stabile.
- **I pannelli restano sul tunnel dello stabile**, e scelgono il canale (dev, rc, stabile) dall'IDE. Un pannello in dev
  collegato a un gateway in release: il protocollo del tunnel deve reggere la differenza; da verificare nel ramo. Se non
  regge, un pannello di prova si abbina al dev.
- **Risorse**: si misura con due progetti aperti per gateway, sui 3,1 GB disponibili.
- **Prassi che cambia** (memorie «fine task: pubblica e allinea» e «il VPS sempre aggiornato», `deploy/vps/STATO.md`):
  diventano **il dev sempre aggiornato**; `sws.soligo.net` passa alla 2.26.0 al rilascio e da lì solo release.

## Ordine e verifica

0 → 1 → 2 → 3, un ramo di lavoro alla volta, tutti in `main` (2.27.0-dev). Per ogni ramo: `cargo check`, `cargo test`,
`pnpm build`, `pnpm exec vitest run`, `./scripts/check_static.sh`, poi la prova vera: una dev costruita con lo script
nuovo (tempi misurati e scritti qui), poi una rc da `release/2.26` in parallelo, gateway dev su, aggiornamento del
TC620 dal canale scelto. Collaudo con `/test-changes`. Niente push senza richiesta.

## Fuori dal piano

- Dividere `sws-web` in crate più piccoli: nel seme [riorganizzare il codice](semi/2026-09-22-riorganizzare-i-file-dell-editor.md)
  (decisione del maintainer del 22-11-2026).
- La CI di GitHub che costruisce le immagini, e il dev che segue ogni commit di `main` da solo.

## Il seme del 05-11-2026 (materiale, com'era)

> Il testo del seme, con le misure di allora. Le parti superate dalle scelte del 22-11-2026 restano come referto.

> **Stato: seme — decisione.** Nato il 05-11-2026, mentre si costruiva la 2.25.1, da una domanda del maintainer:
> «esiste un modo, fin che siamo in sviluppo, per accelerare la fase di build e rilascio di ogni aggiornamento? Un
> modo che non preveda di ricompilare ogni volta i container?». E poi: «non è prioritario ma è una cosa che vorrei
> valutare in futuro assieme a due portali, uno stabile per i clienti (sws.soligo.net) e uno developer dove c'è
> sempre l'ultimo codice, comodo per lo sviluppo».
>
> **Quando questo lavoro comincia, il primo passo è una sessione di plan approfondita, dedicata, per sviscerarne
> tutti i dettagli.** Qui ci sono l'idea, le misure del 05-11-2026 e le strade viste da un'analisi in sola lettura
> (quattro misure, un progettista, due verifiche: una contro il codice, una contro le regole del progetto). Non è
> un progetto, e nessuna strada è decisa.

### L'idea

Due cose che vanno pensate insieme, perché la seconda cambia il peso della prima:

1. **Ogni immagine costa troppo**: 36-75 minuti per una release, e ogni prova sul VPS o su un pannello passa oggi
   da un'immagine completa. Nel periodo 20-10 → 05-11 le build sono state una ventina, più le immagini di prova
   col tag del commit (sette sul VPS il 31-10, quattro il 02-11).
2. **Due portali**: `sws.soligo.net` diventa il portale **stabile**, per i clienti, e segue solo le release. Un
   secondo portale, **di sviluppo**, ha sempre l'ultimo codice: è lì che il maintainer lavora e prova ogni giorno.
   Oggi i due ruoli stanno nello stesso gateway, quindi una prova rotta ferma l'IDE di tutti i giorni, e ogni
   rilascio interrompe il lavoro per qualche secondo.

### Le misure del 05-11-2026

#### Dove va il tempo

| Build | Builder aarch64 | cargo runtime arm64 | cargo viewer LVGL | cargo runtime amd64 | Totale |
|---|---|---|---|---|---|
| 2.22.0 e 2.23.6 (cache calde, builder in cache) | ~1 min | 14 min | 4,5 min | 13 min | **~36 min** |
| 2.25.0 (worktree nuovo, cache vuote) | 20m44s | 21m14s | 8m27s | 20m37s | **~75 min** |
| 2.25.1 (cache spostate nel worktree con `mv`) | 18m56s | 16m08s | 5m00s | 16m11s | **~60 min** |

I passi «container» veri costano poco: immagine finale 27-37 s, push 15-22 s, `podman save` più gzip ~45 s (arm64)
e ~29 s (amd64), SPA 10-16 s (fatta **due volte**, una per gamba). Log in `tmp/build-2.25.0.log` e
`tmp/build-2.25.1.log` (su theobroma, non versionati).

#### Perché

- **Il builder aarch64 si ricostruisce a ogni build, dal 29-10 (2.23.7).** Il suo primo stadio, `sysroot`
  (`deploy/container/Containerfile.aarch64-cross.builder:45`), è un'immagine **senza nome**: il builder finale lo
  copia (`COPY --from=sysroot`, riga 85) ma non ne discende, quindi resta «dangling» e la pulizia lo cancella
  (`podman image prune -f` in `scripts/clean_disk_space.sh:111`, e la memoria «immagini podman vecchie», che tiene i
  builder solo durante una build). Fino alla 2.23.6 lo stadio usciva dalla cache e il builder prendeva un minuto.
  Il 05-11, dopo la build, è stato cancellato ancora (`00565d3ca982`, 513 MB): la prossima build arm64 ripaga i
  19 minuti. Il builder x86 non ha il problema: ha un solo stadio, e i suoi layer sono antenati dell'immagine col tag.
- **La toolchain Rust non è fissata**: `--default-toolchain stable` (`Containerfile.aarch64-cross.builder:93`,
  `Containerfile.x86_64.builder:48`), oggi rustc 1.99.1. INFERENZA: alla prossima stable il primo builder rifatto
  cambia rustc e cargo non riusa più niente; si torna a una build a freddo, e le cartelle target **crescono** (una
  seconda serie di artefatti), su un disco che ha 6-9 GB liberi.
- **La coda della compilazione è seriale.** Misurato dal vivo nella 2.25.1: `sws_web` su un core per ~6,5 minuti,
  poi `sws_runtime` (thin LTO) su un core per ~9 minuti, con un carico medio di 1,5-1,8 su 8 core.
  `[profile.release]` in `sws-runtime/Cargo.toml:157-161`: `lto = "thin"`, `codegen-units = 1`. Per questo le
  cache calde aiutano poco: nella 2.25.1 cargo ha ricompilato 41 crate invece di 1027, e ha impiegato il 24% in meno.
- **La versione è compilata nel binario** (`env!("CARGO_PKG_VERSION")`, `sws-web/src/aggiornamento.rs:19`), ed è
  una sola per il workspace (`sws-runtime/Cargo.toml:20`): ogni cambio di versione ricompila tutti i 16 crate
  `sws-*`, anche per una release che tocca solo la SPA.
- **Le cache stanno dentro il checkout** (`$REPO/sws-runtime/target-container-*`, `$REPO/.cargo-container-*`):
  27 GB fra le tre cartelle target, quindi un worktree nuovo parte a freddo. Dentro il container il percorso è
  sempre `/src`, quindi le cache si possono spostare da un albero all'altro: è stato fatto per la 2.25.1.
- INFERENZA, da verificare: `sws-web/build.rs:27-30` chiede di rieseguire il build script quando cambiano
  `.git/HEAD` e `.git/index`. In un worktree `.git` è un file, quindi quei percorsi non esistono; nel checkout ogni
  commit riscrive l'indice. In tutti e due i casi `sws-web` si ricompila a ogni giro. Nei builder git non c'è, e
  la revisione dentro le immagini vale sempre «sconosciuta» (`build.rs:32-47`).

#### Due difetti trovati per strada (veri anche senza questo piano)

- **`build_containers_all.sh --no-rust`, documentato in `docs/HOWTO.md` §5, pubblica l'immagine arm64 con la SPA
  vecchia**: in `scripts/build_container.sh` la `pnpm build` sta dentro il blocco Rust (righe 156 e 172-178), mentre
  `build_container_x86_64.sh` la fa sempre (169-171). E `--no-rust` dopo un cambio di versione mette nell'immagine
  un binario che dichiara la versione vecchia.
- **Il ramo `*)` degli script sposta `latest-*` e `rc-*` senza nessun controllo** (`build_container.sh:353`,
  `build_container_x86_64.sh:270`): una build di ramo che porta ancora il numero dell'ultima release la sostituisce
  e sposta il canale stabile. È il caso delle quattro immagini del 02-11 a 2.24.0.

### Le strade per la build, da pesare nella sessione di plan

Dalla più piccola. I risparmi senza misura sono **stime**.

1. **Il builder che non si rifà più.** Dare un nome allo stadio sysroot (`podman build --target sysroot -t
   sws-runtime-builder:aarch64-sysroot`), oppure saltare il build del builder quando la sua etichetta porta lo stesso
   hash del Containerfile. In tutti e due i casi le immagini `sws-runtime-builder:*` vanno escluse dalla pulizia:
   **è un'eccezione alla regola del maintainer sulle immagini vecchie, e la decide lui.** In più, fissare rustc
   (`1.99.1` invece di `stable`), che va contro la scelta scritta in `Containerfile.x86_64.builder:41-43` («il canale
   stabile tiene il passo»). Risparmio misurato: 18-21 minuti a ogni build arm64. Costo: poche righe per script.
2. **Un worktree di build fisso, con le sue cache.** Uno solo e permanente, al posto di un worktree nuovo per
   release: ci si fa `checkout --detach` del tag e si lancia lo script di sempre. Niente più build a freddo né 27 GB
   da spostare a mano. Da decidere dove: fuori dal progetto le regole di `.claude/settings.json` non valgono e ogni
   build chiede un permesso; dentro `sws/tmp/` no, perché quella cartella si svuota. Servono il lock della traccia
   T-66 (`flock`, `docs/HOWTO.md:394`) e `--no-save`, o una pulizia degli archivi (~275 MB per release).
3. **La SPA nel portale senza immagine**, per i giri solo React, traduzioni o simboli. Due forme: `podman cp` della
   `dist` dentro il gateway che gira (sparisce da sola al riavvio successivo, quindi non può sopravvivere a una
   release), oppure una cartella montata con un drop-in del quadlet. Circa un minuto invece di 15-20. Limiti
   verificati: vale solo se il Rust non è cambiato; le finestre staccate di chat e registro le serve il container
   del progetto, quindi restano alla versione dell'immagine (i loro `/assets/` invece vengono dal gateway: niente
   `--delete`); l'avviso «pagina vecchia» non scatta, perché dentro un progetto `/api/system` risponde il container;
   la `dist` va costruita in un albero pulito, non nel checkout condiviso (dove c'è l'IDE 8460 e, su theobroma, il
   marchio Pixsys in `branding/active.json`); il VPS deve dirlo in `deploy/vps/STATO.md`.
4. **Immagini di prova `dev-<sha>-<arch>`**: una sola architettura (amd64 per il VPS, arm64 per un pannello),
   senza cambiare versione, senza tag, senza NOVITA, e **mai** `latest-*` né `rc-*`. Con `--no-rust` (corretto) un
   giro solo SPA costa 1-2 minuti. La variante «sottile» (`FROM` dell'ultima release più i file cambiati) rischia di
   restare indietro sui Containerfile (HEALTHCHECK, porte, pacchetti: già successo con `8f5f2d10` e `9260a9b4`).
   Limiti: il binario dichiara la versione del ramo; su un pannello si installa (canale Fissata), non si «aggiorna»,
   perché a versione uguale `decidi()` dà NonRiuscito (`aggiornamento_esito.rs:78-86`). **Contraddice la prassi del
   HOWTO §19** (un'immagine di prova porta una versione `-rc`, «senza, non sapresti quale delle due gira») e il
   commento del quadlet del gateway del 14-10 (inchiodare il tag di versione): decide il maintainer.
5. **Le due architetture in parallelo**, una SPA sola, archivio solo a richiesta. Stima: una release da ~36 a
   ~20-24 minuti, se 1 e 2 sono fatte. Rischi: il tag locale `ubuntu:24.04` cambia architettura a ogni pull con un
   `--platform` diverso, e due gambe insieme se lo contendono (rimedio: `FROM` col digest); va aggiornata la memoria
   «le due build non si lanciano insieme».
6. **Un profilo cargo leggero, solo per le immagini di prova**: `[profile.dev-image]` con `inherits = "release"`,
   `lto = "off"` (attenzione: `false` vuol dire thin-local), `codegen-units = 16`, `incremental = true`. Stima: il
   Rust da 11-16 a 3-5 minuti. Costa disco (una seconda serie di dipendenze compilate, più le cartelle incremental),
   e il disco oggi non c'è. Mai per `-rc` e release; le prestazioni sul PX30 si collaudano sulla `-rc`.
7. **Tre livelli, scritti**: *dev* (la maggior parte dei giri, strada 4), *rc* (quando un pannello deve riceverla
   da solo dal canale di prova), *release* (dopo lo squash, due architetture, tag al momento della build, NOVITA,
   VPS). Con una guardia: `--push` di una versione `X.Y.Z` rifiutato se `HEAD` non porta il tag `X.Y.Z`
   (`git describe --exact-match`); la procedura diventa «tag locale prima della build, push del tag dopo la
   pubblicazione, tag tolto se la build fallisce». Seme nel seme: il runtime che legge la versione dall'etichetta
   dell'immagine (`ARG SWS_VERSION` c'è già) invece che dal binario; allora una release solo SPA non ricompila.

Esistono già, per i giri solo SPA senza portale: l'IDE 8460 nativo (cargo dev incrementale ~1m20s) e `pnpm dev` con
`VITE_RUNTIME_URL` verso un pannello (`sws-editor/vite.config.ts:31-37`).

Una nota sul canale di prova, corretta dalla verifica: le Novità si leggono dalle ultime cinque versioni del canale
(`aggiornamento.rs:535`, 549-552) e una `-rc` porta le Novità della release a cui arriva, quindi molte `-rc` di una
stessa release non perdono niente. Il rischio vero è che le `-rc` della release successiva spingano fuori dalla
finestra una release **intermedia**.

### I due portali

Misure del 05-11-2026, in sola lettura (repo e VPS).

**Oggi `sws.soligo.net` è già, in pratica, il portale di sviluppo.** La regola è che il gateway segua ogni immagine
costruita (`deploy/vps/STATO.md:230-233`, memoria «il VPS sempre aggiornato»): sette immagini di commit il 31-10,
quattro il 02-11, ventitré quadlet di riserva fra il 15 e il 20-10. Con due portali quella regola passa al portale di
sviluppo, e lo stabile segue solo le release: è un cambio di prassi, e lo decide il maintainer.

| Cosa | Oggi | Dove sta |
|---|---|---|
| Il VPS | 2 vCPU, 3,7 GiB senza swap (3,1 disponibili), 29 GB di disco liberi; girano Traefik, Portainer e il gateway | `ssh` del 05-11, `STATO.md:11` |
| I container dei progetti | tetto di 256 MB e 512 processi l'uno, 23-41 MB in uso, si fermano dopo 20 minuti fermi; nessun tetto sul numero (`--gateway-max-container` assente) | `gateway/progetti.rs:33-52` |
| Un nome nuovo | un record DNS su Cloudflare (solo DNS, nessun wildcard) e un file di router di Traefik, che si ricarica da solo; il certificato arriva da Let's Encrypt (HTTP-01); nessuna porta nuova. Il DNS va **prima** del router: Let's Encrypt blocca dopo poche richieste fallite | `traefik.yml:58-77`, `dynamic/sws-gateway.yml`, `STATO.md:76-77` |
| Due gateway con lo stesso podman | **si cancellano a vicenda**: il prefisso dei container è fisso (`sws-p-`), il nome dipende solo da azienda e progetto, e all'avvio un gateway ferma e rimuove i container `sws-p-*` che hanno un'immagine diversa dalla sua | `gateway/podman.rs:42`, `:50-73`, `:218-266`; `gateway/progetti.rs:278-361` |
| Lo stato del gateway | tutto in `~/sws-vps/gateway-config`: `identita.db`, `segreto_gateway`, gli abbinamenti dei pannelli, `audit.jsonl`. Il segreto firma le chiavi dei container e i gettoni dei pannelli: un gateway con un segreto diverso non riconosce quelli dell'altro. `identita.db` migra solo in avanti e a ogni apertura scrive `user_version = 6`, senza guardia contro uno schema più nuovo | `gateway/mod.rs:13-53`, `tunnel/abbinati.rs:8-11`, `sws-identita/src/lib.rs:560-622` |
| La radice dei progetti | 18-20 cartelle del maintainer (CasaDomotica col suo storico SQLite e il suo `.git`), montate in lettura e scrittura nei container; nessun lock fra processi (seme [due editor sullo stesso progetto](semi/2026-10-21-due-editor-sullo-stesso-progetto.md)) | `gateway/progetti.rs:567-572`, `:773-783` |
| I pannelli | un solo indirizzo di tunnel, scritto nell'immagine (`SWS_TUNNEL_URL=wss://tunnel.soligo.net/tunnel/v1`), e una sola coppia nome+gettone. Un portale di sviluppo vede un pannello solo se lo si reinstalla col suo `--tunnel` e lo si riabbina. Oggi gli abbinati sono due: `tc620-garage` e `wp630-ufficio` | `Containerfile.aarch64:143`, `install-container.sh:375` |
| La CI di GitHub | **non costruisce immagini** (permessi `contents: read`, il lavoro delle immagini tolto il 02-09) e **è rossa dal 05-10**: le ultime 100 esecuzioni fallite, anche quella della 2.25.0 (`b8849b4d`), ferma a `cargo clippy -- -D warnings` mentre in locale è verde. Vede solo il codice pushato. Un'immagine amd64 si potrebbe costruire su un runner di GitHub (l'ultima build e test verde: 450 s, il 14-09) | `.github/workflows/ci.yml:3-11`, `:212-227`; API delle esecuzioni |
| Gli script lanciati su `main` da soli | oggi **sovrascriverebbero la release**: `main` dichiara 2.25.1 ma la sua punta non porta il tag, e il ramo `*)` sposterebbe `2.25.1-amd64`, `latest` e `rc`. La guardia della strada 7 è un prerequisito | `build_container_x86_64.sh:257-276` |
| I tag nel registry | 284 oggi (180 di commit). Il controllo degli aggiornamenti dei pannelli legge `tags/list?n=1000` **senza paginazione**. INFERENZA: un tag per commit (398 commit in 30 giorni) supera i 1000 in circa due mesi, e allora i tag delle release più nuove possono uscire dalla lista che i pannelli leggono. Serve una regola di potatura | `aggiornamento.rs:347-360` |
| Come il VPS prende un'immagine nuova | a mano (`Image=` e `--gateway-immagine` insieme, poi il riavvio). `podman auto-update` su un tag mobile riavvierebbe anche Traefik, che ha `AutoUpdate=registry`, e il gateway confronta i **nomi** delle immagini per riadottare i container, quindi un tag mobile li confonde. Una chiave SSH per la CI agirebbe come `debian`, che ha sudo senza password | `sws-gateway.container:32-41`, `traefik.container:10-11`, `progetti.rs:260-262` |
| Copie e guardie | `salva-stato.sh` archivia solo `acme.json` e Portainer, non `gateway-config` né i progetti; `check_etichette_container.sh` elenca i quadlet a mano | `deploy/vps/salva-stato.sh:12-14`, `scripts/check_etichette_container.sh:35-37` |

Le strade viste, da pesare:

- **A. Un secondo gateway sullo stesso VPS e con lo stesso utente**: un altro `ContainerName`, un'altra cartella di
  configurazione, un'altra radice dei progetti, un nome come `dev.sws.soligo.net`, un router in più. Possibile solo
  dopo una modifica al codice che distingua i container dei due gateway (un prefisso o un'etichetta per gateway).
  Il portale di sviluppo e i suoi progetti dividono CPU e RAM con quello dei clienti.
- **B. Un secondo utente Linux sullo stesso VPS**, col suo podman: niente codice da toccare, ma Traefik non lo
  raggiunge per nome sulla `sws-rete`. Da verificare.
- **C. Un secondo VPS**: niente convivenza da risolvere, un costo in più.
- **D. Nessun secondo gateway**: lo stabile resta l'unico portale, e per le prove restano l'IDE 8460, `pnpm dev` e
  le strade 3 e 4 della build.

E, qualunque strada: da dove arriva «l'ultimo codice» (theobroma a mano o con un timer, oppure una CI che prima va
rimessa verde e che vede solo il codice pushato); con che tag (`dev-<sha>` immutabile e da potare, un tag mobile, o
una versione `X.Y.Z-dev.N`); quali progetti vivono nel portale di sviluppo (copie, o gli stessi dello stabile); e se
uno o due pannelli di prova passano al tunnel di sviluppo.

### Domande per la sessione di plan

- I due portali prima, o la build prima? Con un portale di sviluppo che segue `main` da solo, le strade 3 e 4
  servono meno sul VPS e restano utili per i pannelli.
- Il portale di sviluppo: stesso VPS (A o B) o un secondo VPS (C)? Con quali progetti e quali pannelli?
- Quando `sws.soligo.net` smette di seguire ogni immagine: cambia la memoria «il VPS sempre aggiornato».
- Le immagini del portale di sviluppo: le costruisce theobroma o una CI? Con che nome (`dev-<sha>`, `main-amd64`)?
- L'eccezione per i builder nella regola delle immagini vecchie, e rustc fissato: sì o no?
- La prassi del HOWTO §19 (versioni `-rc` per ogni prova) resta, o lascia il posto alle `dev-<sha>`?
- Dove sta il worktree di build fisso, e chi lo pulisce.
