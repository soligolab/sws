# Build e rilascio più veloci in sviluppo, e due portali (stabile e di sviluppo) — seme

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

## L'idea

Due cose che vanno pensate insieme, perché la seconda cambia il peso della prima:

1. **Ogni immagine costa troppo**: 36-75 minuti per una release, e ogni prova sul VPS o su un pannello passa oggi
   da un'immagine completa. Nel periodo 20-10 → 05-11 le build sono state una ventina, più le immagini di prova
   col tag del commit (sette sul VPS il 31-10, quattro il 02-11).
2. **Due portali**: `sws.soligo.net` diventa il portale **stabile**, per i clienti, e segue solo le release. Un
   secondo portale, **di sviluppo**, ha sempre l'ultimo codice: è lì che il maintainer lavora e prova ogni giorno.
   Oggi i due ruoli stanno nello stesso gateway, quindi una prova rotta ferma l'IDE di tutti i giorni, e ogni
   rilascio interrompe il lavoro per qualche secondo.

## Le misure del 05-11-2026

### Dove va il tempo

| Build | Builder aarch64 | cargo runtime arm64 | cargo viewer LVGL | cargo runtime amd64 | Totale |
|---|---|---|---|---|---|
| 2.22.0 e 2.23.6 (cache calde, builder in cache) | ~1 min | 14 min | 4,5 min | 13 min | **~36 min** |
| 2.25.0 (worktree nuovo, cache vuote) | 20m44s | 21m14s | 8m27s | 20m37s | **~75 min** |
| 2.25.1 (cache spostate nel worktree con `mv`) | 18m56s | 16m08s | 5m00s | 16m11s | **~60 min** |

I passi «container» veri costano poco: immagine finale 27-37 s, push 15-22 s, `podman save` più gzip ~45 s (arm64)
e ~29 s (amd64), SPA 10-16 s (fatta **due volte**, una per gamba). Log in `tmp/build-2.25.0.log` e
`tmp/build-2.25.1.log` (su theobroma, non versionati).

### Perché

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

### Due difetti trovati per strada (veri anche senza questo piano)

- **`build_containers_all.sh --no-rust`, documentato in `docs/HOWTO.md` §5, pubblica l'immagine arm64 con la SPA
  vecchia**: in `scripts/build_container.sh` la `pnpm build` sta dentro il blocco Rust (righe 156 e 172-178), mentre
  `build_container_x86_64.sh` la fa sempre (169-171). E `--no-rust` dopo un cambio di versione mette nell'immagine
  un binario che dichiara la versione vecchia.
- **Il ramo `*)` degli script sposta `latest-*` e `rc-*` senza nessun controllo** (`build_container.sh:353`,
  `build_container_x86_64.sh:270`): una build di ramo che porta ancora il numero dell'ultima release la sostituisce
  e sposta il canale stabile. È il caso delle quattro immagini del 02-11 a 2.24.0.

## Le strade per la build, da pesare nella sessione di plan

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

## I due portali

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
| La radice dei progetti | 18-20 cartelle del maintainer (CasaDomotica col suo storico SQLite e il suo `.git`), montate in lettura e scrittura nei container; nessun lock fra processi (seme [due editor sullo stesso progetto](2026-10-21-due-editor-sullo-stesso-progetto.md)) | `gateway/progetti.rs:567-572`, `:773-783` |
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

## Domande per la sessione di plan

- I due portali prima, o la build prima? Con un portale di sviluppo che segue `main` da solo, le strade 3 e 4
  servono meno sul VPS e restano utili per i pannelli.
- Il portale di sviluppo: stesso VPS (A o B) o un secondo VPS (C)? Con quali progetti e quali pannelli?
- Quando `sws.soligo.net` smette di seguire ogni immagine: cambia la memoria «il VPS sempre aggiornato».
- Le immagini del portale di sviluppo: le costruisce theobroma o una CI? Con che nome (`dev-<sha>`, `main-amd64`)?
- L'eccezione per i builder nella regola delle immagini vecchie, e rustc fissato: sì o no?
- La prassi del HOWTO §19 (versioni `-rc` per ogni prova) resta, o lascia il posto alle `dev-<sha>`?
- Dove sta il worktree di build fisso, e chi lo pulisce.
