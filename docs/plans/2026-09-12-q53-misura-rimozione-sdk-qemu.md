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
