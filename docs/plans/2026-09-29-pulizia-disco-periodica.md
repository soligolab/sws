# Il disco che cresce senza misura — una pulizia periodica, non un'accetta

> **Piano d'esecuzione dal 03-10-2026** (sezione in fondo). Era un seme: Quando questo lavoro comincerà, il primo passo è una
> **sessione di plan approfondita e dedicata** che rimisuri tutto e ne sviscerti ogni dettaglio:
> le misure qui sotto sono di oggi e invecchiano in fretta, e una regola di cancellazione scritta
> mesi prima di essere applicata è una regola che mente.

## L'idea del maintainer (29-09-2026)

> «Cargo non fa pulizia da solo né della cache incrementale né dei deps obsoleti. Stavo pensando
> di inserire nella skill di fine giornata una chiamata ad uno script di pulizia perché il
> progetto sul disco cresce senza misura.»

Due cose distinte, da non confondere: **quanto pesa** (un problema di disco) e **quando si pulisce**
(un problema di rituale). L'idea le lega: farlo a fine giornata, quando la macchina è ferma e una
ricompilazione non fa male a nessuno.

## Misurato oggi sul dev server d'ufficio, 29-09-2026

| | |
|---|---|
| il checkout intero | **100 GB** |
| `sws-runtime/target` | **79 GB** |
| ├─ `target/debug` | **71 GB** |
| │  ├─ `debug/incremental` | **42 GB** ← più della metà di tutto `target` |
| │  ├─ `debug/deps` | 29 GB (5 396 file) |
| │  └─ `debug/build` + `.fingerprint` | 1,2 GB + 48 MB |
| ├─ `target/aarch64-unknown-linux-gnu` | 4,1 GB (la cross-build Yocto) |
| └─ `target/release` | 3,8 GB |
| `crates/sws-kiosk/target` | 124 MB (fuori dal workspace, `cargo clean` non lo vede) |
| `~/.cargo/registry` | 2,0 GB (globale, non di questo repo) |
| `.git` | 878 MB |
| `sws-editor/node_modules` | 181 MB |

**Il numero che conta è 42 GB di `incremental`**: è esattamente la cache che il maintainer nomina,
è pura cache, e cancellarla **non** impone una ricompilazione da zero — le dipendenze compilate
stanno in `deps`, che resta. Si paga una ricompilazione dei soli crate del workspace.

**`deps` per età non si pota**: zero file più vecchi di 30 giorni su 5 396. Cargo ritocca gli
`mtime` degli artefatti che riusa, quindi il criterio «vecchio = cancellabile» che verrebbe
naturale **non funziona** su questa cartella. È il motivo per cui esistono strumenti dedicati
(`cargo-sweep` usa i timestamp delle *toolchain*, `cargo-cache` lavora sul registry): nessuno dei
due è installato qui.

## Cosa c'è già, e perché non basta

`scripts/clean_disk_space.sh` esiste dal 19-08-2026 (`26cf68e2`), nato da un crash vero del linker
a disco pieno. **È un'accetta, di proposito**: cancella `target/debug` per intero, `node_modules`,
le immagini podman dangling. Fa il suo mestiere in emergenza, ma **non può stare in
`/finalizza-giornata`** — imporrebbe a ogni mattina una ricompilazione completa del workspace,
dipendenze incluse, per recuperare spazio che in buona parte tornerebbe subito.

Quello che manca è la via di mezzo: una pulizia **economica e ripetibile**, non distruttiva.

## Le opzioni già visibili (da valutare, non decise)

1. **Solo `incremental`.** Una riga, 42 GB, nessuna dipendenza ricompilata. Il candidato ovvio.
   Da misurare quanto costa davvero la prima build dopo.
2. **`cargo sweep --installed` / `--time N`.** Toglie da `deps` gli artefatti di toolchain non più
   installate o non toccati da N giorni — è lo strumento giusto per la parte che l'`mtime` da solo
   non sa potare. Aggiunge una dipendenza di sviluppo da installare su ogni macchina.
3. **`CARGO_INCREMENTAL=0` per le build non interattive** (CI, cross-build, script di release):
   non pulisce, previene. Da capire se rallenta il ciclo di sviluppo del maintainer o no.
4. **Una soglia invece di un calendario**: pulire solo se `target` supera N GB, o se il disco
   scende sotto una percentuale libera. Una pulizia che scatta ogni sera anche quando non serve è
   una pulizia che il maintainer comincerà a saltare.

## Dove va la chiamata

`/finalizza-giornata` è il posto proposto. Da decidere nella sessione dedicata: **prima o dopo il
push** (dopo, quasi certamente: una pulizia non deve poter far fallire la chiusura), se
**interattiva o no**, e cosa succede quando un'altra sessione sta compilando sullo stesso
checkout — c'è già il precedente delle [sessioni concorrenti](2026-09-22-riorganizzare-i-file-dell-editor.md)
e la regola di non toccare uno script in esecuzione. Cancellare `target` sotto una build altrui è
lo stesso genere di guasto.

## Rischi

- **La cross-build Yocto (4,1 GB) non è rigenerabile in pochi minuti**: ricompilarla costa
  decine di minuti e un container. Qualunque regola automatica la deve escludere esplicitamente.
- **`~/.cargo/registry` è globale**: pulirlo tocca ogni progetto Rust della macchina, non solo
  questo. `clean_disk_space.sh` lo tiene già dietro un flag apposta.
- **Una pulizia dentro un rituale è una pulizia che nessuno guarda più**: se sbaglia, sbaglia in
  silenzio ogni sera. Vale la regola delle guardie — va provata rossa prima di fidarsene.

---

# Piano del 03-10-2026 — approvato

> Sessione di plan del 03-10-2026, un piano solo per tre semi (pulizia del disco, immagini sul pannello,
> storico). Le misure di oggi sono nel piano generale; qui la parte di questo seme.

**Scelte del maintainer (03-10-2026):** disco → **solo `incremental`**; immagini → si tengono **quella in uso e
la precedente**; storico → **backup e formato insieme**. Poi, rivedendo il piano: **la pulizia non parte da
sola**. Dopo un aggiornamento riuscito si propongono **quattro scelte** — «Conferma e pulisci», «Conferma dopo il
prossimo riavvio», «Più tardi», «Torna alla versione precedente» — e il ritorno riporta **anche i dati**:
un'**istantanea di config + progetti con lo storico** presa prima di ogni aggiornamento, **su entrambi i canali**.
Dopo un ritorno, niente aggiornamenti automatici **verso la versione scartata** (si riprende con una più nuova o
con «Aggiorna ora»). Il ritorno coi dati è indispensabile proprio per il §3: la migrazione dello storico è a senso
unico, e la versione vecchia non leggerebbe il formato nuovo.

**Ordine dei rami (un ramo alla volta):**
1. `feat/pota-incremental` → collaudo qui, squash, eliminato.
2. `feat/aggiornamento-con-ritorno` da `main` → **rc.17**; poi **annidato** `feat/storico-compatto` → **rc.18**.
   Le due rc servono entrambe al collaudo vero: rc.16 → rc.17 (la rc.16 non sa fare l'istantanea: si vede la
   proposta, senza ritorno dei dati), poi rc.17 → rc.18 (istantanea presa dalla rc.17, storico migrato dalla rc.18,
   «Torna alla precedente» → rc.17 con lo storico vecchio leggibile). Due squash dopo la conferma.

### 1. La cache incrementale di cargo

- `scripts/pota_incremental.sh [--giorni N] [--esegui]` (default 2 giorni, senza `--esegui` dice solo cosa
  toglierebbe): cartelle in `*/incremental/` con mtime più vecchia di N giorni, nei tre target
  (`sws-runtime/target`, `crates/sws-kiosk/target`, `crates/sws-lvgl-viewer/target`), profili `debug` e `release`.
  **Esclusi** `target/aarch64-*` e tutto `deps`. Stampa spazio prima/dopo e quanto ha liberato.
- Se gira un `cargo`/`rustc` con cwd in questo checkout (`/proc/*/cwd`), non tocca niente e lo dice.
- `tests/shell/pota-incremental.sh`: albero finto (cartelle vecchie/nuove con `touch -d`, un `aarch64` vecchio, una
  `deps` vecchia) → restano le nuove, l'`aarch64` e `deps`. Lanciato da una guardia nuova
  `scripts/check_pota_incremental.sh` (in `check_static.sh`), provata rossa.
- `.claude/skills/finalizza-giornata/SKILL.md`: passo nuovo **dopo il push** — `./scripts/pota_incremental.sh
  --esegui`; un errore non fa fallire la chiusura. `clean_disk_space.sh` resta l'accetta per le emergenze (una riga
  che rimanda allo script nuovo).

### Documenti

Per ciascun ramo: CHANGELOG, `NOVITA.yaml` (ritorno e storico: sì, con riga di compatibilità «il ritorno coi dati
vale dagli aggiornamenti fatti da una versione ≥ rc.17»; incremental: no, è sviluppo), manuale (capitolo packaging:
conferma, pulizia, ritorno; capitolo storico/backup), HOWTO (capitolo nuovo «tornare alla versione precedente»),
`STATUS.md`, piano in archivio.

### Verifica

- **Ramo 1**: test shell provato rosso; `./scripts/pota_incremental.sh` a vuoto e poi `--esegui` qui (attesi ~80 GB
  liberati), poi `cargo check` per misurare il costo della prima build dopo. Conferma del maintainer, squash.
- **Ramo 2 (rc.17)**: `cargo test`, vitest, `pnpm build`, `check_static.sh`. Sul TC620 rc.16 → rc.17 da archivio
  (l'IDE chiede l'istantanea alla rc.16 → 404, si prosegue): dopo 120 s compare la domanda; si prova «Più tardi»
  (torna dopo un riavvio) e «Dopo il prossimo riavvio» (riavvio → immagini 9 → 2, nessuna domanda).
- **Ramo 3 (rc.18)**: test di `sws-historian` (conversione, migrazione, letture uguali prima/dopo), migrazione su
  una **copia** di `CasaDomotica/history/historian.db` (dimensione, conteggi per tag, trend dal vivo con
  `start_editor_develop.sh`). Sul TC620 rc.17 → rc.18: istantanea presa dalla rc.17, storico da 91 MB migrato,
  trend uguali; poi **«Torna alla precedente»** → rc.17 con lo storico vecchio leggibile e gli aggiornamenti
  automatici fermi sulla rc.18; infine «Aggiorna ora» di nuovo e «Conferma e pulisci». SSH in lettura per
  controllare (`podman images`, JSON dello stato, dimensione del db, `journalctl --user -u 'sws-immagini-*'`).
  Conferma del maintainer, due squash, push solo su istruzione.
