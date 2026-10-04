# Catalogo dei dispositivi noti — Pixsys, in JSON letti a caldo

> **Piano d'esecuzione** (04-10-2026), nato dal seme di questo stesso file dopo la sessione di plan col maintainer.
> Il testo del seme è nella storia git di questo file.

## Context

Seme [`docs/archive/2026-10-04-catalogo-dispositivi.md`](2026-10-04-catalogo-dispositivi.md). Il
maintainer ha fornito la mappa registri Modbus della maggior parte dei prodotti Pixsys (upload
`Pixsys_Modbus_Register_Map.md`: registri comuni 0-5, regolatori ATR 1000-1005/2000-2004, indicatori STR 100-105, I/O
MCM 10-41, convertitori DRR 500-511, word a bit, CDAB) e chiede un **catalogo di dispositivi preconfigurati da inserire
nei nodi del protocollo Modbus**, con la tabella dei registri **in file JSON letti dinamicamente**, facili da estendere
e correggere («ci sarà qualche inesattezza»).

Il ramo bus → dispositivi (`feat/modbus-dispositivi`, in attesa di collaudo) ha lasciato gli agganci: `modello` sul
dispositivo, `nuovoDispositivo(bus, base?)`.

**Scelte del maintainer (04-10-2026):**
- un dispositivo dal catalogo diventa **un'istanza tipizzata**: un tipo per modello (`pixsys_atr244`) con un membro per
  registro, una variabile istanza (`atr244_3`), ogni membro mappato al suo registro; due ATR244 condividono il tipo;
- **formato sul filo + scala**: la mappatura dice come leggere il registro (`i16`) e la scala (0.1); il valore scalato
  va nel tag (`f32`). Estensione del motore Modbus, utile anche fuori dal catalogo;
- **bit come membri bool**: un campo `bit` sulla mappatura; in scrittura leggi-modifica-scrivi;
- JSON **nel prodotto + cartella utente** (stesso id: vince l'utente), riletti a ogni apertura del catalogo.

Ramo `feat/catalogo-dispositivi`, **annidato** su `feat/modbus-dispositivi` (ne usa i tipi e le card). Primo commit:
questo piano in `docs/archive/2026-10-04-catalogo-dispositivi.md` (il seme diventa piano d'esecuzione).

## 1. Il motore Modbus: formato, bit, sola lettura

`RegisterMapping` (`sws-core/src/project.rs:743`) + tre campi facoltativi, omessi se assenti:
- `formato: Option<String>` — tipo scalare **sul filo** (`i16`, `u16`, `i32`, `u32`, `f32`…, i nomi di
  `TipoScalare`). Se c'è, decide registri e decodifica **al posto del tipo del tag**, e `scale` si applica sempre:
  `valore = grezzo × scale` → `TagDb::ingest` lo porta al tipo dichiarato (f32). In scrittura `grezzo = round(v /
  scale)`, controllato sull'intervallo del formato. Senza `formato` tutto come oggi (regola dei nomi storici inclusa).
- `bit: Option<u8>` (0-15) — si legge un registro (formato `u16` implicito) e se ne estrae il bit → `Bool`. Scrittura:
  legge il registro, cambia il bit, lo riscrive (solo holding).
- `sola_lettura: bool` — la scrittura è rifiutata con un avviso anche su holding (registri R del catalogo).

`sws-plugin-modbus`: `codec.rs` + `decodifica_formato`/`codifica_formato` (puri, test per segno e scala, es. `0xFFFE`
i16 × 0.1 = −0.2) ed `estrai_bit`/`imposta_bit`; `prepara` costruisce lo slot da `formato`/`bit`; `leggi_giro` tiene una
**cache per giro** `(area, address, n) → letti`, così dieci bit della stessa word sono una lettura sola; `scrivi` fa il
leggi-modifica-scrivi per `bit` e rispetta `sola_lettura`. Validatore: `formato` deve essere un tipo scalare numerico
noto; `bit` solo 0-15 e solo su holding/input; `bit` e `formato` diverso da u16/i16 insieme → errore.

IDE `TabellaRegistriModbus.tsx`: colonne **Formato** (select: «dal tipo» / i16 / u16 / i32 / u32 / f32 / …) e **Bit**
(vuoto o 0-15); la scala si abilita anche quando c'è un formato; «sola lettura» come spunta. `registriMappatura` conta
dal formato quando c'è.

## 2. Il catalogo: file, formato, lettura

**Dove:**
- prodotto: `catalogo/dispositivi/<marca>/<modello>.json` nel repo; nell'immagine `/var/sws/catalogo/dispositivi`
  (come `examples/templates` → `/var/sws/templates`: `build_container*.sh`, i due `Containerfile`, `build_deploy.sh`,
  `deploy/yocto/install.sh` + launch, `deploy/generic-linux/*`, `deploy/editor/run-editor.sh`, `start_editor.sh`,
  `start_runtime.sh`). Flag nuovo `--catalog-root` (default `/var/sws/catalogo/dispositivi`);
- utente: `<config>/catalogo-dispositivi/<marca>/<modello>.json` (`--config` è un volume persistente sul pannello; in
  sviluppo `.run-editor/config/…`). Stesso id = vince l'utente. (Il nome evita `dispositivi_conosciuti.yaml`, che è il
  pinning TLS.)

**Un file per modello**, più **frammenti condivisi** (nome che comincia con `_`, non elencati) per non ripetere i
registri comuni — una correzione si fa in un posto solo:

```json
{
  "id": "pixsys/atr244",
  "versione": 1,
  "marca": "Pixsys",
  "modello": "ATR244",
  "famiglia": "Regolatori ATR",
  "descrizione": { "it": "Regolatore di processo 1/16 DIN…", "en": "Process controller 1/16 DIN…" },
  "modbus": { "ordine": "cdab", "timeout_ms": 1000,
              "seriale": { "baud_rate": 19200, "parity": "N", "data_bits": 8, "stop_bits": 1 } },
  "includi": ["pixsys/_comuni", "pixsys/_atr"]
}
```
```json
{ "id": "pixsys/_atr", "registri": [
  { "nome": "pv1", "indirizzo": 1000, "formato": "i16", "scala": 0.1, "tipo": "f32", "unita": "°C",
    "accesso": "r", "gruppo": "processo",
    "descrizione": { "it": "Variabile di processo AI1 (decimali secondo Dec.P)", "en": "…" } },
  { "nome": "stato", "indirizzo": 1004, "accesso": "r", "gruppo": "processo",
    "bit": [ { "bit": 0, "nome": "allarme1", "descrizione": { "it": "Allarme 1 attivo", "en": "…" } }, … ] },
  { "nome": "sp1", "indirizzo": 2000, "formato": "i16", "scala": 0.1, "tipo": "f32", "accesso": "rw", "gruppo": "comandi" }
] }
```
Campi del registro: `nome` (membro del tipo), `indirizzo`, `area` (default holding), `formato` (default u16), `scala`
(default 1), `tipo` del membro (default: `f32` se scala ≠ 1, altrimenti il formato), `unita`, `accesso` (`r`/`rw`),
`gruppo` (`identificazione`, `processo`, `comandi`, `configurazione`…), `predefinito` (il gruppo è spuntato di default;
`configurazione` no), `descrizione` it/en, oppure `bit: [...]` (ogni bit un membro bool `<nome>_<bit.nome>` → in
pratica il nome del bit). Lettura: `sws-web/src/catalogo.rs`, nuovo, sul modello di `templates.rs` (`read_dir` a ogni
richiesta, niente cache):
- `GET /api/catalogo/dispositivi` → elenco `{id, marca, modello, famiglia, descrizione, origine: prodotto|utente}` più
  gli errori dei file che non si leggono (il catalogo non si rompe per un file sbagliato: lo dice);
- `GET /api/catalogo/dispositivi/<marca>/<modello>` → la voce con gli `includi` risolti (registri del modello dopo
  quelli inclusi; un nome ripetuto sovrascrive, così un modello corregge un frammento).
Router completo dell'IDE, autenticato come le altre `/api/project/*`.

**Le voci Pixsys** dalla mappa: frammenti `_comuni` (0-5: codice modello, firmware, indirizzo, baud, parità, ritardo —
gruppo `identificazione`/`configurazione`), `_atr`, `_str`, `_mcm`, `_drr`; modelli **ATR121, ATR142, ATR144, ATR244,
STR551, STR561, STR571, MCM260X, MCM280X, DRR245, DRR460** (11 file). Word a bit: stato e allarmi ATR, ingressi/uscite
digitali STR e MCM (DI0-15, DO0-15 scrivibili). Decimali impliciti (Dec.P): scala 0.1 di default, detto nella
descrizione e modificabile dopo nella card.

**Guardia** `scripts/check_catalogo.sh` (in `STATICHE` di `check_static.sh`, sul modello di `check_templates.sh`):
JSON valido, campi obbligatori, `id` = percorso, `formato`/`tipo` fra i tipi scalari (letti da `tipo.rs` come fa
`check_tipi_scalari`), nomi di membro validi e unici dopo gli include, `bit` 0-15 senza doppioni, `includi`
risolvibili e senza cicli, descrizioni it **ed** en, `immagine` che esiste accanto al file e non pesa più di 100 KB.

**Immagini** (richiesta del maintainer): ogni modello ha un'icona presa dal sito **pixsys.net** (la foto del prodotto
della sua pagina), scaricata con `curl` durante il lavoro, ridotta a ~160 px (ImageMagick se c'è, altrimenti così
com'è ma sotto ~60 KB) e salvata accanto al JSON (`pixsys/atr244.png`); campo `"immagine": "atr244.png"`. Servite da
`GET /api/catalogo/dispositivi/<marca>/<file>` (solo estensioni immagine, nessun `..`), con la stessa regola utente →
prodotto. Un modello senza immagine (pagina non trovata) mostra un'icona generica, e lo dico nel resoconto. La fonte di
ogni immagine (URL della pagina) va nel `README.md` della cartella Pixsys.

## 3. L'IDE: «Dal catalogo…» — dispositivi completi, pronti

L'idea del maintainer: configurato il bus, ci si aggiungono **dispositivi completi preconfigurati** — non una lista di
registri da sistemare, ma il dispositivo intero (tipo, variabile, mappature, ordine, timeout) pronto a leggere.
L'icona del prodotto accompagna la voce nel catalogo, nella card del dispositivo e nell'elenco dei dispositivi del bus.

- `ElencoDispositiviModbus`: accanto a «+ Aggiungi dispositivo», **«+ Dal catalogo…»** → modale
  `CatalogoDispositiviModal.tsx`: ricerca, elenco per marca/famiglia (con l'origine «utente» segnata e gli errori dei
  file in fondo), scelta del modello → unit id (`prossimoUnitId`), nome dell'istanza (proposto `atr244_<unit>`,
  controllato con `motivoNomeIstanza` di `tag/istanze.ts`), i **gruppi** di registri da includere con le spunte di
  default, anteprima dei membri. Su un bus RTU, se i parametri seriali del bus differiscono dai default del modello, una
  riga lo dice (non li cambia).
- Puro, `config/sorgenti/daCatalogo.ts`: `daCatalogo(voce, bus, {unit, nome, gruppi}, tipiEsistenti)` →
  `{ tipo: TypeDef, riusaTipo: boolean, tag: TagDef, dispositivo: DispositivoModbus }`. Tipo `pixsys_atr244`
  (dall'id); se esiste già uguale si riusa, se esiste diverso si crea `pixsys_atr244_v<versione>` e lo si dice. Membri
  con tipo, unità, descrizione; il dispositivo esce da `nuovoDispositivo(bus, base)` con `modello:
  "pixsys/atr244@1"`, ordine e timeout della voce, e una mappatura per membro (`tag: atr244_3.pv1`, `formato`,
  `scale`, `bit`, `sola_lettura`).
- Conferma: salva **tipo e variabile subito** (`api.updateTypes` → `api.updateTags`, come «Crea istanza» in
  `TipiTab.tsx:118`), mette il dispositivo nella **bozza** dei Protocolli e apre la sua card; il Salva dei Protocolli
  lo scrive (come ogni altra modifica alle sorgenti). Annullare la bozza lascia tipo e variabile: detto nel manuale.
- La card del dispositivo mostra `modello` (c'è già) con il nome leggibile della voce.

**Varianti MCM260X** (richiesta del maintainer, 04-10-2026): l'MCM260X è sei prodotti, 1AD/2AD/3AD/4AD/5AD/9AD, con
I/O diversi (tabella dei codici d'ordine di pixsys.net); un file per variante, frammenti `_mcm_di`, `_mcm_do`,
`_mcm_analogici`, e 3AD/4AD restringono le word a 8 bit con un registro dello stesso nome. Encoder esclusi: la mappa
non li riporta.

## Documenti

Manuale `06_protocols.md` (catalogo, formato, bit, sola lettura), **HOWTO** nuovo capitolo «aggiungere o correggere
un dispositivo nel catalogo» (dove mettere il file, il formato, gli include, la guardia), CHANGELOG, `NOVITA.yaml`
it/en (entro le 15 voci: si fonde con quella Modbus), piano in `docs/plans/`, STATUS. La mappa Pixsys originale va in
`catalogo/dispositivi/pixsys/README.md` come fonte, con la nota che è da verificare sui manuali dei singoli prodotti.

## Verifica

- Rust: codec `formato`+scala (segno, arrotondamento in scrittura, fuori intervallo), bit lettura e
  leggi-modifica-scrivi su `Finto`, cache per giro (dieci bit = una lettura), `sola_lettura`; `catalogo.rs` su una
  cartella di prova (include risolti, override dell'utente, ciclo, file rotto riportato e non fatale); validatore.
- vitest: `daCatalogo` (tipo riusato/versionato, gruppi, mappature, nomi dei bit), modale (ricerca, scelta, conferma che
  chiama updateTypes → updateTags e mette il dispositivo nella bozza), colonne Formato/Bit.
- `cargo test --workspace`, `pnpm build`, `./scripts/check_static.sh` (con la guardia nuova sui JSON Pixsys).
- Dal vivo: simulatore `pymodbus` con un «ATR244» finto (registri 0-5, 1000-1005 con PV negativa e status word, 2000-
  2004), editor di sviluppo + browser headless: Dal catalogo → ATR244 unit 1 → valori scalati con segno, bit dello
  stato, scrittura di SP1 → registro 2000; progetto di prova cancellato e simulatore fermato alla fine.
