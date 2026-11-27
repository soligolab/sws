# L'immagine base del sistema: il sistema operativo in uno strato con un nome, i binari sopra (27-11-2026)

> **Stato: piano da rivedere con il maintainer** (27-11-2026). Le domande sono in fondo, nella sezione «Da decidere».

## Contesto

Il maintainer, 27-11-2026, durante la build della 2.28.0-dev.4: «la build del container genera sempre una immagine
completamente nuova? non potremmo fare l'immagine in due step, uno step crea il sistema operativo e lo rigenera solo
quando voglio fare fix di sicurezza o cambi di librerie e poi uno step che ci incolla sopra i binari?». Poi: «credo
meriti sicuramente un plan».

## Le misure di oggi

Le misure vengono dall'immagine `sws-runtime:2.28.0-dev.3-arm64` (`podman history`) e dai log di build in `tmp/`.

| Strato | Dimensione | A ogni build |
|---|---|---|
| Ubuntu 24.04, fissato al digest (`FROM …@sha256:9c7f…`) | 103 MB | uguale |
| `RUN apt-get install …` + `pip install RestrictedPython` | 388 MB | uguale **solo se** la cache di podman lo ha |
| `COPY bin/` (runtime e viewer LVGL) | 86 MB | nuovo |
| `www/`, template, catalogo, font, licenza, quadlet | circa 13 MB | nuovo se cambia |

- L'immagine **è già fatta a strati**. Nella stessa macchina lo strato `apt` esce dalla cache («Using cache
  b4c863b874c0…» nelle build della dev.3 e della dev.4). Il suo digest resta uguale, quindi ghcr.io non lo riceve di
  nuovo e il pannello non lo scarica di nuovo. Un aggiornamento costa circa 100 MB.
- **Il difetto.** La cache dello strato `apt` sta solo nella macchina che fa la build. Una build da un'altra macchina
  (l'Elitedesk invece dell'EliteBook) o dopo un `podman system prune` rifà `apt-get install` con i pacchetti di quel
  giorno. Il digest cambia, e **ogni pannello riscarica 388 MB**. Sul WP630, con la flash e la rete di un impianto, è
  il pezzo più lento dell'aggiornamento.
- **Il secondo difetto.** Gli aggiornamenti di sicurezza di Ubuntu entrano per caso, quando la cache si perde. Nessuno
  sa con quali pacchetti gira un pannello, e nessuno decide quando cambiarli.
- I Containerfile del runtime sono due: `deploy/container/Containerfile.aarch64` e `Containerfile.x86_64`. Hanno lo
  stesso `FROM` e quasi lo stesso `apt-get`. Con il viewer (`WITH_LVGL=1`, il default di tutti e due gli script)
  l'arm64 aggiunge SDL, EGL e Mesa; l'amd64 aggiunge solo `libdrm2`, `libfreetype6` e `fonts-dejavu-core`, perché
  Mesa porta dentro LLVM (270 MB).
- I **builder** (`Containerfile.aarch64-cross.builder`, `Containerfile.x86_64.builder`) restano locali. Compilano, ma
  non vanno sul pannello. La sysroot arm64 del builder installa `libpython3.12-dev` da `apt` in un giorno diverso da
  quello dell'immagine. Oggi le due versioni coincidono perché Ubuntu 24.04 non cambia ABI, ma niente lo garantisce.
- La **Tiny TY** non è un container: il pacchetto si installa sul sistema del pannello (`pacchetto_tiny_ty.sh`). Questo
  piano non la riguarda.

## Cosa si fa

1. **L'immagine base `ghcr.io/soligolab/sws-base`**, una per architettura: `sws-base:<versione>-arm64` e
   `sws-base:<versione>-amd64`. Contiene il `FROM` di Ubuntu, l'`apt-get install`, RestrictedPython e le cartelle
   vuote. Non contiene niente di SWS.
   - Il Containerfile nuovo è `deploy/container/Containerfile.base.<arch>`: il blocco `apt` esce dai Containerfile del
     runtime e va qui.
   - Lo script nuovo è `scripts/build_base.sh [--arm64|--amd64|--tutte] [--push]`. Alla fine stampa il digest.
2. **Il runtime parte dalla base fissata al digest.** Il file `deploy/container/BASE` contiene, per ogni
   architettura, il riferimento completo (`ghcr.io/soligolab/sws-base:2026.11.1-arm64@sha256:…`). Gli script di build
   lo passano come `--build-arg BASE=…`. Il Containerfile del runtime diventa `ARG BASE` + `FROM $BASE` + i `COPY`.
   Senza un digest nel file la build si ferma: una base che cambia da sola è il difetto di oggi.
3. **Cambiare la base è un commit dedicato**, `chore(base): sws-base 2026.11.2 — <motivo>`. Questi commit contengono
   soltanto `BASE` e, se serve, `Containerfile.base.*`. `git log --grep 'chore(base)'` dà la storia del sistema
   operativo dei pannelli.
4. **L'etichetta della base nell'immagine del runtime**: `net.soligo.sws.base="2026.11.1"`. La legge
   `riepilogo_immagini.sh`, e un domani il pannello (Device → Stato) e la console.
5. **La guardia `check_base.sh`** (statica): i Containerfile del runtime non hanno `apt-get`; `BASE` ha un digest per
   ogni architettura; il `FROM` dei Containerfile della base è fissato a un digest.
6. **Il primo passaggio non costa niente ai pannelli.** La prima `sws-base` è lo strato che c'è già nella cache
   dell'EliteBook (`b4c863b874c0`, 491 MB, la stessa base della dev.3 e della dev.4): si tagga e si pubblica com'è,
   senza rifare `apt`. Il digest dei suoi strati resta quello che i pannelli hanno già, e il primo aggiornamento sulla
   base nuova scarica di nuovo solo i circa 100 MB dei binari. Si verifica prima con `podman image inspect` che i
   digest degli strati coincidano con quelli di `2.28.0-dev.4-arm64` su ghcr.io.
7. **Il documento.** `docs/HOWTO.md`: un capitolo nuovo, «Aggiornare il sistema operativo dei pannelli», con la
   procedura dei punti 1-3. `docs/CONTEXT.md` non cambia.

## Verifica

- `./scripts/build_base.sh --tutte` costruisce le due basi. Una seconda build del runtime senza cambi alla base dà gli
  stessi digest degli strati del sistema, **anche da un'altra macchina**: la prova si fa con una cache di podman
  vuota (`podman system prune -a` su una macchina di prova, non su quella di lavoro).
- `check_base.sh` è rosso con un `apt-get` in un Containerfile del runtime, e con `BASE` senza digest.
- Sul WP630: l'aggiornamento dalla dev con la base nuova (punto 6) scarica solo gli strati dei binari. Il log di
  `podman pull` dice «already exists» per gli strati del sistema.
- Il gateway del VPS (amd64) parte con la base amd64 nuova: `/health` ok, i container dei progetti `healthy`.
- `cargo check`, `pnpm build`, `./scripts/check_static.sh` verdi (il codice Rust e l'IDE non cambiano).

## Da decidere

| | Domanda | Proposta |
|---|---|---|
| 1 | Il nome della versione della base | **`AAAA.MM.N`** (`2026.11.1`): dice quando sono stati presi i pacchetti, che è il dato utile per la sicurezza. In alternativa, la versione di SWS in cui è entrata. |
| 2 | Una base per architettura con il viewer, o anche una senza viewer (`--no-lvgl`) | **Una sola, con il viewer.** Le build senza viewer sono rare e possono usare la stessa base: le librerie in più non fanno danni. |
| 3 | La cadenza degli aggiornamenti di sicurezza | **A mano, quando lo decide il maintainer.** In più, `check_base.sh` dà un avviso (non un errore) se la base ha più di 90 giorni. |
| 4 | La sysroot dei builder | **Fuori da questo piano.** Il builder arm64 può prendere la sysroot dalla `sws-base` arm64 più i pacchetti `-dev`, così le librerie di compilazione e quelle del pannello sono le stesse. È un passo in più, da fare dopo, se serve. |
| 5 | Le vecchie basi su ghcr.io | **Non si cancellano.** Un'immagine del runtime di sei mesi fa deve ancora potersi scaricare, e la sua base con lei. |
| 6 | Le Novità | Un cambio di base porta una voce in `NOVITA.yaml` solo se cambia qualcosa che l'utente vede (una libreria nuova, un fix di sicurezza importante). Gli altri cambi stanno solo nel `CHANGELOG.md`. |
