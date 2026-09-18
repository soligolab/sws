# SWS — Current Status

> Session-to-session memory. Leggi all'inizio di ogni sessione, aggiorna alla fine.
>
> Ambienti di test: vedi [docs/TEST_SETUPS.md](docs/TEST_SETUPS.md) (casa, dev server, dispositivi Yocto).
>
> **Pulizia 2026-07-27**: rimossi i task già chiusi e le sezioni di verifica ormai superate; le sessioni mergiate **e** verificate fino al 2026-07-09 sono compresse in «Storico». Il dettaglio integrale resta in `CHANGELOG.md` e nella history git.
>
> **Pulizia 2026-09-06**: le sessioni di luglio e agosto (2026-07-30 → 2026-08-23, comprese le ~76
> voci del blocco «Release 2.1.0») e le sezioni di settembre già superate sono spostate **integrali**
> in [`docs/history/STATUS-2026-07_08.md`](docs/history/STATUS-2026-07_08.md) — una riga ciascuna
> resta in «Storico». Qui vive solo ciò che serve a riprendere il lavoro.

> **⚠️ Seconda riscrittura, 2026-09-09.** I **15 commit dal 7 al 9 settembre** su `main`
> (da `e7b47fc` a `9244bba`, storia vecchia) erano usciti come `pixsysedp <edp@pixsys.net>`
> perché su theobroma nessuno aveva impostato l'identità locale al repo. Su istruzione del
> maintainer sono stati riscritti con `git filter-branch` (autore, committer e
> `Signed-off-by` → `Mauro Soligo <mauro@soligo.net>`), **alberi byte-identici** (verificato
> con `git diff --quiet` vecchio/nuovo), e i tag **`2.6.0`, `2.6.5`, `2.6.6`** sono stati
> ricreati sui commit nuovi con lo stesso messaggio; il tutto **force-pushato**. Corrispondenza
> vecchio → nuovo: `7cf3fd1→c9cec6a` (2.6.0), `14bd6f6→ac8a93e` (2.6.5), `c6b7aa3→bf0901c`
> (2.6.6), `9244bba→0a4a242` (punta prima di Q48). Su theobroma il ramo
> `backup/main-pre-riscrittura-2026-09-09` conserva la storia vecchia. **Sulle altre macchine**
> `session_start.sh` vedrà `main` divergente con albero identico e offrirà il reset, e i tre tag
> vanno ripresi con `git fetch --tags --force` — è esattamente il caso per cui esiste. Da oggi
> lo script controlla anche l'identità git e stampa il rimedio se non è quella giusta.
>
> **⚠️ La storia di git è stata riscritta il 2026-08-31.** Un `git filter-branch` ha
> normalizzato autore e committer di **tutti i 342 commit** precedenti a
> `Mauro Soligo <mauro@soligo.net>` (prima convivevano `pixsysedp <edp@pixsys.net>` e
> `katodo <mauro.soligo@katodo.com>`), e il risultato è stato **force-pushato** su GitHub:
> `main`, i due rami di lavoro e **tutti i tag** portano hash nuovi. I contenuti sono
> byte-identici — verificato con `git diff` fra vecchio e nuovo su commit campione — e la
> coerenza DCO regge (343 commit su 343 con autore e `Signed-off-by` allineati).
>
> Due conseguenze pratiche:
>
> 1. **Ogni hash citato in questo file, in `CHANGELOG.md` e in `docs/` prima del
>    2026-08-31 sera appartiene alla storia vecchia** e non si risolve in un clone fresco.
>    Sono ~76 riferimenti: non sono stati riscritti perché la corrispondenza vecchio→nuovo
>    esiste ancora in `refs/original/` su frodo, e riscriverli tutti a mano introdurrebbe
>    errori peggiori del problema. Le **date** e i **messaggi** restano il modo affidabile di
>    ritrovare un commit.
> 2. 🔴 **Il clone su theobroma è ora una storia divergente.** Ha gli hash vecchi su `main` e
>    su entrambi i rami. Se da lì si pusha qualcosa, la storia vecchia torna su GitHub.
>    Theobroma va trattato come **sola lettura**: per ripartire da quella macchina, ri-clonare.
>
> **Come si rimette in pari una macchina che era ferma da prima** (fatto sull'ufficio il
> 2026-09-02; serve una volta per macchina, e `git pull` da solo **non basta**):
>
> ```bash
> git checkout main
> git log origin/main..main --oneline --stat   # cosa hai solo tu
> ```
>
> Se quel commit aggiunge contenuto che su `origin/main` c'è già — si verifica confrontando
> `git rev-parse main:<file>` con `git rev-parse origin/main:<file>`, e se gli hash coincidono
> è byte per byte lo stesso — è la versione pre-riscrittura dello stesso lavoro e si butta con
> `git reset --hard origin/main`. Se invece è lavoro mai arrivato su origin, **prima**
> `git branch salvataggio-<macchina>-<data>`.
>
> Poi i **tag**, che è la parte che sfugge:
>
> ```bash
> git fetch --tags --force
> ```
>
> Senza `--force` git li **rifiuta** («sovrascriverebbe il tag esistente») e li lascia puntati
> alla storia vecchia: `git describe` e `git show <tag>` mostrerebbero commit che su GitHub non
> esistono più. All'ufficio erano undici. I tag nuovi (`2.4.0` e successivi) passano senza
> `--force`, perché non hanno un omonimo locale — quindi il problema si vede solo sui vecchi, ed
> è facile crederlo risolto.
>
> Restano da guardare, su quella macchina, i rami di lavoro anteriori al 2026-08-31: non danno
> fastidio finché nessuno li tocca, ma un push o un merge da lì rimetterebbe dentro dei doppioni.

## ▶ Riprendere da qui — release 2.9.0 (2026-09-18)

**Versione 2.9.0**: bump nei quattro file e nei due lockfile, sezione `[2.9.0] — 2026-09-18`
tagliata nel `CHANGELOG.md` con sedici voci, tag annotato. Prima della release, su decisione del
maintainer, **`casa-locale` è uscito dal parco template** (`6ab93078`): era l'impianto di casa
sua e l'unico template ancora fuori dalle regole R1/R3 — il debito del parco scende da 6 a **4**
eccezioni, tutte di semplicità. Una copia sta in `~/sws_projects/casa-locale`, la radice di
produzione, dove gli indirizzi `mqtt.example.invalid` vanno rimessi al broker vero.

Una cosa che sarebbe andata persa e non lo è: `casa-locale` era l'unico esempio nel parco di una
sorgente MQTT che **scrive** (`publish_topic`), ed è da lì che l'assistente IA imparava che si
può. Ora quel ruolo lo ha la presa Zigbee di `nebulizzatore-sandokan`, che si legge e si comanda
— `zigbee2mqtt/<dispositivo>/set/state` col valore nudo, che è quello che il runtime pubblica.

**Definition of done su `main`**: 19/19 guardie statiche, `cargo check`, 443 test editor,
`pnpm build`; il maintainer ha collaudato dal vivo in questi tre giorni ogni pezzo grosso della
release (multilingua, Q58 su `s7-demo`, il riflusso, T-71 a casa).

### Cosa resta aperto

1. **Il container**: `./scripts/build_container.sh` lanciato per la 2.9.0 (aarch64); la
   pubblicazione sul registry (`--push`) è una decisione del maintainer, e non è stata fatta.
2. **Le quattro eccezioni** del parco template, tutte R3: i due `demo-items` (4 pagine per 35
   widget), `homeassistant-demo` (62 oggetti), `homeassistant-pro` (la vetrina).
3. **I sette semi** in `docs/plans/README.md`, con `multilingua-residuo` e `immagine-di-boot` come
   i più maturi; identità/utenti e workspace in coda per decisione del maintainer.

## ▶ Riprendere da qui — le domande aperte sono diventate semi di piano (2026-09-18)

Decisione del maintainer, con una regola nuova in `CLAUDE.md` che cambia il modo di lavorare:
**una domanda aperta non diventa più una scheda in `docs/OPEN_QUESTIONS.md`, diventa un file di
piano sintetico** in `docs/plans/` — l'idea, le misure di quel momento, e la frase che quando quel
lavoro comincerà servirà una sessione di plan approfondita. Il file delle domande è **congelato**:
tiene i numeri già assegnati e un rimando per scheda, e `check_documenti.sh` continua a fare i
conti. Non nascono più Q-numeri.

Le quattordici schede vive sono state ricondotte a **sette semi**, spostando il testo parola per
parola (con uno script, non riscrivendo: il travaso a mano è il modo di perdere una riga senza
accorgersene):

| Seme | Da | Stato |
|---|---|---|
| `identita-utenti-istanze` | Q44 + Q54 + Q56 | **in coda** — il lavoro più corposo, dopo tutto il resto |
| `workspace-dei-progetti` | Q60 | **in coda** con il precedente |
| `multilingua-residuo` | Q43 + Q57 | due scelte di prodotto rimaste scoperte |
| `post-bloccata-viewer-lvgl` | Q55 | l'unico difetto vero fra le schede |
| `immagine-di-boot` | Q13 | con l'idea nuova: pagina statica → PNG, e D-Bus al deploy |
| `ros2-robot-come-sorgente` | Q23 | più avanti |
| `mcp-editing-con-ia` | Q26 | più avanti |

**Q58** e **Q59**, le uniche due rimaste con testo proprio, sono state **timbrate e archiviate** in
`docs/history/OPEN_QUESTIONS-chiuse.md` con l'ok esplicito del maintainer (18-09, passo per passo:
verifica sul codice, poi spostamento). Il file vivo è sceso da 301 a 152 righe, tutte rimandi:
12 schede da tre righe più le due tabelle. Q16 e Q53 erano già rimandi.

Il seme dell'immagine di boot merita una riga: contiene le **note D-Bus del maintainer** sul
launcher Pixsys, con la trappola di `PathBuf::push` che fa funzionare un path assoluto per il
motivo sbagliato. Sono la parte da leggere prima di scrivere lo script di deploy.

Aggiornate le skill `riprendi` e `finalizza-giornata`, che mandavano ancora le domande nuove al
file congelato.

## ▶ Riprendere da qui — `docs/plans/` è vuoto: non resta nessun piano di lavoro (2026-09-18)

Chiusi gli ultimi due piani vivi, su decisione del maintainer. In `docs/plans/` resta **solo** la
scheda-piano di Q16, che lui ha chiesto di tenere in sospeso: il decoder raster per `image` su
LVGL si costruisce se emerge un bisogno reale, non prima.

### `start_editor.sh` è la corsa di produzione (`d3d84e89`)

Punto 1 del piano workspace, e nasce da un'osservazione sua: creando un progetto l'IDE proponeva
`/home/ut1/sws/.run-editor/projects`, dentro il checkout. La decisione di tenere i progetti fuori
dal repo c'era dal 09-09 — il default del binario è `~/sws_projects` — ma questo script la
scavalcava, quindi su questa macchina non entrava mai in gioco. «L'ho sempre inteso come run di
produzione, come fossi il cliente.»

Ora lo script **non calcola la radice**: passa `--projects-root` *solo* se `SWS_PROJECTS_ROOT` è
impostata, altrimenti non lo passa affatto e decide il runtime. La radice ha un posto solo da cui
venire invece di due che possono divergere. Il banner stampa la radice **e da dove viene**, perché
un percorso implicito era metà del problema. `start_editor_develop.sh` fa la corsa di sviluppo con
una variabile e un `exec` — non una copia, che in un mese diverge.

`start_runtime.sh` **non** è stato toccato: simula un dispositivo, dove la radice la decide chi
installa, ed è una decisione a sé.

### I due piani chiusi

- **workspace-cartella-progetti** → archiviato. Parte 1 fatta (sopra); la parte 2 è diventata
  **Q60**, perché il maintainer ha detto che «la gestione dei workspace merita un plan dedicato
  per strutturarla a dovere». La scheda porta con sé le misure già fatte, che sono la parte utile:
  `ProjectRegistry` è metà del meccanismo già costruita ma un livello sotto (tiene i *progetti*,
  non le radici), e c'è una contraddizione da sciogliere — quel file dichiara di coprire progetti
  «esterni», ma da **Q46** non è più possibile crearli. Deciso già: alla prima apertura la scelta
  è **proposta e non bloccante**, e vale solo per l'IDE.
- **casamauro-arricchimento-demo** → archiviato come **superato**. La premessa non è più vera:
  CasaMauro non esiste più su questa macchina (verificato — `.run-editor/projects/` contiene solo
  `.ambiente`, `known_projects.json` è vuoto, niente sul disco), e le feature F2-F6 che il piano
  voleva far esercitare le esercitano ormai i template del parco, rivisti tutti fra il 14 e il 17.

### Cosa resta aperto

1. **14 domande** in `docs/OPEN_QUESTIONS.md`, fra cui le due nuove: **Q59** (la prima metà
   risolta oggi) e **Q60** (i workspace, da cui nascerà il piano dedicato).
3. **Le sei eccezioni** alle regole del parco template.
4. **La release 2.9.0**, quando si vorrà.

## ▶ Riprendere da qui — casa e ufficio riconciliati: Q58 chiusa, Q59 e il seme workspace (2026-09-18)

Due sessioni in parallelo sullo stesso `main`, e questa volta si sono incontrate senza perdite.
L'ufficio aveva tre commit non pushati, casa ne aveva cinque su `origin`: **rebase dei tre sopra
i cinque**, due conflitti, entrambi di sola documentazione.

### Cosa veniva dall'ufficio (17-09, pushato il 18)

| commit | cosa |
|---|---|
| `6887afe7` | `feat(Q58)` — un progetto nato da un template non si collega prima che qualcuno guardi dove |
| `c5f00288` | `docs(Q59)` — la cartella dei progetti: il default c'è, ma gli script lo scavalcano |
| `405568d8` | `docs(piano)` — il seme su workspace e cartella progetti |

**Q58** è realizzata e **collaudata dal vivo dal maintainer** su un progetto creato da `s7-demo`:
il flag `Project::sorgenti_da_rivedere`, acceso dalla creazione da template e spento dal
salvataggio della scheda Sorgenti, impedisce al runtime di collegarsi a indirizzi che nessuno ha
ancora guardato. Per progetto e non per sorgente — la scelta e il perché stanno nella scheda.
**Resta solo il timbro** del campo `Decided`, che non tocco io (regola 3).

**Q59** è nata da un'osservazione del maintainer — l'IDE gli proponeva
`/home/ut1/sws/.run-editor/projects`, dentro il checkout — e si è allargata quando ha chiarito
che `start_editor.sh` l'ha sempre inteso come **run di produzione**. Il seme del piano è in
`docs/archive/2026-09-17-workspace-cartella-progetti.md`.

### I due conflitti, e come sono stati sciolti

- **`CHANGELOG.md`**: tre voci nuove nella stessa sezione, nessuna in contrasto. Restano tutte e
  tre, quelle di casa per prime perché erano già su `origin`.
- **`docs/plans/README.md`**: casa ha archiviato il piano F7 (riga tolta), l'ufficio aveva
  aggiunto la riga del piano workspace **sopra** quella di F7. Risolto tenendo la riga nuova e
  non facendo tornare quella archiviata — un merge testuale ingenuo l'avrebbe resuscitata.

### Un incrocio fra le due sessioni che vale la pena notare

Il `fix(homeassistant)` di casa dice che il difetto «diventa visibile su **ogni** apertura di
`homeassistant-demo`/`-pro` da template, proprio perché R5 ha appena reso gli indirizzi
placeholder non raggiungibili». È vero, ed è anche il motivo per cui Q58 e quel fix si completano:
con Q58 le sorgenti di un progetto appena creato **non partono affatto**, quindi il caso non si
presenta finché l'utente non conferma; ma appena conferma con un indirizzo ancora sbagliato,
torna — e lì il fix di casa è quello che gli evita di leggere `false` su un tag `float`.

### Cosa resta aperto

1. **Le sei eccezioni** alle regole del parco template (`check_templates.sh` le conta a ogni giro).
2. ~~Il timbro di Q58~~ — **fatto il 18-09**, archiviata con Q59. Restano le decisioni del seme workspace.
3. **La release 2.9.0**: `[Unreleased]` ha T-71, la guardia sulle release, le regole del parco,
   F7 parte B, i difetti del 17 e del 18, e Q58.

## ▶ Riprendere da qui — F7 chiuso, collaudo del riflusso fatto, due difetti trovati e corretti (2026-09-17/18)

Sessione di continuazione: chiuso il piano F7 residui minori (entrambe le parti — vedi
`docs/archive/2026-09-12-f7-residui-minori.md`), poi fatto il collaudo a schermo del riflusso
1280×800 che la sessione precedente aveva lasciato aperto (punto 1 sotto). Due difetti reali
trovati, nessuno dei due era quello ipotizzato ("bande laterali vuote" su `homeassistant-pro`):

- **`fix(homeassistant-pro)` (`20a8b628`)** — nel riquadro PERIMETRO & MOVIMENTO della pagina
  Sicurezza & Ctrl, tre etichette ("Veicolo", "Piazzale", "Mauro a casa") stavano quasi alla
  stessa coordinata Y di "Persona esterna", illeggibili una sopra l'altra — copia-incolla senza
  incrementare Y. Riscalate, riquadro allargato (181→275px).
- **`fix(homeassistant)` (`97ae585`)** — qualunque tag alimentato da una sorgente `homeassistant`
  irraggiungibile mostrava `false` invece di un valore del proprio tipo (`sole.elevazione`,
  `float`, leggeva `{"value":false}`). Il plugin scriveva sempre `TagValue::Bool(false)` sul
  bail-out, sovrascrivendo il default corretto già seminato da `populate_tags`. `sws-plugin-mqtt`
  era già stato corretto il 16-09 con lo stesso identico problema (vedi il commento di
  `marca_qualita` in `sws-core::tag`) — quel giro non aveva incluso `homeassistant`. Ora usa
  `marca_qualita` anche qui. Diventa visibile su **ogni** apertura di `homeassistant-demo`/`-pro`
  da template, proprio perché R5 ha appena reso gli indirizzi placeholder non raggiungibili per
  definizione — non un difetto raro.

Entrambi verificati dal vivo su runtime di scarto, gate verde. Un'osservazione non affrontata:
`cargo fmt --all -- --check` è rosso su `sws-lvgl-viewer/src/lvgl_render.rs` (drift preesistente,
non nei file toccati da nessuno dei due fix di oggi — probabilmente sfuggito all'ultimo giro di
formattazione della sessione precedente). Non l'ho toccato per non mescolare un ramo con l'altro.

> **Risolto dalla riconciliazione del 18-09**: quel drift era nel lavoro dell'ufficio non ancora
> pushato (il `format_value` riscritto), e il `cargo fmt --all` di quel ramo l'ha sistemato.
> Dopo il rebase `cargo fmt --all -- --check` è verde. Era un sintomo della divergenza, non un
> debito.

## ▶ Riprendere da qui — le regole del parco template, e il parco che le rispetta (2026-09-17)

Quattro squash merge su `main`, i due rami (`feat/regole-template` e l'annidato
`fix/modifica-testo-tradotto`) eliminati dopo il confronto degli alberi:

| commit | cosa |
|---|---|
| `c3aed814` | `feat(template)` — le cinque regole diventano guardie, e il Passo 5 le applica ai sei template fermi al 28-08 |
| `6864d632` | `fix(formato)` — il numero perdeva la sua unità, in due modi diversi |
| `285fc849` | `feat(template)` — R2 e R5 a zero: ogni template completo in tre lingue |
| `3b959745` | `fix(i18n)` — modificare un testo tradotto coniava una chiave nuova e vuota |

**Le regole** stanno in `examples/templates/README.md`, il referto della discussione (misure,
alternative scartate, le quattro decisioni del maintainer) in
[`docs/archive/2026-09-17-regole-dei-template.md`](docs/archive/2026-09-17-regole-dei-template.md).
Sono verificate da `check_templates.sh`, dentro `check_static.sh`.

**Il debito dichiarato del parco è passato da 30 eccezioni a 6**, tutte di forma:

| Template | Regola | Perché |
|---|---|---|
| `casa-locale` | R1, R3 | 800×680, 5 pagine, 94 oggetti nella più piena — riflusso e sfoltimento si fanno dal **suo** piano (`2026-09-12-casamauro-arricchimento-demo.md`), non di straforo |
| `demo-items-web` / `-lvgl` | R3 | 4 pagine, perché i tipi di widget sono 35 |
| `homeassistant-demo` | R3 | 62 oggetti nella panoramica, due sopra il tetto |
| `homeassistant-pro` | R3 | la vetrina del «cosa si può fare» — eccezione decisa dal maintainer |

**R2 e R5 sono a zero.** Ogni testo visibile di ogni template passa dalla tabella lingue, ogni
template dichiara `it/en/es` con le tre colonne piene (~660 voci, scritte a mano), e nessuno porta
l'indirizzo o le credenziali di una rete vera.

### Cosa resta aperto

1. ~~**Il collaudo a schermo del riflusso.**~~ — **fatto il 17/18-09-2026**, vedi la voce più
   recente in cima al file: due difetti trovati e corretti, nessuno era la voce "bande laterali
   vuote" ipotizzata qui.
2. **Le sei eccezioni**, sopra.
3. **La release 2.9.0**, quando si vorrà: `[Unreleased]` ha già dentro T-71, la guardia sulle
   release, le regole del parco, i tre difetti di ieri e i due di oggi.
4. ~~**`2.7.3` non è mai stata taggata**~~ — **fatto**, vedi `chore: la 2.7.3 ha il suo tag`
   (`e2474b1b`).

### Una cosa imparata, che vale più della sessione

La 2.8.0 aveva incontrato metà del difetto di formattazione e l'aveva chiuso dalla parte
sbagliata, scrivendolo a chiare lettere nel CHANGELOG: «*Nessuna modifica al motore di
formattazione: il difetto era nel contenuto dei template, non nel codice*». Era nel codice, in
**tutti e due** i motori, e sistemare i tre template l'aveva soltanto nascosto — fino a che una
regola non ha costretto a guardare tutti i template insieme. Le regole servono anche a questo:
non a fare ordine, ma a far emergere ciò che un caso singolo lascia passare.

## ▶ Riprendere da qui — T-71 chiuso: emoji vere su LVGL + selettore nell'editor (2026-09-16)

Piano `docs/plans/2026-09-16-T71-selettore-caratteri.md` concluso e archiviato. Tre fasi, un
ramo alla volta:

- **Fase B — font emoji su LVGL** (`c8a53a01`): `lv_font_t.fallback` (risolto ricorsivamente da
  LVGL) aggancia Noto Emoji monocromo/outline a DejaVu — non serve un font unico. Font
  vendorizzato in `sws-runtime/crates/sws-lvgl-viewer/assets/fonts/` (licenza OFL, ~2 MB, non le
  "decine di MB" temute — quella stima era per la variante a colori, che qui non renderebbe
  comunque: LVGL/FreeType disegna contorni). Imbarcato nel container via `build_container.sh` +
  `Containerfile.aarch64`. Verificato dal vivo via `sws-lvgl-viewer --istantanea` su runtime di
  scarto: 🏠 🔐 🔧 💡 disegnati in fallback su DejaVu.
- **Fase A — protezione dalla traduzione automatica** (`75dc22aa`): `sws-core::traduzione`
  estesa a trattare un carattere `Emoji=YES` (via `unicode-properties`, nuova dipendenza) come
  un `Pezzo::Segnaposto`, stesso meccanismo già in uso per i segnaposto di formato. Cifre ASCII e
  `#`/`*` escluse di proposito (sono `Emoji=YES` solo per le sequenze keycap).
- **Fase C — selettore nell'editor** (`3d31756`): catalogo curato a 5 categorie
  (`sws-editor/src/i18n/catalogoCaratteri.ts` — energia/allarmi/stati/misure/altro, tutti
  garantiti dalla Fase B), `CharacterPickerModal` sullo schema di `SymbolGallery`/
  `SymbolPickerModal`, bottone su `CampoTestoTradotto` che inserisce alla posizione del cursore.
  Verificato dal vivo: 🔐Testo🏠 inserito correttamente sia in testa sia in coda.

Gate verde a ogni fase: `cargo check/test/clippy/fmt --workspace`, `pnpm test` 414/414, `tsc`,
`lint`, `pnpm build`, `check_static.sh` 18/18.

## ▶ Riprendere da qui — release 2.8.0: multilingua su `main`, tag e container fatti (2026-09-16)

**Quattro squash merge su `main`**, in quest'ordine, e i due rami (`feat/multilingua` e il suo
annidato `fix/ide-non-comanda-impianto`) sono stati eliminati dopo aver verificato che
`main^{tree}` coincidesse con l'albero del ramo:

| commit | cosa |
|---|---|
| `1c8eda07` | `feat(i18n)` — il multilingua di progetto, otto fasi del piano del 15-09 |
| `413fb8eb` | `fix(ide)` — l'IDE apriva un progetto e governava l'impianto |
| `26e5686b` | `fix(allarmi)` — il runtime inventava uno zero e poi ci credeva |
| `48d01aee` | `feat(editor)` — 16:10 fra i rapporti standard, e i segnaposti che non si perdono |

Erano tre nel piano concordato; sono quattro perché 16:10 e l'ultima correzione della traduzione
sono nati **dopo** i due fix, e riordinarli avrebbe prodotto commit intermedi che non
compilavano. Ogni commit è un pezzo coerente della sequenza del ramo, e l'albero finale è
identico.

**Versione portata a 2.8.0** (`sws-runtime/Cargo.toml`, i due crate con Cargo.toml proprio,
`sws-editor/package.json`, i due lockfile) e sezione `[2.8.0]` tagliata nel `CHANGELOG.md`.
Minor e non patch: il multilingua è una funzionalità nuova, non una correzione.

**Definition of done soddisfatta su `main`**: `cargo clippy --workspace -D warnings` verde,
26 suite Rust verdi, `pnpm test` 406 verdi, `pnpm build` verde, `./scripts/check_static.sh`
18/18 — e il maintainer ha confermato dal vivo che la traduzione multilingua funziona («ora
funziona», 16-09).

Tag annotato **`2.8.0`** creato e pushato con `main` (skill `finalizza-giornata`).

### Cosa manca per chiudere la release

1. **Il container aarch64 è costruito**: `dist/sws-runtime-2.8.0-aarch64-image.tar.gz`, 142 MB,
   immagine `sws-runtime:2.8.0-arm64`. **La pubblicazione sul registry (`--push` verso
   `ghcr.io/soligolab/sws-runtime`) NON è stata fatta**: tocca i dispositivi che si aggiornano da
   lì, ed è una decisione del maintainer. Manca anche l'immagine x86_64
   (`build_containers_all.sh` le fa entrambe).

   *Attenzione al contenuto*: l'archivio è stato costruito da `0b4426dd`, cioè **prima** che
   arrivasse T-71 (le emoji su LVGL e il selettore). Se serve un container con dentro anche
   quello, va rifatto.
2. **`2.7.3` non è mai stato taggato**: la sezione esiste nel `CHANGELOG.md` dal 12-09 e la
   versione era in `Cargo.toml`, ma i tag si fermano a `2.7.2`. Non l'ho aggiunto
   retroattivamente: va deciso se recuperarlo o lasciarlo come release solo di changelog.
3. **`origin/feat/multilingua` è ancora vivo sul remoto.** Non porta niente che non sia in `main`
   — verificato per contenuto e per patch-id — ma va cancellato, e non l'ho fatto da solo.

### Lavoro dichiarato e non iniziato

- **Le regole dei template**, che il maintainer vuole definire *prima* di implementare: 16:10 a
  1280×800 (ora è il default dell'IDE, quindi la regola è già applicabile), almeno tre lingue
  (it/en/es), template semplici, un tipo di risorsa + casi d'uso realistici. A queste ne ho
  proposta una quinta, che nasce da un difetto vero visto in questa sessione: **un template non
  deve portare indirizzi o credenziali di un impianto reale** — `nebulizzatore-sandokan` porta
  `192.168.1.6`, e aprire un progetto da quel template ha riempito il log di 1950 righe di
  «connection refused». È l'unica delle cinque che riguarda la sicurezza e non la forma, quindi è
  registrata come **Q58** in `docs/OPEN_QUESTIONS.md` e non solo qui.
- **Passo 5 della revisione template** (i sei template fermi al 28-08).

*(T-71, il selettore di caratteri speciali, era in questo elenco: il maintainer l'ha chiuso la
notte fra il 16 e il 17 lavorando da casa — vedi la scheda in cima.)*

## ▶ Riprendere da qui — skill finalizza-giornata, sessione chiusa e pushata (2026-09-16)

Aggiunta `.claude/skills/finalizza-giornata/SKILL.md` (`f136fbe`): chiude la giornata dove
`/riprendi` la lascia aperta — verifica niente rami aperti e niente lavoro a metà, *definition
of done* completa, riepilogo in `STATUS.md`, `CHANGELOG.md`, commit dei meta file e **push**.
L'invocazione stessa vale come l'istruzione esplicita richiesta dalla regola 1 di `CLAUDE.md`
per il push di quella sessione — non è un'abitudine automatica, la prossima sessione richiede
una nuova invocazione.

Con questa skill è stata chiusa la sessione odierna: tutto il lavoro sotto (revisione template,
Passi 1-3, e prima ancora T-56 collaudato/archiviato) era già mergiato su `main` ma non
pushato — ora è su `origin/main`.

**Il lavoro sostanziale da riprendere resta quello descritto sotto**: Passo 5 della revisione
template (i sei template fermi al 28-08), non ancora iniziato — il maintainer non ha ancora dato
il via libera a proseguire.

## ▶ Riprendere da qui — revisione template, Passi 1-3 fatti (2026-09-16)

Ripreso il piano `docs/archive/2026-09-14-revisione-template.md`. Fatti i primi tre passi,
ognuno collaudato dal vivo e mergiato separatamente:

**Passo 1 — verità dei documenti di licenza** (`3b08bc5`): `casa-locale/CREDITS.md`
riscritto (7 degli 8 SVG elencati non esistevano più, diventati builtin con Q40); rimosso
`solar-power-variant.svg`, orfano non referenziato. Il maintainer ha confermato che i sette
ridisegni builtin non sono opere derivate — l'attribuzione MDI non serve più, scritto in
`ATTRIBUTION.md`.

**Passo 2 — un ruolo dichiarato per ognuno** (`701b59f`): README.md per cartella (scelta del
maintainer sul meccanismo, non un campo `meta:`) su tutti e undici i template — quattro ruoli
(inventario, banco di prova di protocollo, banco di prova di una feature — quarto ruolo non
previsto dal piano, per `grid-playground` — applicazione realistica), ognuno col proprio
metro di giudizio.

**Passo 3 — le funzioni senza vetrina**, tutte e quattro:
- `recipes:` (`c252b5f`) — due ricette nei gemelli demo-items, `recipe_panel` non è più vuoto.
- `min_role` (`4a9627a`) — homeassistant-demo, luce esterna a Supervisor+.
- waypoint (`643166f`) — nebulizzatore-sandokan, pompa→serbatoio con flusso animato.
- `target:` (`153f1b6`) — esplicito su demo-items-web e nebulizzatore-sandokan (entrambi
  `web`, nessun cambio di comportamento — LVGL non collaudato dal vivo di recente, non
  passato a nessun template reale).

**Trovati e corretti per strada**, applicando il metro di ogni ruolo:
- `enip-demo`/`s7-demo` promettevano "write-back" senza un controllo scrivibile in pagina —
  aggiunto (setpoint + checkbox). `sparkplug-demo` aveva lo stesso gap senza la promessa
  esplicita, corretto per coerenza.
- `opcua-demo`: una tabella di 24 `text` posizionati a mano sostituita da un solo widget
  `table`.
- Difetto di formattazione pre-esistente: `format: "testo {value} testo"` senza specifica
  decimale (`{value:.Nf}`) perde il testo attorno e mostra solo il numero grezzo — capitava in
  nebulizzatore-sandokan (5 readout), grid-playground e opcua-demo (1 ciascuno), corretti
  tutti e tre.
- Su indicazione del maintainer, `nebulizzatore-sandokan` è stato ridisegnato da 900×920
  (verticale) a 1280×600 (i pannelli target sono landscape a quella risoluzione) — i tre
  trend impilati sono ora affiancati.

Gate verde a ogni passo: `cargo check/test`, `pnpm build/test`, `check_static.sh` 17/17
(incluso `check_templates.sh`/`check_demo_templates.sh`), collaudo dal vivo via Playwright su
runtime di scarto per ogni modifica visibile.

**Resta il Passo 5**: i sei template fermi al 28-08 (`enip`/`s7`/`sparkplug`/`opcua-demo`, i
due `homeassistant`) — guardarli uno per uno col metro del passo 2 e decidere per ognuno:
aggiornare, lasciare com'è dichiarando perché, o togliere.

## ▶ Riprendere da qui — T-56 collaudato a fondo e archiviato (2026-09-15)

Ripreso il piano T-56 (i due pannelli dell'editor) per il collaudo a fondo che mancava.
Automatico verde (`pnpm test` 39 file/362 test, `tsc`, `lint`, `build`, `check_static.sh`
17/17). A mano: un giro guidato via Playwright su un IDE di scarto (istanza 2, porta 8462,
terminata a fine collaudo) — sei viste a sinistra con persistenza al **ricaricamento reale**
della pagina (non solo smontaggio/rimontaggio come nel test unitario), sezioni canoniche
verificate su `rect`/`text`/`trend`/`grid`/`symbol`, selezione multipla e multi-tipo con gli
stessi nomi di sezione, tema chiaro/scuro verificato **a livello di pixel** (screenshot da
soli ingannevoli: il canvas del progetto è scuro di suo e domina l'area, la chrome
dell'editor passa davvero da bianco a blu-grigio scuro), larghezza pannelli regolabile e
ricordata dopo un reload vero. Nessun difetto trovato. Piano spostato in `docs/archive/`.
## ▶ Fatto — T-71: un selettore di caratteri speciali per i campi di testo (2026-09-15, chiuso il 16-09)

**Richiesta del maintainer**, mentre collaudava il multilingua: nelle stringhe compaiono spesso
caratteri come 🏠 ☀ ⚡ 🔐, e un utente inesperto deve poterli mettere **senza importare
un'immagine**. Serve un selettore agganciato ai campi di testo.

### Il fatto che decide la forma della funzione, misurato il 15-09-2026

Il pannello LVGL disegna con **DejaVu Sans** (`lvgl_font.rs:37-42`). Leggendo la sua tabella dei
caratteri, dei quattro esempi del maintainer:

| Carattere | Codice | Sul pannello |
|---|---|---|
| ☀ sole | `U+2600` | **si vede** |
| ⚡ fulmine | `U+26A1` | **si vede** |
| 🏠 casa | `U+1F3E0` | **non si vede** |
| 🔐 lucchetto | `U+1F510` | **non si vede** |

Il confine non è «emoji sì / emoji no»: è il **Piano Multilingue di Base**. I simboli dei blocchi
`U+2600`–`U+27BF` (☀ ⚠ ⚙ → ■ …) ci sono; le emoji vere, da `U+1F300` in su, no. E
**LVGL senza glifo non disegna niente** — non un quadratino, non un punto interrogativo: il vuoto,
più un avviso a ogni ridisegno (Q24).

Quindi un selettore ingenuo sarebbe una **trappola**: il progettista sceglie la casetta, la vede
benissimo nell'IDE — il browser usa i font di sistema, che le emoji ce l'hanno — e sul pannello
in campo non compare niente. È la stessa forma di difetto che questa settimana è passata sette
volte: si vede solo davanti al cliente.

### Cosa deve fare il selettore, di conseguenza

1. **Offrire per primi i caratteri che il pannello sa disegnare**, raggruppati per uso (stati,
   allarmi, energia, frecce, misure) invece che per blocco Unicode, che a un utente inesperto non
   dice niente.
2. **Dire a colpo d'occhio quali NON arriveranno sul pannello**, e perché — non nasconderli: su
   un progetto `target: web` funzionano, ed è metà dei progetti.
3. Attaccarsi **a tutti i campi di testo**, che dalla Fase 3 passano già da un imbuto solo
   (`textInput` in `EditorShell.tsx` → `CampoTestoTradotto`): il punto d'innesto esiste già.
4. Tenere conto che dalla Fase 3 quel testo finisce **nella tabella lingue**: un carattere scelto
   lì diventa parte del valore tradotto, e la traduzione automatica non deve mangiarselo — lo
   stesso problema dei segnaposti di formato, già risolto in `sws_core::traduzione`.

### Misurato il 16-09-2026, chiudendo la Fase 7 del multilingua

I template contengono **18 emoji distinte** che il pannello **non disegna**:
🌀 🌙 🌡 🍳 🎨 🏠 💡 💧 📈 🔋 🔌 🔍 🔐 🔒 🗂 🤖 🦟 🪟. Non è un'ipotesi sul futuro
selettore: è ciò che i template mostrano **oggi** su un vetro LVGL — cioè niente,
in quei punti. Sul browser si vedono tutte, ed è per questo che non se n'è mai
accorto nessuno.

### La domanda da fare al maintainer prima di scrivere codice

Se le emoji vere servono davvero sul **pannello**, non basta un selettore: serve un secondo font
sul dispositivo (Noto Emoji o simile, decine di MB) e bisogna verificare il limite
`lv_freetype_init(8, 8, …)` sulle facce aperte. È un lavoro a sé, e va deciso prima — non
scoperto a selettore fatto.

## ▶ Riprendere da qui — multilingua di progetto, fasi 0-4 su ramo (2026-09-15)

⚠️ **Il lavoro NON è su `main`.** Sta sul ramo **`feat/multilingua`**, 12 commit, pushato su
origin. A casa: `git fetch && git checkout feat/multilingua` **prima** di qualunque cosa, o
`/riprendi` guarderà un `main` che non contiene niente di tutto questo.

Piano: `docs/archive/2026-09-15-multilingua-di-progetto.md`, otto fasi. **Fatte la 0, 1, 2, 3 e 4.**

### Perché questo lavoro è nato

Richiesta del maintainer: il testo digitato deve diventare da solo una voce della tabella lingue,
con proposta di riuso, traduzione automatica e bandiere — e deve coprire **anche allarmi, Telegram
e script**. La premessa andava corretta: la tabella lingue **esisteva già** (T-40). Il lavoro non
era costruirla, era **chiudere i buchi**, e i buchi erano molti più di quanti il piano prevedesse.

### Le divergenze trovate, tutte reali e misurate

Sette difetti, nessuno ipotizzato. Sei riguardavano lo **stesso progetto disegnato da due motori
che non si erano mai confrontati**:

1. Una chiave senza traduzioni mostrava sul web **il nome nudo della chiave** come testo vero.
2. `{{a b}}` era prosa sul web e un token vero su LVGL.
3. Il pannello traduceva **6 campi su 16**, e il commento del codice negava che li disegnasse —
   falso per sette di essi.
4. I token dentro **griglie e faceplate** non si risolvevano affatto sul web (su LVGL sì).
5. Gli **allarmi** erano tradotti sul web e grezzi sul pannello; lo **storico** grezzo su entrambi.
6. **Telegram ed email** mandavano il token grezzo, dentro un template con le etichette cablate in
   italiano.
7. `TagDef.unit` non si sarebbe mai risolta: la localizzazione girava **prima** di
   `applyTagDefaults`.

### Cosa c'è ora

- **Una sola tabella di casi** (`tests/fixtures/risoluzione-token.json`) letta da **tre**
  risolutori: web, viewer LVGL e `sws-core` (quest'ultimo nuovo, per le notifiche).
- **`scripts/check_i18n_parita.sh`** (18ª guardia statica): confronta gli insiemi di campi
  tradotti dai due motori estraendoli **dal codice**, conta il debito dichiarato, e verifica che il
  contesto React della lingua sia **montato davvero** — lezione di `GruppoAttivo`, 11-09.
- **Fase 3**: digiti «Avvio pompa», nel progetto va `{{t0001}}`. Si scrive alla conferma e non a
  ogni tasto; il riuso si **propone** dicendo quante volte la chiave è già usata; `prossimaChiave`
  non riempie i buchi lasciati dalle righe cancellate.
- **Fase 4**: quattro fornitori dietro un'astrazione — MyMemory (**senza chiave**, il default),
  LibreTranslate (ospitabile in casa), Google, e l'assistente IA già configurato. I segnaposti di
  formato escono dal testo e rientrano identici; se il fornitore ne perde uno la riga si
  **scarta**. Una traduzione **umana** non si sovrascrive mai (`LangEntry.auto`). Endpoint
  **solo-IDE**, 404 altrove.
- Selettore della lingua di anteprima **nella barra dell'editor**: serviva alla rilettura umana, e
  prima stava sepolto in un'altra scheda.

### Il collaudo dal vivo del maintainer ha trovato quattro difetti, tutti corretti

1. **415 Unsupported Media Type** alla prima traduzione: mandavo JSON senza dichiararlo. Ora
   `request` mette il `Content-Type` da sé quando manca.
2. **La barra «il progetto sul runtime è cambiato»** compariva inserendo oggetti, e «Ricarica»
   faceva **perdere il lavoro non salvato**. Causa: la scheda Lingue era l'unica di ConfigView a
   non chiamare `markSaveOk()`, e il campo della Fase 3 ha ereditato il buco — che con una
   scrittura per ogni etichetta digitata è diventato costante.
3. **Una colonna si svuotava** traducendo verso due lingue di fila: ricaricavo il progetto nello
   store ma non la copia locale della scheda, e il salvataggio successivo rimandava la tabella
   vecchia.
4. **Nessun segnale durante l'attesa**: una richiesta di rete per voce, in fila. Ora dice prima
   quante ne manda e quanto può durare.

### Da fare, in ordine

- **Fase 5**: `bg_image` letto anche da LVGL (è la decisione del maintainer per le bandiere; il
  campo è dichiarato in `model.rs:488` e non viene mai letto); la lingua scelta sul pannello **non
  sopravvive al riavvio** (`SharedLang` riparte dal default); le intestazioni cablate in italiano
  del viewer operatore (`"Messaggio"`, `"Ora"`, `"Conf."`, `"sì"`/`"no"`, `"DATI"`, `"N/D"`,
  `"altro"`) — sono una **terza categoria**, né progetto né i18n dell'editor, e LVGL non ha
  nessun asse i18n.
- **Fase 6**: `tr()` esposto agli script Python; i valori dei tag `string` e i toast risolti.
- **Fase 7**: i template — migrazione degli slug a id opachi, allarmi tokenizzati, e
  `docs/manual/15_multilingua.md` che dichiara una conformità IT/EN che tre template non hanno.
- Poi la **revisione del parco template** (`docs/archive/2026-09-14-revisione-template.md`), che
  aspetta ancora una risposta del maintainer sull'attribuzione MDI.

### Due cose aperte che non ho deciso io

- **Q57** (nuova): una notifica non ha uno schermo, quindi la sua lingua sta nel progetto — una
  sola. Destinatari misti (manutenzione locale + costruttore italiano) restano scoperti.
- **Q43** aggiornata con ciò che è stato realizzato, **non chiusa**: restano quale fornitore sia
  quello giusto per un impianto consegnato, e se una traduzione automatica debba poter raggiungere
  un dispositivo in servizio senza che una persona l'abbia riletta.
- Fuori tema ma emerso qui: **«Ricarica» scarta il lavoro non salvato**. Ora la barra compare solo
  per cambi veri, ma quando comparirà per un deploy esterno il pulsante farà ancora la stessa cosa.

## ▶ Riprendere da qui — template di collaudo T-69 pronto, terzo difetto trovato e corretto (2026-09-15)

Template diagnostico `examples/templates/t69-collaudo/` (`4136973`), due pagine per esercitare
a mano tutte e cinque le fasi di T-69: generatore nativo (rampa/triangolo/quadra) con le
istruzioni per verificare il rifiuto in scrittura via curl, rampa manuale con
`delta_ms()+state` affiancata al generatore nativo, `interval_ms` che vince su `interval_s`,
`now_ms()`/`uptime_ms()`, `functions.run` + pulsante + `POST /api/script/run/:name` sullo
stesso contatore, il divieto di `functions.run` da dentro una funzione, la sonda
`send_telegram`.

Costruendolo sono emersi altri due difetti (il terzo e il quarto della giornata, dopo
`write_tag` in Fase D e l'identità `fn:<nome>` di ieri):

3. **`ScriptTrigger::Interval.interval_s` non aveva un default**: uno script che voleva SOLO
   `interval_ms` era comunque costretto a scrivere anche `interval_s` — l'opposto di
   "additivo". Default a 1: il progetto non caricava affatto senza questo.
4. **Più a fondo — `functions.run` eseguiva sul motore SBAGLIATO**: ogni script globale ha un
   Engine Python privato (`GlobalScriptSupervisor::start`), e `functions.run` eseguiva la
   funzione chiamata su QUEL motore, non su quello canonico (`AppState.py`, usato da un
   pulsante/HTTP). Lo stato non era mai davvero condiviso fra le due vie nonostante il
   commento del codice lo promettesse fin dalla Fase C, e il divieto "functions.run da dentro
   una funzione" non scattava se il chiamante aveva un registro configurato (la funzione lo
   ereditava per clonazione). Scoperto dal vivo: un pulsante e uno script che incrementavano
   lo stesso contatore non tornavano mai lo stesso numero. Corretto con un nuovo campo
   `Engine::functions_engine` che instrada sempre `functions.run` verso il motore canonico;
   due nuovi test che replicano la topologia reale (due Engine distinti, non uno).

Verificato dal vivo sul template stesso, su un runtime di scarto: pulsante+script sullo
stesso contatore (2+10=12, esatto), divieto di ricorsione col messaggio giusto, rifiuto in
scrittura sul generatore, cadenza `interval_ms` confermata a ~100ms nonostante `interval_s:10`
presente nello stesso trigger. Gate verde: cargo check/test(39 sws-core, 16 sws-pyscript)/
clippy/fmt --workspace, pnpm build/test, 17/17 guardie statiche incluso `check_templates.sh`
e `check_synoptic_schema` (rigenerato).

**T-69 resta chiuso** (tutte e cinque le fasi su `main`) — questi sono difetti trovati e
corretti DOPO la chiusura, mentre si costruiva lo strumento per collaudarlo in ufficio.

## ▶ Riprendere da qui — bug post-chiusura in `functions.run` corretto, template di collaudo in corso (2026-09-15)

Costruendo il template dedicato a collaudare T-69 in ufficio, trovato un secondo difetto
(dopo quello di `write_tag` in Fase D): `functions.run` (Fase C) usava l'identità `fn:<nome>`
per `delta_ms()`/`state`, mentre `POST /api/script/run/:name` (il percorso di un pulsante)
passa il nome nudo — due chiavi diverse nella stessa mappa `states`, nonostante il commento
del codice promettesse "lo stesso schema". Una funzione richiamata sia da un pulsante sia da
uno script globale (`functions.run`) finiva su due contatori indipendenti invece di uno
condiviso. Corretto (`eccbee1`): tolto il prefisso `fn:`, nuovo test che chiama
`functions.run` e poi `execute_with_args` con lo stesso nome nudo e verifica che vedano lo
stesso stato. Gate verde: cargo check/test(15 sws-pyscript)/clippy/fmt, pnpm build,
17/17 guardie statiche.

**Prossimo passo**: template `examples/templates/t69-collaudo/` per esercitare dal vivo
tutte e cinque le fasi (generatore nativo, orologio+stato, `interval_ms`, `functions.run`+
pulsante sullo stesso contatore, sonda `send_telegram`) — in corso.

## ▶ Riprendere da qui — T-69 chiuso, tutte e cinque le fasi fatte (2026-09-15)

**Fase D (`25d1d68`), fatta — l'ultima.** `TagDef.generator: Option<GeneratorSpec>`
(shape ramp/triangle/square, period_ms, min, max, enabled) — funzione **pura** del tempo
(`value_at(now_ms)`), ricalcolata ogni 100ms da un supervisor dedicato in
`sws-runtime/main.rs`, non dal loop event-driven dei tag derivati: quel loop reagisce ai
cambi di `TagDb`, un generatore deve ticchettare da solo.

**Corretto un difetto adiacente trovato esplorando**, non previsto dal piano: `write_tag`
non rifiutava mai una scrittura API su un tag con `expression` — solo il validatore statico
(`validate.rs`) lo segnalava a design-time, non il runtime. Aggiunta `TagDb::computed_tags`
(stesso pattern di `scales`/`write_roles`/`data_types`, aggiornata negli stessi 5 punti +
2 clear) e la guardia in `write_tag`, che ora rifiuta con 400 sia `expression` che
`generator` attivo (`TagDef::is_computed()`). Il claim della doc/schema IA («le scritture
vengono rifiutate») ora è vero anche a runtime, non solo sulla carta.

Editor: terzo toggle "∿" nella riga tag di `ConfigView.tsx`, tipo TS `GeneratorSpec`, i18n
IT/EN. Schema IA rigenerato (`gen_synoptic_schema.py`). Nuovo capitolo 16 in `docs/HOWTO.md`.

Collaudato dal vivo su un runtime di scarto (progetto Sandokan, tag scratch rimosso a fine
prova): rampa/triangolo/quadra misurati nel tempo — valori coerenti col periodo dichiarato
(triangle 2000ms, square 1000ms) — scrittura rifiutata mentre attivo, tornata possibile
disattivandolo. Gate verde: cargo check/test(298 sws-web+sws-core)/clippy/fmt --workspace,
tsc, pnpm build/test, 17/17 guardie statiche incluso `check_synoptic_schema`.

**T-69 chiuso**: tutte e cinque le fasi (A orologio+stato, B `interval_ms`, C `functions.run`,
E doc parametri, D generatore) fatte e su `main`. Piano spostato in
`docs/archive/2026-09-14-T69-tempo-stato-script.md`.

## ▶ Riprendere da qui — T-69 in corso, Fase C+E chiuse: funzioni da script globale (2026-09-15)

Stesso piano, stesso giorno. **Fase C+E (`f1201ac`), fatta.** Nuovo binding `functions.run(name,
**kwargs)`: uno script globale richiama una funzione di progetto in-process (stesso registro di
`POST /api/script/run/:name`, identità propria `fn:<nome>` per `delta_ms()`/`state`). Niente
trigger proprio su `FunctionDef` — duplicherebbe la macchina di scheduling già negli script
globali. Non disponibile sull'engine condiviso (`AppState.py`): una funzione non può richiamarne
un'altra, errore esplicito invece di ricorsione mai pensata.

Fase E nello stesso ramo: nuovo capitolo 15 in `docs/HOWTO.md` (il passaggio parametri funziona
dal 6-09 ma non si trovava) + riquadro "Bindings" del pannello Funzioni aggiornato (elencava solo
`tags`/`print`, mancavano tutti i binding T-69).

Verificato dal vivo: script globale `startup` → `functions.run(...)` con argomento nominale →
tag scritto col valore atteso. Gate verde: cargo build/test(14 sws-pyscript)/clippy/fmt, tsc,
pnpm build/test(362), 17/17 guardie statiche.

**Resta la Fase D**, la più grande: tipo di tag «generatore» nativo (rampa/triangolo/quadra), un
ciclo di valutazione a tempo tutto nuovo — vedi il piano per il disegno già verificato sul codice.

## ▶ Riprendere da qui — T-69 in corso, Fase B chiusa: `interval_ms` sui trigger (2026-09-15)

Stesso piano, proseguito il giorno dopo. **Fase B (`b0f5bb6`), fatta.** `ScriptTrigger::Interval`
guadagna `interval_ms: Option<u64>`, additivo — vince su `interval_s` quando presente, pavimento
50ms. Verificato dal vivo su un runtime di scarto: uno script a `interval_ms: 200` misura
~203ms/tick in regime stazionario (la prima lettura, 52 tick in 2.2s, era un artefatto del setup
— PUT ravvicinati che riavviano il supervisore più volte — non un difetto).

**Trovato e corretto un secondo difetto adiacente**, toccando lo schema per l'assistente IA:
`tags` era documentato come indicizzabile (`tags['id']`), ma `TagApi` non implementa
`__getitem__`/`__setitem__` — verificato empiricamente che solleva sempre `TypeError`. L'API
vera è `tags.read(id)`/`tags.write(id, valore)`, corretta nello schema. Aggiunta nello stesso
punto la documentazione dei quattro binding della Fase A, dimenticata il giorno prima.

**Restano tre fasi**: C (+E) — `functions.run(name, **kwargs)` da uno script globale, più far
trovare la documentazione del passaggio parametri; D — tipo di tag «generatore» nativo, la più
grande.

## ▶ Riprendere da qui — T-69 in corso, Fase A chiusa: orologio + stato negli script (2026-09-14)

Ciclo `/riprendi` proseguito nella stessa giornata. Il maintainer ha chiesto di affrontare T-69
per intero (tutti e sei i miglioramenti della nota dell'11-09, non solo i due a resa più alta) —
piano in `docs/plans/2026-09-14-T69-tempo-stato-script.md`, cinque fasi, un ramo alla volta.

**Fase A — orologio + stato ritenuto (`89af24c`), fatta.** Quattro binding nuovi nel sandbox
Python: `now_ms()`, `uptime_ms()`, `delta_ms()` (dalla prima/ultima invocazione di
un'**identità** — id dello script globale, o nome della funzione — non un solo campo
sull'`Engine`: quello condiviso serve tutte le funzioni insieme), `state.get(key, default)`/
`state.set(key, value)` per ricordare cose piccole senza un tag di servizio. `delta_ms()` alla
prima invocazione vale 0 (deciso dal maintainer). **Corretto nello stesso intervento** un
difetto preesistente trovato esplorando: `send_telegram(...)` non arrivava mai nel dizionario
`__sws_globals__` dove il codice utente gira davvero — sempre `NameError`, mai un test se ne
era accorto.

Collaudato dal vivo su un runtime di scarto: uno script globale con `delta_ms()`+`state` ha
fatto avanzare una rampa 0→100 in modo coerente col tempo reale (non un passo fisso), wrap
corretto, contatore persistente fra i giri — il caso esatto che aveva aperto T-69. Gate verde:
cargo build/test/clippy/fmt --workspace, pnpm build, 17/17 guardie statiche.

**Restano quattro fasi**, ognuna un ramo a sé (vedi il piano per il disegno già verificato sul
codice): B — `interval_ms` sui trigger degli script globali; C (+E) — funzioni di progetto
chiamabili da uno script globale (`functions.run(name, **kwargs)`) + far trovare la
documentazione del passaggio parametri; D — tipo di tag «generatore» nativo (rampa/triangolo/
quadra), la più grande, un ciclo di valutazione a tempo tutto nuovo.

## ▶ Riprendere da qui — le guardie accusavano a caso, e nessuno se n'era accorto (2026-09-14)

Trovato verificando la fase due di Q53: `check_static.sh` dava rosso su una guardia **diversa a
ogni giro**, e ogni guardia accusata passava se lanciata da sola. Non era flakiness del
contenuto — era il **runner**.

`printf '%s\n' "${STATICHE[@]}" "${CON_STACK[@]}" | grep -qx "$n"`, sotto `set -o pipefail`:
`grep -q` esce al primo match, `printf` muore di SIGPIPE mentre sta ancora scrivendo (141), e
`pipefail` propaga quel 141 come fallimento della pipeline. Misurato: **11 falsi positivi su 40
giri**. Peggio ancora, quel controllo sta **prima** dell'esecuzione: un falso positivo abortiva
l'intera suite senza lanciare una sola guardia.

Corretto con un confronto dentro bash, senza pipe: **0 falsi positivi su 200 giri**, e tre giri
completi di `check_static.sh` di fila tutti verdi. La stessa trappola c'era in altre cinque
guardie (11 pipeline in tutto): convertite a here-string, che non ha un produttore da uccidere.
In `scripts/` non resta nessuna `| grep -q` sotto `pipefail`.

**Preesistente, e scoperto per caso.** Conta più del solito perché `check_static.sh` è entrato
nella *definition of done* poche ore prima: una guardia che accusa a caso insegna a rilanciare
finché non è verde — cioè a non guardarla. È la stessa lezione delle due guardie rosse di
stamattina, presa dall'altro verso: lì nessuno le guardava, qui avrebbero smesso di meritarlo.

Fatto su un **ramo annidato** (`fix/guardie-falso-positivo-sigpipe` da
`chore/Q53-rimozione-sdk-qemu`), che è l'opzione 2 della regola «Un ramo alla volta» decisa
poco prima: il difetto è emerso dentro un ramo aperto e bloccava proprio lo strumento che
doveva chiuderlo.

## ▶ Riprendere da qui — Q53 fase due: un solo percorso di build aarch64 (2026-09-14)

Il piano chiedeva una misura sul campo prima di togliere i percorsi storici. **La misura c'era
già** — WP630, 10-09: runtime su in 0,30 s, 1,2 % di un core, RSS 9,8 MB — e la conclusione era
già scritta qui sotto: «il runtime non ha nulla da invidiare all'SDK». Mancava solo la rimozione.

**Via**: `scripts/build_container_aarch64_generic.sh`, i tre `Containerfile.aarch64-generic*`, il
flag `--sdk` di `build_container.sh` (col ramo che chiamava `scripts/yocto/build.sh`),
`--with-generic` e `--require-sdk` di `build_containers_all.sh`. Con loro se n'è andato tutto il
giro dei privilegi root, che serviva **solo** alla build emulata.

**Restano, di proposito**: gli **alias** `-arm64-generic`, ora pubblicati sempre invece che sotto
condizione, così i dispositivi installati con quel riferimento continuano ad aggiornarsi;
`scripts/yocto/build.sh`, che il piano nominava solo «dal percorso container» e serve ancora ai
pacchetti non-container; `parse_image_tarball` in `packaging.rs`, che continua a leggere i vecchi
archivi `-aarch64-generic` che un dispositivo può avere sul disco.

Le tre flag ritirate non danno «Flag non riconosciuta» ma **un messaggio che dice cosa usare**:
erano flag vere fino a ieri. E il referto del perché QEMU non reggeva — 51 minuti, e il SIGSEGV
di `cc` su `aws-lc-sys` che costringeva a `opt-level 0`, cioè un binario pubblicato **non
ottimizzato** senza che il nome del tag lo dicesse — non è stato cancellato col codice: sta in
`docs/DEPLOY_CONTAINER_AARCH64.md` §«Perché il percorso QEMU è stato abbandonato», perché è
esattamente il tipo di strada che qualcuno riprova.

Piano archiviato in `docs/archive/2026-09-12-q53-misura-rimozione-sdk-qemu.md` con l'esito in
testa; la scheda Q53 in `OPEN_QUESTIONS` è timbrata «fase due chiusa».

## ▶ Riprendere da qui — regola nuova: un ramo alla volta (2026-09-14)

Decisa dal maintainer subito dopo il quasi-incidente sull'avviso del ruolo minimo, scritta in
`CLAUDE.md` § «Un ramo alla volta». **Mai un secondo ramo mentre uno è aperto**; a ramo aperto, di
fronte a qualcosa di nuovo, le opzioni sono sempre tre: chiudere-mergiare-eliminare, **annidare**
(partire dal ramo attuale, non da `main`), o rimandare.

**Due conseguenze pratiche, entrambe già applicate.**

1. **La vecchia regola «non cancellare il ramo, decide il maintainer» è stata sostituita**: ora il
   ramo si elimina appena mergiato, perché è la cancellazione a rendere impossibile il parallelo.
   Con una cautela che la regola dice esplicitamente: prima si verifica che `main^{tree}` e
   `<ramo>^{tree}` coincidano, e **serve `-D`, non `-d`** — con lo squash merge i commit del ramo
   non sono antenati di `main`, quindi `-d` rifiuta *ogni* ramo mergiato correttamente in questo
   repo (stessa ragione per cui `git branch --merged` qui non serve a niente).
2. I tre rami della giornata sono stati verificati albero per albero contro il rispettivo commit
   di merge e **cancellati**. In locale resta solo `main` più
   `backup/main-pre-riscrittura-2026-09-09`, che non è un ramo di lavoro e non si tocca.

La skill `/riprendi` è stata allineata: il suo passo 1 citava la regola vecchia parola per parola.
Ora distingue i rami **anteriori** alla regola (si propongono, non si cancellano senza un sì) da
quelli mergiati **nella sessione in corso** (si cancellano subito dopo il controllo sugli alberi).

## ▶ Riprendere da qui — l'avviso sul ruolo minimo, e l'insidia che la correzione di stamattina gli aveva teso (2026-09-14)

Il ramo `fix/ruolo-minimo-avviso-noauth` era pronto dalle 12:18 e aspettava solo un via libera.
Prima di mergiarlo è emerso che **le due correzioni della giornata si toccavano**, e nel verso
peggiore.

L'avviso («il progetto non ha utenti: ogni visitatore è Admin e il ruolo minimo non avrà
effetto») era condizionato su `authToken === "no-auth"`. Era il segnale giusto **finché** la
sentinella valeva esattamente quando il progetto era senza utenti. La correzione delle 14 ha
rotto quella coincidenza: un'istanza IDE non si autentica più in nessun caso, quindi nell'editor
il token è **sempre** `"no-auth"`. Mergiato così, l'avviso sarebbe comparso su ogni oggetto con
un ruolo minimo — **dicendo «il progetto non ha utenti» a chi li aveva appena definiti**, e
sconsigliando una funzione che sul dispositivo avrebbe funzionato benissimo.

È la stessa forma di difetto che questa settimana è passata quattro volte: il testo diceva una
cosa e la condizione ne guardava un'altra. Qui però la divergenza non c'era al momento della
scrittura — **l'ha creata un commit successivo**, il che è il motivo per cui un ramo fermo qualche
ora va riletto contro il `main` di adesso, non contro quello da cui è nato.

**Corretto prima del merge**: la condizione guarda il **fatto**, non la modalità —
`progettoHaUtenti` nello store, da `auth_required` di `GET /api/system`, che è `has_users()` sul
progetto aperto e **non** è stato toccato dalla correzione di stamattina. Si rilegge a ogni cambio
di progetto (`users.yaml` è per progetto) e quando la scheda Utenti cambia qualcosa, così
definire il primo utente spegne l'avviso subito. `null` (non ancora saputo) non mostra niente: un
avviso sbagliato è peggio di un avviso assente.

I test fissano entrambi gli errori già fatti — `authRole`, che non sarebbe mai comparso, e
`authToken`, che da oggi comparirebbe sempre.

## ▶ Riprendere da qui — le due guardie rosse, e perché nessuno le aveva guardate (2026-09-14)

Trovate di sfuggita mentre si chiudeva il lavoro sul primo utente, e chiuse subito: erano
**rosse entrambe da meno di 48 ore**, e nessuna delle due era un problema nuovo — erano due
rifiniture mancate da lavoro *buono*.

- **`check_templates`, 8 problemi, tutti la stessa cosa.** Il commit di Q40 (`2d095087`) ha reso
  builtin i 24 simboli e svuotato `VENDORED`, cancellando gli SVG sotto
  `sws-editor/public/symbols/` — ne resta uno solo. Ma `casa-locale` disegnava ancora 9 icone
  come `type: image` con `src: /symbols/*.svg`: sul web erano **vuote**, su LVGL riquadri rossi.
  Tutte e nove avevano un builtin che le sostituisce, e sono state convertite in `type: symbol`
  con `symbol_id` e il colore del riquadro che le contiene (`state_off_color`, che senza
  `state_tag` è il modo supportato di dare un colore fisso). Tutte le caselle sono quadrate e
  i builtin hanno `viewBox 0 0 100 100`: nessuna deformazione. La nona (`cl2_pv_svg`,
  `solar-power-variant.svg`) era l'unica ancora legata a un file, ed è stata convertita su
  istruzione del maintainer («aggiornarli tutti, non esistono applicazioni finali ma solo
  semplici test»): riquadro portato da 160x60 a 60x60 con lo stesso centro, perché una casella
  non quadrata rimpicciolirebbe il disegno lasciando margini. **Nessun template dipende più da
  `/symbols/`.** Le nove icone sono state confermate dal vivo dal maintainer.
- **`check_synoptic_schema`, una sola differenza.** Il file era indietro di una rigenerazione
  rispetto a `135150be` (le quattro divergenze web/LVGL del collaudo dal vivo), che ha cambiato
  `options` del tipo `radio` da lista di stringhe a `{label, value}`. È il vocabolario che
  diamo all'assistente IA: vecchio, fa scrivere campi che serde scarta in silenzio. Rigenerato.
  Effetto collaterale buono: l'esempio del tipo `image` ora pesca `cl2_pv_svg`, che punta a un
  file che **esiste**, invece di uno cancellato.

**La cosa che conta non sono le due correzioni.** Entrambe le guardie avevano ragione, erano già
scritte, e nessuno le ha rilanciate prima dello squash merge. È la stessa forma dei tre difetti
della settimana scorsa — dire una cosa e averne costruita un'altra — con una variante peggiore:
qui il controllo che l'avrebbe detto **esisteva e girava rosso**. Perciò `./scripts/check_static.sh`
è entrato nella *definition of done* di `CLAUDE.md`, accanto a `cargo check` e `pnpm build`, e
nella lista di fine sessione. Una guardia che nessuno guarda smette di essere un segnale.

Ora: **17 guardie statiche su 17 verdi.**

**E da qui nasce la prossima sessione.** Il maintainer: «se parliamo dei template direi di
aggiornarli tutti, non esistono ad oggi applicazioni finali ma solo semplici test. Anzi, avvierei
una sessione di revisione dei template». Piano scritto coi numeri misurati oggi in
`docs/archive/2026-09-14-revisione-template.md`. Il risultato controintuitivo della misura: la
copertura dei **tipi** è completa (35 su 35, nessuno usato una volta sola — merito dei gemelli
`demo-items`), ma **funzioni intere non hanno un solo esempio in undici template**: `recipes:` a
zero mentre `recipe_panel` è in vetrina su due pagine e si disegna vuoto; `min_role` a zero dopo
tutto Q36; i waypoint di T-53 a zero; `target:` solo in `demo-items-lvgl`. In più un residuo di
licenza da chiudere **prima** del resto: `casa-locale/CREDITS.md` elenca 8 SVG MDI di cui **sette
cancellati da Q40**, e `public/symbols/ATTRIBUTION.md` descrive un meccanismo (`vendored`) che ora
ha zero utenti. La domanda sull'attribuzione dei 7 builtin ridisegnati è per il maintainer, non
da decidere in corsa.

## ▶ Riprendere da qui — definire un utente chiudeva l'IDE fuori dal proprio progetto (2026-09-14)

**Guasto vero, segnalato dal maintainer mentre provava la scheda Utenti**: «appena definisco un
utente (in questo caso `user` con ruolo operatore) se salvo mi dice "Sessione scaduta" ma non ho
un utente admin definito e comunque sarebbe un utente per il dispositivo target, non per l'IDE».
Poi: «Ora per esempio non ho più modo di accedere al progetto TestWP630 dove ho creato l'utente
user».

**La catena, per intero.** La modalità senza utenti non è uno stato salvato: è ricalcolata a ogni
richiesta da `has_users()`. Quindi la `POST /api/auth/users` passa ancora in no-auth, scrive
`users.yaml`, e **da quell'istante** l'istanza è autenticata — la `GET` subito dopo presenta il
token sentinella `"no-auth"`, che il server non ha mai emesso, e riceve 401. Il modale
«Sessione scaduta» non poteva salvare la situazione: chiede la password dell'utente in sessione,
cioè `admin`, l'Admin **sintetico** che in `users.yaml` non esiste. E con un solo Operator
l'editor era comunque vietato (`canConfigureProject`). Il progetto era irraggiungibile.

**Due decisioni del maintainer, entrambe realizzate** (ramo `fix/primo-utente-non-chiude-fuori`,
piano in `docs/archive/2026-09-14-primo-utente-non-chiude-fuori.md`):

1. **Su un'istanza IDE la porta admin resta senza autenticazione**, anche con `users.yaml`
   presente (`senza_autenticazione(ide_only, ha_utenti)` in `router.rs`, usata dai due soli punti
   che decidevano: `require_auth` e `optional_auth`). Quegli account governano il **dispositivo**
   e viaggiano col deploy; non hanno mai governato l'editor.
2. **Sul dispositivo il primo account dev'essere un Admin** —
   `primo_utente_non_amministratore(ide_only, ha_utenti, ruolo)`, guardia nel handler `create_user`
   (non in `sws-auth`: l'autenticazione non deve sapere che esistono gli IDE), 409
   `primo_utente_non_admin`. È la simmetrica del rifiuto che `replace_users_file` fa già a una
   lista vuota. **Cambiamento di comportamento**, non solo una correzione: chi creava un primo
   Operator via API riceveva 201.

Lato editor: il modale non compare più quando non c'è una sessione da rinnovare
(`azionePerSessioneRifiutata`), si va alla schermata di accesso **con scritto perché**; la scheda
Utenti ora dice a chi servono quegli account; il 409 nuovo ha un messaggio suo invece di finire
nel ramo «l'utente esiste già».

**Guardia**: `scripts/check_primo_utente.sh` — due runtime veri, un IDE e un dispositivo, provata
rossa ripristinando le decisioni vecchie (riproduce il 401 esatto). Registrata in `check_static.sh`
fra le `CON_STACK`.

**Il prezzo, dichiarato**: un IDE raggiungibile in rete ora non ha password, in modo permanente
invece che solo finché non si definiscono utenti. È **Q56** in `docs/OPEN_QUESTIONS.md`,
imparentata con Q44 (utenti *sopra* i progetti) e Q54.

**Recupero fatto**: `~/sws/.run-editor/projects/TestWP630/users.yaml` era stato **spostato** (non
cancellato) in `/tmp/users-TestWP630.yaml` per sbloccare subito il progetto, ed è stato **rimesso
al suo posto** per il collaudo. La copia in `/tmp` resta come rete.

**✅ Confermato dal vivo dal maintainer il 14-09-2026**: «ora il progetto WP630 si apre» — con
`users.yaml` al suo posto e l'unico account un Operator, cioè esattamente la condizione che prima
chiudeva fuori. Definition of done completa; squash-mergiato su `main`. `cargo test --workspace`,
clippy, fmt, `pnpm test` (358), `tsc`, eslint e `pnpm build`: verdi.

**Resta da vedere quando capita un dispositivo a portata**, non bloccante: che il 409
`primo_utente_non_admin` si comporti bene anche dal vivo su un pannello vero (qui è provato dalla
guardia su un runtime con `--viewer-port`, che è la stessa condizione), e che dopo un deploy gli
utenti del progetto valgano ancora **sul pannello** — cioè che la separazione sia davvero fra IDE
e dispositivo e non fra IDE e progetto.

**Le due guardie rosse trovate di sfuggita sono state chiuse subito dopo** — vedi la sezione qui
sotto.

## ▶ Riprendere da qui — Q45 chiusa: il linger si abilita da solo, nessun permesso mancante (2026-09-13)

Ciclo `/riprendi` proseguito nella stessa giornata. Nessun ramo obsoleto (solo `main` in locale
dopo la pulizia di fine sessione precedente). Scelto Q45 fra i piani "pronti", visto che il TC620
era già raggiungibile.

**Misurato dal vivo sul TC620** (Pixsys OS 2.1.1): `loginctl enable-linger`/`disable-linger` per
il **proprio** utente riescono senza `sudo`, in entrambe le direzioni — provato disattivando e
riattivando il linger come `user`. Non è una regola Pixsys: `/usr/share/polkit-1/actions/
org.freedesktop.login1.policy` ha un'azione dedicata, `set-self-linger` (`allow_any: yes` di
default), distinta da `set-linger` (il linger di un ALTRO utente, quella sì riservata a root) —
la scheda originale confondeva le due. Il timore («l'utente finale non ha il permesso») non si
verifica su questo hardware.

**Deciso dal maintainer (opzione 1)**: `deploy/container/install-container.sh` non avvisa più e
continua se il passo fallisce — ora si ferma con un errore (`fix/q45-linger-self-service-
verificato` → `main`, `067d7a2`), perché un fallimento indicherebbe qualcos'altro di rotto sul
dispositivo, non un permesso mancante da aggirare. Verificato dal vivo anche il ramo "abilitato"
(disattivato il linger e rilanciata la stessa logica dello script, riattivato senza errori).

Scheda Q45 archiviata in `docs/history/OPEN_QUESTIONS-chiuse.md`; piano spostato da
`docs/plans/` a `docs/archive/2026-09-12-q45-linger-permesso-produzione.md`.

## ▶ Riprendere da qui — collaudo dal vivo sul TC620: quattro pezzi confermati e mergiati (2026-09-13)

Sessione di collaudo su hardware vero, richiesta dal maintainer per chiudere tutto ciò che
aspettava "la sua conferma di persona" — F7 parte A (sospesa da una sessione precedente
interrotta) e Q40 (appena costruito), più tutto ciò che risultava "verificato solo per lettura di
codice, mai dal vivo" in `main`. Container aggiornato e installato sul TC620
(`tc620-a-p3-c6-07aff9.local`, `192.168.1.179`, cross-build via `build_container.sh`, nessun push
al registry) tre volte nel corso della sessione, man mano che emergevano difetti dal collaudo
stesso.

**Quattro pezzi, tutti confermati dal vivo e mergiati in `main`:**

1. **F7 parte A** (`bd773d4`) — bordo per-cella nella griglia + fix barra gruppi pannello
   proprietà. Confermato dal maintainer nell'editor.
2. **Q40** (`2d09508`) — tutti e 24 i simboli (13 mancanti + 4 vendored facili + 7 MDI
   ridisegnati) confermati riconoscibili e ricolorabili sullo schermo fisico del TC620. Scheda
   archiviata in `docs/history/OPEN_QUESTIONS-chiuse.md`.
3. **Fix tastiera LVGL** (`7516e6a`, nuovo, scoperto oggi) — la tastiera di login mostrava `[]` su
   backspace/invio/ecc.: eredita `text_font` dallo schermo, e il font DejaVu (caricato per gli
   accenti italiani) non contiene i glifi `LV_SYMBOL_*` che quei tasti usano, solo Montserrat li
   ha. Confermato dal vivo dopo la correzione.
4. **Fix sfondo widget sinottici** (`5816a9a`, nuovo, scoperto oggi) — 10 tipi di widget
   (kpi_tile, data_log, table, xy_plot, alarm_history, alarm_viewer, alarm_bell, recipe_panel,
   lang_button, lang_selector) avevano sfondo/bordo bianco sul pannello: usavano
   `var(--brand-surface, …)`, che segue il tema chiaro/scuro dell'app (risolto da
   `prefers-color-scheme`) e non lo sfondo della pagina — un browser kiosk senza segnale di tema
   scuro dall'OS risolve "chiaro". Stessa classe di difetto di Q18 (là per il testo). Confermato
   dal vivo dopo la correzione.

**Q36 (login/logout con rinavigazione automatica) e F5.3x (parità web/LVGL su table/progress_bar/
radio/gauge_zones) erano già su `main` da sessioni precedenti**: entrambi confermati dal vivo per
la prima volta in questa sessione (mai fatto prima con un tocco reale sul pannello / mai
riportato sul TC620 dopo le correzioni). **T-68** (deploy da "Dispositivi registrati" dopo
discovery, con un pannello senza utenti configurati) confermato: parte senza chiedere nulla, come
atteso.

**Capito solo a posteriori, non un difetto**: durante il collaudo i progetti del TC620 sono
spariti due volte (`demo-items-web`, `collaudo-f7`, gli utenti configurati), sostituiti dal solo
progetto appena mandato. La prima volta sembrava un incidente; la seconda — riprodotta
osservando l'esatta sequenza — ha chiarito il meccanismo: il TC620 (come ogni pannello di campo
in questo progetto) tiene **un solo progetto attivo alla volta**, e **Deploy dall'editor
sostituisce l'intero contenuto** di `/var/sws/projects` con quello inviato, utenti compresi — non
lo aggiunge accanto agli altri. Avere più progetti insieme sul dispositivo (come nel collaudo,
via upload diretto) è uno stato transitorio che il primo Deploy successivo (anche accidentale,
con qualunque progetto fosse aperto in quel momento nell'editor) riporta a uno solo. Nessun dato
reale perso (tutti i progetti coinvolti erano ricostruibili dai template del repo). Non un
`OPEN_QUESTIONS.md`: è il comportamento voluto per un dispositivo a un progetto solo, solo non
documentato in un posto ovvio per chi tiene più progetti di prova sullo stesso pannello.

**Q49 resta con lo stesso residuo di prima** (pinning MQTT mai provato contro un broker TLS
reale) — rimandata di comune accordo, nessun broker disponibile in sessione.

Gate pieno verde su `main` dopo tutti e quattro i merge: `cargo fmt/build/test/clippy
--workspace`, `pnpm build` (tsc) + `pnpm test` (355/355), tutte le guardie LVGL
(`check_lvgl_parity/types/demo_templates/documenti/lvgl_symbols/simboli_lvgl`). Pushato su
`origin/main` su richiesta esplicita del maintainer.

**Rami da proporre in cancellazione** (lavoro confluito in `main` via squash, non cancellati
senza un sì esplicito): `feat/f7-bordo-cella-griglia`, `feat/q40-simboli-lvgl`,
`fix/lvgl-tastiera-simboli-mancanti`, `fix/sinottico-sfondo-tema-app`, `test/collaudo-f7-q40`
(ramo di integrazione usato solo per il collaudo, mai destinato a un merge proprio).

## ▶ Riprendere da qui — Q49 completa: pinning TLS su viewer LVGL e MQTT (2026-09-13)

Stesso ciclo `/riprendi`, dopo che il maintainer è dovuto uscire ("sono fuori, non riesco a fare
le prove sul prodotto") a metà del collaudo di F7 (vedi sezione sotto). Scelto Q49 come task
indipendente dal prodotto fisico — costruibile e collaudabile con un runtime di test, senza
bisogno del maintainer davanti allo schermo.

**Il piano segnalava un ostacolo prima di scrivere codice**: rumqttc 0.24 usa una rustls
vendorizzata (0.22) diversa da quella del workspace (0.23) — il verificatore di `certificati.rs`
non ci sarebbe entrato senza duplicarlo. Verificato empiricamente (non solo dedotto): rumqttc
0.25.1 con la feature `use-rustls-no-provider` allinea la sua rustls alla 0.23 del workspace,
eliminando l'ostacolo alla radice — zero duplicazione di verificatore, un solo modulo di pinning
condiviso ovunque.

**Costruito** (`chore/q49-tls-pinning` → `main`, `1b52423`): il meccanismo TOFU
(`sws-web/src/certificati.rs`) spostato in `sws_core::pin_tls`, riusabile senza tirarsi dietro
tutto `sws-web` (axum, l'intero stack HTTP). `certificati.rs` resta un thin wrapper, stessi nomi,
zero modifiche ai chiamanti esistenti. Viewer LVGL: `AcceptAnyCert` sostituito dal pinning vero
su tutti e 17 i punti che parlano TLS (14 client REST + 3 WebSocket),
`~/.config/sws/lvgl_tls_conosciuti.yaml`; un'impronta cambiata blocca l'avvio con un messaggio
che dice quale riga togliere a mano (nessuna UI qui, è un CLI). MQTT: terza via accanto a
`insecure_skip_verify`/`ca_cert_path` — pinning per broker, condiviso fra le sorgenti vere e lo
sfoglia-topic dell'editor. Come effetto collaterale, chiuso anche un difetto preesistente
(2026-08-24) in `browse`: senza CA né `insecure_skip_verify` si parlava in chiaro a una porta
TLS, il broker chiudeva, e lo sfoglia-topic tornava un elenco vuoto senza dire perché.

**Collaudato dal vivo** (LVGL): runtime di test con TLS generato al volo
(`POST /api/system/tls/generate`) — primo contatto, connessione silenziosa alla seconda, rifiuto
con messaggio chiaro dopo aver rigenerato il certificato, nuovo primo contatto dopo aver tolto
la riga dall'archivio. Ciclo completo su tutti e quattro gli stati. **Non collaudato dal vivo**:
il pinning MQTT contro un broker TLS reale — verificato per lettura di codice e dai test
unitari di `pin_tls` (stessa logica già in uso per editor↔dispositivo).

Gate verde: `cargo check/test/clippy/fmt --workspace`, `pnpm build`, `check_lvgl_parity/types/
demo_templates/documenti`.

## ▶ Riprendere da qui — F7 parte A pronta, in attesa di collaudo del maintainer (2026-09-13)

Ciclo `/riprendi` proseguito su F7 (bordo per-cella nella griglia). **Parte A costruita e
committata** sul ramo `feat/f7-bordo-cella-griglia` (`7879943`), **non ancora mergiata**: il
maintainer voleva provarla di persona nell'editor prima dello squash-merge, ma la sessione si è
interrotta ("sono fuori, non riesco a fare le prove") prima di poterlo fare. **Non mergiare senza
la sua conferma esplicita.**

Contenuto del ramo: `border_color` su `GridCell`/`SubCellEntry` (web + LVGL + pannello
proprietà), più un bug scorrelato trovato dal maintainer testando dal vivo — selezionare il
figlio di una cella/sotto-cella nascondeva la barra dei gruppi del pannello proprietà
(sezioni Identità/Aspetto/Dato irraggiungibili). Corretto con una nuova funzione
`figlioProprietaAttivo` in `EditorShell.tsx`. Dettagli completi nel messaggio di commit.

Verificato: `cargo check/test/clippy/fmt`, `pnpm build` (tsc), `pnpm test` (355/355),
`check_lvgl_parity/types/demo_templates`. Collaudato dal vivo dal lato mio (runtime di test
isolato) per `border_color`; il fix della barra gruppi **non ancora riverificato dal vivo dal
maintainer** — solo dedotto dal codice e coperto da 7 nuovi test unitari.

**Resta da fare**: conferma del maintainer (poi squash-merge in main), F7 parte B (rimando
all'audit dallo storico allarmi — scope ridotto, deciso dal maintainer: niente migrazione di
schema).

## ▶ Riprendere da qui — Q36 completa: gate min_role nel rendering LVGL (2026-09-13)

Continuazione dello stesso ciclo `/riprendi`. Parte 2 di Q36 (vedi sezione sotto per la parte 1):
il gate `min_role`/`min_role_effect`, mai stato letto da `lvgl_render.rs` prima d'ora.

**Costruito** (`fix/Q36-min-role-lvgl` → `main`, `7a2c3a0`): porto di `isRoleAllowed`/F3.1
(`SvgCanvas.tsx`). `session::role_allowed()` confronta il ruolo della sessione con `min_role`
(anonimo sotto Viewer, stringa non riconosciuta vale Viewer, come sul web — 9 test unitari). Nel
ciclo principale di `render_page_objects`: `min_role_effect: "hide"` non crea l'oggetto (finisce
in `summary.skipped_role`, stampato come "nascosti per ruolo insufficiente"); qualunque altro
caso ("disable", assente) lo crea attenuato — opacità 0.45 combinata moltiplicativamente con
l'`opacity` di progetto (`combined_opa`) — e non cliccabile (`disable_clickable_from` toglie
`LV_OBJ_FLAG_CLICKABLE`, l'equivalente LVGL di `pointerEvents:none`; faceplate e griglie sono
figli piatti dello schermo in questo motore, quindi lo stesso range li copre già tutti senza
ricorsione).

**Aggiunto oltre al piano originale**, segnalato e confermato dal maintainer: login e logout ora
rinavigano da soli verso la pagina corrente (stessa idea di `lang_button` per il cambio lingua),
così il gate si aggiorna subito e non solo alla prossima navigazione.

**Collaudato dal vivo** su runtime di test isolato (due checkbox di prova aggiunte solo alla
copia scratch del progetto demo, mai ai template del repo): da anonimo l'oggetto "hide" sparisce
e quello "disable" resta ma attenuato e il tocco non produce comando; da Admin (sessione
persistita da un login precedente) entrambi tornano normali e cliccabili; login e logout
innescano davvero la rinavigazione (confermato dal log diagnostico "navigazione richiesta").
**Non verificabile dal vivo**: che la rinavigazione ridisegni *durante* una sessione interattiva
reale — `--istantanea` riporta le navigazioni in coda, non le esegue (stesso limite già noto
per le scritture autenticate di parte 1); il meccanismo riusa però lo stesso canale `nav_tx` già
provato per `lang_button`.

Gate verde: `cargo check/test/clippy --workspace -- -D warnings`, `cargo fmt --check`,
`check_lvgl_parity.sh`, `check_lvgl_types.sh`, `check_demo_templates.sh`, `check_documenti.sh`.

**Q36 è ora completa in entrambe le parti.** Il piano è stato archiviato in
[`docs/archive/2026-09-12-q36-min-role-lvgl.md`](docs/archive/2026-09-12-q36-min-role-lvgl.md);
la scheda originale è stata spostata in `docs/history/OPEN_QUESTIONS-chiuse.md` (non compariva
più come voce viva in `docs/OPEN_QUESTIONS.md` dal 2026-09-12, essendo già "decisa"). Resta
aperta [Q55](docs/OPEN_QUESTIONS.md) (il blocco `spawn()` scoperto in parte 1), non toccata da
questa parte 2.

## ▶ Riprendere da qui — Q36 parte 1 mergiata: sessione vera nel client LVGL (2026-09-13)

Ciclo `/riprendi`. Scelto Q36, la più grande fra le "pronte". Su indicazione del maintainer,
spezzata in due rami in sequenza: questa sessione ha chiuso solo la **parte 1** (sessione,
login/logout, persistenza) — la parte 2 (gate `min_role`/`min_role_effect` nel rendering)
resta un ramo futuro, non ancora iniziato.

**Costruito** (`feat/Q36-sessione-lvgl` → `main`, `12c8ad1`): pulsante persistente
login/logout in alto a destra su ogni pagina (ricreato ad ogni `render_page_objects`, non
esiste un layer di chrome globale in questo motore); overlay a schermo intero con
`lv_textarea` × 2 (utente, password mascherata) + `lv_keyboard` in `MODE_TEXT_LOWER`; nuovo
`session.rs` con tipi minimi locali (`Role`/`LoginOk`/`SessionState`, non una dipendenza da
`sws-auth` per non tirare dentro `argon2`/`uuid`/`serde_yaml` in un binario cross-compilato —
stesso principio già seguito per l'istantanea in PPM invece di PNG); token persistito in
`~/.config/sws/lvgl_session.json`; `put_tag`/`ack_alarm`/`apply_recipe` allegano
`Authorization: Bearer` quando c'è una sessione.

**Bug serio scoperto e risolto dal vivo**: `client::login()` lanciato via `rt_handle.spawn()`
(lo stesso pattern già in uso per le tre scritture) non tornava **mai** — nessun errore, nessun
panico, pur col server che accettava regolarmente la richiesta. Isolato per esclusione, con
più esperimenti dal vivo, a "POST che riceve 200, via `spawn`, dentro questo processo": la
stessa identica richiesta funziona all'istante via `curl`, da un binario Rust a sé stante, o
via `rt_handle.block_on()` nello stesso callback. Login ora usa `block_on`, come già fa la
navigazione (`nav_rx`) in questo stesso file — un blocco del render loop accettabile per
un'azione innescata da un tocco umano. Causa profonda non isolata (sospetto: l'override
`strncmp`/`strcmp` di `lvgl-sys`, già visto rompere `libdbus` in passato) — **non decisa qui,
registrata come [Q55](docs/OPEN_QUESTIONS.md)**: qualunque `spawn` futuro verso un esito 200
in questo binario rischia lo stesso blocco silenzioso.

**Collaudato dal vivo** su runtime di test isolato (porte 9910/9911, mai toccata l'istanza del
maintainer): login e logout in una sola `--istantanea --tocca`, nessun blocco; persistenza
verificata riavviando il processo (riparte già loggato leggendo il file salvato). **Non
verificato dal vivo**: l'header `Authorization` sulle scritture autenticate — `--istantanea`
non svuota mai le code dei comandi verso il server (limite preesistente dello strumento,
`main.rs:557`, non introdotto da questa sessione); verificato solo per lettura di codice.

Gate verde: `cargo check/test/clippy --workspace -- -D warnings`, `cargo fmt --check`,
`check_lvgl_parity.sh`, `check_lvgl_types.sh`, `check_demo_templates.sh`, `check_documenti.sh`.

Il piano resta aperto (non ancora archiviato) finché non è fatta anche la parte 2 — **fatta**
nella stessa sessione, vedi la sezione sopra: il piano è ora in
[`docs/archive/2026-09-12-q36-min-role-lvgl.md`](docs/archive/2026-09-12-q36-min-role-lvgl.md).

## ▶ Riprendere da qui — F5.3x Parte B chiusa, programma SCADA-widgets concluso (2026-09-12/13)

Ciclo `/riprendi` ripreso dopo Q29. Nessun ramo obsoleto (solo `main` in locale). Scelto di
ripartire dalla Parte B di F5.3x (verifica dal vivo della parità LVGL sul TC620), l'unico
piano PARZIALE rimasto in `docs/plans/`.

**Collegato al TC620** (`tc620-a-p3-c6-07aff9.local`, autorizzato dal maintainer per questa
sessione). Deployato `demo-items-web` sovrascrivendo `collaudo-xy-plot` (col via libera del
maintainer — non serviva più tenerlo, storico incluso). Confronto pagina per pagina: screenshot
browser + istantanea `sws-lvgl-viewer --istantanea` dentro lo stesso container, senza toccare
lo schermo fisico né fermare Chromium/Weston (il device non ha un servizio LVGL live, solo il
binario dentro il container).

**Quattro divergenze trovate e confermate nel codice** (non nella semplice differenza dei dati
simulati fra le due istantanee), tutte corrette in `fix/F9c-parita-lvgl` → `main` (`135150b`):
`table` (intestazioni sbagliate: `obj.label` invece di `table_label_header`, "VAL" invece di
"VALORE"), `progress_bar`/`slider` (l'etichetta del valore non veniva mai disegnata pur essendo
dichiarata nel modello), `radio` (un gruppo a N opzioni collassava in un solo checkbox a 2
stati — non un'approssimazione estetica, una perdita di dati vera: ora N checkbox mutuamente
esclusivi), `gauge_zones` (dichiarato ma mai letto — ora disegna le fasce colorate fisse come
il web). Trovato per strada: i due template gemelli avevano `radio.options` in un formato
legacy (stringhe semplici) mai migrato — il web tollerava in silenzio, la nuova
deserializzazione tipata di LVGL falliva a caricare l'intera pagina; corretto il contenuto dei
template.

Verificato **localmente** (x86_64, istantanea) prima del merge — gate pieno verde. **Non
ancora ricompilato per aarch64 né riportato sul TC620**: rimandato, su decisione del
maintainer, alla prossima release che tocca comunque il binario del dispositivo (stesso
codice, nessun ramo per architettura).

**F5.3x è ora chiusa per intero** (Parte A confermata su hardware nella sessione precedente,
Parte B in questa) — ed era l'ultimo residuo del programma `2026-08-21-scada-widgets.md`, ora
anch'esso archiviato: **F0-F9 del piano SCADA-widgets sono tutti conclusi**.

**Restano "pronte" da costruire**: Q36 (sessione vera nel client LVGL — la più grande),
Q16/Q45/Q49/Q53. Restano piani "da fare" non derivati da Q-xx: `ruolo-minimo-avviso-noauth`,
`f7-residui-minori`, `casamauro-arricchimento-demo`. **`docs/plans/` non ha più piani
PARZIALE/in corso** — solo questi tre "da fare" più le sei domande Q-xx "pronte"/"decisione".

## ▶ Riprendere da qui — Q29 mergiata (2026-09-12)

**Q29 — `write_data_type`, un tag due tipi quando lettura e scrittura divergono**: su `main`
(`dab5ef8`), squash-merge confermato. Nuovo campo `TagDef.write_data_type: Option<String>`
(`sws-core/src/project.rs`, accanto a `data_type`); il validatore lo usa per il controllo sul
valore scritto (`write_value`/`release_value`/`checked_value`/`unchecked_value`), non per
`on_value` (confronto, resta sul solo `data_type`). Le dodici eccezioni di `casa-locale`
(`ECCEZIONI_NOTE` in `validate.rs`) sono **tolte**, non lasciate morte: con `write_data_type:
string` dichiarato sui quattro tag delle tapparelle, il test `i_template_non_hanno_errori` passa
senza più bisogno di elencarle — prova diretta che il campo risolve i dodici casi.

Un chiarimento sul dove, non scontato dal piano: il campo vive nella scheda Tags dell'editor
(riga avanzata, accanto al gemello `write_min_role`), **non** nel pannello sorgenti MQTT dove
vive `publish_topic` — `write_data_type` è su `TagDef`, universale per qualunque sorgente. Lo
schema per l'assistente IA (`TAG_FIELDS`/`schema_tag`) si è rigenerato da solo dai commenti doc
di `TagDef`, nessuna modifica a mano; stesso trattamento di `write_min_role`: nel vocabolario per
dichiarare un tag nuovo, non nell'elenco minimale di `elenca_tag`.

Difetto trovato e corretto per strada: il CSV-import dei tag (`router.rs`) non compilava più
dopo il nuovo campo — mancava l'inizializzazione. Trovato da `cargo check`, non da un test.

Verificato dal vivo: round-trip YAML → API su un'istanza di prova con `casa-locale`, screenshot
dell'editor con "Tipo in scrittura: Stringa" sulla riga di `shutter.garage`. Gate pieno verde
(workspace intero, tsc/build/348 vitest, 17/17 guardie). Scheda archiviata in
`docs/history/OPEN_QUESTIONS-chiuse.md`, piano in `docs/archive/2026-09-12-q29-tag-due-tipi.md`.

**Restano "pronte" da costruire**: Q36 (sessione vera nel client LVGL — la più grande),
Q16/Q45/Q49/Q53. Restano piani "da fare" non derivati da Q-xx: `ruolo-minimo-avviso-noauth`,
`f7-residui-minori`, `casamauro-arricchimento-demo`, più la Parte B di F5.3x (verifica dal vivo
della parità LVGL sul TC620, sbloccata dalla 2.7.3, non ancora affrontata).

## ▶ Riprendere da qui — Q28 mergiata, cinque decisioni Q-xx più due verifiche chiuse in un ciclo `/riprendi` (2026-09-12)

Ciclo `/riprendi` ripreso dopo il precedente (2.7.3/T-70). Nessun ramo obsoleto da pulire (solo
`main` in locale su questa macchina). Prima chiusi **Q31** e **Q46** (verifiche dal vivo, vedi
sotto), poi scelto **Q28** come piano da costruire.

**Q28 — bar_chart a scala per serie, fuori da `stacked`**: su `main` (`f8e7fc6`), squash-merge
confermato. Grouped/affiancate passa a scala per serie (`bar_series[i].min/max`, default `0..100`
fisso, come LVGL ha sempre avuto); `stacked` resta a scala condivisa. **LVGL non ha richiesto
alcuna modifica** — il default e i campi esistevano già in `model.rs`/`lvgl_render.rs`, tutto il
lavoro è stato in `sws-editor`. Due dettagli emersi riverificando il codice prima di scrivere,
confermati col maintainer: lo **zero per-barra** (ogni barra affiancata calcola il proprio zero
dalla propria scala, non da uno condiviso — necessario per correttezza, non una scelta), e le
**tacche numerate** spente con lo stesso criterio già usato per le soglie (solo a scala comune fra
le serie). Verificato dal vivo con un'istanza di prova isolata: screenshot browser + istantanea
`sws-lvgl-viewer --istantanea` sulla stessa pagina (tre serie, due a default e una a 0..500)
mostrano le stesse proporzioni relative nei due motori. Gate pieno verde. Scheda archiviata in
`docs/history/OPEN_QUESTIONS-chiuse.md`, piano in `docs/archive/2026-09-12-q28-scala-bar-chart.md`.

**Q31 e Q46 — due verifiche dal vivo, chiuse senza codice**: entrambe erano "decisa e realizzata,
manca solo la conferma a schermo". Fatte con istanze di prova isolate (mai toccata l'istanza
dell'editor su :8460):
- **Q31** (chat con runtime remoto collegato): due runtime di prova (un "device" e un "editor"
  collegato ad esso), un browser vero. Confermati tutti e quattro i punti del piano — l'avviso
  «progetto locale» compare, il socket `/ws/ai` resta locale (mai `/ws/remote/ai`), nessun
  404/loop, la proposta della chat cita il progetto locale e non quello del device.
- **Q46** (`browse-dirs`/`mkdir` dentro `projects_root`): unit test verdi + istanza di prova con
  un link simbolico che punta fuori dalla radice — ogni tentativo di fuga respinto (400), una
  `mkdir` legittima riesce. Corretto per strada un commento ormai falso in `projects.rs:1211`.

Entrambe archiviate in `docs/history/OPEN_QUESTIONS-chiuse.md`, piani spostati in `docs/archive/`.

**Restano "pronte" da costruire**: Q29 (`write_data_type`), Q36 (sessione vera nel client LVGL —
la più grande, decisa nella sessione precedente), Q16/Q45/Q49/Q53. Restano piani "da fare" non
derivati da Q-xx: `ruolo-minimo-avviso-noauth`, `f7-residui-minori`, `casamauro-arricchimento-demo`,
più la Parte B di F5.3x (verifica dal vivo della parità LVGL sul TC620, ora sbloccata dalla
2.7.3, non ancora affrontata).

## ▶ Riprendere da qui — 2.7.3 pubblicata e installata sul TC620, T-70 confermato dal vivo (2026-09-12)

Chiuso il blocco della sezione precedente. Versione **2.7.3** taggata (`main`, `1caeb3b`..`da100f8`
inclusi nel bump, tag git `2.7.3`) e pubblicata su `ghcr.io/soligolab/sws-runtime:2.7.3-arm64`
(cross-build Q53, senza SDK Pixsys — solo podman + qemu-aarch64, già presenti su questa
macchina). Installata su `tc620-a-p3-c6-07aff9.local` via `install-container.sh --pull` (SSH,
autorizzato dal maintainer per questa sessione).

**T-70 confermato anche su hardware vero**, non solo in locale: `runtime_version: "2.7.3"`,
`xy_series` sopravvive al round-trip sul progetto reale (`collaudo-xy-plot`, lasciato dal
maintainer sul dispositivo), `GET /api/history/xy` risponde con 1045 punti reali del backfill.
Il blocco di ieri (firmware vecchio che scartava `xy_series` in silenzio) è risolto.

**Attenzione — build container non del tutto pulita**: durante la pubblicazione la cache di
podman ha riusato il binario del primo tentativo (taggato erroneamente 2.7.2 per un bump di
versione avvenuto a metà build) invece di ricompilare; verificato con `podman run --entrypoint
... --version` che il binario avesse comunque 2.7.3 e con `grep` sul binario che contenesse
`history/xy` prima di pubblicare — ma è stato un controllo a posteriori, non una garanzia
strutturale. Da tenere a mente: bumpare la versione **prima** di lanciare `build_container.sh`,
mai a build in corso.

**Questo sblocca anche la Parte B** (verifica dal vivo della parità LVGL) dello stesso piano —
il dispositivo ha ora un binario aggiornato. Non ancora affrontata in questa sessione.

## ▶ Riprendere da qui — T-70 Parte A su `main`, Parte B bloccata sul dispositivo (2026-09-12)

**T-70/F5.3x — xy_plot multi-coppia con backfill, Parte A**: su `main` (`262c17c`), non
pushato. Schema `xy_series[]` (tre posti: TS, `synoptic.rs`, `model.rs` LVGL), migrazione
automatica dal formato legacy (stesso taglio di `trend_tags`), nuovo `GET /api/history/xy`
con merge a riempimento (`sws_historian::merge_xy`, non un join — due tag storicizzati
indipendentemente non hanno timestamp in comune), rendering multi-serie su web e LVGL,
pannello proprietà con editor per l'array di coppie. Gate pieno verde (cargo check/test/
clippy/fmt, pnpm build+tsc, 469 test Rust). Dettaglio nel piano
`docs/archive/2026-09-12-F5.3x-xy-plot-e-verifica-lvgl.md`.

Verificato dal vivo (API + istantanea LVGL), **non sul TC620**: il dispositivo gira ancora il
firmware precedente, che non conosce `xy_series` e lo scarta in silenzio — un progetto
migrato ci arriva senza coppia, il grafico resta vuoto. Non è un difetto del codice, è un
disallineamento firmware/progetto. Riprovare quando il dispositivo avrà un binario
aggiornato (serve una build/deploy del runtime per aarch64, non il solo deploy di progetto).

Nel mezzo, tre pacchetti `-dev` mancanti dopo l'upgrade a **Ubuntu 26.04.1 LTS** su questa
macchina (`python3.14-dev`, `libsdl2-dev`, `libfreetype-dev` — quest'ultimi due già elencati
in `docs/YOCTO_CROSSCOMPILE.md` punto 6, scoperti a build fallite invece che da lì). Ora c'è
`./scripts/install_dev_prereqs.sh` (su `main`, `bac9afb`) per verificarli/installarli tutti
insieme la prossima volta.

**Rami locali da proporre in cancellazione** (lavoro già confluito in `main` via squash):
`feat/T-70-xy-history-merge`, `feat/T-70-xy-plot-multi-coppia` — non cancellati senza un sì
esplicito del maintainer (regola di `CLAUDE.md`).

**Prossima sessione**: **Parte B** dello stesso piano (verifica dal vivo della parità LVGL)
resta l'unico lavoro vivo in `docs/plans/` — ma condivide il blocco di cui sopra: serve un
binario aggiornato sul TC620 prima di poterla fare per davvero. Valutare se vale la pena
affrontare prima quel passo (build/deploy del runtime aarch64) come lavoro a sé.

## ▶ Riprendere da qui — collaudo "gli occhi della chat" chiuso (2026-09-12)

Ciclo `/riprendi` di inizio sessione su "ufficio". Puliti dieci rami locali confermati superati
(contenuto già su `main` sotto altro nome — `fix/mqtt-topic-vuoto`,
`salvataggio-main-2026-09-09`, `test/validazione-2026-09-06`, `feat/Q41-risorse-chat`,
`fix/Q37-cornice-lvgl`, `fix/Q38-ratio-materializza`, `fix/Q17-ricette-soglia`,
`fix/Q42-scaling-script`, `fix/Q27-tipo-in-scrittura`, `fix/revisione-documenti`).

**Nel mezzo, un problema di ambiente non di codice**: la macchina ha concluso un avanzamento a
**Ubuntu 26.04.1 LTS** durante la sessione (riavvio a metà). `python3` di sistema è passato
alla 3.14 e mancava `python3.14-dev` (niente header/symlink per il link di
`sws-pyscript`/pyo3): `cargo build -p sws-runtime` falliva con `unable to find library
-lpython3.14`. `python3.13`, usato come ripiego transitorio, è stato rimosso dall'upgrade
stesso. **Rimedio definitivo**: `sudo apt install -y python3.14-dev` (lanciato dal maintainer,
non da questa sessione — nessun permesso per `sudo`, anche a voce). Dopo l'installazione la
build torna pulita senza alcuna variabile d'ambiente.

**Il collaudo vero è riuscito.** `docs/archive/2026-09-12-collaudo-occhi-chat.md` (il residuo
reale di T-51/fase 3 — non "i passi 3-6" di `docs/plans/README.md`, nota datata corretta nello
stesso giro): progetto scratch dal template `demo-items-lvgl`, chat staccata nella sua
finestra, richiesta che obbligava `istantanea_pagina` sulla pagina «Grafici e tabelle».
L'assistente (Kimi, chiave già configurata su questa macchina) ha chiamato **davvero**
`istantanea_pagina` + `leggi_pagina` + `schema_oggetto`, e la risposta cita dettagli concreti e
verificabili — i colori esadecimali dichiarati delle tre serie, le soglie a 70/90 disegnate
correttamente — non genericità: il percorso HTTP e il blocco immagine, scritti ma mai
esercitati, funzionano nella chat staccata con un modello vero. **Chiude il residuo di
T-51/fase 3.**

Osservazione emersa, **non un difetto confermato**: l'assistente ha notato le tre barre del
`bar_chart` identiche (stessa altezza, blu scuro) invece che colorate per serie, ma l'ha
segnalato con la cautela giusta. Verificato nel codice (`lvgl_render.rs`, `render_bar_chart`/
`update_bar_chart`): a valore 0 l'indicatore colorato è invisibile e si vede solo il track di
sfondo (stile di tema, non colorato) — comportamento atteso per un bar_chart a zero, non un
bug. I tag del banco di prova partono tutti a 0 per il limite già noto dell'istantanea
usa-e-getta (`docs/HOWTO.md` §6: "non si collega al campo"). Da riverificare con dati vivi solo
se un giorno serve togliersi il dubbio del tutto — il maintainer ha scelto di non farlo ora.

Progetto scratch chiuso e cancellato. **Istanza di prova lasciata accesa su :8460** (permesso
allargato dal maintainer: su "ufficio" si può riavviare da sola quando serve, senza chiedere
ogni volta — resta comunque una macchina di test, non toccare i progetti già dentro).

**Prossima sessione**: decidere se archiviare `docs/archive/2026-08-31-chat-ai-nelleditor.md`
(il residuo che restava — Fase 4, server MCP autonomo — è esplicitamente fuori scope per ora) e
`docs/archive/2026-09-12-collaudo-occhi-chat.md` (chiuso). Nessun'altra cosa lasciata a metà.

## ▶ Riprendere da qui — chiusura della sessione dell'11-09-2026

**`main` è a `origin/main`, working tree pulito, in locale resta il solo ramo
`backup/main-pre-riscrittura-2026-09-09`.** A casa: `./scripts/session_start.sh` vedrà `main`
indietro e proporrà il `pull` — è il caso normale, non la divergenza del 09-09.

La giornata, in ordine: T-57 (pannello appena installato che rifiutava la connessione) → **gli
utenti appartengono al progetto** (rovesciata la decisione del 2026-07-30) → i 19 piani conclusi in
`docs/archive/` → `alarm_banner` che divergeva fra i due motori → la via di fuga STOP con la sua
guardia → **T-56 + T-55** (i due pannelli dell'editor) → il pannello destro a gruppi → **T-53**
(waypoint sul canvas) → **T-68** (credenziali del dispositivo) → **T-58** (motore di rendering
dall'IDE). Tutto mergiato, pushato e collaudato dal maintainer.

### Quello che resta da fare, in ordine di valore

1. **T-59 — referto di compatibilità LVGL**, la traccia più grossa e quella che il maintainer ha
   chiamato interessante. Decisione già presa: **lo si chiede al motore vero**, non a una lista di
   limiti scritta a parte. `istantanea.rs` fa già tutto il lavoro pesante; manca una costante e un
   giro sulle pagine. Oggi l'avviso della conversione verso LVGL è generico, ed è il suo posto.
2. **T-69 — il Python di progetto non sa che ora è.** Appena registrata, con le otto affermazioni
   dell'assistente IA riverificate: sette reggono, **una no** (i parametri si passano già). La
   cosa che sbloccherebbe davvero è `delta_ms` nella sandbox, perché rende la logica indipendente
   dalla cadenza del trigger.
3. Le altre otto tracce dall'HOWTO (T-60…T-67) e **T-54** (il log staccato), l'unica delle
   richieste del 10-09 rimasta intatta.

### Tre cose imparate oggi che vale la pena non ridimenticare

- **Tre difetti su tre avevano la stessa forma**: dire una cosa e averne costruita un'altra. Il
  `Provider` dei gruppi dichiarato e mai fornito; il tracciato del percorso che «diventa inerte» in
  cattura e invece spariva; il selettore annunciato in una scheda di Configurazione che non esiste.
  I test provavano le due metà e nessuno il punto in cui si incontrano.
- Per questo `check_target_progetto.sh` prova la **catena intera** — rotta → `project.yaml` →
  `display-target` — e non i pezzi: è lì che un cablaggio dimenticato non si vede, perché la rotta
  risponde 204 e il file cambia lo stesso.
- Il test d'inventario del pannello proprietà **ha smesso di funzionare in silenzio** (apriva le
  sezioni con un evento nativo fuori da `act()`) e continuava a passare confrontando un inventario
  dimezzato con sé stesso. Un aiutante di test che fallisce in silenzio è peggio di nessun test.

## ▶ Da fare nella prossima sessione

### ⏱ T-69 — il Python di progetto non sa che ora è, e non può avere una cadenza sua (2026-09-11)

Il maintainer ha provato a farsi scrivere dall'assistente IA una rampa ciclica 0→100→0 con periodo
in decimi di secondo, e l'assistente si è fermato elencando i limiti. **Ho riverificato tutte e
otto le affermazioni nel codice**: sette reggono, una no — ed è quella che avrebbe fatto perdere
più tempo a chi apre il piano.

**Quello che blocca davvero:**

1. **Niente tempo dentro gli script.** L'API esposta è `tags.read`, `tags.write` e
   `send_telegram`, e basta (`sws-pyscript/src/lib.rs:572-577`, metodi a `:204-283`). Nessun
   orologio, nessun uptime, nessun «quanto è passato dall'ultima volta». Una rampa temporizzata
   **non è esprimibile**: lo script può solo avanzare di un passo, la cadenza la deve dare altro.
2. **Il trigger `interval` è in secondi interi** — `Interval { interval_s: u64 }`
   (`sws-core/src/project.rs:833`). Minimo 1 s, risoluzione 1 s: un `time_tick` sotto i 10 decimi
   non è generabile. `cron` sta più in alto ancora.
3. **Nessun generatore nativo** di rampa/onda/impulso sui tag, e nessun tipo di tag «generatore»:
   un tag con `expression` (`project.rs:48`) è calcolato, non animato.
4. **Le funzioni di progetto non hanno un trigger proprio**, e uno script globale **non può
   chiamarle**: l'unico modo di eseguirle è `on_press_fn`/`on_release_fn` da un oggetto o
   `POST /api/script/run/:name` (`router.rs:470`). Quindi la stessa logica va duplicata, o la
   periodicità arriva da fuori.
5. **Nessuno stato ritenuto per script**: per ricordare la direzione della rampa servono tag di
   servizio, che finiscono nell'elenco insieme a quelli d'impianto.
6. **Timeout di 5 s** (`SWS_SCRIPT_TIMEOUT_MS`, `sws-pyscript/src/lib.rs:5`): occupare il tempo con
   un ciclo non è una via d'uscita.
7. **Il Python non si prova davvero in IDE**: la verifica compila e non esegue, e **RestrictedPython
   è opzionale** — dove non è installato gli script girano con i builtin pieni
   (`lib.rs:339-344`). Quindi il divieto di `import` vale sul dispositivo ma non necessariamente
   dove si sviluppa: una differenza fra le due macchine che oggi non si vede.

⚠️ **L'ottava affermazione è sbagliata, e va corretta prima che diventi un requisito.** L'assistente
ha detto «`params[]` esiste ma non è chiaro come si passano i valori». **Si passano, e funziona
già**: `__sws_args__` viene iniettato come variabili globali dello script (`lib.rs:163-167`), il
chiamante API lo manda in `{"args": {…}}` (`RunBody`, `router.rs:4250`) e un oggetto in pagina lo
manda in `on_press_args` (`SvgCanvas.tsx:1741`). Il difetto **non è il meccanismo, è che non si
trova**: né la documentazione né l'IDE lo dicono abbastanza da permettere a chi guarda il progetto
di scoprirlo. Rimedio piccolo, non una funzione nuova.

**Cosa sbloccherebbe il caso, in ordine di resa** (dall'assistente, e le prime due mi paiono
giuste anche a me):

- **Un orologio in sola lettura nella sandbox**: `now_ms`, `uptime_ms` e soprattutto `delta_ms`
  dall'invocazione precedente. Con `delta_ms` la rampa si scrive in cinque righe **e diventa
  indipendente dalla cadenza del trigger** — che è la proprietà che conta: la logica smette di
  dipendere da quanto spesso qualcuno la chiama.
- **`interval_ms`** (o `interval_s` frazionario) sugli script globali.
- Un **tipo di tag «generatore»** nativo (rampa/triangolo/quadra) con periodo, limiti e
  abilitazione: coprirebbe anche tutti i collaudi senza impianto.
- Poter **chiamare una funzione di progetto da uno script globale**, e/o dare un trigger alle
  funzioni.
- **Stato ritenuto per script**, per non sporcare l'elenco tag con variabili d'appoggio.
- **Far trovare il passaggio dei parametri** (documentazione + IDE) — non è da implementare, è da
  mostrare.

**Quello che si può già fare oggi**, se serve prima: script globale con `interval_s: 1` che avanza
la rampa di `(limite_up - limite_down)/N` al secondo, con `time_tick` letto in decimi ma arrotondato
al secondo, e il limite scritto nel commento del codice.

### 📋 Dieci tracce dall'HOWTO — T-58…T-67 (2026-09-11)

`docs/HOWTO.md` è cresciuto a 14 capitoli, uno per ogni «come faccio a…» posto al vivo. Riletti
tutti insieme con una domanda sola — **«perché devo farlo a mano?»** — dieci hanno prodotto una
traccia. Ogni capitolo la nomina in coda, così il rimando vale nei due sensi.

Quattro capitoli **non** producono niente ed è giusto così, altrimenti qualcuno ci ritorna: §3
(certificato), §7 (chiave IA), §12 (installazione) e §13 (lista dispositivi) toccano hardware,
credenziali o scelte umane — o sono già diventati funzioni.

| # | Traccia | Costa oggi | Dove guardare |
|---|---|---|---|
| **T-58** | ✅ **FATTO** l'11-09-2026 — il target si cambia dal pannello destro, sezione «IMPOSTAZIONI PROGETTO» |
| **T-59** | Referto di compatibilità LVGL, chiesto al motore | «apri ogni pagina e guardala sul pannello» | `istantanea.rs:429` (`note_utili`), `main.rs:311-330` del viewer |
| **T-60** | Una fonte di verità sola su cosa il pannello disegna | quattro copie tenute insieme da quattro guardie | `lvgl_render.rs:68`, `LeftPanel.tsx:612`, `check_lvgl_types.sh` |
| **T-61** | L'archivio di release dice da quale ramo viene | due `mv` rituali a ogni prova su ramo | HOWTO §10; il nome dipende da `version`, non dal ramo |
| **T-62** | «Mostrami questa pagina come la disegna il pannello», nell'IDE | 4-5 comandi a scatto | `istantanea.rs` fa già tutto, per l'assistente |
| **T-63** | Una guardia di parità di rendering riusabile | 30-60 min riscritti da capo a ogni sospetto | `check_fuori_pagina_lvgl.sh` è l'esempio da parametrizzare |
| **T-64** | Dopo «dimentica la chiave», il software prova se entra | un giro di deploy perso se si sbaglia l'ordine | `sonda-dispositivo.sh` esiste e nessuno la lancia lì |
| **T-65** | `session_start.sh` dice stato della CI e spazio su disco | la CI è stata rossa **per mesi** senza che nessuno leggesse | `gh run list --limit 1`, `df -h` |
| **T-66** | Un lock negli script di build | è già costato una build di 51 minuti | `scripts/build_container*.sh` |
| **T-67** | Riscrivere HOWTO §1 | descrive un `podman run` che oggi è una quadlet | `sws-lvgl-viewer.container`, Q25 |

**Le tre della conversione, in dettaglio, perché sono legate.**

**T-58** è la più piccola e sblocca le altre. `PUT /api/project/target` accanto a
`/api/project/page-layout`, stesso genere di campo, più un selettore nel **pannello destro**, sezione
«IMPOSTAZIONI PROGETTO», accanto alle impostazioni di pagina: è lì che vivono già le cose di livello
progetto, e tenerne due case sarebbe il modo di farle divergere. ⚠️ Il piano diceva «Configurazione →
Progetto», ma **quella voce non esiste**: `ConfigView` ha sedici schede e nessuna è «Progetto».
Prima `target.kind` era letto in **un punto solo** dell'editor (`LeftPanel.tsx:668`) e non si vedeva
da nessuna parte. Passando dalla rotta **sparisce la trappola**: il progetto in memoria si aggiorna
e `display_target::publish` riscrive `display-target` da sé.

**T-59** è il referto **chiesto al motore vero** (decisione del maintainer). Attenzione a una cosa
che ribalta l'idea ovvia: `SUPPORTED_TYPES` contiene **già tutti e 35 i tipi**, quindi un referto
costruito sul *tipo* direbbe sempre «zero problemi» — mentirebbe per omissione. Le incompatibilità
vere sono a livello di **campo e valore** (`bar_orientation: horizontal`, `pie_mode` ≠ donut,
`symbol_id: custom:*`, le immagini PNG, `button_action` che sul pannello non fa nulla) e sono già
tutte nei `bail!` e nei «gap dichiarato». Il referto **esiste già**: il viewer stampa
`non supportati/ignorati (N)` a ogni pagina, e `istantanea.rs` sa già avviare un runtime usa e getta
e filtrare lo stderr utile — manca una costante e un giro sulle pagine. La finestra da copiare è
«Verifica collegamenti» (`LinkReportModal`), che ha già il pulsante «Vai» che salta alla pagina e
seleziona l'oggetto.

**T-60** è quella che rende inutili le altre due se fatta male: se il referto diventasse una lista
di limiti scritta a mano sarebbe la **quinta** copia della verità sul motore, e il giorno che il
motore cambia il referto mente.

⚠️ **Dieci tracce sono un debito dichiarato, non pagato.** Il valore è che smettano di essere
invisibili dentro una ricetta; il rischio è che questa sezione diventi un cimitero. Quelle che non
si faranno mai è meglio cancellarle che lasciarle a fare numero.


### ✅ T-68 — il Deploy dalla scheda Dispositivi non aveva credenziali da usare — **FATTO** (2026-09-11)

Segnalato dal maintainer provando: «Connetti» riesce, e subito dopo **Deploy** risponde
`✗ Login target fallito: 429 Too Many Requests`. La domanda che l'accompagna è quella giusta:
«come faccio il deploy qua se non posso inserire le credenziali?». **Oggi non puoi.**

Quattro cose, in fila, che si sono sommate:

1. **Un dispositivo registrato dal discovery nasce senza utente.** `dispositivoDaRete` e
   `dispositivoDaRuntime` (`dispositiviRegistrati.ts:72,78`) mettono `user: ""` — giustamente, chi
   fa il discovery non sa come è configurato quel pannello.
2. **E non c'è modo di aggiungerlo dopo.** Il campo password nella riga compare solo se
   `mancaPassword`, che è `!!d.user && …` (`ConfigView.tsx:10118`): con l'utente vuoto è **sempre
   falso**, quindi il campo non appare mai. La riga non mostra nemmeno **quale** utente è
   registrato, quindi non si vede che è vuoto. L'unica via è cancellare il dispositivo e
   riaggiungerlo dal modulo in basso, che i campi ce li ha.
3. **Il deploy fa comunque il login**, con utente e password vuoti
   (`deployToTarget`, `ConfigView.tsx:9840-9845`) — e non ha la lezione di T-57: su un pannello
   **senza utenti** il login non serve affatto, e fallisce comunque perché quell'utente non esiste.
   È la stessa divergenza già vista oggi fra i due percorsi di deploy: questo è un secondo deploy,
   scritto nel browser, separato da `remote_deploy`.
4. **I tentativi falliti bloccano l'account.** Cinque in 60 s (`main.rs:425-432`) e scatta il
   lockout; e «*while already locked: extend lockout on every new attempt*»
   (`sws-auth/src/lib.rs:772`) — quindi **riprovare lo tiene bloccato**. Il messaggio dice solo
   «429 Too Many Requests», che non spiega né la causa né che basta aspettare un minuto **senza**
   ritentare.

Da fare: rendere modificabili utente e password di un dispositivo già in lista (e mostrarli nella
riga); far saltare il login al deploy quando il dispositivo dichiara `auth_required: false`, come
fa già «Connetti»; e tradurre il 429 in una frase che dica di aspettare **senza** ritentare. Da
valutare se questo secondo percorso di deploy debba esistere o confluire in `remote_deploy`.

**Nel frattempo**, per sbloccarsi: cancellare il dispositivo e riaggiungerlo dal modulo
«Aggiungi dispositivo» compilando Utente SWS e password, oppure usare «Deploy progetto attivo»
nella sezione Runtime, che passa dall'altro percorso. Il lockout si scioglie da sé in 60 s se non
si ritenta.

**Fatto l'11-09-2026**, ramo `fix/T-68-credenziali-dispositivi`. I punti 1-4 sono chiusi:
l'utente ha una colonna sua nella riga, modificabile, col bordo giallo quando manca — e cambiarlo
scarta la password in memoria, che è quella *di quell'utente*; il deploy guarda `auth_required` in
`/api/system` e su un pannello senza utenti non fa il login né manda l'header; con le credenziali
davvero mancanti non tenta affatto, perché un login a vuoto è un fallimento sicuro su un budget di
cinque; e il 429 ora dice quanto aspettare e **di non riprovare**, che è la cosa che dal codice di
stato non si indovina.

Le decisioni stanno in `src/config/credenzialiDispositivo.ts` con 11 test: quando serve il login
(«non lo so» vale prudenza, si prova) e come si spiega un rifiuto.

⚠️ **Resta aperta la domanda più grossa**, di proposito: se questo **secondo percorso di deploy** —
scritto nel browser, separato da `remote_deploy` — debba esistere o confluire. Due implementazioni
della stessa operazione sono il modo in cui si diverge, e oggi divergono già: `remote_deploy` ha la
casella «Sostituisci anche gli utenti» e la conferma 428, questo no.

**Da provare a mano**: dispositivo preso dal discovery → scrivere l'utente nella riga → Deploy. E
su un pannello appena installato senza utenti, il deploy deve partire **senza** chiedere nulla.


### 🔌 La scheda Dispositivi registrati: tre asperità tolte (2026-09-11)

Viste dal maintainer provandola.

- **L'URL preferisce il nome mDNS.** In lista finiva l'indirizzo (`http://192.168.1.61:8444`) col
  nome `.local` lì accanto e inutilizzato. L'indirizzo lo assegna il DHCP e cambia; il nome segue
  il dispositivo, e una lista registrata per indirizzo invecchia da sola senza che nessuno se ne
  accorga finché «Connetti» non risponde più. `preferisciMdns` sostituisce il solo host numerico
  IPv4: un dispositivo che annuncia già un nome suo lo tiene.
- **«Utente» e «password» non dicevano quali fossero**: sono le credenziali applicative SWS, non
  quelle SSH. Ora si chiamano così e portano la stessa riga di spiegazione di T-57 — era proprio
  la confusione che T-57 aveva tolto altrove, in un pannello che allora non era stato guardato.
- **«Connetti» non rispondeva**: un fallimento finiva in `console.warn`. Ora dice «Connessione…»
  mentre lavora, l'esito compare sotto la tabella in verde o rosso col motivo, e sul dispositivo
  connesso il pulsante diventa **Disconnetti** verde — solo per quello a cui si è davvero
  connessi, non per tutti quando una connessione è aperta da qualche parte.


### 🎨 Il pannello destro prende la forma di quello sinistro — **su `main`** (2026-09-11)

Seguito di T-56, chiesto dal maintainer dopo la prova rapida: «completerei l'IDE con il menù a
destra nello stile di quello sinistro». Le sezioni canoniche si raccolgono in **cinque** gruppi
(🧩 Oggetto, 🅣 Testo, 📊 Dato, ⚡ Comportamento, 👁 Resa) e se ne vede uno per volta, con la stessa
barra di icone del pannello sinistro — `BarraIcone` è ora un componente solo in `stilePannelli`,
`lato` decide da che parte cade il bordo.

Due aggiunte chieste guardando il pannello nuovo: **«Testo» ha una scheda sua** (è il blocco più
fitto e su un `text` soffocava il resto) ed è l'unico gruppo che non vale per tutti i tipi — cinque
icone su un testo, quattro altrove, perché una scheda vuota è peggio di una assente; **«Identità»
e «Posizione e dimensioni» sono una sezione sola** con le etichette a fianco dei campi invece che
sopra, circa 70 px recuperati.

Scelte prese in corsa, tutte scritte nel codice: «Elimina oggetto» resta nel solo gruppo Oggetto
(in gruppi corti finirebbe sotto il pollice in tutti e quattro); la barra non compare con la
selezione multipla né su una cella di griglia, e quella decisione è una funzione pura
(`barraGruppiVisibile`) perché le condizioni sulla griglia vivono in due punti; le sezioni fuori
gruppo rendono `null` invece di nascondersi col CSS.

**Il criterio di accettazione è stato rispettato**: il test d'inventario ora gira i quattro gruppi
e `tests/fixtures/campiPannelloProprieta.json` è rimasto **byte-identico** — ogni sezione è finita
in un gruppo, e in uno solo. Provato rosso assegnando una sezione a un gruppo inesistente.
⚠️ **Un difetto trovato dal maintainer e la lacuna che l'ha lasciato passare.** Alla prima stesura
il `Provider` del contesto non c'era: la barra si illuminava, il titolo cambiava da OGGETTO a DATO,
e sotto restavano le sezioni del gruppo Oggetto perché `CollapsibleSection` leggeva il valore di
default. Il contesto aveva **due consumatori e zero fornitori**. Nessun test se n'era accorto: quello
dell'inventario **fornisce lui** il contesto per girare i gruppi, quindi provava l'assegnazione
delle sezioni e non il cablaggio; gli altri provavano funzioni pure e la barra isolata. Nessuno
guardava il punto in cui le due metà si incontrano. Il guscio è diventato un componente,
`PannelloDestro`, con il `Provider` dentro, e tre test nuovi con un figlio-spia — provati rossi
rimettendo il difetto.

Gate: tsc, eslint, 299 vitest, `pnpm build`, 17/17 guardie statiche.

**Da provare a mano**: le quattro icone e la scelta che sopravvive al ricaricamento; su
`rect`/`text`/`trend`/`symbol`/`grid` girando i gruppi si ritrovano tutte le sezioni di prima;
selezione multipla, cella di griglia e nessuna selezione senza barra; tema chiaro e scuro;
larghezza ancora regolabile; pagina bloccata che disabilita ancora tutto.

⚠️ **Una guardia statica è fallita una volta sola e non si è più ripetuta**: `check_static.sh` ha
dato `check_demo_templates` come «non classificata» pur essendo in `STATICHE`, subito dopo un
`pnpm build`; tre esecuzioni successive sono verdi. Non l'ho inseguita perché non l'ho riprodotta —
se ricapita, vale la pena guardarci.


### ✅ La giornata dell'11-09 è su `main`, in sei commit (2026-09-11)

**Pulizia dei rami, stesso giorno.** Cancellati gli undici rami il cui contenuto era già in `main`,
dopo tre verifiche: nessun file esclusivo, contenuto identico al rispettivo commit di squash, e —
per i piani, che nel frattempo si erano spostati in `docs/archive/` — confronto riga per riga fra la
versione sul ramo e quella archiviata (zero righe perse; le tre che ho ampliato sono
soprainsiemi esatti). Le punte, se un giorno servissero:

| Ramo | Punta |
|---|---|
| `docs/lvgl-default` | `f2c59588` |
| `fix/ci-librerie-di-sistema` | `071861a0` |
| `fix/ci-sbom` | `bf46d06e` |
| `fix/riepilogo-senza-root` | `a98abac7` |
| `fix/ci-toolchain` | `8d16718f` |
| `fix/etichetta-os-doppia` | `2ec42344` |
| `feat/Q48-installa-dalla-welcome` | `21664404` |
| `feat/Q50-dispositivi-sul-server` | `28baefcd` |
| `feat/Q51-Q52-installa-guidata` | `bfa0bd47` |
| `feat/Q53-crossbuild-arm64` | `0079cf67` |
| `feat/T-57-credenziali-sws-vs-ssh` | `c4084cfe` |
| `feat/utenti-nel-progetto` | `9d2eb119` |
| `main-pre-merge-2026-09-11` | `afbbbc43` |
| `feat/T-56-pannello-destro` | `6ef970ff` |
| `feat/T-53-waypoint-sul-canvas` | `5ef99e72` |
| `fix/T-68-credenziali-dispositivi` | `b938f675` |
| `feat/T-58-target-dall-ide` | `3569f9ed` |

⚠️ **Quei rami non andavano mergiati, solo cancellati**, ed è il motivo per cui li ho provati in un
worktree isolato prima di decidere: sono più vecchi di `main`, e un merge «per sicurezza» avrebbe
riportato indietro il codice. Misurato: `feat/Q50` avrebbe **tolto** `data_path` da `deviceProbe`,
arrivato dopo con Q53. E tutti tengono ancora i piani al vecchio percorso `docs/plans/`: mergiarne
uno avrebbe fatto ricomparire venti file accanto ai loro gemelli in `docs/archive/`.

**Tenuto un ramo solo**: `backup/main-pre-riscrittura-2026-09-09` — l'unica copia della storia dei
15 commit usciti come `pixsysedp`; su `origin` è stata force-pushata via. Ha un file che `main` non
ha più (`sws-web/src/deploy.rs`, rimosso da Q48). **Non si tocca.**

Dopo il push sono stati cancellati anche gli altri, che il maintainer teneva come rete:
`feat/utenti-nel-progetto` (`9d2eb119`, i 13 commit originali prima della ricostruzione in sei),
`main-pre-merge-2026-09-11` (`afbbbc43`, la punta di `main` prima di quel merge) e
`feat/T-56-pannello-destro` (`6ef970ff`, il pannello destro e la scheda Dispositivi, ricostruiti in
tre commit). Le punte sono tutte nella tabella qui sopra: un ramo cancellato prima o poi sparisce
anche dal reflog.

**Alla sera dell'11-09-2026 `main` è a `e6ff656e`, allineato a `origin/main`, e in locale resta il
solo ramo di backup.**

Il lavoro era cresciuto tutto su `feat/utenti-nel-progetto`, in sequenza. Invece di impacchettarlo
in un `merge --squash` solo, è stato **ricostruito su `main` come sei commit distinti**, uno per
lavoro, ognuno con l'albero esatto del punto corrispondente del ramo (verificato: i sei alberi
coincidono con quelli del ramo, e la punta di `main` coincide con la punta del ramo — nessun file
perso o aggiunto):

| Commit | Lavoro |
|---|---|
| `fdc7d63f` | T-57 — il pannello appena installato rifiutava la connessione |
| `64c1b0db` | gli utenti appartengono al progetto |
| `80fc4e3d` | i 19 piani conclusi escono da `docs/plans/` |
| `8ff30255` | `alarm_banner` divergeva fra browser e pannello (chiude l'audit 2026-08-06) |
| `0367ddfe` | la via di fuga STOP ha una guardia |
| `bd26c74f` | T-56 + T-55 — i due pannelli dell'editor |

Gate su `main` dopo il merge: `cargo fmt/clippy -D warnings`, 26 suite Rust verdi, 275 vitest,
tsc, eslint, `pnpm build`, 17/17 guardie statiche.

**Pushato** l'11-09-2026 in fast-forward, `afbbbc43..1d3f3997` (otto commit, i sei più due meta);
locale e `origin/main` verificati allineati dopo il fetch.

**Resta da collaudare a mano** (il maintainer ha fatto solo una prova rapida dell'editor): il
deploy con e senza la casella utenti, la conferma 428 che non deve ripartire in ciclo, le sei viste
del pannello sinistro, le sezioni canoniche su `rect`/`text`/`trend`/`symbol`/`grid`, e sul
pannello un allarme rientrato **non** confermato, che deve restare nella barra LVGL.


### 🛟 La via di fuga STOP ora ha una guardia (2026-09-11)

Il piano del 2026-09-03 (vincoli riusabili per un secondo progetto) è stato riverificato vincolo
per vincolo: **tutti e undici erano rispettati**. A mancare era chi se ne accorgesse se
smettessero — la via di fuga era tenuta in piedi dalla memoria di chi l'aveva scritta.

Due aggiunte: `scripts/check_via_di_fuga.sh` (17ª guardia statica, vincoli 1-7 e 11, **provata
rossa in tre modi** — l'azione sullo schermo prima del controllo di modalità, cioè il guasto vero
della 2.3.0; una lettura sola al posto del ciclo; un `systemctl stop chromium@wp-control`) e
quattro test su `display_target::publish` per il vincolo 8, che era l'unico senza rete: riscrivere
`display-target` identico farebbe scattare `PathChanged=` e riavviare il programma a schermo, cioè
un lampeggio del pannello a ogni salvataggio. Il test parte da un file senza newline finale, così
distingue «non ha scritto» da «ha riscritto identico» senza dipendere dall'mtime.

Restano aperti di proposito: il `RIPIEGO` pre-PixsysOS 2.1.0 (si toglie quando 2.1.0 è su tutto il
parco installato — decisione del maintainer, si trova cercando `RIPIEGO`) e **Q25**, che questo
meccanismo serve ma non chiude.

Il piano è archiviato. In `docs/plans/` restano quattro piani.


### 🔔 `alarm_banner` si comportava in due modi — audit del 2026-08-06 chiuso (2026-09-11)

Riverificando l'audit prima di archiviarlo, sei sezioni su sette erano già chiuse dal lavoro
ordinario (binding, color picker, `faceplate` nella palette, i quattro tipi widget mancanti,
`check_synoptic_schema.sh` come specchio automatico, `src/id.ts`). La settima era **peggio** di
come il piano la descriveva: non un'incoerenza fra widget ma una **divergenza fra i due motori** —
il `alarm_banner` del browser mostrava gli allarmi da confermare (`active_unacked` +
`normal_unacked`), quello del viewer LVGL gli allarmi **attivi**. Stesso progetto, stesso banner,
due comportamenti a seconda del pannello; nessun test poteva notarlo, sono due linguaggi e due
crate.

**Decisione del maintainer: la barra mostra quelli da confermare** (ISA-18.2) e il viewer LVGL si
allinea. Campanella e viewer restano sugli **attivi**: tre widget, tre mestieri.

`AlarmStateLite` acquista `isa_state`, perché la decisione **non è derivabile** dai due booleani
di compatibilità — un allarme rientrato e confermato (`normal`) arriva con `acknowledged: false`,
per come `sync_compat` li deriva in `sws-core`. La scelta è una funzione pura per parte
(`nella_barra`, `nellaBarra`), 4 test Rust + 3 vitest, e la guardia nuova
`scripts/check_barra_allarmi.sh` (statica, la 16ª) verifica che le due nominino gli stessi stati —
**provata rossa in due modi**: rimettendo il filtro `a.active`, e facendo nominare a un motore un
insieme diverso. Gate: 527 test Rust, 234 vitest, clippy, fmt, tsc, eslint, 16/16 guardie statiche.

**Da provare a mano sul pannello**: far scattare un allarme, farlo rientrare **senza** confermarlo
— deve restare nella barra del pannello LVGL, come già faceva nel browser.


### 🗂️ I piani conclusi sono passati in `docs/archive/` (2026-09-11)

`docs/plans/` era diventato un misto di lavoro fatto e lavoro da fare: 25 file, di cui 19 finiti o
superati. Quelli sono ora in [`docs/archive/`](docs/archive/README.md), con la tabella di stato e
l'evidenza per ciascuno; i **33 riferimenti** che li citavano (CHANGELOG, STATUS, `docs/`, e
`sws-runtime/.cargo/audit.toml`) sono stati riscritti nello stesso commit, e `git log --follow`
continua a seguirli. La regola «i file di `docs/plans/` non si spostano», scritta il 2026-09-06
proprio per via di quei riferimenti, è decaduta con l'instruzione del maintainer; CLAUDE.md ora
dice di archiviare un piano quando finisce.

Restano vivi quattro piani: `2026-08-21-scada-widgets` (F5.3x), `2026-08-31-chat-ai-nelleditor`
(passi 3-6 e chat staccata), `2026-09-03-via-di-fuga-stop-pixsys` (vincoli, non lavoro),
`2026-09-10-T56-pannelli-editor` (da fare) e `2026-09-11-utenti-nel-progetto` (realizzato, non
ancora collaudato né mergiato).

⚠️ **Una correzione a quanto avevo scritto qui il mattino dell'11-09.** Avevo tenuto fuori
dall'archivio `2026-08-06-audit-widget-e-codice` dicendo che il binding sui campi di `pipe`
mancava: **era falso**, la mia finestra di `grep` era troppo corta. `pipe` è bindable su tutti e
cinque i campi. Riverificando l'audit per intero (vedi la voce sotto) sei sezioni su sette erano
già chiuse, e il piano è ora archiviato.


### 👥 Gli utenti appartengono al progetto — su `main` (2026-09-11)

Sviluppato su un ramo impilato su T-57, perché il log nuovo del deploy usa `senza_utenti()`, che
T-57 ha riscritto; su `main` i due sono due commit in fila, `fdc7d63f` poi `64c1b0db`.

Decisione del maintainer, che **rovescia** quella del 2026-07-30: *«gli utenti partono dal
progetto e se ricarico il progetto sul pannello devo poterli sovrascrivere»*. Quella vecchia,
oltretutto, non era mai stata una regola: `users.yaml` veniva saltato solo ridistribuendo un
progetto con lo **stesso nome**, quindi il comportamento dipendeva da una coincidenza di nomi
invisibile a chi premeva il pulsante.

Cinque scelte, tutte del maintainer: sostituisce per default con casella per saltare; progetto
senza utenti ⇒ dispositivo senza utenti (pannello aperto, conseguenza accettata); il seed da env
diventa di **solo recupero**; conferma esplicita quando il deploy toglierebbe ogni account a un
dispositivo che ne ha; l'auto-deploy del salvataggio **non** porta gli utenti.

Fatto, in quattro commit: `sws-auth` con `applica_seed_di_recupero` (5 test nuovi, 16 in tutto);
`replace_users` a tre stati in `UploadQuery` con due funzioni pure; `DeployBody` e il **428**
deciso sul server prima di toccare qualcosa, con l'elenco degli account che sparirebbero;
`api.deployToRuntime()` unica per ConfigView e store, casella e `window.confirm` che si richiama
una volta sola. `report_user_divergence` smontata: girava dopo `open_project`, prendeva 401 e
stampava lo stesso «Il deploy non ha modificato gli account del dispositivo».

⚠️ **`scripts/check_deploy_preserve.sh` ha un'asserzione rovesciata di proposito**: dove
pretendeva «utenti del dispositivo conservati» ora pretende il contrario. È scritto in testa al
file — non è una regressione. Tre casi nuovi (casella spenta, 428 senza conferma, rimozione con
conferma) più il codice d'uscita, che prima mancava: lo script stampava e usciva 0 comunque.

Gate: 523 test Rust, 231 vitest, clippy `-D warnings`, fmt, tsc, eslint, build;
`check_deploy_preserve.sh` 7/7 casi, `test_t34.sh` 21/21, `check_no_admin.sh` 31/31,
`check_static.sh` 15/15, `check_password_browser.sh`, `check_documenti.sh`. Q54 aperta (un
dispositivo che crea utenti propri). **Su `main` dall'11-09-2026** (`64c1b0db`), non pushato.

**Da provare a mano** con i due runtime locali: casella accesa da un progetto con utenti → sul
dispositivo si entra con le credenziali **del progetto**; casella spenta → valgono ancora le
vecchie; salvataggio a connessione attiva → gli utenti del dispositivo non cambiano; progetto
senza utenti → la conferma compare **una volta sola** e non riparte in ciclo. Poi un giro vero
sul WP630.

⚠️ **Compatibilità**: un dispositivo non aggiornato ignora `replace_users` e tiene i suoi utenti;
l'IDE dirà «sostituiti» e non lo saranno. Va aggiornato prima il runtime del dispositivo.


### 🔌 T-57 — il pannello appena installato rifiutava la connessione: ramo `feat/T-57-credenziali-sws-vs-ssh` (2026-09-11)

Il maintainer, da casa, aveva preparato `docs/archive/2026-09-11-diagnosi-login-8444.md` con
l'ipotesi «credenziali applicative SWS confuse con quelle SSH». In ufficio la precisazione che
ha cambiato tutto: **il pannello era appena installato pulito, senza progetto** — utenti residui
non ce ne potevano essere, e il primo deploy doveva passare.

Misurato sul WP630 prima di scrivere codice: `whoami` → **404**, `/api/system` → 200 con
`auth_required: false`, `login` → 401. `senza_utenti()` (`remote.rs`) sondava
`/api/auth/whoami`, che non è montata in `deploy_only_app`, cioè la porta di gestione di **ogni**
runtime in container. Il 404 diventava «ha utenti» e l'editor rifiutava una connessione che
sarebbe passata. La protezione del 2026-09-08 non ha mai funzionato sui dispositivi veri.

Fatto sul ramo: sonda `/api/system` con la decisione estratta in `niente_autenticazione()`
(pura, 3 test); etichette «Utente SWS»/«Password SWS» e «Utente SSH»/«Password SSH» con due
righe di spiegazione speculari; `check_no_admin.sh` §2d **legge dal sorgente quale rotta sonda
`senza_utenti`** e la prova sulla porta stretta — provata rossa rimettendo `whoami`, dice il
guasto con le parole giuste. Gate: 513 test Rust, 231 vitest, clippy, fmt, lint, build, guardie.

Prova end-to-end contro il WP630 con le stesse credenziali del caso reale: `ok: true` più la
nota «non ha utenti definiti: connesso senza autenticazione». **Su `main` dall'11-09-2026**
(`fdc7d63f`), non pushato.

**Da provare a mano**: dall'editor, «Connetti» al pannello appena installato scrivendo un utente
qualsiasi → si collega e mostra la nota; poi il deploy. E guardare che le due coppie di campi
ora si distinguano a colpo d'occhio.

**Nota per dopo**: dopo il primo deploy su un dispositivo vuoto, `users.yaml` del progetto viene
estratto (solo al primo upload di un nome nuovo; i ri-deploy lo saltano) e da quel momento il
pannello **pretende** gli utenti del progetto. È il comportamento voluto, ma è il prossimo punto
in cui la connessione può sembrare rompersi da sola.


### ✅ T-53 — i waypoint del percorso di movimento si modificano sul canvas — **FATTO** (2026-09-11)

Riguarda **MOVIMENTO su percorso** (F6.10, `motion_path` di un oggetto: `types/index.ts` L269,
sezione MOVIMENTO in `EditorShell.tsx` ~L4514, cattura ＋ e crocino in `SvgCanvas.tsx` ~L636 e
~L1820). Oggi i waypoint si vedono solo come **tabella** di coordinate nel pannello proprietà,
il canvas mostra un crocino soltanto per la riga in modifica, e si aggiungono solo con la
cattura ＋ (click sul canvas, Esc per uscire). Il maintainer vuole che il percorso si veda e si
modifichi **direttamente sul disegno**, e che la tabella smetta di occupare spazio:

1. **«Mostra tracciato»**, opzione **attiva di default**: con l'oggetto selezionato si vedono i
   crocini di tutti i waypoint e una linea che li collega **nell'ordine logico** (da `min` a
   `max` del tag di movimento), non solo il crocino della riga in modifica.
2. **Trascinare i crocini** per riposizionarli; la tabella si aggiorna da sola.
3. **Eliminare un crocino dal canvas**: si seleziona e si preme **Canc**.
4. **Aggiungere un crocino dalla linea**: si seleziona un segmento del tracciato e si sceglie
   «Aggiungi» (in coda) o «Dividi» (nel punto cliccato, fra i due waypoint del segmento).
5. **La tabella delle coordinate è nascosta di default** e si apre solo quando serve correggere
   un waypoint a mano, digitando le coordinate.

Vincoli che valgono già: WYSIWYG (le regole UI dell'editor in `CLAUDE.md`: il ramo edit-mode
usa lo stesso rendering del runtime, gli effetti — il movimento compreso — con «Anteprima
effetti»), **una sezione per dato** (la tabella e i crocini scrivono lo stesso `motion_path`:
un solo punto di verità nello store, la tabella è una vista), niente polling. Da guardare come
modello le **maniglie dei waypoint delle pipe** già presenti (`SvgCanvas.tsx` ~L1878: pipe
singola selezionata in edit mode, drag con `openInteraction`), che fanno metà del lavoro per un
altro oggetto: il tracciato del movimento è la stessa cosa con un ordine e un tag.

Non ancora pianificato nel dettaglio: quando si parte, piano in `docs/plans/` e ramo
`feat/T-53-waypoint-sul-canvas`.

**Confermato dal maintainer l'11-09-2026** («funziona come mi aspettavo»). Piano archiviato in
[`docs/archive/2026-09-11-T53-waypoint-sul-canvas.md`](docs/archive/2026-09-11-T53-waypoint-sul-canvas.md).
Tutti e cinque i punti. Due scelte del maintainer: i comandi «Dividi qui»/«Aggiungi in coda» sono
una **barretta sul canvas** accanto al segmento scelto, e la **cattura ＋ resta** (serve a posare
molti punti di fila) con l'overlay che si fa da parte mentre è attiva.

Tre cose decise scrivendo, tutte motivate nel codice: il tracciato **non** dipende da «Anteprima
effetti» né da `motion_tag` — quello accende il movimento, e un percorso si modifica guardandolo
fermo; il tag è la variabile che lo percorre e la geometria esiste prima. Il drag apre
`openInteraction` come i waypoint delle pipe, altrimenti `updateObject` riempirebbe la cronologia
di un passo per pixel. La barretta è in SVG puro, non in `foreignObject`: tutto diviso per lo
zoom, come le maniglie.

`src/canvas/percorsoMovimento.ts` raccoglie le decisioni: `puntiMovimento` legge anche la forma
`[[x,y]]` che il viewer LVGL accetta «perché è quello che si trova nei progetti veri» — senza,
le maniglie uscirebbero a NaN proprio sui progetti vecchi; `dividiSegmento` è uno `splice` perché
l'ordine dell'array **è** l'ordine da `motion_min` a `motion_max`; `cosaCancella` dichiara la
precedenza del tasto Canc, che senza si porterebbe via l'oggetto intero (con un waypoint scelto
l'oggetto è selezionato anche lui).

24 test dove non ce n'era **nessuno**. ⚠️ **Un anello resta scoperto**: che l'handler della
tastiera chiami `cancellaWaypointScelto()`. La funzione è provata contro lo store vero, il suo
unico punto di chiamata no — servirebbe montare `EditorShell`. Verificato a mano dal maintainer.

**Due difetti trovati al primo uso, corretti subito** (`9c44e8a7`): il tracciato spariva durante
la cattura ＋, quindi si posavano punti alla cieca — nel codice era finito `!captureTarget` invece
dello stile inerte che il piano diceva; e rilasciando un crocino si perdeva la selezione, perché il
`click` risaliva all'`<svg>` e deselezionava. Il secondo **era più vecchio di T-53**: vale anche
per i waypoint delle pipe e per le maniglie di ridimensionamento, e i crocini l'hanno solo reso
facile da incontrare.


### 🪟 T-54 — il log staccato sparisce dal fondo, si sgancia dalla sua barra, si nasconde e si riaggancia (richiesta del maintainer, 2026-09-10)

Oggi «Log in una finestra» (menu ☰ → `staccaLog`, `App.tsx` ~L126, via `apriFinestra`) apre
`index-log.html`, ma il cassetto in basso **resta**: `App.tsx` ~L837 rende `<LogPanel open={logOpen}>`
senza guardia. La chat, che è il modello, fa già la cosa giusta: `open={chatOpen && !chatStaccata}`
(~L830) e `staccaChat` chiude il cassetto (~L233-236). Lo sgancio del log si raggiunge solo dal
menu, non dalla barra del pannello (`LogPanel.tsx` ~L137-242: i pulsanti dei livelli a ~L213-237,
la ✕ a ~L239-241). La finestra separata (`LogWindow.tsx`) non ha né «Nascondi» né «Riaggancia», e
alla sua chiusura nessuno riporta il cassetto: `sorvegliaChiusura` annulla solo una ref
(`App.tsx` ~L140), che non è reattiva. Il maintainer vuole:

1. **Staccato il log, il cassetto sparisce dal fondo pagina** (e la voce «Pannello log» del menu si
   spegne con un suggerimento, come `menu.chatDetachedHint`).
2. **Il pulsante di sgancio sta nella barra del log**, fra i pulsanti dei livelli (…ERROR) e la ✕ in
   alto a destra.
3. **Nella finestra separata**: «**Nascondi**» riporta il fuoco all'editor e lascia la finestra
   dietro senza chiuderla (i browser non hanno minimize; il log continua a scorrere);
   «**Riaggancia**» chiude la finestra e riapre il cassetto in basso.

Come farlo, in breve: uno stato `logStaccato` al posto della ref, messo a `true` in `staccaLog`
(che chiude anche il cassetto, come `staccaChat`) e a `false` nel callback di `sorvegliaChiusura`;
la guardia `open={logOpen && !logStaccato}`; «Riaggancia» = la finestra si chiude da sé
(`window.close()`) e l'editor, al `sorvegliaChiusura`, riapre il cassetto solo se era stato
riagganciato e non semplicemente chiuso — serve un segnale: basta un `localStorage` flag
`sws.log.riaggancia` scritto dalla finestra prima di chiudersi, o il ponte `BroadcastChannel` che la
chat già usa (`ai/ponte.ts`) se si vuole anche sopravvivere al reload dell'editor. Chiavi i18n
nuove (it **e** en, c'è il test di parità): `logs.detach`, `logWindow.hide`, `logWindow.reattach`,
`menu.logDetachedHint`. Test: `tests/apriFinestra.test.ts` è il posto per le regole nuove sul
riaggancio. Ramo: `feat/T-54-log-staccato`.

### 🧹 T-55 — la sezione CRONOLOGIA esce dal pannello sinistro (richiesta del maintainer, 2026-09-10)

`HistorySection` (`LeftPanel.tsx` ~L1750-1856, montata a ~L1737) è aperta di default, alta fino a
180 px più i pulsanti Annulla/Rifai: «troppo invasiva». Decisione del maintainer: **toglierla dal
pannello**. Annulla e Rifai restano dove sono già, con Ctrl-Z / Ctrl-Y (`EditorShell.tsx` ~L393-396,
elenco scorciatoie ~L1073); l'elenco visuale dei passi (`past`/`future` dello store, `jumpToPast`/
`jumpToFuture`) resta raggiungibile **dal menu** (o da un popover sui pulsanti Annulla/Rifai, se in
sede di realizzazione risulta più a portata). Le chiavi `editor.historyBack`/`historyRestore` e
`shortcut.undo`/`redo` ci sono già; «CRONOLOGIA», «Stato iniziale», «▶ CORRENTE», «↶ Annulla», «↷
Rifai» sono oggi stringhe fisse e passano alle chiavi mentre si sposta il componente. Ramo:
`feat/T-55-cronologia-fuori-dal-pannello`. Piccolo: si può fare insieme a T-54.

**Fatto l'11-09-2026**, dentro il lavoro su T-56 (ne era il prerequisito). L'elenco dei passi è
una tendina `▾` accanto a ↶/↷ nella barra dell'editor: **i due pulsanti c'erano già lì**, quindi
togliendo la sezione non si è perso nessun comando, solo la lista — che ora sta accanto ai comandi
che fanno la stessa cosa. Le cinque stringhe fisse sono passate a i18n in entrambe le lingue.


### 🎨 T-56 — i due pannelli dell'editor: una vista per volta a sinistra, sezioni canoniche a destra (2026-09-10)

Richiesta del maintainer: «non è molto chiara la divisione pagine/oggetti… si fondono un po' tutte
le sezioni, e a destra le proprietà andrebbero riorganizzate in modo più ordinato». **Piano scritto
e deciso, non realizzato: `docs/plans/2026-09-10-T56-pannelli-editor.md`.**

Decisioni prese: a sinistra **una vista per volta** (barra di icone verticale — Pagine, Oggetti,
Struttura, Tag, Sorgenti, Funzioni — e la vista scelta occupa tutta l'altezza); a destra **sezioni
canoniche** nello stesso ordine per ogni tipo, senza più controlli sciolti sopra; **struttura e
stile insieme**, con una scala condivisa di spaziature e dimensioni in `src/editor/stilePannelli.ts`
usata da entrambi i pannelli.

Perché si fondono, misurato: le sette fisarmoniche di sinistra hanno tutte la stessa intestazione
(che ignora perfino il proprio parametro `open`), l'unico separatore vero è quello della
Cronologia, e nessuna ricorda se era aperta; la palette annida una terza intestazione ancora
diversa; a destra due terzi del pannello sono controlli sciolti (~14 per un `rect`, ~20 per un
`text`) con micro-titoli in linea ripetuti in dieci punti; i due pannelli non condividono nessuno
stile, e la selezione multipla ha una seconda tassonomia di sezioni con altri nomi.

Tre passi mergiabili separatamente: (1) fondamenta — scala e componenti condivisi, adottati senza
spostare niente; (2) sinistra — dipende da **T-55** (la Cronologia deve uscire prima); (3) destra —
il più lungo, `ObjectProps` è una catena di ~65 rami. Rete di sicurezza per il passo 3: un test che
per ognuno dei 35 tipi verifica che l'insieme dei campi resi sia identico a prima. Vincolo che non
si tocca: «una sezione per dato» (`CLAUDE.md`) — le sezioni si rinominano e si riordinano, un campo
resta in un posto solo. Ramo: `feat/T-56-pannelli-editor`.

**Realizzato l'11-09-2026, tutti e tre i passi, e su `main`** (`bd26c74f`, insieme a T-55) —
non ancora collaudato a fondo dal maintainer, che ha fatto solo una prova rapida.

- **Passo 1** `src/editor/stilePannelli.tsx`: scala (spaziature 4/6/8/12; testo per rango 11 titolo,
  11 etichetta, 12 riga, 10 nota) più `IntestazioneSezione` e `RigaProprieta`, adottati da entrambi
  i pannelli senza spostare niente. L'intestazione è un `<button>`: a sinistra era un `<div>`, cioè
  inaccessibile da tastiera. Memorie tutte sotto `sws.pannelli.`, con migrazione delle
  `sws.objprops.*`.
- **Passo 2** barra di icone da 40 px fuori dal ridimensionamento, una vista per volta a tutta
  altezza, scelta ricordata. I tetti in pixel dei corpi valgono solo in colonna (`useCorpo`). «OGGETTI
  PAGINA» → «STRUTTURA». Cinque test, compreso il caso della vista memorizzata che non esiste più.
- **Passo 3** tredici sezioni canoniche nello stesso ordine per ogni tipo; «Parametri» solo per i 31
  tipi che ne hanno una; memoria **per tipo**; `CrossTypeProps`/`MultiSelectionProps` coi nomi
  canonici; 12 micro-titoli ricondotti a un `SottoTitolo` solo; 20 stringhe a i18n.

⚠️ **Il test d'inventario aveva un difetto che lo rendeva inutile proprio quando serviva**: apriva
le sezioni con `nodo.click()`, evento nativo fuori da `act()`. Con l'annidamento del passo 3 ha
smesso di aprirle e **continuava a passare**, confrontando un inventario dimezzato con sé stesso.
Ora usa `fireEvent.click` e lancia se dopo otto giri restano sezioni chiuse. La base di confronto è
stata rigenerata dal codice del passo 2 con l'aiutante corretto: **zero campi persi** su 35 tipi.

**Da provare a mano** (`./scripts/start_editor.sh`): le sei viste a sinistra e la scelta che
sopravvive al ricaricamento; su `rect`, `text`, `trend`, `symbol`, `grid` le sezioni nell'ordine
della tabella, ogni campo presente una volta sola; selezione multipla e multi-tipo con gli stessi
nomi di sezione; tema chiaro e scuro; larghezze ancora regolabili. E il costo dichiarato dal piano:
chi guardava insieme albero e palette ora paga un clic — se dà fastidio, la seconda opzione (due
zone fisse) resta a portata.


### 📏 La 2.7.2 cross sul WP630: misure del 2026-09-10 pomeriggio

Il maintainer ha aggiornato il WP630 (`wp630-a-p3-07a077`, Pixsys OS 2.1.1, `ID=pixsys`, 6 core,
podman 5.0.2) con `latest-arm64` = `2.7.2-arm64` cross (digest `bb48386…`, lo stesso di
`latest-arm64-generic`) e caricato un progetto LVGL minimo. Letto via ssh come `pixsys`, solo
comandi di lettura, con il suo permesso:

| Misura | Valore |
|---|---|
| runtime, da start del container a «runtime listener ready» (log JSONL) | **0,30 s** |
| runtime, CPU a regime (`podman stats`) / RSS | 1,2 % di un core / 9,8 MB |
| viewer LVGL, CPU a regime (`podman stats`) / RSS | 39 % di un core / 19 MB |
| Xwayland + weston sull'host (il viewer disegna via SDL2 → X11) | ~60 % + ~20 % di un core |
| load average | ~6 su 6 core, con CPU al 75 % idle: processi Pixsys (portal, connhex, CodeMeter), non nostri |

Lettura: il binario cross è ottimizzato e il runtime lo mostra (0,3 s, 1 %). Il costo del viewer
non è della build: è la catena SDL2 → Xwayland → weston, `SDL_VIDEODRIVER=x11` perché il Wayland
nativo va in SIGSEGV (quadlet). Non c'è una baseline 2.7.1 sullo stesso pannello da confrontare
(il 43 % di ieri era il pannello congelato). Per la fase due di Q53 i numeri bastano: il runtime
non ha nulla da invidiare all'SDK. Il costo del rendering del viewer merita una Q a sé (DRM/KMS
diretto invece di SDL2 via Xwayland).

I log dei container vanno a journald (`LogDriver=journald`) ma `podman logs` e `journalctl
_UID=1000` non mostrano niente su Pixsys OS: la sola fonte è il JSONL del runtime in
`/data/user/sws/logs/`. Da tenere a mente per la prossima diagnosi.

### 🎯 Rilasciata la 2.7.2 — da compilare, pubblicare e collaudare (2026-09-10)

Q51, Q52, Q53 e Q50 su `main`, taggata. **Il primo giro del maintainer sul builder è fallito
due volte**, e il tag `2.7.2` è stato spostato sul commit con la correzione prima che qualcosa
fosse pubblicato: (1) `FROM ubuntu:24.04` senza `--platform` prendeva la base arm64 in cache;
(2) il multiarch nello stesso sistema pretende versioni identiche fra archive (amd64) e ports
(arm64), e `libpython3.12-stdlib` era 0.17 su uno e 0.16 sull'altro. Rimedio: builder a due
stadi, sysroot arm64 separato. **Due immagini** da qui: `./scripts/build_containers_all.sh
--push` costruisce aarch64 (cross, niente SDK né sudo) e x86_64, e pubblica anche gli alias
`-arm64-generic`. La prima build aarch64 costruisce il builder (qualche centinaio di MB da
ports.ubuntu.com) e compila da zero (~8 + 3 minuti); poi incrementale. Sul TC620/WP630:
«Aggiorna» dall'editor, e la misura che decide la fase due di Q53: CPU del viewer LVGL e tempo
di avvio contro la 2.7.1.

### 🔧 Q50 — i dispositivi registrati sul server: ramo `feat/Q50-dispositivi-sul-server` (2026-09-10)

Decisa dal maintainer («in sws_projects prevederei una cartella di configurazione…»): la lista
sta in `<cartella progetti>/.ambiente/dispositivi.yaml`, `GET`/`PUT /api/devices`, mai la
password. La scheda legge dal server, migra la vecchia lista del browser una volta sola, ha
«Cerca dispositivi in rete» con «+», e «Cerca runtime» ha «+ Dispositivi». Provato qui su un
runtime di prova: PUT con `pass` → 422, URL rotto → 400, lista scritta e riletta, `.ambiente`
non compare fra i progetti, riga nell'audit. **Su `main`, nella 2.7.2.** Da provare a mano a
casa: aprire Configurazione → Dispositivi con la vecchia lista nel browser → messaggio «spostata
sul server»; «Cerca dispositivi in rete» → «+» sul TC620 → compare in lista; «Cerca runtime» →
«+ Dispositivi». Il file: `cat ~/sws_projects/.ambiente/dispositivi.yaml` (con `start_editor.sh`
è `.run-editor/project/.ambiente/`).

### 🔧 Q53 — un'immagine aarch64 sola, cross-compilata: ramo `feat/Q53-crossbuild-arm64` (2026-09-10)

Decisa dal maintainer la mattina («vale la pena percorrere la strada del crossbuild»). Realizzato
e **provato su theobroma**: il builder Ubuntu multiarch si costruisce, `sws-runtime` aarch64 esce
`[optimized]` in 8 minuti con `GLIBC_2.39` e `libpython3.12`, l'immagine `2.7.1-arm64` si
assembla con lo stesso `Containerfile.aarch64` di prima. Due intoppi trovati e risolti nel
Containerfile del builder: pyo3 (`_sysconfigdata` del target, → `PYO3_CONFIG_FILE`) e FreeType
per l'host (build script di `lvgl`). **Su `main`, nella 2.7.2.**

Aggiunte prima del tag, sullo stesso ramo: `sws-runtime --version`, la sonda che controlla la
cartella dati scelta nel modulo (`sh -s -- <cartella>`, validata come i percorsi del deploy), le
intestazioni «storico» sui file del percorso QEMU. **Il tag `2.7.2` è libero** (su origin e su
ghcr ci sono solo 2.7.0 e 2.7.1).

**Prossimo passo, tuo**: `git pull` del ramo quando lo pusho (o merge), poi
`./scripts/build_containers_all.sh --push` — due immagini, niente sudo — e sul TC620 «Aggiorna»
dall'editor: `latest-arm64` è ora la cross. **Da misurare** contro la 2.7.1 di ieri: CPU del viewer
LVGL (`top` sul pannello) e tempo di avvio. Se regge, fase due: via SDK, QEMU e alias.

### 🔧 Q51 + Q52 — la scheda Runtime per l'utente — **su `main`** (`a68802e`, 2026-09-09 sera), da collaudare

Decise dal maintainer (un ramo solo, tutto il flusso, tabella nel modulo Installa), realizzate sul
ramo `feat/Q51-Q52-installa-guidata`, **mergiate in squash e pushate** su sua istruzione («ok
mergia e pusha»). Il ramo resta in locale su theobroma, cancellabile. Prossimo passo, a casa:
`session_start.sh` → `start_editor.sh` → prove qui sotto → se regge, «tagga la 2.7.2» e build
delle immagini (NON ricompilare sulla 2.7.1: le `2.7.1-*` su ghcr sono quelle del pomeriggio). Server: `GET /api/build/stato`, `POST /api/device/probe`
(`sonda.rs` + `deploy/container/sonda-dispositivo.sh` incorporata), `GET /api/discover/dispositivi`
(`discover.rs`), tutte admin e assenti su `--no-admin`. Editor: «Pacchetto runtime» e il deploy
binario solo con il repo; «Installa su dispositivo» in cinque passi con tabella mDNS di tutta la
LAN, credenziali `user`, «Verifica dispositivo» con lista di controlli, immagine proposta,
«Installa/Aggiorna». Componenti nuovi in `src/config/installazione/`. Gate: 17+15+1 test Rust
nuovi, 220 vitest (parità it/en e helper puri), tsc/lint/build, clippy `-D warnings`, fmt,
**15 guardie statiche** (nuova `check_sonda`), `check_no_admin` (27 prove), smoke test del probe
con password sbagliata su 127.0.0.1 (risposta in 4 s, «Permission denied», niente password
nell'audit) e del discovery (tre host della LAN in 3 s, uno con SWS).

**Seguito nella stessa serata**, su richiesta («task utili per una compilazione che abbia senso»):
`/api/system` con `arch`/`hostname`/`container` (rilevamento del motore spostato in
`sws_web::system`), variante immagine proposta dal dispositivo connesso, «Verifica dispositivo»
anche nel modale della WelcomeScreen, `install-container.sh` con i controlli podman ≥ 4.4 e
subuid/subgid in testa. Tutto nel binario o nell'immagine: la ricompilazione le porta sul WP630.

**Per provarlo serve il binario nuovo**: l'editor sulla 8460 gira ancora sul vecchio, che non ha
le tre rotte — dopo un ricaricamento vedrebbe la UI nuova ma con `build/stato` a 404, quindi
niente sezione sviluppo, e «Cerca dispositivi»/«Verifica» falliti. Riavviare `start_editor.sh`.

**Da provare a mano** (piano in `~/.claude/plans/…installa…md`, copiato in
`docs/archive/2026-09-09-q51-q52-installa-guidata.md`): (1) con il repo: «Pacchetto runtime» c'è,
Container preselezionato, «Archivio locale» c'è; (2) da una cartella senza `scripts/`: nessuna
UI di sviluppo, nessun lampeggio; (3) connesso al WP630: Host SSH precompilato, un valore scritto
a mano resta; (4) «Cerca dispositivi in rete»: il WP630 con i servizi e «SWS v2.7.1», click →
host; (5) «Verifica dispositivo» con `user`: riga «wp630 · aarch64 · …», lista, «SWS già
installato», riferimento → `…:latest-arm64` con nota; pulsante «Aggiorna»; (6) password
sbagliata: «Connessione SSH non riuscita», Installa spento con il perché; (7) dopo factory
reset: box giallo → «Dimentica» rilancia la verifica; (8) cambiare porta/utente azzera la lista;
(9) un deploy vero, log in streaming, «Gestione container» intatto. **Primo sondaggio reale
fatto a casa la sera stessa** su un TC620 (`tc620-a-p3-c6-07aff9`, Pixsys OS 2.1.1, podman
5.0.2, tutto ✓, SWS `latest-arm64` attivo): l'euristica arm64 ha scelto giusto ed è fissata nel
test con il `PRETTY_NAME` vero. Unico difetto visto: «Pixsys OS 2.1.1 2.1.1», la versione ripetuta
nell'etichetta — corretto (`etichettaDispositivo`).


**Immagini pubblicate** (verificato sull'API di ghcr.io): `2.7.1-arm64`, `2.7.1-arm64-generic`,
`2.7.1-amd64`, i tre `latest-*` e i tre `d1fde9e-*`. Lo sha è `d1fde9e` e non `4d22de8` (il tag
git) perché fra i due ci sono solo commit di documenti; il codice è identico. Il riepilogo diceva
«caricata nel deposito di root» per la generica senza la riga «pubblicata»: era solo che
`podman images` da utente non la vede — su ghcr c'è. Lo stesso riepilogo suggeriva
`scp … root@<device>` e `podman load` come root: contro la specifica delle credenziali, corretto
con il percorso rootless (editor, o `install-container.sh --pull` come `user`).

**La prima build è morta per colpa mia**: ho modificato il commento in testa a
`build_container_aarch64_generic.sh` mentre girava; bash legge per offset e dopo 51 minuti ha
letto un frammento di riga (`build: command not found`). Nessuna immagine prodotta né pushata:
quello script è il primo della sequenza. Il binario aarch64 di sws-runtime è compilato e
incrementale, il rilancio di `build_containers_all.sh --push` lo riusa. Trappola aggiunta a
HOWTO §5 e in memoria.

Stesso codice della 2.7.0 più la catena CI/CD verde (toolchain 1.94, librerie di sistema,
cargo-audit 0.22 con `audit.toml`, SBOM). Taggata su richiesta del maintainer perché il tag git
e il commit da cui nascono le immagini coincidano. Il tag `2.7.0` resta su `45c8221`.


Tutto ciò che segue (revisione pre-2.7.0, Q46–Q49, Q48, password nel browser, identità git)
è su `main` e taggato `2.7.0`. Il maintainer compila e pubblica con
`./scripts/build_containers_all.sh --push` (più `--with-lvgl` per il viewer del WP630).
Verde su `main`: **474 test Rust, 208 vitest, 14 guardie statiche**, clippy `-D warnings`,
fmt. Il collaudo generale è l'elenco delle sezioni sotto, «Da provare a mano».

### 🔧 Q48 — «Installa runtime» ripuntato al container, sul ramo `feat/Q48-installa-dalla-welcome` (2026-09-09)

Decisa dal maintainer («ok, parti con Q48») e realizzata; **non mergiata, non pushata**.
Cosa contiene: i sei file di `deploy/container/` incorporati nel binario
(`CONTAINER_DEPLOY_EMBEDDED` in `packaging.rs`, così il deploy container non richiede il
checkout del repo — prima 503; l'archivio locale continua a volerlo, 400 se manca);
`deploy.rs` e `/api/deploy/remote` rimossi; la `DeploySection` della WelcomeScreen riscritta
su `/api/deploy/device-container` (registry, `imageRef` vuoto → il dispositivo sceglie
`latest-<arch>`, utente predefinito `user`, **niente password in localStorage**, pulsante
«Dimentica la vecchia chiave» come in ConfigView). Gate: 474 test Rust, 204 vitest, clippy
`-D warnings` 0, fmt verde, 13 guardie statiche verdi, `check_chiave_host` e
`check_no_admin` verdi sul binario di debug.

**Trovato per strada — e corretto sullo stesso ramo:** il commit `cargo fmt` di stamattina
(`7084524`) aveva messo in rosso **due guardie statiche**, `check_off_page` (tabella
`CASI_FUORI_PAGINA` spezzata, la regex non la leggeva più) e `check_synoptic_schema` (file
generato riformattato, il generatore diceva un'altra forma). Il «13 guardie verdi» scritto
qui sotto era stato misurato *prima* del fmt. Rimedio: `#[rustfmt::skip]` sulla tabella e
il generatore che passa da `rustfmt`.

**Da provare a mano:** dalla WelcomeScreen dell'IDE (`:8460`), «Installa runtime» verso il
WP630 con `user`: deve tirare `latest-aarch64` dal registry e finire con `DONE`; poi
riprovare dopo aver cancellato la riga da `known_hosts` sul dispositivo resettato — deve
comparire il pulsante e non deve procedere da solo.

**Fatto nello stesso ramo, su richiesta («finiamo»):** anche ConfigView non salva più
password in `localStorage` — `sws.runtime.targetPass` e il campo `pass` di
`sws.saved-devices` sono spariti; nel pannello Dispositivi la riga chiede la password
(campo «non salvata») e tiene spenti Connetti/Deploy finché manca; il riconnetti a un click
dell'intestazione vale solo per dispositivi senza utenti. All'avvio `dimenticaPasswordLegacy`
pulisce il profilo dalle tre famiglie di password vecchie (4 vitest). Guardia statica nuova
`check_password_browser.sh`, provata rossa; ora le guardie statiche sono **14**. Editor: 208
vitest, tsc/lint/build verdi. **Da provare a mano:** aprire l'IDE con un profilo che aveva
le password salvate → in DevTools `localStorage` non deve più contenerle; nel pannello
Dispositivi inserire la password nella riga e verificare che la firma si legga e Deploy si
accenda.

### 🔍 Revisione pre-2.7.0 — **su `main`** dal pomeriggio del 2026-09-09, da collaudare

Giornata autonoma su richiesta del maintainer: sicurezza, funzioni a metà o non usate,
duplicati. **Il referto è `docs/archive/2026-09-09-revisione-pre-2.7.0.md`** — tre colonne:
corretto, da decidere tu, lasciato stare e perché. Le decisioni sono **Q46–Q49** in
`OPEN_QUESTIONS.md`: Q46, Q47 e Q49 decise dal maintainer e realizzate lo stesso giorno;
Q48 decisa e realizzata sul suo ramo (sezione sopra). Il ramo è stato **mergiato in squash su `main`** (`b032d9d`) su
istruzione del maintainer, seguito dal commit `cargo fmt` da solo: la CI ora ha fmt e
clippy verdi. `main` **non è pushato**. In locale resta solo `main`: i rami `chore/revisione-pre-2.7.0`,
`fix/relay-ws-dispositivo` e `fix/testo-riquadro` sono stati cancellati dopo aver verificato per
contenuto che fossero dentro. **Su origin si possono cancellare** `fix/mqtt-topic-vuoto`,
`fix/relay-ws-dispositivo` e `fix/testo-riquadro`: tutto il loro contenuto è in `main`.

Numeri: `cargo audit` 16 → 5 (le cinque a monte, senza correzione), `pnpm audit` 25 → 0,
clippy `-D warnings` da 43 avvisi a **0** in entrambe le forme, 9 dipendenze mai usate
tolte, 470 test Rust, 204 vitest, 13 guardie statiche verdi. 17 commit, `main` intatto.

**Decisioni prese dal maintainer nel pomeriggio, e già realizzate sul ramo:** Q46 (cartella
dei progetti dichiarata, default `~/sws_projects`, confine per `browse-dirs`/`mkdir`/
`parent_path`), Q47 (`/api/script/exec` rimosso), Q49 (pinning del certificato TLS alla prima
connessione, con «dimentica e riprova» — per ora editor ↔ dispositivo; viewer LVGL e MQTT
restano). Q48 è in discussione: il maintainer propende per ripuntare la WelcomeScreen al
deploy container — vedi l'analisi in chat del 2026-09-09 e la Q.

**Da provare a mano su Q49**: «Connetti» a un pannello in **HTTPS** due volte (la seconda
deve passare in silenzio), poi rigenerare il certificato sul pannello (o cancellare
`dispositivi_conosciuti.yaml` a metà): «Connetti» deve fermarsi con il pulsante, e il pulsante
deve sbloccare. In HTTP non cambia niente.

**Le correzioni di sicurezza, in ordine di peso:** `sshpass -p` → `-e` (la password stava in
`ps aux`); `user@host` validato nei quattro handler ssh (prima solo in `ssh-keygen -R`);
nomi dei tag git che potevano essere opzioni; sanificazione SVG via DOM con lista di
ammessi + rifiuto lato server (e l'anteprima simboli non la chiamava affatto).

**Da provare a mano prima di fidarsi** (referto §5): un deploy container sul WP630 dopo il
cambio a `sshpass -e`; un simbolo SVG custom esistente deve rendersi identico; le finestre
staccate (chat, log) dopo il refactor.

**Fatto:** il commit `cargo fmt` da solo subito dopo il merge (71 file, nessun cambio di
comportamento: 479 test e clippy verdi prima e dopo).

### 🎯 Rilasciata la 2.6.6 — da compilare e collaudare (2026-09-09)

I due rami del 2026-09-08 sono su `main` in squash e la versione è taggata. In
locale restano `fix/relay-ws-dispositivo` e `fix/testo-riquadro`: il contenuto è
dentro `main`, si possono cancellare quando vuoi (anche su origin).

Verde su `main`: **463 test Rust, 194 vitest, 13 guardie statiche**,
`cargo check --workspace` e `pnpm build`.

**Il collaudo generale**, in ordine di valore:

1. **Il pannello LVGL** — è la correzione che vale di più e l'unica che richiede
   una nuova immagine sul dispositivo. Deploy con un progetto LVGL attivo: il
   companion deve **ripartire da solo** e mostrare il progetto NUOVO. Poi
   riavviare il runtime e verificare che il pannello **non si congeli**: prima
   restava sull'ultimo fotogramma per sempre.
2. **La variabile che spariva** — aggiungerne una, salvare le **Sorgenti**,
   tornare alle variabili: la riga deve esserci ancora, con la barra che chiede
   cosa fare. Serve un ricaricamento forzato della pagina.
3. **Il testo nel riquadro** — trascinare una maniglia su un testo: diventa un
   riquadro vero e le lettere ci stanno dentro.
4. **I valori vivi da remoto** — «Connetti» a un pannello: i tag si devono
   popolare, e nel registro deve restare **una sola riga INFO** sui log non
   disponibili (è deliberato), non un muro di 404.
5. **Sandokan / MQTT** — solo a casa, il progetto è rimasto rotto apposta.
6. **Q38** (materializzazione ratio) e **Q37** (cornice del pannello).

**Lo stato del WP630, che non è pulito.** Ci si è lavorato in SSH con il permesso
del maintainer: runtime `2.6.5-arm64` con installazione **pulita** (progetti,
configurazione e storico azzerati) e `sws-lvgl-viewer` **riavviato a mano** alle
17:15 del 2026-09-08, perché girava ancora sull'immagine di due ore prima. Il
progetto lì caricato ha una pagina con **un solo oggetto testo**, quindi lo
schermo è quasi vuoto anche quando funziona: resta da confermare se il nero visto
era solo il congelamento o se c'è dell'altro fra LVGL e Weston.

Ambiente del pannello, misurato: `desktop.target` attivo, Weston con
`xwayland=true`, il viewer connesso davvero a Xwayland (4 socket X11),
`card1-LVDS-1` a 1920×1080 — coerente con la geometria SDL2. Il browser
disabilitato è **corretto**: è la funzione nuova di PixsysOS 2.1.0 per i progetti
LVGL. E la trappola che è costata mezz'ora: quelle unit sono `systemctl --user`
dell'utente **`user`** — interrogate da root rispondono «No entries» e sembrano
assenti.

### 🎯 Rilasciata la 2.6.5 — pronta da compilare e installare (2026-09-08)

`main` contiene tutto: il lavoro notturno (`fix/mqtt-topic-vuoto`, squash) più
l'allineamento SSH descritto sotto. Tag annotato `2.6.5`, pushato.

**Le prove che restano al maintainer**, in ordine di valore:

1. **WP630 appena resettato (ufficio)** — è il banco di prova della modifica SSH. Dopo il
   factory reset il deploy **deve** fermarsi con l'avviso e il pulsante «Dimentica la vecchia
   chiave e riprova»; il pulsante toglie la chiave vecchia ma **non installa** quella nuova,
   quindi serve comunque `ssh-copy-id`. Poi: il pannello deve mostrare SWS e non Cockpit.
2. **Sandokan / MQTT — solo a casa.** Il progetto è rimasto rotto apposta: apri Sorgenti,
   salva (la potatura toglie la riga senza topic), ridistribuisci, e verifica che `mqtt-casa`
   si colleghi e **resti su**.
3. **Q38** (materializzazione ratio) e **Q37** (cornice del pannello, sul dispositivo).

**Rami**: in locale è rimasto solo `main`. `feat/lvgl-gap`, `fix/sws-display-path-loop` e
`test/validazione-2026-09-06` erano già dentro `main` **per contenuto** — verificato file per
file, non per ancestry — e mergiarli avrebbe fatto tornare indietro il repo (il ramo di
validazione dichiarava ancora `2.5.0`). Cancellati in locale; su origin lo erano già.
**Resta da cancellare su origin `fix/mqtt-topic-vuoto`**, quando vuoi.

### 🔐 La specifica SSH, e il punto in cui non la rispettavamo (2026-09-08)

Tre regole dichiarate dal maintainer: `user` sono le credenziali **limitate** dell'utente
finale (`user`/`123456` è solo di prova, il cliente definirà le sue); `pixsys` è l'accesso
**privilegiato**, utile solo ora in test, e nessun comando di produzione può presupporlo; la
chiave SSH **non si cancella mai da sola** — se cambia dopo un factory reset la connessione
deve fallire, e l'utente si agevola con un pulsante, non si scavalca.

Sui primi due punti eravamo a posto, ed è stato verificato: `123456` non compare come
credenziale da nessuna parte, `pixsys@` non è cablato in nessun comando eseguito (solo nella
documentazione e nella riga d'uso di `scripts/yocto/deploy.sh`), e il percorso di produzione —
il container — non esegue **un solo `sudo`**.

Sul terzo **no**. Il pulsante era stato scritto il 2026-09-07, ma
`StrictHostKeyChecking=no` era rimasto in **sedici** invocazioni. E quell'opzione non fa
quello che sembra: da `ssh_config(5)`, con `no` una chiave *cambiata* lascia proseguire la
connessione disabilitando password e keyboard-interactive — **non** la chiave pubblica. Su un
dispositivo con `ssh-copy-id` già fatto, il deploy verso un host che aveva cambiato identità
sarebbe passato in silenzio, e il pulsante non sarebbe mai comparso. Il 2026-09-07 il guasto
si è visto **solo** perché il reset aveva cancellato anche `authorized_keys`.

Ora è `accept-new` ovunque: primo contatto invariato, chiave cambiata rifiutata.
`check_chiave_host.sh` ha una regola che lo sorveglia, **provata rossa** su un'invocazione
vera — la prima prova era un falso negativo perché `sed` aveva colpito la citazione in un
commento invece del codice.

### ⚠️ La CI era rossa da tempo, e adesso si sa perché — ramo `fix/ci-toolchain` (2026-09-09)

Il maintainer ha ricevuto la mail di GitHub sul push della 2.7.0: **Rust lint** e **Rust
audit** rossi, **Rust build & test** e **SBOM** mai partiti (dipendono dal lint), tutto il
lato TypeScript verde (208 vitest anche là), DCO «saltato» perché gira solo sulle pull request.

**Rust lint moriva in 13 secondi, senza compilare niente.** `ci.yml` pinnava la toolchain
**1.75** (dicembre 2023). Il `Cargo.lock` è in formato 4 (serve cargo ≥ 1.78) e le
dipendenze `time`/`icu` vogliono ≥ 1.88: cargo 1.75 non riusciva nemmeno a leggere il
lockfile, «exit code 101». Quindi il «fmt e clippy rossi» annotato qui sotto il 2026-09-08 era
solo la metà: anche dopo il `cargo fmt` quei job non potevano passare. Rimedio sul ramo:
toolchain CI **1.94** (quella delle macchine di sviluppo, così `cargo fmt --check` dice la
stessa cosa qui e là), `rust-version = "1.88"` in `Cargo.toml` (la MSRV vera, verificata con
`cargo +1.88 check --workspace`), documenti allineati (README, CONTEXT, TESTING_GUIDE,
CLAUDE_CODE_SETUP).

**Rust audit non arrivava nemmeno a guardare le dipendenze.** Il registro del job, letto dal
maintainer: cargo-audit **0.21.0** (pinnato in `ci.yml`) non sa leggere il database degli avvisi,
che dal 2026 porta punteggi CVSS 4.0 — «unsupported CVSS version: 4.0», exit 1. Rimedio:
cargo-audit 0.22.2, che è quello che gira in locale. Passato quello, il job avrebbe detto la
verità: **5 vulnerabilità**, le stesse cinque «a monte» del referto
(`rsa` via async-opcua senza correzione esistente; `rustls-webpki` 0.102 via rumqttc, la cui
correzione rompe il provider ring). Ora `sws-runtime/.cargo/audit.toml` le dichiara ignorate
**una per una, con il perché accanto** — un avviso nuovo fa fallire il job come deve. Da
rivedere quando rumqttc o async-opcua si aggiornano.

**Gli avvisi gialli «Node.js 20 is deprecated»** riguardano le *azioni* di GitHub (checkout,
setup-node, pnpm), non il nostro codice: GitHub le esegue su Node 24 comunque, sono avvisi e
non errori. Alzate a `checkout@v5`, `setup-node@v5`, `upload-artifact@v5`,
`pnpm/action-setup@v4`; Node del progetto in CI da 20 (fine vita aprile 2026) a 22.

**Il disco di theobroma era al 100 %** (503 MB liberi su 1,5 TB) — la verifica della MSRV è
fallita al primo colpo per «No space left on device», e la build delle immagini sarebbe morta
allo stesso modo. Tolto `target/debug` del workspace con `cargo clean --profile dev` (57,8 GiB,
rigenerabile: il prossimo `cargo build` ricompila da zero, HOWTO §2). Liberato quello si è
**ancora al 97 %**: il resto è `~/yocto` (la build Yocto Pixsys), voluta e **da non toccare** —
parola del maintainer, che non aveva chiesto indagini sul disco. Restano
da togliere, quando si vuole: la toolchain `1.88` installata per la verifica
(`rustup toolchain uninstall 1.88`) e la cartella `target-msrv` nello scratchpad della sessione.

**Primo giro con la toolchain nuova (`6a8ce23`): fmt verde, clippy rosso, exit 101.** I
registri dei job richiedono un token e non si leggono dall'API pubblica; l'annotazione dice solo
«exit code 101». La causa più probabile, e l'unica coerente con «fmt passa, clippy no»: il
runner `ubuntu-latest` non ha le librerie di sistema che il README elenca come prerequisiti non
opzionali (SDL2, libdrm, FreeType, libclang per bindgen, python3-dev per pyo3) — il build
script di `sws-lvgl-viewer` muore prima di qualunque riga Rust. Aggiunto un passo `apt-get`
ai due job che compilano (lint e build & test). Se anche questo giro è rosso, serve il registro
del job: dalla pagina Actions, «Rust lint» → il passo rosso → copiare le ultime righe.

**Secondo giro (`071861a`): lint, build & test, audit e tutto il TypeScript verdi** — le librerie
di sistema erano la causa. È caduto solo **SBOM**, che partiva per la prima volta: `cargo install
cargo-cyclonedx` senza versione prende la 0.5.9, dove `--output-file` non esiste. Pinnata la
0.5.9, `--override-filename sbom`, e l'artefatto raccoglie gli `sbom.json` di tutti i crate
(provato in locale: 14 file, uno per crate). Aggiunti a `.gitignore`.

**Terzo giro (`bf46d06`): tutto verde**, confermato dal maintainer sulla pagina Actions — la
prima CI verde del progetto. HOWTO §11 spiega come leggere la mail e la pagina, e la tabella
delle quattro cause. Regola: ogni strumento della CI è pinnato a una versione. Se resta
rosso, la mail di GitHub dice quale job, e il registro del job dice la riga.

### 🔒 «Connetti» a un pannello senza utenti chiudeva fuori dall'editor (2026-09-08)

Segnalato con schermata: pannello con un progetto **senza utenti**, credenziali rimaste nel
modulo, e all'atto di connettersi comparivano **insieme** «✗ unauthorized» e il modale
«Sessione scaduta — inserisci la password per continuare come admin / Password errata». Due
vicoli ciechi in uno: la sessione locale era viva, e quella password non poteva funzionare.

Catena: `connect_remote` rispondeva **401** quando il login sul dispositivo falliva; `request()`
in `client.ts` tratta *qualunque* 401 come scadenza della propria sessione e apre l'overlay.
Ma la UI controllava `result.ok` — cioè era progettata per un **200 con `ok:false`**, e quel
ramo non veniva mai raggiunto perché `request()` lanciava prima.

Tre correzioni:
1. **`connect_remote` non usa più lo stato HTTP per gli esiti remoti**: tutto nel corpo
   (`ok`/`error`/`nota`), che è ciò che la schermata sa già leggere.
2. **Il 401 di un altro runtime non è il nostro**: in `client.ts` le rotte `/api/remote/*` non
   scatenano più `sws:session-expired` (lista dichiarata, nello stile di `PATH_RIPORTANO_VERSIONE`).
3. **Il no-auth si riconosce**: se il login remoto dà 401, si sonda `GET /api/auth/whoami` senza
   token — 200 significa «nessun utente» — e allora ci si connette **senza** credenziali,
   dicendolo nella nota. Con credenziali davvero sbagliate il messaggio nomina utente e URL.

Scoperto strada facendo e utile saperlo: **gli utenti appartengono al progetto** (aprirne uno
scambia lo user store), quindi un runtime senza progetto è per forza in no-auth — è il motivo
per cui la guardia deve seminare un progetto per avere un admin.

Prove: `check_connessione_remota.sh` (25ª con stack) con **due runtime veri**, uno con utenti e
uno senza, 7 controlli sul caso esatto della segnalazione; **provata rossa** ripristinando il 401.

### 📺 Il pannello mostrava Cockpit dopo il deploy — e lo Stato non diceva niente

Due segnalazioni del maintainer del 2026-09-07 sera, stesso ramo.

**Il browser del pannello — due difetti, non uno.** Misurato sul dispositivo: `GetUrl`
rispondeva `http://127.0.0.1:9443`, cioè il **valore di fabbrica** — quindi il `SetUrl`
dell'installer *non era mai andato a buon fine*, e il blocco non aveva un ramo `else`: una
chiamata rifiutata si leggeva come un successo. Inoltre stava **dentro** il ramo «/health ha
risposto», quindi qualunque intoppo nell'attesa se lo portava via. Ora il `SetUrl` sta prima
dell'attesa, indipendente, e **stampa l'errore** col comando da rifare a mano.
Secondo difetto, sotto: `chromium-start main-app` legge l'URL **solo all'avvio**: col browser
già in esecuzione — dopo un factory reset lo è, sulla pagina di configurazione, che è il valore
di fabbrica — l'installazione riusciva e lo schermo non cambiava. Ora l'installer riavvia
`chromium@main-app.service` dopo il `SetUrl`, **solo se era già attivo** (con STOP premuto il
launcher tiene Cockpit su `wp-control` e non avvia main-app: avviarlo noi coprirebbe la via di
fuga). Copre anche il caso dell'aggiornamento: una SPA già caricata resta quella finché il
browser non riparte. Tre regole nuove in `check_systemd_units.sh` (riavvio presente, condizionato a
`is-active`, e `SetUrl` che riporta il fallimento), **tutte provate rosse** — e la prima
versione di una era un falso negativo, perché trovava la stringa dentro un `echo` di aiuto
invece del comando eseguito. Corretto anche il controllo `/health`, che provava solo HTTP:
su un aggiornamento sopra una config con TLS avrebbe dichiarato «il runtime non risponde»
a installazione riuscita.

**Lo Stato della Gestione container.** Filtrava i container sul nome esatto `sws-runtime`:
niente companion LVGL, e su una macchina pulita l'intestazione nuda di `podman ps`, che si
legge come un guasto. Ora elenca container SWS ed estranei, immagini (le 10 più recenti),
stato del companion, e dice «nessuno» a parole; in testa dichiara **dove** ha guardato
(questa macchina, oppure `utente@host:porta`). Il test che sorveglia quel comando ora
verifica anche l'escaping delle graffe del template Go — `format!` le dimezza, e con
`{.Names}` podman stamperebbe righe vuote.

### 🔑 Il factory reset che bloccava il deploy — stesso ramo `fix/mqtt-topic-vuoto`

Inciampato due volte nello stesso giorno dal maintainer: dopo il factory reset del TC620, il
deploy container si fermava con «ERROR: ssh fallito (exit 255)» e la riga utile (la chiave host
cambiata) era sepolta nello stderr di ssh. Il `known_hosts` di questa macchina è già stato
ripulito a mano (3 voci stantie: ECDSA, ED25519, RSA — backup in `known_hosts.old`).

Ora è gestito dall'editor: `run_ssh_cmd_stdin` riconosce le due righe di OpenSSH e manda alla UI
un marcatore, il pannello Container mostra un avviso che nomina il factory reset e un pulsante
«Dimentica la vecchia chiave e riprova» → `POST /api/device/hostkey/forget` (Admin, audit,
`ssh-keygen -R` sul `known_hosts` di **questo PC**, anche nella forma `[host]:porta`).

**Scelta deliberata**: la chiave non si toglie mai da sola e `StrictHostKeyChecking=no` non entra
nel codice — spegnerebbe la protezione per sempre; così la si spegne una volta, per un host, con
un gesto umano.

Prove: 2 unit test (le righe vere di OpenSSH; la validazione dell'host, che finisce in
`ssh-keygen -R`), guardia `check_chiave_host.sh` (24ª con stack, gira con una **HOME finta**:
non tocca il `known_hosts` di chi la lancia) con 12 controlli, **provata rossa** su due fronti.

### 🐛 La riga MQTT vuota che uccideva la sorgente — `fix/mqtt-topic-vuoto` (2026-09-07)

Segnalato dal maintainer: `mqtt-casa` di Sandokan in loop di riconnessione ogni 5 s con
«Broken pipe». **Non era il container, né la rete, né il broker.**

Diagnosi (fatta dai file, senza SSH sul dispositivo): il client che flappava era il runtime
**dell'editor di questa macchina** — `.run-editor/config/instance_id` = `1778ef` combacia col
client_id del log (`sws-mtkk4cm8g33iz-1778ef`), e `topics: 28` combacia con la copia editor di
Sandokan (quella in `.run/` ne ha 25). Causa: la **prima riga di `mqtt-casa` ha `topic: ''`** —
filtro a lunghezza zero, errore di protocollo MQTT 3.1.1 §4.7.3, il broker chiude appena riceve
la SUBSCRIBE. Non muore la riga: muore l'intera sorgente, e infatti i tag di casa erano fermi
mentre `mqtt-sandokan` (6 topic, pulita) funzionava — da cui «il dispositivo sembra funzionare».

**Escluso** il difetto di client_id che aveva morso questo stesso dispositivo due volte in
agosto (archivio `STATUS-2026-07_08.md`): tutti e cinque i punti che riavviano le sorgenti
chiamano `resolve_mqtt_client_ids`, e le tre sorgenti hanno `random_client_id` attivo.

Tre strati, perché ognuno copre un caso che gli altri non coprono:
1. **runtime** (`sws-plugin-mqtt`): salta le righe senza topic con un WARN che dice cosa fare →
   *un progetto già installato riparte senza toccarlo*; e non crea più il tag con id vuoto a
   ogni retry (`db.ingest("")`, succedeva davvero);
2. **salvataggio** (`PUT /api/project/sources` + `ConfigView`): le righe vuote non arrivano al
   disco → *e quindi non finiscono nel deploy*. Si potano invece di rifiutare con 400 (come si
   fa per gli id duplicati) perché una riga vuota non contiene lavoro da perdere;
3. **validatore**: errore sulla riga senza topic (col perché), avviso su quella senza tag.

Prove: 2 unit test nel plugin, 4 vitest, guardia `check_mqtt_topic_vuoto.sh` (23ª con stack)
**provata rossa**. 452 test Rust, 181 vitest, clippy 0, 13 statiche verdi.

**Da fare col maintainer**: il progetto è rimasto rotto apposta — apri Sorgenti, salva, ridistribuisci
sul dispositivo (dopo il factory reset + 2.1.1) e verifica che `mqtt-casa` si colleghi e resti su.


### 🧪 `test/validazione-2026-09-06` — il ramo da provare, poi merge su main + push

**Tutto pushato su origin il 2026-09-07** (main con la revisione documenti, i sei rami Q,
`fix/revisione-documenti` e questo ramo): da qualunque macchina, `git fetch` e
`git checkout test/validazione-2026-09-06` bastano per il collaudo.

Contiene **tutte e sette le questioni chiuse il 2026-09-06** (la pila è lineare, la cima
contiene tutto): Q27 tipo, Q42 scaling script, Q17 ricette, Q35 (solo docs), Q38 ratio,
Q37 cornice, Q41 risorse chat. Verificato sul ramo: 450 test workspace, 172 vitest, clippy 0,
13 statiche + 8 guardie con stack dell'area toccata, tutte verdi.

**Collaudo a mano (in ordine di valore):**

1. ✅ **Q41 — confermata dal maintainer il 2026-09-07.** La riga ◔ coi token compare e cresce
   a ogni risposta con la chiave vera. Niente da rifare.
2. **Q38** — apri un progetto in «solo proporzioni» con pagine senza misure (o creane una
   nuova): la pagina mostra subito bordo/riempimento T-52, il progetto risulta da salvare,
   e dopo il salvataggio le misure stanno nel file.
3. ✅ **Q27 — verde il 2026-09-07** con `./scripts/check_tipo_scrittura.sh` (10 controlli su 10,
   compreso il difetto storico: `"true"` ora arriva come booleano, non come stringa).

   > **Il testo di prima mandava su una strada senza uscita**: diceva di scrivere «abc» in un
   > setpoint, ma quel widget filtra già a monte (`<input type="number">` sul web,
   > `lv_textarea_set_accepted_chars` su LVGL) e non è nessuno dei quattro percorsi che Q27
   > protegge (`PUT /api/tags/:id`, WebSocket, ricette, script Python). Per provarlo a mano serve
   > un `button` con `write_value: abc`, uno script, o una ricetta — e un progetto che **dichiari**
   > i tag: su un progetto senza tag il tipo è ignoto e per disegno non vincola.
4. ✅ **Q17 — verde il 2026-09-07** con `./scripts/check_ricette.sh` (8 controlli su 8: il 403
   nomina il tag vietato, l'all-or-nothing regge, e l'audit firma l'utente autenticato).
5. **Q37** — sul TC620 (quando capita): pagina più piccola dello schermo → cornice neutra
   scura uniforme, non spazzatura video.

Dopo il tuo ok: squash merge su `main` (un merge per ramo, nomi già in questa sezione) e push
— **su tua istruzione**, come da regola.


### ✅ Q41 + Q37 + Q38 — il terzo giro di questioni, sui rami impilati (2026-09-06, sera)

- **Q41 — la chat mostra token e credito** (`feat/Q41-risorse-chat`): frame `risorse` dopo ogni
  turno (il dato era già in `Risposta.usage`, zero chiamate extra) sommati per conversazione;
  frame `saldo` all'apertura, solo per chi lo espone (Kimi ha `/v1/users/me/balance`; Anthropic
  non espone il saldo con la chiave d'uso — verificato). Riga presente di default, nascondibile
  col ◔ (preferenza per-utente nel browser); vale anche per la finestra staccata.
  **Da provare con la chiave vera**: `SWS_AI_FAKE` non produce `usage`.
- **Q37 — la cornice attorno al foglio sul pannello è deliberata** (`fix/Q37-cornice-lvgl`):
  il neutro delle bande web (#0f172a) — `fill_rect` condizionale su SDL2, `riempi()` una volta
  su DRM. Il taglio resta dichiarato. **Prova visiva da pannello vero.**
- **Q38 — in `ratio` le misure si scrivono nel file** (`fix/Q38-ratio-materializza`): `addPage`
  semina la risoluzione di riferimento, `useMaterializzaRatio` sana i progetti vecchi
  all'apertura (marcandoli sporchi: modifica vera, salvataggio esplicito).

Stato: 450 test workspace, 172 vitest, clippy 0, build verdi. **14 vive + 28 archiviate = Q1..Q42.**

### ✅ Q35 — chiusa senza codice: l'esplicito esisteva già (`visible`)

Il maintainer aveva scelto l'opzione 2 (campo `disabled` esplicito); la verifica pre-implementazione
ha scoperto che **è già realizzata sotto il nome `visible`** — campo statico + `visible_tag`
dinamico in tutti e tre gli specchi, checkbox nel pannello, fantasma 0.35 in editor, applicazione
live su LVGL, voci nel manuale. Aggiungere `disabled` avrebbe violato la regola UI n. 2 (mai due
punti del pannello per lo stesso dato). Deciso su queste premesse: si chiude constatando la
coesistenza — fuori-pagina e visibilità in OR, parcheggio esente dal validatore, `visible: false`
ancora validato e resuscitabile da tag. La semantica completa è nella scheda archiviata.
Zero righe di codice: il valore della sessione è la scoperta, registrata prima che qualcuno
implementasse un doppione. 17 vive + 25 archiviate = Q1..Q42.

### ✅ Q17 — la soglia per-tag vale anche per le ricette, su `fix/Q17-ricette-soglia` (impilato su Q42)

Terza della famiglia dei confini di scrittura (Q27 il tipo, Q42 lo scaling, Q17 il **chi**).
Opzione 1 scelta dal maintainer, con semantica **all-or-nothing**: un setpoint sopra il ruolo
→ 403 con l'elenco, niente applicato. In più l'apply ora firma l'audit hash-chained
(`recipe.apply` / `recipe.apply_denied` con l'utente autenticato — prima era l'unico percorso
di scrittura senza traccia, e lo storico si fidava dell'`applied_by` autodichiarato).
Guardia nuova `check_ricette.sh` (21ª con stack, si porta il suo progetto perché nessun
template ha ricette né `write_min_role`), 8 controlli, **provata rossa**. 209 test sws-web,
clippy 0. Scheda archiviata: 18 vive + 24 archiviate = Q1..Q42.

### ✅ Q42 — gli script scrivono in unità ingegneristiche, su `fix/Q42-scaling-script` (impilato su Q27)

La scoperta collaterale di Q27, chiusa il giorno stesso col giro «proponi → decidi → implementa
→ archivia». `tags.write` era l'unico dei quattro percorsi senza `scale_to_raw`: uno script che
scriveva un tag scalato posseduto da un plugin consegnava al PLC l'eng come raw. Prima di
toccare il motore si è misurato il rischio della doppia compensazione (nessun template del repo
definisce scaling; il maintainer ha confermato per i progetti reali). Fix di una riga speculare
a `write_tag`, contratto nel docstring, unit test 4-20 mA (eng 50 → raw 12 sul bus, eng 50 nel
fallback virtuale) **provato rosso e verde**. 450 test workspace, clippy 0. Scheda archiviata:
19 vive + 23 archiviate = Q1..Q42.

### ✅ Q27 — il `data_type` è un contratto, su `fix/Q27-tipo-in-scrittura` (da confermare e mergiare)

Prima questione chiusa col nuovo giro «proponi → decidi → implementa → archivia». Politica
scelta dal maintainer: **coercizione senza perdita** (Int→float, Float intero→int,
`"true"`/`"false"` e stringhe numeriche; il resto 400 col motivo). Un solo punto di verità —
`TagDb::coerce_for_write` + mappa `data_types` in `sws-core` — chiamato da PUT, WebSocket,
ricette e script Python; l'editor mostra già gli errori (toast F3.7), zero modifiche client.
Prove: 2 unit test nuovi (449 totali workspace), guardia `check_tipo_scrittura.sh` (20ª con
stack) **provata rossa** spegnendo la coercizione — vede anche il difetto originale, la stringa
`"true"` conservata su un tag bool. Scheda archiviata con la decisione; **scoperta collaterale
Q42**: gli script scrivono senza `scale_to_raw`, unico percorso dei quattro — aperta, non decisa.

Verifica rapida a mano, con lo stack su:
```bash
curl -s -X PUT localhost:8444/api/tags/demo.cmd.enable -H 'Content-Type: application/json' -d '{"value":"abc"}'
# → 400 {"error":"il tag «demo.cmd.enable» è dichiarato bool, ricevuto string («abc»)"}
```

### 🧹 Revisione dei documenti — fatta il 2026-09-06, su `fix/revisione-documenti`

Cinque mesi di pianificazione rimessi a dire il vero, col piano approvato in
[`docs/archive/2026-09-06-revisione-documenti.md`](docs/archive/2026-09-06-revisione-documenti.md):

- **`docs/OPEN_QUESTIONS.md` 3476 → 1366 righe**: 21 schede decise-e-realizzate, **ognuna
  verificata sul codice prima di archiviarla** (l'artefatto che dichiara, non la prosa),
  spostate integrali in [`docs/history/OPEN_QUESTIONS-chiuse.md`](docs/history/OPEN_QUESTIONS-chiuse.md)
  col timbro e la prova. Le cinque schede che si contraddicevano (testa «Decided», coda «not yet»)
  risolte **con un fatto**, non con una decisione. Restano vive 20 schede.
- **`STATUS.md` 4022 → ~810 righe**: luglio e agosto integrali in
  [`docs/history/STATUS-2026-07_08.md`](docs/history/STATUS-2026-07_08.md); le ~76 voci del log
  piatto «Release 2.1.0» hanno finalmente intestazioni markdown. Una riga per gruppo in «Storico».
- **`docs/plans/README.md`** (nuovo): 20 piani, ognuno con esito verificato ed evidenza; riga di
  stato in testa ai 14 fatti. `global-scripts-template-snippets.md` è **segnalato come falso**
  (punta a un file mai esistito) ma la rimozione è una chiamata del maintainer.
  *(Aggiornato l'11-09-2026: i 19 piani conclusi o superati — `global-scripts-template-snippets.md`
  compreso — sono passati in [`docs/archive/`](docs/archive/README.md), con i 33 riferimenti
  riscritti. In `docs/plans/` restano i 6 ancora in gioco.)*
- **`docs/CONTEXT.md` §3** riscritta contro il codice di oggi (era «as of June 2026»).
- **Guardia nuova `scripts/check_documenti.sh`** (fra le statiche, provata rossa in due modi):
  vivo + archivio = Q1..Q41 senza buchi né doppioni, ogni `Q<n>` citato in STATUS / TESTING_GUIDE /
  CONTEXT / codice si risolve, ogni scheda archiviata porta il timbro.
- Quattro affermazioni stantie corrette qui dentro con la data (push fatti, comando `--delete`
  riscritto, ramo T-51 inesistente, punto F9c superato dai seguiti di Q14).

**Da decidere dal maintainer** (il report è il prodotto della revisione): le 20 questioni vive —
elenco corto consegnato a fine sessione. In sospeso anche: i **5 rami su origin** ancora da
cancellare col comando corretto (vedi sotto), e la scheda Q16 «riverificata: metà è fatta».

### ✅ T-52 e il fix Q30 — mergiati in `main` il 2026-09-05 (pushati il 2026-09-06)

Confermati a schermo dal maintainer, poi due squash merge distinti su `main`
(`27f19ac` T-52, `c3099cd` il fix). L'albero di `main` è **byte per byte identico** al ramo di
prova su cui la conferma è avvenuta. I rami di lavoro sono stati chiusi; il maintainer ha
pushato tutto il 2026-09-06 (`4ddacc5..b0e0e6c`, coi tag).

**T-52 — il limite della pagina è morbido.** Il colore si ferma al bordo (con il tavolo neutro
attorno, e le bande del letterbox nel viewer `ratio`); il bordo trattiene con ~24 px schermo di
resistenza ma lascia uscire chi trascina con decisione; un oggetto portato interamente fuori dal
foglio è **parcheggiato** — resta nel file, si vede grigio in editor, e non viene disegnato né nel
browser né sul pannello né controllato dal validatore. Il piano è
`docs/archive/2026-09-04-limite-pagina-morbido.md`, le nove correzioni che l'analisi gli ha fatto
sono in `docs/archive/2026-09-05-T-52-sessioni-B-E.md`.

**Fix Q30 — «Aggiorna progetto» rifiutava ogni salvataggio successivo.** Trovato dal maintainer
*mentre* provava T-52. `/api/project/migrate` riscrive `project.yaml` e la sua risposta porta
l'ETag nuovo; il client lo buttava, e da lì ogni salvataggio prendeva un 409 con scritto «qualcun
altro ha modificato il progetto» — dove il qualcun altro era lui stesso. Corretto anche il gemello
sulla rinomina del progetto aperto, che nessuno aveva ancora colpito.

**Due guardie nuove**, entrambe provate anche rosse, che sono la parte che sopravvive:

- `check_off_page.sh` — la tabella di casi del «fuori pagina» è dichiarata come **dato** in Rust e
  in TypeScript, e la guardia le confronta riga per riga; più il controllo che i due crate
  **chiamino** `is_off_page` invece di riscriverlo.
- `check_versione_progetto.sh` — legge il **corpo** di ogni handler che scrive un file di progetto,
  lo classifica (confronta `If-Match` / riporta la versione / scrive da sé) e pretende che il
  client lo copra nel modo giusto. Una rotta nuova non classificata la fa fallire. Esiste perché il
  difetto Q30 era nato da una frase in prosa — «se cambia lì, cambia qui» — che ha mentito per due
  settimane senza che niente lo dicesse.
- `check_soft_edge.sh` — il limite morbido misurato col mouse vero: fra la funzione pura e
  l'oggetto che si muove ci sono la gabbia della presa, gli offset, lo zoom e la cascata di snap, e
  nessun unit test vede quel tratto.

Stato al merge: 164 test editor, `cargo test --workspace` 441 passati, **11 guardie statiche**
verdi, `check_lvgl_parity` verde a 238 campi.

#### 🔜 Da fare, in ordine di costo

1. ~~Il push di `main`~~ — **fatto dal maintainer il 2026-09-06**.
2. **`check_f7.sh` ha un rosso preesistente e ha torto lei.** Misura il colore del testo di un
   oggetto e lo confronta con `var(--brand-text)`, il token del **tema dell'app**; ma Q18 ha
   deciso che quel colore viene dallo **sfondo della pagina**, via `--synoptic-text`. Sono due cose
   diverse per costruzione, e la guardia passa solo quando tema e sfondo pagina hanno per caso la
   stessa polarità. Verificato che non c'entra T-52: `--synoptic-text` non compare nel diff.
   Correzione: una riga nel measure, sondare `--synoptic-text` dentro il canvas.
3. **Le schermate del manuale mostrano il canvas di prima di T-52** —
   `docs/manual/screenshots/02_editor_main.png` e le vicine. Da rifare dalla macchina che ha il
   progetto `demo-manual` coi suoi 109 oggetti: rifarle su un progetto diverso darebbe schermate
   sbagliate in un altro modo.
4. **`check_viewer_layout.sh` non può passare in nessun checkout**: crea un progetto dal template
   `demo-items`, che non esiste più (ci sono `demo-items-lvgl` e `demo-items-web`). E la stessa
   guardia esce `7` **senza una riga di output** quando manca `LD_LIBRARY_PATH` a libpython — lo
   stesso difetto già corretto in `check_project_write_safety.sh`, stessa toppa.

### ✅ Tutto mergiato in `main` il 2026-09-06 — **e pushato** (`4ddacc5..b0e0e6c`)

`main` è a `e89a830`, **quattro commit sopra origin**, albero pulito. Confermato a schermo dal
maintainer (T-52, i tre difetti minori, e il tema chiaro provato commutando l'IDE).

| Commit | Cosa |
|---|---|
| `27f19ac` | T-52 — il limite della pagina è morbido |
| `c3099cd` | Q30 — «Aggiorna progetto» rifiutava ogni salvataggio successivo |
| `af657f9` | manutenzione: guardie rotte, il blocco del pannello, il tema chiaro |
| `e89a830` | tre corse in `ponte.test.ts`: la suite era intermittente |

#### I rami: cosa ne è stato

**Verificato prima di cancellare**, perché il progetto usa lo squash merge e un ramo già mergiato
risulta comunque «non mergiato» per ascendenza — la parentela non dice niente, conta il contenuto.

| Ramo | Esito |
|---|---|
| `fix/manutenzione-notturna` | mergiato in `af657f9`; albero di `main` **byte per byte identico** al ramo |
| `fix/editor-pannello-minori` | contenuto dentro il precedente (verificato con `merge-base --is-ancestor`) |
| `feat/T-50-chat-ai` | **già in `main`**: 5 righe caratteristiche su 5 presenti |
| `origin/feat/lvgl-gap`, `origin/feat/editor-runtime-chiarezza` | **già in `main`**: 5 su 5 |
| `origin/feat/chat-staccata-e-python` | **già in `main`**: 4 su 5 |
| `origin/fix/sws-display-path-loop` | **già in `main`**: i tre file di codice sono byte per byte identici, e il `PathExists=` che il fix toglieva non c'è più |
| `feat/scada-f6`, `feat/scada-f7` | **pre-riscrittura**, del 23 agosto. Solo 1 riga su 8 ritrovata in `main` — ma quel codice è stato riscritto da T-46 in poi, quindi la misura non prova niente in nessuna direzione |

I due pre-riscrittura non esistevano su origin: cancellarli sarebbe stato irreversibile, quindi
prima sono stati **archiviati con un tag** — `archivio/scada-f6` e `archivio/scada-f7`, locali e non
pushati. Se un giorno servisse qualcosa da lì, i commit ci sono ancora.

Tutti i rami locali sono spariti: resta **solo `main`**.

#### 🔜 Cosa resta

1. **Il push**, quando lo si vuole: `git push origin main` (quattro commit) e i tag di archivio
   `git push origin archivio/scada-f6 archivio/scada-f7` se li si vuole al sicuro anche su GitHub.
2. **I rami su origin non sono stati toccati** — cancellarli è un push, e serve un'istruzione
   esplicita:
   Il primo tentativo (2026-09-06) è fallito **in blocco**: conteneva
   `feat/T-52-limite-pagina-morbido`, che su origin non c'era più, e git rifiuta tutto il push se
   un riferimento non esiste. I cinque rami sono quindi ancora là:
   ```bash
   git push origin --delete feat/T-50-chat-ai feat/lvgl-gap \
       feat/editor-runtime-chiarezza feat/chat-staccata-e-python fix/sws-display-path-loop
   ```
3. **Le schermate del manuale** mostrano ancora il canvas di prima di T-52: vanno rifatte dalla
   macchina che ha il progetto `demo-manual`.
4. **F2 non è mai stato provato sul vetro**: vuole un avvio `--backend drm` con pagina e display di
   misura diversa. La matematica ha sei casi provati, il comportamento no.

### ▶ Cose rimaste in sospeso da prima di T-52

#### 👁 T-51 / fase 3 «gli occhi» — in `main` (`5af3be4`), da provare con un modello

L'assistente ha lo strumento `istantanea_pagina`: restituisce un'immagine di come **LVGL** disegna
una pagina, così può verificare invece di dichiarare fatto.

> Il maintainer ha detto che **T-51 lo sta definendo un'altra sessione**: questo ramo è la fase 3
> del piano della chat, presa nel frattempo. Non toccare `docs/CONTEXT.md` per il numero.

Il pezzo di disegno che conta: **un banco di prova**, non il runtime che gira. Il viewer LVGL vuole
una porta *viewer*, e l'IDE dove si chatta gira sull'editor, che non ne ha — e sul dispositivo,
dalla 2.4.0, l'IDE non c'è più. Quindi si avvia un runtime usa e getta su una copia del progetto in
una directory temporanea.

**Il banco di prova non si collega al campo**: il progetto copiato perde sorgenti, script globali,
notifiche e datastore. Senza, ogni fotografia avrebbe aperto Modbus e OPC-UA, si sarebbe presentata
al broker MQTT con lo stesso client id del runtime vero (l'incidente del 2026-08-21) e avrebbe
mandato email e Telegram. Ne segue che **i tag valgono il valore iniziale**: l'immagine dice com'è
fatta la pagina, non cosa mostra l'impianto adesso.

Verificato: `./scripts/check_istantanea.sh` (guardia nuova, fra le CON_STACK) prova la catena intera
e riapre il PNG per contare i pixel del rettangolo — 18784 su 20000 teorici. Provata anche rossa.
14 test: la lettura del PPM, il PNG, il filtro delle note, la sterilizzazione (sulla funzione **e**
sulla copia, perché una funzione giusta che nessuno invoca non protegge niente) e la forma del
blocco immagine, che è l'unica parte del percorso verso il modello provabile senza un modello.

**Da provare con un modello vero**: che l'assistente chiami lo strumento e *usi* l'immagine. Il
percorso HTTP e il blocco immagine sono scritti ma nessun modello li ha ancora esercitati — è la
stessa cosa che manca alla chat staccata.

Nota: `sws-lvgl-viewer` non è nell'immagine container **x86_64**, solo nell'arm64. Là lo strumento
dice perché non può.

#### Le due prove sul dispositivo che restano da fare

1. **Q34** — nell'IDE, uno script globale con `*/5 * * * *`: deve partire, e il campo cron deve
   mostrare il suggerimento con le forme ammesse passandoci sopra col mouse. **Questa si collauda
   a mano davvero.**
2. **Q30** — nel browser guarda le **regressioni**, non la corsa: che i salvataggi vadano, che
   backup/restore/import funzionino, che niente si pianti. La corsa in sé **non è riproducibile a
   mano** — la finestra è di millisecondi, due salvataggi da due schede sono lontani secondi — e la
   prova sta nel caso 6 di `./scripts/check_project_write_safety.sh` (10/10, e rosso disattivando
   il lock).

E le tre che nessuna guardia prova: il **Deploy completo** verso un dispositivo vero attraverso la
porta stretta `--no-admin`; la **chat staccata** con una proposta di modello vera;
`e2e/chat-ai.spec.ts`.

#### Cosa si potrebbe prendere in mano adesso

Nessuna di queste è iniziata, e ognuna sta in una sessione:

- **Q33** — lo «Stop» dell'acquisizione viene annullato in silenzio da un salvataggio delle
  Sorgenti: fermi l'impianto per lavorare in sicurezza e un salvataggio lo riavvia. Tre opzioni in
  scheda, **serve la tua scelta** prima di partire (l'opzione 1 — un `armed` esplicito nel
  supervisore — è 2-3h e prepara Q8-E).
- **La spia mancante nell'IDE** per uno script globale non schedulato: l'errore del cron va nel log
  e nel validatore, ma chi non guarda il log non lo scopre (addendum a Q34).
- **Q30, il pezzo che resta**: due schede che salvano la *stessa* sezione. Nessun lock lo risolve,
  serve un controllo ottimistico — e `calcola_impronta` è la granularità sbagliata (darebbe 409 a
  chi salva un tag perché un altro ha mosso un rettangolo). Serve un'impronta del solo
  `project.yaml` o un contatore di versione, che ora è facile: c'è un punto solo dove incrementarlo.
- **Il video della demo**, unico residuo di Fase 5 — task tuo, fuori dallo scope di Claude Code.

# x86_64, nessun SDK richiesto
./scripts/build_container_x86_64.sh --push
# aarch64 generico (Raspberry Pi, VM arm64): nessun SDK, tutto sotto QEMU
./scripts/build_container_aarch64_generic.sh --push
# aarch64 Pixsys: richiede l'SDK Yocto in /usr/local/oecore-x86_64/
./scripts/build_container.sh --push
```

Poi sul dispositivo: `./deploy/container/install-container.sh --pull`.

**Il primo dispositivo aggiornato è anche il primo collaudo del giro di deploy attraverso la
porta stretta** — la guardia dimostra che le rotte ci sono e rispondono, non che `remote_deploy`
arrivi in fondo. Se qualcosa non torna, la via di recupero è togliere il `#` dalla riga `Exec=`
in `~/.config/containers/systemd/sws-runtime.container` e
`systemctl --user daemon-reload && systemctl --user restart sws-runtime`: quella riga è già
scritta là dentro di proposito, perché `Exec=` sovrascrive il comando dell'immagine per intero e
ricomporlo a memoria su un dispositivo in campo vuol dire sbagliarne un pezzo.

**Cosa c'è dentro** (i sette commit sono nella history del ramo, con il dettaglio):

1. la chat dell'assistente si stacca in una finestra propria — l'ultimo pezzo del piano di T-50;
2. `POST /api/script/check` compila Python **senza eseguirlo**, più `controlla_python`,
   `leggi_script`, `schema_python`;
3. le regole del validatore sugli script globali, e il `child` delle celle di griglia che prima
   non veniva validato;
4. il diff dell'assistente ora **vede il Python**, riga per riga;
5. `--no-admin` diventa il default sui deploy, nella forma «porta stretta» invece che «porta
   assente»;
6. il passo AST nel controllo Python — vedi sotto, è la storia più istruttiva della sessione;
7. la riga `Exec=` pronta nel quadlet.

**Tre difetti vivi trovati strada facendo**, e due erano peggio di quel che stavo aggiungendo: il
cron che non capisce `*/5` e **non parte mai** in silenzio (**Q34**, registrata, non risolta); il
diff che mostrava «nessuna modifica» su una proposta che riscriveva una funzione; un bottone
dentro una cella di griglia che puntava al nulla senza che niente lo dicesse.

**La storia da ricordare**: il maintainer ha installato RestrictedPython su richiesta, e il ramo
del test sul sandbox — che prima si **saltava**, quindi non l'aveva mai eseguito nessuno — è
fallito subito, scoprendo un difetto nel disegno: `compile_restricted` compila `import os` e
`open(...)` senza obiettare, perché non sono costrutti proibiti ma nomi che a esecuzione non
esistono. Serviva il passo AST. Un test che si salta in silenzio è verde e cieco proprio sul
comportamento per cui esiste.

**Non provato, e va provato sul dispositivo:**

- il **giro completo del Deploy** verso un dispositivo in `--no-admin`;
- la **chat staccata con una proposta vera** dal modello (serve la chiave);
- la prova end-to-end della chat (`e2e/chat-ai.spec.ts`), che non è mai girata.

**Nota per i test Rust**: servono `LD_LIBRARY_PATH` verso la libpython di pyenv, altrimenti il
binario di test non parte. `export LD_LIBRARY_PATH=$(python3 -c 'import sysconfig;print(sysconfig.get_config_var("LIBDIR"))')`.

**Domande aperte accumulate in questa sessione**: **Q32** (quale delle due porte è la via normale
per modificare un progetto), **Q33** (`system/stop` annullato dal Salva delle Sorgenti), **Q34**
(il cron). Q8 ha ora un `Decided` del maintainer per l'opzione A.

---

### 0. Lo stato reale dopo il trasloco su frodo (2026-08-31, sera)

Il lavoro del **2026-08-31** è **su `main`**: i due rami (`fix/sws-display-path-loop`,
`feat/lvgl-gap`) sono stati squash-mergiati, pushati e rilasciati come **2.3.4**. I rami
esistono ancora su locale e su `origin` — verificato dalla sessione su theobroma che **non
contengono nulla di assente da `main`** (unica differenza: due righe di testo che main ha già
corretto). La cancellazione resta decisione del maintainer.

**Il lavoro è ripreso su `frodo`** (`pixsys@frodo`, `/home/pixsys/sws`), theobroma era al 99%
di disco. Verificato sulla macchina nuova, il 2026-08-31:

| | Esito su frodo |
|---|---|
| `cargo check --workspace --all-targets` | ✅ verde, 14 crate compreso `sws-lvgl-viewer` (clang 19 + SDL2 2.32 di Debian 13 vanno bene) |
| `cargo test --workspace` | ✅ **318 passati, 0 falliti** |
| `pnpm build` | ✅ verde (da lanciare **dentro `sws-editor/`**: fuori, `pnpm` non esiste) |
| `./scripts/check_static.sh` | ✅ **7 guardie statiche verdi** (le altre 13 vogliono uno stack in ascolto) |
| Prerequisiti di sistema | ✅ clang/libclang, SDL2, freetype, python3-yaml, qemu-user-static, binfmt, uidmap, podman 5.4.2. Mancano `rsync`, `skopeo`, `fuse-overlayfs` (nessuno indispensabile) |
| SDK Yocto | ✅ `/usr/local/oecore-x86_64/` (Pixsys 1.8.0, sysroot con libpython3.12, SDL2, libdrm) |
| Rete verso il WP630 | ✅ `192.168.1.120` risponde (la `/23` di `ens18` copre 192.168.1.x) |

Trappole di frodo, imparate durante il trasloco:

- **`pnpm` arriva da corepack**, che legge `packageManager` dal `package.json`: funziona solo
  dentro `sws-editor/`. Da altrove, `command not found`.
- **`python3` è pyenv 3.11.2** (`~/.bashrc` fa `pyenv init`), il Python di sistema è 3.13.5. Un
  controllo lanciato con `sudo` o da shell non interattiva usa un Python diverso da quello del
  maintainer, e può **passare per il motivo sbagliato**.
- **`rsync` non c'è**: per i trasferimenti, `tar cf - dir | ssh host 'tar xf -'`.
- **Il percorso dell'SDK è cablato in tre script** (`build_container.sh:66`,
  `build_containers_all.sh:68`, `yocto/build.sh:41`): deve stare in `/usr/local/oecore-x86_64/`.
- Identità git **locale al repo** (`Mauro Soligo <mauro@soligo.net>`), non globale.

**Il referto integrale del trasloco è in `docs/archive/2026-08-31-trasloco-frodo.md`** — sta solo
su theobroma e va ancora portato qui.

### 0-bis. `--istantanea`: si può guardare il pannello senza il pannello

La cosa più utile della giornata, e non era nel piano. Il viewer disegna una
pagina, salva un'immagine PPM ed esce; `--tocca "x,y;x,y"` tocca lo schermo
prima di fotografare e **dice quali comandi il tocco ha prodotto**.

```
sws-lvgl-viewer --base-url http://… --page "Indicatori" --istantanea /tmp/p.ppm
convert /tmp/p.ppm /tmp/p.png
```

Costa **+21 KB** sul binario ARM (misurati), perché il rendering di LVGL era già
interamente software: SDL2 e DRM servono solo a *mostrare* il buffer.

Nelle prime ore di vita ha trovato **otto** difetti, sei dei quali silenziosi:

| Difetto | Da quanto c'era |
|---|---|
| `LV_COLOR_SCREEN_TRANSP 0`: un oggetto semitrasparente **non veniva disegnato** invece di sbiadire | da sempre |
| Le pipe che salgono venivano tagliate (origine dal primo punto invece che dall'angolo) | da sempre |
| Le celle della griglia della demo erano vuote — **anche nel browser** (`objects:` non è un campo di `GridCell`) | mesi |
| La `setpoint` era una scheda bianca con le barre di scorrimento e il valore tagliato | da sempre |
| Widget catturati a (0,0) prima del calcolo di layout — **lo stesso difetto del 2026-08-24**, ripetuto scrivendo il movimento | ripetuto |
| `o_anchor_rule` della demo: intendeva una riga verticale, i due motori ne disegnavano una orizzontale | da sempre |
| Il percorso del movimento disegnato con `points` su una `line`, che nessun motore legge | introdotto oggi |
| `lv_msgbox_create` conserva il puntatore all'array dei pulsanti: array locale → **segfault** | introdotto oggi |

Il quinto merita una riga a parte: il 24 agosto quel difetto l'aveva trovato il
maintainer davanti al pannello, in una sessione. Il 31 l'ho ritrovato in due
minuti.


# se binario e SPA sono già costruiti, aggiungere --no-rust --no-spa: salta ~10 min
```

Sul dispositivo è rimasto il progetto **`ProvaDemoWeb`**, che è del 25 agosto e
contiene un `import math` che la sandbox blocca: fa errori ogni secondo. Non è un
difetto del template — quello è sano — ma di quel progetto. **Va ricreato dal
modello e rideployato.**

### 2. I test mai fatti sul dispositivo

> 🔴 **Prima di collegarti: il WP630 è rimasto in modalità configurazione.** Misurato su
> theobroma il 2026-08-31 alle 16: uptime 442 minuti (nessun riavvio in giornata),
> `chromium@wp-control.service` attivo, `desktop.target` **inactive**. In quello stato
> `sws-display-apply.sh` si rifiuta — correttamente — di toccare lo schermo, quindi **qualunque
> prova di commutazione fallirà per il motivo sbagliato**. Serve un riavvio normale (senza
> premere STOP). Le unit della commutazione, dopo la correzione della 2.3.4, sono sane
> (`sws-display.path` active, non failed).
>
> ⚠️ **Contraddizione da sciogliere**: a metà giornata il maintainer ha detto «il test al
> riavvio funziona», ma sul WP630 non risulta alcun riavvio. Forse era un altro dispositivo.
> Il test 13 resta da rifare su un device di cui si conosce lo stato.

| | Cosa | Esito |
|---|---|---|
| 10 | **Riavvio tenendo premuto STOP** (angolo in alto a **destra**, oltre 10 s) | ✅ **2026-08-29**: compare la login di Cockpit; nel manager podman `sws-lvgl-viewer` fermo, `sws-runtime` attivo |
| 11 | Il runtime non si ferma | ✅ `/health` 200, admin 200, Cockpit 200 |
| 12 | Il log dice perché | ✅ «il launcher è in modalità configurazione (chromium@wp-control.service attivo)» |
| 13 | Ritorno alla normalità | 🔲 riavvio senza toccare nulla → il pannello torna sul motore del progetto |
| 14 | Deploy **senza riavviare il runtime** | 🔲 lo schermo commuta da solo entro una decina di secondi — **richiede la 2.3.4 sul device** |
| 15 | Progetto da `enip-demo` creato **sul dispositivo** | 🔲 si apre e mostra la pagina di partenza — **richiede la 2.3.4 sul device** |

**Il passo 10 è superato.** Era il pezzo con meno certezza: fino al 2026-08-29
era stato provato solo *simulando* la modalità configurazione (avviando a mano
`chromium@wp-control`), mai col gesto vero all'avvio. Ora è confermato che il
meccanismo del launcher Pixsys e il nostro si rispettano, e che la via di fuga
del pannello resta aperta anche con SWS installato.

Misurato in modalità configurazione: `desktop.target` **inactive** — è il
discriminante su cui si regge `sws-display-apply.sh`, e regge.

### 5. Cosa aspetta ancora una conferma a schermo

Da tre sessioni: il **pull del progetto dall'IDE**, la **sezione Python unificata**, il **colore
del testo derivato dallo sfondo pagina**. Sono lavori finiti che nessuno ha mai guardato.

### 6. Il divario che resta fra web e LVGL

`model.rs` dichiara 238 campi. Erano **112 mai disegnati**; con `feat/lvgl-gap`
sono **71** — misurato di nuovo su `main` il 2026-08-31, non a memoria (confronto
dei nomi fra `model.rs` e `lvgl_render.rs` + `effects.rs`; il comando è nel referto del
trasloco). Le prime stesure di questa sezione dicevano 84: era il conto a metà del piano, prima
dei passi 9-10.

Chiusi il 2026-08-31: `opacity`, `z_index`, tutto il gruppo `blink_*`,
`stale_after_s`, `bad_value_style`, `show_alarm_state`, `quality_dot*`,
`text_wrap`/`text_valign`/`line_height`, `symbol_spin*`, `symbol_states`,
`motion_*`, `from_obj_id`/`to_obj_id` e le porte, `require_confirm`/
`confirm_message`/`critical`, più il gauge che segue le soglie dal vivo.

Restano, per ordine di conseguenza:

- **`require_reason` e la ri-autenticazione di `critical`** — il motivo di una
  scrittura critica non finisce nell'audit se il comando parte dal pannello.
  Servirebbe una tastiera e una sessione autenticata nel viewer.
- **`pipe_flow`** (tratteggio in movimento) e i marcatori delle pipe.
- **Grafici**: `bar_mode` (impilate/affiancate), legende, soglie,
  `pie_show_labels`, raggruppamento delle fette sotto soglia — 13 campi.
- **Trend**: il gruppo `trend_dt_*` sul formato di data e ora, i marcatori di
  allarme, la scala logaritmica.
- **`alarm_bell_sound*`** — il pannello non ha un suono.
- Il resto è editor-only (`locked`, `group_id`) o UX (`min_role`, dichiarato
  tale in `sws-core/src/project.rs`).

---

### Difetti trovati strada facendo

- **Nessun campo opzionale del progetto poteva essere cancellato** (2026-08-27).
  `merge_preserved` in `patch_project` ricopia le chiavi di primo livello che il file ha e la
  serializzazione non contiene — serve a non perdere ciò che una versione più nuova ha scritto.
  Ma azzerare un campo opzionale lo fa sparire dalla serializzazione: la conservazione lo
  scambiava per "chiave che non conosco" e **rimetteva il valore vecchio**.
  `PUT /api/project/page-layout` con corpo `null` rispondeva 204 e non cancellava niente, mentre il
  commento dell'endpoint dice che lo fa. Valeva per **ogni** campo opzionale di primo livello, non
  solo `page_layout`.
  Corretto confrontando con le chiavi che la struttura produceva *prima* della modifica — dedotte
  serializzando, non da un elenco a mano: un elenco si disallinea al primo campo nuovo, e quel
  campo diventerebbe silenziosamente incancellabile.
  Trovato **per caso**, ripristinando il device dopo una prova. Provato end-to-end sul WP630: set →
  presente, `null` → sparito, resto del progetto intatto.


- **Il riempimento `end-to-start` era rotto sul web**: partiva dal capo
  sbagliato e a livello pieno spariva del tutto. Trovato solo riscrivendo la
  stessa cosa per LVGL — due implementazioni della stessa regola si controllano
  a vicenda.
- **Il logo della demo era rotto anche sul web**: `src: logo.svg` si risolve
  alla radice del runtime, dove non c'è nulla (il logo sta sotto
  `/branding/<marchio>/`). Corretto in entrambe le varianti.
- **Q24 (nuova): il font del pannello non ha le lettere accentate.** Montserrat
  di LVGL copre solo l'ASCII, e ciò che manca non si disegna affatto. Su
  `demo-items-lvgl` mancano `—` (32 volte), `→` e `ù`. Il terzo è quello che
  conta: l'interfaccia è in italiano. I template **non** sono stati riscritti
  per aggirarlo — sarebbe nascondere il difetto.
- **Q23 (nuova): driver ROS 2**, chiesta dal maintainer. Portata ridotta da lui
  stesso: servono dati semplici agganciati a gauge/led/trend/button, non la
  rappresentazione del robot. Resta quindi solo la questione del *source*.

### Guardie nuove

`scripts/check_lvgl_symbols.sh` — la tabella dei simboli vendored del viewer
contro quella dell'editor, più l'esistenza dei file. Serve perché 7 nomi file su
11 **non** coincidono con l'id (`battery` → `battery-charging-high.svg`): chi si
fidasse della convenzione otterrebbe 7 simboli muti su 11. Provata in entrambi i
versi.

`check_demo_templates.sh` ha fatto il suo lavoro da solo: appena `image` è
diventato un tipo supportato da LVGL ha segnalato che palette, elenco solo-web e
template erano rimasti indietro.

**Aggiunte il 2026-08-31** (sui due rami in attesa di merge):

| Guardia | Cosa impedisce |
|---|---|
| `check_lvgl_types.sh` | il badge «L» della palette mente sui tipi che il pannello disegna |
| `check_systemd_units.sh` | condizioni di livello che fanno ciclare una unit, `.path` verso unit inesistenti, `ExecStart=` relativi |
| `check_static.sh` | **le altre non venivano lanciate**: a fine sessione se ne ricordavano sei, per nome, a memoria. Le lancia tutte, e fallisce se in `scripts/` compare un `check_*.sh` non classificato |

E dentro `check_templates.sh`: ancoraggi delle pipe verso oggetti inesistenti,
porte sconosciute, celle di griglia che non disegnano niente, `points` su una
`line`, `write_value` di un tipo diverso da quello del tag.

Tutte provate **anche nel verso rotto**. Una guardia che non si è vista fallire
non è una guardia.


> **SUPERATO** — vale fino alla 2.1.1; da allora sono uscite 2.2.0, 2.3.0, 2.3.1,
> 2.3.2 e 2.3.3. Tenuto perché la trappola del `[patch.crates-io]` fuori dalla
> radice del workspace vale ancora, ed è la ragione di
> `scripts/check_vendor_patches.sh`.
>
> **2.1.1 rilasciata; immagine arm64 RIPUBBLICATA il 2026-08-26.** Il pannello può
> essere aggiornato: `./install-container.sh --pull` prende `latest-arm64`.
>
> ⚠️ **Se hai aggiornato un dispositivo il 25 agosto, rifai il pull.** La prima
> immagine pubblicata sotto quel tag conteneva LVGL senza la correzione del crash
> (`[patch.crates-io]` va nella radice del workspace, e c'era finito nel manifest
> del crate — cargo lo ignora). Verificato sul WP630: quella usciva con SIGSEGV in
> 20 s sulla pagina dei grafici, questa regge 75 s. Il tag git `2.1.1` è stato
> spostato sul commit che corregge.

### 1. Il WP630 è aggiornato alla 2.1.1

Fatto il 2026-08-26 con `./install-container.sh --pull`, dal percorso documentato.
`/health` ha risposto dopo 2 s.

| | |
|---|---|
| Runtime | 2.1.0 → **2.1.1** |
| Progetto | `DemoItemsLVGL` intatto, 23 tag, 4 pagine |
| Storico | **773.861 campioni conservati** |
| Viewer | dall'immagine — **nessun binario montato a mano** |
| Pagina "Grafici e tabelle" | 20 widget, nessun crash |
| Ricarica automatica (Q20) | funziona: salvata una pagina dall'IDE, il pannello si ridisegna da solo |

Per aggiornare un altro dispositivo servono `install-container.sh` e
`sws-runtime.container` da `deploy/container/` — sul WP630 non c'erano e li ho
copiati in `/data/user/sws-container/`.

### 2. Immagini pubblicate, e quella che manca

| Tag | Stato |
|---|---|
| `2.1.1-arm64`, `9afcb27-arm64`, `latest-arm64` | ✅ **è quello dei pannelli Pixsys** |
| `2.1.1-arm64-generic`, `9afcb27-arm64-generic`, `latest-arm64-generic` | ✅ aggiornata il 26/08 |
| `2.1.1-amd64`, `9afcb27-amd64`, `latest-amd64` | ✅ pubblicata |

Tutte e tre allineate al commit `9afcb27` di `main`, verificate interrogando il
registry con token anonimo — non dal log della build.

Provate sul WP630 sulla pagina "Grafici e tabelle", quella che senza la
correzione di Q22 fa uscire il viewer con SIGSEGV in 20 secondi:

| Immagine | Esito |
|---|---|
| `2.1.1-arm64` | 75 s stabile, 0 errori |
| `2.1.1-arm64-generic` | 60 s stabile, 0 errori, 20 widget creati |

L'immagine `amd64` non contiene il viewer LVGL (verificato: solo `sws-runtime`),
quindi non era interessata dal difetto.

L'immagine **aarch64-generica non l'ho potuta fare**: quel percorso richiede
`sudo` con password, e non c'eri. Serve lanciare a mano:

```
./scripts/build_container_aarch64_generic.sh --push
```

Non è quella che usano i pannelli Pixsys (loro prendono `latest-arm64`), quindi
non blocca niente di immediato.

### 3. Da provare — le cose che non ho visto confermate da te

| Cosa | Dove |
|---|---|
| **Riaprire nell'IDE il progetto del dispositivo** | Configurazione → Runtime, sotto Deploy |
| **La sezione Python unica** | Configurazione → Python |
| **Il testo che segue lo sfondo pagina** | una pagina con sfondo scuro e tema app chiaro |

Il resto l'ho verificato dal vivo sul WP630.

### 4. Il programma: cosa resta

**E — F9c: ✅ fatto il 2026-08-26.** Il modello del pannello dichiara tutti i 238
campi del mirror autorevole; prima ne conosceva 101 e gli altri 137 sparivano in
silenzio. `scripts/check_lvgl_parity.sh` confronta le due struct e fallisce se il
web ne aggiunge uno e il pannello resta indietro — provato in entrambi i versi.

⚠️ **Dichiarato non vuol dire disegnato**, ed è la distinzione da non perdere:

- *conosciuto* — il valore attraversa il modello e sopravvive al round-trip di un
  progetto. È quello che è stato chiuso adesso, e chiude la categoria dei difetti
  **muti**;
- *reso* — esiste il codice nel `render_*`. Qui resta lavoro: rifiniture di forma
  (raggio, sfumature, zone del gauge), table/bar/pie, simboli e animazioni F6.
  Ora però è un elenco visibile, non un buco.

Il modo giusto di attaccarlo è il banco di prova: aprire le stesse pagine dei
template gemelli sui due motori e annotare le differenze, dal più vistoso al più
sottile.

**D2 — rasterizzazione SVG**: ✅ fatto e rilasciato nella 2.3.0. Simboli vendored,
simboli custom e widget `image` si disegnano con `resvg`. Misure prese prima di
cablare: binario +1,26 MB, sul WP630 10,68 MB di RAM su 2,08 GB.

### 5. Stato del WP630

> Sezione superata. Lo stato corrente è in cima al file: **2.3.2 installata
> pulita dall'IDE il 2026-08-28** dopo un factory reset, nessun binario montato
> a mano. Quanto segue descriveva la 2.1.0 ed è conservato solo per la storia.

### 6. Due trappole degli script Python, imparate a caro prezzo

Scritte nei commenti dello script del template, dove le legge chi ne scriverà un
altro:

- **niente `import`** — gli script girano in RestrictedPython con `safe_builtins`.
  Insidioso perché sul PC di sviluppo RestrictedPython di solito non è installato
  e il runtime ricade sull'esecuzione non ristretta: lì l'import passa, e si
  scopre tutto solo sul pannello;
- **una funzione non vede le costanti definite fuori** — il runtime esegue con
  `exec(codice, globals, {})`, e le assegnazioni di primo livello finiscono in un
  dizionario locale usa-e-getta.

---

## ▶ Da fare, dalle sessioni precedenti

> **Riverificato il 2026-09-12** e trasformato in piani singoli dove il lavoro era ancora vivo
> (istruzione del maintainer: "varie questioni aperte, trasformale in singoli plan"). Questa
> sezione ora punta ai piani invece di ripetere il testo.

1. ~~**Riaprire nell'IDE il progetto che sta sul runtime (pull)**~~ — **fatto**. Resta solo la
   conferma a schermo.
2. **Ruolo minimo inefficace in no-auth, l'editor non lo dice** — misura (a) confermata dal vivo
   il 2026-09-12 (`whoami` risponde Admin sintetico), dichiarazione (c) già fatta (Q36). Resta
   solo l'avviso nell'editor (b): piano in
   [`docs/archive/2026-09-12-ruolo-minimo-avviso-noauth.md`](../docs/archive/2026-09-12-ruolo-minimo-avviso-noauth.md).
3. **F9c — parità LVGL, verifica dal vivo**: il grosso è già fatto (35 tipi, 238 campi, i due
   check di coerenza esistono entrambi — verificato il 2026-09-12, `check_lvgl_types.sh` incluso,
   diversamente da quanto diceva questa voce). Resta solo il collaudo sul dispositivo, ora
   possibile (2.7.3 installata sul TC620): è la **Parte B** di
   [`docs/plans/2026-09-12-F5.3x-xy-plot-e-verifica-lvgl.md`](../docs/plans/2026-09-12-F5.3x-xy-plot-e-verifica-lvgl.md),
   non un piano a parte.
4. ~~**F5.3x — XY plot multi-coppia**~~ — **fatto**, release 2.7.3, confermato anche sul TC620
   (vedi sopra). Vedi
   [`docs/plans/2026-09-12-F5.3x-xy-plot-e-verifica-lvgl.md`](../docs/plans/2026-09-12-F5.3x-xy-plot-e-verifica-lvgl.md).
5. ~~**F7 residui minori**~~ — **fatto**, entrambe le parti (bordo per-cella griglia, rimando al
   motivo dell'ACK nello storico allarmi). Referto in
   [`docs/archive/2026-09-12-f7-residui-minori.md`](../docs/archive/2026-09-12-f7-residui-minori.md).
6. ~~**Q18 aperta**~~ — **decisa e implementata**. Resta solo la conferma a schermo.
7. **Pagine demo CasaMauro** ferme alle feature F2-F6: piano in
   [`docs/archive/2026-09-12-casamauro-arricchimento-demo.md`](../docs/archive/2026-09-12-casamauro-arricchimento-demo.md)
   — non tocca il repo, è il progetto personale del maintainer su questa macchina.

## Storico (sessioni chiuse: mergiate e verificate — dettaglio in `CHANGELOG.md` e `git log`)
**Sessioni di luglio-settembre spostate in [`docs/history/STATUS-2026-07_08.md`](docs/history/STATUS-2026-07_08.md) il 2026-09-06** — una riga ciascuna:

- 2026-09-02 · Release **2.4.0** (superata dalla 2.5.0) e divisione editor/runtime (`e98138b`, ADR 0003)
- 2026-09-01 · T-50 chat IA mergiato; chiusure delle sessioni notturne del 31/08-01/09
- 2026-08-31 · trasloco su frodo; immagini 2.3.4 pubblicate; `--istantanea`
- 2026-08-28 · lavoro sui template chiuso; `sudo` chiesto all'inizio (2.3.3)
- 2026-08-23 · Release **2.1.0** — F6 (faceplate 2.0, simboli N-stati, animazioni), F7 (table/bar/pie/allarmi 2.0), F8 (strumenti di layout), editor coerente. ~76 voci di sessione dal 2026-08-07 al 2026-08-23, integrali nell'archivio
- 2026-08-07/08 · motore LVGL fasi 1-3 (branch `feature/lvgl*`)
- 2026-08-05/06 · MQTT: client_id, riconnessione col watchdog, timeout su poll; T-41…T-45; boot con `--project`
- 2026-08-02/03 · container aarch64 generico; sorgente MQTT che moriva per sempre
- 2026-07-30/31 · Release **2026.7.0**; container x86_64 e installazione dal registry; riconciliazione dei branch


- **2026-07-09** — fix tema chiaro: righelli canvas + pannello LOG, colori hardcoded → `var(--brand-*)` (`71fb0d9`). Confermato in browser.
- **2026-07-08** — **T-38 brand Pixsys** white-label (`cfee5f1`): `public/branding/pixsys/` (brand.json 10 token, logo, favicon), `active.json` → `pixsys`.
- **2026-07-07** — **T-37 build pacchetti** (`2a991e9`): `scripts/build_deploy.sh` → 4 tarball editor/runtime × x86_64/aarch64; installer `deploy/{editor,yocto,generic-linux}`; fix `--viewer-port` mancante nei launcher.
- **2026-07-06** — **T-35 infrastruttura white-label**: `public/branding/` + loader `applyBranding()` (CSS var `--brand-*`, title, favicon); ~977 colori di chrome portati a `var(--brand-*)`.
- **2026-06-20** — **GitHub issue #2** (import progetto: `<input type=file>` smontato alla chiusura del menu → `onChange` mai eseguito), regression test `e2e/import-tags.spec.ts`; bugfix grid paste/cut in sub-celle, riscrittura `TagInput`, valore live in Variabili, auto-deploy al salvataggio.
- **T-34** — runtime mono-progetto (marker `.active-project`), versionamento progetto (`saved_by`, `POST /api/project/migrate`), no-auth mode. Verificato da `scripts/test_t34.sh` (18/18 verdi).
- **WebSocket remote bridge + no-auth + deploy relay** — `POST/DELETE /api/remote/connect`, `GET /api/remote/status`, `/ws/remote/{tags,alarms,logs}`, `POST /api/remote/deploy` (nessun fetch diretto browser→device).
- **TLS opzionale** — HTTP plain di default, HTTPS se `config/tls.crt` è presente all'avvio; endpoint admin genera self-signed / carica cert+key / disabilita, con reboot.
- **Split `dev.sh`** → `start_runtime.sh` (viewer 8443 + IDE 8444 + companion HTTP 8080) e `start_editor.sh` (IDE 8460 + companion 8090).
- **T-29…T-33** — widget canvas Bar Chart, Pie/Donut, Sparkline, Text List, Alarm Viewer inline.
- **T-28** — IDE package builder + deploy SSH su device. **T-27** — packaging generic Linux (`package.sh` + installer systemd). **T-26** — git commit/push dall'IDE. **T-25** — remote log viewer. **T-24** — project fingerprint SHA256 + dashboard Device.

**Branch**: `main` = `c4d8e62`, allineato a `origin/main`. Pulizia branch del 2026-07-27: eliminati i branch già assorbiti in `main` (`feat/T-37-build-deploy`, `fix/light-theme-ruler-log`, `feat/T-39-ide-i18n`, `feat/T-40-project-i18n`, `fix/T-40-regressions`). Aperto e **non mergiato**: `feat/project-location-and-brand-presets` (da testare in browser). Tenuti apposta: `archive/office-line-2026-05-21`, `backup/friday-phase-a1`.

---

## Remaining tasks

> Unica traccia del lavoro ancora aperto. Aggiorna man mano che gli item si chiudono.

> **Piano "migliorie editor" (2026-07-27)**: 4 blocchi decisi col maintainer — (1) stato "non salvato" ✅, `feat/dirty-state-and-save`; (2) zoom + toolbar contestuale ✅, `feat/editor-zoom-toolbar`; (3) header a due livelli ✅, `feat/slim-app-header`; (4) creazione cartelle nel picker + copia progetto sul PC ✅ fatto, branch `feat/fs-mkdir` sopra `feat/project-location-and-brand-presets`. Tutti e 4 mergiati in `main` il 2026-07-27 dopo validazione in browser.

**Validazioni in sospeso (browser / runtime reale)**

- [ ] **Audit log + `--no-admin`** (2026-07-26): vista Audit in Configurazione → Sistema; `--no-admin` su un device reale (richiede `--viewer-port`).
- [ ] **Telegram** (2026-07-26): rebuild+restart runtime per attivare allarmi Telegram e `send_telegram` negli script; validare l'uniformazione del tasto Salva.
- [ ] **MQTT** (2026-07-24): riavvio runtime per il cap browse a 120 s; hard-refresh per palette su progetto vuoto e "Estrai da JSON".
- [ ] **Multilingua T-39/T-40** (2026-07-13/21): switch lingua UI, tab Lingue (2 selettori + filtro/ordinamento), `lang_selector` in un template, anteprima canvas in lingua Editor.
- [ ] **Branding** (T-35/T-38, entrambi in `main`): logo/palette/titolo/favicon Pixsys in tema **chiaro e scuro**, IDE (8460/8444) e viewer (8443); switch brand via `public/branding/active.json`.
- [ ] **Pacchetti T-37 su device reale**: `sws-runtime-*-linux-aarch64.tar.gz` su un Pixsys (`sudo ./install.sh` → `/data/user/sws`), viewer `:8443` + IDE `:8444`; su PC `sws-editor-*` + `./run-editor.sh`.
- [ ] **Verifica manuale T-27** — packaging tarball + installer generic Linux. Comandi sotto.
- [ ] **Verifica manuale T-24/T-25/T-26** — fingerprint/device dashboard, remote logs, git commit/push. Comandi sotto.

**Debito tecnico noto (non bloccante)**

- [x] **`sws-kiosk` non rispetta `--viewer-port`** — **risolto 2026-08-13**: lo spawn passava
  `https://localhost:8443` a mano invece della variabile `vport` già disponibile nella stessa
  funzione (branch `fix/mdns-interfaces-kiosk-viewerport`, non ancora mergiato).
- [ ] **`stop_existing()` in `scripts/start_runtime.sh` usa `fuser`** — su macOS o sistemi senza `fuser` non funziona. Non prioritario (sviluppo su Linux).
- [ ] **mDNS**: in container serve `--host-network` (la rete bridge di podman non passa il multicast). Verificato che attraversa `192.168.0.x` ↔ `192.168.1.x` su questa LAN, quindi il vecchio appunto "non attraversa subnet" era sbagliato. Il punto sotto ("un device con più interfacce compare più volte") **verificato 2026-08-13 già risolto** dalla dedup per `fullname` esistente in `discover.rs` (`seen: HashMap`, con promozione dell'indirizzo su risposte migliori) — nessun cambio necessario, la nota era superata.
- [x] **T-49 — mDNS annuncia anche sulle interfacce veth di podman/docker, l'editor sceglie quella sbagliata** — **risolto 2026-08-13** (branch `fix/mdns-interfaces-kiosk-viewerport`, non ancora mergiato): `announce_mdns()` ora annuncia solo l'indirizzo di `detect_lan_ip()` (già esistente nello stesso file) invece di chiamare `enable_addr_auto()`, che pubblicava un indirizzo per ogni interfaccia — comprese le veth link-local. Ripiego sul vecchio comportamento se `detect_lan_ip()` fallisce.
- [ ] **Q8 C/E/F** — reload granulare, split processi runtime/IDE, python out-of-process. Vedi `docs/OPEN_QUESTIONS.md`.

### Verifica manuale T-27 da fare

```bash
# Build tarball completo (richiede ~5 min per cargo + pnpm)
./scripts/package.sh

# Verifica struttura
tar tzf dist/sws-0.1.0-dev-linux-x86_64.tar.gz | head -10

# Test installer in locale (o su VM)
tar xzf dist/sws-0.1.0-dev-linux-x86_64.tar.gz
sudo ./sws-0.1.0-dev-linux-x86_64/install.sh
# → apri https://localhost:8443 e https://localhost:8444
```

### Verifica manuale T-24/T-25/T-26 da fare

```bash
# Avviare runtime locale (viewer 8443 + IDE/admin 8444)
./scripts/start_runtime.sh

# T-26: Configurazione → Runtime → connettiti → sezione "GitOps"
# → "💾 Commit" → scrivi messaggio → Salva
# → "↑ Push (N)" → confirm → mostra output git push

# T-24: Configurazione → tab "Device"
# → aggiungi device (URL del runtime locale: https://localhost:8444, admin/admin)
# → "Aggiorna" → mostra stato online + firma SHA256
# → "Connetti" → l'IDE si connette a quel runtime

# T-25: Configurazione → Runtime → connettiti
# → sezione "Log remoti" → "Aggiorna" → lista log
# → "● Live" → aggiornamento automatico ogni 5 s

# Smoke fingerprint:
TOKEN=$(curl -sk -X POST https://localhost:8444/api/auth/login \
  -H 'Content-Type: application/json' -d '{"username":"admin","password":"admin"}' | jq -r .token)
curl -sk -H "Authorization: Bearer $TOKEN" https://localhost:8444/api/project/fingerprint
# → {"sha256":"...","computed_at_ms":...}
```

---

## Feature set consegnato (PoC completo T-01…T-40)

| Area | Funzionalità |
|------|-------------|
| **Protocolli** | Modbus TCP+RTU, MQTT+Sparkplug B, OPC-UA client+server, HomeAssistant WS, Siemens S7, EtherNet/IP |
| **Editor canvas** | Tutti i widget, symbol picker (22 built-in + custom), faceplate, grid, undo/redo 200 step, gestione pagine (dimensionamento, riordino, miniature, lock, home) |
| **Auth/RBAC** | Argon2id, 4 ruoli, ABAC zone, session TTL configurabile per utente, audit log hash-chain |
| **Allarmi** | ISA-18.2 state machine, multi-condizione, delay, inhibit, shelving, webhook, SMTP escalation, Telegram |
| **Historian** | Ring-buffer + SQLite per-progetto, CSV export, trend interattivo |
| **Deploy** | Dual-port 8443/8444, `--instance N`, `--no-admin` (operator-only), mDNS discovery, deploy remoto via SCP/systemd, GitOps (pull/rollback/commit/push) |
| **Observability** | Project fingerprint SHA256, device dashboard multi-runtime, remote log viewer live, audit log verificabile |
| **Canvas** | Pipe/tubazione multi-waypoint (flat/tube/wire), SVG path animato, drag waypoint |
| **Widget avanzati** | Bar Chart, Pie/Donut, Sparkline, Text List, Alarm Viewer inline |
| **Multilingua** | UI IT/EN (react-i18next, ~667 chiavi) + tabella lingue di progetto (`{{token}}`, CSV, `lang_selector`) |
| **Branding** | White-label via `public/branding/` (brand.json + logo + favicon + 10 token colore); brand Pixsys |
| **Packaging** | `scripts/build_deploy.sh` → tarball editor/runtime x86_64+aarch64; installer systemd generic-linux e Yocto |
| **IDE deploy** | Build tarball + deploy SSH su device direttamente da Configurazione → Runtime |
| **PWA** | Service worker, manifest, auto-rotate kiosk, mobile layout |
| **Infra** | Yocto cross-compile (aarch64), Prometheus `/metrics`, log JSONL rotato, backup auto |

---

## Open questions

Vedi `docs/OPEN_QUESTIONS.md` — Q1…Q7 decise. **Q8** (isolamento runtime↔IDE): A/B/D fatti, **C/E/F aperti**.
