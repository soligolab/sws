# SWS — Current Status

> Session-to-session memory. Leggi all'inizio di ogni sessione, aggiorna alla fine.
>
> Ambienti di test: vedi [docs/TEST_SETUPS.md](docs/TEST_SETUPS.md) (casa, dev server, dispositivi Yocto).
>
> **Pulizia 2026-07-27**: rimossi i task già chiusi e le sezioni di verifica ormai superate; le sessioni mergiate **e** verificate fino al 2026-07-09 sono compresse in «Storico». Il dettaglio integrale resta in `CHANGELOG.md` e nella history git.

## ▶ Da fare nella prossima sessione

> **Sessione del 2026-08-24 (ufficio).** Sei branch aperti, tutti spinti su origin, **nessuno
> mergiato**: mancano le tue conferme. Il lavoro riprende da qui. La build è verde su tutt'e due i
> lati sulla punta di `feat/lvgl-trend-tags`.

### 0. Dove eravamo — branch aperti, in ordine di impilamento

Sono impilati uno sull'altro (ciascuno contiene i precedenti), quindi vanno mergiati **in
quest'ordine**, con squash, e solo dopo che hai confermato che la cosa funziona:

| Branch | Cosa | Confermato? |
|---|---|---|
| `feat/ide-pull-progetto` | Riaprire nell'IDE il progetto che gira sul dispositivo | ❌ da provare |
| `feat/lvgl-movimento` | Gli oggetti si muovono davvero coi binding | ✅ **confermato a schermo** |
| `fix/mdns-reti-multiple` | "Cerca runtime" su dispositivi con due schede | ✅ provato dal vivo sul WP630 |
| `feat/mqtt-skip-verify` | `insecure_skip_verify` fa quello che dice | ✅ provato contro un broker vero |
| `feat/lvgl-trend-tags` | I trend LVGL leggono `trend_tags[]` | ⚠️ test verdi, **mai visto a schermo** |
| `feat/template-demo-items` | *(vuoto — solo il piano, il lavoro è da fare)* | — |

⚠️ **`main` ha un commit di funzionalità diretto**, `6b9f8d0` (binding generici LVGL): l'ho messo lì
prima di aprire il primo branch, contro la regola 2 di `CLAUDE.md`. È già dentro e funziona (l'hai
confermato), ma è una deviazione da sapere, non da scoprire.

### 1. Template gemelli "Demo Items - Web" e "Demo Items - LVGL" — **il lavoro in corso**

Piano completo e approvato in [docs/plans/2026-08-24-template-demo-items.md](docs/plans/2026-08-24-template-demo-items.md).
Branch `feat/template-demo-items`, ancora **vuoto**: c'è solo l'analisi, il lavoro è tutto da fare.

Deciso con te: **stessa demo in due varianti** (stesse pagine, stessi id, stesse coordinate; la
variante LVGL omette solo i 4 tipi solo-web), pagine **1280x800**, dati mossi da uno **script Python
interno** invece che dal broker pubblico.

Misurato, da non rimisurare:
- i tipi sono **35** in palette, **31** su LVGL; i 4 solo-web sono `image`, `kpi_tile`,
  `alarm_history`, `data_log`;
- `SUPPORTED_TYPES` e `LVGL_SUPPORTED_TYPES` **combaciano** oggi (31 e 31);
- `lvgl-demo` copre già 31/31; `demo-items` solo **19/35**;
- Python 3.12 e `libpython` ci sono **dentro il container sul WP630**, quindi lo script gira sul
  pannello anche senza rete;
- un template è una cartella sotto `examples/templates/`, l'elenco è una scansione di directory:
  nessun indice da aggiornare, basta creare e cancellare cartelle.

### 2. Ripubblicare l'immagine — **rimandata da te, resta in sospeso**

L'immagine su GHCR è ferma a prima di *tutte* le correzioni di oggi. Finché non si ripubblica, sul
WP630 restano rotti il discovery mDNS e i trend LVGL, e il viewer va montato a mano da `/tmp`.

⚠️ **Sul pannello non è rimasto niente di montato a mano**: la unit quadlet è tornata identica al
backup (verificato con `diff`). Il binario in `/tmp/lvgl-v8` c'è ma **`/tmp` si svuota al riavvio**,
quindi non fidarsene.

### 3. Il viewer LVGL sul pannello è fermo

È uscito con **404 su `Page 1`**: quella pagina non esiste più, perché il progetto attivo ora è
`testLVGL` (le pagine sono `LVGL Demo`, `LVGL Demo - Pagina 2`, `LVGL Demo - Pagina 3`). Non è un
difetto del binario — è quello nuovo, con movimento e trend. Va rilanciato con `--page` giusto.

### 4. Domande aperte nuove

- **Q20** — il viewer LVGL non si accorge che il progetto è cambiato: scarica la pagina una volta
  sola. È costato una diagnosi sbagliata oggi (un'ellisse modificata che sembrava un difetto di
  rendering ed era una pagina vecchia).
- **Q21** — Funzioni e Script sono due superfici Python in due punti lontani dell'IDE. Tua domanda;
  la distinzione è reale, la scelta è solo dove mostrarle.

---

## ▶ Da fare, dalle sessioni precedenti

1. **Riaprire nell'IDE il progetto che sta sul runtime (pull, non solo push)** — richiesta del
   maintainer del 2026-08-24. Connettendosi a un runtime vuole poter rimettersi a lavorare sul
   progetto che gira **lì**, chiudendo quello aperto nell'IDE, invece di ripartire dalla copia
   locale che può essere vecchia o di un altro impianto.
   *Oggi il flusso è solo in spinta*: `Configurazione → Runtime → Connetti` apre la connessione
   lato server (`/api/remote/connect`) e il Deploy manda il progetto locale al device
   (`remote_deploy` in `sws-web/src/remote.rs`: zip con `build_project_zip` → `PUT
   /api/project/import` del remoto). **Niente tira indietro**, ma i pezzi per il verso opposto
   esistono già tutti:
   - lato device **nessun endpoint nuovo**: `GET /api/project/export` c'è già (`router.rs:198`);
   - import locale: `PUT /api/project/import` (`import_project_zip`) sostituisce già l'intero
     progetto — dal client `api.importProjectZip(file)`;
   - chiudere/aprire: `api.closeProject()`, `POST /api/projects/:name/open`;
   - **versione e migrazione già fatte**: `project_saved_by`, `api.migrateProject()` →
     `POST /api/project/migrate`, e il testo `header.migrateConfirm` ("salvato dalla versione X,
     il runtime è la Y") del pulsante "⚠ Aggiorna progetto";
   - archivio: `api.exportProjectZip()` per il download, `api.createBackup()` / `/api/backups`
     per la copia lato runtime IDE.

   Flusso voluto, in quest'ordine: **(1)** avviso di versione con `header.migrateConfirm`
   **prima** di toccare qualcosa; **(2)** archivio della versione originale — backup nel runtime
   IDE **e** download del .zip (deciso: entrambi); **(3)** import con **scelta del nome ogni
   volta** (sovrascrivi l'omonimo locale o digitane uno nuovo), poi chiusura del progetto aperto
   e apertura di quello nuovo.
   ⚠️ L'import **sostituisce anche le credenziali** (il bundle le contiene, lo dice già
   `menu.importConfirm`): la conferma deve dirlo esplicitamente.

2. **Ruolo minimo degli oggetti (sezione SICUREZZA): inefficace in modalità no-auth, e l'editor
   non lo dice** — segnalato il 2026-08-24: ruolo minimo **Admin** su un pulsante e su un trend,
   ma nel runtime i due oggetti funzionano comunque.
   **Causa quasi certa, letta nel codice: non è il gating rotto, è il no-auth.** `optional_auth`
   inietta un **Admin sintetico** quando non ci sono utenti definiti (`router.rs:758`), quindi
   il viewer *è* Admin e `isRoleAllowed("Admin","Admin")` è vero (`SvgCanvas.tsx:444`, ranghi
   Viewer 0 → Admin 3). Il gating esiste ed è applicato a **tutti** i tipi dal wrapper
   (`SvgCanvas.tsx:1502`): `hide` rimuove l'oggetto, `disable` (default) lo lascia visibile con
   `pointerEvents: none`.
   Da fare, in quest'ordine: **(a)** *misurare* — `curl -sk .../api/auth/whoami` sul runtime: se
   risponde Admin sintetico l'ipotesi è confermata e non c'è niente da correggere nel gating;
   **(b)** decidere l'avviso nell'editor (senza utenti definiti ogni visitatore è Admin e il
   ruolo minimo non avrà effetto — rimando al tab Utenti), perché così sembra rotto;
   **(c)** dichiarare il limite: `min_role` sugli oggetti è **solo client-side**, un affordance
   dell'interfaccia e non un confine di sicurezza — il controllo vero sulle scritture è
   `TagDef.write_min_role`, verificato dal server (`tag_write_allowed`).

3. **F9c — lotto di parità LVGL. È il lotto più grosso.** `model.rs` / `lvgl_render.rs` /
   `LVGL_SUPPORTED_TYPES` non conoscono nulla di quanto aggiunto nelle fasi F6-F8:
   `trend_tags[]` (quindi **i trend su LVGL sono vuoti**, deciso e accettato), le rifiniture
   F7.6 (raggio/tratteggio/sfumatura, zone e tacche del gauge, forme del led, gap della
   griglia), table/bar/pie/testo di F7.1-F7.4, e i tipi nuovi (`alarm_history`). Verificato
   che intanto **non rompa**: in `model.rs` il tipo oggetto è `Option<String>`, quindi un tipo
   sconosciuto viene ignorato e la pagina regge. **Il motore LVGL non è più stato provato dal
   vivo dopo l'ultimo merge**: questo lotto vuole il TC620 sotto mano (vedi
   `docs/TEST_SETUPS.md`), non è da infilare in coda a un'altra sessione.
   Da fare anche il check di coerenza generato fra `LVGL_SUPPORTED_TYPES` e il badge «L»
   della palette (`LeftPanel.tsx`), oggi disallineabile in silenzio.
4. **F5.3x — XY plot multi-coppia + curva di riferimento**: unico residuo della fase F5.
5. **F7 residui minori** dal debito d'inventario, non ancora affrontati: bordi **per-cella**
   nella griglia (gap e padding sono fatti), e il commento sull'ACK dentro l'`AlarmEvent`
   dello storico invece che nel solo journal di audit (vuole una migrazione dello schema
   eventi — oggi il motivo è nel journal, interrogabile da `/api/audit`).
6. **Q18 aperta** in `docs/OPEN_QUESTIONS.md`: i colori predefiniti dei testi vengono dai
   token di tema dell'app, e su una pagina con sfondo scelto a mano possono dare
   scuro-su-scuro. Non decisa: serve una scelta del maintainer fra le 4 opzioni.
7. **Pagine demo CasaMauro**: sono ferme alle feature F2-F6. Nessun oggetto esercita
   table 2.0, barre negative/impilate, pie raggruppato, testo multiriga, storico allarmi,
   suono. Da arricchire quando servirà una demo.

## Release 2.1.0 — 2026-08-23 (fasi F6, F7, F8 su `main`, verificata dal maintainer)

Sei sessioni consecutive del 2026-08-23, tutte confermate dal maintainer e mergiate su `main`
con due squash (`feat(F6)` e `feat(F7,F8)`); branch `feat/scada-f6` e `feat/scada-f7`
conservati. Dettaglio integrale in `CHANGELOG.md` §2.1.0; qui solo ciò che serve ricordare:

- **F6**: faceplate 2.0 (sostituzione parametri su tutti i campi, parametri tipizzati, popup
  `open_faceplate`, scaling e override per-figlio, trova-usi), simboli a N stati + 13 ISA
  nuovi + editor di simboli multi-stato, animazioni (rotazione, flusso pipe, movimento su
  percorso).
- **Editor coerente**: `trend_tags[]` con migrazione automatica al load (**taglio netto**: i
  campi legacy vengono rimossi al primo salvataggio), fine dei doppioni nel pannello, regola
  **WYSIWYG** ora permanente in `CLAUDE.md`, tab Variabili con sort/filtri/non-usate.
- **F7**: table 2.0, bar chart con valori negativi e barre impilate, pie con raggruppamento e
  explode, testo multiriga, allarmi (ACK massivo, shelve, storico piazzabile, suono per
  severità con tacita, motivo dell'ACK nel journal), rifiniture di forma F7.6.
- **F8**: distribuisci a gap uguali, uniforma dimensioni, snap in resize, copia stile,
  ricerca su tutte le pagine + "dove è usato questo tag", rotazione interattiva e resize su
  oggetti ruotati.
- **Tre comportamenti cambiati di proposito** (da ricordare se qualcosa "sembra rotto"):
  il percorso di movimento guida il **centro** dell'oggetto (`motion_anchor`, default
  cambiato); aprire e salvare una pagina **riscrive i trend** nel formato nuovo; slider e
  tabella hanno un aspetto diverso (slider contenuto nel box, tabella HTML invece di SVG).
- **Verifiche ripetibili** aggiunte in `scripts/`: `check_wysiwyg.sh` (12 tipi selezionabili +
  migrazione trend), `check_f76.sh` (round-trip 13 campi), `check_f7.sh` (32 asserzioni su
  table/bar/pie/testo/storico), `check_f8.sh` (snap in resize + rotazione), `check_ack_reason.sh`
  (motivo dell'ACK nel journal). Tutti si tirano su un runtime scratch dichiarato e lo
  chiudono da soli. **Vogliono il binario debug** (`cargo build -p sws-runtime`): con il solo
  `cargo check` il round-trip misura un mirror vecchio e fallisce per finta.
- **Promemoria permanente**: ogni campo nuovo va specchiato in
  `sws-runtime/crates/sws-web/src/synoptic.rs`, altrimenti viene scartato al salvataggio
  senza errori né log. In questa release ne sono stati aggiunti oltre 40.

**Sessione 2026-08-22 (notte) — SCADA-widgets F5 (grosso fatto)** (catena `feat/scada-f0` →
`f1` → `f2` → `f3` → `f4` → **`feat/scada-f5`** = capo da testare, contiene tutto). Scelta
F5 prima di F9a: la parità LVGL richiede la toolchain di build e il pannello per la verifica —
meglio farla insieme a un giro di test sul TC620.
- **F5.1**: aggregazione a bucket in sws-historian (`aggregate_samples`: min/max/avg/first/
  last/count, media incrementale, 3 unit test) + `GET /api/history/:tag?bucket_ms=N` →
  `Vec<BucketSample>`; il vecchio `limit` tronca-coda resta legacy.
- **F5.2 (core)**: TrendCanvas sopra i 15 min di finestra usa i bucket (~1 per pixel), linea
  sulla media + banda min/max (i domini Y includono la banda); TrendExpanded con selettore
  data/ora assoluto 📅 e bottone ⬇ CSV (endpoint export già esistente).
- **F5.3**: sparkline con seed dallo storico all'apertura pagina (prima restava bianca per
  windowS secondi).
- **F5.5**: widget nuovo `kpi_tile` (web-only): valore grande a soglia, delta % vs periodo
  precedente (2×/api/history/stats, 30s), micro-sparkline, unit/decimali dal tag.
**Seguito nella stessa sessione — F5 completata salvo XY**: F5.2x cursori di misura (toggle ✛,
A/B con letture per traccia e Δt/Δv), scala Y logaritmica (`trend_log_scale`, tick
log-spaziati, zoom Y disattivato in log), unità sull'asse Y dal tag, export ⬇ PNG; F5.4
widget `data_log` (tabella storica paginata client-side fino a 5000 campioni — il server non
ha ancora un offset di paginazione — con refresh, export CSV, qualità a pallino).
**Resta di F5**: solo XY multi-coppia + curva di riferimento + backfill (F5.3x). Build: cargo workspace + 11 test historian + 80 sws-web + 32 vitest + pnpm build
verdi. **Non testato dal maintainer.**

**Sessione 2026-08-22 (sera) — SCADA-widgets F3 e F4 CHIUSE** (catena `feat/scada-f0` → `f1`
→ `f2` → `f3` → **`feat/scada-f4`** = capo da testare, contiene tutto).
- **F3 chiusa** con gli ultimi due pezzi: **F3.3** re-auth per comandi critici
  (`AuthState::verify_user_password` senza sessioni nuove, condivide il lockout del login;
  `POST /api/auth/verify-password`; campi `critical`/`require_reason`; il motivo viaggia in
  `WriteTagBody.reason` e finisce nell'audit; in no-auth salta la password, non il motivo) e
  **F3.4** tastierino numerico touch (`NumericKeypad`, overlay portal, validazione min/max col
  motivo, primo tasto sostituisce il precaricato; pulsante ⌨ sul setpoint → guardedWrite).
- **F4 chiusa**: **F4.1** lampeggio universale (off/fisso/da-tag/su-allarme, rate configurabile,
  `prefers-reduced-motion` lo spegne); **F4.2** `show_alarm_state` — bordo per severità
  lampeggiante finché unacked, con indice tag→allarme memoizzato dagli allarmi live; **F4.3**
  QDot opt-in su tutti i tipi (built-in restano default-on), `bad_value_style: gray`,
  `stale_after_s` con badge ⌛ (tick 1s attivo solo se la pagina dichiara stale).
- Build: cargo workspace, 80 test sws-web, 32 vitest, pnpm build — verdi. **Non testato dal
  maintainer.** Prossime fasi: F9a (parità LVGL lotto 1) oppure F5 (storico 2.0).

**Sessione 2026-08-22 (seguito) — SCADA-widgets F2 completa + F3 quasi completa** (catena
`feat/scada-f0` → `f1` → `f2` → **`feat/scada-f3`** = capo da testare, contiene tutto).
- **F2 CHIUSA**: motore di espressioni client-side (`expr/engine.ts`: tokenizer+Pratt+eval,
  zero eval/dipendenze, 7 test vitest — 32 totali verdi); `BindingSpec` = stringa storica |
  {tag+scaling in/out+clamp} | {expr}; resolveObject applica scala/espressioni (espressione
  rotta → valore statico, mai crash); collectTagIds estrae le dipendenze; BindableInput a tre
  modalità (Tag/Scala/Espressione) con validazione live; mirror Rust: bindings →
  HashMap<String, serde_json::Value> (passthrough).
- **F3 fatta per 5/7**: F3.5 button_mode (write/momentary/toggle/set/reset/incr/decr, momentary
  con rilascio garantito su mouse-leave); F3.6 slider scrive SOLO al rilascio (default NUOVO,
  write_on_release:false = storico) + write_deadband; F3.2 require_confirm+confirm_message
  (localizzabile) via guardedWrite su button/checkbox/radio/setpoint/slider; F3.7 feedback:
  nack WS e errori HTTP → toast col motivo; F3.1 min_role per-oggetto client (hide/disable,
  anonimo<Viewer, sezione SICUREZZA nel pannello) + **enforcement server**
  `TagDef.write_min_role` (mappa in TagDb, 403+audit su REST, nack su WS, select nella riga ⚙).
- **Restano di F3**: F3.3 (re-auth+motivo per comandi critici — serve endpoint verify-password
  e plumbing del reason fino all'audit) e F3.4 (tastierino numerico touch). Q17 nuova in
  OPEN_QUESTIONS (apply_recipe senza utente bypassa write_min_role).
- Build: cargo check --workspace, 80 test sws-web, pnpm build, 32 test vitest — tutti verdi.
  **Non testato dal maintainer.**

**Sessione 2026-08-22 — SCADA-widgets F1 (parziale): tag fonte di verità** (branch
`feat/scada-f1`, annidato su `feat/scada-f0` — il capo da testare è F1). Fatto:
- **F1.1 backend**: 12 campi nuovi su `TagDef` (unit, decimals, raw/eng scaling, range_lo/hi,
  limit_lo_lo/lo/hi/hi_hi); `TagDb::ingest()` con scaling all'ingestione (31 call site plugin
  migrati + echo OPC-UA), `scale_to_raw()` inverso sui 3 percorsi di scrittura (REST/WS/ricette,
  fallback NoWriter resta eng); mappa scaling installata a open/import/PUT-tags, svuotata a
  close. `build_tag_scales()` in projects.rs. Test: 80 sws-web + 21 sws-core verdi.
- **F1.1 frontend**: mirror TS di TagDef + riga espandibile ⚙ nella TagsTab (unità/decimali/
  scaling/range/limiti, icona azzurra se configurato).
- **F1.2**: `applyTagDefaults()` in SvgCanvas subito dopo `resolveObject` — i widget ereditano
  unit/min/max/warn/alarm dal TagDef con override per-oggetto, senza toccare i branch.
**F1.3 completata nella stessa sessione**: formatValue esteso ({value:,.Nf} migliaia,
{value:.Ne}, {value:.N%}), `decimals` per-oggetto ereditato dal tag (pannello di gauge/
setpoint/slider/progress, specchiato in synoptic.rs), messaggi di allarme/nomi pagina/label
serie bar-pie/campi format localizzati. **F1 CHIUSA.** Rinviati come rifiniture future: builder
UI del formato e UX "valore ereditato in grigio" nel pannello (annotati, non bloccanti).
**Non testato dal maintainer, verifica visiva non fatta.** ATTENZIONE deploy: un progetto che usa lo scaling su un runtime vecchio
non scala (i campi sono ignorati) — serve rebuild dei target.

**Sessione 2026-08-21 (notte) — programma SCADA-widgets avviato: piano F0-F9 + fase F0
completa** (branch `feat/scada-f0`, da `main` dopo il merge della Fase B confermata dal
maintainer). Il piano completo — 10 fasi decise con 16 domande di indirizzo — è in
`docs/plans/2026-08-21-scada-widgets.md` (committato). Fase F0 implementata:
- **F0.1**: fix del bug di sottoscrizione trovato in analisi — i tag usati solo da
  binding/stati/serie/celle/faceplate ricevevano lo snapshot e poi si congelavano (la raccolta
  guardava solo `o.tag` + campi legacy inesistenti). Nuova `collectTagIds()` in
  `runtime-view/collectTagIds.ts`, fonte di verità unica, ricorsiva, pronta per le dipendenze
  delle espressioni di F2.
- **F0.2**: sanati 9 punti di configurazione morta (bg_color su 4 tipi, show_value gauge,
  progress_bar verticale, dash della line, bar_y_label, read_only radio, colori label
  navbutton/pipe, «Attuale:» i18n).
`pnpm type-check`/`pnpm build` verdi; nessun campo schema nuovo (niente da specchiare in Rust).
**Non testato dal maintainer; verifica visiva Playwright non ancora fatta** — da fare nel
prossimo giro insieme al suo test. Prossima fase: F1 (tag come fonte di verità) su branch
annidato `feat/scada-f1`.

**Sessione 2026-08-21 (sera) — Fase B: tutte le decisioni OPEN_QUESTIONS implementate**
(branch `feat/fase-b-openquestions`, da `main`). Il maintainer ha confermato i fix MQTT
("funziona tutto") → squash-merge su main (`7f6f933`) + 3 branch eliminati, poi ha deciso le
7 questioni della Fase B via AskUserQuestion: Q9 opzione 1, Q10 opzione 1, Q11 opzione 1
(secondary/accent), Q12 opzione 2 (override neutri), Q3 rimuovi tutto, Q13 rimandata,
Q8 anticipa C. Tutte implementate e registrate in OPEN_QUESTIONS con note d'implementazione:
- **Q3**: `sws-plugin-api` rimosso (crate + 3 path-dependency morte + riga in CONTEXT.md).
- **Q11/Q12**: `secondary`/`accent` in BrandColors+CSS_VARS (oro/azzurro KATODO nel brand
  sws); override neutri per-brand `neutrals_dark`/`neutrals_light` con fallback ai condivisi
  (meccanismo pronto, nessun brand lo usa ancora — lo sfondo grafite sws è un edit di
  brand.json quando il maintainer vorrà).
- **Q10**: `merge_preserved` copriva già patch_project; chiusi i 2 bypass (import bundle ora
  rimerge dal testo grezzo dello ZIP; migrate delega a patch_project no-op).
- **Q8-C**: reload già granulare nel supervisor; aggiunti validate-before-apply sul PUT
  sources (id duplicati/vuoti → 400) e resolve_mqtt_client_ids sul reload post-salvataggio
  (era l'unico percorso senza — client MQTT col client_id base fino alla riapertura).
- **Q9**: inventario di 49 endpoint (subagente, parità TS↔Rust verificata campo per campo):
  deny_unknown_fields su 31 struct solo-API, GitCommitBody tipizzata, DTO PageLayoutBody per
  il caso storico (+test). Esclusi: struct condivise col disco, payload cross-versione,
  WriteTagBody (client esterni lvgl/python/curl).
`cargo check --workspace` + `cargo test sws-web (80) / sws-auth (11)` + `pnpm build` verdi.
**Non testato dal maintainer.** Prossimo: suo giro di prova su `feat/fase-b-openquestions`,
poi squash-merge. Restano: Q13 (aperta, serve il pannello), Q8 E/F (product phase), Backlog C
(13 gap LVGL, solo su richiesta).

**Sessione 2026-08-21 (chiusura) — diagnosi e fix del takeover-loop MQTT, merge di tutto su
main**. Il maintainer ha segnalato un loop "MQTT session ended: connection closed by peer —
retry in 5s" sul runtime locale dopo aver caricato lo stesso progetto su device remoto e
runtime locale, sospettando il generatore dell'ID random. Diagnosi (log JSONL + probe raw
MQTT sul broker): la sequenza di deploy (delete+upload+open) è arrivata **due volte a 1 ms di
distanza** e i due `open_project` concorrenti — nessun lock li serializzava — hanno avviato 4
task MQTT per 2 sorgenti; il secondo `insert` nella mappa del supervisor ha orfanato i primi
due task (drop del CancellationToken NON cancella, drop della JoinHandle DISTACCA il task),
che restavano connessi al broker con gli stessi client id → takeover reciproco infinito.
Quattro fix: `project_switch_lock` in AppState (serializza open/close/delete/upload),
`start_one` difensivo (cancel+abort del task sovrascritto), `stop_one` che abortisce davvero
al timeout (prima "abort/leak" era solo leak), guardia try-lock su `remote_deploy` (409 se un
deploy è già in corso). In più il fix del difetto reale segnalato dal maintainer: instance_id
ora da /dev/urandom (il PID era codice morto, shiftato fuori dalla maschera a 24 bit).
**Confermato funzionante dal maintainer.** Squash-merge su main (`7f6f933`) dell'intera catena
feat/widgets-fase-a → feat/tls-cert-ux → fix/mqtt-ghost-sources; i 3 branch eliminati.
**Fase A chiusa al 100%. Prossimo: Fase B** = decisioni OPEN_QUESTIONS (Q9, Q10, Q11, Q12,
Q13, coda Q3 plugin-api, coda Q8 C/E/F) — richiedono scelte del maintainer, poi implementazione.

**Sessione 2026-08-21 (seguito) — test del maintainer sul Trend: un bug vero + un falso
allarme**, stesso branch `feat/tls-cert-ux`. Il maintainer ha riportato: (1) immagine di sfondo
del Trend invisibile sia in editor sia sul runtime dopo il deploy; (2) "Scala propria" senza
effetto. Verificato dal vivo con un runtime di test costruito da questo branch: **entrambe le
feature funzionano nel runtime attuale** (screenshot: sfondo visibile + colonna scala propria).
Il bug vero era solo l'**anteprima in editor**: il placeholder statico del Trend (niente
polling, drag-friendly) aveva lo sfondo hardcoded e ignorava `bg_color`/`bg_image` — corretto,
ora l'anteprima li mostra (verificato con screenshot dell'editor). Il resto dei sintomi è
spiegato dal **target del deploy**: i runtime installati (nativo 2.0.1 su questo PC, container
2.0.1 sul TC620) sono stati costruiti PRIMA delle feature Trend/immagini di ieri — la loro SPA
non ha né `own_scale` né l'endpoint `/api/project/images` (404 sull'immagine). Serve
ricostruire pacchetto/immagine da questo branch e rifare il deploy per vederle sul device.

**Sessione 2026-08-21 — UX certificati TLS + immagini di progetto con upload** (branch
`feat/tls-cert-ux`, annidato sopra `feat/widgets-fase-a` — un solo capo da testare). Due
richieste dal vivo del maintainer:

1. **UX TLS**: "Cerca runtime" non trovava nulla anche dopo l'import del cert (serviva un
   reload mai suggerito — causa: `catch { setDiscovered([]) }` che collassava il
   `RuntimeUnavailableError` del browser in "lista vuota"), e il pulsante Viewer falliva
   con `CertificateUnknown` nei log (il viewer :8443 è un origin separato da :8444 — va
   accettato a parte). Cinque interventi: (a) discovery con errore distinto + bottoni "Apri
   /health"/"Ricarica"; (b) `certWatcher.ts` (gemello del buildWatcher) armato dall'evento
   `sws:runtime-unreachable` emesso da `RuntimeUnavailableError`, che polla `/health` ogni 3 s
   e mostra un banner verde "ricarica per riconnetterti" appena il runtime torna raggiungibile;
   (c) ViewerLink con azione "Accetta cert ↗" sull'origin del viewer; (d) pagina helper HTTP
   (`CERT_PAGE_TEMPLATE`) che elenca ENTRAMBI gli origin con stato per ciascuno e reindirizza
   solo quando tutti accettati; (e) "Scarica cert" via proxy backend (`GET /api/remote/cert`),
   niente più curl — la fetch dal browser falliva proprio finché il cert non era già accettato.
2. **Immagini di progetto**: `<progetto>/images/` con upload dall'IDE (sezione SFONDO: pulsante
   Carica + tendina delle immagini esistenti), endpoint `GET/POST/DELETE /api/project/images`
   (letture anche sul viewer anonimo — i sinottici devono mostrarle all'operatore; scritture
   Supervisor+; whitelist estensioni per non ospitare contenuti arbitrari su un origin servito
   anonimo, max 5MB), incluse in bundle export/deploy (`build_export_zip` + `read_images_dir`),
   nei backup (`BACKED_UP`) e sovrascritte dal deploy (`DESIGN_ARTIFACTS` — senza, le immagini
   eliminate nell'IDE resterebbero orfane sul device per sempre).

**Verificato dal vivo** (due runtime di test, uno HTTP e uno TLS con entrambe le porte +
http-port): upload→lista→serving su admin E viewer anonimo→export zip con `images/`→rendering
visivo dell'immagine caricata come sfondo di rect e gauge (screenshot Playwright); nomi
traversal/estensioni non-immagine rifiutati (400); proxy cert scarica un PEM vero dal runtime
TLS attraverso il runtime HTTP e spiega chiaramente il caso "il remoto non ha TLS" (502 con
messaggio, non un errore muto); pagina helper con entrambe le porte sostituite e riga viewer
presente. `pnpm type-check`/`pnpm build`/`cargo check` verdi. **Non testato dal maintainer.**
Il percorso certWatcher/banner e il riquadro discovery richiedono il setup reale a due macchine
del maintainer (cert self-signed non accettato): da provare nel suo prossimo giro.

**Sessione 2026-08-20 (sera) — Fase A completa: tutte le 8 migliorie widget/Trend del backlog**
(branch `feat/widgets-fase-a`, da `main` post-housekeeping — l'housekeeping di inizio serata ha
squash-mergiato su main tutto il lavoro precedente e eliminato i 3 branch pendenti, tutti
verificati senza contenuto unico). Il maintainer ha autorizzato l'intera Fase A del piano in
autonomia, su branch unico:
- **A2 soglie**: `trend_show_thresholds` + campi warn/alarm condivisi, linee tratteggiate
  ambra/rosse sulla scala condivisa (pattern del bar chart), sezione soglie nel pannello.
- **A3 legenda cliccabile**: hit-test manuale sui box della legenda (il canvas 2D non ha DOM),
  modalità controllata (modale, via `onLegendToggle`) e non controllata (widget compatto, stato
  interno) — cursore pointer sopra le voci.
- **A6 visibilità persistente**: `trend_series_styles[].hidden` (checkbox "Nascondi"), seme
  dello stato di visibilità in entrambe le viste; il toggle runtime resta effimero sopra.
- **A5 zoom 2D**: il drag-to-zoom ora seleziona anche il range Y **sulla sola scala condivisa**
  (decisione presa in autonomia e documentata: le tracce own_scale mantengono l'autofit — lo
  zoom di un asse per-traccia non ha una risposta univoca). Inversione screen→valore via
  `sharedScaleRef` catturata all'ultimo draw; drag quasi orizzontale = solo tempo, con
  anteprima coerente. Esteso `onRangeSelect(from, to, yLo?, yHi?)` e i due chiamanti.
- **A4 palette unificata**: `color` opzionale su `BarChartSeries`/`PieSlice` con fallback alla
  `PALETTE` del Trend per indice; nuove serie nascono senza colore esplicito; rimossa la lista
  colori duplicata locale del pie nel pannello.
- **A7 marker allarmi**: `trend_show_alarm_markers`, fetch di `GET /api/alarms/history` nel
  ciclo di poll, linee verticali+triangolini per severità, messaggio allarme nel tooltip quando
  il cursore è vicino al marker. Tutti gli allarmi del progetto (il journal non porta il tag).
- **A1 stile universale (6 tipi core)**: `bg_color`/`bg_image` universali + `axis_color`/
  `grid_color` (specchiati in `synoptic.rs`), helper `bgLayer()` in SvgCanvas, sezione "SFONDO"
  a punto di inserimento unico (`BG_TYPES`), etichetta bottone/ago gauge/testi gauge
  configurabili, Trend con sfondo/immagine (cache `Image()` sul canvas 2D)/assi/griglia.
- **A8 estensione**: bgLayer/bg-image su tutti gli altri tipi box (29 in `BG_TYPES`), inclusi i
  rami edit-mode per l'anteprima; esclusi con motivazione line/pipe (tratti puri) e
  alarm_viewer (campo dedicato preesistente); `XyPlotCanvas` esteso con props `bgColor`/
  `bgImage` (era l'unico gap segnalato dal subagente che ha fatto il grosso di A8).
- **Bugfix collaterale trovato**: le etichette dell'asse X del Trend ereditavano il colore
  dell'ultima colonna own-scale (regressione della Fase 2, mai visibile senza scale multiple).

**Verificato dal vivo** con runtime reale + Playwright: (1) **round-trip di persistenza dei 14
nuovi campi** (PUT synoptic → GET → tutti presenti — il test che conta per il mirror Rust);
(2) screenshot con tutto attivo insieme: soglie tratteggiate, marker allarmi con triangolini,
"portata" nascosta da persistenza (grigia in legenda), scala propria di potenza, sfondo/assi/
griglia custom sul Trend, gauge con ago arancio/testi verdi/sfondo navy, etichetta bottone
gialla; (3) click sulla legenda → traccia nascosta e colonna own-scale collassata; (4) tooltip
con "⚠ Temperatura alta zona 1" vicino al marker; (5) drag diagonale → zoom 2D confermato
(tempo 22:52-23:09 e Y condiviso 20-155) con reset comparso; (6) palette automatica sui bar
(blu/verde/ambra senza colori configurati). `pnpm type-check`/`pnpm build`/`cargo check -p
sws-web` verdi. **Non testato dal maintainer** — branch pronto per il suo giro di prova.

**Sessione 2026-08-20 — device reale senza spazio: pulizia manuale + controllo disco +
pulsante prune immagini** (branch `feat/container-deploy-diskspace-and-image-cleanup`, da
`main`). Il maintainer stava provando il deploy container con LVGL su un Pixsys TC620 reale
(`tc620-a-p3-c6-07aff9.local`) e ha incontrato `podman load` fallito con una cascata di errori
di formato immagine — in mezzo, annegato: `no space left on device`. Verificato dal vivo via SSH
(autorizzato esplicitamente dal maintainer per questo device in questa sessione): `/mnt/data` al
**97%** (343MB liberi su 10G), **18 immagini podman accumulate in poche settimane** (~500MB
l'una), di cui **una sola** in uso dal container attivo (`CONTAINERS=1` su tutte le altre = 0).
Pulito a mano (`podman image prune -a -f`): liberati ~6.2GB, da 343MB a 6.5GB disponibili (97%
→ 31%). Poi, con lo storage libero, completato per davvero il deploy dell'immagine LVGL che
era rimasto bloccato — riuscito, container `sws-runtime:2.0.1-arm64-generic` healthy, viewer
raggiungibile su `http://192.168.1.179:8443`.

Due modifiche per non ripetere questa diagnosi manuale la prossima volta:
1. **Controllo spazio disco in `install-container.sh`** prima di `podman load`/`pull`:
   confronta lo spazio libero sulla graph root di podman
   (`podman info --format '{{.Store.GraphRoot}}'`) contro una stima prudente (3× la dimensione
   dell'archivio per `--image`, un minimo fisso di ~1.5GB per `--pull` la cui dimensione non si
   conosce prima di scaricare) — si ferma con un messaggio chiaro invece di lasciare che
   l'errore arrivi da `podman load` sotto forma della cascata fuorviante di prima. **Verificato
   dal vivo due volte** sul device reale: (a) `podman info --format` + `df -Pk` restituiscono
   esattamente il path/numeri attesi sul TC620; (b) il deploy completo dell'immagine LVGL (99MB
   → poi ricompilata a 151MB) con lo storage ora libero è passato senza falsi positivi e ha
   installato con successo fino in fondo.
2. **Pulsante "🧹 Pulisci immagini non usate"** in Config → Runtime → gestione container: nuova
   azione `prune_images` (`podman image prune -a -f`, riusa `run_ssh_cmd`/`run_local_cmd` già
   esistenti, stesso pattern di start/stop/enable/disable/uninstall). **Verificato dal vivo** sul
   device reale (comando eseguito direttamente via SSH prima di cablarlo nel pulsante): rimossa
   l'unica immagine rimasta non in uso (`ghcr.io/.../latest-arm64-generic`), quella attiva
   (`localhost/sws-runtime:2.0.1-arm64-generic`, container "healthy") intoccata.

**Verificato**: `cargo check -p sws-web` verde, 33/33 test `packaging` verdi (incluso il nuovo
`build_manage_cmd_prune_images`), `pnpm type-check` verde, `bash -n` su `install-container.sh`
pulito.

**Sessione 2026-08-20 — deploy nativo da IDE: due bug reali trovati dal vivo** (branch
`fix/deploy-device-native-tarball`, da `main`). Il maintainer stava provando a installare il
runtime nativo su un PC x86 da Configurazione → Runtime e ha incontrato in sequenza:
1. `scp: dest open "/tmp/sws-deploy/...": No such file or directory` — `deploy_device`
   (`packaging.rs`) faceva lo SCP del tarball **prima** che `remote_dir` esistesse sul device: la
   `mkdir -p` era dentro il comando di estrazione successivo, troppo tardi. Un commento già
   presente nel codice (`deploy_device_container`, che invece la crea per prima) segnalava
   esplicitamente questa differenza come un'assunzione ottimistica ("quasi sempre già presente")
   — rivelatasi falsa su un device pulito. Aggiunto lo stesso `mkdir -p` esplicito prima dello
   SCP, stesso ordine del gemello container.
2. Dopo aver creato la cartella a mano, `chmod: impossibile accedere a
   ".../sws-runtime-2.0.0-x86_64-image/install.sh": File o directory non esistente` — causa
   reale diversa: il maintainer aveva selezionato
   `sws-runtime-2.0.0-x86_64-image.tar.gz`, un'**immagine container** (per `podman load`, senza
   alcun `install.sh` — verificato col contenuto vero del tarball, è un archivio OCI a più
   layer), non un pacchetto nativo. `list_packages` (il selettore del deploy nativo) elencava
   ogni `*.tar.gz` in `dist/` senza escludere le immagini, a differenza di
   `list_container_packages` che già le filtra con `parse_image_tarball`. Riusata la stessa
   funzione per escluderle da `list_packages`, più un controllo lato server in `deploy_device`
   come difesa in profondità (nel caso un client con lista in cache o una richiesta a mano
   mandi comunque un'immagine). Il maintainer ha confermato di voler procedere con
   l'installazione nativa — prossimo passo suo: rigenerare un pacchetto nativo fresco da
   Config → Runtime → "Costruisci pacchetto" (non il container) e ridistribuirlo.
3. Con un pacchetto nativo vero (`sws-2.0.1-linux-x86_64.tar.gz`) mkdir e SCP sono andati a
   buon fine (conferma dal vivo dei due fix sopra), ma l'esecuzione di `install.sh` falliva con
   `sudo: Authentication failed` × 2 poi `Maximum 3 incorrect authentication attempts` —
   password corretta. Causa: il comando remoto era un semplice `ssh host "sudo install.sh"`,
   senza terminale su cui `sudo` potesse mostrare un prompt; la password che `sshpass` fornisce
   autentica solo la sessione SSH, non il prompt sudo separato sul lato remoto (stesso account
   Unix, ma un secondo momento di autenticazione). Passato a `sudo -S` (legge la password da
   stdin) e aggiunta `run_ssh_cmd_stdin` (wrapper attorno a `run_ssh_cmd`, un nuovo parametro
   opzionale che pipe-a dati sullo stdin del comando SSH remoto e poi lo chiude per segnalare
   EOF a sudo) — usata solo per questo passo, gli altri 10 punti di chiamata restano su
   `run_ssh_cmd` invariato. Verificato che nessun'altra invocazione remota nel file usa `sudo`
   (il percorso container lo evita deliberatamente, podman rootless).

4. Con `sudo -S` il deploy è arrivato in fondo — `install.sh` ha completato tutti i suoi passi
   (directory, binario, unit systemd, seed di `/etc/sws/runtime.env`, enable+start) e stampato
   "Installation complete" — ma l'health check **finale** di `deploy_device` è comunque fallito
   (`ERROR: ssh fallito (exit 35)`, seguito da un WARN "il servizio potrebbe ancora essere in
   avvio"). Causa reale, confermata leggendo `main.rs`: il TLS è opt-in
   (`args.config.join("tls.crt").exists()`), mai seminato da `install.sh` al primo giro — un
   device fresco parla **HTTP semplice** sulla porta 8443, non HTTPS. `curl -sk https://...`
   contro un server che parla HTTP puro fallisce con un errore SSL (`curl` exit 35, non
   "connection refused") — l'installazione era già completamente riuscita, solo il controllo
   sbagliava protocollo. **Confermato dal vivo dalla sessione stessa**:
   `curl http://192.168.1.169:8443/health` → `ok`. Corretto sia l'health check di
   `deploy_device` sia quello interno di `deploy/generic-linux/install.sh` (prova prima HTTPS
   poi HTTP di fallback, invece di assumerne uno) — quest'ultimo anche negli URL stampati a fine
   installazione, che erano sempre `https://` indipendentemente da cosa il servizio parlasse
   davvero. Applicato lo stesso fallback anche a `deploy_device_container` (aveva
   l'assunzione opposta: solo HTTP, niente HTTPS per un device con TLS già attivo da un giro
   precedente — `config/` persiste tra un deploy e l'altro).

**Verificato**: `cargo check -p sws-web` verde, 32/32 test `packaging` verdi (incluso
`parse_image_tarball_*`, riusata senza modifiche) dopo ciascuno dei quattro fix. Nessun
round-trip SSH/sudo live per il fix `sudo -S` (nessun target passwordless disponibile per un
test end-to-end senza toccare la config SSH/sudo dell'host) — verifica per lettura del codice: i
fix 1/2 ricalcano il pattern già in produzione in `deploy_device_container`, il fix 3
(`sudo -S` + stdin) è un pattern standard per automatizzare sudo non interattivo, il fix 4 è
stato confermato dal vivo (curl diretto all'health endpoint del device reale del maintainer).
**Il deploy nativo del maintainer è di fatto già riuscito e il runtime gira su
192.168.1.169** — resta solo da confermare che il prossimo giro di deploy (con il binario
ricompilato) non stampi più il falso WARN.

**Pulizia collaterale**: rimossi da `dist/` i binari precedenti alla nomenclatura 2.0.0 su
richiesta del maintainer — `sws-0.1.0-dev-linux-x86_64.tar.gz`,
`sws-runtime-0.1.0-dev-x86_64-image.tar.gz` e i quattro archivi `2026.7.0` (CalVer, pre-SemVer):
~412 MB liberati. Restano solo 2.0.0/2.0.1.

**Sessione 2026-08-20 — bigtask grafici/Trend, Fase 2: scale Y indipendenti per traccia**,
stesso branch `feat/trend-datetime-format` (il maintainer ha confermato dal vivo che la Fase 1,
data/ora configurabile, funziona correttamente — "il grafico ora mostra l'ora con la data
corretta"). Decisione già presa in fase di piano: non due assi sx/dx, ma una scala dedicata per
ciascuna traccia che la richiede. Nuovo campo `own_scale` su `TrendSeriesStyle`
(`types/index.ts`) e checkbox "Scala propria" per traccia in `trendStyleRow`
(`EditorShell.tsx`). In `TrendCanvas.tsx`: il calcolo del dominio Y è diviso in un range
condiviso (serie senza `own_scale`, comportamento invariato) e un range indipendente per
ciascuna serie con `own_scale` (autofit sui propri soli campioni — nessun override `y_min`/
`y_max` per-traccia in questa fase); `yAtFor(idx)` sceglie il mapping giusto per ogni traccia
disegnata. Layout: `PAD_LEFT` diventa dinamico (`6 + 40px × numero di tracce a scala propria`,
tracce nascoste non contano), ciascuna con la propria colonna di etichette colorate come la
traccia agli stessi 5 livelli di tick dell'asse condiviso (stessa posizione Y, valori diversi);
l'asse condiviso a destra si nasconde da solo se nessuna traccia lo usa più. `own_scale` viaggia
dentro il `Value` libero di `trend_series_styles` in `synoptic.rs` — nessuna modifica al mirror
Rust necessaria (già JSON passthrough).

**Verificato dal vivo con screenshot Playwright, prima/dopo**: progetto di test con
"tensione" (~228, scala condivisa) e "potenza" (0-12, `own_scale: true`) sullo stesso Trend.
Senza scala propria: potenza completamente schiacciata contro l'asse condiviso (zigzag piatto
vicino allo zero, quasi invisibile) — riproduce esattamente il problema originale. Con scala
propria: potenza usa tutta l'altezza del grafico con la propria colonna di etichette (0 →
11.40) a sinistra, tensione resta sul suo asse condiviso a destra. `pnpm type-check` verde
(nessuna modifica Rust in questa fase, `cargo check` non necessario). Aggiornata la nota LVGL in
`docs/OPEN_QUESTIONS.md` (stesso gap, ora confermato: solo asse Y nativo, mai il secondario di
`lv_chart`). **Piano completo** (Fase 1 + Fase 2 fatte): resta la Fase 3 (stile universale
sfondo/colori per un sottoinsieme di widget), da decidere se e quando affrontarla.

**Sessione 2026-08-20 — bigtask grafici/Trend, Fase 1: formato data/ora configurabile su due
righe** (branch `feat/trend-datetime-format`, da `main`). Prima di tre richieste trattate come
piano a fasi (vedi `docs/plans/` — analisi completa fatta in plan mode, con ricerca su rendering
Trend, modello di stile degli oggetti, e widget correlati). L'asse X del Trend mostrava già la
data oltre le 24h (sessione 2026-08-18) ma con formato hardcoded `MM-DD HH:MM`, ordine mese-
giorno non configurabile. Riscritta `fmtTime()` → `fmtDateTimeParts()` in `TrendCanvas.tsx`:
7 nuovi campi (`trend_dt_*`) coprono ordine data (gg/mm, mm/gg, aaaa/mm/gg — quest'ultimo
degrada a mm/gg se l'anno non è richiesto), separatore, 24h/12h con AM/PM, secondi, anno, due
righe (data sopra/ora sotto — il canvas 2D non supporta multi-riga nativo, disegnate con due
`fillText` con offset verticale, che impatta anche l'altezza riservata sotto il grafico e nel
box del tooltip), e forzatura a mostrare sempre la data. Specchiati in `synoptic.rs` (stesso
pattern di `line_color`). Propagati attraverso `SvgCanvas.tsx` → `TrendCanvas`/`TrendExpanded`
(2 punti di invocazione). Aggiunta sezione "FORMATO DATA/ORA" nel pannello proprietà
(`EditorShell.tsx`, vicino a "Finestra"). **Verificato dal vivo con screenshot Playwright** (non
solo type-check): progetto di test con due tag, storico seminato direttamente in
`historian.db` su uno span di ~30h — confermato visivamente il doppio ordine (dmy → "19/08",
mdy → "08/19"), le due righe impilate, il 12h con AM/PM e i secondi attivabili, tutti sulla
stessa configurazione condivisa fra asse e tooltip (prima i secondi erano hardcoded assenti
sull'asse e sempre presenti nel tooltip — ora un'unica impostazione per entrambi, coerente con
la richiesta di controllo completo). `pnpm type-check`/`cargo check -p sws-web` verdi. Aggiunta
una nota in `docs/OPEN_QUESTIONS.md` sul gap LVGL (asse X nativo puramente numerico, nessuna
etichetta testuale — non un porting mancato, andrebbe costruito da zero). **Prossima fase**:
scale Y indipendenti per traccia (decisione già presa: una scala dedicata per traccia, non due
assi sx/dx).

**Sessione 2026-08-19 (continua) — cartelle nascoste del progetto diventano visibili + migrazione
automatica**, stesso branch `feat/T-status-remote-gitops-ide-prefs`. `.history/` (storico
SQLite), `.bak/` (backup) e `.opcua-pki/` (trust store OPC UA) diventano `history/`, `backups/`,
`opcua-pki/` — letterali sostituiti in `sws-core/project.rs` (default path SQLite),
`sws-web/{projects,backups,router}.rs`, `main.rs`, più i testi UI corrispondenti in
`ConfigView.tsx` e due script di verifica (`check_database_mgmt.sh`,
`check_deploy_preserve.sh`) che li creavano a mano. `.git/` esplicitamente escluso — non è
nostro da rinominare. Nuova `migrate_legacy_project_dirs()` in `projects.rs`: rinomina le
cartelle vecchie solo se la nuova non esiste già (mai sovrascrive), e se `project.yaml` ha il
path SQLite di default esplicito (`.history/historian.db`) lo riscrive al volo — qualunque path
personalizzato resta intoccato. Agganciata nei due (e soli due) punti che risolvono i path
storico/PKI per un progetto: l'auto-apertura al boot in `main.rs` e `open_project` in
`projects.rs` — un audit di `soft_reload_project` (usato dal deploy GitOps) ha confermato che
quel percorso non tocca mai datastore/PKI, quindi non serve la migrazione anche lì. 5 nuovi test
(rinomina, idempotenza, mai-sovrascrivere, riscrittura path di default, path personalizzato
intoccato) verdi, più i 78 test esistenti di `sws-web`/`sws-core`/`sws-runtime` (nessuna
regressione). **Verificato dal vivo** con un runtime reale: creato un progetto con layout
"legacy" a mano (`.history/historian.db` con contenuto riconoscibile, `.bak/`, `.opcua-pki/`,
`project.yaml` con path esplicito vecchio) e riaperto — le tre cartelle sono migrate, il
contenuto del database è sopravvissuto intatto, il path in `project.yaml` è stato riscritto a
`history/historian.db`. (Nota di processo: la prima verifica dal vivo ha richiesto un
`cargo build -p sws-runtime` per rigenerare il binario — `cargo check`/`cargo test` non
aggiornano il binario `target/debug/sws-runtime` effettivo.)

**Sessione 2026-08-19 (continua) — pulsante "Rinomina progetto…" nel menù ☰**, stesso branch
`feat/T-status-remote-gitops-ide-prefs`. Richiesto subito dopo "Salva tutto". L'endpoint
`POST /api/projects/:name/rename` esisteva già (usato dalla WelcomeScreen per rinominare un
progetto chiuso), ma non era raggiungibile da dentro l'editor con un progetto aperto — aggiunta
la voce nel menù (gate Supervisor/Admin, come "Riavvia"), un semplice `window.prompt` per il
nuovo nome (stesso pattern già in uso per il codice lingua in ConfigView), che aggiorna lo store
locale (`project.meta.name`) dopo la conferma dal server. **Bug trovato per strada**:
`rename_project` per un progetto root-scoped (il caso comune) rinominava la cartella e il
registro ma non `meta.name` dentro `project.yaml` — solo il ramo "esterno" lo faceva. Senza il
fix, un progetto rinominato mentre aperto avrebbe continuato a mostrare il vecchio nome in
testata (che legge `meta.name`) finché non richiuso e riaperto — corretto patchando
`meta.name` anche nel ramo root-scoped. Verificato: `cargo check -p sws-web` verde, `pnpm
type-check` verde (dopo un `pnpm install` — `node_modules` era stato svuotato dallo script di
pulizia disco della sessione precedente). **Non ancora verificato dal vivo** (rinomina di un
progetto realmente aperto, controllo che la testata si aggiorni) — il maintainer si occupa lui
della compilazione in questa fase.

**Sessione 2026-08-19 (continua) — fix reale: GitOps operava sul repo di SWS, non su quello del
progetto** (branch `feat/T-status-remote-gitops-ide-prefs`). La sessione precedente aveva concluso
"buona notizia, GitOps opera già solo sul progetto" — falso, per un motivo mai emerso prima: il
maintainer ha ricompilato e testato dal vivo su "Sandokan" (progetto sotto
`.run-editor/projects/`, che vive dentro il checkout sorgente di SWS in questo setup di sviluppo),
vedendo branch/commit/tag del **codice di SWS**. Causa: `GitDeploy::is_git_repo()` controllava
solo `git rev-parse --git-dir`, che ha successo per qualunque cartella annidata dentro un
repository qualsiasi (git risale i genitori) — verificato dal vivo:
`git -C .run-editor/projects/Sandokan rev-parse --show-toplevel` → `/home/max_xxv/sws`. Le
verifiche precedenti di questa stessa feature avevano sempre usato progetti in `/tmp/...`, fuori
dall'albero SWS, dove il bug non può manifestarsi — da qui il falso "tutto ok". Fix:
`is_git_repo()` ora richiede che la cartella del progetto **sia essa stessa** la radice del
repository (confronto canonicalizzato con `--show-toplevel`), non solo che vi si trovi annidata.
Punto di fix unico e sufficiente (ogni handler GitOps in `router.rs` già chiama
`gd.is_git_repo()` come primo controllo). Aggiunti 3 test (repo/sottocartella-dello-stesso-
repo/fuori-da-ogni-repo — il secondo riproduce in miniatura esattamente il bug di Sandokan),
verde con `cargo test -p sws-web git_deploy` (3/3). Rinominata anche l'etichetta "GITOPS" →
"VERSIONAMENTO PROGETTO" (solo il testo visivo, nessun cambio di API/nomi interni). **Non ancora
verificato dal vivo su Sandokan**: richiede un rebuild di binario+frontend e riavvio dell'istanza
`.run-editor` in corso — il maintainer si occupa lui della compilazione in questa fase, verifica
rimandata al prossimo suo rebuild.

**Sessione 2026-08-18 (continua) — Configurazione → Stato: dati remoti, Preferenze IDE, GitOps
riprogettata** (branch `feat/T-status-remote-gitops-ide-prefs`). Tre richieste sulla tab "Stato":
1. **RUNTIME/SISTEMA relativi al device connesso**: stesso gap remoto già risolto per Datastore/
   Backup — `SystemTab` leggeva sempre `GET /api/system` locale, mai `remoteConnected`. A
   differenza di Datastore/Backup, qui "il runtime" è un concetto singolare: quando connesso, i
   dati **sostituiscono** quelli locali (nuovo proxy `GET /api/remote/system`, stesso pattern di
   `remote_list_backups`), non li affiancano — decisione confermata col maintainer prima di
   implementare. Bonus trovato durante l'audit: `historian_samples` era hardcoded a 0 in
   `system.rs`, mai calcolato — ora somma davvero `sample_count` da `registry.all_stats()`.
2. **ASPETTO → nuova tab "Preferenze IDE"**: audit di tutte le impostazioni in `localStorage`
   nell'editor (una quindicina censite) per capire cos'altro fosse IDE-locale da spostare —
   solo tema e lingua interfaccia (mai esposta in Configurazione, prima solo nel menu utente 👤)
   avevano senso lì; le altre (URL runtime override, layout pannelli, righelli canvas...) restano
   dove sono per ragioni specifiche documentate nel piano. Nuova tab dedicata (confermato col
   maintainer, non una sotto-sezione di "Stato").
3. **GitOps**: buona notizia dall'audit — operava già solo sulla cartella del progetto, mai sul
   codice di SWS (il timore del maintainer era un problema di percezione — la sezione vive dentro
   "Stato", la stessa tab che mostra versione/uptime del *software* — non un difetto reale).
   Mancava però un modo di **agganciare** un progetto nuovo a un repository
   (`GitDeploy::init_remote` esisteva già ma era codice morto, mai collegato) e la **gestione tag**
   (assente sia lato backend sia UI). Aggiunti `POST /api/project/git/init` (init idempotente +
   origin opzionale) e route complete per i tag (lista/crea/push/elimina), più un testo esplicito
   nella UI per chiarire lo scope.

Verificato end-to-end con un runtime reale a ogni passo: route GitOps (init→commit→tag→delete),
nessun panic all'avvio per le nuove route (`/api/project/git/tags` GET+POST split fra due
sotto-router con permessi diversi — verificato dal vivo, non solo a compilazione, perché axum
potrebbe rifiutare un merge con path duplicati), `historian_samples` reale su un progetto con
storico popolato. `cargo check --workspace`/`pnpm build` verdi, 70/70 test verdi. **Non ancora
verificato il percorso remoto (RUNTIME/SISTEMA) con un device reale connesso.**

**Sessione 2026-08-18 (continua) — Backup: due sezioni simmetriche + operazioni complete anche da
remoto**, stesso branch. Il maintainer ha chiesto perché ci fosse una sola sezione "locale" con
tabella grande e una sezione remota più piccola/annidata sotto, con solo elenco+download — dopo
la spiegazione (locale = progetto in editing/design, remoto = stato live realmente in esecuzione
sul device, dati diversi e non intercambiabili — il deploy infatti esclude sempre `.history/` dal
device proprio per questo) ha chiesto due riquadri **identici** per stile/azioni. Aggiunti 3
nuovi proxy in `remote.rs` (`remote_create_backup`, `remote_restore_backup`,
`remote_delete_backup`, stesso stile di `remote_download_backup` già presente — server-side
`reqwest` verso `{target.url}/api/backups...`, mai il browser diretto sul device, audit-logged
per create/restore/delete). Estratto un componente React condiviso `BackupSection`
(`ConfigView.tsx`) usato due volte — locale e remoto sono ora due riquadri di pari livello,
stesse 5 azioni (Backup adesso/Aggiorna/Ripristina/Scarica/Elimina) per entrambi, la logica dei
confirm resta nel chiamante (testo remoto specifica "sul dispositivo remoto connesso" e chiarisce
che non tocca il progetto locale). Verificato: route registrate correttamente (400 "Nessun
runtime remoto connesso" quando non connesso, come atteso), `cargo check --workspace`/`pnpm
build` verdi. **Non ancora verificato il percorso remoto con un device reale connesso.**

**Sessione 2026-08-18 (continua) — intervallo auto-backup per-progetto + download backup (Config
→ Backup)**, stesso branch `fix/trend-all-range-and-date`. Il maintainer, guardando la tab
Backup, ha notato che `--auto-backup-interval-minutes` era solo un flag di avvio (uguale per ogni
progetto, richiede un riavvio per cambiare) e ha chiesto di controllarlo a livello di progetto,
più un bottone per scaricare i backup del device remoto connesso. Aggiunti
`Project::auto_backup_interval_minutes`/`auto_backup_retention` (override in `project.yaml`,
`None` = eredita il default di processo) e riscritto il loop di auto-backup in `main.rs`: prima
era un `tokio::time::interval` fissato una volta all'avvio (e saltato del tutto se il flag era 0);
ora tiene un tick fisso da 1 minuto e rilegge il progetto attivo a ogni scatto (tracciando
"ultimo scatto" per-progetto così cambiare progetto non fa scattare subito un backup basato sul
tempo trascorso del progetto precedente) — un cambio di intervallo o un cambio progetto ha
effetto entro un minuto, nessun riavvio. Aggiunto anche **Scarica** per ogni singolo backup
(nuovo `zip_directory`/`add_dir_to_zip` in `backups.rs`, zip generico che copia i byte così come
sono — serve perché `.history/historian.db` è binario, non YAML da riserializzare come fa già
`build_export_zip` altrove), sia locale (`GET /api/backups/:name/download`) sia — quando connesso
— per il dispositivo remoto (`GET /api/remote/backups`+`/:name/download`, stesso pattern proxy di
`remote_push_users`/del database), con una sezione dedicata nella UI che elenca i backup del
device connesso. Verificato end-to-end con un runtime reale: lettura/scrittura di
`backup-config`, download di uno zip con contenuto corretto (incluso `.history/` con sidecar
WAL/SHM). `cargo check --workspace`/`pnpm build` verdi, nuovo test `sws-web`
(`zip_directory_preserves_files_and_binary_content`) verde, 5/5 test `backups` verdi in totale.
**Non ancora verificato il percorso remoto con un device reale.**

**Sessione 2026-08-18 (continua) — download/upload del database (Config → Datastore → GESTIONE
DATABASE)**, stesso branch `fix/trend-all-range-and-date` su richiesta esplicita del maintainer
(per testare tutto insieme). Partito dall'audit richiesto — "GESTIONE DATABASE" aveva già
test/stats/purge/export-CSV/tag-orfani/vacuum, tutti funzionanti, ma **nessuno con un concetto di
dispositivo remoto connesso**: agiscono tutti su `getBaseUrl()`, cioè sempre e solo il backend a
cui l'editor è attaccato (verificato con tre agenti Explore in parallelo: audit frontend, audit
endpoint backend, audit dei due meccanismi remoti esistenti — SSH per lifecycle
container/comandi, proxy HTTP via `AppState.remote_target` per azioni "sul device connesso" tipo
Deploy/push-utenti). Confermato anche che né SSH né il proxy toccano oggi `historian.db`
(deliberatamente escluso dal bundle di deploy). Decisioni prese col maintainer: costruire
Download/Upload sia per il progetto locale sia per il device remoto (stesso binario `sws-web`,
costo aggiuntivo minimo), e per l'upload **niente hot-swap in-process** — si sostituisce il file
su disco con backup automatico del precedente, ma serve un riavvio del runtime perché il nuovo
database venga davvero usato (una `Connection` SQLite già aperta continua a scrivere sul vecchio
file anche dopo la sostituzione).

Implementato: `SqliteStore::vacuum_into` (copia consistente via `VACUUM INTO`, non un `fs::copy` a
caldo) e `SqliteStore::replace_file_at` (sostituzione con backup timestampato + pulizia sidecar
`-wal`/`-shm` obsoleti) in `sws-historian`; `DatastoreRegistry`/`DatastoreBackend` estesi con
`backend_db_path`/`download_backend`/`replace_backend_file`; due nuove route admin-gated
`GET|POST /api/datastores/:id/download|upload` in `sws-web`; due nuovi proxy
`GET|POST /api/remote/database/:id/download|upload` in `remote.rs` (stesso stile di
`remote_push_users`, audit-logged); lato editor due nuovi bottoni "Scarica database"/"Carica
database" nel box GESTIONE DATABASE, raddoppiati per il device remoto quando `remoteConnected`.
Verificato end-to-end con `scripts/check_database_mgmt.sh` (esteso con due nuovi passi): download
produce una copia con lo stesso conteggio campioni del file live, upload risponde con
`requires_restart: true` e crea davvero il backup su disco. `cargo check --workspace`/`pnpm
build` verdi, 8/8 test `sws-historian` verdi. **Non ancora verificato il percorso remoto con un
device reale** (serve un runtime connesso via "Cerca runtime" per provarlo davvero) — segnalati
anche 5 difetti minori trovati durante l'audit (mancante `require_admin` su
`tags`/`delete-tag`/`vacuum`, `purge` senza audit-log, commento stale, cast `as any` ridondanti,
copy fuorviante su "Pulisci ora"), non toccati in questo giro.

**Sessione 2026-08-18 (continua) — bug trend "Tutto" < "24h" + data mancante** (branch
`fix/trend-all-range-and-date`). Il maintainer, rientrato dalle ferie col runtime lasciato attivo
su `tc620-a-p3-c6-07aff9.local`, segnala che il preset "Tutto" del trend mostra meno dati di
"24h" e che assi/tooltip non mostrano mai la data. Due agenti Explore in parallelo (frontend +
backend) hanno isolato la causa: **non è perdita/pruning di dati** (lo storico è intatto in
SQLite) — `Historian::query()` (`sws-historian/src/lib.rs`) consultava SQLite solo con un `from`
esplicito più vecchio del ring RAM (5.000 campioni/tag, si "gira" dopo giorni di uptime); con
`from: None` (la query "senza limiti" che "Tutto" usa per trovare il vero campione più vecchio via
`/api/history/:tag/stats`) restituiva solo il ring RAM — "Tutto" finiva per auto-selezionare un
`fromMs` già dentro la finestra RAM, mentre "24h" (calcolato lato client, indipendente da quella
query) mostrava correttamente di più. Fix: `from: None` ora trattato come "nessun limite
inferiore" — raggiunge comunque SQLite. Bonus: questo stesso fix corregge automaticamente anche
`tag_history_stats` (nessuna riscrittura separata servita, come inizialmente pianificato — passa
già per la stessa `query()`). Aggiunto test (`unbounded_query_reaches_sqlite_past_the_ring`) che
riproduce un ring che ha già "girato" e verifica che una query senza bound raggiunga comunque
SQLite. Corretto anche un doc-comment stale su `DatastoreConfig::retention_days` che parlava di
uno "sweep notturno" di pruning mai esistito nel codice (pruning è solo manuale, via
`POST /api/datastores/:id/purge`). Lato frontend: `TrendCanvas.tsx`'s `fmtTime` ora include la
data (`MM-DD`) quando lo span visualizzato supera le 24h, invariato sotto quella soglia.
`cargo check --workspace`/`pnpm build` verdi, test storico verdi (7/7). **Non ancora verificato
dal maintainer sul caso originale** (`state.voltage` su `tc620-a-p3-c6-07aff9.local`).

**Sessione 2026-08-18 — richiesta annotata: download/upload database device (Gestione)**. Il
maintainer, rientrato da una settimana di ferie, chiede per il pannello "Gestione" (Config →
Runtime → device connesso) la possibilità di scaricare/caricare il database del dispositivo
connesso, per archiviarlo. **Non ancora indagata**: quale database (storico SQLite? allarmi?
entrambi?), dove vive sul device, se via SSH (come il resto del pannello Gestione, che usa già
`deviceHost`) o una nuova route HTTP dedicata. Da affrontare con un piano a parte quando si
riprende.

**Sessione 2026-08-13 (continua) — pulizia branch LVGL, merge `feature/lvgl-widgets-3`**. Il
maintainer ha segnalato confusione su quali branch fossero mergiati o no; verifica sistematica
sul contenuto (non sugli hash) di tutti i 16 branch della famiglia `feature/lvgl-*`:
- **15 superati, eliminati** (`feature/lvgl`, `-2-render-engine`, `-2b-display-fix`,
  `-3-project-wizard`, `-live-updates`, `-more-widgets`, `-input-device`, `-widgets-2`,
  `-multipage-1280x800`, `-badge-compat`, `-checkbox-values`, `-trend`, `-alarm-viewer`,
  `-symbol-analysis`, `-pixsys-deploy`): un confronto riga-per-riga naive dava >60% "mancante" in
  ognuno — falso allarme, perché ogni fase è stata **reimplementata a mano su `main`** invece di
  squash-mergiata letteralmente (verificato con un caso diretto: lo stub "Fase 1" di
  `feature/lvgl` è sostituito, non estenso, dalla vera Fase 2 su `main`). Il segnale affidabile è
  stato il match 1:1 fra titolo del branch e commit equivalente su `main`.
- **`feature/lvgl-widgets-3` — lavoro reale, mergiato**: branchato pulito da `main` (subito dopo
  la 2.0.0), 3 commit che portano la copertura widget da 16 a 31/32 tipi. `cargo check`/`pnpm
  build` verdi su entrambi i lati prima del merge; il maintainer ha scelto di fidarsi della build
  verde e procedere subito, verifica funzionale rimandata. Squash-merge con 4 conflitti risolti a
  mano (`CHANGELOG.md`/`STATUS.md`/`docs/OPEN_QUESTIONS.md`/template `LVGL Demo.yaml` — tutti
  divergenze narrative fra le due storie, nessuna logica in conflitto reale).

Più, prima di questo, pulizia di altri 10 branch non-LVGL con lo stesso metodo (6 già del tutto
in `main`, 2 superati da lavoro successivo, 2 confermati pendenti e ora mergiati — vedi sotto).
**Totale 26 branch eliminati in questa sessione.** Restano da testare dal vivo i widget aggiunti
da `widgets-3` (mai provati fuori da un'istanza isolata) — vedi [[project_lvgl_engine]].

**Sessione 2026-08-13 (continua) — blocco di lavoro autonomo, 5 task dal backlog**. Il maintainer
si è allontanato per un paio d'ore chiedendo di identificare e affrontare task corposi dal
backlog, da rivedere insieme al ritorno. Un agente ha prima analizzato `docs/CONTEXT.md`,
`docs/OPEN_QUESTIONS.md`, `STATUS.md` e i TODO nel codice per proporre candidati sicuri (nessuna
domanda architetturale da risolvere, niente SSH/sudo/push). Esito dei 5 scelti — **due si sono
rivelati già fatti in commit successivi ai documenti che li segnalavano** (verificato con
`git blame` prima di toccare codice, non dato per scontato dal backlog):
- **T-49 + `sws-kiosk` + pulizia** (branch `fix/mdns-interfaces-kiosk-viewerport`, **mergiato
  2026-08-13**): `announce_mdns()` annunciava un indirizzo per ogni interfaccia locale, comprese le
  veth link-local di container — ora annuncia solo `detect_lan_ip()` (già esistente). `sws-kiosk`
  ignorava `--viewer-port` (la variabile `vport` era lì, semplicemente non usata al punto giusto).
  Rimosso anche un TODO morto (ADR 0001 Redux, chiuso da tempo). Verificato inoltre che il
  "duplicate entries" in `/api/discover` segnalato in STATUS.md fosse già risolto dalla dedup per
  `fullname` esistente in `discover.rs` — nota superata, nessun cambio necessario lì.
- **Faceplate piazzabile dall'editor**: **già fatto** (commit `6796891`, 2026-08-07) — palette,
  dropdown di scelta e editor parametri esistono e funzionano. Nessun lavoro.
- **Widget `image` in LVGL**: l'ipotesi iniziale ("caso semplice, URL raster + `lv_img` nativo")
  non ha retto alla verifica — il catalogo icone bundlato nell'editor è tutto SVG (stesso
  problema di `symbol`/Q15), e `lv_conf.h` di progetto ha `LV_USE_PNG`/`SJPG`/`GIF` tutti a 0
  (nessun decoder raster compilato). Documentato come nuova voce **Q16** in
  `docs/OPEN_QUESTIONS.md` invece di implementare qualcosa di rischioso/incompleto senza
  supervisione — commit diretto su `main` (meta commit, solo documentazione).
- **Color picker slider/checkbox/radio + bindable su `pipe`**: il color picker era **già fatto**
  (commit `30eb7451`, 2026-08-07, un giorno dopo l'audit che lo segnalava mancante) e quasi tutto
  il binding di `pipe` pure — restavano solo i tre `state_*_color`, senza `BindableInput` a
  differenza degli stessi campi in `symbol`. Sistemato quel gap puntuale (branch
  `fix/pipe-state-color-bindable`, **mergiato 2026-08-13**).
- **Q14 — consolidamento narrazione hardware reale**: aggiunto un "seguito 12" strutturato che
  raccoglie la saga di bring-up su `tc620-a-p3-c6-07aff9.local` (SIGSEGV Wayland upstream di SDL2,
  tentativi Surface/XWayland/Mesa, scoperta di kmsdrm, schermo nero isolato a un bug del driver
  kernel Rockchip sull'API DRM atomica, backend `--backend drm` su API legacy come soluzione,
  touch reale, primi fix visivi gauge/slider) — prima viveva solo sparsa fra `STATUS.md` e i
  commit, mai scritta come continuazione di Q14. Nessun fatto nuovo, solo consolidamento. Commit
  diretto su `main`.

`cargo check --workspace`/`pnpm build` verdi su tutti i branch con codice. Entrambi i branch
squash-mergiati in `main` il 2026-08-13 dopo revisione del maintainer (vedi sessione di pulizia
branch più sotto); le due voci Q16/seguito 12 erano già su `main` (pure documentazione, nessun
rischio).

**Sessione 2026-08-13 (continua) — pulizia branch aperti**. Il maintainer ha segnalato confusione
su quali branch fossero davvero mergiati o no; verifica sistematica **sul contenuto** (diff dei
file toccati contro l'attuale `main`, non sugli hash — con lo squash-merge quelli sono sempre
diversi anche a lavoro incorporato) di tutti i branch non-LVGL:
- **Già completamente in `main`, eliminati**: `feat/alarm-banner-list-t46`,
  `feat/container-variant-picker`, `feat/faceplate-preview-and-deploy-sync`,
  `feat/mdns-hostname-ssh`, `fix/project-changed-false-positive`, `fix/runtime-tab-status-sync`.
- **Superati da lavoro successivo, eliminati**: `fix/deploy-btn-log-remoti-alarm-panel` (l'unica
  riga residua, `setTargetUrl(r.admin_url)`, è stata sostituita dalla logica hostname-based di
  `mdns-hostname-ssh`); `fix/remote-logs-mqtt-clientid` (il fix backend è in `main`, il pannello
  "Log Remoti" che modificava è stato rimpiazzato dal nuovo hook `remoteLogStream.ts`).
- **Confermati non mergiati, ora squash-mergiati**: `fix/mdns-interfaces-kiosk-viewerport` e
  `fix/pipe-state-color-bindable` (vedi voci sopra) — verificati leggendo il codice attuale
  (`enable_addr_auto()` ancora senza fallback, `pipe` ancora senza `BindableInput` sui
  `state_*_color`), non solo il diff.

10 branch eliminati in totale. Restano da valutare i ~14 branch della famiglia `feature/lvgl-*`
(incatenati l'uno sull'altro, verifica più lunga) — non ancora affrontati in questa sessione.

**Sessione 2026-08-13 (continua) — anteprima live Faceplates + deploy non sincronizzava
faceplates/recipes**. Due richieste sul pannello Config → Faceplates:
- **Anteprima live**: nuova terza colonna nel pannello che mostra il faceplate mentre lo si
  modifica, senza salvare — riusa il rendering già esistente di un `faceplate` piazzato
  (`SvgObject`/sostituzione `{param}`, ora esportati da `SvgCanvas.tsx`), nessun nuovo stato
  (legge `current.objects`/`current.params`, già "vivi" prima del salvataggio).
- **Bug reale trovato**: modificare un faceplate (il maintainer stava provando "Tank Level", uno
  dei tre built-in) e fare Deploy verso un runtime remoto non portava l'aggiornamento sul device —
  il bundle di deploy (`build_project_zip`/`build_export_zip`, `router.rs`) elencava a mano solo
  `project.yaml`+`synoptics/*.yaml`+`users.yaml`, mai esteso per `faceplates/`/`recipes/` (stesso
  identico gap in entrambe le cartelle). Corretto in export e import, stesso pattern replace-mode
  già usato per synoptics. **Confermato funzionante dal maintainer, mergiato su `main`.**

**Sessione 2026-08-13 (continua) — hostname mDNS al posto dell'IP per "Host SSH" e "URL del
runtime target"**. Il runtime annuncia già un hostname `.local` via mDNS (distinto dall'IP,
stabile nel tempo), ma `discover.rs` non lo esponeva — "Cerca runtime" mostrava il nome grezzo del
servizio e compilava "Host SSH" con l'IP. Aggiunto campo `hostname` in `DiscoveredRuntime`
(backend + tipo frontend), usato per la label della lista e per l'autofill di "Host SSH", esteso
poi su richiesta anche a "URL del runtime target" (porta admin 8444) con un nuovo helper
`discoveredAdminUrl()` che ricostruisce l'URL con l'hostname al posto dell'IP, riusando
scheme/porta da `admin_url`. Nota tenuta nel codice/changelog: per "Host SSH" la risoluzione
`.local` è lato server (affidabile), per "URL del runtime target" è lato browser (meno uniforme
tra sistemi) — voluto comunque dal maintainer. Verificato anche che `deviceHost` alimenti già da
solo tutti i suoi consumatori (deploy pacchetto/container, pannello Gestione) e che non ci siano
altri punti "IP da scoperta" da sistemare in questo giro (`viewer_url` non è usato altrove;
"Dispositivi salvati" è un elenco distinto, non alimentato dalla scoperta). **Confermato
funzionante dal maintainer, mergiato su `main`.**

**Sessione 2026-08-13 — Deploy button/Configurazione→Runtime disallineati, chiarimento
"regressioni" sul container, selettore variante immagine aarch64**. Il maintainer ha ripreso il
lavoro e segnalato più cose in sequenza:
- **"Regressioni" nel container compilato** (barra/pulsante allarmi tornati fissi in alto,
  `alarm_banner`/`alarm_bell` ignorati, griglia di sfondo ricomparsa): **non un bug di codice**.
  Causa 1: `main` locale era 4 commit avanti a `origin/main` (tutto il lavoro della sessione
  precedente) mai pushato — **pushato** in questa sessione (`git push`, confermato dal
  maintainer). Causa 2, trovata **dopo** il push+rebuild, quando le regressioni persistevano
  ancora: il pannello "Installa/Aggiorna container" con il campo "Riferimento immagine" vuoto
  lascia scegliere il tag al device (`uname -m`), che sceglie sempre `latest-arm64` (l'immagine
  **SDK-tuned Pixsys**, pipeline di build separata, `scripts/build_container.sh`) — mai
  `latest-arm64-generic` (quella appena ricompilata, `build_container_aarch64_generic.sh`). Il
  device aveva quindi scaricato l'immagine SDK vecchia. Corretto manualmente via SSH sul device
  (`192.168.1.179`): pull esplicito di `latest-arm64-generic`, quadlet aggiornato con l'`Image=`
  esplicito, riavviato — verificato via hash del bundle servito che combacia con la build locale.
- **Deploy button verde ma Configurazione→Runtime non risultava connesso**: gap reale lasciato dal
  fix precedente sul pulsante Deploy — quello aveva reso il pulsante coerente con lo store
  condiviso, ma `RuntimeConnectionTab` (`ConfigView.tsx`) sincronizzava il proprio stato locale
  dallo store solo una volta al mount. Un cambio di connessione dall'esterno (es. "Riconnetti"
  dal pulsante Deploy) con la tab già aperta non si rifletteva. Aggiunto un effetto di
  risincronizzazione. **Mergiato e pushato.**
- **Selettore variante immagine aarch64** (branch `feat/container-variant-picker`, non ancora
  mergiato): per evitare che l'incidente sopra si ripeta, due bottoni "Generic (aarch64)" /
  "SDK-tuned Pixsys (aarch64)" nel pannello Registry precompilano il campo "Riferimento immagine"
  col tag esplicito corretto, così il campo non resta mai vuoto (e ambiguo) per un'installazione
  aarch64 fatta da qui. Nessun cambio backend necessario (`image_ref` già fluiva correttamente
  quando non vuoto). Discusso anche col maintainer il reale vantaggio dell'SDK-tuned rispetto a
  generic: **solo performance** (l'immagine finale è identica; generic forza `opt-level=0` per
  tutto il binario per aggirare un bug QEMU nell'assembly di `aws-lc-sys`, oltre a perdere il
  tuning `-mcpu=cortex-a35`) — non correttezza né accesso hardware. Il maintainer ha scelto di
  costruire subito la UI di scelta, rimandando un eventuale fix mirato del profilo di
  ottimizzazione (`[profile.release.package.aws-lc-sys] opt-level=0`) a un secondo momento.

**Prossimo passo naturale**: squash-merge di `feat/container-variant-picker` su `main` quando
confermato dal maintainer; valutare se/quando vale la pena sistemare l'`opt-level` di
`aws-lc-sys` per recuperare le prestazioni del build generic senza tornare all'SDK.

**Sessione 2026-08-11 (continuazione, stessa giornata)**: deploy 2.0.0 sul pannello fisico
(`tc620-a-p3-c6-07aff9.local`) e due bugfix nati dal test del demo Sandokan in web mode.

Deploy LVGL sul pannello: aggiornato il container `sws-runtime` (systemd quadlet, come `user`) a
2.0.0, verificato sano. Trovato un **container `sws-lvgl-viewer` root**, mai documentato prima,
attivo da 23h con l'immagine vecchia — era lì per bypassare un problema di permessi reale:
`/dev/input/event3` (dietro `ts_uinput`) è `root:input` 660 e `user` non è nel gruppo `input` (né
in `video`, nota già presente). Il maintainer ha vietato esplicitamente qualsiasi soluzione root
("il container non lo voglio come root in nessun caso") — il container/processo root è stato
**fermato e rimosso**, nessun sostituto lanciato stasera. Per il touch nativo come `user` serve
prima un fix ai permessi (`usermod -aG input user`, proposto ma non ancora fatto — riprendere la
prossima sessione). Il runtime web (porta 8443, container `user`) resta comunque su e sufficiente
per il demo Sandokan in modalità web, che è quanto serviva stasera.

**Due bug trovati e corretti**:
- **Log Remoti (ConfigView)** non caricava nulla contro il pannello: faceva un fetch diretto dal
  browser a `{target}/api/auth/login`+`/api/logs`, che fallisce silenziosamente su HTTPS con
  certificato self-signed. Riscritto sul relay `/ws/remote/logs` già usato dalla vista Live tags
  (stesso pattern, niente credenziali duplicate, niente polling). Non era un problema introdotto
  dai container — codice pre-refactor mai migrato.
- **Client ID MQTT random non risolto** su `system_start` (bottone Start) e sul reload dopo import
  bundle synoptic: entrambi passavano il `client_id` letterale invece di quello con suffisso
  `instance_id` risolto da `resolve_mqtt_client_ids` (che boot/apertura progetto usa
  correttamente). Se il progetto usa `random_client_id`, uno Stop→Start o un import bundle
  ripartiva MQTT con un id nudo, potenzialmente in collisione con un'altra sessione sullo stesso
  broker — spiega il sintomo riportato dal maintainer su Sandokan ("funziona qualche minuto poi si
  ferma"). Entrambi i path ora chiamano `resolve_mqtt_client_ids` prima del reload, come
  `apply_loaded_project`. `cargo check --workspace` e `pnpm build` verdi. **Da fare**: il
  maintainer deve ricompilare/aggiornare il container con questo fix per verificarlo sul pannello
  reale.

**Prossimo passo naturale** (di questa sotto-sessione): riprendere il deploy LVGL nativo sul
pannello risolvendo prima il gruppo `input` per `user`.

**Sessione 2026-08-12 — `alarm_banner` multi-allarme, T-46 (rimozione chrome fissa), bugfix
storico allarmi al boot**. Nato dal maintainer che testava gli allarmi sul progetto Sandokan e ha
trovato tre problemi reali
sull'oggetto `alarm_banner` più uno strutturale mai chiuso (T-46):
- `alarm_banner` mostrava sempre un solo allarme (il più urgente) ignorando l'altezza data
  all'oggetto, e non filtrava gli allarmi già confermati. Riscritto: lista scrollabile di tutti
  gli allarmi non confermati, ACK per riga, quelli confermati spariscono.
- Bordo inferiore tagliato sugli oggetti a filo del bordo pagina: `overflow: hidden` implicito
  dell'`<svg>` root del canvas, mai reso esplicito. Fix: `overflow: visible`.
- **T-46 eseguito**: rimossa la chrome fissa allarmi incondizionata, presente in tre punti
  (`RuntimeViewer.tsx`, `App.tsx`, e un terzo non previsto a piano — `AdminApp.tsx`, trovato
  durante l'implementazione) — mai aggiornata al modello per-pagina/opt-in di T-42/T-43. Allarmi
  ora visibili solo tramite oggetti piazzati esplicitamente.
- **8 dei 11 template** in `examples/templates/` (quelli con pagine synoptic — `enip-demo`,
  `s7-demo`, `sparkplug-demo` non ne hanno) allineati con `alarm_bell`+`alarm_banner` sulla
  pagina principale, altrimenti sarebbero rimasti muti dopo la rimozione della chrome fissa.
  Posizionamento automatico in basso, proporzionale alla pagina — non verificato a occhio contro
  ogni template, possibili sovrapposizioni minori da aggiustare.
- **Bug reale trovato sullo storico allarmi**: il maintainer pensava mancasse del tutto; in realtà
  esiste già via SQLite (`alarm_events`, dietro `/api/alarms/history`), ma il path di
  auto-apertura progetto al boot (`main.rs`, il caso normale su un device in produzione) non
  iniettava il datastore di default che invece riceve l'apertura via HTTP — quindi silenziosamente
  nessuno store, nessuno storico, su un progetto senza `datastores:` esplicito aperto da solo al
  boot. Sistemato: stessa iniezione in entrambi i path. **Deciso esplicitamente dal maintainer**:
  niente nuovo storico JSON a doppio file per allarmi+notifiche (idea iniziale della richiesta,
  ritirata una volta chiarito che il bug SQLite era la causa reale).

`cargo check --workspace` e `pnpm build` verdi. **Da fare**: verifica visiva/funzionale sul vivo
(bordo, lista multi-allarme, T-46 su Sandokan, un paio di template).

**Sessione 2026-08-12 — falso positivo "progetto cambiato esternamente" + testo Faceplates**. Il
maintainer ha notato che, connesso dall'IDE a un runtime, modificando Tag/Sorgenti/Allarmi il
banner "⟳ Il progetto sul
runtime è cambiato (deploy o modifica esterna)" compariva anche sulla propria sessione. Causa:
solo `saveAll()` (Sinottici/Funzioni/Simboli custom) aggiornava la finestra di esclusione "è stato
un salvataggio nostro" che `App.tsx` usa contro il polling di `useProjectWatcher` — Tag/Sorgenti/
Allarmi salvano da soli e non la toccavano mai. Aggiunta un'azione `markSaveOk()` allo store
(riusa lo stesso `saveOkTimer` di `saveAll()`, altrimenti l'indicatore "✓ Salvato" nel menu
sarebbe rimasto bloccato) e usata dai tre salvataggi mancanti. Nessun cambio al backend né al
meccanismo di polling stesso (è deliberatamente stateless, per intercettare anche cambi non-API).

Anche aggiunto un paragrafo esplicativo in testa al pannello Faceplates (Config → Faceplates):
il maintainer non ne capiva subito lo scopo — è un blocco grafico riutilizzabile/parametrico,
diverso dal significato di "faceplate" in altri SCADA (popup di dettaglio di un asset).

`pnpm build` verde. **Da fare**: verifica sul vivo (modificare Tag/Sorgenti/Allarmi dall'IDE
connesso a un runtime, confermare che il banner non compaia più sulla stessa sessione ma compaia
ancora per cambi genuinamente esterni).

**Sessione 2026-08-12 — Deploy button, autofill Host SSH, Log Remoti unificati, pulsante allarmi
residuo**. Quattro segnalazioni indipendenti del maintainer sull'IDE e sul runtime deployato:
- **Deploy button**: disconnettersi da lì non chiamava nemmeno `api.remoteDisconnect()` (la
  sessione restava viva lato server) e non si rifletteva in Configurazione→Runtime — tre fonti di
  stato indipendenti (`App.tsx`, `AdminApp.tsx`, `RuntimeConnectionTab`). Consolidato sullo store
  Zustand come unica fonte di verità in `App.tsx`/`AdminApp.tsx`; aggiunta una riconnessione
  esplicita all'ultimo dispositivo. Trovato anche, sistemando questo, che il "Connetti" nella tab
  Dispositivi salvati non chiamava mai l'API di connessione — stesso bug lato opposto, corretto.
- **"Cerca runtime"** ora compila anche "Host SSH" dall'hostname del dispositivo scoperto.
- **"Log Remoti"**: pannello rimosso (faceva un fetch diretto rotto, mai passato dal relay
  `/ws/remote/logs` già esistente lato backend). I log del runtime remoto confluiscono ora nello
  stesso log viewer dei log locali (nuovo hook `useRemoteLogStream`), taggati `remote:` per il
  filtro già esistente — corrisponde a quanto il maintainer si aspettava.
- **Pulsante allarmi residuo**: un secondo pezzo di chrome fissa mai trovato prima (`AlarmPanel`
  in `RuntimeView.tsx`, distinto dalla `<AlarmBanner>` già rimossa la sessione precedente) — ora
  rimosso anche questo.

`pnpm build` verde.

**Mergiati su `main`** i quattro branch di fix accumulati in questa giornata (uno squash-merge
ciascuno, in ordine cronologico: `fix/remote-logs-mqtt-clientid`, `feat/alarm-banner-list-t46`,
`fix/project-changed-false-positive`, `fix/deploy-btn-log-remoti-alarm-panel`) — non restavano
sincronizzati fra loro (es. `AdminApp.tsx` toccato da più branch in punti diversi) e ogni
container costruito da un branch specifico non conteneva i fix degli altri. `cargo check
--workspace` e `pnpm build` verificati verdi dopo ogni squash-merge. Branch non cancellati (pulizia
a discrezione del maintainer, per convenzione di questo progetto). **Prossimo passo naturale**:
il maintainer ricompila/pubblica un nuovo container da `main` per avere tutti i fix insieme sul
pannello.

**Sessione precedente**: 2026-08-11 (prosecuzione) — richiesta esplicita del maintainer, in autonomia su
un nuovo branch (`feature/lvgl-widgets-3`): "completare il porting dei widget da web a LVGL".
Confronto sistematico fra i 32 tipi del catalogo web e i 16 già supportati da LVGL: **5 nuovi tipi
implementati** (`text_list`, `bar_chart`, `sparkline`, `alarm_banner`, `faceplate` — **21/32 in
totale**), gli altri **11 deliberatamente rimandati con una ragione specifica per ciascuno** (non
un debito generico): `symbol` resta bloccato da Q15 (non è una decisione da prendere in sessione),
`image` ha lo stesso genere di vincolo (nessuna pipeline di decodifica configurata), `grid`
richiederebbe un cambio architetturale del dispatcher (contenitore ricorsivo, non un widget
foglia), gli altri otto (`pipe`, `recipe_panel`, `alarm_bell`, `setpoint`, `xy_plot`, `pie_chart`,
`lang_selector`/`lang_button`) aprirebbero ciascuno un fronte di lavoro a sé — dettagli completi in
`docs/OPEN_QUESTIONS.md` Q14 seguito 13.

Un bug reale trovato e corretto durante la verifica visiva (non a compilazione): `bar_chart`
riempiva le barre da sinistra invece che dal basso quando poche serie su un box abbastanza largo
rendevano `slot_w * (1 - gap)` più largo che alto — `lv_bar.c` decide il riempimento orizzontale/
verticale confrontando le dimensioni del widget stesso, non c'è un flag dedicato. Corretto
clampando `bar_w < plot_h` sempre, non solo nel caso comune. Un secondo problema (non un bug del
motore) osservato ma non toccato: il faceplate built-in `motor_basic.yaml` usa una stringa di
formato in stile printf (`"%.0f rpm"`) che questo motore (come lo schema web) non interpreta —
contenuto condiviso con la versione web, fuori scope per questo giro.

Verificato end-to-end su un'istanza isolata (`.run-12`) con screenshot X11 per entrambe le pagine
del template `lvgl-demo`, non solo a compilazione: tutti e cinque i nuovi widget renderizzano e si
aggiornano dal vivo scrivendo i tag corrispondenti via REST, nessun crash. Palette editor
(`LeftPanel.tsx`) aggiornata.

**Ancora nella stessa sessione** ("riesci a completare anche gli altri?"): implementati **8 dei
restanti 11 tipi** — **29/32 in totale**. Prima di procedere, chiesta al maintainer la decisione
che Q15 riserva esplicitamente a lui (non a una sessione vibecode): **opzione B** per `symbol`, i
soli 16 simboli builtin (non 17 — errore di conteggio corretto nel processo, vedi Q6/Q15) riscritti
a mano su primitive LVGL native (`lv_canvas`, l'unico canale di disegno abbastanza espressivo di
LVGL 8.x fuori dai widget standard — verificato in `lv_canvas.h` prima di scegliere l'approccio).
Aggiunti anche `grid` (**unico tipo di questo motore i cui figli non compaiono in `page.objects`**
— contenitore ricorsivo con sotto-suddivisioni, riusa `dispatch_render` con coordinate traslate),
`pipe` (solo routing `"straight"`, riempimento statico non live), `alarm_bell` (badge + pannello,
senza storico/shelve), `recipe_panel` (nuovo `client::fetch_recipes`/`apply_recipe`, l'apply
spara `rt_handle.spawn` direttamente dalla callback invece di una nuova coppia di canali mpsc),
`setpoint` (**primo pattern di interazione a inserimento testo di questo motore** — overlay con
`lv_textarea`+`lv_keyboard` in modalità numerica), `xy_plot` (traiettoria live campionata
localmente, non un poller REST come `trend`) e `pie_chart` (solo modalità donut, componendo
`lv_canvas_draw_arc` per spicchio — LVGL 8.x non ha un widget torta nativo).

**Bug reale trovato e corretto durante la verifica visiva** (non a compilazione): alcune forme
"contenitore" dei simboli (corpo del `tank`, telaio del `fan`, vasca del `level_sensor`, vessel di
`mixer`/`agitator`) usavano lo stesso colore dello sfondo pagina — invisibili, restava visibile
solo l'accento colorato sopra, sospeso a mezz'aria sullo screenshot. Corretto con un colore
"pannello" più chiaro, stesso già usato per i container di `alarm_viewer`/`alarm_banner`.

Verificato end-to-end su una terza pagina del template demo con tutti e otto i tipi insieme (23
oggetti), screenshot X11 prima e dopo aver scritto valori non-zero sui tag condivisi: nessun
errore nel riepilogo "widget creati", pie_chart/xy_plot/grid/pipe rispondono correttamente allo
stesso cambio di tag. Non testato con click sintetici in questo giro: il ciclo completo
apri-tastiera→digita→OK di `setpoint` e l'apertura del pannello di `alarm_bell` (nessun harness
XTest predisposto in questa sessione) — ricalcano però pattern già collaudati altrove nel file.

**Ancora nella stessa sessione** — il maintainer ha corretto un mio errore: "completa l'implementazione
di lang_selector/lang_button, però lato web mi sembrava funzionassero". Aveva ragione: la mia
analisi era stata superficiale (cercato solo dentro `SvgCanvas.tsx`, mai trovato
`RuntimeView.tsx`/`src/i18n/projectI18n.ts`, il vero sistema di traduzione contenuti T-40 —
`project.languages` mappa token `{{key}}` → traduzioni, `RuntimeView` li risolve nella lingua
corrente prima di renderizzare). **31/32 tipi supportati ora**. Nuovo `client::fetch_languages`
(`GET /api/project`, una sola chiamata all'avvio) + `resolve_msg`/`localize_object` (porta 1:1 la
logica di `projectI18n.ts`) applicati dentro `dispatch_render` — l'unico punto per cui passano
davvero tutti gli oggetti (primo livello, figli di `faceplate`, figli di `grid`) senza ripetere la
stessa logica in tre posti. Lingua corrente come stato process-wide (`SharedLang`, non
`localStorage` — questo motore non ha un concetto di sessione per-tab). **Cambio lingua = ricarica
della pagina corrente**, riusando `nav_tx` (un `lang_button` è a tutti gli effetti un `navbutton`
verso se stesso) invece di una logica di reload dedicata — nessun canale nuovo in `main.rs`.
`lang_selector` usa `lv_dropdown`, fedele al `<select>` nativo del web. Bug trovato e corretto
durante la verifica: il tema di default di LVGL colora già i bottoni in blu, IT/EN risultavano
indistinguibili senza una tinta esplicita anche per lo stato inattivo.

**Verificato con un vero click sintetico**, non solo lettura del codice: installato `python-xlib`
senza sudo (`pip install --user --break-system-packages`, mai provato prima in questa sessione),
click XTest sul bottone EN — testo/bottone attivo/dropdown passano correttamente all'inglese,
confermato con screenshot prima/dopo.

**Resta fuori solo `image`** (nessuna pipeline di decodifica immagine configurata in questo
motore — genuinamente bloccato architetturalmente, non un errore di analisi). Dettagli completi
in `docs/OPEN_QUESTIONS.md` Q14 seguito 15.

Nota: questo branch (`feature/lvgl-widgets-3`) è rimasto isolato fino al 2026-08-13, quando è
stato squash-mergiato in `main` insieme alla pulizia dei 15 branch storici della saga LVGL (vedi
sessione più recente in testa a questo file). **Prossimo passo naturale**: decidere se/quando
affrontare `image` (richiederebbe una pipeline di decodifica raster — Q16), poi verificare dal
vivo (simulatore o hardware) i widget aggiunti qui, mai testati fuori da `.run-12`.

**Sessione precedente**: 2026-08-11 — release **2.0.0**, prima dopo il merge del motore LVGL. Il
maintainer ha scelto **il `2` per il cambio abbastanza grande da giustificare un major bump**
(il motore LVGL) e con l'occasione ha abbandonato **CalVer** a favore di **Semantic Versioning**
puro (`MAJOR.MINOR.PATCH`) come schema di versioning da qui in poi — non una rinumerazione
retroattiva delle release precedenti (dettagli in `docs/CONTEXT.md` e `CHANGELOG.md`).

Versione aggiornata ovunque (`sws-runtime/Cargo.toml` `[workspace.package]`, propagata a tutti i
crate che ereditano `version.workspace = true`; `sws-lvgl-viewer` e `sws-kiosk`, esclusi dal
workspace, versione hardcoded a parte; `sws-editor/package.json`). Verificato con `cargo build
--release` (workspace + `sws-lvgl-viewer` + `sws-kiosk`, tutti verdi) e `pnpm build`.

Costruite e **pubblicate su `ghcr.io/soligolab/sws-runtime`** (tre tag ciascuna: versione,
commit, `latest`, per architettura) due immagini:
- **x86_64** (`scripts/build_container_x86_64.sh`, nessun `sudo` richiesto — build nativa).
- **aarch64-generic con LVGL** (`scripts/build_container_aarch64_generic.sh --with-lvgl`,
  richiede `sudo` per l'emulazione QEMU — lanciata dal maintainer stesso, come da policy dei
  permessi di questo progetto). L'immagine risultante vive nello storage podman di **root**
  (conseguenza del `sudo`), quindi per pubblicarla senza un secondo giro di `sudo` è stata
  **ricaricata dall'archivio** (`podman load` dall'archivio `.tar.gz` già restituito all'utente
  normale dal trap di `restore_ownership` dello script) nello storage rootless, poi taggata e
  pubblicata da lì — nessun bisogno di rilanciare l'intera build sotto `sudo` solo per il push.
  Verificato che l'immagine contenga davvero entrambi i binari (`sws-runtime` e
  `sws-lvgl-viewer`) prima di pubblicare, non assunto dal solo nome del flag `--with-lvgl`.
- **Non ricostruita** in questo giro l'immagine aarch64 SDK-tuned Pixsys (il percorso alternativo
  che il maintainer preferisce non usare "per ora").

Committati anche su `main` (dal maintainer, non da questa sessione): un **rewrite completo di
`README.md`** come overview GitHub-facing (installazione, protocolli, confronto motori
HTML/LVGL, architettura) — non toccato da queste istruzioni, solo pushato.

**Prossimo passo naturale**: verificare che il discovery mDNS (Configurazione → Runtime) mostri
`2.0.0` sui runtime reali una volta riavviati con l'immagine nuova. Poi, quando servirà: valutare
se/quando ricostruire anche l'immagine SDK-tuned Pixsys con questa versione, e proseguire sugli
altri punti aperti (Q14 seguiti 12+, Q15/`symbol`, pulizia branch `feature/lvgl-*`).

**Sessione precedente**: 2026-08-10/11 — chiusa la Fase 4 (rendering LVGL reale su hardware Pixsys,
`tc620-a-p3-c6-07aff9.local`) e **mergiati su `main` tutti e 15 i branch** del filone LVGL
(15 squash-merge sequenziali, uno per fase, nessuna cancellazione di branch — vedi
`docs/plans/` per il piano, non ancora committato lì perché eseguito interamente in sessione).

Partita da schermo nero sul device reale nonostante l'accesso Wayland già verificato in
precedenza. Indagine approfondita sul crash SDL2, su richiesta esplicita del maintainer di
scendere di livello invece di continuare a indovinare ("lasciar perdere SDL2 per un momento...
prima di tutto certificare che il video funziona"): isolato un **SIGSEGV Wayland** fino a
`SDL_CreateRenderer`/`SDL_GetWindowSurface` (bug upstream SDL2 note — creazione EGL eager
indipendente dal flag richiesto, `libsdl-org/SDL#4650`/`#5386`); passando a X11 (che ha un
percorso framebuffer dedicato, a differenza di Wayland) emerso un bug **distinto**:
`SDL_x11framebuffer.c` hardcoda `depth=32` in `XCreateImage` contro il visual reale (depth 24 su
questo device), causa un `BadValue` su `MIT-SHM X_ShmPutImage`. Tre fix mirati tentati e falliti
su questo secondo bug — non risolvibile senza patchare SDL2 a monte.

**Causa radice del rendering assente isolata definitivamente con un tool indipendente**, non il
nostro codice: `modetest -a` (atomic) riproduce lo stesso schermo nero di SDL2/kmsdrm, mentre
`modetest` (legacy, nessun flag) mostra un pattern di test stabile. Il driver kernel Rockchip
out-of-tree di questo device (`Tainted: [O]`) ha il **percorso di commit KMS ATOMIC rotto** —
colpisce SDL2 (tutti i suoi percorsi Wayland/kmsdrm) e il driver `lv_drivers/display/drm.c` già
vendorizzato, entrambi esclusivamente atomic. Bypassato interamente scrivendo un nuovo backend
da zero, `drm_display.rs`: rendering diretto via API DRM **legacy** (`drmModeSetCrtc`), bindgen
contro libdrm, dumb buffer via ioctl raw (formula di encoding ioctl Linux reimplementata a mano
e verificata byte-esatta contro un riferimento C-preprocessor), conversione RGB888→XRGB8888.
**Primo rendering LVGL mai visto su hardware fisico in questo progetto.**

Input touch via nuovo `touch_indev.rs`: legge evdev raw da `/dev/input/ts_uinput` (symlink
dinamico di `find-touchscreen.service` già presente sul device, mai un device path hardcoded —
i numeri `eventN` non sono stabili tra boot), eventi già calibrati da tslib
(`ts-uinput.service`) a monte — nessun linking tslib diretto necessario, calibrazione per-asse
letta dinamicamente via `EVIOCGABS` invece di costanti hardcoded.

Due bug estetici trovati e corretti nella prima verifica visiva reale (mai visibili prima: ogni
verifica precedente era sul simulatore SDL2 desktop di una macchina diversa, non hardware reale):
il gauge non forzava una forma circolare per una box non quadrata (220×190 nel template demo,
ora centra il lato più corto); lo slider riempiva l'intera altezza dichiarata (44px) invece di
un track sottile (ridotto a 16px centrato, con `lv_obj_set_ext_click_area` per preservare l'area
di tocco originale). Confermati risolti dal maintainer.

Dettagli completi (backtrace, comandi, output di verifica) in `docs/OPEN_QUESTIONS.md` Q14
(seguiti 12+, da aggiungere — non ancora scritti come voci separate in questo giro, narrati qui e
nei messaggi di commit del merge).

**Merge su `main`**: 15 squash-merge sequenziali in ordine cronologico dello stack
(`feature/lvgl` → ... → `feature/lvgl-pixsys-deploy`), uno per fase logica invece di uno
schiacciato o 79 commit grezzi — richiesta esplicita del maintainer ("un po' di squash ma
cercando di mantenere la struttura del lavoro"). Verificato `git diff main
feature/lvgl-pixsys-deploy` vuoto a fine sequenza (nessuna perdita/duplicazione), `cargo check`
(workspace + `sws-lvgl-viewer`, escluso dal workspace principale) e `pnpm build` verdi. **I 15
branch `feature/lvgl-*` non sono stati cancellati** — decisione di pulizia rimandata
esplicitamente dal maintainer a un secondo momento.

**Prossimo passo naturale**: aggiornare `docs/OPEN_QUESTIONS.md` Q14 con i seguiti 12+ (indagine
SDL2, backend DRM, touch, fix visivi) non ancora scritti come voci separate — narrati solo qui e
nei commit del merge finora. Poi: test con un mouse/dito vero più esteso sul device, decidere se/
quando cancellare i branch ormai mergiati, e se/quando affrontare Q15 (`symbol`/SVG→LVGL).

**Sessione precedente**: 2026-08-08 (prosecuzione) — completati i primi 4 punti della roadmap proposta
dopo la verifica del maintainer su `lvgl-01` (esclusi solo i container, come richiesto
esplicitamente): **live updates** (connessione `/ws/tags` persistente, widget aggiornati sul
posto invece che ricreati), **più widget** (checkbox/progress_bar/radio/ellipse, 9 tipi
supportati in totale), **verifica backend Wayland nativo** (confermato: con
`SDL_VIDEODRIVER=wayland` la finestra non compare nella tree XWayland), e **interattività**
(nuovo input device puntatore LVGL, click su bottone/checkbox/radio e drag sullo slider
scrivono i tag sul backend via `PUT /api/tags/:id`). Tre nuovi branch in sequenza sul quarto
precedente: `feature/lvgl-live-updates` → `feature/lvgl-more-widgets` →
`feature/lvgl-input-device` (tip attuale). **I due limiti noti lasciati aperti dalla sessione
precedente sono ora entrambi risolti.**

Nel processo, due bug propri (non upstream) scoperti e corretti: **(1)** il colore LED
(`on_color`/`off_color` del synottico) veniva silenziosamente ignorato — a differenza degli
altri widget, `lv_led` non legge lo `Style` `bg_color` per il proprio colore, tiene un campo
interno impostabile solo con `lv_led_set_color()` via FFI diretta (dettagli in
`docs/OPEN_QUESTIONS.md` Q14); **(2)** il titolo della finestra SDL2 mostrava caratteri corrotti
(mojibake sull'em-dash, percorso WM_NAME/X11 — causa di fondo uguale ai glyph mancanti U+2014
nel synottico, ma un sintomo e un percorso di rendering diversi), corretto togliendo l'em-dash
da entrambi i posti — il secondo trovato dal maintainer stesso mentre guardava la finestra dal
vivo durante la sessione. Interattività **verificata end-to-end con click/drag sintetici via
X11 XTest** (`python-xlib`, ambiente headless senza mouse fisico — non solo compilazione o
screenshot statico): ogni widget interattivo scrive correttamente il tag atteso sul backend
(confermato via `GET /api/tags/:id`), il readout si aggiorna dal vivo sullo stesso schermo,
nessun crash/warning/coredump durante l'intera sessione di test. Template `lvgl-demo` esteso di
pari passo con ogni nuovo tipo widget (richiesta esplicita del maintainer: "lo useremo in tutte
le fasi come demo di test").

**Proseguito nella stessa sessione** ("vai avanti col lavoro"), quinto branch
`feature/lvgl-widgets-2`: aggiunti `line` (`lv_line`) e `gauge` (`lv_meter`, ago + arco + valore
dal vivo, scala 270° come il gauge web) — **11 tipi widget in totale**, ora 25 oggetti nel
template `lvgl-demo`. Scelti perché LVGL ha un widget nativo diretto per entrambi, a differenza
di trend/table/alarm_viewer/symbol (composizione o disegno custom, rimandati). Un dettaglio non
ovvio verificato leggendo il sorgente C prima di scrivere il codice (non dopo un bug): i punti
di `lv_line` sono relativi alla posizione dell'oggetto, non assoluti come il resto del file — vedi
`docs/OPEN_QUESTIONS.md` Q14. Verificato anche questo con drag sintetico (spostare lo slider
muove dal vivo anche il gauge, che riusa `lvgl_demo.value`).

**Ancora nella stessa sessione** (il maintainer ha risposto solo "vai avanti" al resoconto che
segnalava trend/table/alarm_viewer/symbol/state_lamp come più impegnativi — proseguito solo su
`state_lamp`/`table`, gli altri tre restano deliberatamente non tentati): aggiunti sullo stesso
branch `feature/lvgl-widgets-2` — **13 tipi widget in totale**, 28 oggetti nel template.
`state_lamp` riusa lo stesso modello value→label→color di `text_list` (`lv_obj` normale, non
`lv_led` — legge `bg_color` dallo `Style` senza sorprese). `table` (righe statiche, non un
datagrid) ha richiesto più iterazioni del previsto: `lv_table` va a capo dentro la cella se il
testo non entra in larghezza, e `LV_TABLE_CELL_CTRL_TEXT_CROP` da solo non basta a impedirlo
(verificato con screenshot, non assunto dal nome della flag) — risolto con colonna qualità a una
lettera invece di un'abbreviazione più lunga. Verificato dal vivo: scrivere `lvgl_demo.led_on`
aggiorna insieme LED, state_lamp e la riga tabella corrispondente, tre rese completamente
diverse dello stesso tag sullo stesso schermo.

**Richiesta successiva del maintainer**, nuovo branch `feature/lvgl-multipage-1280x800`:
adattare il demo a uno schermo 1280×800 (da provare anche su un dispositivo reale,
`tc620-a-p3-c6-07aff9.local`) e gestire più pagine. Risoluzione ora derivata dalla prima pagina
caricata in sessione invece che costante fissa — il vincolo originale non esisteva più da tempo,
solo mai rivisto. Nuovo tipo `navbutton`: manda l'**id interno** della pagina di destinazione
(non il nome file usato dalle REST — sono due cose diverse, verificato prima di assumerle
uguali) su un canale dedicato, risolto lato client elencando le pagine del progetto.

**Bug serio trovato e risolto durante la verifica dal vivo** (non a compilazione): la prima
versione di "ricarica pagina" (pulisci lo schermo attivo + ricrea i widget sopra) produceva, su
navigazioni ripetute col catalogo widget completo, un **crash SIGSEGV** riproducibile
(backtrace GDB: dentro il ridisegno delle etichette di un gauge) e, separatamente, un artefatto
visivo di corruzione testo. Bisecato con oltre 10 pagine di prova create ad-hoc; il sintomo si è
rivelato **non deterministico all'interno della stessa sessione**, la firma tipica di una
corruzione di memoria a manifestazione ritardata più che di un bug isolabile a una riga precisa
— a differenza degli altri bug di questo filone, il meccanismo esatto non è stato isolato con
piena certezza (dettagli onesti in `docs/OPEN_QUESTIONS.md` Q14). Risolto passando al pattern
standard LVGL per il cambio schermo (schermo nuovo + `lv_disp_load_scr` + `lv_obj_del` del
vecchio, invece di mutare in-place quello attivo) — stabile su 14+ navigazioni consecutive nei
test, incluse raffiche rapide. Disabilitato anche `LV_USE_MEM_MONITOR` (overlay di debug, non
più adatto a un demo multi-pagina reale) durante l'indagine.

Template diviso in due pagine 1280×800 collegate da navbutton, la seconda dimostra che i tag
restano sincronizzati attraverso la navigazione. **Non ancora provato su hardware reale.**

**Ancora nella stessa sessione**, nuovo branch `feature/lvgl-badge-compat`: su richiesta del
maintainer, la palette oggetti dell'editor mostra un badge "L" (angolo dell'icona) sui tipi che
hanno anche una controparte LVGL, quando il progetto aperto è "web" — verificato con uno
screenshot reale in browser (Playwright headless, non solo letto il codice). Verificata anche,
campo per campo tra `sws-web/src/synoptic.rs` e `sws-lvgl-viewer/src/model.rs`, la richiesta che
lo YAML usi gli stessi nomi tra web e LVGL: **confermato per tutti i 14 tipi supportati** — mai
verificato sistematicamente prima, solo tenuto allineato per costruzione. Trovati (e documentati
in Q14, non chiusi) alcuni gap comportamentali non legati ai nomi: `checked_value`/
`unchecked_value` su checkbox/radio (LVGL scrive solo booleano puro) e `stroke_dasharray` su
line (LVGL disegna sempre pieno) — un progetto che li usa avrebbe un comportamento diverso
passando da web a LVGL, pur restando nei tipi "con controparte".

**Ancora nella stessa sessione** ("procedi con i prossimi 5 step"), nuovo branch
`feature/lvgl-checkbox-values`: chiuso il primo gap appena trovato — `checkbox`/`radio` ora
onorano `checked_value`/`unchecked_value` (confronto per stringa, non booleano fisso), sia alla
creazione sia a ogni frame in `update_bindings`, sia sul click (scrive il valore giusto invece di
un `TagValue::Bool`). Verificato end-to-end sull'istanza isolata `.run-12`: nuovo widget demo con
`checked_value: "ON"`/`unchecked_value: "OFF"` (stringa, non booleano) scrive esattamente quelle
due stringhe sul tag col click sintetico XTest; il checkbox preesistente (nessun `checked_value`
impostato) continua a scrivere `true`/`false` come prima, nessuna regressione. Il secondo gap
(`line`/`stroke_dasharray`) si è rivelato **un errore della sessione precedente**: rileggendo
`SvgCanvas.tsx` riga per riga, `stroke_dasharray` appartiene solo al tipo `pipe` (confermato anche
dal JSDoc in `types/index.ts`), la linea web è sempre piena — la linea LVGL (sempre piena) era già
corretta, niente da chiudere. Dettagli completi, incluso perché l'errore è stato preso per buono
la prima volta, in `docs/OPEN_QUESTIONS.md` Q14 (seguito 6).

**Ancora nella stessa sessione**, nuovo branch `feature/lvgl-trend`: terzo dei 5 passi, `trend` su
`lv_chart` — **15 tipi supportati in totale**. Più complesso dei widget precedenti perché è il
primo a non bastargli `/ws/tags` (solo il valore *corrente*): serve interrogare periodicamente lo
storico (`GET /api/history/:tag`, stesso endpoint REST del web, nuovo `client::spawn_history_poller`,
un task per serie, poll ogni 2s). Scelte non ovvie verificate leggendo il sorgente C prima di
scrivere codice: modalità `SCATTER` (non `LINE`) per una X vera proporzionale al tempo invece di
un indice fittizio; coordinate X in secondi-dall'inizio-finestra perché `lv_coord_t` è un `i16`
(un Unix ms ci trabocca); `point_cnt` è dell'intero chart, non per-serie, quindi due tag con
densità diversa richiedono di ricalcolare il conteggio come il massimo tra le serie e riscriverle
tutte insieme, non solo quella cambiata (altrimenti l'ultima processata sovrascrive silenziosamente
le altre). Limite accettato consapevolmente: il poller non si ferma mai (stesso principio degli
`Style`/contesti `Box::leak` già accettati, ma qui è I/O di rete ricorrente, non un valore inerte).
Gap MVP dichiarati: solo il colore di `trend_series_styles` è onorato (non spessore/tratteggio/
riempimento/smoothing), niente pan/zoom/modal espandi (sempre finestra live). Verificato
end-to-end su `.run-12` (stesso tag dello slider demo, autofit Y, scrittura diretta di valori con
ritardi per simulare un drag, screenshot) e multi-serie (due tag con numero di campioni diverso,
colori distinti) su una copia isolata. Palette editor aggiornata (`trend` mancava da
`LVGL_SUPPORTED_TYPES`). Dettagli completi in `docs/OPEN_QUESTIONS.md` Q14 (seguito 7).

**Ancora nella stessa sessione**, nuovo branch `feature/lvgl-alarm-viewer`: quarto dei 5 passi,
`alarm_viewer` (solo modalità `"list"`, `"banner"`/`"table"` segnalati non supportati) —
**16 tipi supportati in totale**. Più semplice di `trend` per il trasporto (gli allarmi hanno già
un canale push vero, `/ws/alarms`, non serve un poller REST) ma con un protocollo diverso scoperto
leggendo `handle_alarms_ws` prima di assumerlo: ogni messaggio (snapshot iniziale incluso) è un
`AlarmState` "nudo", niente involucro `{type: ...}` come `/ws/tags` — "upsert per id" basta da
subito, nessuna attesa speciale in `spawn_alarm_subscription`. Righe a slot fisso (come le celle di
`table`), pulsante ACK per riga con un contesto `RefCell`-based invece del solito `Box::leak` fisso
(l'allarme assegnato a uno slot cambia da un frame all'altro, a differenza di ogni altro pulsante
di questo motore). Due bug di layout trovati e risolti durante la verifica dal vivo (non a
compilazione): padding di default del tema non azzerato (pulsante ACK tagliato dal bordo del
contenitore) ed elementi di riga incollati al bordo superiore invece che centrati — nessuno dei due
toccava la correttezza dei dati, solo l'aspetto. Verificato end-to-end su `.run-12`: due allarmi
demo sullo stesso tag di slider/gauge/trend (soglie 70/90), comparsi in tempo reale via
`/ws/alarms` scrivendo il tag oltre soglia, click ACK sintetico confermato via `GET /api/alarms`
(`acknowledged: true`, pulsante sparito dalla riga), ordinamento più-recente-prima confermato con
due allarmi attivi insieme. Palette editor aggiornata. Dettagli completi in
`docs/OPEN_QUESTIONS.md` Q14 (seguito 8).

**Ancora nella stessa sessione**, nuovo branch `feature/lvgl-symbol-analysis`: quinto e ultimo
punto dei 5 passi, `symbol` — **analisi, non implementazione**, come esplicitamente delimitato
dall'istruzione originale ("una vera domanda architetturale... non ancora posta"). Scritta come
nuova `docs/OPEN_QUESTIONS.md` **Q15**: LVGL 8.x (la versione vendorizzata in questo motore) non
ha alcun renderer SVG integrato — un vincolo della libreria, non componibile con le primitive già
disponibili come fatto per gli altri quattro widget di questo giro. Verificato il contenuto reale
da rendere (non assunto dal nome del tipo): 17 simboli "builtin" (JSX/SVG scritti a mano, davvero
ricolorati per stato), 12 "vendored" (file `.svg` statici, mai ricolorati), `custom_symbols` (SVG
arbitrario per URL esterno, contenuto non noto in anticipo) — e distinto esplicitamente da
`faceplate`, un problema diverso e molto più piccolo (composito di oggetti già ordinari, niente
SVG, probabilmente quasi gratis da supportare) non affrontato qui perché fuori dallo scope dei 5
passi originali. Quattro opzioni presentate con una raccomandazione ma nessuna decisione presa —
resta al maintainer. Nel processo, corretta anche una nota sbagliata già presente in Q6 (Symbol
library packaging): i simboli non passano mai da `include_str!()` in `sws-web` (solo le 3
faceplate lo fanno) e sono 29 in totale, non 22 come scritto in precedenza — mai verificato a
fondo prima d'ora.

**Tutti e 5 i passi proposti sono ora completi**: 4 implementati e verificati end-to-end
(`checked_value`/`unchecked_value`, correzione `line`/`pipe`, `trend`, `alarm_viewer` — **16 tipi
widget in totale**), 1 analizzato e scritto come domanda aperta (`symbol`, Q15).

**Ancora nella stessa sessione** (richiesta esplicita del maintainer, poi andato a dormire con
l'istruzione di proseguire in autonomia), nuovo branch `feature/lvgl-pixsys-deploy`: affrontata la
Fase 4 del piano originale (framebuffer/DRM/Wayland reali) — sostituire Chromium-on-Weston con
`sws-lvgl-viewer` sui Pixsys per liberare le risorse che il browser consuma oggi. Vincolo esplicito
del maintainer: LVGL resta un **companion opzionale** di `sws-runtime`, mai un fork — tutto ciò che
esiste per la versione web (runtime, deploy Yocto, container) continua a funzionare esattamente
come prima (memoria `feedback_lvgl_deploy_unified`). `scripts/yocto/build.sh` guadagna
`--with-lvgl` (default off, comportamento di default invariato), nuovo companion systemd
`deploy/yocto/sws-lvgl-viewer.service` (stesso pattern di `sws-kiosk.service`, non auto-abilitato),
`Containerfile.aarch64` copia l'intera `bin/` invece del solo `sws-runtime` così la stessa immagine
può contenere anche il viewer LVGL.

Verifica su hardware reale (`tc620-a-p3-c6-07aff9.local`, credenziali fornite dal maintainer)
**parziale, non spacciata per completa**: confermato di persona che un container rootless su quel
device accede al socket Wayland reale solo con `--userns=keep-id` (senza, "Permission denied" per
via della rimappatura UID di podman rootless — questo era il "non ricordo come" del maintainer),
provato in modo non distruttivo (container usa e getta, il `sws-runtime` reale in esecuzione da 39h
sul device non è stato toccato, verificato prima e dopo). **Non verificato**: il rendering LVGL
vero — produrre un binario aarch64 richiede l'SDK Yocto Pixsys, non installato né sulla macchina
usata in questa sessione né sul device (nessun toolchain a bordo, solo runtime). Trovato anche che
`WAYLAND_DISPLAY` sul device reale è `wayland-1`, non `wayland-0` come hardcoded sia nel nuovo unit
sia nel preesistente `sws-kiosk.service` — mai verificato su hardware reale prima d'ora. Numeri
reali rilevati: 1.9 GB RAM totale, ~200 MB liberi con Chromium+runtime già in esecuzione —
sostanzia concretamente la motivazione "risorse" del maintainer. Dettagli completi in
`docs/OPEN_QUESTIONS.md` Q14 (seguito 9) e `docs/DEPLOY_CONTAINER_AARCH64.md` §4.

**Ancora nella stessa sessione**, richiesta esplicita del maintainer di preferire per ora il
percorso **generico aarch64** (nessun SDK/toolchain Pixsys) invece di quello SDK-tuned appena
descritto: "il build per i prodotti pixsys per ora vorrei farlo come generic arch64 senza usare
il toolkit, preferisco che il container per ora sia generico e non legato ai prodotti pixsys".
Stesso identico pattern opt-in `--with-lvgl` esteso anche a
`scripts/build_container_aarch64_generic.sh` (builda dentro un container QEMU-emulato, nessun SDK
richiesto sull'host) e nuovo `deploy/container/Containerfile.aarch64-generic-lvgl.builder` (layer
separato che aggiunge clang/libclang/libsdl2-dev solo per chi passa `--with-lvgl`; il percorso
`sws-runtime`-only resta invariato). Bloccato al momento di lanciarlo: questo percorso richiede
root (verificato 2026-08-01, non ripetuto qui) e `sudo` è negato dalla policy dei permessi di
questo progetto — stavolta la probe (`sudo -n true`) è stata negata direttamente dal sistema di
permessi, non solo in un prompt interattivo. Il maintainer ha scelto di lanciare lui stesso il
comando (`sudo ./scripts/build_container_aarch64_generic.sh --with-lvgl --push`) su questa
macchina quando conveniente, invece di concedere un'eccezione alla policy. `docs/HOWTO.md` cap. 1
aggiornato di conseguenza: percorso generico ora primario, percorso SDK preservato come
alternativa in un blocco ripiegabile, riferimenti immagine corretti da `-arm64` a `-arm64-generic`.

**Ancora nella stessa sessione — la build reale è riuscita** (lanciata dal maintainer stesso,
2026-08-09): `sudo ./scripts/build_container_aarch64_generic.sh --with-lvgl --push` ha compilato
`sws-lvgl-viewer` sotto emulazione QEMU **senza incidenti** — l'incognita bindgen/libclang segnalata
in `docs/HOWTO.md` non si è materializzata. Verificato di persona (non solo dal log "done" dello
script): il binario prodotto è un ELF aarch64 valido di 18 MB, di proprietà `max_xxv` (il trap di
`restore_ownership` ha funzionato); l'immagine pubblicata su `ghcr.io/soligolab/sws-runtime` con
tre tag (`2026.7.0-arm64-generic`, `<sha>-arm64-generic`, `latest-arm64-generic`) contiene davvero
sia `sws-runtime` (67 MB) sia `sws-lvgl-viewer` (18 MB) sotto `/usr/local/bin/` — ispezionato
estraendo i layer del `.tar.gz` salvato in locale, non assunto dal solo output del comando. Un solo
intoppo incontrato e risolto nello script prima di questo run: `podman login`/`podman push`
giravano anch'essi sotto `sudo` (necessario per la build QEMU) e non vedevano il login rootless
fatto da utente normale prima del comando ("nessun login su ghcr.io" pur avendo fatto
`podman login`) — corretto puntando esplicitamente all'`auth.json` di `$SUDO_USER` via
`--authfile`, invece di richiedere un secondo login come root. `docs/HOWTO.md` cap. 1 aggiornato
con l'esito.

**Prossimo passo naturale**: ripetere il test Wayland su `tc620-a-p3-c6-07aff9.local` (§Passo 1-6
di `docs/HOWTO.md` cap. 1), stavolta con l'immagine `sws-lvgl-viewer` vera appena pubblicata invece
del container usa-e-getta con entrypoint `sh` usato finora — è il passo che manca per chiudere la
Fase 4 (rendering LVGL reale su schermo, non solo accesso al socket Wayland). Poi: il maintainer
testa con un mouse vero, decide se/come riunificare i quindici branch `feature/lvgl-*` (nessuno
ancora mergiato in `main`) e se/quando affrontare Q15/`pipe`/`faceplate`.

**Sessione precedente**: 2026-08-08 (mattina) — il maintainer ha rivisto il lavoro della notte (Fase 1-3
del motore LVGL) e ha deciso come sbloccare l'export immagine: shim di registrazione display in
Rust puro (niente vendoring del crate `lvgl`) + simulatore SDL2 interattivo (`libsdl2-dev`
installato apposta). Implementato su un quarto branch, **entrambi i bug confermati risolti**,
**finestra SDL2 funzionante con screenshot verificati** (rect/text/button/led/slider tutti
renderizzati correttamente dal vivo). Nel processo scoperto e risolto un **secondo bug upstream
indipendente** in `lvgl-sys` (non `lvgl`) — vedi sezione dedicata sotto e `docs/OPEN_QUESTIONS.md`
Q14 per l'analisi completa di entrambi. Quattro branch separati, nessuno ancora mergiato:
`feature/lvgl` → `feature/lvgl-2-render-engine` → `feature/lvgl-3-project-wizard` →
`feature/lvgl-2b-display-fix` (tip attuale, sul quale si basa questo lavoro). **Il motore LVGL
ora produce output visivo reale, non solo un riepilogo testuale.**

**Verificato dal maintainer di persona** (stesso giorno, in ufficio): ha creato un progetto
reale (`lvgl-01`) con il wizard scegliendo target LVGL, piazzato 8 oggetti (rect, text, 4
button, slider, led) via l'editor normale, e lanciato `sws-lvgl-viewer` contro il proprio
runtime — finestra SDL2 aperta, tutti gli 8 oggetti renderizzati correttamente, nessun crash
lasciandolo girare per diversi secondi. **Due limiti noti confermati e accettati** (lasciati
fuori deliberatamente dallo scope di stanotte, non bug): i widget non rispondono a click/drag
(nessun input device LVGL collegato) e non si aggiornano dal vivo dopo l'apertura (il client
legge solo lo snapshot iniziale dei tag via WS, non resta iscritto ai delta). Il maintainer ha
scelto di **fermarsi qui per ora** invece di procedere subito su questi due punti — prossimi
passi naturali quando si riprende: aggiornamento live dei tag (rischio contenuto, riusa client
WS esistente) e poi, separatamente, input device per l'interattività (rischio più alto — finora
2 sottosistemi su 2 toccati in questo crate avevano un bug di lifetime, l'input device è
territorio non ancora testato).

**Sessione precedente**: 2026-08-07 (notte, in autonomia) — proseguito il filone motore **LVGL** avviato
in serata (Fase 1: analisi + scaffolding) fino a **Fase 2 (interprete widget) + Fase 3 (wizard
progetto + filtro palette)**, su richiesta esplicita del maintainer di procedere da solo fino al
mattino, un branch per fase per sicurezza. Risultato: interprete `SynopticObject` → widget LVGL
funzionante e verificato end-to-end (rect/text/button/led/slider), wizard di creazione progetto
con scelta target Web/LVGL, palette oggetti filtrata di conseguenza — **ma nessun export
immagine**, bloccato da un bug upstream confermato (non nostro) nel crate `lvgl` 0.6.2. Tre
branch separati: `feature/lvgl` (Fase 1) → `feature/lvgl-2-render-engine` (Fase 2) →
`feature/lvgl-3-project-wizard` (Fase 3).

**Sessione precedente**: 2026-08-06 (notte) — **sessione lunga in autonomia** (il maintainer è andato a
dormire a metà, chiedendo di proseguire i task pianificati e poi di indagare migliorie): T-41
(pagine cancellate/rinominate ora persistono davvero), un fix sistemico al mirror Rust↔TypeScript
(62 campi mancanti su `SynopticObject`), T-42/T-43 (campanella e barra allarmi piazzabili,
**verificati dal maintainer in browser**), T-44/T-45 (DataTable condiviso + Ricette + modalità
tabella su alarm_viewer, verificati solo da me con harness/build+test — **non ancora provati dal
maintainer**), e infine un audit di qualità del codice (due Explore agent) con una serie di fix
mirati (vedi sezioni dedicate sotto). T-46 (rimozione vecchia chrome allarmi) deliberatamente
rimandato — vedi nota su [[project_t46_alarm_chrome_removal]] in memoria: dopo T-46 gli allarmi
diventano per-pagina opt-in, non un fallback globale.

**Da fare alla ripresa**: provare in browser T-44 (Config → Ricette, sort/filtro) e T-45
(alarm_viewer → modalità Tabella) e i fix dell'audit (severità allarmi uniformi, watchdog MQTT
`max_silence_secs` ora in UI sotto Connessione, trasformazione disponibile su lang_button/
lang_selector) — poi, se tutto ok, squash-merge dell'intero branch in main. Rivedere anche
`docs/plans/2026-08-06-audit-widget-e-codice.md` (proposte non implementate: BindableInput
mancante su vari campi, color picker mancante su slider/checkbox/radio, possibile widget
faceplate/setpoint/XY-plot, ecc.) e decidere cosa vale la pena fare.

## 2026-08-07: motore di rendering LVGL — Fase 1 (branch `feature/lvgl`)

Nuova richiesta del maintainer: poter generare l'interfaccia in **LVGL** per target embedded
(disegno diretto su framebuffer/DRM o come client Wayland), come seconda modalità di progetto
scelta alla creazione (Web vs LVGL, con parametri HW se LVGL — in futuro anche ESP32). Sessione
di sola analisi architetturale + fondamenta, su un **ramo di lunga durata separato**
(`feature/lvgl`, non il pattern `feat/T-XX`), con merge periodici da `main` e riunificazione
quando stabile — **non ancora mergiato**, resta isolato finché il motore non ha almeno un MVP
funzionante.

**Analisi** (tre Explore agent in parallelo su docs/architettura generale, frontend `sws-editor`,
backend `sws-runtime`): il motore Rust (`sws-core`/`sws-historian`/`sws-pyscript`/i plugin
protocollo) è già disaccoppiato dal web (nessuna dipendenza da axum); il backend non renderizza
mai nulla, espone solo lo schema `SynopticObject`/`SynopticPage` via REST e stream WS
snapshot+delta (`/ws/tags`, `/ws/alarms`) — tutta l'interpretazione widget-per-widget vive solo
in TypeScript (`SvgCanvas.tsx`). `sws-kiosk` (GTK4+WebKitGTK) è l'unico precedente concettuale
ma è solo un wrapper browser, escluso dal cross-compile Yocto perché il sysroot Pixsys non ha
GTK4/WebKitGTK — è esattamente il gap che LVGL risolverebbe. Verificato anche lato LVGL: v9
supporta ufficialmente fbdev/DRM/Wayland/simulatore SDL2 (`lv_port_linux`), ma il binding Rust
ufficiale (`lvgl` crate, `lv_binding_rust`) risulta fermo a LVGL 8.x — gap tecnico registrato,
non bloccante (vedi `docs/OPEN_QUESTIONS.md` Q14).

**Decisione architetturale** (`docs/adr/0002-lvgl-rendering-engine.md`): il motore LVGL è un
**nuovo binario Rust separato** (`sws-lvgl-viewer`), client WS/REST verso il runtime `sws-web`
esistente — stesso ruolo che ha oggi il browser/`sws-kiosk`. **Nessuna modifica al runtime
esistente** per partire; i protocolli sono già tutti disponibili automaticamente (girano lato
server, indipendenti dal renderer) — il lavoro vero è solo l'interprete di `SynopticObject` in
LVGL, per un sottoinsieme di widget più piccolo di quello web.

**Scaffolding fatto**: nuovo crate `sws-runtime/crates/sws-lvgl-viewer` (dipendenza `lvgl` 0.6,
config vendorizzata, nessuna feature `drivers`/SDL2 ancora, nessuna logica — solo un `main.rs`
placeholder), escluso dal workspace di default (`exclude` in `sws-runtime/Cargo.toml`, stesso
motivo/pattern di `sws-kiosk`: richiede un toolchain C/bindgen non garantito ovunque). Verificato
`cargo check --manifest-path crates/sws-lvgl-viewer/Cargo.toml` verde in isolamento su questo dev
server (libclang via llvm-14 presente; SDL2 dev headers no, ma non ancora necessari con le
feature disabilitate). Il resto del workspace non è stato toccato.

**Deciso col maintainer** (via domande esplicite): l'MVP di Fase 2 punterà prima al **simulatore
SDL2** (iterazione rapida senza hardware, prima di framebuffer/DRM o Wayland reali); l'estensione
del wizard di creazione progetto (scelta target + pre-config area di lavoro/colori per tutti i
progetti) è **rimandata a dopo** una prima demo funzionante del motore, non in questo blocco.

**Nota**: il paragrafo seguente rifletteva il piano a fine Fase 1 (spike SDL2). Il piano è
cambiato in corsa nella sessione notturna successiva (vedi sezione dedicata sotto) — niente
SDL2 (bloccato: `libsdl2-dev` non installabile senza sudo su questo dev server, e comunque
inutile senza schermo), e l'ordine Fase 2 → Fase 3 è stato eseguito per intero. Lasciato per
memoria storica di come è stato pianificato inizialmente.

~~Da fare alla ripresa: Fase 2 — spike sul simulatore SDL2 (richiede `libsdl2-dev`, non
installato su questo dev server, da valutare se installarlo qui o solo sulla macchina di casa),
client WS/REST verso un'istanza `sws-runtime` reale, porting minimo di `resolveObject()`/soglie
da `SvgCanvas.tsx`, primi tipi widget (`rect`, `text`, `button`, `led`, `slider`). Roadmap
completa (Fasi 3-6: wizard, backend HW reali, container podman multi-arch, ampliamento catalogo,
ESP32) in `docs/plans/2026-08-07-lvgl-engine.md`.~~

---

## 2026-08-08 (mattina): motore LVGL — sblocco redraw (branch `feature/lvgl-2b-display-fix`)

Il maintainer ha rivisto il lavoro della sessione notturna (Fase 1-3, sotto) e ha risposto a
quattro domande di chiarimento (bug fix, metodo di verifica visiva, strategia di riunione branch,
ambito wizard) prima di dare il via libera a procedere. Scelte: shim di registrazione display
(non vendoring del crate `lvgl`), simulatore SDL2 (non export PNG headless — `libsdl2-dev`
installato apposta sul dev server), merge finale non-squash quando maturo, wizard invariato
(target solo su progetti vuoti). Poi: **"implementa ora"**.

**Shim di registrazione display** (`src/lvgl_display.rs`, nuovo modulo): bypassa del tutto
`lvgl::Display::register()`/`DrawBuffer`, usando solo `lvgl-sys` (i bindgen raw) + storage
`'static` ottenuto con `Box::leak` — 100% Rust sicuro, nessun file C separato (stesso identico
effetto del "shim C" concordato, ottenuto in un solo linguaggio). Flush callback
(`unsafe extern "C" fn`) scrive i pixel RGB565→RGB888 in un frame buffer globale
(`OnceLock<Mutex<Vec<u8>>>`), letto poi dal loop SDL2. `interpret_page()` in `lvgl_render.rs`
adattata per usare questo modulo invece di `Display::register`, e ora ritorna anche gli `Style`
creati (devono restare vivi per tutta la finestra, non solo per la singola chiamata).

**Secondo bug scoperto e risolto**: appena collegata la finestra SDL2, nuovo crash — stavolta
dentro `sdl2::init()` → `libSDL2.so` → `libdbus-1.so` → `lvgl_sys::string_impl::strcmp`.
`lvgl-sys` 0.6.2 esporta una propria `strcmp`/`strncmp` (`#[no_mangle]`, incondizionata) pensata
per target senza libc, che su un binario `std` normale **sostituisce quelle di sistema per
l'intero processo**. La sua `strncmp` era scorretta (`slice::from_raw_parts(ptr, n)` prima di
confrontare un byte; `strcmp` la chiama con `n = usize::MAX`) — è bastato che SDL2 (per conto
proprio, via D-Bus) chiamasse la normale `strcmp` di sistema per andarci a sbattere, prima
ancora di toccare il rendering LVGL vero e proprio. Nessuna feature per disattivarlo: vendorizzata
una copia locale di `lvgl-sys` (~21 MB, `sws-lvgl-viewer/vendor/lvgl-sys-0.6.2/`, via
`[patch.crates-io]`) con la sola `strncmp` corretta (scansione byte-per-byte). Analisi completa
di entrambi i bug in `docs/OPEN_QUESTIONS.md` Q14.

**Verificato dal vivo** (dev server, sessione X11 reale su `:0`/seat0 — non serve il PC di casa):
finestra SDL2 800×480 aperta senza crash, ~60fps, contro un runtime `sws-web` reale. Due
screenshot catturati (`import` di ImageMagick, serve l'ID finestra via `xwininfo` — `-window
root` fallisce sotto XWayland): la Page 1 di `demo-items` (sfondo, rettangolo, testo tutti
corretti, resto della pagina tagliato oltre gli 480px come da design) e una pagina "Vetrina"
compatta con tutti e 5 i tipi supportati in una sola schermata — testo, rettangolo verde,
bottone blu, LED (spento, colore corretto), slider, più un secondo testo con formato numerico
e colore statico. Tutto corretto.

**Da fare alla ripresa**: il maintainer testa lui stesso la finestra SDL2 (probabilmente anche
dal PC di casa, non solo dal dev server). Poi, se conferma: decidere quando riunire i quattro
branch (merge non-squash, timing non ancora deciso — vedi memoria `project_lvgl_engine`), e
proseguire verso Fase 4 (backend HW reali: framebuffer/DRM/Wayland su device Yocto) o
ampliamento del catalogo widget (oltre ai 5 attuali).

---

## 2026-08-07 (notte): motore LVGL — Fase 2 (interprete widget) + Fase 3 (wizard progetto)

Continuazione autonoma della sessione serale (Fase 1 sopra), su richiesta esplicita del
maintainer prima di andare a dormire: "prova a portare avanti in autonomia le varie fasi fino a
domani mattina, fai un branch per ogni fase per sicurezza… prova ad arrivare almeno fino a
implementare la possibilità di creare il progetto LVGL dall'IDE e di piazzare i principali
oggetti disponibili e vederli". Traguardo raggiunto, con un limite onesto documentato sotto
(niente export immagine).

### Fase 2 — `feature/lvgl-2-render-engine` (da `feature/lvgl`)

**Adattamento imposto dall'ambiente**: niente simulatore SDL2 come pianificato a fine Fase 1 —
`libsdl2-dev` non è installabile qui (`sudo` è in `deny` esplicito in `.claude/settings.json`,
fallisce subito senza prompt) e comunque un simulatore interattivo non sarebbe visibile su
questo dev server headless. Il motore renderizza quindi solo widget (nessun canale di
verifica visiva) — vedi il bug sotto sul perché nemmeno il redraw in memoria funziona ancora.

**Implementato**: `sws-lvgl-viewer` è ora un client REST/WS reale — `client.rs` fa `GET
/api/synoptics/:name` (percorso via `Url::path_segments_mut()`, gestisce nomi pagina con spazi)
e legge il primo snapshot di `/ws/tags`; `tls.rs` fornisce un `rustls::ClientConfig` che accetta
il certificato self-signed del runtime (stesso compromesso del browser al primo accesso, scope
volutamente ristretto a runtime locali/dev espliciti). `model.rs` è un sottoinsieme minimo e
tollerante di `SynopticObject`/`SynopticPage` (`#[serde(default)]` ovunque — ignora silenziosamente
i ~130 campi che questo motore non conosce ancora). `lvgl_render.rs` è l'interprete vero e
proprio: porta da `SvgCanvas.tsx` la logica di `resolveObject()`/`thresholdColor()`/`formatValue()`/
`isVisible()` per i 5 tipi widget MVP (rect→`Obj` con style bg color, text→`Label` con soglie
colore, button→`Btn`+`Label` figlio, led→`Led` con `on()`/`off()` + colore in base a on_value/
qualità tag, slider→`Slider` con range/valore via `lv_bar_set_range`/`set_value` raw FFI, perché
`lv_slider_t` è internamente uno specializzato `lv_bar_t` e il binding safe non espone setter
dedicati per slider). Riuso diretto di `sws_core::{TagValue,TagQuality}` (path-dependency su
`sws-core`) invece di una terza copia dei tipi wire.

**Bug bloccante confermato, non nostro** (analisi completa in `docs/OPEN_QUESTIONS.md` Q14):
`lvgl::Display::register()` — e identicamente `register_raw()` — tengono un puntatore verso un
`DrawBuffer` che vive in una variabile locale alla funzione stessa, distrutta al ritorno. LVGL
resta con un dangling pointer; il primo `task_handler()` segfaulta in modo sistematico e
deterministico (confermato via `coredumpctl debug` + backtrace GDB completo: `lv_color_fill`
chiamato con puntatore spazzatura e un conteggio pixel di ~4 miliardi). Riprodotto identico a
qualunque risoluzione, con o senza thread dedicato, con la config vendorizzata o quella reale
degli esempi ufficiali, persino chiamando `task_handler()` immediatamente dopo `register()` senza
codice intermedio — non è un errore di configurazione nostro, è strutturale nel crate (che lo
ammette: `DrawBuffer::get_ptr()` ha un commento `// TODO: needs to be 'static somehow`).
`sws-lvgl-viewer` quindi **crea correttamente tutti i widget ma non tenta il redraw**: si ferma
subito dopo, riportando un riepilogo testuale di cosa è stato interpretato. Verificato dal vivo
contro un'istanza `sws-runtime` isolata con `examples/templates/demo-items` "Page 1": 11/18
oggetti supportati creati correttamente (i restanti 7 — navbutton/ellipse/trend/gauge/symbol/
lang_selector — correttamente segnalati come non ancora supportati), **`EXIT: 0`, nessun crash**.

### Fase 3 — `feature/lvgl-3-project-wizard` (da `feature/lvgl-2-render-engine`)

**`Project::target`** (nuovo campo in `sws-core/src/project.rs`, `Option<ProjectTarget>` con
`kind: web | lvgl_framebuffer | lvgl_wayland` + `framebuffer_device` opzionale; `None` = web,
comportamento invariato per ogni progetto esistente) esposto in `ProjectInfo` lato TypeScript.
`CreateProjectRequest` (`sws-web/src/projects.rs`) accetta ora un `target` opzionale, applicato
solo ai progetti vuoti (i template restano sempre web per ora — non sono stati pensati per
LVGL). **Wizard** (`WelcomeScreen.tsx` → `NewProjectModal`, tab "vuoto"): select Web/LVGL-
Framebuffer/LVGL-Wayland, con campo device framebuffer quando pertinente. **Palette filtrata**
(`LeftPanel.tsx`): per progetti LVGL, `PALETTE_GROUPS` mostra solo `rect`/`text`/`button`/`led`/
`slider` (stesso elenco di `SUPPORTED_TYPES` nel motore Rust — tenerli allineati quando il
catalogo cresce), gruppi rimasti vuoti nascosti invece che mostrati senza contenuto.

**Verificato end-to-end** contro un'istanza `sws-runtime` isolata: progetto creato via
`POST /api/projects` con `target: {kind: "lvgl_framebuffer", framebuffer_device: "/dev/fb0"}`
(stessa chiamata che fa il wizard), verificato persistito via `GET /api/project`; 5 widget
piazzati via `PUT /api/synoptics/:name` (stessa API della canvas dell'editor); `sws-lvgl-viewer`
li ha interpretati tutti e cinque correttamente. `cargo check --workspace` e `pnpm build`
entrambi verdi.

**Da fare alla ripresa**: il maintainer testa/valuta i tre branch (rollback libero se qualcosa
non convince — nessuno è mergiato). Se si conferma la via, sbloccare l'export immagine è il
passo successivo: tre opzioni valutate in Q14 (vendorizzare un fix minimo del crate `lvgl`,
scrivere uno shim C che bypassa il modulo `Display` difettoso usando solo `lvgl-sys` raw, o
cambiare binding — es. `rlvgl`, reimplementazione Rust-nativa trovata durante la ricerca
iniziale). Nessuna scelta fatta stanotte: rischio giudicato troppo alto per procedere senza
supervisione. Poi: Fase 4 (backend HW reali, richiede hardware/schermo reale — fuori portata di
questo dev server headless), Fase 5 (container podman multi-arch per `sws-lvgl-viewer`).

---

## 2026-08-06 (notte): T-41…T-45 + audit qualità codice (branch `fix/T-41-page-delete-persist`)

Sessione partita dai pulsanti pan sul Trend compatto (poi isolati temporaneamente sul branch
`feat/trend-compact-pan` e in seguito riconciliati col drag-to-zoom di T-48, commit `1824a7e`),
proseguita con un blackout elettrico a metà (nessuna perdita — tutto il lavoro già scritto su
disco, solo un `cargo build` da rifare) e conclusa in autonomia notturna su richiesta esplicita
del maintainer.

**T-41 — bugfix prioritario**: `deletePage`/`renamePage` erano puramente in-memory nello store;
`saveAll()` faceva solo upsert; non esisteva `DELETE /api/synoptics/:name` (a differenza di
faceplates/recipes, che ce l'hanno già). Il file della pagina "cancellata" restava orfano su
disco e ricompariva a ogni riapertura progetto. Aggiunta la route, `api.deleteSynoptic` (tollera
un 404 — `save_synoptic` pulisce già da solo il file di un rename per `id`, quindi una delete in
parallelo può trovarlo già sparito), e `persistedPageNames` nello store per far chiamare
`deleteSynoptic` su ogni nome sparito dall'ultimo caricamento. Verificato dal vivo con
un'istanza isolata: delete + riavvio completo del processo, doppia delete idempotente, contenuto
dello zip di deploy. Rimossi anche gli orfani reali già presenti su Sandokan (`Page 2.yaml`,
`Sandokan (copia).yaml`, confermato dal maintainer come scarti, in entrambe le copie del
progetto).

**Fix sistemico — mirror Rust↔TypeScript**: scoperto per caso debuggando perché lo stile
per-traccia del Trend (T-47) non persisteva — `SynopticObject` in `sws-web/src/synoptic.rs` è
uno specchio manuale del tipo TypeScript, e un campo non dichiarato lì sparisce silenziosamente
a ogni save/reload (serde ignora i campi sconosciuti). Un confronto sistematico (script ad-hoc)
ha trovato **62 campi mancanti**, non solo nel Trend: `alarm_viewer` (tutti e 8 i suoi campi),
`sparkline`, `pipe`/connettore (waypoints e routing inclusi), `bar_chart`, `pie_chart`,
`faceplate` instance, `lang_selector` — tutti rotti allo stesso modo da prima di questa sessione.
Aggiunti tutti (tipizzati dove banale, `Option<Value>` generico per gli array di oggetti
annidati, stesso pattern di `options`/`table_rows`). Verificato dal vivo con un'istanza isolata:
impostati campi di alarm_viewer/sparkline/pipe via PUT, riavviato il processo, confermato che
sopravvivono. Un secondo giro dello stesso script dopo T-42/T-43 (che aggiungono `alarm_bell`/
`alarm_banner`) ha confermato 0 campi mancanti anche lì — mirrorati da subito, non dopo essere
scoperti rotti.

**T-42/T-43 — allarmi piazzabili, verificati dal maintainer in browser**: nuovi oggetti SCADA
`alarm_bell` (campanella, dropdown attivi/storico/ack/shelve) e `alarm_banner` (barra, blink/ACK/
priorità ISA-18.2), estraendo la logica condivisa in `AlarmBellPanel.tsx` e riusando
`AlarmBanner.tsx` esistente. Nessuna migrazione automatica: la chrome fissa (campanella in alto a
destra, barra in cima) resta finché non viene rimossa manualmente in **T-46** — deliberatamente
rimandato, richiede sia T-42+T-43 fatti sia una conferma page-by-page che ogni pagina che deve
mostrare allarmi abbia davvero l'oggetto piazzato (nota completa in memoria,
`project_t46_alarm_chrome_removal`).

**T-44/T-45 — non ancora provati dal maintainer**: componente `DataTable` condiviso (sort per
colonna + filtro, nessuna virtualizzazione — dataset piccoli tipo allarmi/ricette), sostituisce
la lista Ricette in ConfigView; `alarm_viewer` guadagna una terza modalità "Tabella" che riusa lo
stesso componente. Verificati con harness Playwright isolato (sort/filtro funzionanti) e
build/test, ma non ancora nel browser reale del maintainer.

**Audit di qualità del codice** (su richiesta esplicita, due Explore agent in parallelo — uno sul
catalogo widget, uno sul codice): trovati e sistemati subito (bassa rischiosità, stesso pattern
di verifica di tutta la sessione) altri due gap dello stesso tipo di bug (`SynopticPage.
background_dark` mancante da Rust; `MqttConfig.max_silence_secs` mai esposto in UI — ora
impostabile in Config → Protocolli → sorgente MQTT → Connessione, chiude un loose end della
sessione precedente su Sandokan), colori severità allarme unificati (`alarm_viewer` usava un hex
diverso da bell/banner per "Warning"), filtro severità aggiunto ad `alarm_viewer` (aveva il campo
dati ma nessuna UI), completato `getXDomain()` in `TrendCanvas.tsx` (T-48 lo usava solo per il
drag-to-zoom, non per polling/draw/CSV — stessa classe di bug del Trend già vista e sistemata
solo a metà), deduplicata la palette colori fra Trend compatto ed espanso, corretto
`SUPPORTS_TRANSFORM` (mancavano `lang_button`/`lang_selector`), nascosto un pannello UI morto
(eventi su `grid`), rimosso codice morto (`_force_login_ok_used`, modulo `sws-auth::session` mai
implementato). Il resto dei findings (BindableInput mancante su vari campi, color picker mancante
su slider/checkbox/radio, widget `faceplate` non piazzabile da UI, possibili nuovi tipi widget) è
**documentato, non implementato** — vedi `docs/plans/2026-08-06-audit-widget-e-codice.md`.

`cargo test -p sws-web -p sws-auth -p sws-core -p sws-plugin-mqtt -p sws-runtime`: 98/98 verdi.
`pnpm build`/`test`: verdi in ogni punto della sessione. `cargo build` rifatto ogni volta che
serviva un binario aggiornato per una verifica dal vivo (non solo `cargo check`).

## 2026-08-06: il boot con `--project` ignorava Random Client ID (e ignorerebbe qualunque cosa) — unificato con `open_project`

Il maintainer ha notato che i grafici di Sandokan sul device reale (`tc620-a-p3-c6-07aff9.local`)
si erano fermati verso le 7:30, pur non avendo toccato il device — e soprattutto: **il progetto
aveva Random Client ID attivo, mai disattivato**, eppure il log mostrava il client_id letterale
(`sws-sandokan-ide`, non `<id>-sws-sandokan-ide`).

**Ricostruito con i log reali**: il container era stato ricreato ieri sera alle 23:16 (un
redeploy, non toccato da nessuno stamattina). Al boot successivo il client_id era tornato
letterale — mentre il file `project.yaml` sul device ha davvero `random_client_id: enabled: true`
(un mio grep troncato in una risposta precedente aveva fatto credere il contrario). Stamattina i
miei stessi test sul flash della grafica (sessione precedente) hanno aperto Sandokan più volte
sull'editor locale con lo stesso client_id letterale, verso lo stesso broker reale — collidendo
col device, ora anch'esso letterale per lo stesso motivo. Da lì i kick delle 7:29-7:34, poi il
device è cascato nel bug del `poll()` sospeso (non ancora distribuito), silenzio da allora.

**Causa radice**: `sws-runtime/src/main.rs` ha un secondo percorso di caricamento progetto — il
boot con `--project`, usato a ogni riavvio del processo/container — che **ricopiava a mano** la
logica di `open_project` (`sws-web/src/projects.rs`) invece di riusarla. Un commento già nel
codice, scritto in una sessione precedente per un problema analogo (storico/notifiche dimenticati
allo stesso modo), lo diceva esplicitamente. Quando ho aggiunto `resolve_mqtt_client_ids` per il
fix di Random Client ID, l'ho collegato solo dentro `open_project` — non in questo secondo
percorso. È la **terza volta** che questa duplicazione perde un pezzo.

**Deciso col maintainer**: niente più toppe — eliminare la duplicazione.

**Fatto** (branch `fix/unify-project-boot-open-path`):
- Nuova funzione condivisa `apply_loaded_project` (`sws-web/src/projects.rs`): seed dei tag
  derivati, `populate_tags`, registry datastore, swap storico, carico allarmi (+ wiring del
  journal), risoluzione client_id MQTT, `supervisor.reload`, registro funzioni. Non avvia
  notifiche/script globali (serve un `AppState` che al boot non esiste ancora) — ritorna
  `(notifications, global_scripts)` perché il chiamante li avvii quando può.
- `open_project` e il boot in `main.rs` ora chiamano entrambi questa funzione, passando i propri
  pezzi (`AppState` nel primo caso, le variabili individuali costruite prima di `AppState` nel
  secondo). `config_dir`/`instance_id` spostati più in alto in `main.rs` — servono già al boot,
  non solo più avanti per `router::build`.
- Un futuro passo di apertura progetto dimenticato in un solo posto non è più possibile: c'è un
  solo posto.

**Verificato dal vivo** (non solo `cargo check`/`test`): un'istanza di prova lanciata con
`--project` puntato alla copia locale di Sandokan (Random Client ID attivo, `position: suffix`)
— **prima** del fix: log mostra client_id letterale al boot (bug riprodotto). Trovato anche un
errore mio nella prima verifica: `cargo check`/`cargo test` non ricompilano il binario eseguibile
principale (`target/debug/sws-runtime`) di un crate `bin`, serve `cargo build` — il primo giro di
verifica testava ancora il binario vecchio. **Dopo** `cargo build` e il fix: log mostra
`"client_id":"sws-sandokan-ide-69dcbe"` — risolto correttamente anche al boot, non solo aprendo
da IDE. `cargo test -p sws-web -p sws-core -p sws-plugin-mqtt -p sws-runtime` 58+9 verdi.

**Non ancora fatto**: redeploy sul device reale (questa sessione ha solo diagnosticato +
sistemato il codice, non toccato il device). Il maintainer aveva messo in pausa qualunque
redeploy finché non si capiva la causa — ora chiarita, il redeploy può includere anche questo fix
oltre a reconnect/staleness e client_id.

## 2026-08-06: flash della grafica (e degli allarmi) del progetto precedente al cambio progetto

Il maintainer ha segnalato: aprendo Sandokan, chiudendo il progetto e creandone uno vuoto, per
un istante vede ancora la grafica del progetto precedente. Ha anche sollevato il sospetto che il
nuovo progetto "si portasse dietro" la sorgente MQTT di Sandokan (stesso client_id) — **escluso
con i timestamp esatti del log reale** (`~/.run-editor/logs/runtime-2026-08-06.jsonl`): l'ultima
riga MQTT di Sandokan e la riga `"stopping source task"` sono a 14 ms di distanza, e nessuna riga
MQTT compare più in nessuna delle aperture/chiusure successive di "vuoto". Il log MQTT che il
maintainer vedeva era semplicemente quello di **Sandokan rimasto aperto dal giorno prima** sullo
stesso processo `start_editor.sh` (mai chiuso esplicitamente dopo i miei test di verifica) —
comportamento corretto, non un bug.

**Il flash grafico invece era reale.** Causa: lo store Zustand dell'IDE (`store/index.ts`) è un
singleton che sopravvive allo smontaggio dei componenti — nessuna azione azzerava
`pages`/`project`/`customSymbols`/`faceplates` alla chiusura del progetto (`App.tsx`
`executeClose` faceva solo `resetDirty/closeProject/clearAuth/setNoActiveProject`). All'apertura
del progetto successivo, `onProjectOpened` chiama `setNoActiveProject(false)` **in modo
sincrono**, rimontando subito l'`EditorShell` — che legge `pages` direttamente dallo store senza
nessuna guardia "progetto non ancora caricato". I dati veri arrivano solo dopo, in modo
asincrono (`api.getProject()`/`api.listSynoptics()`). La finestra fra il remount sincrono e la
risoluzione asincrona era il flash osservato.

**Fatto** (branch `fix/project-switch-stale-canvas-flash`):
- Nuova azione `resetProjectState()` nello store (`store/index.ts`), che riusa `setPages([], "")`
  già esistente e in più azzera `project`, `projectLoadError`, `customSymbols`, `faceplates`.
- Chiamata in `App.tsx`: in `executeClose` (igiene alla chiusura) e — il fix che conta —
  **prima** di `setNoActiveProject(false)` dentro `onProjectOpened`, così l'`EditorShell` si
  rimonta già vuoto invece che con lo stato del progetto precedente.
- **Trovato durante la verifica automatizzata** (non a tavolino): il banner allarmi mostrava
  anch'esso per un istante l'allarme del progetto precedente (`alarms` è un campo separato dello
  store, non toccato dal fix iniziale). Esteso `resetProjectState()` per azzerare anche `alarms`.

**Verificato con un test end-to-end automatizzato**, non solo a occhio: Playwright headless
(pacchetto installato al volo nello scratchpad, browser Chromium già in cache ma di revisione
diversa — lanciato puntando esplicitamente al binario in `~/.cache/ms-playwright/chromium-1223/`)
guida l'IDE reale su `:8460` — apre Sandokan, conferma il caricamento (`"Nebulizzatore"` nel
DOM), chiude, crea un progetto vuoto, e campiona il testo della pagina ogni ~60ms per ~900ms
durante la transizione. **Prima** del fix sugli allarmi: rilevata un'occorrenza reale del banner
"sandokan_power_off" durante la transizione (screenshot salvato). **Dopo** entrambi i fix: zero
occorrenze su 15 campionamenti, ripetuto due volte. `pnpm build`/`pnpm test` (32/32) verdi.

**Non ancora provato**: sul device reale (questo fix è solo frontend, quindi non richiede
rebuild del binario Rust — basta la nuova SPA nell'immagine al prossimo giro di build/deploy).

## 2026-08-05 (sera): sessione MQTT bloccata per sempre senza errore — timeout su poll() + staleness

Il maintainer ha segnalato che il problema MQTT "sembra esserci ancora" quando apre la pagina
viewer (`:8443`) dal browser mentre il runtime gira sul device — sua ipotesi, non certezza.
Chiesto esplicitamente un audit approfondito di tutta l'implementazione MQTT, raccogliendo tutti
i dubbi prima di agire.

**Ipotesi del maintainer esclusa con certezza** (tre indagini in parallelo, codice alla mano):
nessun percorso di codice collega l'apertura/moltiplicazione di sessioni viewer (`:8443`,
`/ws/tags`) né eventi di login/sessione/`/api/remote/connect` a `SourceSupervisor` o
`MqttConfig`. Il polling è strutturalmente indipendente dal numero di client (broadcast puro,
nessun contatore, nessun hook on-connect) — verificato riga per riga.

**Cosa è successo davvero**, ricostruito dal log del device (`tc620-a-p3-c6-07aff9.local`):
tra le 20:18 e le 20:20 una serie di redeploy ravvicinati (il maintainer stava configurando
"Random Client ID") causa normali cicli di riconnessione. Poi, dalle 20:20:11 in poi, **silenzio
totale nel log per oltre 95 minuti** (verificato più volte nell'arco della sessione, mai
auto-ripreso), tag congelate a `quality: "Good"`. Il maintainer conferma che il dispositivo
Zigbee era attivo in quella finestra: non era "nessun dato legittimo", era una sessione bloccata
per davvero — anche col client_id ormai reso univoco dal fix precedente (quindi non è una
recidiva della collisione di client_id, è un problema diverso).

**Causa individuata leggendo `rumqttc` 0.24.0**: il keep-alive interno dovrebbe far fallire
`eventloop.poll()` entro ~2× `keep_alive_secs` in caso di connessione morta. Il fix di martedì
però reagisce solo a un `Err` *restituito* — se quella singola chiamata resta sospesa per sempre
(stato interno incoerente dopo la sequenza di riconnessioni ravvicinate), il retry-con-backoff
non scatta mai, perché `run_session` non torna. Combacia esattamente: l'ultima riga di log è
"MQTT subscribing" (subito prima del loop `poll()`), poi nulla.

**Gap secondario, confermato assente in ogni plugin**: nessun meccanismo verifica "sto
ricevendo dati aggiornati?" indipendentemente da un errore di libreria.

**Deciso col maintainer**: chiudere entrambi.

**Fatto** (branch `fix/mqtt-poll-timeout-staleness`, sopra `feat/mqtt-client-id-management`):
- `sws-plugin-mqtt/src/lib.rs` + `sparkplug.rs`: `eventloop.poll()` avvolto in
  `tokio::time::timeout` (soglia proporzionale a `keep_alive_secs`, minimo 30s). Se scade, viene
  trattato come sessione morta e rientra nel retry-con-backoff già esistente — nessuna nuova
  logica di retry, solo il buco che lo bypassava chiuso.
- `sws-core/src/project.rs`: nuovo `MqttConfig.max_silence_secs: Option<u64>` — opzionale,
  **disattivo di default** (a differenza di Random Client ID: un valore indovinato rischierebbe
  di riavviare sorgenti legittimamente silenziose, dato che MQTT è push-based senza un
  intervallo naturale).
- `sws-web/src/source_supervisor.rs`: watchdog esteso con `restart_stale_sources` — per ogni
  sorgente con `max_silence` impostato, calcola il `timestamp_ms` più recente fra i suoi
  `owned_tags` e la riavvia se supera la soglia, anche se il task non è mai andato in errore.
  Una sorgente senza ancora nessun dato (appena avviata) viene lasciata stare invece di essere
  trattata come stale, per non innescare un loop di riavvii durante una connessione iniziale
  lenta. Meccanismo agnostico rispetto al tipo di sorgente (lavora solo su `owned_tags` + una
  soglia) — per ora solo MQTT espone il campo; estendere agli altri 7 tipi è un lavoro a parte,
  lasciato per una sessione futura.

**Verificato**: `cargo check --workspace` pulito, `cargo test -p sws-web -p sws-core -p
sws-plugin-mqtt` 58/58 verdi (3 nuovi test su `most_recent_update`, nessuna regressione).
**Non verificato dal vivo end-to-end**: un broker locale per riprodurre "connessione viva ma
silenziosa" non è stato possibile allestirlo su questo dev server (mosquitto bloccato da
AppArmor per file fuori da `/etc/mosquitto/*`, il broker reale non è raggiungibile da qui). Da
verificare sul device reale dopo rebuild+redeploy: impostare `max_silence_secs` su Sandokan e
controllare che un futuro blocco silenzioso venga recuperato entro un tick del watchdog (~30s)
invece di restare bloccato per ore.

## 2026-08-05: collisione di client_id MQTT fra IDE e device — Random mode + override per-device

Il maintainer è tornato dopo l'incidente di martedì (fix reconnect+watchdog) segnalando che il
device `tc620-a-p3-c6-07aff9.local` aveva "perso di nuovo il broker MQTT". **Verificato dal vivo
che non era un regressione del fix**: il container era `healthy` da 22h, il retry-con-backoff
ritentava puntualmente ogni 5s esattamente come progettato, e il broker esterno risultava
irraggiungibile *dal device* — ma il maintainer, connesso con MQTT Explorer dallo stesso PC,
raggiungeva lo stesso broker senza problemi. Il broker era su, non era un problema di rete.

**Causa reale**: `client_id: sws-sandokan-ide` in `project.yaml` — letterale, quindi identico su
ogni istanza che apre il progetto. Sul dev server, alle 15:41 (un minuto prima che il device
iniziasse a saltare) era stata avviata una copia locale dello stesso progetto Sandokan
nell'IDE locale (`start_editor.sh`, porta 8460), stesso `client_id` verso lo stesso broker. Per
specifica MQTT il broker disconnette la sessione più vecchia quando l'altra si ripresenta col
suo client_id — e col retry-con-backoff di martedì **entrambe le parti** ora ritentano ogni 5s,
quindi il conflitto si perpetua invece di risolversi da solo dopo un kick. Aggravante: il default
quando il campo è vuoto è `"sws-runtime"` fisso (`sws-core/src/project.rs`) — chiunque non lo
imposti esplicitamente collide comunque, non solo in questo caso specifico.

**Deciso col maintainer** (in chat, con più giri di `AskUserQuestion` sui dettagli implementativi
prima di scrivere codice): due meccanismi alternativi, non sovrapponibili, entrambi per singola
sorgente MQTT:

1. **"Random Client ID"**: ogni istanza — IDE compresa — incolla al `client_id` configurato un
   id persistente e univoco (`config_dir/instance_id`, generato una sola volta, stesso pattern
   già usato per il certificato TLS — non rigenerato a ogni riavvio). Nessuna azione manuale
   richiesta; le sorgenti MQTT create da ora in poi nascono con questa modalità già attiva.
2. **Override manuale per-device**: un pulsante "Invia Client ID al dispositivo connesso" nel
   pannello sorgente, per fissare un valore esatto su un device specifico (es. per farlo
   combaciare con una ACL del broker). Persistito **fuori da `project.yaml`**
   (`config_dir/mqtt_client_id_overrides.yaml` sul device), così un redeploy del progetto non lo
   cancella.

**Fatto** (branch `feat/mqtt-client-id-management`):
- `sws-core/src/project.rs`: nuovo `RandomClientId { enabled, position }` su `MqttConfig`
  (campo opzionale — progetti esistenti senza il campo si comportano esattamente come prima,
  nessuna migrazione).
- `sws-runtime/src/main.rs`: `load_or_create_instance_id`, mirror esatto del pattern
  load-or-generate-and-save del certificato TLS. Nessuna dipendenza nuova (id breve da entropia
  di sistema, non serve robustezza crittografica per distinguere una manciata di istanze).
- `sws-web/src/projects.rs`: `resolve_mqtt_client_ids` — un solo punto, chiamato in
  `open_project` subito prima di `supervisor.reload(...)`, muta il `client_id` effettivo prima
  che arrivi al supervisor (che resta generico, nessuna modifica). Copre automaticamente sia il
  path MQTT plain sia Sparkplug B, senza toccare i plugin. Nuovo endpoint
  `PUT /api/mqtt/source/:id/client-id-override` (rifiuta con 400 se la sorgente ha Random attivo).
- `sws-web/remote.rs`: proxy `POST /api/remote/mqtt-client-id`, stesso schema di
  `remote_push_users`/"Aggiorna utenti sul dispositivo".
- `sws-plugin-mqtt/src/lib.rs` + `sparkplug.rs`: aggiunto `client_id` ai log "MQTT subscribing" /
  "Sparkplug B connected" — prima non c'era modo di verificare da log quale id stesse usando
  un'istanza, dettaglio che è servito subito in fase di verifica.
- Frontend: `MqttRandomClientIdSection` in `ConfigView.tsx` (toggle + posizione + pulsante invio,
  visibile solo con Random disattivo e device connesso), nuove sorgenti create con Random attivo
  di default (`emptyMqtt()`).

**Verificato dal vivo** (non solo `cargo check`/`pnpm build`), usando le due istanze locali già
presenti su questo dev server come "IDE + secondo device simulato" (`start_editor.sh` porta 8460
+ `--instance 2` temporanea su 8462, poi rimossa):
- Retrocompatibilità: `project.yaml` di Sandokan invariato (nessun `random_client_id`) →
  `client_id` risolto identico al letterale.
- Random mode: stesso progetto aperto su due istanze → `sws-sandokan-ide-1778ef` (istanza 1) vs
  `sws-sandokan-ide-2a4494` (istanza 2) — stessa etichetta riconoscibile, id diversi, **esattamente
  lo scenario dell'incidente, risolto senza alcuna azione manuale**.
- Override manuale: applicato via `curl`, effetto immediato in log, **sopravvive a
  chiusura+riapertura del progetto** (persistito nel file separato, non nello stato in memoria).
- Conflitto: con Random attivo, un override rimasto nel file viene ignorato (non
  applicato) e l'endpoint rifiuta un nuovo tentativo con 400.
- `cargo check --workspace`, `cargo test -p sws-web -p sws-core -p sws-plugin-mqtt` (54 test
  sws-web, nessuna regressione), `pnpm build`, `pnpm test` (32/32) verdi.

**Non ancora provato**: sul device reale (serve rebuild+redeploy del container, non fatto in
questa sessione — la verifica sopra è stata interamente sul dev server). Il pulsante "Invia
Client ID al dispositivo connesso" è stato verificato lato backend via `curl` diretto
all'endpoint device-side, non attraverso il flusso UI completo IDE→proxy→device (richiede un
device reale connesso, non riproducibile qui).

## 2026-08-03: sorgente MQTT morta per sempre dopo la caduta del broker — reconnect + watchdog

Il maintainer ha segnalato: progetto **Sandokan** su device arm64 in container, "se chiudo l'IDE
il database e i grafici smettono di funzionare". Verificato dal vivo via SSH sul device
(`tc620-a-p3-c6-07aff9.local`, chiavi già disponibili sul dev server):

- Il container era `Up 22h (healthy)` — il processo runtime non si era mai fermato.
- `GET /api/tags` mostrava tutte le tag di Sandokan con `quality: "Good"` ma valori e
  `timestamp_ms` **fermi a 10 ore prima**, esattamente l'istante dell'ultima riga di log —
  dopo la quale il journal era **completamente silenzioso**, nessun warning nemmeno uno.
- Il broker MQTT esterno (`192.168.1.6:1883`) risultava irraggiungibile al momento del
  controllo (test TCP diretto fallito) ed è **indipendente dal PC/IDE del maintainer**
  (confermato da lui: non si spegne insieme all'IDE).

**Causa reale, trovata nel codice, non un problema di rete che si aggiusta da solo**:
`sws-plugin-mqtt/src/lib.rs` (path MQTT "plain", quello usato da Sandokan) non aveva **nessun
loop di riconnessione** — alla prima sessione caduta il task moriva per sempre. Il commento di
modulo prometteva "reconnect on session error with 5s backoff", ma il pattern vero esisteva già
solo nel modulo gemello `sparkplug.rs` (`run_sparkplug`, loop con backoff 5s). In più,
`source_supervisor.rs` controllava i task morti **solo** dentro `reload()`, invocato solo da
un'azione utente esplicita (apri/chiudi progetto, salva config) — nessun watchdog periodico.
Combinati, questo spiega perfettamente la segnalazione: l'unico modo *attuale* per far
ripartire una sorgente MQTT caduta era riaprire il progetto dall'IDE (si vede proprio la
sequenza `stopping source task` → `starting MQTT task` nel log di un redeploy), quindi "IDE
chiuso" coincideva sempre con "dati fermi" — non per una dipendenza reale dal client, ma perché
riaprire da IDE era l'unico trigger di restart esistente.

**Fatto** (branch `fix/mqtt-reconnect-watchdog`):
- `sws-plugin-mqtt/src/lib.rs`: il path plain ora fa retry-con-backoff 5s, mirror esatto di
  `sparkplug.rs::run_sparkplug`.
- `sws-web/src/source_supervisor.rs`: nuovo watchdog periodico (ogni 30s) che rileva e rilancia
  qualunque sorgente il cui task sia terminato da solo — generico per tutti gli 8 tipi
  (Modbus TCP/RTU, MQTT, OPC-UA client/server, HomeAssistant, S7, EnIP), non solo MQTT. Aggiunto
  il campo `def: SourceDef` a `RunningSource` per permettere il rilancio senza richiedere la
  definizione dall'esterno.

**Verificato**: `cargo check --workspace` verde, `cargo test -p sws-plugin-mqtt -p sws-web`
54/54 verdi (nessuna regressione). **Non verificato dal vivo con un broker reale**: un test
manuale con `mosquitto` locale è stato tentato ma bloccato dal profilo AppArmor di sistema su
questo dev server (`/etc/apparmor.d/mosquitto` confina il binario a leggere solo
`/etc/mosquitto/*`, non file temporanei) — non ha senso aggirarlo con `sudo` su una macchina
condivisa per un test usa-e-getta. Da verificare sul device reale o con un broker che rispetti
il percorso consentito dal profilo.

## 2026-08-02: build container aarch64 generica, senza SDK — verificata (non ancora installata/testata su device)

Richiesto perché l'SDK Yocto Pixsys non era disponibile: nuovo percorso gemello di
`Containerfile.x86_64`/`.builder` ma per aarch64, senza cross-compile — compila dentro
`Containerfile.aarch64-generic.builder` (stesso `ubuntu:24.04`) sotto **emulazione QEMU**, dato
che build-arch (x86_64) e target-arch (arm64) non coincidono. Nuovi
`scripts/build_container_aarch64_generic.sh`, `parse_image_tarball` esteso con `"aarch64-generic"`,
sezione dedicata in `docs/DEPLOY_CONTAINER_AARCH64.md`.

**Non sostituisce il percorso SDK per un device Pixsys reale** — niente tuning cortex-a35, niente
ABI pinning esatto all'OS Pixsys. Tag/archivio sempre col suffisso `-generic`, mai raggiungibile
dal default automatico di `install-container.sh --pull`.

**Quattro problemi reali trovati testando, non solo temuti** (tutti documentati nei commenti dello
script/Containerfile, non solo qui):
1. **QEMU rootless non funziona**: podman rootless + crun non riesce a eseguire binari arm64 sotto
   emulazione anche a registrazione binfmt corretta ("Exec format error"). Serve `sudo` per l'intero
   script — unico percorso container di questo progetto che lo richiede. Effetto collaterale: gli
   artefatti (`target-container-aarch64-generic/`, `.cargo-container-aarch64-generic/`,
   l'archivio in `dist/`) restano root-owned, serve chown/rm manuale.
2. **DNS non passa sotto `sudo podman`**: la rete bridge di default non passa il resolver
   dell'host, `ports.ubuntu.com`/crates.io irraggiungibili pur risolvendo bene sull'host. Fix:
   `--network host` su tutte le chiamate podman dello script.
3. **`cc` va in SIGSEGV compilando l'assembly ARM NEON+SHA3 di `aws-lc-sys`** (dietro rustls) sotto
   QEMU — limite noto di QEMU con certe estensioni crypto, non un bug SWS. Fix:
   `AWS_LC_SYS_NO_ASM=1`, che però forza il builder CMake di aws-lc-sys (richiede `cmake`
   nell'immagine builder) e che a sua volta accetta `NO_ASM` solo con `opt-level` **esattamente 0**
   (`CARGO_PROFILE_RELEASE_OPT_LEVEL=0`) — binario non ottimizzato, accettabile per verificare che
   il container si installi e parta, non per misurare prestazioni.
4. **`cc1` (il compilatore stesso) è andato in SIGSEGV una volta compilando un file C ordinario**
   (niente assembly, niente crypto) — bug non deterministico di QEMU sotto carico di compilazione
   pesante. Un semplice rilancio dello script (nessuna modifica) è passato la seconda volta.

**Verificato**: build completa (~27 minuti di `cargo build` emulato), `readelf` conferma
`libpython3.12`/`GLIBC_2.39` coerenti con la base, immagine taggata
`sws-runtime:2026.7.0-arm64-generic`, archivio `dist/sws-runtime-2026.7.0-aarch64-generic-image.tar.gz`
(65 MB). `cargo test -p sws-web` 54/54 verde.

**Aggiornamento stesso giorno — quinto problema trovato testando davvero il deploy**: primo
tentativo di installazione fallito perché il device di prova era x86_64, non arm64 — il messaggio
di `install-container.sh` ("immagine senza SPA") è fuorviante in quel caso, il vero problema è un
mismatch di architettura (verificato montando l'immagine con `podman image mount` + `podman
unshare`: la SPA c'era). Nel frattempo, rigenerare l'immagine x86_64 con la versione corrente ha
fatto scoprire che la build aarch64-generic (sudo) aveva lasciato **root-owned anche
`sws-editor/dist/`** (non solo gli artefatti del proprio percorso) — `pnpm build`, lanciato
direttamente sull'host e non in un container, gira come root sotto sudo. Bloccava qualunque
`pnpm build` successivo con `EACCES`. Corretto lo script con un `trap ... EXIT` che restituisce
tutto (`dist/`, `sws-editor/dist/`, i due artefatti di build) a `$SUDO_USER` all'uscita, a
successo o fallimento — non serve più un chown a mano dopo.

**Non ancora fatto**: installazione/avvio reale del container risultante (via `install-container.sh`
o dall'IDE) — il maintainer vuole prima mergiare il codice, poi testare. Se possibile, sarebbe utile
anche un confronto diretto con una build sul device arm64 reale (`tc620-a-p3-c6-07aff9.local`,
citato dal maintainer come alternativa a QEMU) per capire se vale la pena preferirla in futuro,
vista quanto si è rivelata fragile l'emulazione su questo host.

> ## Da dove ripartire (letto per primo al rientro)
>
> - **`main` è la verità**: tutti e sette i branch sono chiusi e riconosciuti da `git branch
>   --merged`. Nessuno ha contenuto che `main` non abbia — verificato con merge a secco uno per uno,
>   non dedotto. Restano in piedi solo come storia, come chiede `CLAUDE.md`.
> - **Release `2026.7.0`**, tag git `v2026.7.0`. Su `ghcr.io/soligolab/sws-runtime` ci sono **entrambe
>   le architetture**, ciascuna con tre tag: `2026.7.0-<arch>`, `<sha>-<arch>` e **`latest-<arch>`**
>   (mobile; `latest-arm64` è il default di `install-container.sh --pull`). Verificati pubblici con
>   token anonimo — HTTP 200 — e con l'architettura letta dal manifest, non dedotta dal nome.
> - **Il WP630 in ufficio ha ancora `0.1.0-dev`**: l'installazione di stamattina precede la release.
>   Per aggiornarlo basta `./install-container.sh --pull` sul dispositivo — prenderà `latest-arm64`,
>   cioè `2026.7.0`, e scaricherà solo i layer cambiati.
> - **Dall'IDE si installa dal registry** (ultima cosa fatta): Configurazione → Runtime → Installa su
>   dispositivo → Container (Podman) ha un selettore di sorgente, Registry di default, più una spunta
>   di installazione pulita. È il rimedio al caso che ha aperto la giornata — un archivio vecchio
>   installato perché era l'unico in `dist/`.
> - **Tre cose non ancora provate su un dispositivo vero**: `install-container.sh --pull` dal registry
>   (sul WP630 si è usato il percorso offline `--image`), **l'installazione pulita con un `--data` non
>   standard** — va guardato dal vivo *quale* directory sparisce — e la pill del container su un
>   runtime realmente in container invece che forzato con `SWS_CONTAINER_ENGINE`. Il percorso
>   **x86_64** invece è chiuso, vedi sotto.
> - **Non esiste più nessun branch**, né in locale né su `origin`: c'è solo `main`. Registro qui
>   sotto.
> - **La release `2026.7.0` non contiene il lavoro di fine giornata** (x86_64 dentro il builder,
>   installazione dal registry): quello sta in `main` sotto `[Unreleased]`. Se serve portarlo su un
>   dispositivo, va tagliata una `2026.7.1` e ripubblicate le immagini — non l'ho fatto di iniziativa
>   perché una release è una decisione, non un passaggio meccanico.

## Verificato 2026-08-01: installazione container dall'IDE, via registry, su x86_64

Il maintainer ha chiesto di provare la procedura "cliente" — installazione container dall'IDE,
sorgente Registry — su questa macchina di sviluppo (x86_64), dopo essersi assicurato che non ci
fossero runtime già attivi (trovato e rimosso un container di test residuo, `0.1.0-dev`, con
`install-container.sh --uninstall`, non solo `podman stop`, perché l'unit systemd lo faceva
ripartire da solo).

**Un problema trovato e risolto, non nel codice**: primo tentativo fallito con `422 Unprocessable
Entity — missing field www_tarball`. Causa: il processo IDE su questa macchina (`.run-editor`,
porta 8460) girava ininterrottamente dal 2026-07-31 mattina, da prima che arrivasse tutto il
lavoro pomeridiano in ufficio (registry, SPA-nell'immagine, `www_tarball` rimosso dal payload) —
il `git pull` aveva aggiornato i sorgenti su disco ma non il binario già caricato in memoria.
Risolto con `./scripts/start_editor.sh` (ricompila e riavvia pulito). **Lezione**: dopo un `git
pull` che porta codice backend, un processo IDE/runtime già in esecuzione va riavviato — i
sorgenti aggiornati sul disco non bastano da soli.

**Dopo il riavvio, self-SSH da IDE verso questa stessa macchina** (sorgente Registry, riferimento
immagine vuoto → l'installer ha dedotto `latest-amd64` da solo, percorso dati custom
`/home/max_xxv/sws_container`): installazione riuscita. Chiude la verifica x86_64 della procedura
"installa dal registry dall'IDE" iniziata il 2026-07-31 (lì provata solo su `main`, non ancora
end-to-end da IDE). Resta com'era il resto della lista dei "non ancora provate": `--pull` sul
WP630 reale (arm64), installazione pulita con `--data` non standard dal vivo, pill del container
non forzata via `SWS_CONTAINER_ENGINE`.

## Fatto 2026-08-01: griglia di posizionamento + sfondo pagina light/dark + impostazioni progetto nel pannello destro

Richiesto dal maintainer il 2026-08-01, implementato lo stesso giorno.

**Griglia** (`SvgCanvas.tsx`, non è mai stata a puntini — è un tratteggio a L, forma non cambiata
perché non richiesto): il gate era solo `gridSize > 0`, senza nessun controllo su edit-mode né
`snapEnabled` — **appariva anche nel viewer/runtime**, bug reale trovato leggendo il codice, non
solo assunto. Corretto in `{onMove && snapEnabled && gridSize > 0 && (...)}` su entrambi i punti
che disegnano il pattern. Il passo era già legato a `gridSize` (la stessa variabile che guida lo
snap reale), nulla da collegare. Colore: nuovo `gridColor` nello store (sessione, non persistito,
come `gridSize`/`snapEnabled` suoi vicini diretti), picker in `EditorToolbar.tsx`.

**Sfondo pagina**: nuovo campo opzionale `background_dark` su `SynopticPage` — `background`
resta il colore "chiaro"/default, nessuna migrazione dei `project.yaml` esistenti (fallback su
`background` quando `background_dark` non è impostato). Risolto al tema attivo via una nuova
`resolvePageBackground()` in `theme.ts`, letta sia in `EditorShell.tsx` sia in `RuntimeView.tsx`.
Nessun hook reattivo "isDark" esisteva prima — non ne serviva uno nuovo, `resolveMode(themeMode)`
già esistente basta, letto ai due call site.

**Impostazioni pagine progetto**: spostate dal modale dietro l'icona ⚙ (poco visibile, nel
pannello sinistro) a una sezione dedicata nel pannello destro, sotto "Proprietà" pagina — non
fusa con quella per non confondere impostazioni di progetto (modalità dimensionamento, rapporto,
home page, hide-chrome) con proprietà della singola pagina. Salvataggio rimasto esplicito e
separato dal salvataggio a batch delle pagine, non per pigrizia: `store/index.ts` dichiara
esplicitamente che i setter `updateProject*` sono deliberatamente non dirty-tracked, per non
rompere il meccanismo `pagesRev`/`savedPagesRev` pensato per le pagine — unificarli avrebbe
rischiato di riprodurre il bug "dirty per sempre" che quel commento descrive.

**Verifica**: `pnpm build`/`pnpm test` (32/32) + `cargo build`/`cargo test -p sws-web` (53/53)
verdi. Nessuna modifica al backend Rust: le pagine viaggiano come YAML generico
(`serde_yaml::Value`), un campo opzionale in più non tocca `project.rs`.

## Registro dei branch chiusi il 2026-07-31

Tutti e sette cancellati, locale **e** `origin`, su richiesta del maintainer. **Non si è perso
niente**, e stavolta la frase è verificabile invece che rassicurante: ogni punta era stata chiusa con
un merge in `main`, e un merge conserva entrambi i genitori — quindi ogni commit resta **raggiungibile
da `main`**. Il `gc` non li può potare e `git log <sha>` funziona per sempre. È una situazione diversa
da quella del 2026-07-29, dove i branch erano entrati con il **solo** squash: là le punte diventavano
irraggiungibili e questo registro era una scialuppa di salvataggio, qui è solo una comodità.

Verificato prima di cancellare con `git merge-base --is-ancestor <branch> main` su tutti e sette.

| branch | punta | merge di chiusura | contenuto |
|---|---|---|---|
| `feat/install-from-registry` | `ae961c7` | `d9478f1` | installazione dal registry dall'IDE, `--pull-only`, installazione pulita |
| `feat/container-registry-procedure` | `e8aa31c` | `704cc86` | registry, SPA nell'immagine, riconciliazione x86_64, discovery, bottone Viewer, slider |
| `chore/disable-legacy-container-publish` | `482481c` | `14a5d4a` | stop alla pubblicazione CI dell'immagine legacy, metadati OCI |
| `chore/e2e-and-docs` | `c656711` | `de1b490` | la suite end-to-end torna eseguibile, regola sui piani condivisi |
| `fix/container-host-network-default` | `d9ee20d` | `2e80c81` | rete host come default dell'installer, `--bridge` per tornare indietro |
| `fix/deploy-preserve-database` | `2a5033d` | `17a227b` | il deploy non cancella il database, gestione database, pulsante utenti |
| `fix/project-write-safety` | `22ae221` | `b0533bd` | un salvataggio non può più azzerare o impoverire `project.yaml` |
| `fix/multiselect-drag` | `d37b738` | `d17a181` | tentativo **rotto** di fix del drag multi-selezione; il fix vero è altrove in `main` |

Per rivedere il lavoro di uno di questi isolato: `git log <punta>`, oppure
`git log <chiusura>^1..<chiusura>^2` per i soli commit che quel branch aggiungeva. Per farlo tornare
un branch vero: `git branch <nome> <punta>`.

**Sessione precedente (2026-07-30, sera 1)**: **tre branch portati in `main` con squash e validati in
un solo giro** (`d0d9110` sicurezza in scrittura del progetto, `9f20d06` deploy/database/utenti,
`631e6d2` impalcatura e2e). Il punto di ritorno è il tag **`pre-merge-2026-07-30`**, anche su
`origin`: da lì si torna con `git reset --hard pre-merge-2026-07-30`.

Scelta del maintainer: le modifiche erano troppe da validare branch per branch, quindi si allinea
`main` e si valida una volta. Il vantaggio pratico è che i sei script di verifica coesistono solo qui.

---

## "Installa su dispositivo" installa dal registry (2026-07-31)

Validato dal maintainer e portato in `main` con squash. Piano in
`docs/plans/2026-07-31-installa-da-registry.md`, copiato lì apposta perché quelli in
`~/.claude/plans/` non viaggiano con git — serve se il lavoro riprende da casa.

Nasce dal caso concreto di stamattina: il WP630 installato dall'IDE scegliendo l'unico archivio
presente, `0.1.0-dev` del giorno prima, con un frontend vecchio a bordo. Il menù non sbagliava —
elencava fedelmente l'unica cosa che c'era. Il percorso registry esisteva dal 30 luglio ma dall'IDE
non era raggiungibile.

**Cosa c'è ora**: un selettore di sorgente — **Registry** (default) o **Archivio locale** — e una
spunta **Installazione pulita**. Dal registry sul dispositivo arrivano solo installer e unit quadlet,
pochi kB invece di 59 MB.

**Le due cose non ovvie**, entrambe emerse leggendo il codice e non progettando a tavolino:

1. **`--uninstall --purge` fa `exit 0`** e non prosegue mai con l'installazione, quindi un'installazione
   pulita è due comandi remoti, non una flag in più.
2. **Il purge deve ripetere `--data`.** Fa `rm -rf "$DATA"` prendendo il valore dalle flag: senza
   ripeterlo avrebbe cancellato il default `/data/user/sws` lasciando intatti i dati veri — distrutti
   i dati sbagliati, mancati quelli giusti. C'è un test dedicato che lo protegge.

**Tua decisione sull'ordine**: nuova flag `--pull-only` che procura l'immagine ed esce, così la
sequenza è `scp → pull-only → purge → install`. Se il pull fallisce non si cancella niente.

**Corretto anche il default cablato**: `install-container.sh` aveva `latest-arm64` fisso, che su
x86_64 scarica un'immagine che non parte. Ora compone il tag da `uname -m` sul dispositivo — che è
l'unico a saperlo, visto che dall'IDE si installa su macchine diverse da quella di sviluppo.

**Verificato**:

- `cargo test -p sws-web` 53 (12 nuovi) + `sws-runtime` 9, `pnpm test` 32/32 (6 nuovi),
  `cargo check --workspace`, `pnpm build`, `bash -n` verdi.
- `install-container.sh` provato per davvero: su questa macchina x86_64 `--pull-only` compone
  `latest-amd64` (prima sarebbe stato `latest-arm64`); con `uname -m` finto a `armv7l` fallisce
  senza toccare niente; un riferimento esplicito continua a vincere; `--uninstall` non pretende
  un'architettura nota.
- **Sequenza dei comandi remoti misurata con un `ssh` finto in `PATH`**, senza bisogno di un
  dispositivo. Registry + pulizia + `--data /opt/sws-data`: due `scp`, poi `--pull-only`, poi
  `--uninstall --purge --data /opt/sws-data`, poi `--pull --data /opt/sws-data`. Da archivio +
  pulizia: tre `scp` e **nessun** `--pull-only`, perché l'immagine è già lì. Registry senza pulizia:
  due `scp` e basta.
- Pannello provato in un browser: selettore, campo riferimento che compare solo in modalità registry,
  conferma che nomina la cartella, `clean_install` nel payload, spunta che si azzera dopo l'uso.
- Compatibilità col payload vecchio verificata con `curl`: solo `image_tarball` + credenziali
  continua a risolvere in modalità archivio, esattamente come prima.

**Non verificato**: niente di tutto questo è stato provato su un dispositivo vero. In particolare il
purge con un `--data` non standard va guardato dal vivo, controllando *quale* directory sparisce.

---

## Container x86_64: stessa base dell'arm64, compilato dentro un builder (2026-07-31, dopo la release)

Richiesta del maintainer prima di partire: *"fare il container a partire dallo stesso sistema usato
per l'immagine arm, credo debian trixie"*. Due correzioni di fatto, entrambe rilevanti:

1. **L'immagine arm64 non è Debian trixie, è `ubuntu:24.04`.**
2. **La base non si sceglie: la impone il binario.** PyO3 gira con `auto-initialize`, quindi il
   binario linka la `libpython` dell'ambiente che lo compila.

Il secondo punto rendeva la richiesta impossibile da soddisfare cambiando una riga. Misurato: lo
**stesso commit** dà `libpython3.11` + `GLIBC_2.34` compilato sul dev server (Debian 12) e
`libpython3.13` sulla macchina di casa (python da pyenv). Due immagini diverse dallo stesso codice, e
nessuna delle due compatibile con `ubuntu:24.04`. Il `FROM debian:trixie-slim` che c'era descriveva
una sola di quelle due macchine.

**Soluzione**: nuovo `deploy/container/Containerfile.x86_64.builder` — `ubuntu:24.04` con toolchain
Rust e `python3-dev` — dentro cui `build_container_x86_64.sh` lancia il `cargo build`. È per x86_64
quello che l'SDK Yocto Pixsys è per aarch64: un ambiente di compilazione fisso. Chiude il **«limite
noto: riproducibilità legata alla macchina di build»** che quel documento si portava dietro, e con
esso la necessità di riverificare a mano la riga `FROM` a ogni postazione.

**La verifica `readelf` è diventata automatica**: lo script confronta la libpython richiesta dal
binario con quella della base e si ferma spiegando che il container *"partirebbe e morirebbe su
`cannot open shared object file`"*. Prima era una riga di documentazione che chiedeva di rifarla a
mano, e il difetto sarebbe emerso al primo `podman run` sul dispositivo.

**Un difetto emerso costruendo le due immagini di seguito**: il tag **locale** non portava
l'architettura, quindi la seconda build si prendeva il nome della prima e
`podman run sws-runtime:2026.7.0` dava quella costruita per ultima. Corretto in entrambi gli script
(`sws-runtime:<versione>-arm64` / `-amd64`). I tag del registry non lo mostravano perché lì il
suffisso c'era già. **Nota su podman 4.x**: `podman untag <ref>` rimuove **tutti** i nomi
dell'immagine, non solo quello indicato — scoperto lasciando l'immagine senza tag.

**Verificato, misurando**: `readelf` sul binario prodotto → `libpython3.12` + `GLIBC_2.39`. Immagine
avviata su porte 8591/8592 per non toccare le istanze di sviluppo → `/health` su entrambe le porte,
`index.html` e bundle serviti dall'immagine, SPA admin, 10 template, RestrictedPython disponibile
senza warning, `podman ps` → `healthy`, Python 3.12.3 dentro il container. Pubblicata come
`2026.7.0-amd64`, `f25c8d5-amd64`, `latest-amd64`: tutte pubbliche, e l'architettura del manifest
letta dal registry dice `amd64 linux`.

**Non provato**: avvio automatico al boot su questa macchina, e `install-container.sh --pull` verso
questa immagine da un host x86_64 pulito.

---

## Release 2026.7.0 (2026-07-31) — prima release con un numero vero

Chiusura della sessione prima delle ferie del maintainer: tutto in `main`, tutto pushato, immagine
pubblicata.

**Il numero**: `0.1.0-dev` → **`2026.7.0`**. CalVer come da `CONTEXT.md`, ma con una correzione di
forma imposta dal toolchain: `2026.07` è rifiutato da Cargo (lo zero iniziale nel minor non è SemVer
valido) e `2026.7` pure (la patch non è opzionale). Il formato reale è quindi **`YYYY.M.PATCH`** —
annotato in `CONTEXT.md`, perché la riga diceva un'altra cosa. Il confronto resta numerico, quindi
`2026.7.0` precede correttamente `2026.10.0`: è solo l'ordinamento alfabetico dei tag che inganna.

**Tag mobile `latest-<arch>`** accanto a `<versione>-<arch>` e `<sha>-<arch>` (scelta del maintainer),
ed è il nuovo default di `install-container.sh --pull`. La ragione è concreta: un default pinnato va
aggiornato nello script a ogni release, e la volta che qualcuno se ne dimentica i dispositivi restano
indietro **in silenzio** — che è esattamente lo stato in cui era `0.1.0-dev`. Non rende gli
aggiornamenti automatici: il pull resta un comando che qualcuno dà.

**Un difetto che la release avrebbe fatto esplodere subito**: `install-container.sh` aveva
`TAG="localhost/sws-runtime:0.1.0-dev"` cablato e dopo `podman load` verificava proprio quello. Con
un numero diverso l'installazione **offline** sarebbe morta su *"immagine assente"* davanti a un
archivio valido, mandando a cercare il problema dalla parte sbagliata. Ora il riferimento si legge
dall'output di `podman load`; un `--tag` esplicito continua a vincere.

**Pubblicato e verificato**: `build_container.sh --push` da `main` pulito al commit `21bd613`. I tre
tag interrogati con token anonimo da `ghcr.io/token` (la tecnica giusta, imparata il 30 quando un
`curl` diretto aveva dato `401` anche su un package pubblico) → **HTTP 200 tutti e tre**.

---

## Sessione 2026-07-31 (ufficio) — allineamento dei branch e riconciliazione dei due percorsi container

Il maintainer arriva in ufficio dopo aver lavorato da casa la notte, fa il pull e trova sette branch
locali. Richiesta: allineare tutto, poi riprendere.

**Allineamento.** `main` era indietro di 6 commit (fast-forward `2bf742a` → `d17a181`, fatto con
`git fetch origin main:main` per non toccare il working tree — su questa macchina girano più sessioni
sullo stesso checkout). Tutti e sette i branch locali erano identici ai rispettivi remoti: niente di
divergente, niente perso.

**Sei branch su sette avevano il contenuto già in `main`** e sono stati chiusi con un merge `-s ours`
ciascuno, come già fatto la notte per `fix/multiselect-drag` e `feat/container-x86_64`: nessuna
modifica al codice, solo il collegamento storico, così `git branch --merged` li riconosce. Albero di
`main` verificato byte-identico a `origin/main` dopo i cinque merge.

| branch | perché è chiuso |
|---|---|
| `fix/project-write-safety` | squash `d0d9110`; poi `main` ci ha riscritto sopra — il diff verso `main` è di sole rimozioni |
| `fix/deploy-preserve-database` | squash `9f20d06`; 8 file su 15 byte-identici, gli altri superati da `9cd0a3f`/`9c368da` |
| `chore/e2e-and-docs` | squash `631e6d2`; unico residuo un paragrafo `STATUS.md` **duplicato**, non portato |
| `fix/container-host-network-default` | squash `c028b16`; merge a secco → albero identico a `main` |
| `chore/disable-legacy-container-publish` | squash `add86bb`; merge a secco → albero identico a `main` |
| `fix/multiselect-drag` | già chiuso la notte con `d17a181` |

**Il problema vero: i due percorsi container si contraddicevano.** `feat/container-registry-procedure`
(30 sera, ufficio) aveva messo la SPA **dentro** l'immagine e reso `--pull` la strada normale. Il
lavoro della notte da casa (`9c368da`, container x86_64 + installazione dall'IDE via SSH) è partito
dal layout **precedente**, con la SPA fuori: `Containerfile` sdoppiato in `.aarch64`/`.x86_64` senza
il `COPY www/`, e un `POST /api/deploy/device-container` che trasferisce quattro file e invoca
`install-container.sh --image X --www Y`. Mergiare il branch così com'era **avrebbe rotto** "Installa
su dispositivo", perché l'installer del registry rifiuta `--www` con un errore esplicito.

**Decisione del maintainer**: vale quella del 30 sera — SPA nell'immagine — estesa a entrambe le
architetture. Riconciliato sul branch (merge `5cf634d`):

- Il merge meccanico era quasi pulito: i due lati toccano file quasi disgiunti (solo
  `docs/DEPLOY_CONTAINER_AARCH64.md` e `scripts/build_container.sh` in comune), e git ha seguito da
  solo la rinomina `Containerfile` → `Containerfile.aarch64` portandoci sopra le modifiche del branch.
  Unico conflitto l'introduzione del documento aarch64, risolta tenendo entrambe le indicazioni.
- `Containerfile.x86_64` allineato al gemello: `COPY www/` come ultimo layer di contenuto,
  `/var/sws/www` non è più un punto di mount.
- `build_container_x86_64.sh`: `--push`/`--registry` e i controlli preliminari del gemello (albero
  pulito, `podman login`, entrambi *prima* della build), tag `<versione>-amd64` e `<sha>-amd64`,
  niente più archivio SPA separato.
- `packaging.rs`: tre file invece di quattro, niente `--www` nel comando remoto, via `www_tarball` da
  `ContainerPackage` e dalla richiesta di deploy. Un client più vecchio che lo manda ancora non rompe
  niente (serde ignora i campi in più — è il lato utile di **Q9**). Nuovo test sull'assenza di `--www`.
- Il deploy SSH dall'IDE resta come **percorso offline** accanto a `--pull`: un dispositivo in campo
  che non raggiunge il registry è il caso normale, non un ripiego di serie B.

**Verificato**: `cargo check --workspace` verde, `cargo test -p sws-web` 34/34 (1 nuovo), `pnpm build`
verde, `pnpm test` 20/20, `bash -n` sui tre script toccati.

**Poi verificato sul dispositivo dal maintainer, poche ore dopo** — il pezzo che qui risultava
mancante. Installazione dall'IDE su un **WP630** (`wp630-a-p3-07a077.local`, due indirizzi:
`192.168.1.120` e `192.168.60.177`), percorso offline `--image`. Il log conferma che è girato il
codice riconciliato e non quello precedente:

- **tre** `scp` invece di quattro — immagine, installer, unit quadlet: la SPA non viaggia più a parte;
- `==> [3/6] verifico che l'immagine contenga la SPA` → `/var/sws/www/index.html presente`, il
  controllo che esiste solo nell'installer del branch;
- `Network=host (default)`, `linger già attivo`, `/health ok dopo 2s`, `Health check: OK`, `DONE`;
- poi `connected to remote runtime http://192.168.1.120:8444`.

Tempi: ~1,6 s di `scp` per l'immagine, ~18 s di `podman load`, ~47 s in tutto dal `mkdir` al `DONE`.
L'IDE girava in modalità **solo-IDE** (`--viewer-port not set`, porta 8460), cioè `start_editor.sh`
sul PC: è il caso d'uso previsto, editor sul PC e runtime sul dispositivo.

**Resta non verificato**: il percorso `--pull` dal registry (qui si è usato `--image`), e il percorso
**x86_64** — la sua verifica del 2026-07-30 (`docs/DEPLOY_CONTAINER_X86_64.md` §Verifica) precede
questo cambio ed è stata fatta con la SPA fuori dall'immagine.

### Poi: "Cerca runtime" distingue i container (stessa sessione)

Segnalazione del maintainer: cercando i runtime sulla rete non c'è modo di sapere quali girino in
container. Serve per una ragione pratica — dice quale procedura di aggiornamento usare.

**Fatto**: il runtime annuncia una proprietà mDNS `container` col nome del motore, e la riga in
ConfigView porta una pill `📦 podman` / `📦 docker`. Il rilevamento è **a runtime**
(`/run/.containerenv`, `/.dockerenv`, ripiego sul cgroup), non cotto nell'immagine: funziona anche
sull'immagine legacy e sui dispositivi già installati senza ricostruire niente, e non mente se la
stessa immagine viene eseguita da un motore diverso. Un runtime nativo **non annuncia la proprietà**,
quindi niente pill — l'assenza non viene interpretata come "nativo".

**Nel farlo sono usciti due difetti nella discovery, entrambi corretti**:

1. Il doppione già annotato (era item 3 del 30 sera) era in realtà un **triplo**: misurato in locale,
   3 voci per un solo runtime. Causa confermata: `browse_mdns_blocking` accumulava una voce per ogni
   `ServiceResolved`, e mdns-sd ne consegna uno per risposta ricevuta.
2. **Il difetto più serio l'ho quasi introdotto io.** Deduplicare per nome tenendo la prima risposta
   sembrava ovvio, ma le risposte non sono equivalenti: `enable_addr_auto()` annuncia tutti gli
   indirizzi dell'host, loopback compreso, e la prima può portare solo `127.0.0.1`. La prima stesura
   offriva `http://127.0.0.1:8444` **due volte su tre** — un URL inutilizzabile da un'altra macchina,
   cioè peggio del doppione che stavo correggendo. Se ne è accorto il confronto prima/dopo, non la
   rilettura del codice. Ora la scelta dell'indirizzo è ordinata e preferisce un IPv4 non-loopback, e
   una risposta successiva promuove la voce se porta un indirizzo migliore.

**Verificato**: nuovo `scripts/check_discover.sh` (due runtime, N giri, controlla numero di voci +
valore di `container` + assenza di loopback) → 6/6 su 3 giri, e 10/10 nel confronto prima/dopo.
Misura prima/dopo con la deduplica disattivata: 3 voci → 1. `cargo test` 41 (sws-web, 7 nuovi) + 9
(sws-runtime, 5 nuovi), `pnpm build`/`pnpm test` 20/20 verdi.

**Non verificato**: la pill non è stata vista in un browser — provata a livello di API. Si vede al
primo "Cerca runtime" dall'IDE.

### Poi: bottone "🖥 Viewer ↗" nell'header (stessa sessione)

Richiesta del maintainer: dall'editor, un bottone che apra la pagina del runtime in una scheda del
browser, per vedere se risponde. Sta accanto a Deploy — la domanda *"ha funzionato?"* arriva subito
dopo aver premuto quello.

Apre il runtime **connesso** se c'è, altrimenti quello che serve la SPA. Lo stato della connessione
viene chiesto al server al montaggio dell'header e non solo letto dallo store: `remoteUrl` lo scrive
soltanto `RuntimeConnectionTab`, quindi chi ricarica l'IDE senza passare da Configurazione si sarebbe
trovato il bottone puntato al runtime locale mentre era connesso a un dispositivo.

**Due scelte tue**, entrambe con una conseguenza da ricordare:

- **Sonda `/health` prima di aprire**, invece di aprire e basta. Funziona perché `/health` è pre-auth
  su entrambe le porte e il runtime manda CORS permissivo — la risposta è leggibile, non un opaco.
- **La porta del viewer è dedotta** come `admin − 1` invece di essere esposta dal runtime. Corretta
  per ogni installazione esistente (8443/8444, 8445/8446, `CMD` dei Containerfile), ma resta una
  convenzione: **chi avvia con porte fuori convenzione ottiene un indirizzo sbagliato**. Mitigato
  mostrando l'URL dedotto nel tooltip e facendo sparire il bottone quando dedurre non ha senso.

**Verificato in un browser** (non solo in build), tre casi: non connesso → punta al locale e col
viewer assente non apre niente ma mostra il messaggio; connesso a un secondo runtime via API **senza
mai aprire Configurazione** → punta al viewer di quello e apre la pagina vera (è il caso che
l'interrogazione al server serve a coprire); viewer spento → nessuna scheda, messaggio, bottone di
nuovo utilizzabile. Nuovo `viewerUrlFromAdmin()` puro con 6 test; `pnpm test` 26/26.

**Una regressione mia, presa in tempo**: avevo scritto `??` dove serviva `||`, e siccome
`getRuntimeBaseUrl()` restituisce la stringa **vuota** e non `null`, il bottone spariva del tutto nel
caso "non connesso". L'ha trovata la prova in browser, non la rilettura — la build era verde.

### Anche: lo slider ignorava orientamento e sola lettura

Segnalato dal maintainer: «l'oggetto slider se metti orientamento verticale non cambia nulla». Vero,
e il valore **veniva salvato correttamente** — c'è anche nel mirror Rust, quindi sopravvive al
round-trip: semplicemente non lo leggeva nessuno, né l'anteprima nell'editor né il controllo a
runtime. Dimenticanza del solo slider: `radio_group` onora `orientation`, il grafico a barre
`bar_orientation`.

A runtime il controllo nativo viene **ruotato di −90°** (scelta del maintainer) invece di usare
`writing-mode: vertical-rl`: quest'ultimo è lo standard moderno ma vuole Chrome 120+/WebKit 17.4+, e
sul browser dei pannelli Yocto non sappiamo cosa ci sia — dove non fosse supportato lo slider
resterebbe orizzontale, cioè il difetto di partenza ma più difficile da riconoscere.

**Secondo difetto, trovato leggendo il codice per il primo**: lo slider ignorava anche `read_only`.
La spunta "Sola lettura" c'era nel pannello e non faceva niente, quindi un comando dichiarato in sola
lettura scriveva comunque il tag. Corretto (`disabled`). `checkbox`, l'unico altro oggetto che offre
quella spunta, la onorava già.

**Verificato in un browser, misurando**: nel viewer, orizzontale 192×15 senza trasformazione,
verticale 15×245 ruotato, verticale in sola lettura 15×245 ruotato **e `disabled=true`**;
nell'editor, binario orizzontale lungo 200 px e binario verticale lungo 278 px.

**Da sapere**: l'orientamento non tocca la geometria dell'oggetto. Uno slider lasciato alla dimensione
di default della toolbar (200×40) e messo verticale diventa un moncone — misurato, 15×23 px. Va reso
più alto che largo. Se conviene che il cambio di orientamento inverta da sé larghezza e altezza, è una
riga, ma è una decisione da prendere: cambiare la geometria di un oggetto in risposta a una proprietà
è una sorpresa, e va nella history dell'undo.

### Anche: WP830/WP630 sono 1920×1080

Segnalato dal maintainer: il preset dispositivo li dichiarava 1366×768. Corretto in
`brand.json`. **Il preset agisce solo alla creazione della pagina**, quindi i progetti già disegnati
con la misura vecchia restano a 1366×768 finché non si cambia a mano la dimensione — se ce n'è
qualcuno in servizio, va sistemato a mano.

**Da riprendere**:

1. **Provare `install-container.sh --pull`** dal registry: l'installazione sul WP630 ha usato il
   percorso offline `--image`, quindi il percorso registry con la SPA nell'immagine non è ancora
   stato esercitato su un dispositivo. Serve `build_container.sh --push` (e l'SDK Yocto).
2. **Il percorso x86_64 va riprovato**: `build_container_x86_64.sh` non è stato eseguito dopo la
   riconciliazione, e la sua verifica del 30 precede il cambio.
3. L'occasione di 1 e 2 serve anche per **vedere la pill del container su un runtime vero**, non
   forzato con `SWS_CONTAINER_ENGINE`, e per guardare il bottone Viewer contro un dispositivo reale.
4. **`feat/container-registry-procedure` aspetta il tuo via libera** per lo squash merge in `main`.

---

## Sessione 2026-07-31 — fix deploy container (hang, log, output remoto) + percorso dati brand-aware (branch `feat/container-x86_64`)

Continuazione della sessione precedente sullo stesso branch, non ancora mergiato. Il maintainer ha
provato il flusso "Installa su dispositivo → Container" dall'IDE verso un device reale
(192.168.1.169) e ha riportato due problemi.

**Il deploy restava bloccato dopo il `mkdir` iniziale, senza errore.** `run_ssh_cmd` (condivisa da
`deploy_device` e `deploy_device_container`) passava solo `-o StrictHostKeyChecking=no`: senza
`sshpass` e senza una chiave SSH già autorizzata, `ssh`/`scp` tentavano un prompt interattivo che
il processo backend — nessun terminale, nessun `DISPLAY` funzionante — non può mai soddisfare, e
restavano appesi indefinitamente. Aggiunto `-o BatchMode=yes` (solo quando non si usa `sshpass`,
perché altrimenti romperebbe proprio il meccanismo con cui `sshpass` intercetta il prompt) e
`-o ConnectTimeout=10` su entrambi i percorsi. Riprodotto lo scenario esatto del maintainer
(self-SSH, nessuna chiave autorizzata): prima del fix restava appeso, dopo fallisce in 0,14 s con
un errore chiaro.

**I messaggi del deploy non arrivavano al logger principale**, solo allo stream HTTP effimero del
modale — `packaging.rs` non aveva nessuna chiamata `tracing::`. Aggiunta una macro
(`log_deploy_line!`) che specchia ogni riga nel logger globale (già instradato da `main.rs` verso
`LogBusLayer` → file JSONL + pannello Log), usata nei tre handler streaming (`build_package`,
`deploy_device`, `deploy_device_container`).

**Un `exit 1` senza spiegazione, anche dopo il fix del hang**: `run_ssh_cmd` catturava solo lo
stato di uscita, non stdout/stderr — l'output reale del comando remoto (incluso quello di
`install-container.sh` sul device) finiva ereditato dallo stdio del processo backend, invisibile
sia nella UI sia nei log. Riscritta per catturare e inoltrare ogni riga (con un rientro di 4 spazi
per distinguerla dalle righe `==>` proprie). Verificato via self-SSH: il log ora mostra il vero
errore stampato sul device, non solo il codice di uscita.

**Percorso dati sul device brand-aware**: il fallimento reale sul device del maintainer era
`install-container.sh` che non riusciva a creare `/data/user/sws` (permessi) — confermato solo
grazie al fix precedente, che finalmente mostra l'output remoto. Il maintainer ha confermato che
il percorso giusto cambia da prodotto a prodotto, e ha chiesto un menù a tendina per il modello del
device, con i modelli definiti nel branding dell'IDE (chi ha il brand Pixsys vede i modelli
Pixsys, brand SWS vede solo il custom). Ricalcato esattamente il pattern già esistente per i
preset di risoluzione pagina (`Brand.devicePresets` / `EditorShell.tsx`): nuovo
`Brand.dataPathPresets: {label, path}[]`, popolato da `data_path_presets` in `brand.json` (oggi
solo Pixsys, un modello: `/data/user/sws`, la convenzione comune a tutta la linea Yocto WP-series).
`install-container.sh` non è stato toccato — `--data` esisteva già come flag; serviva solo che il
backend lo passasse. Nuovo campo `DeviceContainerDeployRequest.data_path` (stringa vuota =
comportamento identico a oggi), validato con la stessa `validate_remote_path` già usata per
`remote_dir`, e una `build_install_cmd` estratta per essere testabile in isolamento.

**Verifica end-to-end via self-SSH** (stessa tecnica delle sessioni precedenti: chiave autorizzata
solo per la durata del test, ripristinata subito dopo) con `--data /tmp/sws-deploy-data-test`: la
directory dati, il caricamento immagine, l'unpack della SPA, la riscrittura dei mount nella unit
quadlet e l'avvio sono andati **tutti a buon fine** — `/health ok dopo 2s`, primo deploy container
davvero completo (non solo parziale) di questa serie di test. Ripulito con
`install-container.sh --uninstall --purge` (nota per il futuro: il purge non ricorda il `--data`
usato all'installazione — va ripassato esplicitamente, altrimenti prova a ripulire il default).

**Verifica**: `cargo test -p sws-web` → 33/33 (2 nuovi su `build_install_cmd`) + `pnpm build`/
`pnpm test` (20/20) verdi. Istanze dev live (porta 8460) verificate intatte dopo ogni test.

**Resta da fare**: riprovare il deploy verso il device reale 192.168.1.169 scegliendo il modello
Pixsys (o un percorso custom, se quel device non segue la convenzione `/data/user/sws`); il resto
di "Resta da fare" della sessione precedente (aggiornare README con "container è la via
standard") è ancora aperto.

---

## Sessione 2026-07-30 (sera 2) — container x86_64 + installazione da IDE (branch `feat/container-x86_64`)

Richiesta del maintainer: il container deve diventare **la via standard** per il runtime, sia su
arm64 sia su x86_64, e l'installazione deve poter partire **dall'IDE** (Configurazione → Runtime),
riusando le credenziali SSH già in UI. Confermato con l'utente: **solo Podman** per ora (Docker
avrebbe richiesto un secondo percorso completo — niente quadlet lì — rimandato).

**Parte A — build x86_64** (mancava del tutto: verificato leggendo `docs/DEPLOY_PX30.md` per
intero che il commento nel Containerfile che vi rimandava per "x86 legacy" era sbagliato — quel
doc copre target ARM64 generici buildati da un laptop x86, non un target x86_64):
- `deploy/container/Containerfile` → rinominato `Containerfile.aarch64`; nuovo `Containerfile.x86_64`
  gemello (nessun SDK, binario nativo `cargo build --release`, nessun cross-compile).
- Nuovo `scripts/build_container_x86_64.sh`, ricalca `build_container.sh` riga per riga.
- **Verifica `readelf` fondamentale, non skippabile**: il primo tentativo con `debian:bookworm-slim`
  (ipotesi ragionevole, stessa base della legacy) si sarebbe rivelato **rotto all'avvio** — il
  binario buildato su questa macchina (Python non di sistema, tipo pyenv) dichiara
  `libpython3.13.so.1.0` + `GLIBC_2.39`, che bookworm-slim non ha. Corretto a `debian:trixie-slim`
  (glibc 2.41 + Python 3.13) **prima** di distribuire qualunque cosa, verificato con `podman run`
  diretto: `healthy`, `/health` 200, template non vuoti, RestrictedPython attivo, nessun
  `SWS_ADMIN_PASSWORD` richiesto.
- **Limite dichiarato in `docs/DEPLOY_CONTAINER_X86_64.md`**: a differenza del binario Yocto
  (SDK fisso, riproducibile), un binario x86_64 nativo lega glibc/Python alla macchina che lo
  builda — la riga `FROM` del Containerfile.x86_64 **va riverificata per ogni macchina di build
  diversa**, non è un valore universale.
- Test end-to-end di `install-container.sh` fatto **senza toccare le istanze dev già attive sulla
  stessa macchina** (porte 8443/8444/8460 già occupate): copia temporanea dello script con porte
  remappate (28443/28444) + `--data` in scratch dir — mkdir, `podman load`, unpack SPA, avvio,
  `/health ok dopo 2s`; istanze live verificate intatte dopo.

**Parte B — installazione container dall'IDE via SSH**: nuovo endpoint
`POST /api/deploy/device-container` (`sws-web/src/packaging.rs`), stesso pattern shell-out
SSH/SCP già usato da `deploy_device` (il binario nudo — nessuna libreria SSH Rust, `sshpass`/`scp`/
`ssh` di sistema via `tokio::process::Command`), ma: carica **quattro** file (immagine, SPA,
`install-container.sh`, il quadlet — l'installer legge quest'ultimo da una posizione relativa a
sé stesso, quindi devono stare nella stessa directory remota) ed esegue l'installer **senza
`sudo`** (podman rootless — differenza reale rispetto al binario nudo, comunicata anche in UI).
Nuovo `GET /api/build/container-packages` elenca le coppie immagine+SPA già buildate in `dist/`
(pattern `sws-runtime-<versione>-{aarch64,x86_64}-image.tar.gz`), segnala se manca l'archivio SPA
corrispondente (l'immagine non lo contiene mai). Frontend: `ConfigView.tsx` → tab Runtime →
"Installa su dispositivo" ha ora un selettore **Binario nativo / Container (Podman)**, stessi
campi host/porta/utente/password/directory remota riusati identici — solo l'elenco pacchetti e
l'endpoint chiamato cambiano.

**Verifica end-to-end del deploy via SSH**: fatta su questa stessa macchina (self-SSH, chiave
temporaneamente autorizzata e rimossa subito dopo il test, nessun accesso nuovo dato che c'era
già shell completa) contro un'istanza runtime usa-e-getta su porta dedicata (per non toccare le
istanze dev live): `GET /api/build/container-packages` trova l'immagine x86_64 già costruita,
`POST /api/deploy/device-container` esegue correttamente mkdir + 4× scp + invocazione di
`install-container.sh` (fallito solo sull'ultimo passo per un limite **pre-esistente e non mio**
dello script — `/data/user/sws` non esiste su questa macchina generica, assunzione valida solo su
device Pixsys reali).

**Verifica**: `cargo build`/`cargo test -p sws-web` (31 test, 4 nuovi su `parse_image_tarball`/
`validate_remote_path`) + `pnpm build`/`pnpm test` (20/20) verdi.

**Resta da fare**: mergiare `feat/container-x86_64` dopo validazione del maintainer; provare il
deploy container da IDE verso un device Pixsys reale (non solo self-SSH); considerare se
aggiornare la messaggistica "il container è la via standard" anche in `README.md`/altri doc di
primo impatto, non solo nei doc di deploy dedicati.

**Batteria completa su `main` fuso** — `cargo check` verde, Rust 21+6+27 test, frontend 20/20,
`pnpm build` verde, e i sei controlli:

| controllo | esito |
|---|---|
| `check_project_write_safety.sh` | 9/9 (4/9 senza il fix) |
| `check_deploy_preserve.sh` | storico 500→500, utenti/ricette/backup intatti, 4 casi utenti |
| `check_database_mgmt.sh` | orfani, cancellazione, spazio recuperato, retention |
| `check_multiselect_drag.sh` | ancora e seguace entrambi dx=120 dy=60 |
| `check_viewer_layout.sh` | nessuna scrollbar in 4 configurazioni su 4 |
| `check_spa_autoreload.sh` | ricarica dopo ~28 s col bundle nuovo |

`check_e2e.sh` **non** è nella batteria: passa 3-4 test su 6 e quali cambia fra esecuzioni, perché i
test condividono un runtime e ognuno apre i propri progetti. Da isolare prima di poterlo usare come
gate; il limite è scritto in testa allo script.

**Resta da provare sul dispositivo**: il deploy che conserva il database e il pulsante utenti — il
codice è **già sul dispositivo** dalla sera del 30 (immagine ricostruita e installata dal registry),
ma nessuno li ha esercitati. Resta il fallimento stabile di `lang-table`, che nel viewer non risolve
`{{token}}`: da capire se è il test o la funzione.

---

## Sessione 2026-07-30 (sera, dev server) — il container si distribuisce da un registry

Il maintainer ha chiesto di aggiornare il runtime sul WP620 (`user@192.168.1.84`), poi un deploy
pulito, poi tutta la procedura di compilazione/pubblicazione/installazione.

**Dove siamo arrivati**: l'immagine aarch64 è pubblicata su `ghcr.io/soligolab/sws-runtime` come
package **pubblico**, e il dispositivo la scarica **senza credenziali** — verificato, `podman login
--get-login ghcr.io` risponde *not logged into* e il pull riesce lo stesso. Portare una versione
nuova era copiare 59 MB via `scp` più un secondo artefatto con la SPA; ora è
`install-container.sh --pull`, e si trasferisce solo il layer cambiato (il binario è 14,3 MB
compressi, i 50 MB di base e apt il dispositivo li ha già).

- **La SPA è entrata nell'immagine** (decisione del maintainer): stava fuori per non ritrasferire
  59 MB a ogni modifica del frontend, ragione caduta con la deduplicazione dei layer. Sta **dopo** il
  binario, perché un layer che cambia invalida quelli sotto. Sparisce `--www-only`, sparisce il modo
  di avere SPA e binario di versioni diverse sullo stesso dispositivo.
- **Aggiornamenti a comando, non automatici** (decisione del maintainer): `podman auto-update` c'è e
  il SO fornisce già il timer, ma su una macchina in servizio un riavvio non richiesto è peggio di un
  aggiornamento tardivo.
- **La rete host è il default dell'installer.** Senza, "Cerca runtime" non trova **mai** un runtime in
  container: sulla rete rootless di podman il multicast non esce. Misurato dallo stesso editor a
  pochi minuti di distanza — `--bridge` → `/api/discover` risponde `[]`, default → trova il runtime
  con `admin_url http://192.168.1.84:8444`.
- **Job CI della pubblicazione disattivato**: costruiva l'immagine *legacy* (quella coi quattro
  difetti) e la pubblicava all'indirizzo che il badge del README promette. Non è correggibile in CI —
  il binario buono richiede l'SDK Yocto Pixsys, che sui runner GitHub non c'è.

**Il bug della giornata**: `--uninstall --purge` seguito da un'installazione **non** dava un
dispositivo pulito. Il purge svuota i bind mount, e l'installer migrava i dati dai volumi nominati
pre-2026-07-28 *proprio perché* la cartella era vuota — cioè per definizione dopo un purge. Il
dispositivo è tornato in servizio con un progetto `test1` di due giorni prima, aperto come attivo.
Ora la migrazione è dietro `--migrate-volumes`. **Stessa forma degli altri tre casi della
settimana**: un automatismo che deduce l'intenzione dell'utente da uno stato ambiguo.

**Due errori miei, entrambi utili da ricordare**:

- Ho concluso che il package GHCR fosse privato perché un `curl` sul manifest dava `401`. GHCR
  pretende un bearer token **anche per le immagini pubbliche**: quel 401 non dimostra niente. La
  verifica giusta è token anonimo da `ghcr.io/token?scope=...` e poi il manifest.
- Ho messo le `LABEL` OCI subito dopo il `FROM`, invalidando la cache di tutto ciò che segue: la
  build è rimasta 15 minuti a ricostruire sotto QEMU il layer `apt` che era già pronto. In fondo al
  Containerfile la stessa build dura 2,7 secondi.

**Sessione precedente**: 2026-07-29 — **Container aarch64 in servizio sul dispositivo, Telegram per singolo allarme, notifiche morte al boot** (branch `feat/container-aarch64`, portato in `main` con squash). Viewer a schermo pieno e auto-reload verificati in un browser, non più solo scritti.

**Da riprendere (2026-07-30 sera)**:

1. **`feat/container-registry-procedure` aspetta il tuo via libera per il merge** — `91b8687`
   (registry, SPA nell'immagine, `--migrate-volumes`) e `52ea5d3` (documentazione in tre fasi +
   README). Provato sul dispositivo, non ancora confermato da te. Gli altri due branch container sono
   già in `main` (`c028b16`, `add86bb`).
2. **Il purge non è stato riprovato dopo la correzione**: il dispositivo aveva sopra il tuo `Test034`
   e distruggerlo per un test non valeva il prezzo. Da fare sul prossimo dispositivo da azzerare
   davvero — `--uninstall --purge` + install → `GET /api/projects` deve dare `[]`.
3. ~~**`/api/discover` mostra ogni runtime due volte.**~~ **Corretto il 2026-07-31** (vedi la sezione
   in cima). La causa era quella individuata — `browse_mdns_blocking` accumulava una voce per evento
   `ServiceResolved` — ma il conteggio era per difetto: misurate **tre** voci, non due. E deduplicare
   da solo non bastava: teneva la prima risposta, che spesso porta solo il loopback.
4. **Backup lasciati sul dispositivo**, in `~` di `user@192.168.1.84`:
   `sws-data-backup-20260730-144812.tar.gz` (progetto `pippo` e config del 29) e
   `volbackup-sws-{projects,config,logs}-20260730.tar` (i volumi nominati prima di rimuoverli).
   Da cancellare quando sei sicuro che non servano.

> **Nota di metodo**: su questa macchina girano **più sessioni Claude contemporanee sullo stesso
> checkout**. `git status` può cambiare fra due comandi consecutivi e un branch può cambiare sotto
> una build lunga: per build e deploy conviene un worktree isolato su un commit fisso.

**Sessione precedente**: 2026-07-29 — **Container aarch64 in servizio sul dispositivo, Telegram per singolo allarme, notifiche morte al boot** (branch `feat/container-aarch64`, portato in `main` con squash). Viewer a schermo pieno e auto-reload verificati in un browser, non più solo scritti.

**Permessi `ssh`/`scp`** (deciso il 2026-07-30, non più in sospeso): restano fuori dal `deny` di
`.claude/settings.json` finché il test sul dispositivo non è chiuso — se serve indagare insieme, senza
accesso non si può — e si rimettono subito dopo. `Bash(rsync *)` resta in `deny`.

**Da riprendere alla prossima sessione** — tre verifiche che richiedono una persona davanti allo
schermo, e una decisione:

1. **Guardare il pannello WP620.** Il layout del viewer l'ho misurato in Chromium a 1280×800
   (`scripts/check_viewer_layout.sh`), ma nessuno ha visto lo schermo del dispositivo dopo
   l'aggiornamento di oggi. Per far sparire la barra superiore serve attivare `hide_viewer_chrome`:
   Editor → pannello sinistro → PAGINE → ⚙ (non sta in Configurazione).
2. **La colonna Telegram dalla tab Allarmi.** Provata via API con quattro casi e un bot vero; la
   tendina non l'ha ancora toccata una persona.
3. **Le notifiche email.** Il fix delle notifiche al boot vale anche per SMTP, ma ho esercitato solo
   Telegram: nessuna email è stata inviata in nessun test.
4. **Decisione sui permessi**: `Bash(ssh *)` / `Bash(scp *)` sono stati tolti dal `deny` di
   `.claude/settings.json` per i test sul dispositivo, con un allow ristretto. I test di oggi sono
   chiusi: da decidere se rimetterli. `Bash(rsync *)` è rimasto in `deny`.

Nuove questioni aperte annotate in `docs/OPEN_QUESTIONS.md`: **Q9** (le `PUT /api/project/*`
accettano e scartano in silenzio i campi sconosciuti — scoperto mandando `width`/`height` a
`page-layout` e ricevendo `204`) e **Q10** (una sorgente non parsabile viene scartata all'apertura e
**cancellata dal disco** al primo salvataggio successivo: stessa forma della perdita di dati corretta
il 28).

**In parallelo, stessa giornata, dall'altra macchina**: demo "Nebulizzatore Sandokan" (MQTT reale) + fix dello storico perso al riavvio. Template e progetto importati/deployati, bug isolato e corretto, cherry-pickati in `main` (`718a3bb`, `d3fef51`). Branch `feat/project-location-and-brand-presets` cancellato in locale perché interamente contenuto in `main`. Nota: quel fix e il mio sulle notifiche sono **la stessa classe di bug** — il percorso di auto-apertura al boot in `main.rs` ricopiava a mano quello che fa `open_project`, e ogni pezzo dimenticato (lo storico, le notifiche) resta invisibile finché non serve.

- **Layout del viewer verificato in un browser (2026-07-29)**: era lavoro già pushato ma mai provato davvero. Nuovo `scripts/check_viewer_layout.sh` (+ `sws-editor/scripts/viewer_layout_measure.mjs`) che misura le barre di scorrimento a 1280×800 in quattro configurazioni. Confronto **prima/dopo** ricostruendo la SPA pre-fix: prima tre barre confermate — documento 816 px in 800 per il `margin: 8px` del body, area pagina `ch 730` contro pagina 800 (fasce non sottratte) e `cw 1264` contro 1280 — più `hide_viewer_chrome` ignorato e nessuno scale-to-fit. Dopo: nessuna barra, `<nav>` che scompare, scale 0,914 con le fasce e 1,0 senza, cap a 1 rispettato. Browser di Playwright ora installato su questa macchina (`~/.cache/ms-playwright`). Scoperto anche che `page_layout` non ha `width`/`height`: in modalità fisso la dimensione viene dal synoptic, e il PUT accetta quei campi con 204 scartandoli.

- **Telegram per-allarme provato sul dispositivo con un bot vero (2026-07-29)** — quattro casi sull'allarme `counter_high` di `pippo`, con l'immagine aarch64 aggiornata: *chat predefinite* (campo assente) → messaggio inviato; *non notificare* → silenzio; *chat specifiche* → messaggio inviato; *chat specifiche senza chat* → `WARN telegram: modo 'chat specifiche' senza nessuna chat` e nessun invio. Definizione dell'allarme ripristinata identica; `diff -r` col backup mostra come unica differenza `.history/historian.db`, cioè il registro storico che ha annotato gli eventi del test. Backup conservato in `/data/user/sws/.backup-claude/pippo-20260729-095821`.
- **Autostart del container al boot: verificato per la prima volta (2026-07-29)** su un riavvio reale del dispositivo (up 1h07 al momento del controllo): container già attivo e `healthy`, unit quadlet `active`, `Linger=yes`. Non serviva accesso fisico perché ha funzionato.

- **NOTIFICHE MORTE AL BOOT, trovato e corretto il 2026-07-29** — il bug più serio di questa sessione. Sul dispositivo, dopo ogni riavvio, gli allarmi non mandavano né Telegram né email e gli script globali non partivano: l'auto-apertura del progetto in `main.rs` non avviava canale Telegram, supervisore notifiche e supervisore script. Tornava a funzionare solo riaprendo il progetto dall'IDE. Spiega il sintomo *"la notifica di test mi arriva ma il messaggio dell'allarme no"*. Diagnosticato sul dispositivo (assenza della riga `notification supervisor started` al boot, presenza dopo un `open`, seguita da `telegram message sent`). **Corretto** estraendo `projects::start_project_services`, ora usata da tutti e tre i percorsi di apertura; `router::build` restituisce anche l'`AppState`. **Lezione**: tre copie della stessa sequenza di avvio divergono in silenzio — il percorso di boot non ha nessuno che lo guardi.
- **`install-container.sh`: validazione prima di fermare il servizio (2026-07-29)** — rimuoveva il container al passo 4 e scopriva la unit quadlet mancante al passo 5, lasciando il dispositivo senza runtime. Capitato dal vivo. Nuovo passo 0 che valida tutto prima di toccare qualsiasi cosa.

- **Auto-reload della SPA verificato (2026-07-29)**: nuovo `scripts/check_spa_autoreload.sh` (+ `sws-editor/scripts/spa_autoreload_measure.mjs`). Simula il deploy rinominando il chunk di entry con un hash diverso, quindi basta una build. Misurato: il viewer si ricarica dopo ~28-30 s e serve il bundle nuovo. Era l'altra metà del *"non prendere abbagli"*: prima non c'era prova che il pannello prendesse davvero la versione aggiornata.

- **Segreti in backup/export/deploy (2026-07-29)**: decisione del maintainer — password e token sono dati di progetto e devono essere salvati e ripristinati in tutte le procedure; la custodia sicura dei backup è responsabilità dello sviluppatore. Prima il bundle dichiarava `secrets_masked: true` mascherando **solo** MQTT, e siccome il deploy remoto usa la stessa `build_project_zip` il dispositivo riceveva un broker senza credenziali. Ora nessuno strip; `secrets_masked` resta nel manifest solo per compatibilità di formato, sempre `false`. **Invariata** la mascheratura `********` sulle GET (browser) — è un'altra cosa e serve. Verificato con un test sul bundle del deploy e col giro export→import sul runtime vero.

- **Telegram per singolo allarme (2026-07-28)**: colonna *Telegram* nella tab Allarmi con tre stati — chat predefinite / chat specifiche / non notificare. Campo assente = chat predefinite, per non spegnere in silenzio allarmi già in servizio. Decisione in `AlarmDef::telegram_routing()` con 6 test, incluso il giro su YAML di `off` (token booleano in YAML 1.1). "Chat specifiche" senza chat non ricade sul globale: segnalato nel log e sulla riga. Il canale Telegram porta ora `TelegramMessage` con destinatari opzionali; gli script restano sul canale `String`. **Verificato**: round-trip attraverso l'API reale (salvataggio → project.yaml → riapertura del progetto) su quattro allarmi, uno per stato più uno senza il campo. Poi **provato con un bot vero sul dispositivo** il 2026-07-29, quattro casi su quattro (voce sopra).

- **PERDITA DI DATI, causata e corretta il 2026-07-28**: `saveAll()` azzerava variabili, sorgenti e allarmi di un progetto. Spingeva su disco la copia in memoria di quelle tre collezioni, quindi qualunque istante in cui la copia è più povera del disco distruggeva il contenuto. Provato dall'audit log (`.run-editor/config/audit.jsonl`, seq 93-96): quattro scritture in 23 ms, `{"count": 0, "what": "tags"}` contro 16 variabili su disco, con la scrittura dei tag **duplicata** — la tab e `saveAll` insieme. Il rischio era latente da prima, ma l'ho reso attivo estendendo `saveAll` a Configurazione e al deploy. **Corretto**: `saveAll` non scrive più tags/sources/alarms (le possiedono le tab di Configurazione), e il flush automatico delle bozze resta solo per Notifiche e Datastore, le due che tracciano l'intenzione reale dell'utente. Verificato: progetto da template 49 tag/4 sorgenti/6 allarmi intatto col nuovo comportamento, azzerato col vecchio. **Lezione**: un flush automatico può scrivere solo ciò che l'utente ha esplicitamente modificato; un diff strutturale contro lo store non è una prova di intenzione.
- **Selettore variabili (2026-07-28)**: il `▾` di `TagInput` era nascosto quando il progetto non aveva variabili dichiarate, quindi nella tabella Allarmi sembrava una funzione assente. Ora è sempre visibile, con un avviso utile quando non c'è nulla da scegliere, ed elenca anche le variabili **dedotte dalle sorgenti** (nuovo `src/tagCatalog.ts`, 6 test) — in molti progetti sono le uniche che esistono. `TagInput` esteso ai 4 punti che avevano ancora un input semplice.

- **Telegram: test e rilevamento chat spostati sul runtime (2026-07-28)**. Il maintainer continuava a percepire "perdo il token" passando da Editor a Configurazione: il dato era intatto su disco (verificato, 46 caratteri reali), ma i due pulsanti chiamavano l'API di Telegram **dal browser** e senza il token in chiaro si bloccavano. Ora passano dal backend, che risolve il token salvato (nuovo `POST /api/notifications/telegram-chats`; `test-telegram` esisteva già). Oltre a togliere il fastidio, la prova ora percorre la stessa catena degli allarmi — quella che stamattina nessun test copriva, ed è per questo che il test passava mentre il dispositivo non aveva configurazione. Verificato con 4 casi: token vuoto e placeholder risolvono il salvato e raggiungono Telegram (401 dal token finto = la chiamata è partita), senza configurazione l'errore è esplicito.

- **Fix 2026-07-28: token Telegram cancellato da "Salva tutto" (regressione mia)**. Il maintainer ha segnalato che il token spariva. Riprodotto con uno script contro un'istanza locale: il backend cancella il `bot_token` se riceve `notifications` **senza** la sezione `telegram` (la guardia copriva solo il placeholder `********`). Il grilletto era il mio cablaggio di `pendingSections`: "Salva tutto" ora svuota le bozze delle tab, e una bozza Notifiche disallineata — inevitabile, dato che il token arriva mascherato dalle GET — veniva scritta su disco. **Causa rimossa** con un flag `touched`: la tab si registra solo se l'utente ha modificato qualcosa, non per confronto strutturale (inaffidabile per costruzione con un segreto mascherato). Aggiunti un warning lato backend quando un token salvato sta per essere rimosso, e un campo token che mostra `✓ salvato sul server` invece di `********`. **Nota**: il token su disco NON era mai stato perso nei test del maintainer — la UI mostrava il valore mascherato e "Invia test" (che chiama la Bot API dal browser, non dal runtime) non poteva funzionare senza il token in chiaro. Due percorsi diversi che non si incrociano, ed è la stessa ragione per cui stamattina il test passava mentre sul dispositivo non c'era alcuna configurazione.

- **Sessione 2026-07-28 (3) — layout viewer su pannello industriale**:
  - **Tre barre di scorrimento, tre cause indipendenti**: (1) `body` con il `margin: 8px` di default mai azzerato contro una radice `height: 100vh` → scrollbar del documento **sempre**, su qualunque schermo e in qualunque modalità; (2) in modalità fisso l'`<svg>` con `height` letterale mentre il contenitore era già ridotto dei 70 px di chrome; (3) orizzontale come conseguenza delle prime due. Tutte e tre chiuse.
  - **`hide_viewer_chrome`** (impostazione di progetto, scelta del maintainer contro il parametro URL): nasconde nav **e** fascia allarmi. La fascia diventa sovrapposta — a riposo non esiste, con allarmi compare sopra il synoptic. Campanella con offset derivato invece di `top: 80` hardcoded.
  - **Modalità fisso ora rimpicciolisce** invece di scorrere: `ResizeObserver` in `RuntimeView` + `viewerFitScale()` pura in `pageLayout.ts` con **cap a 1** (si riduce, non si ingrandisce: a misure combacianti resta 1:1).
  - **`useBuildWatcher`**: rileva un frontend nuovo confrontando gli hash dei bundle nell'HTML di entry (30 s, `cache: no-store` obbligatorio perché `ServeDir` non manda `Cache-Control`). Viewer ricarica da sé, IDE mostra un banner — mai automatico dove ci sono modifiche non salvate.
  - **Fix**: `sws:autoRotate` scritto ma mai riletto all'avvio; su un pannello senza barra la rotazione è l'unico modo di cambiare pagina senza navbutton.
  - **Verifica**: round-trip dell'impostazione provato via API (PUT → `project.yaml` → GET → sopravvive al riavvio del runtime; progetto senza il campo resta valido); `viewerFitScale` con 4 test unitari (14/14 il totale frontend); `cargo test -p sws-web` 17/17; `pnpm build` verde. **Non verificato in browser**: Playwright non ha i browser installati su questa macchina e scaricarli non è un'operazione da fare di iniziativa propria.

- **Container riorganizzato (2026-07-28, su indicazione del maintainer)**: dati in **bind mount** su `/data/user/sws/{projects,config,logs,www}` invece di volumi nominati — visibili e copiabili sull'host, e `/data` è la partizione scrivibile Pixsys. `/data/user` e non `/data` perché il primo è dell'utente. L'installer migra i dati dai vecchi volumi. **La SPA esce dall'immagine**: secondo artefatto `sws-www-<ver>.tar.gz` (0,4 MB) e flag `--www-only` che la aggiorna in <1 s senza riavviare il container. Due difetti trovati provandolo sul dispositivo: (1) sostituire la *directory* montata rompe il bind mount → 404 su tutta la SPA finché non si riavvia il container, va sostituito il contenuto; (2) `curl -f` su `/` della porta admin dà 404 **pur servendo la SPA** (comportamento di `ServeDir::not_found_service`, che conserva lo status) — preesistente, si riproduce sull'editor di sviluppo, e rende `curl -f /` inutile come test di vivacità: usare `/health`.
- **Ricarica automatica dopo il deploy (2026-07-28)**: il runtime già ricaricava da solo, ma i client no — la SPA teneva in memoria il progetto caricato all'avvio. Nuovo `useProjectWatcher` sul fingerprint (3 s). **Comportamenti scelti dal maintainer**: viewer si aggiorna da solo con avviso breve di 4 s restando sulla pagina corrente; IDE **mai** automatico, solo banner con Ricarica/Ignora (i salvataggi propri sono esclusi con una finestra di 20 s, altrimenti l'avviso comparirebbe a ogni Ctrl+S); deploy con modifiche pendenti salva e procede. Confermato che l'auto-deploy al salvataggio quando connessi esisteva già.
- **Diagnosi 2026-07-28: "deploy riuscito ma sul dispositivo la versione vecchia"**. Non era il container né il deploy: `/api/remote/deploy` costruisce lo ZIP leggendo il progetto **da disco**, e le modifiche fatte nell'editor non erano state salvate. Provato con gli hash: i tre file sul device erano **byte-identici** a quelli su disco nell'editor, con mtime del giorno prima. Corretto con `flushBeforeDeploy()`: il deploy ora salva prima di esportare e si annulla se il salvataggio fallisce. Nota: la discovery mDNS ha funzionato al primo colpo dal browser del maintainer (`http://192.168.1.84:8444` trovato da "Cerca runtime"), quindi anche il fix dello schema annunciato è confermato in uso reale.

- **Sessione 2026-07-28 (2) — gestione container (su richiesta: "sistema il più possibile")**:
  - **Avvio al boot**, il buco principale: un container rootless non riparte dopo un reboot nemmeno con `--restart=unless-stopped`. Nuova unit **quadlet** `deploy/container/sws-runtime.container` + `deploy/container/install-container.sh` che gira **sul device senza sudo** e fa tutto (immagine, volumi, unit, linger, attesa di `/health`). Idempotente: i volumi esistenti non si toccano; il container precedente **va** rimosso, perché continuerebbe a usare l'immagine vecchia anche dopo `podman load` sullo stesso tag.
  - **Volume dei log**: prima i log stavano nel layer scrivibile e sparivano alla ricreazione.
  - **mDNS — la mia spiegazione di ieri era sbagliata**: non è il confine di subnet (il device *viene* scoperto da questa macchina), è la rete bridge di podman che non passa il multicast. Con `--host-network` la discovery funziona, verificato. Inoltre l'annuncio pubblicava sempre `https` anche girando in HTTP → URL offerto non funzionante: ora pubblica lo schema reale (`discover.rs` lo legge con default `https` per i runtime più vecchi).
  - **Bug preesistente trovato**: `hostname -I` in `deploy/yocto/install.sh` e `deploy/generic-linux/install.sh` — opzione di net-tools, inesistente dove `hostname` è di coreutils (Pixsys OS). Con `set -euo pipefail` abortiva l'installer **sul messaggio finale**, a installazione riuscita. Sostituito con `ip -4 -o addr`, che elenca tutti gli indirizzi (questi device ne hanno più di uno: `192.168.1.84` e `192.168.60.200`).
  - **Misurato sul device**: `podman stop` 1,3 s con exit 0 (prima 10 s + SIGKILL); deploy dall'IDE su `:8444` completo; connect su `:8443` rifiutato col messaggio corretto; progetto conservato dopo reinstall; unit `active` con `NRestarts=0`; discovery da altra macchina LAN ok in host network.
  - **Nota**: il deploy di test ha cancellato un progetto `test1` che era sul device — il deploy remoto svuota i progetti remoti prima di caricare (voluto, mono-progetto T-34). Il container era spento quando avevo sondato, quindi non l'avevo visto.
  - **Non provato**: il **reboot** del device, unica verifica reale che linger+unit facciano ripartire il container. Non l'ho fatto di mia iniziativa: se non tornasse su servirebbe accesso fisico.

- **Sessione 2026-07-28 — fix connect-porta + SIGTERM**:
  - **`connect_remote` non verificava nulla in no-auth mode**: causa reale del deploy fallito di ieri. L'handler salvava l'URL senza fare **alcuna** richiesta al target, quindi l'IDE diventava verde anche puntando alla porta viewer (o a un host inesistente); il 404/405 emergeva solo a metà deploy, perché le route di progetto stanno solo sulla porta admin. Ora sonda `GET /api/projects` — pre-auth sulla admin, assente sulla viewer — e su 404 rifiuta indicando la porta giusta. `/health` non sarebbe servito: risponde su entrambe.
  - **SIGTERM**: nuova `shutdown_signal()` (SIGINT **o** SIGTERM, con degrado a solo SIGINT se l'handler non si installa, invece di panic). Prima ogni `podman stop`/`systemctl stop` aspettava il grace period e finiva in SIGKILL, con rischio di troncare scritture.
  - **Verifica fatta**, non solo build: due istanze locali (viewer 8543+admin 8544 come target, admin 8546 come IDE) → connect verso 8543 rifiutato col messaggio corretto, verso 8544 accettato, verso porta chiusa errore di rete. SIGTERM: uscita in ~100 ms con `shutdown signal received` a log. `cargo test -p sws-web` 17/17.
  - **Nota di metodo**: i primi due tentativi di test SIGTERM si sono auto-sabotati — `pgrep`/`pkill -f "admin-port 8544"` matchavano la command line della mia stessa shell, uccidendola. Spostati in uno script su file, il pattern non si auto-matcha più.

- **Sessione 2026-07-27 (4) — container podman aarch64**:
  - **Perché non si è riusato il Dockerfile esistente**: è marcato legacy nei doc e ha quattro difetti concreti — compila Rust dentro l'immagine (ore in emulazione arm64), il builder non ha `libpython3-dev` mentre pyo3 usa `auto-initialize` (il link fallisce), il `CMD` non passa `--viewer-port`/`--www` (viewer mai in ascolto, healthcheck su 8443 perennemente rosso) e l'entrypoint pretende `SWS_ADMIN_PASSWORD`, che precede il no-auth mode. Resta intatto: è il percorso container x86 storico.
  - **Base image imposta dal binario, non scelta**: `readelf` sul binario cross dà `NEEDED libpython3.12.so.1.0` e simboli fino a `GLIBC_2.39` → serve Python 3.12 **e** glibc ≥ 2.39 insieme. `debian:bookworm-slim` (2.36 + 3.11) e `debian:trixie-slim` (2.41 + 3.13) sono entrambe fuori; `ubuntu:24.04` combacia.
  - **Trappola trovata in corso d'opera**: `HEALTHCHECK` non esiste nella spec OCI, quindi col formato di default podman lo scarta con un warning e `podman ps` non direbbe mai `healthy`. Lo script costruisce con `--format docker`.
  - **Esito sul device**: entrambi i listener su, `/health` ok da device e da LAN, SPA servita, template popolati, `podman ps` → `healthy`, progetto sopravvissuto alla **ricreazione** del container (volumi nominati, non bind mount: sotto rootless i bind mount richiedono che gli UID combacino con `subuid`). **RestrictedPython disponibile** → script sandboxati, cosa che l'immagine legacy non otteneva.
  - **Difetto scoperto, non risolto**: il runtime intercetta solo `ctrl_c()` (SIGINT), non SIGTERM (`main.rs:939`) → ogni `podman stop`/`restart` attende 10 s e finisce in `SIGKILL`, interrompendo eventuali scritture su `project.yaml`/SQLite. Riguarda anche il percorso systemd nativo, dove è solo meno visibile. **→ risolto il 2026-07-28.**
  - **Primo test dall'IDE (maintainer) — due esiti, entrambi NON bug del container**:
    1. **Deploy fallito con 404 + 405**: l'IDE era connesso a `http://192.168.1.34:**8443**`, la porta viewer. Le route di lifecycle progetto (`GET /api/projects`, `POST /api/projects/upload`) esistono **solo sulla 8444** — architettura dual-port voluta, `docs/CONTEXT.md`. Verificato sul device: su 8443 → 404 e 405, su 8444 → 200 e 400 (400 = corpo mancante, cioè la route c'è). **Soluzione: connettersi a `http://192.168.1.34:8444`.** Resta però un difetto di UI: "Connetti" verso la 8443 riesce e mostra "● Connesso" in verde, perché controlla solo `/health`, che risponde su entrambe le porte — dà per buona una connessione da cui il deploy non può funzionare. **→ risolto il 2026-07-28** (causa reale: in no-auth mode `connect_remote` non contattava affatto il target).
    2. **"Cerca runtime" non lo trova**: due cause indipendenti, nessuna risolvibile lato container. (a) mDNS è link-local e **non attraversa subnet diverse** — la dev box è su `192.168.0.201`, il device su `192.168.1.34` (debito già noto); (b) anche a parità di subnet, sulla rete rootless di podman il multicast non raggiunge la LAN: servirebbe `--network host`. Da riprovare con IDE e device sulla stessa subnet e container in host network.
  - **Permessi**: `Bash(ssh *)`/`Bash(scp *)` erano in **deny** (il deny vince sull'allow, `docs/CLAUDE_CODE_SETUP.md:248`); su indicazione del maintainer sono stati tolti dal deny e sostituiti da un allow ristretto a `user@192.168.1.34`. `Bash(rsync *)` resta in deny. **Da rivalutare a fine test.**

> **La storia della linea "office" è conservata dal tag `archive/office-2026-05-21`** (commit
> `4d93de8`), presente in locale **e su `origin`** dal 2026-07-29. I tag non vengono potati dal `gc`:
> quei 151 commit restano raggiungibili anche se i branch che li puntavano non esistono più. Vale la
> pena saperlo prima di allarmarsi: cancellando `archive/office-line-2026-05-21` avevo scritto che la
> storia andava perduta, ed era falso — il tag c'era già, semplicemente non l'avevo cercato.
>
> **`backup/friday-phase-a1` eliminato il 2026-07-29** (locale + remoto), punta `42babe9`. Era un
> backup del venerdì sera 15 maggio sulla stessa linea "office": si separava a `f1cd49f` con **un
> solo commit proprio**, il frontend di Phase A1 in corso d'opera (`WelcomeScreen` di 406 righe).
> Superato due volte — dalla versione completa sulla linea office (`a4fa839`, raggiungibile dal tag) e
> da quella indipendente sulla linea di `main` (`5f17bf1`, dove `WelcomeScreen.tsx` è oggi 1190
> righe). I 63 commit condivisi restano raggiungibili dal tag: l'eliminazione ha reso irraggiungibile
> solo quel WIP.

> **`archive/office-line-2026-05-21` eliminato il 2026-07-29** (locale + remoto), punta
> `4d93de8e76fe479be77c9714d9378716f2a46da9`. Non era un branch di feature: era una **linea di
> sviluppo parallela e non correlata** — nessun antenato in comune con `main`, radice diversa
> (`522df09`), 151 commit dal 10 al 21 maggio, dall'`Initial commit` fino a `feat(rbac): restrict
> Operator/Viewer to runtime-only`. Copriva TagDb, Modbus, MQTT, auth, historian, UX dell'editor,
> oggetto grid, OPC-UA, `sws-kiosk`, cross-build Yocto, RBAC — tutto rifatto meglio sulla linea di
> `main`, che alla data della cancellazione era avanti di 59.742 righe rispetto a quella punta.
>
> Solo 4 file esistevano lì e non in `main`: `ProjectIO.tsx` (rimosso di proposito), `scripts/dev.sh`
> (sostituito da `start_runtime.sh`/`start_editor.sh` — i riferimenti rimasti indietro sono stati
> corretti in `ed17fe9`), `SWS_Repository_Bootstrap_Prompt.md` e un piano del 14 maggio poi
> realizzato (`BindableInput`). **Nota: quei 151 commit non erano raggiungibili da nessun altro ref**,
> quindi dopo il `gc` non sono più recuperabili — a differenza dei branch qui sotto, il cui
> contenuto vive in `main`.

> **`feat/container-aarch64` chiuso il 2026-07-29**, punta `634665c809ee7680270546199e86b6ccf328ab10`.
> 18 commit dal 27 al 29 luglio (container podman aarch64, deploy sul dispositivo, viewer a schermo
> pieno, Telegram per-allarme, notifiche morte al boot, segreti nei bundle, perdita di dati di
> "Salva tutto"), entrati in `main` con lo squash `72b6b3c`. Il **contenuto** è in `main`; quello che
> si perde dopo il `gc` è la storia granulare — i 18 messaggi di commit, che erano la parte più
> documentata della sessione. Il riassunto vive nel messaggio di `72b6b3c` e il dettaglio in
> `CHANGELOG.md` e nelle voci qui sopra.

> **Branch chiusi il 2026-07-29.** Le due catene dell'editor sono entrate in `main` con gli squash
> `2ef99e6` (catena A: percorso progetto, progetti recenti, preset per brand, creazione cartelle,
> apertura da ZIP) e `3bddb66` (catena B: stato non salvato + Ctrl+S, controlli zoom, header a due
> livelli, rimozione di `ProjectIO`). Lo squash crea hash nuovi, quindi `git branch --merged` non li
> elencava pur essendo il contenuto già dentro: verificato funzione per funzione (`selectIsDirty`,
> `setZoomCentered`, `MainMenu`, `getDevicePresets`, `fs/mkdir`, `openFromZip`) e per dimensione dei
> file condivisi, dove `main` è sempre il più grande. Un merge tardivo avrebbe **riportato indietro**
> il codice: quei branch contengono la vecchia firma di `router::build`, il vecchio export di
> `alarm.rs` e la gestione segnali con solo `ctrl_c`.
>
> Punte cancellate, recuperabili con `git checkout <sha>`:
>
> | branch | punta |
> |---|---|
> | `feat/dirty-state-and-save` | `435de806d7337a27269eb7f8e1c78c8bfc9e851e` |
> | `feat/editor-zoom-toolbar` | `68dec23842f1f149be4ff167f9def20ee46a6c35` |
> | `feat/fs-mkdir` | `e3001a75e23df9102fd5fecd867b911d4c2016bc` |
> | `feat/slim-app-header` | `9ae8acc83c085f71ecc5ae72cc0393722cdb4836` |
> | `feat/project-location-and-brand-presets` | `80d948c69a9715d6360e529f2ea0a513ec69e417` (locale) / `918c274365218d52b14e10e6b61eecf6a3bf0874` (remoto) |
>
> Erano incatenati per evitare conflitti su `App.tsx`/`EditorShell.tsx`/`WelcomeScreen.tsx`; al merge
> l'unico conflitto di codice fra le due catene è stata la riga di import di `pageLayout` in
> `EditorShell.tsx`. `feat/container-aarch64` resta in piedi (mergiato in `main` come `72b6b3c`):
> `CLAUDE.md` chiede di non cancellare i branch subito dopo il merge.

- **Sessione 2026-07-29 — demo Sandokan (MQTT reale) + fix storico perso al riavvio (cherry-pick diretto in `main`, non branch dedicato — vedi nota di processo)**:
  - **Template `examples/templates/nebulizzatore-sandokan/`**: presa smart Zigbee2MQTT reale (NEO NAS-WR01B, `zigbee2mqtt/presa.sandokan` su `192.168.1.6:1883`) che alimenta un nebulizzatore antizanzare — sorgente MQTT multi-`json_path` sullo stesso topic, storico SQLite, due allarmi soglia 1W (`Above`/`Below`, l'unico modo per avere due notifiche Telegram distinte accensione/spegnimento — il motore invia Telegram solo sull'attivazione, mai sul rientro), pagina con simbolo pompa animato + 3 trend separati (potenza/corrente/tensione, assi indipendenti per non schiacciare i valori piccoli contro la tensione). Bot Telegram reale rilevato via `getUpdates` (stessa tecnica del pulsante "Rileva chat") e configurato **solo** nei progetti locali gitignored, mai nel template committato. Importato come progetto "Sandokan" su IDE e runtime (creazione indipendente su entrambi via l'endpoint pre-auth, non il flusso "Deploy" one-click che avrebbe cancellato il progetto "default" già attivo sul runtime).
  - **Bug trovato durante il test**: il maintainer nota che il trend non mostra lo storico pregresso all'apertura pagina, solo i dati da quel momento in poi. Isolato confrontando una query SQLite diretta (448 campioni dalle 21:54 della sera prima) con la risposta API nello stesso istante (15 campioni, solo dal riavvio del processo delle 06:49) — il percorso di boot "legacy auto-open" in `main.rs` non chiamava mai `historian.swap_store(...)`, a differenza di `open_project` (handler HTTP) che lo fa correttamente dal commit `2911d14`. Fix: stessa chiamata aggiunta al percorso di boot. Verificato in log (`historian: swapped to project SQLite`) e via API (storico completo tornato).
  - **Preset "Tutto"** nel pop-up espanso del trend (oltre 1h/8h/24h/7d): risolve `fromMs` dal campione più vecchio via l'endpoint stats già esistente.
  - **Nota di processo**: lavoro fatto sul branch `feat/project-location-and-brand-presets` (che nel frattempo un'altra sessione aveva già in parte squash-mergiato in `main` tramite una catena diversa, `feat/fs-mkdir`). Uno squash dell'intero branch avrebbe ri-toccato file già superati da lavoro indipendente su `main` (refactor `App.tsx`/header/toolbar); invece, dopo aver riallineato `main` a `origin/main`, **cherry-pick mirato** dei soli 2 commit realmente nuovi (`718a3bb` demo, `d3fef51` fix storico) — nessun conflitto, `cargo build`+`pnpm build` verdi. Branch locale cancellato dopo la verifica; il branch remoto resta finché `main` non viene pushato (per non lasciare il lavoro assente da GitHub nel frattempo).
  - **Verifica**: `cargo build` (sws-core/-web/-runtime) + `pnpm build` verdi; storico e allarmi confermati via API sul runtime live dopo il riavvio; **validato dal maintainer** ("funziona").

- **Sessione 2026-07-27 (3d) — cartelle + copia sul PC (branch `feat/fs-mkdir`)**:
  - **`POST /api/fs/mkdir`** accanto a `browse-dirs`: parte pura `resolve_new_dir()` (testabile senza `AppState`, riusa `safe_project_name`), `create_dir` e **non** `create_dir_all` — un refuso in `parent` non deve materializzare un albero. 409 su esistente, 403 su permessi.
  - **Postura di sicurezza**: la route entra nel gruppo **pre-auth** `project_lifecycle` come `browse-dirs`, perché il selettore serve prima che esista una sessione. Non aggiunge capacità nuove (`POST /api/projects` con `parent_path` fa già `create_dir_all` arbitrario), ma la superficie `/api/fs/*` pre-auth è ora annotata in `docs/OPEN_QUESTIONS.md` sotto Q8 come debito da chiudere al passaggio a prodotto.
  - **UI**: "＋ Nuova cartella" nel `DirectoryBrowser` con input inline (Invio/Esc) — non `prompt()`, che non è traducibile né stilabile ed è soppresso in alcune webview kiosk (questa app gira su WebPanel). Dopo la creazione si entra nella cartella nuova.
  - **"📂 Apri da file ZIP…"** nella WelcomeScreen: esisteva già dietro "Nuovo progetto → Da ZIP", ora ha un ingresso proprio. È **non distruttivo** (nuovo progetto), a differenza della voce nel ☰.
  - **Verifica**: `cargo check -p sws-web` + `cargo test -p sws-web` (17 test, 2 nuovi) + `pnpm build` verdi; **validato in browser dal maintainer**.

- **Sessione 2026-07-27 (2) — percorso progetto a scelta + progetti recenti + preset brand (branch `feat/project-location-and-brand-presets`)**:
  - **Registro `known_projects.json`** (nuovo `sws-web/src/project_registry.rs`): mappa `nome → {path, last_opened_ms}`, persistito in `config_dir`, caricato in `AppState.known_projects`. Toccato automaticamente da `create_project`, `open_project` e `upload_project_zip` — copre sia i progetti in `projects_root` sia quelli a percorso custom.
  - **Percorso a scelta in creazione**: `CreateProjectRequest.parent_path` (+ query `?parent_path=` su upload ZIP) opzionale, path assoluto validato/creato con `create_dir_all`; assente = comportamento invariato (`projects_root`). Nessuna whitelist di radici (scelta esplicita del maintainer — PoC, LAN fidata).
  - **`list_projects`** ora unisce la scansione legacy di `projects_root` con lo snapshot del registro, **ordinata per `last_opened_ms` decrescente** (elenco "progetti recenti"); nuovi campi DTO `path`, `last_opened_ms`, `external`.
  - **`rename`/`duplicate`/`delete`**: risoluzione via registro; comportamento differenziato per le voci **esterne** (path fuori da `projects_root`) — rename non sposta la cartella (solo `meta.name` + chiave registro), duplicate crea una cartella sorella nello stesso genitore, delete **de-registra soltanto** senza toccare i file (mai cancellare a sorpresa dentro Documenti/backup del maintainer).
  - **Nuovo endpoint `GET /api/fs/browse-dirs`**: mini file-browser server-side (elenca sottocartelle, naviga su/giù), nessuna whitelist, default `$HOME`/`projects_root` se `path` assente.
  - **Frontend**: `WelcomeScreen.tsx` → `NewProjectModal` ha una sezione "Cartella di destinazione" (comune alle 3 tab: vuoto/template/ZIP) con campo testo + pulsante "Sfoglia…" che apre il nuovo componente `DirectoryBrowser`; anteprima live del path finale. Ogni card progetto mostra il `path` come sottotitolo/tooltip, badge "esterno" e — per le voci esterne — l'azione "Elimina" diventa "Rimuovi dall'elenco".
  - **Preset dispositivo legati al brand**: `Brand.devicePresets` (letto da `meta.device_presets` in `brand.json`); i 5 modelli Pixsys (WP570/WP800/WP815-615/WP820-620/WP830-630) spostati da `pageLayout.ts` (hardcoded) a `public/branding/pixsys/brand.json`. `DEVICE_PRESETS` → `STANDARD_DEVICE_PRESETS` + nuova `getDevicePresets()` = standard + preset del brand attivo; dropdown raggruppato in due `<optgroup>`.
  - **Verifica**: `cargo build -p sws-core -p sws-web -p sws-runtime` + `cargo test -p sws-web` (15 test) + `pnpm build` verdi; **validato in browser dal maintainer**.
  - **Nota di processo**: lavoro inizialmente iniziato per errore sul working tree di `main` — spostato su branch dedicato prima del commit.

- **Sessione 2026-07-27 (3b) — zoom + toolbar editor (branch `feat/editor-zoom-toolbar`)**:
  - **Il problema segnalato**: zoomando non c'era modo di tornare alla pagina intera. Gli unici comandi erano un badge `%` non cliccabile e un `⊡` in un angolo del canvas — e quel `⊡` adattava **agli oggetti**, non alla pagina.
  - **`fitPage()`** nuova: dimensioni reali della pagina meno la fascia righelli e 24px di margine per lato; in modalità **fluida** ricade su `fitObjects` e il pulsante è disabilitato con tooltip. Dimensione calcolata dalla nuova pura `editorFitSize()` in `pageLayout.ts`. **`Ctrl+Shift+0` ora adatta la pagina** (via ref, così segue la pagina corrente).
  - **Slider** a passi discreti 10→400%; la `%` mostrata è il valore vero (un Ctrl+rotella intermedio resta onesto), cliccarla torna al 100%.
  - **`EditorToolbar`** nuova (solo in Editor, tra header e tab pagine): undo/redo (finora **solo da tastiera**), griglia+snap spostati dall'header, righelli, zoom. Estratta anche `PageTabs`.
  - **Scelta architetturale**: zoom/pan restano in ref locali dentro `SvgCanvas` ed escono con un handle imperativo `CanvasViewApi`; nello store il pan (frequenza mousemove) farebbe rigirare i selettori di tutta l'app ~60 volte/s. `applyView` notifica il genitore solo se il fattore cambia davvero. `showRulers` invece va nello store: toggle discreto con due punti di ingresso.
  - **Verifica**: `pnpm build` verde; nuovo `tests/pageLayout.test.ts` (4 casi) — ha subito trovato che `referenceResolutionFor` restituisce l'intera voce `ASPECT_RATIOS` e non solo width/height, normalizzato.

- **Sessione 2026-07-27 (3c) — header a due livelli (branch `feat/slim-app-header`)**:
  - Risposta alla domanda "cosa serve raramente": **tema, lingua UI, Reboot, pannello Log**. Log e Reboot → ☰ (con conferma e gate `canConfigureProject`); utente + pill ruolo, lingua e tema → nuovo menu **👤**, che di proposito non contiene azioni privilegiate (identico per tutti i ruoli).
  - Ordine finale: logo · pill runtime remoto · progetto + pallino non salvato · Editor|Config · acquisizione + Start/Stop · Deploy · 👤 · ☰.
  - **Scomposizione, non riscrittura**: `App.tsx` 1047 → 626 righe; estratti `BrandLogo`, `RuntimeCtrl` (meno Reboot), `MainMenu`, `UserMenu`, `headerStyles.ts` (+ hook `useOutsideClose`, prima duplicato). Tradotte le ultime stringhe IT hardcoded toccate.
  - **Attenzioni rispettate**: `<input type=file>` resta fuori da `{open && …}` (GitHub issue #2); l'etichetta "☰ Menu" è invariata (tre spec e2e ci dipendono); i gate di ruolo riapplicati uno per uno dopo lo spostamento.
  - **Copia sul PC trovabile**: "Esporta/Importa progetto" → **"💾 Salva copia sul PC…"** / **"📂 Sostituisci da copia sul PC…"** (restano Admin-only). Aggiornato il selettore di `e2e/import-tags.spec.ts` nello stesso commit. Eliminato `ProjectIO.tsx`, duplicato morto degli stessi flussi.

- **Sessione 2026-07-27 (3) — stato "modificato", Ctrl+S, salvataggio globale (branch `feat/dirty-state-and-save`)**:
  - **Contesto**: richiesta del maintainer (4 migliorie all'editor). Analizzando il codice sono emersi tre buchi non sospettati: `Ctrl+S` **non esisteva**, non c'era `beforeunload`, e in modalità Configurazione salvare era *fisicamente impossibile* (il salvataggio era un contatore `saveSerial` a cui reagiva `EditorShell`, che lì è smontato).
  - **Modello dirty riscritto**: `isDirty` era acceso solo da `pushHistory` (tab di Configurazione invisibili) e undo/redo non lo toccavano (undo fino allo stato salvato lo lasciava acceso). Ora è un selettore derivato `selectIsDirty` su due sorgenti: contatore `pagesRev` timbrato nelle voci di history (ripristinato da undo/redo/jumpTo) con `savedPagesRev` scritto solo da un salvataggio completo; e registro `pendingSections` (chiave → come salvarsi) in cui si registrano la `SaveBar` della tab attiva e il `FunctionEditor`. Il campo `isDirty` è stato **rimosso** perché non possa disallinearsi.
  - **Trappola evitata**: i setter `updateProject*` non marcano dirty — le tab salvano su API e *poi* aggiornano lo store, quindi la copia in memoria combacia sempre col disco; marcarli renderebbe il progetto sporco per sempre.
  - **`saveAll()` nello store** al posto di `saveSerial`: svuota prima le bozze registrate, poi salva pagine + sezioni di progetto (Admin). "Salva tutto" nel ☰ non è più editor-only. `waitingForSave` ora aspetta `saveStatus === "ok"` e non `!isDirty` (altrimenti una tab sporca bloccherebbe "Salva e chiudi" all'infinito).
  - **UI**: `DirtyIndicator` (pallino ambra cliccabile) accanto al nome progetto nell'header di app, `●` nel titolo scheda, `Ctrl+S` globale, `beforeunload` solo mentre sporco, `resetDirty()` su chiudi-progetto/logout (altrimenti dopo un "chiudi scartando" un F5 chiederebbe conferma per un progetto non più aperto).
  - **Fix collaterale**: `renameGroup` mutava le pagine senza `pushHistory` — invisibile sia a undo sia al flag.
  - **Verifica**: `pnpm build` verde; nuovo `tests/dirtyState.test.ts` 6/6 verde (undo fino al salvato, redo, undo oltre il salvato, bozze indipendenti dal canvas, resetDirty); **validato in browser dal maintainer**. Nota: `pnpm lint` non parte sulla dev box (manca `eslint-plugin-react-hooks` in `node_modules`) — preesistente.
  - **DA FARE (browser)**: vedi elenco validazioni in sospeso.

- **Sessione 2026-07-27 (1) — gestione pagine + pannelli ridimensionabili + fix lang_selector (branch `fix/T-40-regressions`, squash-mergiato in `main`)**:
  - **Dimensionamento pagina** (project-wide): Fisso (1:1 no-scaling)/Solo proporzioni (scale-to-fit su risoluzione standard)/Fluido; `PageSizeMode`/`PageLayoutConfig` su `Project`, endpoint `PUT /api/project/page-layout`; passare a "Proporzioni" propaga la risoluzione a tutte le pagine. Clamp rigido ai confini in editor. Preset dispositivo (5 Pixsys WebPanel + 4 standard) in Proprietà pagina. Pannello "Impostazioni pagine progetto" (⚙): modalità + rapporto + home page.
  - **Home page**: fallback automatico se fuori zona ABAC; rotazione kiosk riparte dalla home.
  - **Riordino drag&drop** pagine + **miniature** live nella lista.
  - **Report "Verifica collegamenti"** (🔗): navbutton con target inesistente + pagine orfane.
  - **Lock pagina** (🔒/🔓): canvas e pannello proprietà read-only via `fieldset[disabled]`, non blocca duplica/elimina.
  - **Fix collaterale**: `auto_rotate_skip` mancava dal mirror Rust `synoptic.rs` → perso ad ogni GET (round-trip) — corretto.
  - **Pannelli editor ridimensionabili** (sinistra 160–480px, destra 220–560px), persistiti in localStorage.
  - **Fix bug**: oggetto "Lingua ▾" (`lang_selector`) non trascinabile in editor — `<select>` HTML dentro `foreignObject` montato anche in edit mode intercettava il mousedown; riallineato al pattern slider (preview SVG in editor, widget reale solo a runtime).
  - **Verifica**: `cargo build` (sws-core/-web/-runtime) + `pnpm build` verdi; e2e manuale via API (round-trip locked/auto_rotate_skip/page_layout, audit trail) su runtime reale; **validato dal maintainer in browser** (pannelli + drag lang_selector confermati funzionanti).

- **Sessione 2026-07-26 (2) — Q8: isolamento runtime↔IDE — modalità operator-only + audit log**:
  - **Contesto**: analisi della history del progetto su richiesta del maintainer → identificati task abbandonati (nessuno critico) e il gap architetturale più rilevante: runtime e IDE/admin condividono lo stesso processo (`AppState` unico, due router sulla stessa istanza). Documentato come **Q8** in `docs/OPEN_QUESTIONS.md` con roadmap A(operator-only)/B(gating)/C(reload granulare)/D(audit)/E(split processi)/F(python out-of-process).
  - **A — modalità `--no-admin`** (`sws-runtime/src/main.rs`, `sws-web/src/router.rs`): non binda la porta admin/IDE (richiede `--viewer-port`); riduce la superficie a viewer + funzioni bound.
  - **B — gating**: in quella modalità `/api/script/exec` (codice arbitrario) non è registrato sul viewer; `/api/script/run/:name` (bottoni) resta.
  - **D — audit log reale** (`sws-audit`, prima uno stub): hash-chain SHA-256 + HMAC opzionale (`SWS_AUDIT_KEY`), JSONL append-only, `verify()` rileva manomissioni. Cablato su login/logout/tag-write/script-exec/script-run/modifiche-config (tags/sources/alarms/notifications/global_scripts). Endpoint `GET /api/audit` + `/api/audit/verify` (Admin). Vista read-only in Configurazione → Sistema.
  - **Verifica end-to-end fatta** (non solo build): runtime avviato, tag write + script exec → `GET /api/audit` mostra le entry con hash-chain corretta, `verify` → `ok:true`; alterata a mano una entry nel file → `verify` rileva `broken_at` corretto. `cargo build` (sws-audit/-web/-runtime) + `pnpm build` verdi.
  - **DA FARE (browser/runtime)**: validare la vista Audit in Configurazione → Sistema; provare `--no-admin` su un device reale (richiede `--viewer-port` impostato, es. `start_runtime.sh`).

- **Sessione 2026-07-26 (1) — Notifiche Telegram + uniformazione tasto Salva**:
  - **Telegram** (canale allarmi + funzione script `send_telegram`): nuovo `TelegramConfig` in `NotificationConfig`; `sws-web/src/telegram.rs` (`TelegramSender` drainer + `reqwest`, config hot-swappabile); allarmi `ActiveUnacked`/escalation → chat globali Telegram (in `notifications.rs`); binding `send_telegram("testo")` iniettato negli script globali (pyscript HTTP-free, spinge su canale mpsc drenato da sws-web); `bot_token` mascherato nelle GET. **UI** in Notifiche: toggle/token/chat + **"Invia test"** e **"Rileva chat"** che chiamano la Bot API **direttamente dal browser** (funzionano dal solo editor), con auto-retry sul rilevamento. Endpoint `POST /api/notifications/test-telegram` (server-side, non più usato dal frontend). **Scope**: `send_telegram` attivo negli script globali (nelle funzioni esiste ma "non configurato" — follow-up).
  - **Fix persistenza Notifiche**: `NotificationsTab` non aggiornava lo store dopo il save → config spariva al cambio tab. Nuovo setter `updateProjectNotifications`.
  - **Uniformazione tasto Salva**: `SaveBar` verde, in alto a destra, sticky, con feedback "✓ Salvato", applicata a tutte le tab con salvataggio (Tags/Protocolli/Allarmi/Notifiche/Script/Datastore/Lingue); Faceplate/Ricette ricolorate a verde; aggiunto feedback dove mancava (Datastore).
  - **DA FARE (browser/runtime)**: rebuild+restart runtime per attivare allarmi Telegram + `send_telegram` negli script (config/test già funzionano dall'editor); validare uniformazione Salva.

- **Sessione 2026-07-24 — fix MQTT + palette + feature "Estrai da JSON"**:
  - **MQTT packet size**: nessun client impostava `set_max_packet_size` → default rumqttc 10 KB → un retained da 29 KB rompeva browse + ricezione live. Fix: costante `MAX_PACKET_SIZE_BYTES = 5 MB` su `connect`/`browse`/sparkplug ([sws-plugin-mqtt](sws-runtime/crates/sws-plugin-mqtt/)).
  - **MQTT browse durata**: default 30 s (era 8), cap 120 s (era 15) — [router.rs](sws-runtime/crates/sws-web/src/router.rs) + input frontend.
  - **Fix palette su progetto vuoto**: `addObject` non aveva pagina corrente → nessun oggetto aggiunto. Ora crea la pagina al volo ([store/index.ts](sws-editor/src/store/index.ts)).
  - **Feature "Estrai da JSON"** ([ConfigView.tsx](sws-editor/src/config/ConfigView.tsx)): pulsante nella card MQTT → incolli un payload JSON → appiattimento a variabili foglia (dot-path annidati, tipo dedotto), selezione → genera righe `TopicMapping` + opzionale creazione `TagDef`. Interamente frontend (il plugin naviga già i json_path).
  - **DA FARE (maintainer, browser)**: riavvio runtime per il cap durata 120 s (packet size già live); hard-refresh per palette + Estrai-JSON.

- **Sessione 2026-07-21 — anteprima lingua editor + filtro/ordinamento tabella Lingue**:
  - **Sintomo (maintainer)**: nell'editor, cambiando lingua, i testi degli oggetti sul canvas non cambiavano. **Causa**: `EditorShell` cablava l'anteprima sulla lingua predefinita del progetto e il corpo non sottoscriveva nulla di reattivo alla lingua → il memo `canvasObjects` non ricalcolava.
  - **Decisioni maintainer**: (1) anteprima canvas indipendente dalla lingua UI; (2) i due selettori (Progetto + Editor) stanno nel tab Configurazione → Lingue; «Lingua progetto» = sorgente/predefinita (`table.default`), «Lingua Editor» = anteprima; (3) tabella messaggi filtrabile + ordinabile.
  - **Implementato**: nuovo `editorPreviewLang` nello store (`sws.editorPreviewLang`, helper in `projectI18n.ts`); `EditorShell` legge `previewLang` dallo store (fallback a default); `LanguagesTab` con 2 selettori + filtro per colonna (case-insensitive) + ordinamento per colonna (asc→desc→off, solo visuale); vista index-safe (`origIdx`) così le modifiche colpiscono la riga giusta con filtro/ordine attivi; rimozione lingua/import CSV azzerano filtri stale; nuove chiavi i18n IT/EN.
  - **DA FARE (maintainer, browser)**: hard-refresh `:8460` → tab Lingue: 2 selettori + filtro/ordinamento; «Lingua Editor»=en → canvas oggetti in inglese.

- **Sessione 2026-07-13 — T-39 + T-40 + fix regressioni + template**:
  - **T-39 — IDE/Runtime bilingue IT/EN** (11 commit `e454d6b`…`b786b99`): infra react-i18next (IT base + EN, lingua da `localStorage sws.uiLang` → browser → it, fallback en), `UiLangSelect` in header IDE e nav viewer, **~667 chiavi** estratte da tutta la chrome (App shell, viewer, LeftPanel, auth, WelcomeScreen, componenti minori, EditorShell ~190 label, ConfigView 14 tab). Asse UI indipendente dai contenuti di progetto.
  - **T-40 — tabella lingue di progetto** (`79825df`, `895dbfe`): Rust `LanguageTable {default, langs, entries:[{key,values}]}` + campo `Project.languages` (`#[serde(default)]`, viaggia con export/import ZIP) + `PUT /api/project/languages`. Frontend: `src/i18n/projectI18n.ts` (`resolveMsg` risolve `{{token}}` nella lingua corrente; `localizeObjects` applicato a monte di SvgCanvas nel viewer/editor), store `projectLang`, tab **"Lingue"** in ConfigView (griglia + CSV export/import), oggetti canvas `lang_selector`/`lang_button` + token-picker nel pannello proprietà. Round-trip e2e verde (`e2e/lang-table.spec.ts`).
  - **Fix 2 regressioni T-40** (`4a0f8a2`, e2e `e2e/bugcheck.spec.ts`): (1) **crash su selezione oggetto** — selettore Zustand instabile in `ObjectProps` (`…entries?.map()` → nuovo array a ogni render → loop infinito) → risolto con `useMemo` su `entries`; (2) **nuovo progetto vuoto mostrava il contenuto del precedente** — il mount-effect in `App.tsx` usciva senza `setPages([], "")` sui synoptic vuoti → aggiunto azzeramento pagine/faceplates.
  - **Template conformi IT/EN** (`42094b3`): **479** stringhe `label`/`text`/`pipe_label` tokenizzate `{{token}}` + tabella `languages` (it/en) in tutti i 9 template (homeassistant-pro 154 voci, casa-locale 135, ecc.; s7/enip/sparkplug-demo tabella vuota). `lang_selector` in Page 1 dei 6 con contenuto. **Insidia risolta**: key `on`/`off` quotate (altrimenti booleani YAML rompono il load).
  - **Capitolo manuale "Multilingua"** (`docs/manual/15_multilingua.md`), riga aggiunta all'indice in `MAIN.md`.
  - **DA FARE (browser)**: validazione di T-39/T-40 (switch lingua UI header, tab Lingue, `lang_selector` in un template, no-crash su selezione, nuovo progetto vuoto pulito).

---

## Storico (sessioni chiuse: mergiate e verificate — dettaglio in `CHANGELOG.md` e `git log`)

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
