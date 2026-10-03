# Le immagini vecchie che restano sul pannello dopo un aggiornamento

> **Piano d'esecuzione dal 03-10-2026** (sezione in fondo: l'aggiornamento con ritorno). Era un seme (03-10-2026). Richiesta del maintainer durante il collaudo del
> [quadlet che viaggia](../archive/2026-10-02-quadlet-che-viaggia.md): «l'aggiornamento automatico del
> container del dispositivo può fare pulizia dei download precedenti una volta confermato
> l'aggiornamento?»
>
> **Quando questo lavoro comincia, il primo passo è una sessione di plan approfondita, dedicata, per
> sviscerarne tutti i dettagli.** Quello che segue è l'idea e le misure di oggi, non un progetto.

## L'idea

Dopo un aggiornamento **confermato**, il pannello toglie da sé le immagini che non gli servono più,
invece di accumularle finché lo spazio finisce.

## Misurato il 03-10-2026

- **TC620**: 9 immagini `sws-runtime` (`dev.1`…`dev.5`, `rc.14`, `rc.16` da archivio, `ghcr` `rc-arm64` e
  `latest-arm64`), una sola in uso. `podman system df`: 1,34 GB, **863 MB recuperabili (64 %)**, su una
  partizione dati da 10 GB con 3,1 GB liberi.
- **Gli archivi** non restano: l'aggiornamento dall'IDE non lascia `.tar.gz` sul pannello (quello trovato
  era stato copiato a mano per il collaudo).
- **Nessun percorso d'aggiornamento cancella immagini**: né `podman auto-update` (canale registro), né il
  deploy da archivio dell'IDE.
- **Esiste già la pulizia a mano**: IDE → Container → `prune_images` (`packaging.rs`, `podman image prune
  -a -f`, via SSH), nata da un pannello rimasto senza spazio con 18 immagini. `sonda.rs` e
  `install-container.sh` la suggeriscono quando lo spazio è poco.
- **Il «confermato» c'è già**: `aggiornamento_esito.rs` scrive «riuscito» solo dopo `CONFERMA_S` secondi
  di vita della versione nuova; prima, podman può ancora tornare all'immagine precedente (che quindi va
  tenuta fino a lì).
- **Il mezzo c'è già**: il runtime avvia servizi transitori sul bus utente (`display_target::bus::
  avvia_transitorio`, collaudato il 03-10 per riscrivere i quadlet) — un `podman image prune` girerebbe
  sull'host senza SSH e senza montare niente.

## Opzioni già visibili (da decidere)

1. **Cosa si tiene**: solo l'immagine in uso (`prune -a`, massimo spazio, nessun ritorno a mano) oppure
   anche la precedente (≈ 470 MB, una via di ritorno), oppure le ultime N.
2. **Canali**: un pannello sul canale archivio ha ancora immagini `ghcr` e viceversa — si toccano o no?
3. **Chi la fa partire**: l'esito «riuscito» dell'aggiornamento dal registro; il deploy da archivio
   dell'IDE (che ha un suo percorso); entrambi.
4. **Visibilità**: una riga nell'esito («liberati 860 MB»), una voce di audit, un'opzione per spegnerla.

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

### 2. L'aggiornamento con ritorno: istantanea, conferma, pulizia

**Istantanea prima di aggiornare** (runtime, modulo nuovo `sws-web/src/istantanea.rs`):
- `prendi(config_dir, projects_root, store_attivo)` scrive `<config>/istantanea/` = `config/` (senza `istantanea/`,
  `quadlet-nuovo/`, `pulizia/`) + `projects/` (senza `backups/`, log e `historian-prima-della-pulizia-*`); lo
  storico del progetto aperto con `SqliteStore::vacuum_into` (coerente), gli altri copiati (nessuno li scrive).
  `istantanea.json` con versione, ora, byte. Se lo spazio libero è meno di 1,5 × la stima, **l'aggiornamento non
  parte** e lo dice (l'utente può confermare/pulire il giro precedente per liberare spazio).
- Chiamata **dentro** `aggiornamento::avvia` (`aggiornamento.rs:538`, unico punto da cui partono «Aggiorna ora»,
  finestra e pilota automatico) prima di `StartUnit podman-auto-update.service`.
- Canale archivio: `POST /api/aggiornamento/istantanea` (+ `/api/remote/...`); l'IDE la chiama prima del deploy
  container (`packaging.rs`, passo nuovo prima dello scp). Un runtime vecchio risponde 404 → si prosegue e il
  log del deploy dice «nessuna istantanea: il ritorno riporterà solo l'immagine».

**Script dell'host** `deploy/container/immagini.sh <comando> <cartella-config-host> [...]` (bash, podman rootless),
dentro l'immagine in `/usr/share/sws/quadlet/` accanto ai quadlet; il runtime lo copia in `<config>/pulizia/` e lo
lancia con `display_target::bus::avvia_transitorio` (come i quadlet). Ricava `projects/` dai `Volume=` del quadlet,
come `--solo-unita`.
- `stato`: `attuale` = `podman inspect sws-runtime --format {{.Image}}`; legge `<config>/immagini.stato`; se
  l'attuale registrata è diversa, quella diventa `precedente` (**così si accorge di un aggiornamento su
  qualunque canale**); scrive `<config>/immagini.json` (attuale, precedente coi suoi nomi, immagini SWS e byte
  recuperabili — filtro `label=org.opencontainers.image.source=https://github.com/soligolab/sws`, anche `<none>`).
- `pulisci`: toglie le immagini SWS diverse da attuale e precedente e non usate da nessun container (`podman rmi
  -f <id>` dopo il controllo `ps -a --filter ancestor=`), toglie `<config>/istantanea/`; esito nel JSON.
- `ritorna <versione-scartata>`: ferma viewer e runtime; ripristina `config/` e i progetti dall'istantanea (i
  `backups/` dei progetti restano); riporta l'immagine: se la precedente ha un nome `localhost/…` → `Image=` e
  `SWS_IMAGE` del quadlet su quel nome, altrimenti `podman tag <precedente> <Image= attuale>` (canale registro);
  scrive `<config>/ritorno.json`; `daemon-reload`, avvia il runtime. Se l'istantanea manca, riporta solo l'immagine.

**Runtime, modulo nuovo `sws-web/src/conferma_aggiornamento.rs`** (avviato in `main.rs` accanto a
`quadlet::all_avvio`, solo con `SWS_HOST_CONFIG_DIR` e bus utente):
- all'avvio, dopo `aggiornamento_esito::CONFERMA_S` (120 s), lancia `immagini.sh stato`; se c'è una precedente
  non ancora confermata → **domanda aperta** (`da`, `a`, istantanea sì/no, MB recuperabili);
- stato in `<config>/conferma-aggiornamento.yaml`: `rimandata_al_riavvio` → al prossimo avvio riuscito parte
  `pulisci` da sola; `più tardi` → la domanda torna al prossimo avvio;
- se trova `ritorno.json` (scritto dallo script): registra la **versione scartata** in `aggiornamento.yaml`, e
  finestra/pilota automatico (`aggiornamento_finestra.rs`) non aggiornano verso di lei; «Aggiorna ora» resta
  libero. L'esito «tornato a X» si mostra come gli altri esiti. **Limite dichiarato**: lo legge solo una versione
  che ha questo codice — tornando a una versione più vecchia della rc.17 la sospensione non c'è.
- un'istantanea senza aggiornamento avvenuto (podman è tornato indietro da solo) si toglie all'avvio successivo.
- API: `/api/system` → `conferma_aggiornamento: Option<…>`; `POST /api/aggiornamento/conferma {scelta}` con
  `pulisci | dopo_riavvio | piu_tardi | ritorna` (ruolo di amministrazione come `/api/update/apply`, audit),
  anche `/api/remote/aggiornamento/conferma`.
- Funzioni pure testate: decisione dello stato (prima volta, stessa immagine, cambiata, rimandata, ritorno),
  filtro della versione scartata, comando della transitoria, stima dello spazio.

**Dove si sceglie**: nell'IDE (Istanza → Device, sotto `AggiornamentoRuntime`: riga con le quattro scelte;
«Torna alla precedente» con conferma che dice cosa si perde — i dati scritti dopo l'aggiornamento) e sul pannello
(overlay web `AvvisoAggiornamento.tsx`, LVGL `lvgl_avviso.rs`, stessi pannelli e stessa precedenza dell'avviso del
quadlet; testi di sistema it/en nella fixture comune).

**Test shell** `tests/shell/immagini.sh` (podman/systemctl finti come `solo-unita.sh`): `stato` prima volta e dopo
un cambio; `pulisci` tiene attuale + precedente + in uso; `ritorna` ripristina i file da un'istantanea finta, cambia
`Image=` per `localhost/` e ritagga per il registro, non tocca `backups/`. Lanciato da `check_quadlet.sh`.

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
