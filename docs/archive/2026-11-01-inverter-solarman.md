# Inverter fotovoltaici: Solarman V5 e mappe nel catalogo, a partire dallo ZCS di casa

## Context

Il maintainer vuole leggere in SWS il suo inverter **ZCS Azzurro HYD6000 ZSS**, che è un Sofar HYD 6000-ES con un
altro marchio, attraverso la chiavetta Solarman (`192.168.1.29:8899`, logger `1786079474`, slave 1). Vuole farlo con
un disegno che regga molti modelli: **un protocollo, tante mappe**.

**Analisi di partenza**: `~/Scrivania/Server/sws-inverter/prompt-sws-inverter.md` e la mappa Home Assistant
`sofar_hyd3k-6k-es.yaml`, con 80 punti in due blocchi: `0x0200–0x0255` FC3 e `0x10B0–0x10BC` FC4.

**Obiettivo a regime**: SWS è **l'unico** a interrogare la chiavetta, che non regge due client. Pubblica lo stato su
MQTT, e Home Assistant smette di leggerla.

**Scelte del maintainer** (01-11-2026):
- **estendere la sorgente Modbus**, non creare un protocollo nuovo;
- **pubblicazione MQTT generale** per qualunque tag;
- **primo ramo = lettura completa**: SunSpec in un ramo successivo, scrittura in fase 2;
- **prove da questa macchina** (`192.168.1.169`, la porta 8899 risponde), poi il pannello di casa.

## Cosa si riusa (misurato)

**Plugin Modbus** (`sws-runtime/crates/sws-plugin-modbus/src/lib.rs`):
- `sessione<D: Dispositivo>` (:542) è generica sul trait `Dispositivo` (:61: `leggi`, `scrivi_registri`,
  `scrivi_bit`, `imposta_unita`). **Un trasporto nuovo = un tipo che implementa `Dispositivo`**: polling, scritture,
  una richiesta per volta e cache per giro restano quelli di oggi.
- RTU su TCP: `tokio_modbus::client::rtu::attach_slave` su un `TcpStream`.
- Riconnessione: `sws_core::riconnessione::con_attesa`.
- Stato e disponibilità: `StatoSorgenti`, `<id>.disponibile`.
- Codec: `codec.rs` (`decodifica`, `permuta`, `OrdineModbus`, `estrai_bit`). Test con il dispositivo finto `Finto`
  (`tests.rs:9`) e tempo virtuale.

**Catalogo dispositivi** (`catalogo/dispositivi/<marca>/<modello>.json`, `sws-web/src/catalogo.rs`):
- un modello ha la sezione `modbus` (trasporto, ordine, timeout, seriale) e `registri[{nome, indirizzo, formato,
  scala, unita, accesso, gruppo, descrizione, valori}]`; i frammenti `_` si prendono con `includi`;
- una cartella utente vince su quella di prodotto;
- l'IDE lo compila in tipo, variabile e `DispositivoModbus` (`sws-editor/src/config/sorgenti/daCatalogo.ts`);
- guardia: `scripts/check_catalogo.sh`;
- **il modello canonico** viene da sé: i `nome` dei registri di una mappa inverter **sono** gli id canonici, e il tipo
  generato ne ha i membri.

**Altro da riusare:**
- allarmi: il bottone «prepara allarme» (`card/DisponibilitaSezione.tsx:62`, `preparaAllarme` in
  `store/index.ts:2888`);
- MQTT: `rumqttc` e l'ultima volontà sono già in `sws-plugin-mqtt` (`lib.rs:361`). **Manca la pubblicazione dei tag**:
  oggi escono solo le scritture dell'operatore (`lib.rs:478`).

## Il ramo

`feat/inverter-solarman`, da `main`. Un commit per fase, ognuna verde.

### Fase 1 — trame, senza rete

Nuovi moduli `sws-plugin-modbus/src/rtu.rs` e `solarman.rs`:
- **`rtu.rs`**: costruzione e lettura delle trame RTU FC3, FC4, FC6, FC16, con il **CRC16 Modbus** (oggi nel progetto
  non c'è, lo fa tokio-modbus dentro di sé).
- **`solarman.rs`**: pacchetto V5 con:
  - `0xA5`, lunghezza, controllo `0x4510`/`0x1510`, sequenza;
  - seriale del logger uint32 LE;
  - checksum, `0x15`;
  - scarto dei pacchetti di servizio (heartbeat).

  I campi si verificano sulla documentazione di `pysolarmanv5` al momento di scriverli, non a memoria.
- **Test su trame registrate**: checksum, seriale, heartbeat, CRC, eccezioni Modbus, risposte troppo corte.

### Fase 2 — i trasporti

- `ModbusTcpConfig` (`sws-core/src/project.rs:560`) guadagna questi campi:
  - `trasporto: mbap | rtu_su_tcp | solarman_v5` (default `mbap`, i progetti di oggi non cambiano);
  - `seriale_logger: Option<u32>`;
  - `pausa_ms`, la pausa fra due richieste;
  - `tentativi`.
- `struct ClientSolarman` implementa `Dispositivo`.
- **Il punto da rispettare**: un errore in un dispositivo non ferma gli altri. Il modello di oggi già distingue
  eccezione (tag Bad) da trasporto (sessione chiusa e riconnessione).
- Da toccare in tutti i posti dove si elencano i protocolli:
  - TS: `types/index.ts:1666`;
  - card Modbus TCP: campi nuovi nella sezione COLLEGAMENTO, con i18n;
  - `validate.rs`;
  - `gen_synoptic_schema.py` e la sua rigenerazione.

### Fase 3 — blocchi, plausibilità, testi

Nel plugin, a livello di dispositivo e di mappatura:
- **`blocchi: [{area, da, a, ogni}]`** per dispositivo. Ogni giro legge i blocchi una volta sola (`ogni: n` = un giro
  su n, per i punti lenti) e le mappature che ci cadono dentro si servono dalla cache del giro, quella che c'è già.
  Sullo ZCS sono **2 richieste a giro invece di circa 80**.
- **`min`/`max` di plausibilità** su `RegisterMapping` (`project.rs:768`): un valore fuori → qualità **Bad**, e nello
  storico non entra come buono.
- **`testi`** su `RegisterMapping`, con `modo: valore | bit`:
  - il tag stringa porta il testo dell'enum (`inverter_status`);
  - oppure l'elenco dei bit accesi (i registri di guasto).

  **Nella mappa Sofar, Fault 1…5 sono maschere di bit descritte come enum (chiavi 1, 2, 4…): errore da correggere.**
- **Tag di diagnostica del dispositivo**: `<id>.<dispositivo>.timeout`, `.scartati`, `.non_plausibili` (contatori).
  Servono agli allarmi e alla prova di 48 ore.

### Fase 4 — catalogo, modello canonico, convertitore, mappa ZCS

**Formato del catalogo, versione 3:**
- `categoria: "inverter"`;
- in `modbus`: `trasporto: solarman_v5|rtu_su_tcp|…`, `blocchi`;
- per registro: `min`, `max`, `testi`, `ogni`;
- `fonte`, `licenza`, `verifica: {stato, data, note}`;
- `allarmi_suggeriti`.

Aggiornare `check_catalogo.sh` e `daCatalogo.ts`.

**Vocabolario canonico** in `catalogo/canonico/inverter.json` (id, unità, convenzione di segno), come nella tabella
dell'analisi:
- `grid_power` > 0 = prelievo;
- `battery_power` > 0 = carica;
- contatori `energy_*` monotoni.

Il segno si inverte con la scala negativa. Una nuova guardia controlla che ogni mappa `inverter` usi nomi del
vocabolario nel gruppo predefinito `canonico`. I punti grezzi vanno nel gruppo `diagnostica`, non importato di
default: è la «pagina dei punti grezzi».

**Convertitore** `scripts/inverter/da_solarman.py`, dal formato solarman al catalogo:
- regola 1–4 → u16, i16, u32, i32;
- `registers: [lo, hi]` → ordine delle word;
- `lookup` → `testi`;
- `requests` → `blocchi`;
- una tabella nome HA → id canonico da completare;
- fonte e licenza obbligatorie.

**Prima di importare**: verificare la licenza dell'integrazione solarman e dei suoi fork.

**Mappa** `catalogo/dispositivi/zcs/azzurro-hyd-es.json`, con il Sofar HYD 3–6K-ES fra i modelli coperti. Esce dal
convertitore, `verifica.stato: non_verificata` finché la fase 6 non la conferma.

**Errori noti, annotati nel file:**
- Buck Current `0x022F` (651 A) e DCI Voltage `0x023C` (815 V): esclusi;
- corrente di rete: quale fra `grid_current` e `grid_r_current`;
- fasi S e T: fuori dal canonico;
- Battery Daily Discharge doppio;
- Fault come maschere di bit.

### Fase 5 — pubblicazione MQTT generale

Su `MqttConfig` (`project.rs:795`), `pubblica: [{topic, tag | prefisso, formato: json|valore, retain, intervallo_ms,
al_cambiamento}]` più `disponibilita: {topic, online, offline}`, con nascita e ultima volontà.

Per l'inverter:
- `inverter/<id>/state`: JSON piatto retained con i punti canonici, come il bridge di casa (`modbus/<device>/state`);
- `inverter/<id>/availability`: segue `<sorgente>.disponibile`.

Il plugin si abbona ai cambi del TagDb.

Va anche nella card MQTT, sezione PUBBLICAZIONE, con i18n e schema. La discovery di Home Assistant resta fuori, va in
`Appunti.txt`.

### Fase 6 — prove dal vivo e chiusura

1. **Finestra concordata col maintainer**: lui disattiva l'integrazione solarman in Home Assistant.
   - Runtime di prova dichiarato su questa macchina, porte libere, sempre terminato a fine prova.
   - Lettura dei due blocchi, confronto con la tabella del 01-11 alle 19:18 e con l'app.
   - Esito in `sws/tmp/inverter/`.
2. **Segni di giorno e di notte**: produzione, immissione, carica e scarica. Nota: nell'analisi il −1,25 kW in scarica
   «da invertire» è **già** nella convenzione canonica (negativo = scarica). Si verifica con la batteria in carica.
3. **48 ore continue** con i contatori di diagnostica, log in `sws/tmp/inverter/`.
4. **A regime**:
   - la sorgente passa sul pannello di casa collegato a CasaDomotica (regola del progetto di riferimento), con pagina
     e allarmi:
     - comunicazione persa;
     - guasto;
     - SOC basso;
     - temperatura alta;
     - non plausibili ripetuti;
   - Home Assistant legge da MQTT;
   - «produzione nulla di giorno» richiede l'ora del giorno: va in `Appunti.txt`.
5. **Documentazione**:
   - `docs/HOWTO.md`: un capitolo nuovo, «aggiungere un inverter»;
   - il manuale delle sorgenti;
   - `CHANGELOG`;
   - `NOVITA.yaml`, it e en.

**Dopo il ramo:**
- **SunSpec** è un ramo successivo: catena dei modelli da `SunS` a 40000/50000/0 → mappa generata, provata con un
  simulatore. Lo si annota come seme;
- la **scrittura** è la fase 2, con lista bianca, conferma, rilettura e audit; mai CEI 0-21 né i parametri batteria.

**Piano nel repo**: questo piano va in `docs/archive/2026-11-01-inverter-solarman.md` all'avvio del ramo, con la riga
in `docs/plans/README.md`.

## Chiusura (02-11-2026)

Fasi 1–5 fatte; della 6: lettura dal vivo confermata (ordine delle parole, segno di grid_power in prelievo, correnti,
DCI), la prova di 48 ore sostituita su indicazione del maintainer dalla pagina Energy in CasaDomotica (i contatori di
diagnostica nello storico valgono più di una prova isolata), documentazione scritta (HOWTO 31, manuale 06, CHANGELOG,
NOVITA). Corretti strada facendo: tipi interi dalle scale intere, nomi automatici in inglese, unità e decimali dalle
foglie di una variabile strutturata, chiavi dei testi fra virgolette, rimando di una lettura Solarman muta. Nuovo
simbolo `lib:building/house`. Uscito nella 2.24.0.

Rimasti fuori: SunSpec e la scrittura nel seme [inverter SunSpec](../plans/2026-11-02-inverter-sunspec.md); i punti
brevi (segni di giorno, allarme di produzione, discovery HA, 0x022B, storico dal catalogo, parità LVGL) in
`docs/plans/Appunti.txt`.

## Verifica

- Ogni fase:
  - `cargo check`;
  - `cargo test` (trame, trasporto finto, blocchi, plausibilità, testi, pubblicazione MQTT con broker finto);
  - `pnpm build`;
  - `pnpm exec vitest run` (card, `daCatalogo` con le mappe v3);
  - `./scripts/check_static.sh` (catalogo, vocabolario canonico, tipi di sorgente, schema, i18n).
- **Dal vivo**: le fasi 6.1–6.3, con un solo client alla volta sulla chiavetta, e la finestra sempre chiesta prima.
- **Nessuna build d'immagine** finché il maintainer non conferma il risultato.
