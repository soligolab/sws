# Sorgenti: spegnerle senza cancellarle, le assenze previste, e le code dell'inverter (seme)

> Nato il 10-11-2026 da `Appunti.txt` (punti del 02-11, 03-11 e 07-11-2026), quando il maintainer
> ha chiesto di trasformare gli appunti in semi e piani e di eliminare il file.

**Stato: seme — decisione.** Quando questo lavoro comincerà, il primo passo è una sessione di plan
approfondita e dedicata, per sviscerarne tutti i dettagli. Qui ci sono l'idea, le misure e le
code rimaste, non un progetto.

## L'idea

Una sorgente (un protocollo configurato nel progetto) oggi è sempre accesa. Non si può fermare
senza cancellarla, e non si può dire che un dispositivo manca per natura in certe ore (l'inverter
fotovoltaico di notte). Sono due facce della stessa domanda: **una sorgente va interrogata
«sempre / mai / solo quando…»?** L'appunto sulle assenze previste lo diceva da sé: «è la stessa
domanda dell'appunto sulle sorgenti disattivabili ("sempre / mai / solo quando…"): da trattare
insieme, come seme».

In coda a questo seme stanno due residui che riguardano sorgenti precise: le cose brevi rimaste
dal piano dell'inverter Solarman e il soggetto del certificato client OPC UA. Non sono parte della
domanda, ma la sessione di plan che la affronterà toccherà gli stessi file.

## 1. Le sorgenti non si possono disattivare senza cancellarle

Visto il 07-11-2026 dal collaudo della rc.3 della 2.26.0.

**Cosa c'è nel codice** (misurato il 07-11-2026, riverificato il 10-11-2026):

- `SourceDef` in `sws-runtime/crates/sws-core/src/project.rs` (enum alla riga 508) non ha un campo
  `enabled` su nessuna variante: Modbus TCP, Modbus RTU, OPC UA client, OPC UA server, MQTT, Home
  Assistant, S7, EtherNet/IP, host. L'unico modo per fermarne una è toglierla, e con lei se ne va
  la sua configurazione.
- Gli script globali ce l'hanno già: `GlobalScriptDef.enabled` (stesso file, riga 1954),
  con `#[serde(default = "bool_true")]`, default `true`, e il commento «When false, the script is
  loaded but never scheduled». Anche il generatore ha il suo `enabled`
  (`default_generator_enabled`, riga 406). Quello è il modello da copiare: con
  `#[serde(default = "bool_true")]` i progetti esistenti non cambiano.

**Da decidere quando lo si fa:**

- cosa succede ai tag della sorgente spenta: qualità «non collegata» o stale, non valori vecchi
  mostrati come buoni;
- cosa dice il tag `<sorgente>.disponibile` di una sorgente spenta;
- se il validatore deve ancora controllare i tag di una sorgente spenta;
- l'interruttore nell'IDE: nell'elenco delle sorgenti, e uguale nel pannello proprietà.

Stima del 07-11-2026: «ramo piccolo-medio: runtime, IDE, validatore, NOVITA».

## 2. Dispositivi che mancano per natura (l'inverter di notte): livelli 2 e 3

Visto il 07-11-2026.

**Il livello 1 è fatto**, sul ramo `fix/registro-log` (rc.4, commit `eb4bad70`): un'assenza si dice
una volta, poi la sorgente si interroga ogni 60 s. In dettaglio (da `STATUS.md`, rc.4): un timeout
si dice al terzo giro muto, il ritorno si scrive con la durata, un dispositivo assente da 5 minuti
viene interrogato ogni 60 s, la stessa caduta di sessione (tutti i protocolli) si riscrive solo
dopo un'ora.

**Misurato sul TC620 il 07-11-2026 alle 17**: l'inverter ZCS non era spento; la chiavetta Solarman
perdeva una risposta ogni 30-90 s.

**Il difetto che resta**: ogni risposta persa porta ancora i tag a `Bad` per un giro. È
`marca_bad` in `leggi_giro`, in `sws-runtime/crates/sws-plugin-modbus/src/lib.rs` (il 10-11-2026:
`marca_bad` alla riga 274, `leggi_giro` alla riga 383, chiamate alle righe 450, 456, 464, 492, 505).
Il risultato è uno storico con buchi e riquadri che lampeggiano.

**Livello 2 — tolleranza per giri.** Un tag tiene l'ultimo valore per qualche giro, segnato come
non aggiornato, prima di diventare `Bad`. Per i contatori (energia del giorno, energia totale) un
«tieni l'ultimo valore» anche di notte, quando l'inverter è spento davvero. Gli allarmi si possono
già inibire con `<sorgente>.disponibile`.

**Livello 3 — l'assenza prevista.** Dichiarata nella sorgente: una fascia oraria, o una condizione
su un tag (per esempio potenza fotovoltaica a zero). Mentre vale: niente avvisi nel registro,
stato «a riposo» grigio, allarmi fermi.

## Le opzioni già visibili (per i punti 1 e 2 insieme)

Sono le strade viste il 10-11-2026 scrivendo il seme, non una scelta:

1. Un solo campo `enabled: bool` sulle sorgenti (come gli script globali). Risolve il punto 1,
   non il punto 2.
2. Un campo con tre valori — «sempre», «mai», «solo quando…» — dove «solo quando» porta una fascia
   oraria o una condizione su un tag. Copre il punto 1 (con «mai») e il livello 3 del punto 2 in
   una sezione sola del pannello proprietà (regola «una sezione per dato» di `CLAUDE.md`).
3. Il livello 2 (tolleranza per giri, «tieni l'ultimo valore») è indipendente dalle prime due: è
   un parametro della sorgente o del tag, e può venire prima o dopo.

## 3. Code dell'inverter Solarman

Cose brevi rimaste il 02-11-2026 alla chiusura del piano
[Inverter Solarman](../../archive/2026-11-01-inverter-solarman.md), uscito nella 2.24.0. Il seme
gemello sugli inverter SunSpec è [2026-11-02-inverter-sunspec.md](2026-11-02-inverter-sunspec.md).

- **I segni di giorno.** Il segno di `grid_power` in immissione e di `battery_power` in carica
  sono confermati solo di notte (prelievo dalla rete, batteria ferma). Da guardare di giorno nella
  pagina Energy di CasaDomotica. Se un verso è sbagliato, si corregge la scala nella ricetta
  `scripts/inverter/ricette/sofar_hyd_es.yaml` (il 10-11-2026: `grid_power` con `scala: -10` e la
  nota «l'immissione è da vedere di giorno»; `battery_power` con `scala: 10` e la nota «la carica è
  da verificare di giorno»).
- **L'allarme «produzione nulla di giorno»** vuole l'ora del giorno (o l'alba e il tramonto)
  dentro una condizione di allarme. Oggi non c'è. È la stessa esigenza del livello 3 del punto 2
  (una condizione che vale solo in certe ore).
- **La discovery MQTT di Home Assistant** (`homeassistant/sensor/.../config`) per la
  pubblicazione: oggi Home Assistant va configurato a mano sul topic `inverter/<id>/state`.
- **`inverter_alert_message` (registro `0x022B`)** vale 128 e la mappa lo tratta come
  enumerazione senza quel valore. Forse è a bit, come `faults_1..5`. Da verificare su un documento
  Sofar prima di cambiarlo. Il 10-11-2026 il registro sta in
  `catalogo/dispositivi/sofar/_hyd_es.json` (`indirizzo: 555`, gruppo `diagnostics`, con `testi.voci`
  da 0 in su); i `faults_1..5` sono dichiarati `modo: bit` nella ricetta.
- **«Dal catalogo» crea la variabile con lo storico spento.** Per un inverter i punti del gruppo
  `main` andrebbero storicizzati (in CasaDomotica è stato acceso a mano). Proposta da decidere: un
  campo «storico» per gruppo nel catalogo. Il 10-11-2026 il default è `history: false` in
  `sws-editor/src/config/sorgenti/daCatalogo.ts` (riga 277).
- **La chiavetta chiude la connessione.** Il 02-11-2026 alle 05:53 la chiavetta ha chiuso la
  connessione dopo tre minuti di timeout a raffica. Vale la pena guardare in CasaDomotica i
  contatori `<sorgente>.diagnostics.*` nei primi giorni (`timeouts`, `bad_replies`, `implausible`,
  pubblicati dal plugin Modbus). È lo stesso fenomeno misurato il 07-11 al punto 2.

## 4. Il soggetto del certificato client OPC UA

Visto il 03-11-2026 col tutorial T05 (`docs/manual/T05_opcua.md`).

Il certificato client OPC UA di SWS (`opcua-pki/<sorgente>/own/cert.der`) si presenta come
«C=IE, ST=Dublin, O=SWS Runtime». Sono i valori di esempio di async-opcua: `DEFAULT_COUNTRY` e
`DEFAULT_STATE` in `async-opcua-crypto`, file `x509.rs` (il 10-11-2026, versione 0.18.0, righe
37-38: `"IE"` e `"Dublin"`), usati da `create_sample_keypair(true)`. In SWS la chiamata è in
`build_client_builder`, `sws-runtime/crates/sws-plugin-opcua/src/lib.rs` (righe 165-176), con
`.application_name("SWS Runtime")`; la cartella `opcua-pki` è impostata per progetto da
`set_pki_root` in `sws-runtime/crates/sws-web/src/projects.rs`.

Per avere dati veri (paese, organizzazione, magari il nome del pannello) bisogna generare noi la
coppia di chiavi con un `X509Data` nostro e scriverla nella PKI prima di creare il client.

È solo estetica, ma è quello che legge chi deve fidarsi di SWS sul server.
