# Credits — Template "Casa Locale"

## Icone

Le icone di questo template (batteria, garage, luce, tapparella, pannello solare, traliccio)
sono simboli **builtin** disegnati nel motore (`sws-editor/src/symbols/library.tsx`), non file
SVG distribuiti a parte — non c'è nulla da attribuire per queste sei.

Fino al 13-09-2026 (Q40) erano invece 8 file SVG in `sws-editor/public/symbols/`, derivati da
icone **Material Design Icons** (progetto Pictogrammers, Apache 2.0): quella versione di questo
documento ne elencava la fonte come richiesto dalla licenza. Q40 li ha sostituiti con simboli
ricolorabili in base allo stato (un file statico non può farlo): sette sono diventati ridisegni
builtin, l'ottavo (`solar-power-variant.svg`, mai convertito) è rimasto come file orfano — non
referenziato da nessun template — rimosso il 15-09-2026 insieme a questa revisione.

**Confermato dal maintainer il 15-09-2026**: i sette ridisegni builtin sono ridisegnati da zero
come icone stilizzate, non ricalcati sull'originale — non sono opere derivate delle icone MDI di
partenza, quindi non serve più l'attribuzione Apache 2.0. Vedi anche
`sws-editor/public/symbols/ATTRIBUTION.md`, che copre il meccanismo `kind: "vendored"` (oggi
senza utenti) per gli SVG vendorizzati futuri.

## Dati in tempo reale

I dati visualizzati nel template provengono dalle seguenti sorgenti:

| Sorgente | Protocollo | Dispositivo |
|---|---|---|
| Contatori energia DDS661 | MQTT | github.com/soligolab/dds661 |
| Sensori Zigbee porte/finestre/presenza | MQTT (Zigbee2MQTT) | Sonoff Zigbee 3.0 USB Dongle Plus |
| Impianto fotovoltaico | MQTT (bridge HA) | Solarman inverter ibrido |
| Tapparelle | MQTT | Shelly 2.5 (roller mode) |
