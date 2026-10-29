# Le card delle sorgenti, ridisegnate

> **Piano d'esecuzione**, approvato il 29-10-2026. Nato dal collaudo a schermo del ramo 2 di
> [chi sta dall'altra parte](2026-10-28-chi-sta-dall-altra-parte.md). Ramo annidato `feat/card-sorgenti`.
>
> **FATTO il 29-10-2026, da vedere a schermo** (`docs/COLLAUDI_IN_SOSPESO.md` §A-octies). Le nove card passano da
> `config/sorgenti/card/`. Due scostamenti dal piano, voluti:
> - **Modbus TCP**: il pulsante del gateway resta nella sezione Dispositivi e non va in AVANZATE — sta accanto ai
>   dispositivi che crea, e una AVANZATE con un pulsante solo non dice niente.
> - **OPC-UA client**: l'intervallo di sottoscrizione sta in COLLEGAMENTO, come il poll degli altri protocolli; in
>   AVANZATE restano la security policy e i certificati.
>
> Il contrasto della card sul fondo della pagina (osservazione del maintainer sul mockup, tema chiaro) è il bordo
> `--brand-border` più l'ombra `--brand-ombra-card`; `check_contrasto.sh` verde nei due temi.

## Context

Collaudo a schermo del ramo 2 della disponibilità (`feat/disponibilita-editor`, piano
`2026-10-28-chi-sta-dall-altra-parte.md`), 29-10-2026. Osservazioni del maintainer sulla card MQTT:

- «Crea l'allarme di disponibilità» è **troppo nascosto**: sta in una riga *sotto* la card, a fine pagina;
  va dentro la sezione DISPONIBILITÀ;
- i titoli delle sezioni hanno **poco contrasto** coi campi;
- i campi vanno messi **per ordine d'importanza**;
- «Staleness watchdog (s)» sta **da solo su una riga**: è di CONNESSIONE, va allineato agli altri;
- lo stesso, «similmente», per le card degli altri protocolli.

Scelte del maintainer, prese sul mockup ASCII (29-10-2026):

1. **Avanzate chiuse**: broker, autenticazione, disponibilità e mappatura sempre aperte; connessione, TLS,
   last will in una sezione «Avanzate» chiusa. Lo stato della disponibilità sale anche **in testata**.
2. **Sparkplug B è un modo della mappatura**: `[Topic | Sparkplug B]` nel titolo di MAPPATURA, non più una
   casella a parte. Stessi dati di oggi (`source.sparkplug` presente o no).
3. **Tutte e nove le card insieme**.

## Misurato il 29-10-2026

| Cosa | Dove | Perché conta |
|---|---|---|
| Titolo di sezione = colore delle etichette | `MqttSezioni.tsx:11` `SectionHeader`: `--brand-text-subtle` 12 px/600; etichette `--brand-text-subtle` 11 px | È **la** causa del poco contrasto |
| Campi con lo stesso fondo della card | `config/comuni.tsx` `S.input`/`S.inputSm`: `--brand-surface`, come `S.card` | Si distinguono solo dal bordo. S7, `ui/base.ts` `campo` e `campoAmpio` usano già `--brand-bg` |
| La riga disponibilità sta fuori dalla card | `ProtocolsTab.tsx:326`, con l'eccezione del dispositivo Modbus scelto | Da spostare dentro, conservando l'eccezione |
| **Una fonte sola** per «risponde» | `source_supervisor.rs` `disponibilita_da_scrivere`: il tag `<id>.disponibile` è `bus.stato == Ok` di `stato_sorgenti` | Testata e sezione leggono `useStatoSorgenti()` (`statoSorgenti.ts`): niente contraddizioni, e ci sono `da_ms` («dalle 14:09») ed `errore` (il motivo) |
| Il pallino esiste già | `PallinoStato` in `DispositiviModbus.tsx:113`, `coloreStato`/`COLORI_STATO` in `statoSorgenti.ts` | Si riusa; i suoi testi sono di Modbus («errori su alcuni registri») e servono testi neutri |
| Card eterogenee | Modbus/RTU/OPC-UA server/HA usano `S.cardHead`; S7, EnIp, Host, OPC-UA client costruiscono la testata da sé, con helper `inp()` locali | Le parti comuni vanno estratte, non copiate nove volte |
| Ordine dei campi | In tutte e nove la prima è «ID sorgente», che si tocca quasi mai | Regola unica: **l'indirizzo per primo**, ID sorgente in fondo alla prima riga |

## Ramo

**Annidato**: `feat/card-sorgenti` da `feat/disponibilita-editor` — tocca gli stessi file
(`DisponibilitaSorgente`, `MqttSezioni`, `ProtocolsTab`), quindi è la via 2 di «un ramo alla volta». Rientra in
`feat/disponibilita-editor` prima dello squash su `main`, dal basso verso l'alto.

## I passi

### 1. Mockup HTML, prima del codice

`sws/tmp/mockup-card-sorgenti.html` (regola dei file di lavoro): la card MQTT nel layout scelto e una card Modbus,
**nei due temi**, con i valori veri dei token di `theme.ts` (`LIGHT_NEUTRALS`/`DARK_NEUTRALS`). Serve a vedere quello
che l'ASCII non mostra: il contrasto dei titoli e i campi su `--brand-bg`. **Pausa per il maintainer**: si tocca il
codice solo col suo sì sui colori.

### 2. Le parti comuni — `sws-editor/src/config/sorgenti/card/`

- **`SezioneSorgente.tsx`**: titolo in `--brand-text`, 11 px maiuscolo, peso 700, spaziatura 0,6, filetto
  `--brand-surface-2` accanto; spazio `destra` (stato, interruttore di modo); `apribile` / `chiusaDiPartenza`.
  Sostituisce `SectionHeader` (usato anche da `SparkplugSection`) e i titoli fatti a mano (S7 «TAG (n)», …).
- **`PastigliaStato.tsx`**: da `useStatoSorgenti()[id]` — il pallino (`coloreStato`, `COLORI_STATO`) e un testo
  breve: «risponde», «non risponde dalle HH:MM» (da `da_ms`), «non attiva»; `title` = `errore`. Testi nuovi e
  neutri (`sorgenti.stato.*`), non quelli di `cfg.modbusStato`.
- **`TestataSorgente.tsx`**: tipo colorato · id · riepilogo · `PastigliaStato` · azioni · ▲. Le nove testate
  passano di qui.
- **`DisponibilitaSezione.tsx`**: sostituisce `DisponibilitaSorgente.tsx`. Una `SezioneSorgente` DISPONIBILITÀ con
  lo stato a destra, i `children` (i campi MQTT), e la riga «Tag `<id>.disponibile` · [Crea l'allarme di
  disponibilità | Vai all'allarme]». La logica del pulsante resta identica (`aggiungiTagInAttesa`,
  `preparaAllarme`, `navigateToConfig`); si conservano i `data-testid` che i test usano. Per i protocolli senza
  configurazione, una riga di testo: «Lo dice il collegamento col dispositivo».
- `ProtocolsTab.tsx:326`: via la riga sotto la card. L'eccezione del dispositivo Modbus scelto passa alla card.

### 3. I campi su `--brand-bg`

`S.input` e `S.inputSm` (`config/comuni.tsx`) passano a `--brand-bg`, come `ui/base.ts` `campo`/`campoAmpio` e S7.
**Tocca tutta la Configurazione**, non solo le card: è una convergenza (tre posti lo fanno già così), e la misura
è `check_contrasto.sh` nei due temi.

### 4. La card MQTT

| Sezione | Campi, per importanza |
|---|---|
| Testata | MQTT · id · host:porta · N topic · stato · [Sfoglia broker] [Estrai JSON] [Elimina] |
| BROKER | Host · Porta · Client ID · ID sorgente; sotto, «Client ID casuale» con la posizione (sparisce la sezione CLIENT ID a sé) |
| AUTENTICAZIONE | Utente · Password · Da variabile d'ambiente, **su una riga** |
| DISPONIBILITÀ | Chi dice se è vivo · Topic · Campo · «Vivo»; riga tag e allarme |
| MAPPATURA (n) | `[Topic \| Sparkplug B]` nel titolo; Topic = la tabella di oggi coi suoi pulsanti; Sparkplug B = `SparkplugSection` senza la sua casella né il suo titolo |
| ▸ AVANZATE (chiusa) | CONNESSIONE: Keep-alive · QoS · Clean session · **Watchdog** su una riga di quattro, il suggerimento in `title`; TLS; LAST WILL; il resto del client id (invio al dispositivo) |

Con Sparkplug B la DISPONIBILITÀ resta nascosta, come oggi (`haDisponibilita`).

### 5. Le altre otto card

Stessa ossatura: `TestataSorgente`; **COLLEGAMENTO** con l'indirizzo per primo e ID sorgente in fondo;
**AUTENTICAZIONE** dove c'è (OPC-UA client, Home Assistant); **DISPONIBILITÀ** dove `haDisponibilita` (non Host, non
OPC-UA server); la tabella dei dati col conteggio nel titolo; **AVANZATE** chiusa solo dove ci sono opzioni da
toccare una volta (OPC-UA client: sicurezza e intervallo di sottoscrizione; Modbus TCP: gateway).

| Card | COLLEGAMENTO, in ordine |
|---|---|
| Modbus TCP | Host · Porta · Poll · ID sorgente |
| Modbus RTU | Porta seriale · Baud · Parità · Bit dati · Bit stop · Poll · ID sorgente |
| OPC-UA client | Endpoint · Intervallo · ID sorgente |
| OPC-UA server | Porta TCP · Namespace URI · ID sorgente |
| S7 | IP PLC · Porta · Rack · Slot · Poll · ID sorgente |
| EtherNet/IP | IP PLC · Slot CIP · Poll · ID sorgente |
| Home Assistant | URL · ID sorgente |
| Host | Poll · ID sorgente |

Le tabelle dei dati e i loro helper restano come sono: cambia l'involucro, non il contenuto.

### 6. Testi, prove, guardie

- i18n it+en per i titoli nuovi, la pastiglia, il modo Sparkplug (`check_i18n_ui` è a tolleranza zero,
  `check_i18n_parita`).
- vitest: `PastigliaStato` (i tre testi, l'ora da `da_ms`, il motivo nel `title`); `SezioneSorgente` (apre e
  chiude); la card MQTT (il modo Sparkplug crea e toglie `source.sparkplug`; la disponibilità sta **dentro** la
  card); `ProtocolsTab` non disegna più la riga sotto; `tests/disponibilitaSorgenti.test.tsx` aggiornato.
- `COLLAUDI_IN_SOSPESO.md` §A-septies: i passi 1-3 parlano della riga *dentro* la sezione e della testata.

## Verifica

- Le cinque voci di `CLAUDE.md`, più `check_contrasto.sh` nei due temi (passo 3).
- IDE 8460 sul ramo: `casa-locale` (quattro sorgenti MQTT verso un broker che non esiste) — a card **chiusa** la
  testata dice «non risponde dalle …»; dentro, DISPONIBILITÀ ha il pulsante dell'allarme; AVANZATE è chiusa e il
  watchdog sta in riga con gli altri; il modo Sparkplug B sostituisce la tabella e lo stato sparisce.
- Una sorgente per tipo (progetto dimostrativo con tutti i protocolli): nove testate uguali, ID sorgente sempre
  in fondo alla prima riga, i due temi.
- **CasaDomotica** (regola del 16-10): dopo il rilascio, insieme alla disponibilità Zigbee2MQTT già prevista dal
  ramo 3 — è la card che il maintainer guarda davvero.

## Fuori

- Unificare i campi di tutte le card in un solo componente `Campo`: le card hanno helper diversi (`inp()` di S7,
  `S.label`…) e riscriverli è un altro lavoro. Qui cambiano involucro, ordine e titoli.
- Le card fuori da Protocolli (Datastore, Notifiche, …): stessa malattia dei titoli, altro giro.
