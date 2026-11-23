# SWS sul PLX800 e la sorgente del modulo I/O (`plx800_io`)

> **Piano del 23-11-2026**, sessione di plan col maintainer su `elitedesk`. È la prima metà del lavoro LogicLab
> ([il piano gemello](2026-11-23-logiclab-memoria-diretta.md)): il PLX800 è l'unico dispositivo con LogicLab acceso
> che abbiamo, e SWS non ci è mai stato provato. Parole del maintainer: «per il PLX800, sws non è stato ancora testato su
> quella piattaforma ma servirebbe oltretutto integrare un driver simile a quello host per accedere alle risorse
> specifiche del PLX800, fai riferimento al progetto /home/ut1/Git/openplc».
>
> Decisioni: **lettura sempre, scrittura a scelta** (`writes: true`); **prima il PLX800, poi LogicLab**. Ramo
> `feat/plx800-io`, 2–3 sessioni.

## Cosa c'è sul PLX800 (misurato il 23-11-2026, in sola lettura)

- `plx800-a-p3-l2-a2-0891bc` (RK3399 aarch64, PixsysOS 2.1.3, kernel 6.12 PREEMPT_RT, glibc 2.39, 2 GB, 6 core),
  podman 5.0.2, `user` uid 1000 (gruppi `dialout`, `plugdev`, `wayland`, `seat`), `pixsys` sudoer.
- Il modulo I/O è **`/dev/shm/qmb800_registers`**: 176 byte, `0666`, `magic 0x314D4251`, versione 1, aggiornato ogni
  ~1 ms dal bridge di sistema (`qmb800-shm-bridge.service`, attivo). Nessun lock file presente: oggi nessuno scrittore
  che rispetti la convenzione.
- LogicLab (`logiclab.service`) e atvise girano; se LLExec pilota il modulo non si vede da utente.

## Il riferimento: `/home/ut1/Git/openplc`

Interfaccia documentata e verificata sul PLX800 il 29-10-2026 (`docs/interface/`, `lib/c/qmb800_client.h`,
`lib/python/qmb800.py`, il simulatore `lib/python/qmb800_sim.py`):
- **lettura coerente** con `status_seq` (dispari = aggiornamento in corso; barriere su aarch64), **freschezza** da
  `update_count` col clock monotono, mai `timestamp_ns`;
- **il comando è lo stato completo** (17 coil, 12 holding register): si parte dalla rilettura, si tiene una copia
  propria, `cmd_seq` si incrementa per ultimo; la rilettura arriva dopo 1–2 aggiornamenti;
- **uno scrittore solo**, con `flock` su `/dev/shm/qmb800_registers.lock`; CODESYS (e forse LogicLab) scrivono senza
  lock: si riconoscono da `cmd_seq` che cambia dopo il nostro commit;
- i comandi **restano** dopo l'uscita del processo: allo stop si mettono le uscite a riposo;
- dal container: serve `/dev/shm` dell'host (`--ipc=host` o `-v /dev/shm:/dev/shm`); il file singolo non basta se il
  segmento nasce dopo il container.

## 1.1 SWS installato sul PLX800
- `deploy/container/install-container.sh`: come per il device-tree (righe ~779-858), **se esiste
  `/dev/shm/qmb800_registers`** aggiunge `Volume=/dev/shm:/dev/shm` al quadlet installato e al `podman run` manuale.
- Prova di installazione completa (`--pull`, canale rc): runtime su 7443/7444, IDE che si collega, sorgente `host`
  (temperature, seriale e modello dal device-tree), abbinamento al cloud. Le anomalie diventano voci del collaudo.

## 1.2 La sorgente `kind: plx800_io` — crate `sws-runtime/crates/sws-plugin-plx800`
Modello: `sws-plugin-host` (catalogo fisso di punti).
- **`shm.rs`**: struct `#[repr(C)]` uguale a `qmb800_client.h`, con le verifiche di offset in compilazione (16, 24,
  28, 56, 64, 96, 104; immagine 66 B); `open` + `mmap(MAP_SHARED)` di 176 B; controllo di `magic`, `version`,
  `struct_size`; lettura coerente e freschezza come sopra (fresco = `update_count` cambiato entro 3 × poll).
- **`writer.rs`** (solo con `writes: true`): `flock(LOCK_EX|LOCK_NB)` tenuto aperto; copia del comando inizializzata
  dalla rilettura; commit = `cmd_coils`, `cmd_hr`, `cmd_apply=1`, barriera, `cmd_seq+1`; coil 15 sempre come letto.
  **Scrittore estraneo** → log, stato della sorgente, punto `foreign_writer`, e il comando successivo riparte dalla
  rilettura (non si riafferma: non si combatte con un altro runtime). Lock occupato → sola lettura, riprova ogni 5 s,
  motivo nello stato. **Allo stop**, se abbiamo scritto: uscite 0..7 a 0, `PWM_MASK` 0, `RUN_LED_MODE` com'era
  all'avvio (2 → 1 se trovato 2), PoE e coil 15 intatti.
- **Configurazione** (`sws-core/src/project.rs`): `Plx800IoConfig { id, enabled, poll_interval_ms (100), writes
  (false), points: Vec<Plx800PointMapping { tag, point }> }`; `point` è un enum stringa snake_case:
  `in0..in7`, `dip1..dip6`, `out0..out7`, `led_run_red/green`, `led_error`, `led_a1_red/green`, `led_a2_red/green`,
  `led_redundant_supply`, `led_operative_state`, `poe_en`, `run_led_mode`, `pwm_mask`, `pwm_freq_g0/g1`,
  `pwm_duty_out0..7` (‰), `vcap_mv`, `vcap_switch_mv`, `supply_cpu_mv`, `supply_main_mv`, `supply_sec_mv`,
  `board_temp_c` (K − 273,15), `diag_rx_total/ok/err`, `diag_tx_total/ok/err` (u32, registro alto per primo), e i
  punti di stato `fresh`, `update_count`, `fail_count`, `writer_active`, `foreign_writer`. Scrivibili: uscite, LED
  comandabili, `poe_en`, `run_led_mode`, `pwm_*`. Qualità Bad se il segmento manca, l'header non torna o il dato non è
  fresco.
- **Agganci**: variante `#[serde(rename = "plx800_io")]`, `enabled()`, `sola_lettura()`, riesportazioni in
  `sws-core/src/lib.rs`; `source_supervisor.rs` (`start_one`, `source_id`, `tags_of`, `nome_motore` = `sws-plx800`);
  `validate.rs` (`mappature_tag`, `source_id`); schema IA (`gen_synoptic_schema.py` `MAPPINGS`, rigenerare
  `synoptic_schema.rs`, `schema_api.rs`, `ai/mod.rs`); dipendenza in `sws-web/Cargo.toml`.
- **Endpoint sul pannello** `GET /api/plx800/status` (segmento presente, header, `cycle_us`, fresco, scrittore) e il
  proxy `/api/remote/plx800/status`; anche in `deploy_only_app` (`check_no_admin.sh`).
- **IDE**: `types/index.ts`, `ProtocolsTab.tsx`, `Plx800IoSourceCard.tsx` sul modello di `HostSourceCard.tsx` /
  `sorgenteHost.ts`, con «Aggiungi tutti i punti» che crea i TagDef con tipo e unità e salva nell'ordine tag →
  sorgente (`DispositiviModbus.tsx:144-168`); `disponibilita.ts`, `riconciliaTag.ts` (`deduciTipo`), i testi in
  `it.json`/`en.json`.
- **Contorno**: template `examples/templates/plx800-io`, capitolo del manuale, `NOVITA.yaml`, `CHANGELOG.md`.
- **CasaDomotica**: in casa non c'è un PLX800. Annotato qui, come chiede la regola: è un indizio che il destinatario
  della funzione è chi monta un PLX800 in macchina, non l'impianto domestico.

## 1.3 Verifica
- Test Rust su un file temporaneo con lo stesso layout: offset, seqlock dispari e cambiato, freschezza, commit con
  `cmd_seq` per ultimo, scrittore estraneo, lock occupato, stato di riposo allo stop. Test vitest della card.
- Sul PC: `qmb800_sim.py` crea il segmento in `/dev/shm` e SWS locale lo legge e lo scrive.
- Collaudo (`/test-changes`) sul PLX800: IN, DIP, tensioni e temperatura vivi; con `writes: true` OUT0 e LED A1 che
  cambiano e si rileggono; lock rifiutato se un altro scrittore lo tiene; uscite a riposo allo stop del container; Bad
  se il bridge si ferma.
- Definition of done completa, poi squash su `main` e ramo eliminato.
