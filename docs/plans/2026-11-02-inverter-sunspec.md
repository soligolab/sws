# Inverter SunSpec — seme

> **Stato: seme — decisione.** Nato il 02-11-2026 chiudendo il piano
> [inverter Solarman](../archive/2026-11-01-inverter-solarman.md), che lo rimandava a un ramo successivo.
>
> **Quando questo lavoro comincia, il primo passo è una sessione di plan approfondita, dedicata, per sviscerarne
> tutti i dettagli.** Qui ci sono l'idea e le misure del 02-11-2026, non un progetto.

## L'idea

Molti inverter (SMA, Fronius, SolarEdge, Huawei con l'adattatore, i Sofar recenti) espongono Modbus TCP secondo
**SunSpec**: a 40000 (o 50000, o 0) c'è la firma `SunS`, poi una catena di modelli `{id, lunghezza, registri}` fino a
`0xFFFF`. Con la catena, la mappa non si scrive: si **legge dal dispositivo** e si traduce nel vocabolario canonico
(`catalogo/canonico/inverter.json`) — per esempio il modello 103 (inverter trifase) dà potenza, tensioni, energia.

## Cosa c'è già (misurato il 02-11-2026)

- La sorgente Modbus TCP ha trasporti, `blocchi`, `min`/`max` e `testi`: una mappa SunSpec è una mappa come le altre.
- Il vocabolario canonico e `check_catalogo.sh` (sezione inverter) esistono.
- Manca: la lettura della catena, i fattori di scala SunSpec (`*_SF`, un registro che dà l'esponente: oggi `scale`
  è un numero fisso), un simulatore per i test.

## Domande per la sessione di plan

- La catena si legge **nell'IDE** (una «scoperta», come per OPC-UA, che genera la mappa) o **nel runtime** a ogni
  collegamento?
- I fattori di scala: un campo nuovo della mappatura (`scala_da: <registro>`) o la mappa generata li risolve una volta?
- Quale simulatore (pysunspec2 ha i modelli in JSON) e quali modelli per primi (101/103, 124 batteria, 160 MPPT)?

## E la scrittura (fase 2 del piano Solarman)

Scrivere su un inverter (modo di lavoro, limiti di carica) è lavoro a parte: lista bianca dei registri, conferma,
rilettura, audit. **Mai** i parametri di rete (CEI 0-21) né quelli della batteria. Va deciso nella stessa sessione o
in un seme suo.
