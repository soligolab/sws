# Ruolo di questo template

**Applicazione realistica, piccola** — l'impianto del tutorial del manuale (Parte II, da
[`docs/manual/T01_laboratorio.md`](../../../docs/manual/T01_laboratorio.md) a `T11`), pronto da provare.

| | |
|---|---|
| **Risorsa** | un PLC — OpenPLC Runtime v4 — con una pompa e un serbatoio; un sensore di temperatura su MQTT |
| **Caso d'uso** | riempire un serbatoio fino a una soglia, con l'allarme di livello alto che ferma la pompa |

## Cosa c'è

- **Tre pagine**: *Impianto* (serbatoio, pompa, tubo col flusso, marcia/arresto, valori), *Andamento* (trend di
  livello e portata, allarmi attivi), *Parametri* (finestra con la soglia, riservata al Supervisor).
- **Un tipo**, `pompa`, e la sua istanza `pompa1`; le variabili del serbatoio.
- **Quattro sorgenti verso lo stesso PLC**: Modbus TCP (`openplc`, quella che alimenta le pagine), OPC UA
  (`openplc-opcua`, firmato e cifrato) e S7 (`openplc-s7`) che leggono il livello in variabili gemelle, e MQTT
  (`broker-lab`) che legge un sensore e pubblica lo stato della pompa.
- **Due allarmi**: livello alto e disponibilità del PLC. Storico su pompa, livello e temperatura.
- **I permessi** (è uno dei due template che li mostrano, regola R7): *Marcia / Arresto* si usa senza accedere — il
  membro `comando` del tipo `pompa` ha `write_min_role: Viewer` — e chiede solo la conferma; il setpoint della soglia,
  nella finestra *Parametri*, resta al **Supervisor**, sull'oggetto (attenuato col lucchetto) e sulla variabile
  `soglia_alta` (così lo fa rispettare anche il server). Il tutorial (T10, T11) parte dal ruolo predefinito, Operator,
  anche per la pompa: chi lo segue con questo template vede la pompa partire anche senza accedere.

## Per provarlo

1. Il laboratorio: `examples/laboratorio/laboratorio.sh avvia`, poi `carica` (vedi il suo README).
2. Crea un progetto da questo template e apri **Protocolli**.
3. **OPC UA**: il laboratorio vuole l'utente `sws` con la password `laboratorio`, che un template non porta (le
   credenziali non viaggiano nei template): scrivila nella sorgente `openplc-opcua`.
4. **Utenti del pannello**: nessuno, per lo stesso motivo; creali in *Sicurezza → Utenti* come al T10.

Gli indirizzi sono tutti `127.0.0.1`: IDE, pannello e laboratorio sulla stessa macchina. Per un PLC vero si cambiano
host e porte nelle sorgenti.
