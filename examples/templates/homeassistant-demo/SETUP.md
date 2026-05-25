# HomeAssistant Demo — Setup

## Prerequisiti

1. HomeAssistant in esecuzione e raggiungibile dalla macchina dove gira `sws-runtime`.
2. Un **Long-Lived Access Token** generato dal tuo profilo HA:
   *Profilo → Sicurezza → Token di accesso a lunga durata → Crea token*.

## Configurazione

Apri **Configurazione → Protocolli** e modifica la sorgente `ha-demo`:

| Campo | Valore di esempio |
|-------|-------------------|
| URL   | `http://192.168.1.2:8123` |
| Token | il token copiato da HA |

In alternativa, imposta la variabile d'ambiente `HA_TOKEN` e nel campo
"Variabile env per il token" scrivi `HA_TOKEN` (lascia il campo Token vuoto).

## Entity ID

Il template usa entity ID di esempio. **Adatta ogni riga della tabella Entità**
agli entity_id reali della tua installazione HA, visibili su:

`http://<ha-host>:8123/developer-tools/state`

## Pattern supportati

| Pattern | Esempio entity | Note |
|---------|---------------|------|
| Sensore numerico | `sensor.temperature` | `state` → Float |
| Sensore binario | `binary_sensor.door` | `state` on/off → Bool |
| Attributo specifico | `climate.room`, attr `current_temperature` | |
| Luce/switch (write) | `light.living_room` | write_service: turn_on |
| Input numerico (write) | `input_number.setpoint` | write_service: set_value |
| Input booleano (write) | `input_boolean.mode` | write_service: turn_on |
| Tag derivato (SWS) | — | `expression` Python su altri tag |

## Connessione

La sorgente si connette via WebSocket (`/api/websocket`) e REST (`/api/states`).
Solo `ws://` / `http://` sono supportati in questa versione (no TLS locale).
Reconnect automatico ogni 5 s in caso di perdita di connessione.
