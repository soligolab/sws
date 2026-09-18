# Multilingua: chiudere il capitolo

> **Stato: PIANO D'ESECUZIONE approvato il 18-09-2026. F0, F1 e F2 fatte; prossima F3.** Nato dal seme
> `docs/archive/2026-09-18-multilingua-residuo.md` (Q43 + Q57) in una sessione di plan col
> maintainer, con due misure fatte prima di scrivere e quattro decisioni prese da lui. Le fasi sono
> rami da una sessione ciascuno; si eseguono in ordine, **una alla volta**.

## Contesto

Il multilingua di progetto è stato costruito e rilasciato (2.8.0, 2.9.0). Il maintainer vuole
**chiudere il capitolo**, e ha chiesto anche di verificare *fino a che punto l'interfaccia
dell'IDE stessa sia multilingua*. Due misure fatte il 18-09-2026 dicono cosa manca — e non è quello
che il seme credeva.

**Tre assi, che vanno tenuti distinti** perché hanno meccanismi, lingue e destinatari diversi:

| Asse | Cos'è | Lingue oggi | Meccanismo |
|---|---|---|---|
| **(a)** interfaccia IDE | menu, schede, dialoghi, tooltip | it, en | `it.json`/`en.json`, `t()`, `UiLangSelect`, `localStorage["sws.uiLang"]`, fallback `en` |
| **(b)** contenuti di progetto | testi dei sinottici, allarmi, script | it/en/es nel parco | `LanguageTable`, `{{token}}`, traduzione automatica |
| **(c)** testo di sistema operatore | intestazioni che il *motore* scrive nella pagina, etichette delle notifiche | LVGL e notifiche it/de/fr/es/en; **web solo it/en** | `testi_sistema.rs`, `etichette()`, `viewerChrome.*` |

### Cosa hanno trovato le misure

**Asse (a) — l'infrastruttura è sana, la copertura no.** 1271 chiavi, parità perfetta it/en protetta
da `tests/i18nParita.test.ts`, 1719 chiamate `t()`. Ma **~320 stringhe italiane cablate** fuori dal
catalogo: `ConfigView.tsx` **204**, `store/index.ts` 29 (etichette undo + errori restituiti ai
componenti; lo store non ha React), `EditorShell.tsx` ~20 (molte sono *contenuto predefinito degli
oggetti* — `"Testo"`, `"Bottone"` — che è asse (b) e non va in `t()`), `SvgCanvas.tsx` 16,
`LeftPanel.tsx` 15, dieci componenti che non importano affatto `useTranslation` (TrendCanvas,
FunctionEditor, TrendExpanded, AlarmHistory, DataTable, XyPlotCanvas, PythonEditor, PageTabs,
BarraAvviso, symbols/library). **26 `confirm/alert/prompt` in italiano cablato** (ConfigView 18,
SvgCanvas 5, LeftPanel 2, EditorShell 1), 31 `title/placeholder/aria` cablati. **Nessuna guardia**
impedisce di aggiungerne altre: l'unica esistente controlla la parità, non la copertura.

**Asse (b) — tre difetti contro promesse dichiarate.** Il marchio `LangEntry.auto` («tradotto
dalla macchina») **non si vede** da nessuna parte; `setVal` **non lo toglie** quando una persona
corregge una cella, quindi «ritraduci tutto» (`sovrascrivi: true`, oggi solo via API) sovrascrive
il lavoro umano — la promessa «una traduzione umana non si sovrascrive mai» è falsa lato web.
`ConfigTraduzione` (fornitore, url, chiave) arriva solo nel corpo della richiesta e **non è
persistita**: la chiave Google si ridigita a ogni sessione, mentre quella IA sta in `config_dir`
0600. Il campo chiave compare solo per Google, non per LibreTranslate che pure l'accetta. Il
dropdown dei fornitori è italiano cablato.

**Asse (c) — tre difetti.** L'**oggetto delle email** (`notifications.rs:308`, `:383`) usa
`state.def.message` grezzo: se il messaggio è un token, l'oggetto contiene letteralmente
`{{allarme_pressione}}` mentre il corpo è tradotto. `"🔴 ALLARME ATTIVO"` e
`"⏫ ESCALATION: allarme non riconosciuto"` sono italiano cablato fuori da `etichette()`.
`notify_lang` **non ha nessun controllo nell'IDE** — si imposta solo a mano nel YAML. E il chrome
del viewer web (`viewerChrome.*`, 8 chiavi) copre solo it/en **e segue la lingua dell'IDE** (`t()`),
mentre LVGL segue la lingua dei **contenuti** (`SharedLang`): un operatore tedesco vede «Zeit» sul
pannello e «Time» nel browser.

### Decisioni del maintainer (18-09-2026)

| | Decisione | Prezzo accettato |
|---|---|---|
| **D1** lingue dell'IDE | **it + en, come oggi** | nessuna terza lingua finché un utente non la chiede |
| **D3** fornitore | **MyMemory resta il default**; il marchio automatico diventa visibile, una correzione a mano lo toglie, la configurazione del fornitore (con la chiave Google) si salva nell'istanza IDE accanto alle chiavi IA | — |
| **D4** segmentazione | **marcare da rileggere**: ogni voce con un segnaposto, tradotta a pezzi, finisce fra le **proposte** (cella rossa) e non fra i valori | ogni formato numerico del progetto va approvato a mano dopo una traduzione — decine di celle rosse su `homeassistant-pro`. Scelto contro il consiglio, con questo prezzo detto |
| **D5** lingua notifiche | **per canale**: email in una lingua, Telegram in un'altra, con ripiego su `notify_lang` e poi su `languages.default` | non copre due persone sullo stesso canale in lingue diverse. Scelto contro il consiglio, con questo prezzo detto |

---

## Principi validi per tutte le fasi

- **Una fase = un ramo** da `main`, squash merge, `git branch -D` dopo il confronto degli alberi.
  Vale anche rispetto al lavoro parallelo sull'immagine di boot (`0243f634`): **mai due rami
  aperti**, nemmeno su assi diversi.
- **Guardia rossa prima.** Ogni fase nomina il test o lo script che deve fallire *prima* del codice.
- **Tetti che scendono e basta.** `check_i18n_ui.sh` porta i numeri di oggi per file: se un file
  cresce fallisce, se cala stampa `↓ abbassa il tetto`. A fine capitolo la tabella è vuota con il
  commento «vuoto dal …: se ricompare una riga, è un file tornato indietro» (idioma di `R2_DEBITO`).
- **Ogni chiave nuova entra in `it.json` e `en.json` nello stesso commit**, o `i18nParita` è rosso.
- **DoD per fase**: `cargo check` + `pnpm build` + `./scripts/check_static.sh` + conferma dal vivo
  del maintainer (ogni fase dice cosa guardare). Dove ci sono test, anche `pnpm test` /
  `cargo test -p <crate>`.
- **Contenuto predefinito degli oggetti non è UI**: `"Testo"`, `"Bottone"`, `"Vai alla pagina"`
  in `handleAddObject` sono asse (b); la guardia li esclude leggendo `TEXT_FIELDS` da
  `projectI18n.ts` (stessa estrazione di `check_i18n_parita.sh`), così l'elenco non marcisce.

## Ordine

| # | Ramo | Asse | Taglia | Perché in questa posizione |
|---|---|---|---|---|
| F0 | meta su `main` | — | 15' | il piano nel repo, il seme in archivio |
| F1 | `feat/i18n-ui-guardia` | a | 3h | ogni fase (a) successiva deve far scendere un tetto |
| F2 | `fix/notifiche-soggetto-tipo-canale` | c | 3h | l'unico difetto **visibile a un cliente** (token nell'oggetto email); porta anche D5 |
| F3 | `feat/testi-sistema-condivisi` | c | 3-4h | «Zeit» / «Time»: divergenza web/LVGL, tabella condivisa |
| F4 | `fix/lingue-marchio-e-proposte` | b | 3h | D3 (marchio) + D4 (proposte) + chiave LibreTranslate |
| F5 | `feat/traduzione-config-persistita` | b | 3h | D3, persistenza del fornitore |
| F6 | `feat/i18n-ui-dialoghi-attributi` | a | 3h | 26 dialoghi a zero, 31 attributi |
| F7 | `feat/i18n-ui-store-e-componenti-muti` | a | 3h | lo store neutro, dieci componenti |
| F8a/b | `feat/i18n-ui-configview-1` / `-2` | a | 3-4h ciascuno | 204 stringhe, spezzate per schede |
| F9 | `feat/i18n-ui-canvas-leftpanel-shell` | a | 2h | gli ultimi tre file; `TETTI` vuoto |

F2–F5 prima di F6–F9 perché sono difetti (cose che mentono a un cliente o contraddicono una
promessa); le stringhe cablate sono debito, e il debito ha la guardia che lo tiene fermo dopo F1.

---

## F0 — il piano nel repo *(meta, su `main`)*

Scrivere questo documento in `docs/plans/2026-09-18-multilingua-chiusura.md`; spostare
`2026-09-18-multilingua-residuo.md` in `docs/archive/` con riga nel README («seme → piano
d'esecuzione»); riga in `docs/plans/README.md` come **IN CORSO**. Le schede Q43/Q57 in
`docs/OPEN_QUESTIONS.md` puntano al seme: aggiornare il rimando al piano nuovo.

## F1 — `scripts/check_i18n_ui.sh`: la guardia dell'asse (a)

> **Fatta il 18-09-2026.** Primo giro: **627 stringhe in 36 file e 35 dialoghi in 4** — il doppio
> della stima dell'esplorazione (~320), perché la guardia guarda anche il **testo JSX** (`<span>Salva</span>`)
> che l'agente non contava. `EditorShell.tsx` da 20 a 71, `ConfigView.tsx` da 204 a 394. Le
> esclusioni vere aggiunte al primo giro, col motivo nel file: due parole deboli **distinte**
> («Lo-Lo» non è italiano), e il testo JSX che contiene `;`/`const`/`=>` è codice pescato fra un
> `=>` e un generico, non una scritta. Provata rossa tre volte: senza tetti, con una stringa in più,
> con un dialogo in più.

**File**: `scripts/check_i18n_ui.sh` (nuovo, bash + `exec python3 - "$PWD" <<'PY'` come
`check_templates.sh`), `scripts/check_static.sh` (riga in `STATICHE`, obbligatoria — senza,
`check_static` fallisce da solo), `scripts/README.md`.

**Euristica**, nell'ordine: (1) perimetro `sws-editor/src/**/*.{ts,tsx}` esclusi test e i JSON;
(2) scanner a caratteri che separa letterali `"…"`/`'…'`/`` `…` `` e commenti `//`, `/* */`,
`{/* */}`, tenendo per ogni letterale la riga e i ~40 caratteri che lo precedono; (3) testo JSX
`>\s*([^<>{}]*?)\s*<` con almeno una lettera; (4) **italiano** = una lettera accentata, **oppure**
una parola dell'elenco forte (`della|delle|degli|nessun[ao]?|già|elimina(re)?|salva|annulla|
conferma|aggiungi|rimuovi|carica|modifica|traduci|fallit[ao]|pagina|oggetto|progetto|allarme|
chiave|fornitore|operazione|irreversibile`…), **oppure** due parole dell'elenco debole; (5)
**esclusioni motivate una per una**: preceduto da `t(`/`i18n.t(`; preceduto da
`console.*(`/`throw new Error(` (rivolto allo sviluppatore — ma **non** escludere gli `Error` di
`api/client.ts` che finiscono in un `alert(e.message)`: quelli sono debito vero, misurarli prima);
**valore di una proprietà d'oggetto** il cui nome sta in `TEXT_FIELDS` di `projectI18n.ts`
(`text: "Testo"`, `label: "Bottone"` → asse (b), non contano; `title="…"` con `=` conta); (6)
**dialoghi**: `(window\.)?(confirm|alert|prompt)\(\s*["'`]` → violazione, `\(\s*t\(` → no; (7)
**tetti** `TETTI = {file: n}` e `DIALOGHI = {file: n}` presi dal **primo giro**, non dalla misura
dell'agente; file assente = 0; `problema` se sopra, `↓ nota` se sotto, `• debito` se uguale, e un
file in `TETTI` che sta a 0 → `problema` («togli la riga»); (8) `--elenca <file>` stampa i
candidati con riga: è lo strumento con cui F6–F9 pagano il debito; (9) `--autotest`: un
frammento in heredoc con `t("x")`, un commento italiano, `label: "Testo"` in `addObject({`,
`title="Salva"`, `confirm("Eliminare?")` → atteso 1 stringa e 1 dialogo. Tiene ferma l'euristica.

**Rosso prima**: primo giro con `TETTI={}`, `DIALOGHI={}` → rosso su ~20 file; con i tetti
misurati → verde. **DoD** + dal vivo: il maintainer lancia `--elenca src/config/ConfigView.tsx` e
giudica i falsi positivi (soglia proposta <5%).

**Rischio dichiarato**: euristica, non parser. Falsi negativi su «OK»/«Reset» accettati: la guardia
serve a non tornare indietro, non a trovare tutto. Se in F8 emergono falsi positivi sistematici si
estende l'esclusione **con motivo scritto**, non si abbassa la soglia.

## F2 — notifiche: oggetto, tipo, e la lingua per canale (D5)

> **Fatta il 18-09-2026.** Un quarto difetto trovato facendola: la scheda Notifiche **cancellava**
> `notify_lang` a ogni salvataggio, perché il payload era `{ smtp, telegram }` e basta. Otto test
> in `corpo_notifica_tests`; i due nuovi sui difetti provati rossi rimettendo l'oggetto grezzo e il
> titolo cablato.

> **F2b, non prevista, trovata dal maintainer collaudando F2**: «se prima creo l'allarme non trovo
> poi la stringa in Lingue». Due cause. Il campo *messaggio* della scheda Allarmi era un `<input>`
> nudo e non passava da `CampoTestoTradotto` — la promessa «compresi i messaggi di allarme» valeva
> solo per i template, tokenizzati con uno script; e un progetto vuoto nasceva con
> `languages.default: ''`. Ora il campo è lo stesso dei sinottici e il progetto nasce con la
> lingua dell'IDE di chi lo crea. Annidata sul ramo di F2.

> **F2c, sempre dal collaudo**: «Allarme di prova con 🎨 e testo» → «Test alarm with 🎨 E Testo».
> È esattamente il caso di **D4**, che stava in F4: il pezzo dopo l'emoji arriva al traduttore
> senza contesto e torna com'era. La parte D4 di F4 è stata **anticipata qui** — `va_approvata()` in
> `traduzione.rs`, e nel ciclo del traduttore ogni voce con segnaposto o simbolo va a `proponi`.
> F4 conserva il resto (marchio `auto` visibile e tolto a mano, chiave LibreTranslate). Insieme: la
> scheda Variabili distingue la riga dei filtri e offre una riga vuota quando non c'è niente — il
> maintainer aveva scritto la variabile nei filtri.

**File**: `sws-runtime/crates/sws-web/src/notifications.rs`, `sws-core/src/project.rs`
(`NotificationConfig`), `sws-web/src/projects.rs:110`, `router.rs:6901` (i due punti che
risolvono `notify_lang`), `telegram.rs:156` (`set_lingua`), `ConfigView.tsx` scheda Notifiche
(~7900-8100), `types/index.ts:1306`, `it.json`/`en.json`.

**Oggetto**: nuova `fn alarm_subject(evento, state, lingua, table)` che usa `resolve_msg` come già
`alarm_body` (`:202`). Il prefisso `[SWS ALARM]`/`[SWS ESCALATION]` resta fisso in ogni lingua: è un
marcatore per i filtri di posta, e va scritto nel commento.

**Tipo**: `enum Evento { Attivazione, Escalation }` al posto di `kind: &str`; il testo da
`etichette(lingua)` (due campi nuovi) — o, se F3 è già mergiata, due voci in più nella fixture.

**D5, per canale**: in `NotificationConfig` due campi nuovi `#[serde(default)]
notify_lang_email: Option<String>`, `notify_lang_telegram: Option<String>`. Risoluzione, una sola
funzione `lingua_per(canale, config, languages) -> String`: canale → `notify_lang` →
`languages.default`. La usano il supervisore (`:262`), `projects.rs:110`, `router.rs:6901`, e
`TelegramSender::set_lingua` riceve quella del canale Telegram. Retrocompatibile per costruzione:
i tre `Option` assenti danno il comportamento di oggi.

**UI**: nella scheda Notifiche tre `<select>` — «Lingua predefinita delle notifiche»
(`notify_lang`), «Email» e «Telegram» (con voce «come la predefinita») — popolati da
`project.languages.langs`, salvati nello stesso PUT che compone `{smtp, telegram}` (`:7942`).

**Rosso prima** (test in `notifications.rs`, riusando `stato("{{pressione_alta}}")` di `:454`):
`il_soggetto_non_porta_token_grezzi` (`!s.contains("{{")`, contiene la traduzione),
`il_tipo_segue_la_lingua` (`alarm_body(…, Evento::Attivazione, "de", …)` non contiene «ALLARME»),
`ogni_canale_ha_la_sua_lingua` (email `de`, telegram `es`, predefinita `it` → tre esiti diversi),
`senza_lingua_di_canale_vale_la_predefinita`. **DoD** + `cargo test -p sws-web notifications` +
dal vivo: allarme di prova con messaggio `{{token}}`, email in `de` e Telegram in `es` → oggetto
tradotto, intestazione tradotta, due lingue diverse sui due canali.

## F3 — i testi di sistema seguono la lingua dei **contenuti**, tabella condivisa

**Perimetro da scrivere nel piano**: seguono la lingua dei contenuti **le parole che il motore
scrive dentro la pagina** (intestazioni di colonna, «sì/no», «altro», «N/D») — le 8 `viewerChrome.*`
e i 5 `Testo` di LVGL — più le 6 etichette delle notifiche. La shell del viewer web (login, header,
`RuntimeView`) resta sull'asse (a): su LVGL non esiste una shell, non c'è parità da tenere. Lo
schermo web può mostrare header in inglese e tabella in tedesco: **voluto**, e va detto.

**Fixture** `tests/fixtures/testi-sistema.json`: `{ "ripiego": "en", "voci": { "ora": {it,de,fr,es,
en}, "allarme", "confermato", "si", "no", "messaggio", "attivato", "unita", "valore", "dati",
"altro", "nd", "severita", "tag" } }` — 14 voci × 5 lingue, unione dei tre consumatori.

**Rust**: spostare `testi_sistema.rs` da `sws-lvgl-viewer` a **`sws-core`** (`pub use` dal viewer
per non toccare i chiamanti); enum `Testo` a 14 voci; `pub const TUTTI: &[Testo]` (il test
`nessuna_parola_e_vuota` oggi ripete l'elenco a mano) e `pub fn da_nome(&str) -> Option<Testo>`;
`notifications.rs::etichette()` diventa `EtichetteNotifica::per(lingua)` che chiama `testo(…)`: una
tabella Rust sola. Test `la_tabella_condivisa_col_web()` con
`concat!(env!("CARGO_MANIFEST_DIR"), "/../../../tests/fixtures/testi-sistema.json")` (stesso
percorso di `project.rs:1524`).

**TypeScript**: nuovo `sws-editor/src/i18n/testiSistema.ts` con la tabella **scritta nel modulo**
(non importare il JSON da fuori `src/`: Vite lo consente solo dentro `server.fs.allow`, e il bundle
porterebbe dentro un file di test); test `tests/testiSistema.test.ts` sul modello esatto di
`formattazioneValori.test.ts`. In `SvgCanvas.tsx` (`:2952, :2954, :4746, :4749, :4764, :4774,
:4997, :5313`): `t("viewerChrome.x")` → `testoSistema("x", lingua)`, con `lingua` da
`useLinguaContenuti()` (già in `SvgObject`, `:3210`) o `msgLang` di `AlarmViewerWidget` (`:2840`).
Togliere `viewerChrome` da `it.json`/`en.json` (parità intatta).

**Guardia statica** `scripts/check_testi_sistema.sh` (idioma `check_off_page.sh`): ogni letterale
della fixture compare in `sws-core/src/testi_sistema.rs` **e** in `testiSistema.ts`, ogni voce
compare come nome in entrambi. Non esegue niente: porta la parità dentro `check_static.sh`, perché
la DoD non comprende `cargo test`/`pnpm test` e `formattazione-valori.json` oggi vive solo dei test
— questa fase non ripete quel buco. Registrarla in `STATICHE`.

**Rosso prima**: `cargo test -p sws-core testi_sistema` (enum a 5, fixture a 14), `pnpm test --
testiSistema` (modulo assente), `check_testi_sistema.sh`. **DoD** + dal vivo: viewer web con lingua
contenuti `de` e UI `it`: tabella con «Zeit» e «Wert», header italiano.

## F4 — asse (b): il marchio si vede e si toglie (D3), le proposte (D4), la chiave LibreTranslate

**File**: `ConfigView.tsx` (`setVal :10565`, dropdown `:10742-10770`, celle `:10832-10856`), nuovo
`sws-editor/src/i18n/tabellaLingue.ts`, `tests/tabellaLingue.test.ts`, `sws-web/src/traduttore.rs`
(ciclo `:467-493`), `sws-core/src/traduzione.rs`.

- **`setVal` toglie `auto`**: gemello TS di `marca_come_umana` (`traduzione.rs:231`, oggi senza
  chiamanti): `marcaComeUmana(entry, code)` filtra `entry.auto`; `setVal` la chiama quando il testo
  cambia, anche a stringa vuota (cancellare a mano è lavoro umano). Test rosso prima: «una modifica
  a mano toglie il marchio», «una modifica su un'altra lingua non lo tocca».
- **Il marchio si vede**: cella con `e.auto?.includes(l)` → bordo tratteggiato color avviso,
  `title={t("langtab.autoHint")}` («Tradotta dalla macchina: rileggila. Modificandola diventa tua e
  non verrà più sovrascritta»). Coerente con la cella rossa delle proposte. Contatore
  «N automatiche» accanto ai filtri.
- ~~**D4, proposte per i segnaposto**~~ — **fatta in F2c** (`va_approvata()` + il ciclo del
  traduttore), perché il collaudo di F2 l'ha fatta emergere prima del previsto.
- **Chiave LibreTranslate**: l'input password compare per `google` **e** `libre_translate`
  (`traduttore.rs:312` la accetta): `const CHIAVE: Record<string, "richiesta"|"facoltativa"|"ide"|
  "nessuna">` in ConfigView, con commento che punta a `richiede_chiave()` (`traduttore.rs:54`) —
  quattro righe, divergenza dichiarata.
- **Dropdown fornitori in `t()`**: 4 chiavi `langtab.fornitore.*` (è asse (a), ma è qui che si tocca
  quel blocco).

**DoD** + `pnpm test` + `cargo test -p sws-core traduzione` + dal vivo: tradurre verso `de`;
`Temperatura {value:.1f} °C` finisce **rossa**, `Pompa` finisce con il bordo tratteggiato; correggere
`Pompa` a mano → bordo sparisce; salvare; `project.yaml` non ha più `de` in `auto` per quella voce.

## F5 — persistere `ConfigTraduzione` (D3)

**Dove**: nell'**istanza**, non nel progetto (regola di `ai/client.rs`: «il progetto si esporta»).
`config_dir/traduzione.yaml` con `{fornitore, url}` — precedente esatto `Impostazioni` in
`ai/client.rs:369-420` — e le chiavi in file 0600 a parte: `config_dir/google_translate.key`,
`config_dir/libretranslate.key`. Estrarre da `ai/client.rs` `salva_chiave`/`chiave_di`/
`cancella_chiave` in un `segreti.rs` generico usato da entrambi (scelta consigliata; l'alternativa
è replicare 30 righe in `traduttore.rs`).

**Endpoint**: `GET/PUT/DELETE /api/traduzione/config`, Admin, `solo_ide` (come `/api/ai/config`),
in `system_ctrl_routes` (`router.rs:516`). PUT `{fornitore, url?, chiave?}` con sentinella
`********` = «tieni quella che c'è» (`AiConfigBody`, `config_api.rs:128-136`); GET risponde
`{fornitore, url, ha_chiave}`, **mai** la chiave.

**Precedenza in `traduci_progetto`** (`traduttore.rs:450`): `req.config` esplicito > persistito >
`Default` (**MyMemory**, D3). Se `req.config.fornitore` c'è ma `chiave` manca → dal file.

**UI**: al mount della scheda Lingue `GET`; dropdown e input precompilati; pulsante «Salva
impostazioni fornitore» **esplicito** (è una scrittura fuori dal progetto); campo chiave con
sentinella e «cancella chiave».

**Rosso prima**: `cargo test -p sws-web traduttore`: `la_configurazione_persistita_si_rilegge`,
`la_chiave_non_finisce_in_traduzione_yaml`, `la_richiesta_esplicita_vince_sul_file`.
`check_password_browser.sh` continua a valere. **DoD** + dal vivo: salvare Google + chiave,
ricaricare il browser, tradurre senza ridigitare.

## F6 — dialoghi a zero, attributi

**File**: `ConfigView.tsx` (18 dialoghi: `:4149, 5193, 5290, 5306, 5515, 5907, 5930, 5943, 6167,
6742, 6782, 6826, 7532, 9032, 9052, 10055, 10632-10686`; 17 attributi), `SvgCanvas.tsx` (5+4),
`LeftPanel.tsx` (`:354, :1219`), `EditorShell.tsx` (`:2858`), `FunctionEditor.tsx` (3),
`TrendExpanded.tsx` (3), i due JSON, `check_i18n_ui.sh`.

I messaggi lunghi con `\n\n` (TLS, deploy) diventano chiavi con interpolazione come già
`cfg.cleanInstallConfirm` (`:8760`). I `title` tecnici (`"notify_email: invia email…"`) tengono il
nome del campo nel testo tradotto: è documentazione del YAML. Alla fine **`DIALOGHI` sparisce** e
ogni dialogo senza `t()` è `problema` — tolleranza zero da qui.

**Rosso prima**: `check_i18n_ui.sh` con `DIALOGHI` cancellato → rosso su 26. **DoD** + dal vivo: UI
in EN, «Elimina pagina» e «Genera certificato TLS» → dialoghi in inglese.

## F7 — lo store neutro e i dieci componenti muti

**Store** (`store/index.ts`): registra **chiavi**, non frasi. `pushHistory("Nuova pagina")` →
`pushHistory("history.newPage")` e chi mostra la storia fa `t(voce.label)` — se la si traducesse alla
`push`, un cambio lingua lascerebbe le voci vecchie nell'altra lingua. Gli errori restituiti
(`mergeCellRange :1058-1066` → «Range non valido.», consumato da `EditorShell.tsx:1019 alert(err)`)
diventano chiavi `storeErr.*` e il consumatore fa `alert(t(err))`. Il tipo resta `string`:
nominare nel commento le funzioni che restituiscono chiavi e affidarsi alla guardia (una chiave non
è italiano → tetto 0). Alternativa scartata e perché: `i18n.t` dentro lo store metterebbe lingua in
stato.

**Componenti**: `TrendCanvas`, `TrendExpanded`, `AlarmHistory`, `FunctionEditor`, `DataTable`,
`XyPlotCanvas`, `PythonEditor`, `PageTabs`, `BarraAvviso`: `useTranslation()` e chiavi.
`symbols/library.tsx` esporta dati: le etichette dei simboli o diventano `symbol.<id>` (namespace
esistente) tradotte da chi le disegna, o si dichiarano contenuto ed escono con motivo — da misurare
con `--elenca`.

**Rosso prima**: tetti di questi file a 0 → rosso; test `tests/storeChiavi.test.ts`:
`mergeCellRange` su 1×1 ritorna `"storeErr.selectTwoCells"`. **DoD** + dal vivo: UI in EN, unire una
sola cella → messaggio inglese; trend espanso senza italiano. **Rischio**: test che montano
componenti senza i18next ricevono le chiavi (già vero per `pannelloProprieta.test.tsx`); un test che
asseriva su un testo italiano passa alla chiave.

## F8a / F8b — `ConfigView.tsx`

Le ~170 stringhe dopo F6, per schede. **F8a**: Lingue (esito `:10648-10686`, `⏳ traduzione
verso…`), Allarmi/Notifiche (`:4940-5016`, `:7900-8100`), Runtime/Deploy (`:8760-10060`). **F8b**:
Tag, Utenti, TLS, Storico, Faceplate, Git. Metodo: `--elenca` come lista di lavoro, **una chiave
per stringa** (due frasi diverse con la stessa chiave si separano in una lingua e non nell'altra),
prefisso per scheda (`cfg.lang.*`, `cfg.tls.*`) perché `cfg.*` ha già 500+ chiavi.

**Rosso prima**: il tetto dichiarato al numero **di arrivo** della fase (204 → 100 in F8a): il
primo giro è rosso, il ramo lo porta sotto — è l'unico modo per far dire alla guardia «questa fase
ha finito». **DoD** + dal vivo: UI in EN, la scheda della fase senza italiano, `title` compresi.

## F9 — `SvgCanvas.tsx`, `LeftPanel.tsx`, `EditorShell.tsx` (solo UI)

Tetti a zero per i tre file. In `EditorShell` la guardia già distingue contenuto predefinito da UI
(F1), restano `:1824` (dimensione fissata), `:1843` (pluralizzazione italiana cablata «oggetto
è/oggetti sono» → `t()` con `count`), `:2022-2024`. In `LeftPanel` `:319`, `:460`, `:504`. Alla fine
**`TETTI` è vuoto**: sostituito dal commento «Vuoto dal <data>…». Da qui la guardia è a tolleranza
zero su tutto `src/`.

---

## Chiusura del capitolo

Quando: `TETTI` vuoto, `DIALOGHI` non esiste più, `check_testi_sistema.sh` verde, i test di
`notifications.rs` coprono oggetto/tipo/canale, D1/D3/D4/D5 hanno la riga «decisa» → il piano passa
in `docs/archive/` con riga nel README, `STATUS.md` lo registra, `check_i18n_ui.sh` e
`check_testi_sistema.sh` restano come le altre guardie. Le schede Q43 e Q57 si timbrano e vanno in
`docs/history/OPEN_QUESTIONS-chiuse.md` — **il timbro lo mette il maintainer** (regola 3).

## Verifica complessiva

- Ogni fase: le quattro voci della DoD, più `pnpm test`/`cargo test -p <crate>` dove ci sono test.
- Collaudo a mano che chiude il capitolo, in un giro solo: UI dell'IDE in **EN** senza una parola
  italiana in nessuna scheda né dialogo; viewer web con contenuti in **de** che mostra «Zeit» in
  tabella e header inglese; una traduzione automatica verso `de` che lascia rosse le voci con
  segnaposto e tratteggiate quelle senza; una correzione a mano che toglie il tratteggio; un allarme
  di prova che manda email in `de` e Telegram in `es` con oggetto e intestazione tradotti; la chiave
  Google che sopravvive al ricaricamento del browser.

## Rischi dichiarati

- **F1 è un'euristica**: falsi positivi/negativi possibili. Il repo li accetta perché la guardia
  serve a non tornare indietro; ogni esclusione aggiunta porta il suo motivo nel file.
- **D4 rende rosse molte celle**: scelto consapevolmente; se in uso si rivela insostenibile, la
  via (ii) — frase intera solo all'IA con verifica dei segnaposto — resta descritta nel seme
  archiviato e costa una sessione.
- **D5 non copre destinatari misti sullo stesso canale**: scelto consapevolmente; la via per
  destinatario (elenchi `{indirizzo, lingua}` retrocompatibili con le stringhe nude) resta descritta
  nel seme archiviato.
- **`ConfigView.tsx` è un file da 11k righe**: F8 in due rami, e «un ramo alla volta» rispettato
  anche verso il lavoro parallelo sull'immagine di boot — altrimenti i conflitti sono garantiti.
- **Lo spostamento di `testi_sistema.rs` in `sws-core`** cambia gli `use` del viewer:
  `cargo check --workspace`, non solo il crate.
