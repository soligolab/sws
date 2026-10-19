# Piano — la chiusura dei residui

> 19-10-2026. Sei piani vivi sono fermi non per il lavoro che resta, ma per **code**: una voce
> non fatta, una misura mai presa, una decisione mai sciolta. Finché quelle code esistono, i piani
> non si archiviano e `docs/plans/` racconta come lavoro in corso cose finite da settimane.
> Questo piano le chiude tutte, una per ramo.
>
> Misurato sul codice il 19-10-2026 (`main` a `e14fbe15`).

## Decisioni del maintainer (19-10-2026)

- **Perimetro**: solo i residui. La Fase 5 del tronco cloud (registrazione, email, 2FA) resta
  dov'è: è una fase intera, non una coda, e vuole una sessione di plan sua.
- **Granularità**: **un ramo per residuo**, sette. Ci si può fermare dopo qualunque ramo.
- **Tubazioni, punto 6** (il tubo che segue un oggetto mosso da una variabile): **non si fa**.
  Al suo posto, una cosa che dà fastidio davvero: il tubo nasce a «L» e va riadattato a mano.
- **`font_size`**: si rende vivo su **tutti** i tipi, non solo quelli da riquadro.
- **Branding**: si **spacca il file** — aspetto pubblico, contenuto privato.
- **Avviso sul pannello**: versione nuova e domanda di conferma restano a tutto schermo; l'esito
  dell'ultimo aggiornamento diventa discreto.
- **Tunnel**: misura dai log (costo zero) **più** la rilevazione lato gateway, che è il buco vero.
  Criterio di uscita della fetta 3, fissato **prima** di guardare il numero: **meno di una
  riconnessione non spiegata al giorno, su sette giorni**. «Non spiegata» esclude i riavvii del
  pannello, del gateway e le cadute di rete note.
- **Tubo a clic**: percorso **ortogonale**, con un tratto **dritto tenendo Shift**.
- **Famiglia Comandi**: primo lotto di sei, elenco confermato (vedi ramo 4).
- **`/api/system` per un anonimo**: solo i campi che servono all'avviso, non l'oggetto intero.
- **Chiudere un progetto con qualcuno collegato** (scelta mia, dichiarata): si può, ma la console
  dice quanti sono e chiede conferma. Vietarlo renderebbe inutile il pulsante proprio nel caso in
  cui serve.

---

## Ramo 1 — `feat/console-progetti-aperti`

**I due residui del gateway sono lo stesso lavoro**, e la parte che sembrava il lavoro è già
scritta: `Regia::aperti_di` (`sws-web/src/gateway/progetti.rs:264`), `Regia::elenco` (`:259`) e
`Regia::chiudi` (`:498`) esistono, sono completi e **non hanno un solo chiamante fuori dai test**.

Oggi la console mente: `amministrazione.rs:760` legge `s.project_dir`, che **sul gateway è sempre
vuoto**, quindi mostra `0 / N` per ogni azienda; e `progetti_aperti_si_applicano` è cablato a
`false` (`:764`) mentre il tetto è applicato eccome (`gateway/rotte.rs:90` + `progetti.rs:341`).
Il commento a `amministrazione.rs:757-759` dichiara onestamente il debito ed è rimasto indietro.

**Da fare.** Sostituire il blocco `amministrazione.rs:757-765` con il conteggio vero da
`s.regia`; `progetti_aperti_si_applicano` diventa `s.regia.is_some()`. Poi una rotta di console
che espone `Regia::elenco()` e una che chiama `Regia::chiudi()`, registrate in
`rotte_di_azienda` (`amministrazione.rs:612`) e confinate con `confine()` (`:68`). UI in
`sws-editor/src/console/Risorse.tsx:113-121`; tipi in `client.ts:880-907`.

**Due trappole misurate.**
- La chiave della mappa dei progetti aperti è la **`cartella`** dell'azienda, non l'id né il nome
  (`rotte.rs:90`), e quel campo **non è serializzato** nella riga JSON di `risorse`
  (`amministrazione.rs:710-718`). Per l'azienda implicita la cartella è la stringa vuota mentre
  il segmento di URL è `-` (`project_registry.rs:33`). La correlazione va scritta a mano.
- Il conteggio **non deve entrare nella cache dei 60 secondi** (`VALIDITA_MISURA_MS`,
  `amministrazione.rs:678`): quella esiste perché pesare le cartelle costa, contare una mappa in
  RAM no. Il blocco da sostituire è già fuori dalla cache, quindi basta non spostarlo.

**Una decisione piccola dentro il ramo**: `Aperto.collegati` (`progetti.rs:47`) dice se c'è
ancora qualcuno dentro. Il piano della Fase 4 dice «chi ha aperto un progetto non se lo ritrova
chiuso perché qualcun altro ne voleva uno». Una chiusura a mano con `collegati > 0` va **avvisata**,
non vietata: la console mostra quanti sono collegati e chiede conferma.

---

## Ramo 2 — `feat/branding-spaccato`

La rotta `/branding/:marchio/:file` (`router.rs:1130`) è nel gruppo aperto e serve anche i
`.json` (`marchi.rs:66`). Gli unici controlli sono antipath-traversal (`nome_sicuro`,
`marchi.rs:70`) ed estensione: **nessun riferimento a chi chiede**. L'elenco dei marchi è già
confinato (`marchi.rs:140` in `rotte_di_azienda`), quindi i nomi non si elencano — si indovinano.

Il contenuto di oggi non è un segreto: dei quattro `brand.json` in repo solo `pixsys` ha dati
veri — 20 modelli di pannello e un percorso Yocto. Ma il file **lo scrive il cliente** dalla
console (`marchi.rs:209-236` lo salva tal quale), quindi il problema è cosa ci finirà.

**Da fare.** `file_marchio` continua a servire `logo`, `favicon` e i colori senza autenticazione —
la schermata di accesso ha bisogno del logo prima che esista una sessione. `device_presets` e
`data_path_presets` escono da lì e passano dietro `require_auth`, serviti dal **marchio
dell'azienda di chi è entrato**: il gancio esiste già, `GET /api/identita/marchio`
(`router.rs:1782`), che il frontend chiama di suo per ricaricare il tema dopo il login. Nessuna
migrazione di file: il campo semplicemente non viene più servito pre-auth.

Aggiornare la lista bianca `scripts/check_rotte_preauth.sh:90` e il commento in testa a
`marchi.rs:30-35`, che è il posto dove la scelta va scritta.

**Resta aperta, e si dichiara**: chi sta in due aziende con marchi diversi ne vede uno solo, il
primo per id (`router.rs:1794-1802`). Non si decide qui.

---

## Ramo 3 — `feat/tubo-a-clic`

Oggi un tubo nasce con tre punti fissi a «L» (`sws-editor/src/editor/oggettiNuovi.ts:149`:
`[{x,y},{x+120,y},{x+120,y+80}]`) e poi si riadatta a mano. La polilinea invece **si disegna già
a clic** dal 26-09: modalità `polilineaInDisegno` nello store (`store/index.ts:560`), clic che
posano punti, doppio clic o Invio per finire, Esc per annullare (`SvgCanvas.tsx:988-1004`).

E l'editor dei punti con le maniglie è **già condiviso** fra `motion_path` e i `points` della
polilinea (`SvgCanvas.tsx:2072-2076`). Il tubo usa `points` come loro.

**Da fare.** Generalizzare la modalità al tipo: l'unico punto cablato è `SvgCanvas.tsx:997`, dove
il primo clic crea un oggetto `polyline`. La modalità porta con sé il tipo da creare, e per il
tubo i suoi campi (`routing`, `pipe_style`). Poi `const polilinea = obj?.type === "polyline"`
(`SvgCanvas.tsx:2075`) diventa «polilinea **o tubo**», così le maniglie valgono anche lì.
`EditorShell.tsx:700` accende la modalità anche per `pipe`.

**Gratis, se si collega**: la calamita sulle bocche dei simboli esiste già — `bersagli` e
`calamita` in `canvas/tubazioni.ts:206,225`. Il primo e l'ultimo clic possono agganciarsi da soli
a una bocca vicina, che è il modo in cui un tubo si disegna davvero.

**Il percorso fra un clic e l'altro** (decisione del maintainer): resta **ortogonale** — è
l'aspetto da P&ID, e i clic dicono *dove passare*, non *come girare* — con un **tratto dritto
tenendo Shift** mentre si posa il punto. `instrada` (`canvas/tubazioni.ts`, gemello
`sws-core/src/tubazioni.rs`) già calcola il percorso fra i punti secondo `routing`: il tratto
dritto va espresso **nel dato**, non in uno stato dell'editor, altrimenti LVGL non lo vede.

Questo è l'unico punto del ramo che non è riuso: oggi né `PipePoint` né `routing` sanno dire «da
qui al prossimo vai dritto». Due strade, da scegliere misurando all'inizio del ramo: un campo
facoltativo sul punto (`dritto?: boolean`), che è locale e non tocca `routing`; oppure un valore
di `routing` nuovo, che però vale per tutto il tubo e quindi non serve. Propendo per il primo —
e porta con sé una voce in `CAMPI_FISSI` di `scala/scalaPagina.ts`, che il test-guardia pretende.

---

## Ramo 4 — `feat/simboli-comandi`

Ramo 3 del piano [strumenti, simboli e comandi](2026-10-14-strumenti-simboli-comandi.md):
famiglia **«Comandi»** nella libreria. **Primo lotto di sei, confermato dal maintainer il
19-10-2026**, con il comando di partenza di ciascuno:

| simbolo | parte viva | comando di partenza |
|---|---|---|
| pulsante tondo | nessuna (stati colore) | `momentary` |
| pulsante luminoso | `lamp` | `momentary` |
| fungo di emergenza a strappo | nessuna | `set` |
| interruttore a levetta | `lever` | `toggle` |
| selettore a tre posizioni | `needle` (vedi sotto) | assegnazioni |
| interruttore a chiave | `lever` | `toggle` |

**È il residuo più economico perché quasi tutto è derivato dal manifesto**: la palette ricava
famiglie e tipologie da lì (`LeftPanel.tsx:895`), e il pannello LVGL scarica lo stesso manifesto
via HTTP (`simbolo_lib.rs:89`). Una famiglia nuova **arriva da sola** su editor, anteprime, filtro
e pannello. Non si tocca `libreria.ts`, né `SimboloLib.tsx`, né il validatore.

**E «il simbolo che comanda» del ramo 2 si riusa gratis**: un `lib:controls/push-button` con
`command_tag` e `button_mode: momentary` comanda già oggi, senza una riga nuova
(`EditorShell.tsx:5082-5090` per la spunta, `:3170-3215` per le sette modalità).

**Gli otto passi meccanici**: `"controls"` in `FAMIGLIE` (`scripts/simboli/genera.py:111`), la
voce in `ETICHETTE_FAMIGLIA` (`:116`), le tipologie in `ETICHETTE_TIPO` (`:123`), un
`scripts/simboli/disegni_comandi.py` sul modello di `disegni_elettrico.py` (343 righe per 26
simboli), la concatenazione in `tutti()` (`disegni.py:415`), le chiavi i18n in `it.json`/`en.json`,
`"controls"` in `FamigliaLib` (`manifest.ts:7`), e `python3 scripts/simboli/genera.py` per
rigenerare SVG e manifesto. La guardia `check_libreria_simboli.sh` pretende che rigenerare dia
**esattamente** i file committati e che ogni etichetta sia nelle due lingue, identica.

**L'unico pezzo di codice vero**: la parte viva `lever` ha due sole posizioni, `open`/`closed`
(`manifest.ts:18`, `simboli_lib.rs:23`). Un selettore a tre posizioni vuole angoli discreti.
Propongo la strada a costo zero per il primo lotto — usare `needle`, che ha già `a0`/`a1`
continui, legata a un tag 0/1/2 — e rimandare l'estensione di `Lever` a quando serve davvero.

Secondo punto da confermare: «ogni voce nasce con un comando di partenza sensato». Costa quasi
nulla con una tabellina `tipo → comando` dentro `oggettoSimbolo` (`EditorShell.tsx:136`), invece
di un campo nuovo nel manifesto.

---

## Ramo 5 — `feat/font-size-ovunque`

Il limite noto del piano della scala: dopo un cambio di risoluzione il testo di un bottone esce
dal riquadro. **Il rimedio scritto in quel piano non funzionerebbe**: scrivere `font_size` su un
bottone oggi non produce nulla, perché nessuno dei due motori lo legge per quel tipo. Il corpo è
cablato — `fontSize={14}` a `SvgCanvas.tsx:4337` — e su LVGL `apply_font_size`
(`lvgl_render.rs:3165`) la chiamano **tre** renderer: testo, orologio, navigatore.

La tabella condivisa dei predefiniti invece **esiste già** (Fase 1 del piano del 30-09:
`tests/fixtures/predefiniti-campi.json`, specchio `predefinitiCampi.ts`, guardia
`check_predefiniti.sh`), ma copre `font_size` per quattro tipi soli — `text`, `text_list`,
`state_lamp`, `pipe` — e per quelli il limite è già chiuso.

**Da fare, per ogni tipo che ha un corpo cablato** (decisione del maintainer: tutti, non solo i
sette da riquadro — bottone, navbutton, checkbox, radio, setpoint, slider, led, più gauge,
kpi_tile, tabelle, grafici, allarmi, ricette):

1. la voce `font_size: { valore: N }` in `tests/fixtures/predefiniti-campi.json` e in
   `predefinitiCampi.ts`, **con esattamente il letterale di oggi** — così nessun progetto cambia
   aspetto;
2. in `SvgCanvas.tsx` il letterale diventa `predefinito(tipo, "font_size")`;
3. il campo nel pannello proprietà (`EditorShell.tsx`), più la voce in
   `tests/fixtures/campiPannelloProprieta.json`;
4. una chiamata a `apply_font_size` nel renderer LVGL del tipo; per i renderer a canvas (tabella,
   kpi, barre) il corpo va passato alla funzione di disegno.

`CAMPI_SCALATI` e il suo test-guardia **non si toccano**: `font_size` è già classificato
(`scala/scalaPagina.ts:34`). E nessuna migrazione serve: `riempiPredefinitiOggetti`
(`store/index.ts:1302`) riempie i progetti vecchi all'apertura.

È il ramo più lungo dei sette. Si può spezzare in due giri (prima i tipi da riquadro, poi i
grafici) **restando lo stesso ramo**, con un commit per giro.

---

## Ramo 6 — `feat/avviso-aggiornamento-sul-pannello`

Dall'11-10 l'avviso di aggiornamento sullo schermo del pannello **non può più comparire**. Il
componente (`sws-editor/src/runtime-view/AvvisoAggiornamento.tsx:112`) e il suo gemello LVGL
(`sws-runtime/crates/sws-lvgl-viewer/src/aggiornamento.rs:160`) mostrano qualcosa solo se non
esistono utenti; da quando un pannello senza utenti è «in attesa di abbinamento», appena lo si
abbina nasce l'Admin del dispositivo e quella condizione non si avvera più. Con l'avviso di
versione nuova cadono anche l'esito dell'aggiornamento, l'avviso del quadlet e la domanda di
conferma, che passano dallo stesso cancello.

Decisione del maintainer: **l'avviso deve comparire comunque; le credenziali di Admin si chiedono
al momento di applicarlo, non per vederlo.**

**Il lavoro vero è lato server, non nel viewer.** Togliere il cancello dal client non farebbe
comparire niente: su un pannello abbinato chi sta davanti è anonimo, e le letture rispondono 403 —
`/api/system` ha `require_operator` (`router.rs:1499`), `/api/update/status` ha `require_admin`
(`router.rs:1549`). Il client esce dal `catch` e non legge nemmeno `quadlet` e `conferma`.

1. **Aprire le letture sulla porta 8443**: `/api/update/status`, e `/api/system` **in forma
   ridotta**. Decisione del maintainer: a un anonimo rispondono **solo i campi che servono
   all'avviso** — versione, `uptime_s` (serve a riconoscere il riavvio), stato del quadlet e
   domanda di conferma. Tutto il resto — CPU, memoria, conteggi di tag e sorgenti, allarmi
   attivi, stato TLS, avvisi diagnostici del progetto — resta dietro `require_operator` com'è
   adesso. Il filtro si scrive campo per campo e va mantenuto: serve un test che diventi rosso
   se un campo nuovo di `SystemStatus` finisce per sbaglio nella risposta anonima. **Le scritture restano `require_admin`** e lo sono già: `apply`,
   `quadlet/aggiorna`, `aggiornamento/conferma`, `istantanea`. Da quel lato non si apre nessun
   buco, e un test nuovo deve fissarlo — oggi **nessun test fissa quelle guardie**.
2. **Togliere i cancelli client**: `AvvisoAggiornamento.tsx:112`; su LVGL sono **due**,
   `aggiornamento.rs:160` e `:202`, più i due lati rete che lo rimettono in piedi —
   `aggiornamento.rs:478-488` (il `Ok(None)` che *spegne* `senza_utenti`) e `main.rs:429`
   (`unwrap_or(true)`, che tratta il 403 come «servono credenziali» di proposito: se `/api/system`
   si apre, quella riga cambia significato e va riletta, non lasciata com'è).
3. **Chiedere le credenziali al momento di applicare.** Sul web si riusa `LoginScreen` con la prop
   `motivo` (`components/LoginScreen.tsx:16-26`), già montato nel viewer in un overlay a
   `zIndex 9600` (`RuntimeView.tsx:550`) — cioè **sopra** l'avviso, che sta a 9000. Niente
   finestra nuova. Non si usa `verify-password`: verifica la password dell'utente **già in
   sessione** (`router.rs:2790`), e un anonimo non ne ha uno; la primitiva giusta è
   `POST /api/auth/login`, che sulla 8443 è aperta.
4. **Su LVGL esiste già tutto**: tastiera, campo password, login e token che arriva ai pulsanti
   dell'avviso (`render_auth_widget`, `lvgl_render.rs:7327`; il token in `SharedSession`, riletto
   a `lvgl_avviso.rs:83-96`). **La trappola è il z-order**: l'avviso sta sul layer superiore
   (`lvgl_avviso.rs:185`) e l'overlay di login è figlio dello schermo (`lvgl_render.rs:7342`),
   quindi oggi il login finirebbe **sotto** l'avviso. Tre strade: spostare il login sul layer top,
   nascondere l'avviso mentre il login è aperto, o riusare `apri_tastiera`
   (`lvgl_render.rs:5417`), che è già sul layer top. **Non trasformare `block_on` in `spawn`** nel
   callback della tastiera: c'è un blocco permanente documentato a `lvgl_render.rs:7207-7224`.
5. **L'esito diventa discreto** (decisione del maintainer): versione nuova e domanda di conferma
   restano modali perché chiedono una decisione; l'esito dell'ultimo aggiornamento diventa una
   striscia che non copre la pagina — è solo informazione, ed è quello che rischia di restare
   davanti all'impianto per giorni.

**I test che si rompono, e vanno riscritti perché il loro nome è la regola vecchia**: su LVGL
`su_un_pannello_con_utenti_non_compare_niente` (`aggiornamento.rs:598`), e le asserzioni a `:717` e
`:728`; sul web `avvisoAggiornamento.test.tsx:56` (che pretende che la richiesta **non parta**),
`:185` e `:234`. Gli altri 13 casi web passano solo perché il `beforeEach` mette
`auth_required: false`: servono casi nuovi con `auth_required: true`, che è il caso reale.

**Una stringa nuova di testo di sistema** tocca quattro posti e **cinque lingue**:
`sws-core/src/testi_sistema.rs`, `sws-editor/src/i18n/testiSistema.ts`,
`sws-lvgl-viewer/src/testi_sistema.rs` e la fixture `tests/fixtures/testi-sistema.json`.

---

## Ramo 7 — `feat/tunnel-tenuta` — **si apre per primo, si chiude per ultimo**

La fetta 3 chiede di contare le cadute del tunnel su giorni. Il piano non lo sa, ma **metà del suo
contenuto è già stato chiuso**: il 16-10, misurando sul WP630, si è scoperto che il tunnel si
riapriva **ogni quindici minuti esatti** — un timeout NAT da 900 secondi che scade senza traffico —
e il battito di `tunnel/pannello.rs:148-200` lo ha risolto, con un byte scritto su uno stream
yamux perché uno stream aperto e lasciato cadere non attraversa il filo. La prima cosa del ramo è
**aggiornare il piano del tunnel**, o si rifarà un lavoro già fatto.

**La misura si fa oggi, gratis, con un grep sui log**: `"tunnel aperto"` (`gateway.rs:143`,
`pannello.rs:141`), `"tunnel chiuso"` (`gateway.rs:158`), `"tunnel caduto"` (`multiplex.rs:88`,
livello debug). Si lascia il WP630 collegato e si contano le riaperture. **Il criterio di uscita è fissato
prima di guardare il numero** (decisione del maintainer, il piano non ce l'aveva): **meno di una
riconnessione non spiegata al giorno, su sette giorni** di WP630 acceso. Sotto quella soglia la
fetta si chiude; sopra, si irrobustisce con un dato in mano invece che per prudenza.

**Il buco strutturale, che resta comunque**: il gateway non ha né un battito proprio né un timeout
di inattività. `accetta` fa `while maniglia.vivo() { sleep(2s) }` (`tunnel/gateway.rs:142-159`), e
`vivo()` è `!richieste.is_closed()` (`multiplex.rs:44`), cioè vero finché il task yamux non muore.
Su una caduta pulita se ne accorge in due secondi; su una **half-open** — il NAT che dimentica la
tabella senza mandare niente, cioè esattamente il caso che la fetta 3 va a cercare — il gateway
continua a credere il pannello collegato, e il guasto si scopre solo quando qualcuno prova a
inoltrare una richiesta. Il pallino verde di `console/Pannelli.tsx:92` oggi vuol dire «il socket
non è ancora caduto», non «ho parlato con lui di recente».

**Da fare**: un battito lato gateway, o un timeout di inattività sulla maniglia, così che
«fermo» e «morto» si distinguano senza aspettare una richiesta vera.

**E lo spegnimento annunciato** (idea del maintainer, 19-10-2026): «se il dispositivo ha l'UPS (come il TC620 e il
WP630) allo shutdown potrebbe inviare un messaggio di disconnessione, così da segnalare al server un down causato da
shutdown». Allo spegnimento ordinato (SIGTERM, che l'UPS rende possibile anche a corrente mancata) il pannello chiude
il tunnel con un frame di chiusura WebSocket 1001 e motivo `spegnimento` prima di chiudere le sorgenti; il gateway lo
registra, la console mostra il pannello **spento (annunciato)** invece che perso, e `misura_tunnel.sh` conta quella
caduta come spiegata. Con il battito dà tre stati distinti: vivo, spento, perso.

**La misura è partita il 19-10-2026** sul TC620 (`scripts/misura_tunnel.sh`, base nel piano del tunnel): 0,5
riaperture non spiegate al giorno sui quattro giorni precedenti; si ripete il 26-10.

**Quello che i test non coprono, e che va aggiunto**: il backoff di riconnessione (oggi
`tieni_aperto`, `pannello.rs:44`, è uno `spawn` dentro una funzione che non restituisce niente —
va estratto il calcolo dell'attesa per poterlo provare), la cadenza del battito, e il ritorno dopo
una caduta (che `Registro::entra` sostituisca la maniglia vecchia è documentato a
`multiplex.rs:125-133` ma non asserito). La half-open non è riproducibile con `tokio::io::duplex`,
dove chiudere un capo è sempre pulito: va provata a mano.

---

## Cosa si archivia quando è finito

| Piano | Chiuso da |
|---|---|
| [2026-10-09-fase-4-gateway.md](2026-10-09-fase-4-gateway.md) | rami 1 e 2 |
| [2026-10-08-marchi-visibili-prima-del-login.md](2026-10-08-marchi-visibili-prima-del-login.md) | ramo 2 |
| [2026-10-15-tubazioni-bocche-e-stili.md](2026-10-15-tubazioni-bocche-e-stili.md) | punto 6 dichiarato **fuori perimetro** (decisione del 19-10), più il ramo 3 che dà al tubo il tracciamento a clic |
| [2026-10-14-strumenti-simboli-comandi.md](2026-10-14-strumenti-simboli-comandi.md) | ramo 4 |
| scalare tra risoluzioni | **archiviato il 19-10-2026**: il lavoro era finito, e il suo limite noto è diventato il ramo 5 di questo piano |
| [2026-10-09-fase-6-tunnel-dei-pannelli.md](2026-10-09-fase-6-tunnel-dei-pannelli.md) | ramo 7 |

Cinque sono già stati archiviati il 19-10-2026, perché il loro lavoro era completo: colore e
assegnazioni, revisione IDE del collaudo WP630, git nel cloud, finestre popup e la scala fra
risoluzioni.

---

## Verifica, per ogni ramo

- `cargo check`, `pnpm build`, `./scripts/check_static.sh` verdi, più `cargo test` e `vitest` dove
  il ramo tocca codice provato.
- Guardie che reagiscono di sicuro: `check_libreria_simboli.sh` (ramo 4, confronto byte a byte dei
  file rigenerati), `check_predefiniti.sh` (ramo 5), `check_rotte_preauth.sh` (ramo 2),
  `check_testi_sistema` via la fixture a cinque lingue (ramo 6).
- **Dal vivo sul WP630**: rami 3, 4, 5 e 6 vanno visti a schermo, e il 6 va visto **anche** sul
  viewer LVGL, perché è lì che sta la trappola del z-order.
- Rami 1 e 2 si provano sul VPS, dove il gateway gira davvero: contare i progetti aperti su
  un'azienda con due progetti aperti, chiuderne uno a mano, e verificare che un `brand.json` non
  dia più i preset a chi non è entrato.
- Poi il ciclo di `CLAUDE.md`: conferma del maintainer, squash merge, verifica degli alberi,
  `git branch -D`.
