# Setup — Template "Casa Locale"

Questo template si connette a un broker MQTT locale. **L'indirizzo nel template è un
segnaposto** — `mqtt.example.invalid`, un nome che di proposito non risolve — e va sostituito
con quello del proprio broker in tutte e quattro le sorgenti di `project.yaml`.

Un template non porta la rete di chi l'ha scritto: fino al 17-09-2026 qui c'era l'indirizzo
vero del broker di casa dell'autore, e chi apriva il template si ritrovava il runtime a
insistere contro una macchina che sulla sua rete non esiste.

Per i comandi qui sotto, conviene tenerlo in una variabile:

```bash
export BROKER=192.0.2.10        # sostituisci con l'indirizzo del TUO broker
```

Seguire i passi qui sotto nell'ordine indicato prima di aprire il template in SWS.

---

## Sorgente 1 — Contatori DDS661 (già su MQTT)

I contatori DDS661 pubblicano nativamente su MQTT via il tool [soligolab/dds661](https://github.com/soligolab/dds661).

**Formato topic:** `dds661/<slug-dispositivo>/state`
**Payload JSON:** `{"voltage": float, "current": float, "p_active": float, "pf": float, "freq": float, "e_total": float, "e_pos": float, "e_rev": float}`

**Verifica topic attivi:**
```bash
mosquitto_sub -h "$BROKER" -t 'dds661/#' -v
```

**Adatta i topic in `project.yaml`** se i nomi dei dispositivi in `config.yaml` del tool dds661 differiscono da quelli nel template (lo slug è il nome in minuscolo con trattini).

---

## Sorgente 2 — Sensori Zigbee (già su MQTT via Zigbee2MQTT)

Zigbee2MQTT pubblica nativamente sul broker locale. Nessuna configurazione aggiuntiva richiesta.

Verifica che il bridge sia connesso:
```bash
mosquitto_sub -h "$BROKER" -t 'zigbee2mqtt/bridge/state' -C 1
```

I nomi dei dispositivi nel template corrispondono agli `entity_id` di Home Assistant (es. `zigbee2mqtt/finestragarage`). Se i nomi dei tuoi dispositivi Zigbee2MQTT differiscono, aggiornare i topic in `project.yaml` → sezione `zigbee2mqtt`.

---

## Sorgente 3 — Impianto Solare Solarman (bridge via HA)

Il Solarman usa un protocollo TCP proprietario: non pubblica direttamente su MQTT. Bisogna creare un'automazione in Home Assistant che faccia da bridge.

### Aggiungere l'automazione HA

Aprire Home Assistant → Impostazioni → Automazioni e scene → **Crea automazione** → in modalità YAML incollare:

```yaml
alias: "SWS - Bridge Solarman to MQTT"
description: "Pubblica i dati Solarman sul broker MQTT locale ogni 30 secondi"
trigger:
  - platform: time_pattern
    seconds: "/30"
action:
  - service: mqtt.publish
    data:
      topic: "sws/solarman/pv_power"
      payload: "{{ states('sensor.solarman_pv_instant_generated_pw') }}"
  - service: mqtt.publish
    data:
      topic: "sws/solarman/pv1_power"
      payload: "{{ states('sensor.solarman_pv1_power') }}"
  - service: mqtt.publish
    data:
      topic: "sws/solarman/pv2_power"
      payload: "{{ states('sensor.solarman_pv2_power') }}"
  - service: mqtt.publish
    data:
      topic: "sws/solarman/battery_soc"
      payload: "{{ states('sensor.solarman_battery_percentage') }}"
  - service: mqtt.publish
    data:
      topic: "sws/solarman/battery_power"
      payload: "{{ states('sensor.solarman_battery_power') }}"
  - service: mqtt.publish
    data:
      topic: "sws/solarman/battery_voltage"
      payload: "{{ states('sensor.solarman_battery_voltage') }}"
  - service: mqtt.publish
    data:
      topic: "sws/solarman/feed_in_out_power"
      payload: "{{ states('sensor.solarman_feed_in_out_power') }}"
  - service: mqtt.publish
    data:
      topic: "sws/solarman/consumption"
      payload: "{{ states('sensor.solarman_power_consumption') }}"
  - service: mqtt.publish
    data:
      topic: "sws/solarman/daily_production"
      payload: "{{ states('sensor.solarman_daily_production') }}"
  - service: mqtt.publish
    data:
      topic: "sws/solarman/total_production"
      payload: "{{ states('sensor.solarman_total_production') }}"
  - service: mqtt.publish
    data:
      topic: "sws/solarman/inverter_temperature"
      payload: "{{ states('sensor.solarman_inverter_module_temperature') }}"
  - service: mqtt.publish
    data:
      topic: "sws/solarman/inverter_status"
      payload: "{{ states('sensor.solarman_inverter_status') }}"
mode: single
```

Salvare e abilitare l'automazione. Dopo 30 secondi verificare:
```bash
mosquitto_sub -h "$BROKER" -t 'sws/solarman/#' -v
```

---

## Sorgente 4 — Tapparelle Shelly (bridge via HA o MQTT nativo)

Le tapparelle Shelly pubblicano nativamente su MQTT se la funzione MQTT è abilitata nel firmware.

**Trovare il Device ID Shelly:**

Metodo 1 — tramite MQTT:
```bash
mosquitto_sub -h "$BROKER" -t 'shellies/#' -v | head -20
```

Metodo 2 — tramite HA: Impostazioni → Dispositivi → cerca "Shelly" → vedi il campo "Topic MQTT".

**Aggiornare `project.yaml`:** sostituire `SHELLY_GARAGE_ID`, `SHELLY_BAGNO_ID`, ecc. con i Device ID reali (es. `shellyswitch25-AB12CD`).

**Abilitare MQTT su Shelly (se non già attivo):**
Aprire l'interfaccia web del dispositivo Shelly → Settings → MQTT → abilitare → inserire l'indirizzo del proprio broker.

---

## Verifica finale

Con tutte e 4 le sorgenti attive, lanciare SWS e aprire il template. Nella RuntimeView:

- **Page 1 Panoramica**: il diagramma flusso energia mostra dati in tempo reale
- **Page 2 Solare**: i gauge PV si aggiornano ogni 30 s
- **Page 3 Contatori**: i gauge potenza cambiano con il consumo reale
- **Page 4 Sicurezza**: i LED porte/finestre cambiano aprendo/chiudendo fisicamente
- **Page 5 Domotica**: le barre tapparella mostrano la posizione corrente
