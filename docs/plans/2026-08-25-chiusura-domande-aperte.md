# Chiusura delle domande aperte → programma di lavoro

## Contesto

Le domande aperte si erano accumulate: 22 in `docs/OPEN_QUESTIONS.md`, di cui 6 ancora senza
decisione, più una manciata di note lasciate nei commenti del codice e mai promosse a domanda. Erano
diventate un sedimento: nessuno le rileggeva, e intanto ognuna continuava a costare — Q20 è costata
una diagnosi sbagliata, Q22 due giorni di crash inspiegabili.

Il 2026-08-25 le abbiamo passate una per una e **deciso tutte**. Questo piano trasforma quelle
decisioni in passi eseguibili.

> **Deroga consapevole alla regola 3 di `CLAUDE.md`** («mai risolvere una voce di
> `OPEN_QUESTIONS.md`, semmai aggiungerne»). La regola esiste per impedire che sia *io* a decidere
> da solo: qui ogni scelta è del maintainer, presa esplicitamente. Le domande **non vengono
> cancellate** — restano nel file marcate `**Decided (2026-08-25)**` con l'opzione scelta, come già
> sono Q1-Q14. Il ragionamento che c'è dentro vale più della riga di elenco.

---

## Passo 0 — Riconciliare i branch, PRIMA di toccare i documenti

**C'è un problema da chiudere subito.** Ieri il commit di documentazione è stato messo su `main` con
un cherry-pick mentre lo stack dei branch restava indietro. Risultato oggi:

- `main` ha **Q1-Q21** e lo STATUS di ieri;
- `feat/template-demo-items` ha **Q1-Q19 + Q22** e lo STATUS di oggi.

**Q20 e Q21 non esistono su questo branch.** Al merge, `OPEN_QUESTIONS.md`, `STATUS.md` e
`CHANGELOG.md` divergono tutti e tre, e una risoluzione distratta le perde in silenzio.

Da fare: portare `main` dentro lo stack (merge o rebase), risolvendo i tre documenti **tenendo
entrambe le parti**. Verifica: dopo la riconciliazione `grep -c '^## Q'` deve dare 22, e Q20/Q21/Q22
devono esserci tutte.

---

## Passo 1 — Registrare le decisioni

In `docs/OPEN_QUESTIONS.md`, per ognuna delle sei: `**Decided (2026-08-25)**` + opzione scelta + una
riga di motivo. Le note del codice decise qui sotto diventano commenti aggiornati nei rispettivi
file. L'elenco dei passi va in `STATUS.md`.

---

## Le decisioni, e cosa comportano

### A. Infrastruttura — da fare per prime, perché tutto il resto ci poggia sopra

**A1. Il crate LVGL entra nel workspace** *(nota nel codice)*
`sws-lvgl-viewer` è fuori dal workspace: `cargo check --workspace` non lo compila, la CI non lo
tocca, e i suoi 39 test girano solo perché li cross-compilo a mano. È il crate dove ho trovato più
difetti in due giorni.
**Deciso: dentro il workspace, con SDL2 come prerequisito.** Serve `libsdl2-dev` + `clang` su
qualunque macchina che compila — **compreso questo dev server, che oggi non li ha**: è il primo
passo concreto. Aggiornare `docs/YOCTO_CROSSCOMPILE.md` e il README con i prerequisiti nuovi.

**A2. La toppa LVGL diventa una patch tracciata** *(Q22)*
Oggi `chart_add_series` in `lvgl_render.rs` azzera `x_ext_buf_assigned` a mano.
**Deciso: patch sul vendor.** Un file in `patches/lvgl/` che corregge `lv_chart_add_series`
all'origine, più uno script che la riapplica all'importazione e **fallisce rumorosamente** se non
si applica più — una patch che scade in silenzio è peggio della toppa che sostituisce. La toppa nel
nostro codice si toglie solo quando la patch è verificata sul pannello.
*Aggiunta mia, da confermare in corsa*: già che si mette mano al vendor, cercare altri campi letti
ma mai inizializzati con lo stesso schema. Trovato una volta, difficilmente è unico.

### B. Correzioni piccole e indipendenti

**B1. Il backend DRM resta ma si dichiara non supportato** *(Q19)*
`--backend drm` non può funzionare su questi pannelli: i device li distribuisce `seatd` e il DRM
master ce l'ha Weston. **Deciso: tenerlo** (su hardware senza compositore sarebbe la strada giusta)
**con un errore chiaro all'avvio** se rileva un compositore attivo o l'assenza dei permessi, invece
del fallimento oscuro di oggi.

**B2. ODBC resta selezionabile, con l'avviso** *(nota in `odbc_backend.rs`)*
**Deciso: etichetta "non implementato" nell'elenco dei datastore**, così chi lo sceglie lo sa prima
e non alla prima scrittura.

**B3. Il test dell'App verifica davvero qualcosa** *(nota in `App.test.tsx`)*
**Deciso: scrivere il mock di `@/api/client`** e far controllare al test il contenuto reso. Oggi
passa senza verificare nulla, che è peggio di non averlo.

**B4. `TODO(pyo3-0.24)`** — **deciso: si migra `into_py` → `into_pyobject` quando si aggiorna pyo3**,
non prima. Nessun lavoro adesso; la nota resta con la decisione scritta accanto.

### C. Ergonomia dell'IDE

**C1. "Salva tutto" torna a coprire Datastore e Notifiche** *(nota in `ConfigView.tsx`)*
Sono esclusi dal 2026-07-28, quando un salvataggio con bozza disallineata azzerò le variabili di un
progetto. **Deciso: riabilitarli con un flag `touched`** — si scrive solo ciò che l'utente ha
davvero toccato, non ciò la cui bozza è semplicemente disallineata. È lo schema che quei due tab già
usano internamente; va portato fino al salvataggio comune. La regressione da evitare è precisa e ha
un audit trail: scrivere 0 tag quando su disco ce ne sono 16.

**C2. Una sezione "Python" unica** *(Q21)*
Funzioni e Script restano tipi distinti nel modello — una funzione non ha trigger, aspetta di essere
chiamata — ma si mostrano **in un punto solo**, con un'etichetta che dice come parte ciascuna
("chiamata da un oggetto", "ogni 1 s", "all'avvio", "quando cambia X"). Riusa `PythonEditor.tsx`,
già condiviso da `FunctionEditor` e `GlobalScriptsTab`.

**C3. Il colore predefinito del testo viene dallo sfondo pagina** *(Q18)*
Oggi arriva dal tema dell'**app**, e su una pagina con sfondo scuro e tema chiaro il testo è
invisibile. **Deciso: derivarlo dallo sfondo effettivo della pagina** (chiaro→scuro, scuro→chiaro),
per tutti i tipi che usano quei token come default: testo, tabelle, gauge, etichette dei grafici. Il
tema dell'app resta per la chrome di IDE e viewer. Vale su entrambi i motori, quindi tocca sia
`SvgCanvas.tsx` sia `lvgl_render.rs`.

### D. Il viewer LVGL

**D1. Il viewer si accorge che il progetto è cambiato** *(Q20)*
**Deciso: notifica dal runtime sul WebSocket già aperto** — un messaggio "progetto cambiato" e il
viewer ridisegna. Niente polling. Il ridisegno è già supportato: è quello che fa la navigazione fra
pagine (`lv_obj_clean` + `render_page_objects`). Lato runtime il punto di emissione è dove il
progetto viene sostituito: import, apertura, ripristino di backup.

**D2. SVG su LVGL: rasterizzazione a runtime** *(Q15 residuo + Q16)*
LVGL 8.x non ha renderer SVG, quindi oggi restano muti i 12 simboli "vendored", i simboli custom e
tutto il widget `image` (il cui catalogo bundlato è fatto di `.svg`).
**Deciso: rasterizzare a runtime con `resvg` + `tiny-skia`.** È l'unica opzione che copre anche i
simboli disegnati dall'utente e gli URL esterni, cioè i casi che un progettista vero incontra.
**Primo passo obbligatorio: misurare.** Il binario del viewer oggi è 8,5 MB; `resvg` non è piccolo,
e le bitmap costano memoria su un pannello. Si misura peso e occupazione *prima* di cablare il
widget: se sfora, si torna a discuterne con un numero in mano invece che con un'impressione.

### E. F9c — parità completa dei campi

`model.rs` dichiara 99 campi contro i 238 di `sws-web/src/synoptic.rs`. **Deciso: portarli tutti,
sistematicamente**, non solo quelli che si notano a occhio.

Serve un **controllo generato** che confronti le due strutture e elenchi i campi mancanti: fatto a
mano su 137 campi è un lavoro che si sbaglia. Il controllo diventa poi la guardia permanente contro
il ripetersi del disallineamento, come `check_demo_templates.sh` lo è per i template.

Dove un campo **non ha equivalente disegnabile** su LVGL, si dichiara il gap nel commento del campo
— com'è già per `trend_series_styles` e `pie_show_legend`. Dichiarare non è arrendersi: è la
differenza fra un limite noto e un difetto silenzioso.

`pie_show_legend` (nota in `model.rs:317`) entra qui, non è un caso a sé.

---

## Ordine di esecuzione

1. **Passo 0** — riconciliazione dei branch. Blocca tutto il resto.
2. **A1, A2** — infrastruttura. A1 per primo: senza CI sul crate LVGL, ogni passo successivo su quel
   codice è di nuovo verificato solo a mano.
3. **B1-B4** — piccole e indipendenti, buone da chiudere in blocco.
4. **D1** — alto valore per il costo: toglie un'intera classe di confusione durante le prove.
5. **C1, C3** — correzioni di comportamento; C3 tocca entrambi i motori.
6. **C2** — riorganizzazione dell'interfaccia.
7. **D2** — prima la misura, poi la decisione se procedere.
8. **E** — il lotto grosso, per ultimo e per gruppi.

Sono molti lotti: si va uno per uno, con un branch per lotto come chiede `CLAUDE.md`, e ci si ferma
fra un lotto e l'altro.

---

## Verifica

- **Passo 0**: 22 domande dopo la riconciliazione, Q20/Q21/Q22 tutte presenti.
- **A1**: `cargo check --workspace` e `cargo test --workspace` compilano ed eseguono anche il crate
  LVGL, su una macchina con i prerequisiti nuovi installati.
- **A2**: la patch si applica su un vendor pulito; rimossa la toppa, il pannello regge la pagina
  "Grafici e tabelle" (che senza correzione crasha entro 8 secondi).
- **B1**: sul WP630, `--backend drm` esce con un messaggio che dice *perché*, non con un errore di
  permessi grezzo.
- **C1**: riprodurre l'incidente del 2026-07-28 — bozza disallineata + "Salva tutto" — e verificare
  che i tag su disco restino quelli giusti.
- **C3**: pagina con sfondo scuro e tema app chiaro; il testo dev'essere leggibile su **entrambi** i
  motori.
- **D1**: modificare una pagina dall'IDE, fare deploy, e vedere il pannello aggiornarsi **senza
  riavviare il viewer**.
- **D2**: numeri di peso e memoria prima di scrivere il widget.
- **E**: il controllo generato dice 238/238; il confronto fianco a fianco dei template gemelli non
  mostra più differenze se non quelle dichiarate.

`cargo check --workspace` + `pnpm build` verdi restano la definizione di fatto — e dopo A1 quella
formula copre finalmente anche il viewer LVGL.

---

## Da non perdere di vista

Restano in sospeso da prima, indipendenti da questo programma:

- **Ripubblicare l'immagine container**, che aspetta il tuo via libera. Finché non avviene, sul
  WP630 il discovery mDNS, i trend e la correzione del crash vivono su binari montati a mano in
  `/tmp`, che si svuota al riavvio.
- **Provare il pull del progetto dall'IDE** (`feat/ide-pull-progetto`): è l'unico lavoro di questi
  due giorni che non hai ancora confermato.
