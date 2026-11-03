# Il laboratorio del tutorial

Un impianto finto ma vero: **OpenPLC Runtime v4** che fa girare un piccolo programma (una pompa che riempie un
serbatoio, con un allarme di livello alto) e lo espone in **Modbus TCP, S7 e OPC UA**, più un broker **MQTT**. Tutto
in due container podman, sullo stesso PC dove gira l'IDE di SWS.

È il banco su cui il tutorial del manuale ([`docs/manual/T01_laboratorio.md`](../../docs/manual/T01_laboratorio.md) e
seguenti) esegue ogni passo.

```bash
./laboratorio.sh avvia     # OpenPLC e il broker MQTT
./laboratorio.sh carica    # compila impianto/ e lo carica su OpenPLC, in RUN
./laboratorio.sh stato     # cosa risponde
./laboratorio.sh ferma     # toglie i due container
```

| Cosa | Dove |
|---|---|
| `impianto/` | Il progetto dell'Editor OpenPLC v4: `pous/programs/main.st` e i tre server in `devices/servers/` |
| `laboratorio.sh` | Avvio, caricamento (con la CLI dell'Editor, scaricata la prima volta in `~/.cache/sws-laboratorio`), stato, MQTT |

Le porte sono quelle di un pannello con OpenPLC installato da SWS: Modbus **1502**, S7 **10102**, OPC UA **14840**,
l'API di OpenPLC sulla **8443**; MQTT sulla **11883**.

L'OPC UA è solo firmato e cifrato (`Basic256Sha256`), con l'utente `sws` / `laboratorio`. Due particolarità di
OpenPLC 4.3.1, già sistemate in `impianto/devices/servers/opcua.json`:
- su un canale cifrato tratta ogni sessione come autenticazione col **certificato**, anche quella anonima: per questo
  il profilo usa utente e password;
- il server si presenta come `urn:freeopcua:python:server` qualunque cosa dica la configurazione, e un certificato
  con un altro URI viene rifiutato dai client (SWS compreso): `applicationUri` è quello.
