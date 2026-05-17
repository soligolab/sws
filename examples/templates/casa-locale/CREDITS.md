# Credits — Template "Casa Locale"

## Icone SVG

Le icone nella directory `sws-editor/public/symbols/` aggiunte per questo template provengono da **Material Design Icons** (progetto Pictogrammers).

| File | ID icona MDI | Fonte | Licenza |
|---|---|---|---|
| `solar-panel.svg` | `mdi-solar-panel` | github.com/Templarian/MaterialDesign | Apache 2.0 |
| `solar-power-variant.svg` | `mdi-solar-power-variant` | github.com/Templarian/MaterialDesign | Apache 2.0 |
| `battery-charging-high.svg` | `mdi-battery-charging-high` | github.com/Templarian/MaterialDesign | Apache 2.0 |
| `transmission-tower.svg` | `mdi-transmission-tower` | github.com/Templarian/MaterialDesign | Apache 2.0 |
| `home-lightning-bolt.svg` | `mdi-home-lightning-bolt` | github.com/Templarian/MaterialDesign | Apache 2.0 |
| `garage-open-variant.svg` | `mdi-garage-open-variant` | github.com/Templarian/MaterialDesign | Apache 2.0 |
| `window-open-variant.svg` | `mdi-window-open-variant` | github.com/Templarian/MaterialDesign | Apache 2.0 |
| `roller-shade.svg` | `mdi-roller-shade` | github.com/Templarian/MaterialDesign | Apache 2.0 |

**Apache License 2.0** — Testo completo: https://www.apache.org/licenses/LICENSE-2.0

Estratto dei requisiti per la redistribuzione (Apache 2.0):
> You may reproduce and distribute copies of the Work [...] provided that You meet the following conditions: (a) You must give any other recipients of the Work [...] a copy of this License.

I file sopra elencati vengono distribuiti assieme al progetto SWS (AGPL-3.0) in conformità con le condizioni di compatibilità delle licenze. L'Apache 2.0 è compatibile con AGPL-3.0 per la distribuzione combinata.

Data di download: 2026-05-16.

## Dati in tempo reale

I dati visualizzati nel template provengono dalle seguenti sorgenti:

| Sorgente | Protocollo | Dispositivo |
|---|---|---|
| Contatori energia DDS661 | MQTT | github.com/soligolab/dds661 |
| Sensori Zigbee porte/finestre/presenza | MQTT (Zigbee2MQTT) | Sonoff Zigbee 3.0 USB Dongle Plus |
| Impianto fotovoltaico | MQTT (bridge HA) | Solarman inverter ibrido |
| Tapparelle | MQTT | Shelly 2.5 (roller mode) |
