# Strutture e array sugli altri protocolli — seme

> **Seme — decisione.** Quando questo lavoro comincia, il primo passo è una **sessione di plan dedicata e
> approfondita** per sviscerarne tutti i dettagli. Quello che c'è qui è materiale, non un piano d'esecuzione.

Nato chiudendo il [piano dei tag come oggetto unico](../archive/2026-09-21-gestione-tag-oggetto-unico.md) il
25-10-2026. Quel piano ha portato i tag compositi (tipi riusabili e istanze, array) nel core, nell'editor, su
**Modbus** (Fase 3) e su **OPC-UA** (Fase 4, server e client). Gli altri protocolli li teneva «in coda, non
pianificati qui», e sono lavoro vero:

| Protocollo | Cosa manca, misurato quando il piano è nato |
|---|---|
| **S7** | blocchi DB con layout dichiarato, lettura a blocco (come il blocco di registri Modbus) |
| **EtherNet/IP** | array `Vec<T>`, UDT con template/`list_tag` — il più costoso |
| **MQTT** | indici di array nel `json_path`; `flattenJsonLeaves` con gli array; Sparkplug dataset/template |
| **Home Assistant** | gli attributi lista/dict oggi si scartano **in silenzio** |
| **Host** | mappatura «collezione»: un core, un mount, un'interfaccia per membro |

Da decidere nella sessione di plan: l'ordine (la priorità del maintainer finora è stata Modbus e OPC-UA, entrambe
fatte), e se Home Assistant meriti un `fix` a parte per lo scarto silenzioso, che è un difetto e non una funzione.
