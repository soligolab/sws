# Sorgente «host»: risorse di sistema come tag

## Contesto
Il maintainer vuole monitorare lo stato dell'host (CPU, RAM, temperatura, disco, rete, uptime) con bar graph e trend
e, più in generale, mappare risorse di sistema in tag da usare liberamente (allarmi, storico, script). Oggi non si può:
`/api/system` e `/metrics` espongono CPU/RAM/disco solo come stato del runtime, non come tag, e la temperatura non è
letta da nessuna parte (zero `thermal`/`hwmon` nel Rust).

**Misurato sul TC620 (2026-09-20, sola lettura, `podman exec` vs host):** dal container `/proc/loadavg`, `/proc/meminfo`,
`/proc/uptime` e `/sys/class/thermal/thermal_zone{0,1}` (cpu-thermal 60 °C, gpu-thermal 57 °C) e `/sys/class/hwmon/hwmon{0,1,2}`
sono **identici all'host**. Quindi per le metriche di base **non serve nessun canale verso l'host**: niente flag podman
nuovi, niente demone, niente D-Bus. Il container ha `Network=host`, quindi anche le interfacce di rete sono quelle vere.
Attenzione: `df /` nel container è l'overlay da 10 GB, non la partizione dati; i mount veri sono `/var/sws/{config,projects,logs}`.

## Decisione (scelta del maintainer)
Una **sorgente nativa `host`**, stesso modello di S7/Modbus: una lista di mappature `metrica → tag`, lettura a polling
dentro il runtime. Tag creati a mano da un catalogo (niente «crea tutti»). Il canale file-dall'host (schema
`sws-boot-image.path`) e l'agente con protocollo dedicato **restano fuori** finché non serve qualcosa che il container non
vede (D-Bus Pixsys, `systemctl`): sarebbe una metrica `file` aggiuntiva, non un protocollo nuovo.

Metriche v1: CPU % (totale, per core) e load 1/5/15; RAM e swap; temperature (ogni thermal_zone per nome + hwmon);
disco per mount, rete rx/tx per interfaccia, uptime dell'**host** (oggi `/api/system` dà solo quello del processo).

## Implementazione
1. **Crate `sws-runtime/crates/sws-plugin-host`** (~250 righe, modello `sws-plugin-s7/src/lib.rs`): `pub async fn run(cfg:
   HostConfig, db: Arc<TagDb>, cancel)` con `tokio::time::interval(poll_interval_ms)`, lettura via `sysinfo` 0.30 (già
   dipendenza: `System`, `Disks`, `Networks`, `Components` per le temperature) più `/proc/loadavg` e `/proc/uptime`;
   `db.ingest(tag, TagValue::Float, Good)`; su errore di lettura `db.marca_qualita(tag, Bad)`. Sola lettura: nessun
   `bus.register`. Le metriche stanno in una funzione pura `leggi(metrica, param, &Snapshot) -> Option<f64>` così i test
   non toccano il sistema.
2. **Config** in `sws-core/src/project.rs`: nuova variante `SourceDef::Host(HostConfig)` (`kind: host`) con
   `HostConfig { id, poll_interval_ms (default 2000), metrics: Vec<HostMetricMapping> }` e
   `HostMetricMapping { tag, metric, param: Option<String> }`. `metric` è un enum: `cpu_pct`, `cpu_core_pct`(param=core),
   `load_1|5|15`, `mem_used_pct`, `mem_used_mb`, `mem_available_mb`, `mem_total_mb`, `swap_used_pct`, `temp`(param=nome
   zona), `disk_used_pct`, `disk_free_gb`(param=mount), `net_rx_bps`, `net_tx_bps`(param=interfaccia), `uptime_s`.
3. **Match esaustivi da aggiornare** (trovati dall'esplorazione): `sws-web/src/source_supervisor.rs` (`start_one` ~312,
   `source_id` ~442, `tags_of` ~468), `sws-web/src/validate.rs` (~1099-1108), `SourceDef::sola_lettura` in `project.rs`
   (~1610-1660, arm esplicito), `sws-web/src/router.rs`, `sws-web/src/ai/mod.rs:58`, `sws-web/src/schema_api.rs:398-410`.
   Dipendenza in `sws-web/Cargo.toml` (il workspace prende `crates/*` da solo).
4. **Catalogo per l'editor**: `GET /api/host/catalog` (Admin/Engineer) che elenca thermal zone, mount, interfacce e core
   presenti, così la scheda propone valori veri (modello: l'entity browser di Home Assistant).
5. **Editor**: `HostSource` in `sws-editor/src/types/index.ts` (~1135-1197), `emptyHost`/`HostSourceCard` in
   `ConfigView.tsx` (modello `S7SourceCard` ~1244-1420), dispatch delle card (~4607-4640) e pulsante «Aggiungi», badge in
   `editor/LeftPanel.tsx:1757-1767` (oggi tutto ciò che non è MQTT/OPC-UA cade su «MBUS»), chiavi i18n it/en.
6. **Schema e guardie**: rigenerare `RT/sws-web/src/synoptic_schema.rs` con `scripts/gen_synoptic_schema.py` (legge
   `enum SourceDef`; aggiungere l'esempio) — `check_synoptic_schema.sh` fallisce se è stale. Sezione in
   `docs/manual/06_protocols.md`. Un template/esempio minimo con bar graph + trend (`examples/templates/`) e `check_templates.sh`.
7. **Bug trovato per strada, fuori scope ma da annotare**: in TS `EnIpSource.kind` è `'en_ip'` (`index.ts:1189`,
   `ConfigView.tsx:1427`) mentre Rust serializza `"enip"`.

## Vincoli di processo (CLAUDE.md)
- Un ramo alla volta: `fix/emoji-webfont` è ancora aperto → prima chiuderlo (squash merge + eliminazione) o annidare.
  Poi `feat/sorgente-host` da `main`.
- Il piano va copiato in `docs/plans/2026-09-20-sorgente-host.md` e committato (non resta in `~/.claude/plans/`) con riga in
  `docs/plans/README.md`.
- Definition of done: `cargo check`, `pnpm build`, `./scripts/check_static.sh` verdi + conferma del maintainer; push solo su
  richiesta esplicita.

## Verifica
- Test unitari della funzione pura `leggi` con snapshot finti (una per metrica, param mancante → `None`/qualità Bad) e
  parsing YAML round-trip di `HostConfig`.
- `cargo test -p sws-plugin-host -p sws-web`, `pnpm exec vitest run`, `check_static.sh`.
- Dal vivo: avviare il runtime locale, aggiungere la sorgente host da Config → Sorgenti, mappare `cpu_pct`, `mem_used_pct`,
  `temp` (zona cpu-thermal), mettere bar graph e trend in una pagina e confrontare con `top`/`cat /sys/class/thermal`.
- Sul TC620 di test (autorizzato dal maintainer, addresses cambiano ogni sessione): deploy, verificare che `temp` dia
  ~60 °C come l'host e che la CPU segua il carico; controllare il mount `/var/sws/projects` per il disco.

## Fuori scope / rischi
- Nessun dato board-specific (D-Bus Pixsys): eventuale metrica `file` in una fase successiva, con una sessione di plan dedicata.
- `sysinfo` in container: il «primo disco» non è quello dei dati → il parametro `mount` è obbligatorio per le metriche disco.
- Il poll a 2 s su 20-30 metriche costa poco, ma `System::refresh_*` va limitato alle sezioni usate.
