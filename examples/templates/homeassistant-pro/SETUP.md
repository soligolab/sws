# HomeAssistant Pro — Guida Setup

Questo template connette SWS SCADA a HomeAssistant leggendo 86 tag da sensori reali
e scrivendo su switch (luci) e cover (tapparelle).

## 1. Prerequisiti HA

| Integrazione | Entità tipo | Necessaria per |
|---|---|---|
| **Solarman** | `sensor.solarman_*` | FV, batteria, rete |
| **Zigbee (Aqara/SONOFF/…)** | `sensor.sensoreambiente*` | Clima 5 stanze |
| **Contatori smart** | `sensor.contatore_cucina_*` | Potenza/V/A circuiti |
| **Pompa di calore** (Shelly/Sonoff) | `sensor.pompa_di_calore_*` | Monitoraggio HP |
| **Cover** (motorizzate) | `cover.tapparella_*` | Tapparelle SU/GIÙ |
| **binary_sensor** porte/finestre | `binary_sensor.*` | Sicurezza |
| **switch** luci esterne | `switch.lampada_*` | ON/OFF luci |
| **person** | `person.*` | Presenza |

## 2. Token HA

Crea un token a lunga durata in HomeAssistant:
**Profilo → Token di accesso a lunga durata → Crea token**

Imposta la variabile d'ambiente prima di avviare SWS:
```bash
export HA_TOKEN="eyJhbGci..."
```

Oppure inserisci direttamente `token: "..."` nel `project.yaml` (sconsigliato in produzione).

## 3. URL HomeAssistant

Nel `project.yaml`, alla riga `url:`, sostituisci il placeholder con l'indirizzo reale:
```yaml
url: http://192.168.1.X:8123          # IP fisso locale
# oppure
url: http://homeassistant.local:8123  # mDNS (funziona solo in LAN)
```

## 4. Adattare gli entity_id

Ogni installazione HA ha entity_id diversi. Per trovare i tuoi:
1. Apri HA → **Strumenti per gli sviluppatori → Stati**
2. Filtra per dominio o parola chiave (es. "solarman", "temperature", "cover")
3. Sostituisci gli entity_id nel `project.yaml` mantenendo i tag SWS invariati

### Tabella entity_id da adattare

#### Solarman (inverter fotovoltaico)
I seguenti entity_id vengono generati automaticamente dall'integrazione Solarman.
Se il tuo inverter ha un nome/SN diverso, il prefisso `solarman_` potrebbe variare.

| Tag SWS | Entity HA esempio |
|---|---|
| `pv1.tensione_v` | `sensor.solarman_pv1_voltage` |
| `pv1.corrente_a` | `sensor.solarman_pv1_current` |
| `pv1.potenza_kw` | `sensor.solarman_pv1_power` |
| `batteria.percentuale` | `sensor.solarman_battery_percentage` |
| `batteria.tensione_v` | `sensor.solarman_battery_voltage` |
| `batteria.corrente_a` | `sensor.solarman_battery_charge_discharge_current` |
| `rete.tensione_v` | `sensor.solarman_grid_voltage` |
| `rete.frequenza_hz` | `sensor.solarman_grid_frequency` |

#### Sensori clima Zigbee
Ogni sensore ha un pattern basato sul nome assegnato in HA.

| Tag SWS | Entity HA esempio | Stanza |
|---|---|---|
| `sala.temperatura` | `sensor.sensoreambientesoggiorno_temperature` | Soggiorno |
| `sala.umidita` | `sensor.sensoreambientesoggiorno_humidity` | Soggiorno |
| `studio.temperatura` | `sensor.sensoreambientestudio_temperature` | Studio |
| `lavanderia.temperatura` | `sensor.sensoreambientelavanderia_temperature` | Lavanderia |
| `bagno.temperatura` | `sensor.sensoreambientebagnopianoterra_temperature` | Bagno PT |
| `tecnico.temperatura` | `sensor.sensoreambientestanzaarmadi_temperature` | Locale tecnico |
| `tecnico.pressione_hpa` | `sensor.sensoreambientestanzaarmadi_pressure` | (solo se Aqara T1) |

#### Contatori elettrici
Se non hai i contatori cucina/pompa di calore, rimuovi o commenta le entità corrispondenti.

| Tag SWS | Entity HA esempio |
|---|---|
| `cucina.potenza_w` | `sensor.contatore_cucina_contatore_cucina_active_power_2` |
| `cucina.tensione_v` | `sensor.contatore_cucina_contatore_cucina_voltage_2` |
| `cucina.corrente_a` | `sensor.contatore_cucina_contatore_cucina_current_2` |
| `pompacalore.potenza_w` | `sensor.pompa_di_calore_potenza` |
| `pompacalore.tensione_v` | `sensor.pompa_di_calore_tensione` |

#### Sicurezza
Sostituisci con i nomi dei tuoi sensori. Rimuovi le righe per i sensori che non hai.

| Tag SWS | Entity HA esempio |
|---|---|
| `garage.aperto` | `binary_sensor.garagesezionale_garage_door_contact` |
| `porta.principale` | `binary_sensor.portoncinodisimpegno` |
| `finestra.soggiorno_sx` | `binary_sensor.portafinestrasoggiornosx` |
| `esterno.movimento` | `binary_sensor.casaretrobosco_motion` |
| `esterno.persona` | `binary_sensor.casaretrobosco_person` |

#### Luci esterne (switch + write-back)
| Tag SWS | Entity HA | Operazione |
|---|---|---|
| `luce.cancelletto` | `switch.lampada_cancelletto_mauro` | ON/OFF |
| `luce.viale` | `switch.lampada_viale_centrale_2` | ON/OFF |
| `luce.strada` | `switch.lampada_strada_dx_2` | ON/OFF |

#### Tapparelle motorizzate (cover + write-back)
Write-back: `true` → `open_cover`, `false` → `close_cover`

| Tag SWS | Entity HA |
|---|---|
| `tapparella.soggiorno_sx` | `cover.tapparella_pianoterra_soggiorno_sx` |
| `tapparella.soggiorno_dx` | `cover.tapparella_pianoterra_soggiorno_dx` |
| `tapparella.bagno` | `cover.tapparella_pianoterra_bagno` |
| `tapparella.garage` | `cover.tapparella_pianoterra_garage` |

#### Presenza
| Tag SWS | Entity HA | Note |
|---|---|---|
| `mauro.a_casa` | `person.mauro2` | "home"→true, "not_home"→false |

## 5. Tag derivati (nessuna modifica necessaria)

I tag derivati vengono calcolati automaticamente da SWS tramite espressioni Python.
Non richiedono entity HA — sono calcolati a runtime:

| Tag derivato | Formula | Utilità |
|---|---|---|
| `pv.potenza_totale_kw` | PV1 + PV2 | Totale 2 stringhe |
| `pv.autoconsumo_pct` | min(FV,casa)/casa × 100 | Autoconsumo % |
| `energia.saldo_kw` | FV - casa | Surplus/deficit |
| `energia.costo_ora_eur` | consumo × 0.25 | Costo €/h |
| `sala.comfort_index` | T+U comfort 0-100 | Comfort soggiorno |
| `batteria.in_carica` | corrente > 0 | Stato carica/scarica |
| `rete.acquisto_kw` | max(0, -scambio) | Solo prelievo |
| `rete.vendita_kw` | max(0, +scambio) | Solo immissione |
| `clima.temp_media` | media 5 stanze | Temperatura media |

## 6. Storico SQLite

Il database viene creato automaticamente in `<progetto>/.history/ha-pro.db`.
Retention: 365 giorni. Grandezze registrate: ~20 tag (V, A, kW, °C, %).

Per interrogare i dati direttamente:
```bash
sqlite3 .run/projects/<nome-progetto>/.history/ha-pro.db \
  "SELECT tag, ts_ms, value FROM samples WHERE tag='sala.temperatura' ORDER BY ts_ms DESC LIMIT 10;"
```

## 7. Pagine sinottiche suggerite (6 pagine)

Dopo aver applicato il template, crea le pagine nell'editor SWS:

| Pagina | Elementi suggeriti |
|---|---|
| **1 — Panoramica** | Diagramma flusso FV→batt→casa→rete, clima riassunto 5 stanze, LED sicurezza, presenza Mauro |
| **2 — Fotovoltaico** | Gauge V/A per stringa 1+2, grafico storico corrente, produzione oggi/totale, temp inverter |
| **3 — Batteria & Rete** | Gauge SoC%, grafico storico SoC+tensione, V/A/Hz rete, indicator in carica/scarica |
| **4 — Clima** | Tabella 5 stanze T+U, gauge comfort index, grafico storico temperature, pressione |
| **5 — Carichi Elettrici** | W+V+A contatore cucina, pompa di calore, grafico potenza oraria |
| **6 — Sicurezza & Controlli** | Mappa LED porte/finestre/motion, toggle luci ON/OFF, pulsanti tapparelle SU/GIÙ |
