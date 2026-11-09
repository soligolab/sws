# Una sorgente MQTT per tutta casa: prima la disponibilità per dispositivo, poi CasaDomotica

> Piano approvato l'08-11-2026. Ramo `feat/mqtt-dispositivi` per la parte A; la parte B si fa sul VPS dopo la rc
> col pannello aggiornato.

## Contesto

In CasaDomotica ci sono quattro sorgenti MQTT verso lo stesso broker (192.168.1.6): `mqtt-sandokan`,
`mqtt-dds661-…`, `mqtt-casa` e `mqtt-switch-garage`. Hanno dei difetti:

- **Due collisioni:** `state.id`, `state.type` e `state.name` sono scritti da due sorgenti diverse.
- **Una sorgente muta:** `mqtt-dds661-…` legge `dds661/contatore-rack-pianosuperiore/state`, che sul broker non
  esiste più (ora è `modbus/…`).
- **Un tag sbagliato:** `garage.switch..countdown_l2`, con due punti.

Il maintainer vuole **una sorgente unica** con **tutti i dispositivi della mappa**
`~/Scrivania/Server/sws-mqtt/mappa-mqtt-casa.json`: Zigbee attivi, Modbus, Tuya, Tasmota, Frigate. I comandi saranno
solo on/off e posizione, con i tipi «presa» e «tapparella».

L'ostacolo è che oggi la **disponibilità è per sorgente**: un topic solo, e quando il dispositivo è morto tutti i tag
della sorgente diventano Bad. Con una sorgente sola si perderebbe quello che l'08-11 è passato con Sandokan.
Il maintainer ha scelto: **prima la funzione in SWS**, poi l'unificazione.

## Parte A — Disponibilità per dispositivo dentro una sorgente MQTT (ramo `feat/mqtt-dispositivi`)

### Modello (`sws-core/src/project.rs`)

- Nuovo `MqttConfig.dispositivi: Vec<DispositivoMqtt>`, omesso dallo YAML se vuoto.
  - `DispositivoMqtt { id: String, disponibilita: DisponibilitaMqtt }` riusa la struct e `e_vivo` che esistono già.
- Nuovo `TopicMapping.dispositivo: Option<String>`: la riga appartiene a quel dispositivo.
- La disponibilità per dispositivo è **esplicita, un blocco per dispositivo**, perché nella stessa sorgente le
  famiglie usano topic diversi:
  - Zigbee2MQTT: `zigbee2mqtt/<n>/availability` → `state=online`;
  - Tuya: `tuya/<t>/availability` → `online`, in chiaro;
  - Tasmota: `tele/<t>/LWT` → `Online`;
  - Modbus: `modbus/status`, condiviso da quattro dispositivi;
  - Frigate: `frigate/available`.
- Nome del tag: `tag_disponibilita_dispositivo(src, dev)` → `<src>.<dev>.disponibile`, con l'id ridotto a
  `[a-z0-9_]`. Va accanto a `tag_disponibilita` (riga 1170), che resta l'unico posto in cui i nomi si costruiscono.
- Si mantiene `deny_unknown_fields`, e lo YAML senza dispositivi deve restare identico (test esistente
  `senza_disponibilita_il_yaml_resta_com_era`).
- La `disponibilita` di sorgente resta com'è, e per Zigbee2MQTT diventa «il bridge».

### Stato (`sws-core/src/stato_sorgenti.rs`)

- `StatoSorgente.dispositivi` passa da `BTreeMap<u8, Stato>` a `BTreeMap<String, Stato>`. Modbus usa la stringa
  della unit, e il JSON verso l'IDE non cambia, perché le chiavi erano già stringhe.
- Si aggiornano i chiamanti Modbus di `dispositivo()`.

### Plugin (`sws-plugin-mqtt/src/lib.rs`)

- **Sottoscrizione** (403-419): si aggiungono i topic di disponibilità dei dispositivi, una volta per topic distinto.
  Ogni dispositivo parte da `NonRisponde`, «nessun messaggio su …».
- **Messaggio in arrivo** (612-632):
  - per ogni dispositivo con quel topic, `e_vivo` decide lo stato e si chiama `stato.dispositivo(id, dev, …)`;
  - se è morto, `marca_qualita(Bad)` va **solo sulle righe con `dispositivo == dev`**;
  - la regola di sorgente resta com'è: se è morta lei, tutto Bad.
- **Eco di un comando** (594): l'eco locale si salta se è morto il dispositivo della riga, non solo la sorgente. Il
  comando parte lo stesso.
- **Caduta della sessione**: `caduta()` spegne già i dispositivi vivi, va solo verificato con le chiavi stringa.

### Supervisore (`sws-web/src/source_supervisor.rs`)

- `disponibilita_da_scrivere` (593) scrive anche `<src>.<dev>.disponibile` = (dispositivo Ok **e** sorgente Ok),
  solo ai cambi.
- Si estende il controllo del tag sparito dopo un ricaricamento (132-147).

### Validazione e schema

- `controlli_disponibilita` (`validate.rs:2616`), con gli stessi tre avvisi per ogni dispositivo. In più:
  - id di dispositivo duplicati;
  - una riga che nomina un dispositivo inesistente;
  - un dispositivo che non ha righe.
- Si rigenera `synoptic_schema.rs` (guardia `check_synoptic_schema.sh`).

### IDE

- **Tipi** in `types/index.ts`: `DispositivoMqtt`, `MqttSource.dispositivi?` e `TopicMapping.dispositivo?`.
- **`disponibilita.ts`:**
  - `tagDisponibilitaDispositivo`;
  - `allarmeDisponibilitaDispositivo`, con id `disponibilita-<src>-<dev>`;
  - preset con `{nome}`, che ora si sostituisce **con l'id del dispositivo**. È proprio il caso per cui
    Tasmota, Shelly ed ESPHome hanno già il segnaposto. Per Zigbee2MQTT si aggiunge il preset per dispositivo
    `zigbee2mqtt/{nome}/availability`.
- **Card MQTT**, nuova sezione **DISPOSITIVI** fra Disponibilità e Mappatura, sul modello di `DispositiviModbus.tsx`.
  Per ogni dispositivo:
  - id e preset;
  - topic, campo e «vivo»;
  - un `PallinoStato`, preso da `statoDispositivo` che accetta chiavi stringa;
  - il tag `.disponibile`;
  - «Crea l'allarme» / «Vai all'allarme», più un pulsante «Crea gli allarmi mancanti» per tutti.
- **Mappatura:**
  - una colonna «Dispositivo» (select);
  - il pulsante «Raggruppa per dispositivo dai topic», che per `zigbee2mqtt/<n>`, `tuya/<t>/…`, `stat|tele|cmnd/<t>/…`,
    `modbus/<d>/…` e `frigate/<cam>/…` crea i dispositivi col preset giusto e assegna le righe.
- **Intestazione:** un dispositivo morto rende la sorgente «parziale», con `coloreStato`; l'albero a sinistra fa lo
  stesso, come oggi per Modbus.
- **i18n** in it e en, sotto `sorgenti.dispositivi.*`.

### Test

- **Rust:**
  - lettura e scrittura YAML con e senza dispositivi;
  - nome del tag;
  - plugin: dispositivo morto → Bad solo sulle sue righe, e gli altri restano Good. Serve un test nuovo, perché oggi
    il ribaltamento a Bad non ha test;
  - supervisore che scrive i tag per dispositivo;
  - validazione.
- **vitest:**
  - preset con `{nome}`;
  - raggruppamento dai topic;
  - sezione Dispositivi con pallino e pulsante allarme;
  - colore «parziale».

### Chiusura della parte A

- Definition of done e controlli della CI, poi collaudo nell'IDE di prova con un broker vero (il nostro, in sola
  lettura).
- Squash, rc.7 (HOWTO §19), VPS. Il TC620 lo aggiorni tu: **va aggiornato prima della parte B**, perché un runtime
  vecchio ignora i campi nuovi e li cancella al primo salvataggio.
- Voci in CHANGELOG e NOVITA (it/en), STATUS, piano in `docs/plans/2026-11-08-mqtt-dispositivi.md`.

## Parte B — CasaDomotica: una sorgente `mqtt-casa` per tutta casa (sul VPS, dopo la rc.7 sul TC620)

Lo genera uno script una tantum in `tmp/casadomotica-mqtt/`, che legge la mappa e il broker (per Tuya, che non è
nella mappa) e produce il blocco YAML. Prima si controlla il diff, poi si applica.

- **Una sorgente** `mqtt-casa`, con disponibilità di sorgente `zigbee2mqtt/bridge/state`, e i dispositivi:
  - **Zigbee attivi:** 4 prese, 3 tapparelle, 2 relè, 3 lampade, `switch_garage`, `finestra_garage`.
    Disponibilità `…/availability`.
  - **Modbus:** 2 contatori DDS661, temperature, MCM260 (`modbus/status`). `e_rev` del contatore del piano superiore
    si scarta, perché è un registro letto male.
  - **Tuya:** 2 termostati vivi e 1 offline, pompa di calore, aspirapolvere (`tuya/<t>/availability`). Le
    proprietà si ricavano dal `state` retained.
  - **Tasmota:** Pow R2 e lampada della stampante (`tele/<t>/LWT`).
  - **Frigate:** 3 telecamere, con interruttori, `motion` e `person` (`frigate/available`).
  - Esclusi: gli Zigbee «persi» e le proprietà di configurazione (calibration, motor_reversal, countdown,
    child_lock, power_outage_memory, run_time). `linkquality` resta, ma senza storico.
- **Nomi:**
  - **le variabili già usate tengono il loro id**: `sandokan.*`, `garage.luce_1..3`, `TelevisioneSoggiorno_power`,
    `state.finestra_*`, `state.perimetrale_*`, `state.portoncino_*`, `state.voltage`, `state.p_active`,
    `state.freq`, `state.e_pos`. In questo modo pagine, allarmi (`sandokan_power_on`, `alm-rack`) e storico restano;
  - si tolgono `state.id`, `state.type`, `state.name` e le altre `state.*` mai usate, oltre a
    `garage.switch.*countdown*` e `switch_l*`/`switch_mode_l*`;
  - il nuovo si chiama in inglese.
- **Tipi:**
  - tipo **`presa`** (state, power, current, voltage, energy, linkquality) con istanze `presa_televisione`,
    `presa_piastra`, `presa_laboratorio`. Sandokan resta su `sandokan.*`;
  - tipo **`tapparella`** (position, state, moving). Quello di prova del collaudo 2.26 si chiama già così, quindi va
    esteso o rinominato: lo verifico prima di toccarlo.
- **Comandi** solo per:
  - `state` di prese, relè e lampade, con lo `/set` JSON di Zigbee2MQTT;
  - stato e `position` delle tapparelle;
  - `POWER` dei Tasmota.
  Tuya e Frigate restano in sola lettura.
- **Allarmi di disponibilità:**
  - quelli di sorgente delle tre sorgenti tolte vanno via;
  - quello di Sandokan passa a `mqtt-casa.presa_sandokan.disponibile`;
  - uno per dispositivo per le prese e le tapparelle, gli altri no, per non fare rumore.
- **Applicazione:**
  1. copia di sicurezza `project.yaml.prima-mqtt-unica-<data>`;
  2. validazione;
  3. `podman rm -f` del container di progetto;
  4. deploy sul TC620, che fai tu dall'IDE.
- Per la regola di CasaDomotica: la funzione nuova (dispositivi MQTT) entra in uso su dati veri. Poi tu aggiungi
  quello che vuoi alle pagine.

## Verifica

- **Parte A:**
  - `cargo check`, `cargo test`, `pnpm build`, `pnpm exec vitest run`, `./scripts/check_static.sh`, più fmt, clippy,
    audit, lint e type-check;
  - IDE di prova (porta libera, chiuso alla fine) col broker di casa: una sorgente con due dispositivi Zigbee. Non
    stacco nulla io: il collaudo «stacca una presa» lo facciamo insieme sul TC620.
- **Parte B:**
  - la validazione sul VPS senza errori;
  - dall'IDE nel cloud, ogni dispositivo col pallino verde, tranne quelli offline per davvero (termostato studio,
    telecamere Tuya);
  - le pagine Sandokan, Home, Garage e «Finestre e porte» coi valori vivi;
  - lo storico di `sandokan.power` continuo;
  - staccando Sandokan, Bad solo su `sandokan.*`.

## Esito (09-11-2026)

**Fatto, collaudato sul TC620 e archiviato il 09-11-2026.**

- **Parte A** in `main`:
  - `6b66e9d7`: la funzione;
  - `8872a435`: la correzione delle sottoscrizioni, perché oltre ~30 righe la sorgente restava «mai collegata».
- **Parte B** applicata sul VPS l'08-11 e deployata sul TC620 (rc.8): una sorgente `mqtt-casa` con 29 dispositivi e
  116 righe.
- **Collaudo con `presa.Laboratorio`** (al posto di Sandokan). Staccata: pallino rosso solo su di lei, `plug_lab.*`
  Bad, il resto Good.
- **L'allarme di disponibilità** la sera dell'08-11 non scattava, per un difetto vecchio del motore degli allarmi:
  un `on_delay_s` si ricontrollava solo a un valore nuovo. Corretto in `ce5c6b91` (`AlarmDb::scadenze`), nella
  rc.9. Il 09-11 mattina l'allarme compare un minuto dopo l'offline e rientra riattaccandola: «funziona tutto»
  (maintainer).
