# Modbus a bus → dispositivi → tag

> **Piano d'esecuzione** (04-10-2026), nato dal seme di questo stesso file dopo la sessione di plan col maintainer.
> Il testo del seme è nella storia git di questo file.

## Context

Seme [`docs/archive/2026-10-04-bus-e-dispositivi.md`](2026-10-04-bus-e-dispositivi.md), richiesta del
maintainer: configurare il **bus**, dentro i **dispositivi** per id, dentro i **tag**. Oggi una sorgente Modbus è una
connessione con **un solo** `unit_id` (`ModbusTcpConfig`/`ModbusRtuConfig`, `sws-core/src/project.rs:560/579`), e il
caso RTU è anche un difetto: due slave sulla stessa RS-485 = due sorgenti che aprono la stessa porta seriale
(`run_rtu`, `sws-plugin-modbus/src/lib.rs:360`). Nessuno stato per sorgente arriva all'IDE.

**Scelte del maintainer (04-10-2026):** primo giro **solo Modbus RTU + TCP** (gli altri protocolli restano come sono);
`devices` **dentro la sorgente** esistente (nessun kind nuovo, nessuna migrazione all'apertura); per dispositivo
**ordine parole/byte, intervallo di polling, timeout**; **stato per dispositivo** con un pallino nell'albero.

Ramo: `feat/modbus-dispositivi` **annidato** su `feat/tag-3-modbus` (tocca gli stessi file del motore Modbus; quel ramo
aspetta il collaudo dal vivo). Primo commit: questo piano in `docs/archive/2026-10-04-bus-e-dispositivi.md` (il seme
diventa piano d'esecuzione).

## Modello (`sws-core/src/project.rs`)

```yaml
- kind: modbus_rtu
  id: linea1
  device: /dev/ttyS1
  baud_rate: 19200
  poll_interval_ms: 1000        # predefinito per i dispositivi
  devices:
    - unit_id: 3
      nome: inverter            # facoltativo, etichetta
      ordine: cdab              # default abcd
      poll_interval_ms: 500     # facoltativo, altrimenti quello del bus
      timeout_ms: 3000          # default 3000
      registers: [...]
```

- `struct DispositivoModbus { unit_id: u8, nome: String, modello: Option<String>, ordine: OrdineModbus,
  poll_interval_ms: Option<u64>, timeout_ms: u64, registers: Vec<RegisterMapping> }` (`modello`: vedi «catalogo») (serde: default e `skip_serializing_if` sui default).
- `ModbusTcpConfig`/`ModbusRtuConfig` + `devices: Vec<DispositivoModbus>`. I campi vecchi `unit_id`, `ordine`,
  `registers` restano **leggibili** (default; `registers` omesso se vuoto).
- `fn dispositivi(&self) -> Vec<DispositivoModbus>` su entrambe: se `devices` è vuoto e ci sono `registers` → un
  dispositivo `{unit_id, ordine, registers}` (formato vecchio = un bus con un dispositivo); se `devices` non è vuoto, i
  campi vecchi sono ignorati. **Unico punto** in cui il formato vecchio viene interpretato: supervisore, validatore,
  plugin passano tutti da qui.
- L'IDE, al caricamento della scheda, normalizza al formato nuovo (stessa regola, in TS) e salva così: il YAML vecchio
  sparisce al primo salvataggio, senza migrazione lato runtime.

## Motore (`sws-plugin-modbus/src/lib.rs`)

- **Una sessione per bus** (una porta seriale aperta una volta, una connessione TCP per gateway). `trait Dispositivo`
  guadagna `fn imposta_unita(&mut self, u: u8)` (su `client::Context` = `set_slave(Slave(u))`, `SlaveContext` di
  tokio-modbus); `connect_slave` col primo unit id.
- Ciclo: per ogni dispositivo un `prossimo: Instant` (il suo intervallo); la sessione dorme fino al primo in scadenza o
  a una scrittura; per ogni dispositivo dovuto: `imposta_unita` → `leggi_giro` col **suo** timeout e **suo** ordine
  (oggi 3 s fissi in `leggi_giro` → parametro).
- Scrittura: la radice del tag → il dispositivo che la mappa (mappa costruita in `prepara`) → `imposta_unita` →
  `scrivi`. `registra` registra le radici di tutti i dispositivi sullo stesso canale.
- **Errori per dispositivo**: eccezione/timeout → Bad i suoi tag (come oggi per mappatura) e il dispositivo è «non
  risponde»; i `giri_muti` diventano **per dispositivo** e uno slave muto **non** chiude il bus. Il bus si riconnette
  (`con_attesa`, invariato) solo per un errore di trasporto (`e_trasporto`) o se **tutti** i dispositivi sono muti da
  3 giri (porta o gateway guasti).
- `run`/`run_rtu` restano i due punti d'ingresso, con `cfg.dispositivi()`.

## Stato per dispositivo

- `sws-core`, modulo nuovo `stato_sorgenti.rs`: `StatoSorgenti` (`Arc`, `RwLock<HashMap<sorgente, StatoSorgente>>`)
  con `StatoSorgente { stato, dispositivi: BTreeMap<u8, StatoDispositivo> }`, `StatoDispositivo { stato: Ok | NonRisponde
  | MaiConnesso, errore: Option<String>, da_ms }`. Generico per sorgente, così gli altri protocolli possono riempire
  il livello bus quando toccherà a loro.
- Il supervisore (`sws-web/src/source_supervisor.rs`) lo possiede, lo passa a `run`/`run_rtu`, toglie la voce in
  `stop_one`. Il plugin aggiorna lo stato solo **ai cambi** (non a ogni giro).
- `GET /api/sources/stato` (auth come le altre `/api/sources/*`), JSON per sorgente e dispositivo; sorgenti spente o
  supervisore disarmato → assenti (l'IDE mostra grigio «non attivo»).
- Lo stato è quello del runtime con cui l'IDE parla (detto nel manuale).

## Validatore (`sws-web/src/validate.rs`)

- `mappature_tag` (`:1568`) e `tags_of` del supervisore (`:475`) passano da `dispositivi()`; percorso del rilievo
  `devices[u3].registers[i].tag`.
- Nuovi: **errore** due dispositivi con lo stesso `unit_id` nello stesso bus; **avviso** `devices` e `registers` vecchi
  presenti insieme (i vecchi sono ignorati); **avviso** due sorgenti RTU sulla stessa porta seriale («uniscile in un bus»).
- `unknown_fields` accetta i campi nuovi; `scripts/gen_synoptic_schema.py` + `synoptic_schema.rs` rigenerati
  (`DispositivoModbus` nel campo annidato, `:508`).

## IDE

- `types/index.ts`: `DispositivoModbus`, `devices?` su `ModbusTcpSource`/`ModbusRtuSource`.
- `config/sorgenti/modbusDispositivi.ts` (puro): `dispositiviDi(src)` / `normalizzaModbus(src)` (la stessa regola del
  runtime), `etichettaDispositivo` («inverter (3)» o «Slave 3»), `prossimoUnitId`.
- **Card bus** (`ModbusSourceCard`/`ModbusRtuSourceCard` ridotte ai parametri di connessione + polling predefinito) con
  l'elenco dei dispositivi (unit id, nome, n. registri, stato) e «Aggiungi dispositivo». **Card dispositivo** nuova
  `DispositivoModbusCard.tsx`: unit id, nome, ordine (`CampoOrdineModbus`), polling (vuoto = del bus), timeout,
  `TabellaRegistriModbus` (invariata).
- **Albero della Configurazione**: `VoceElencoConfig` + `figli?: VoceElencoConfig[]`; `AlberoConfigurazione.tsx` disegna
  un terzo livello (stesse guide); focus composito `"<bus>/<unit>"` (il bus non può contenere `/`? — controllato: se
  l'id lo contiene si usa il separatore `\u0000` come in `chiaveRilievi`). `ProtocolsTab` con focus su un dispositivo
  mostra la card dispositivo; su un bus mostra la card bus. `usePubblicaElenco` pubblica i figli.
- Pallino di stato su bus e dispositivo: polling di `/api/sources/stato` ogni 5 s **solo** mentre la Configurazione è
  aperta; verde/rosso (con l'errore nel title)/grigio.
- `tagCatalog.sourceTagIds`: legge `devices[].registers` (via `dispositiviDi`). `rinominaTag` è già ricorsivo su
  `tag` (`riscriviOggetto`): un test lo conferma.
- i18n it/en.

## Predisposto per il catalogo di dispositivi noti (richiesta del 04-10-2026)

Il catalogo non si fa in questo giro: diventa un **seme** `docs/archive/2026-10-04-catalogo-dispositivi.md` (idea, misure,
la frase della sessione di plan approfondita), con la riga «seme — decisione» nel README dei piani. Questo giro però
lascia pronti i punti a cui il catalogo si aggancerà, così dopo non si rifà niente:
- **Il dispositivo è autosufficiente e copiabile**: tutto quello che serve a interrogarlo (ordine, timeout, polling,
  registri) sta in `DispositivoModbus`, niente sul bus. Una voce di catalogo è esattamente un `DispositivoModbus`
  senza `unit_id`, più un tipo (`TypeDef`) per l'istanza: con la Fase 3 una struttura si legge già **a blocco**, quindi
  «inverter X» = un tipo + una mappatura dell'istanza all'indirizzo di partenza.
- Campo `modello: Option<String>` sul dispositivo (serializzato solo se presente): da dove viene il dispositivo
  («pixsys/atr244@1»). In questo giro lo scrive solo il YAML a mano e la card lo mostra in sola lettura; il catalogo lo
  riempirà, e servirà a proporre gli aggiornamenti della voce.
- «Aggiungi dispositivo» passa da una funzione pura `nuovoDispositivo(bus, base?)` (`modbusDispositivi.ts`): oggi `base`
  è vuoto, domani è la voce scelta dal catalogo. Il pulsante resta uno, il catalogo diventerà la sua seconda strada.

## Fuori da questo giro

S7, EtherNet/IP, OPC-UA, MQTT, HA, Host restano a una sorgente = un dispositivo; il seme resta per loro (riga
aggiornata nel README dei piani). Lo stato per sorgente degli altri protocolli: la struttura c'è, il riempimento no.
A margine, da verificare al primo `cargo test`: `examples/templates/enip-demo/project.yaml:7` dice `kind: en_ip`, il
serde vuole `enip`.

## Documenti

Manuale `docs/manual/06_protocols.md` (bus e dispositivi, formato vecchio ancora letto, pallino di stato), CHANGELOG
Added, `NOVITA.yaml` it/en, README dei piani, STATUS.

## Verifica

- Rust: `dispositivi()` (formato vecchio, nuovo, entrambi); motore su `Finto` esteso con più unità: due dispositivi
  letti col loro ordine e intervallo, uno muto che non chiude il bus e diventa «non risponde» mentre l'altro resta Good,
  tutti muti → Err, scrittura instradata allo slave giusto (`imposta_unita` registrato); validatore (unit id doppio,
  porta doppia); `StatoSorgenti` ai cambi.
- vitest: `normalizzaModbus`, `sourceTagIds` con devices, rinomina dentro `devices`, albero a tre livelli (focus
  composito), card dispositivo.
- `cargo test --workspace`, `pnpm build`, `./scripts/check_static.sh`.
- Dal vivo su questo PC: simulatore `pymodbus` con **due slave** (unit 1 e 2, `single=False`) su TCP, un runtime di prova
  dichiarato e poi terminato: due dispositivi in un bus, uno spento → solo i suoi tag Bad e pallino rosso, l'altro
  continua. RTU con una coppia di porte virtuali `socat` se disponibile, altrimenti solo TCP e lo dico.
