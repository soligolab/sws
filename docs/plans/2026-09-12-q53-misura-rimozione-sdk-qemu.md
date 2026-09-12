# Q53 — Misurare sul campo prima di togliere i percorsi SDK Pixsys e QEMU generico

> Trasferito da `docs/OPEN_QUESTIONS.md` (Q53) il 2026-09-12, aperta e decisa il 2026-09-10
> (opzione 2, cross-build da x86_64 senza SDK né QEMU). Questo piano copre solo la **fase due**
> dichiarata nella scheda: la misura sul campo prima di rimuovere i percorsi storici.

## Contesto

Il cross-build (Q53, `build_container.sh` di default) è già la via preferita e pubblicata da
tempo. Restano da rimuovere, **solo dopo aver misurato che regge**: `scripts/yocto/build.sh`
dal percorso container, il flag `--sdk`, `build_container_aarch64_generic.sh`, i due builder
QEMU e gli alias `-arm64-generic`.

**Cosa manca**: un confronto misurato fra l'immagine cross-build e la `2.7.1-arm64` (SDK) di
prima, su CPU del viewer LVGL e tempo di avvio, sul TC620 o WP630 reale.

## Un'occasione buona per farlo ora

Il TC620 (`tc620-a-p3-c6-07aff9.local`, indirizzo di questa sessione — riverificarlo, cambia a
ogni sessione) ha già ricevuto **2.7.3**, cross-build, il 2026-09-12 (vedi
`docs/plans/2026-09-12-F5.3x-xy-plot-e-verifica-lvgl.md` per il contesto di quel deploy). La
misura di CPU/avvio con l'immagine cross è quindi già alla portata — manca solo il **confronto**
con una build SDK per lo stesso commit, che richiederebbe l'SDK Pixsys (assente su questa
macchina, verificato il 2026-09-12) o un numero storico già misurato in una sessione precedente.

## Cosa misurare

- `cpu_usage_pct` da `/api/system` a riposo e durante il rendering di una pagina con più widget
  animati (già disponibile nel campo restituito dall'endpoint — visto durante questa sessione).
- Tempo fra l'avvio del container e il primo `/health` che risponde (log di `install-container.sh`
  lo stampa già).
- Se possibile, un confronto con un numero storico dell'immagine SDK sullo stesso modello di
  dispositivo (cercare in `STATUS.md`/`CHANGELOG.md` un dato precedente, invece di dover
  reinstallare l'SDK solo per il confronto).

## Prossimo passo

Chiedere al maintainer se vuole procedere alla misura ora che il TC620 è aggiornato, o se
preferisce aspettare di avere anche un numero SDK fresco per un confronto più pulito. Se i
numeri cross-build sono già chiaramente buoni (bassa CPU, avvio rapido) senza bisogno di un
confronto diretto, potrebbe bastare quello per decidere di procedere alla rimozione.

## File coinvolti (solo dopo la decisione di rimuovere)

`scripts/yocto/build.sh` (via container), `scripts/build_container_aarch64_generic.sh`,
`scripts/build_container.sh` (flag `--sdk`/`--with-generic`), i Containerfile QEMU,
`docs/DEPLOY_CONTAINER_AARCH64.md` (aggiornare la documentazione di conseguenza).

---

## Testo originale della scheda (spostato da `docs/OPEN_QUESTIONS.md` il 2026-09-12)

## Q53 — Due immagini aarch64 (SDK Pixsys e generica): tenerle entrambe, o convergere su una?

*Aperta il 2026-09-10 su domanda del maintainer («ha senso tenere il container Pixsys? ho provato
spesso quello generico e non ho riscontrato problemi»). Decisa lo stesso giorno.*

**Context.** Si pubblicano tre immagini: `-amd64`, `-arm64` (binario cross-compilato con l'SDK
Yocto Pixsys, `build_container.sh`) e `-arm64-generic` (compilato **dentro** un container arm64
emulato con QEMU, `build_container_aarch64_generic.sh`). Tre tag per release, due script, due
righe nell'installer, un selettore nell'editor (Q52 propone la variante da `os-release`), e un
incidente già avuto (2026-07-31: un rebuild della sola generica installava la SDK vecchia,
perché `install-container.sh --pull` senza argomento sceglie `latest-arm64`).

**I fatti, misurati nel repo, che la domanda merita.**

1. **La «libc del dispositivo» non c'entra.** Entrambe le immagini partono da `ubuntu:24.04`
   (`Containerfile.aarch64` L27, `Containerfile.aarch64-generic` L24): il binario gira contro la
   glibc 2.39 e la libpython 3.12 **dell'immagine**, non del pannello. Il binario SDK richiede
   `GLIBC_2.39` (`DEPLOY_CONTAINER_AARCH64.md` §«Perché ubuntu:24.04») — è per questo che la base
   è quella. In un container, del sistema ospite conta solo il kernel. L'«ABI pinning a Pixsys OS»
   e «linka la libc del dispositivo» (riepilogo delle immagini) descrivono il binario nativo, non
   il container: sono frasi rimaste da prima.
2. **La differenza vera è l'ottimizzazione.** La generica è compilata con
   `CARGO_PROFILE_RELEASE_OPT_LEVEL=0` — nel registro del maintainer: «Finished `release` profile
   **[unoptimized]**» — perché `aws-lc-sys` (dietro `rustls`, via reqwest/lettre/tokio-rustls)
   manda in SIGSEGV l'assemblatore sotto QEMU, e il ripiego `AWS_LC_SYS_NO_ASM` è accettato dal
   builder CMake solo a opt-level 0 (`DEPLOY_CONTAINER_AARCH64.md` §«Percorso generico»). Vale
   anche per `sws-lvgl-viewer`. Un binario Rust non ottimizzato è più lento di molte volte nei
   percorsi caldi: rendering LVGL, TagDb, storico. «Non ho riscontrato problemi» è vero su un
   PoC con poche variabili; il pannello che disegna a 43 % di CPU (2026-09-09) lo si nota dopo.
3. **Il tuning cortex-a35** dell'SDK vale per il PX30; su RK3399 (A72/A53) e RK3588 (A76/A55) il
   codice generico aarch64 va altrettanto bene. Non è un motivo per tenere l'SDK.
4. **Costi di build.** SDK: secondi (cross nativa) ma richiede l'SDK installato (c'è su theobroma,
   non sul server d'ufficio). Generica: 51 minuti di QEMU per il runtime più il viewer, e serve
   `sudo`.
5. `aws-lc-rs` **non serve**: il workspace usa il provider `ring` (`rustls = { features = ["ring"] }`)
   ma le feature di default di `rustls` lo tirano lo stesso. Toglierlo (`default-features = false`
   su rustls e sui crate che lo riesportano) leverebbe la causa dell'opt-level 0. Da verificare
   che nessun crate lo richieda per nome.

**Options.**
1. **Tenere entrambe**, com'è. Costo: tre tag, due script, il selettore, la confusione.
2. **Una sola immagine aarch64, costruita senza SDK e senza QEMU**: cross-compilazione da x86_64
   in un container `ubuntu:24.04` con `crossbuild-essential-arm64` e i pacchetti `:arm64`
   (libpython3.12-dev, libsdl2-dev, libdrm-dev, libfreetype-dev) come sysroot — è quello che l'SDK
   fornisce, ma da Ubuntu, riproducibile su qualunque PC. `cargo build --target
   aarch64-unknown-linux-gnu`, optimizzato, in minuti; il `build.rs` del viewer legge già un
   sysroot per bindgen (`OECORE_TARGET_SYSROOT`, da generalizzare). Poi `latest-arm64` è l'unico
   tag, `-generic` sparisce, e l'installer, Q52 e il riepilogo si semplificano. Prima di buttare la
   SDK: misurare sul pannello CPU del viewer e tempo di avvio con la nuova immagine.
3. **Una sola immagine, ma la generica di oggi** (QEMU, opt-level 0) dopo aver tolto `aws-lc-rs`
   così da poter compilare ottimizzato — ma a opt-level 3 sotto QEMU la build passa da 51 minuti
   a ore. Non regge.
4. **Solo la SDK.** Lega ogni build a una macchina con l'SDK Pixsys e contraddice «SWS è agnostico».

**Default for PoC.** (1). Raccomandazione: **(2)**, in due passi: prima il cross-build Ubuntu
ottimizzato come *terzo* percorso, misurato su TC620/WP630 accanto alle due esistenti; poi, se
regge, rimuovere sia l'SDK sia il QEMU. Nel frattempo correggere le frasi su «libc del
dispositivo», che oggi dicono il falso, e lasciare `latest-arm64` (SDK) come default
dell'installer perché è l'unica ottimizzata.

**Decided (2026-09-10, maintainer):** (2) — «vale la pena percorrere la strada del crossbuild
così da ridurre il numero di immagini da compilare a ogni iterazione e aspettarmi comportamenti
omogenei nelle architetture arm64 a prescindere dal dispositivo». Realizzato sul ramo
`feat/Q53-crossbuild-arm64`:

- `deploy/container/Containerfile.aarch64-cross.builder`: immagine x86_64 con
  `crossbuild-essential-arm64` e i pacchetti `:arm64` di Ubuntu 24.04 in multiarch (libc,
  libpython3.12, SDL2, libdrm, FreeType), rustup con il target aarch64, e l'ambiente cross
  per-target (linker, `CC_*`, pkg-config, bindgen). pyo3 con `PYO3_CONFIG_FILE` scritto a mano
  (il `_sysconfigdata` del target su Ubuntu collide con quello dell'host); FreeType anche per
  l'host (il build script di `lvgl` linka lvgl-sys per x86_64).
- `build_container.sh` costruisce così per default: `[optimized]`, runtime in 8 minuti la prima
  volta e incrementale dopo, binario aarch64 con `GLIBC_2.39` e `libpython3.12.so.1.0`
  (controllati da `readelf` prima di incartarlo). `--sdk` è il percorso storico con l'SDK Pixsys.
  Con `--push` pubblica anche gli alias `-arm64-generic`, così i dispositivi installati con quel
  riferimento continuano ad aggiornarsi.
- `build_containers_all.sh`: due immagini per default (aarch64, x86_64); `--with-generic` aggiunge
  la vecchia via QEMU per confronto; `--require-sdk` è diventato `--sdk`.
- Q52: la sonda propone `latest-arm64` per qualunque aarch64 (l'euristica su `os-release` non
  serve più) e l'editor non ha più i due pulsanti SDK/generica. Il riepilogo delle immagini e i
  documenti non dicono più «linka la libc del dispositivo».

**Da misurare sul campo prima di togliere SDK e QEMU** (fase due): CPU del viewer LVGL e tempo di
avvio con l'immagine cross sul TC620/WP630, a confronto con la `2.7.1-arm64` (SDK) di ieri.
Quando regge, spariscono `scripts/yocto/build.sh` dal percorso container, `--sdk`,
`build_container_aarch64_generic.sh`, i due builder QEMU e gli alias `-generic`.
