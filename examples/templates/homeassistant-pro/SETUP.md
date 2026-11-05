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
| `clima.pressione_hpa` | `sensor.sensoreambientestanzaarmadi_pressure` | Locale tecnico (solo se Aqara T1) |

#### Contatori elettrici
Se non hai i contatori cucina/pompa di calore, rimuovi o commenta le entità corrispondenti.

| Tag SWS | Entity HA esempio |
|---|---|
| `cucina.potenza_w` | `sensor.contatore_cucina_contatore_cucina_active_power_2` |
| `cucina.tensione_v` | `sensor.contatore_cucina_contatore_cucina_voltage_2` |
| `cucina.corrente_a` | `sensor.contatore_cucina_contatore_cucina_current_2` |
| `rete.frequenza_cucina_hz` | `sensor.contatore_cucina_contatore_cucina_frequency_2` |
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
| `presenza.in_casa` | `person.mauro2` | "home"→true, "not_home"→false |

### Stringhe, stanze e contatori sono istanze

Le cose che si ripetono sono **istanze di un tipo** (`types:` in `project.yaml`): `pv1` e `pv2` di
`stringa_fv`, le cinque stanze di `stanza`, `cucina` e `pompacalore` di `contatore`. I percorsi sono
quelli di sempre (`pv1.tensione_v`, `sala.temperatura`, `cucina.potenza_w`), quindi gli entity_id si
adattano allo stesso modo. Le pagine le mostrano coi **faceplate** di `faceplates/`: per aggiungere una
stanza basta una nuova istanza di `stanza` e una riga in più nella pagina Clima.

### Chi può usare i comandi

Questo template mostra la gestione dei permessi. Luci e tapparelle si comandano senza accedere
(`write_min_role: Viewer`), tranne due, apposta:

| Comando | Ruolo che serve |
|---|---|
| Luce del cancelletto (`luce.cancelletto`) | Operator |
| Tapparella del garage (`tapparella.garage`) | Supervisor |

Il ruolo sta sul tag, in `project.yaml`: per cambiarlo si cambia `write_min_role`.

## 5. Tag derivati (nessuna modifica necessaria)

I tag derivati vengono calcolati automaticamente da SWS tramite espressioni Python.
Non richiedono entity HA — sono calcolati a runtime:

| Tag derivato | Formula | Utilità |
|---|---|---|
| `pv.potenza_totale_kw` | PV1 + PV2 | Totale 2 stringhe |
| `pv.autoconsumo_pct` | min(FV,casa)/casa × 100 | Autoconsumo % |
| `energia.saldo_kw` | FV - casa | Surplus/deficit |
| `energia.costo_ora_eur` | consumo × 0.25 | Costo €/h |
| `clima.comfort_soggiorno` | T+U comfort 0-100 | Comfort soggiorno |
| `batteria.in_carica` | corrente > 0 | Stato carica/scarica |
| `rete.acquisto_kw` | max(0, -scambio) | Solo prelievo |
| `rete.vendita_kw` | max(0, +scambio) | Solo immissione |
| `clima.temp_media` | media 5 stanze | Temperatura media |

## 6. Storico SQLite

Il database viene creato automaticamente in `<progetto>/.history/ha-pro.db`.
Retention: 365 giorni. Grandezze registrate: 27 (V, A, kW, W, °C, %).

Per interrogare i dati direttamente:
```bash
sqlite3 .run/projects/<nome-progetto>/.history/ha-pro.db \
  "SELECT tag, ts_ms, value FROM samples WHERE tag='sala.temperatura' ORDER BY ts_ms DESC LIMIT 10;"
```

## 7. Le sei pagine

| Pagina | Cosa c'è |
|---|---|
| **1 — Panoramica** | Quattro KPI energia (FV, batteria, casa, rete), clima delle 5 stanze, porte/finestre/rilevatori, presenza, stato di luci e tapparelle, fascia allarmi |
| **2 — Fotovoltaico** | Potenza totale, gauge V/A per stringa 1+2, trend delle correnti, temperature inverter, autoconsumo |
| **3 — Batteria & Rete** | Gauge SoC%, in carica/scarica, otto grandezze della batteria, V/Hz/scambio rete, trend SoC + tensione |
| **4 — Clima** | Le 5 stanze T+U, gauge della temperatura media, comfort del soggiorno, pressione, trend temperature |
| **5 — Carichi Elettrici** | KPI della casa, contatore cucina e pompa di calore, trend delle potenze |
| **6 — Sicurezza & Controllo** | Porte, finestre, perimetro e movimento, presenza, luci (accendi/spegni) e tapparelle (SU/GIÙ) con i permessi |
