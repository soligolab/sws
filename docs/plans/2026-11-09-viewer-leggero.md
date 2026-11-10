# Il viewer leggero: mini tendenze a secchielli, valori una volta per fotogramma, ridisegno mirato

> **Stato: piano d'esecuzione, deciso dal maintainer il 09-11-2026: «fai già il plan e correggi, è una cosa importante».**
> Si parte dal ramo `fix/mini-tendenze-leggere`, che è uguale a `main` 258103bd (2.26.0-rc.9). I commit 82fbb7c7 e 284cc731 cambiano solo documenti, quindi le righe citate valgono anche a HEAD.
> Questo piano assorbe il seme [2026-10-17-tag-uguali-ritrasmessi](../archive/2026-10-17-tag-uguali-ritrasmessi.md) (§8). Il banco e le misure stanno in `tmp/viewer-leggero/` (solo su theobroma).
> Scritto da un'analisi a più voci (quattro mappe del codice, un banco di misura, due progetti indipendenti e un giudizio), poi completato con le decisioni prese dal maintainer lo stesso giorno (§4).
> **Va tutto nella 2.26.0-rc.10**, insieme all'[occhio sulle password](2026-11-09-occhio-sulle-password.md) (scelta del maintainer, 09-11).

## 1. Il problema, misurato

Il pannello è il WP630, con Chromium 131 in kiosk su ARM. Sulla pagina iniziale del template Montagna, dopo 10-20 minuti:
- il thread principale del renderer occupa il 96% di un core;
- l'impronta del progetto dovrebbe arrivare ogni 3 s, invece arriva ogni 6-32 s;
- il login sembra bloccato per minuti;
- i valori a schermo sono vecchi fino a 29 s, e nessun avviso lo dice.

Il banco riproduce il guasto. Usa Chromium headless con la CPU rallentata ×6. La base è in `esiti/base` e in `esiti/base-15min`.

| finestra (×6) | occupato | punti (la polilinea più lunga) | dato vecchio, massimo | impronta |
|---|---|---|---|---|
| f01, 30 s | 42,8% | 796 (324) | 0,2 s | 3,0 s |
| f06, 180 s (alba) | 75,5% | 4.267 (1.824) | 0,2 s | 3,0 s |
| f16, 480 s | 99,3% | 11.846 (4.823) | 0,2 s | 3,0 s |
| f24, 720 s | 99,4% | 17.254 (7.223) | 0,9 s | 3,0 s |
| f30, 900 s | 99,4% | 21.708 (9.017) | 7,2 s | 9,6-10,2 s |

- A ×1 l'occupato passa dal 23,6% al 25,9% in 3 minuti. Il costo cresce coi punti anche senza rallentamento.
- Il traffico è di 10,5 messaggi WS al secondo, con 32,6 voci al secondo. I due tag dei generatori arrivano 10 volte al secondo. Gli altri 13 tag arrivano una volta al secondo, anche quando sono fermi.
- In 8 minuti la pagina fa 642 richieste HTTP. Di queste, 408 sono statistiche di `KpiDelta`.
- Il profilo a ×6 dice:
  - `SparklineWidget` prende il 42% del tempo in proprio;
  - `setAttribute` prende il 16%;
  - il resto è quasi tutto render e commit di React.
- Ogni 1.000 punti costano circa 4,6 punti di occupato.
- Tolti i punti, resta un costo fisso: 39% di notte e 56% di giorno. È il ridisegno di tutta la pagina, 10,5 volte al secondo.
- Le corse si confrontano finestra per finestra. La giornata simulata dura 600 s e riparte da capo a ogni corsa.

## 2. Le cause, con le righe

1. **La mini tendenza** (`sws-editor/src/canvas/SvgCanvas.tsx:3158-3240`).
   - A ogni cambio di valore aggiunge un campione, e intanto copia e filtra tutto l'array (:3191-3200).
   - A ogni render calcola `Math.min(...)` sull'array (:3219) e rifà due stringhe lunghe quanto l'array (:3226, :3232-3233).
   - Un tag a 10 Hz arriva a 36.000 punti in un'ora.
   - L'asse del tempo usa `Date.now()` nel render (:3221). La linea scorre solo perché altri tag fanno ridisegnare la pagina.
   - Usa due orologi: il seme ha il tempo del server, il dato vivo ha `Date.now()` del browser (:3183-3184, :3195).
2. **Due generatori a 10 Hz nel template** (`examples/templates/montagna-rinnovabile/project.yaml:128-153`). Il tick dei generatori è di 100 ms per tutti (`sws-runtime/crates/sws-runtime/src/main.rs:1053-1083`).
3. **Ogni messaggio ridisegna tutta la pagina.**
   - `runtime-view/RuntimeView.tsx:137` si iscrive alla mappa intera dei valori. La passa a `SvgCanvas` (:505-519) e a `PaginaFinestra` (:522-538).
   - Né `SvgCanvas` (:691) né `SvgObject` (:3677) sono memoizzati.
   - Nell'IDE succede lo stesso: `editor/EditorShell.tsx:708`.
4. **Lo store si scrive una volta per voce.**
   - `ws/tagStream.ts:108-133` chiama `updateTagValue` per ogni voce, e `store/index.ts:2868` copia tutta la mappa a ogni chiamata.
   - Zustand 5 riesegue tutti i selettori a ogni `set()`.
   - Quando la pagina è in ritardo, i messaggi si mettono in coda.
5. **I valori uguali vengono ritrasmessi.**
   - `TagDb::set` trasmette anche le scritture uguali (`sws-core/src/tag.rs:423-477`).
   - Una foglia scritta trasmette la sua radice (:465). Il batcher la riespande in tutte le foglie (`sws-web/src/router.rs:9351-9360`).
6. **Il filtro di pagina si perde.**
   - `tagStream.ts:86` manda `["*"]` a ogni apertura del socket.
   - `RuntimeView.tsx:232-235` manda la lista dei tag della pagina solo quando la lista cambia.
   - `ws/reconnectingWs.ts:146-147` scarta il messaggio in silenzio se il socket non è aperto.
   - Risultato: dopo l'avvio, dopo un login e dopo una riconnessione il viewer riceve tutti i tag.
   - Su Montagna pesa poco, perché la pagina usa quasi tutti i tag. Sui progetti grandi pesa molto.

## 3. Verificato nel codice, e cosa cambia

- **Il seme della mini tendenza ha già un limite.** `getHistory` senza secchielli è ridotto a 1.000 punti (`sws-historian/src/lib.rs:52`). Quello che cresce è il buffer dei dati vivi.
- **Il server tiene già solo l'ultimo valore per id, ogni 50 ms** (`router.rs:9297-9298`, :9323). Raccogliere i valori grezzi fuori da React non renderebbe min e max più esatti. Basta che la mini tendenza legga il valore del suo tag.
- **I secchielli del server non dicono se il minimo viene prima del massimo** (`types/index.ts:923-931`). Per il seme l'ordine si ricava dall'andamento fra primo e ultimo valore.
- **I punti di una kpi non si fermano dopo il primo minuto.** La finestra è di 3.600 s, quindi le colonne si riempiono per un'ora intera. Il limite da controllare è «al massimo 4 punti per colonna».
- **La crescita si confronta alla stessa ora simulata**: f25 con f05, f30 con f10, cioè 600 s dopo. Confrontare f16 con f06 vorrebbe dire confrontare il tramonto con l'alba.
- **Il ritardo del dato si misura solo sulla copia a 10 Hz.** Il banco lo ricava dalla rampa di `s.energia_oggi` (`banco/misura.js:54-59`, :213). A 1 Hz la rampa sale a gradini di 1 s, e la misura avrebbe 1 s di errore.
- **`banco.sh` accetta già `TEMPLATE=` e `WWW=`** (righe 10-12).
- **Nell'IDE le callback non sono stabili.** `EditorShell.tsx:1199-1207` passa a `SvgCanvas` `handleSelect` e callback scritte in linea, nuove a ogni render. Un memo che non le stabilizza dentro `SvgCanvas` non salta mai niente in edit.
- **C'è già un ciclo di import.** `collectTagIds.ts:16` importa da `SvgCanvas.tsx`, e `tag/rinominaTag.ts:128-130` documenta il ciclo. I parametri dei faceplate vanno spostati in un modulo loro, per non allargarlo.
- **Le letture al momento del gesto restano giuste col memo.** Incremento (:3901), toggle (:3788-3789) e checkbox (:5329) leggono il bersaglio, e il bersaglio è fra le dipendenze dell'oggetto. Non serve un test «clic prima del ridisegno»: oggi non sarebbe rosso, perché React ridisegna prima del clic.
- **`collectTagIds` non serve solo al filtro.** Lo usano anche `search/tagUsage.ts:114`, `search/findObjects.ts:26` e `tag/rinominaTag.ts:241`. Correggerlo cambia anche ricerca e rinomina, in meglio. I loro test devono girare.

## 4. Decisioni

**Prese con questo piano:**
- **Il bus non si tocca.** `TagDb::set` continua a trasmettere anche le scritture uguali. Se smettesse, si romperebbero in silenzio:
  - lo stale dei due visori: `SvgCanvas.tsx:2037-2038` sul web, `sws-lvgl-viewer/src/effects.rs:138-173` su LVGL;
  - gli script globali con edge `any` (`global_scripts.rs:287-289`);
  - l'anello dello storico (`sws-historian/src/lib.rs:267-289`);
  - i tag derivati e i timestamp dello specchio OPC-UA.
- **Lo store scarta solo le triple identiche: valore, qualità e timestamp.** Non basta confrontare valore e qualità, perché il timestamp serve allo stale e alla colonna «time» della tabella (:5489-5491).
- **Il template passa a 1 Hz dentro lo script `giornata`.** È lo stesso spostamento già fatto per `s.ora` e `s.luce` (`project.yaml:174-177`). Non si aggiunge un campo «ritmo» a `GeneratorSpec` (`sws-core/src/project.rs:398-408`): sarebbe un cambio di prodotto.
- **La kpi in edit mostra mini tendenza e variazione.** Oggi in edit non le disegna (`SvgCanvas.tsx:6233`), e per la regola UI 1 è un difetto. In edit fa una richiesta al montaggio e niente polling.
- **La prop `tagValues` di `SvgCanvas` e `SvgObject` resta.** La usano 12 file di test, le miniature (`LeftPanel.tsx:393-399`) e `boot/rasterizza.ts:257-261`.
- **Si fa prima il ridisegno mirato col memo (ramo B).** L'iscrizione per oggetto (§7) si apre solo se il banco la chiede.

**Tecniche, chiuse il 09-11 sulle proposte del piano:**
1. La linea della mini tendenza arriva fino ad «adesso», con l'ultimo valore (lo storico lo fa già con `ancora`, `router.rs:4076-4091`).
2. `s.rete_scambio` resta un triangolo, con la forma di oggi. La versione «realistica» va negli Appunti.
3. La guardia del ramo B legge i template da una **fixture JSON generata con `python3`** (PyYAML c'è già, come in `check_demo_templates.sh`), tenuta allineata da una guardia in `check_static.sh`. Nessuna dipendenza npm nuova: in `node_modules` un parser YAML non c'è.

**Decise dal maintainer il 09-11-2026** (domande dirette, una per punto):
- **Dati in ritardo** — «Fascia + valori grigi»: quando i valori a schermo sono vecchi di più di **5 s** compare in alto la fascia «Dati in ritardo di N s» (testo di sistema `dati_in_ritardo`, nella lingua dei contenuti, già aggiunto alla tabella) e gli oggetti prendono lo stile «non aggiornato» che esiste già; sparisce da sola. **Su web e su LVGL.** Vedi §5-bis.
- **Attese** — «Avviso 10 s, stop 60 s»: dopo 10 s il pulsante del login dice «Il pannello risponde lentamente…»; a 60 s si ferma con «Nessuna risposta, riprova». Dopo il login chiesto per l'aggiornamento, finché l'aggiornamento non è partito, si legge «Aggiornamento in avvio…» e non «Logging in…». Vedi §5-bis.
- **Montagna** — «Template a 1 Hz, WP630 invariato»: il template passa a 1 Hz (passo 3); il progetto sul WP630 resta a 10 Hz e fa da prova di carico nel collaudo.
- **Server** — «Decidi tu sulle misure»: il bus non cambia (§4, §8); il passo facoltativo del §8 si apre solo se le misure lo chiedono.
- **Collaudo** — «rc.10 completa»: ramo A, ramo B (annidato) e occhio (annidato) vanno in `main` e nella 2.26.0-rc.10; il WP630 si aggiorna dal viewer.
- **LVGL** — l'esigenza è unificata a tutti gli ambienti (maintainer, 09-11): la crescita della sparkline LVGL (§13, prima riga) entra in questo lavoro, nel ramo A.

## 5. Ramo A — `fix/mini-tendenze-leggere`, quello già aperto

Questo ramo toglie la crescita nel tempo e la coda dei messaggi, e porta il template a 1 Hz. Non aggiunge filtri né confronti nel memo, quindi non può lasciare un oggetto fermo.

### Passo 0 — banco e piano (0,5 h)
- **Prima del passo 3** si copia il template: `cp -a examples/templates/montagna-rinnovabile tmp/viewer-leggero/montagna-10hz`. È il caso pesante: senza la copia il banco non potrebbe più misurarlo.
- Dopo ogni passo che tocca `sws-editor`:
  1. `pnpm build`;
  2. copia di `dist` in `tmp/viewer-leggero/www-<passo>`;
  3. banco con `WWW=` puntato a quella copia.
  Così una build di un'altra sessione non cambia la misura.
- Un commit con: questo piano, la sua riga nel README, il seme 2026-10-17 in archivio con la risposta del §8.

### Passo 1 — la mini tendenza a secchielli (5 h)

**`sws-editor/src/canvas/miniSerie.ts`**, nuovo. È logica pura, senza React.
- Una colonna di pixel corrisponde a un secchiello di tempo.
- Per ogni secchiello si tengono primo valore, minimo, massimo, ultimo valore e l'ordine fra minimo e massimo. È il metodo «M4»: dà la stessa immagine che si avrebbe disegnando tutti i campioni.
- Il secchiello vale `max(100, round(finestraMs / colonne))` millisecondi.
- Le operazioni:
  - `aggiungi(ts, v)` costa O(1);
  - `semina(BucketSample[])` carica lo storico;
  - `avanza(adesso)` sposta la testa e scarta i secchielli usciti;
  - `disegno(geometria)` restituisce `{ linea, area, ultimo }` in O(colonne);
  - `versione` cresce ogni volta che il disegno cambia.
- I dati stanno in un anello di `Float64Array`. L'allineamento è lo stesso del server: `ts - ts % secchiello` (`sws-historian/src/lib.rs:577`).
- La fusione è idempotente: seme e dato vivo si possono sovrapporre senza doppioni. Il filtro `s.ts < firstLive` sparisce.

**`sws-editor/src/canvas/MiniTendenza.tsx`**, nuovo, con `memo`. Sostituisce `SparklineWidget` nella kpi (:6241-6245) e nella sparkline (:6266-6283).
- Riceve solo `valore?: TagState`, cioè lo stato del suo tag. Non riceve più la mappa intera.
- **Seme.** Chiama `api.getHistoryBuckets(tag, { fromMs, toMs, bucketMs, ancora: true })` (`api/client.ts:2028`). Lo fa al montaggio e quando cambiano tag, finestra o larghezza. Arrivano circa 144 secchielli.
- **Un orologio solo, quello del server.** Il dato vivo usa il suo `timestamp_ms`. «Adesso» vale `Date.now()` più lo scarto stimato all'arrivo dell'ultimo valore. Finché non arriva niente, lo scarto è 0.
- **Un orologio proprio.** Un `setTimeout` scatta al prossimo confine di secchiello e ridisegna. Per le kpi di Montagna scatta ogni 25 s.
- Le stringhe dei punti stanno in un `useMemo`, che dipende da versione, testa e geometria.
- Il disegno resta un `<polyline>`, perché il banco conta i punti lì (`misura.js:180`).
- Le kpi di Montagna hanno 144 px utili e una finestra di 3.600 s: un secchiello vale 25 s. I punti sono al massimo 578 per riquadro.
- **In edit** la kpi mostra mini tendenza e `KpiDelta` (:6233). `KpiDelta` (:3123-3156) fa una richiesta sola, senza l'intervallo di :3145.

**Test.**
- `src/canvas/miniSerie.test.ts`:
  - 36.000 campioni a 10 Hz su 3.600 s e 144 colonne danno al massimo 4·144+2 punti;
  - seme e dato vivo sovrapposti danno lo stesso disegno del solo dato vivo;
  - un picco di un solo campione resta nel massimo;
  - `avanza` di un'ora svuota tutto.
- `tests/miniTendenza.test.tsx`: monta `SvgObject` con `tagValues` come prop e un'api finta. Questi test sono **rossi oggi**:
  - 5.000 cambi in 50 s, su una sparkline di 60 s larga 120, danno al massimo 4·116+2 punti. Oggi sono 5.000;
  - senza valori nuovi, `advanceTimersByTime(3 × secchiello)` fa scorrere la linea. Oggi resta ferma;
  - con il seme 10 minuti avanti rispetto a `Date.now()`, nessun campione si perde e nessuno si raddoppia;
  - la kpi in edit ha il `<polyline>`, e dopo 60 s finti `getHistoryStats` non viene chiamato una seconda volta.

### Passo 2 — una scrittura nello store per fotogramma (2,5 h)

**`store/index.ts`**: nuova azione `applicaValori(voci: ReadonlyMap<string, TagState>)`.
- Fa una sola `set()`.
- Salta le triple identiche e tiene lo stesso oggetto.
- Copia la mappa una volta sola, alla prima voce diversa.
- Se non cambia niente restituisce `s` com'è, e zustand non avvisa nessuno.
- È un'unione: uno snapshot filtrato non cancella le altre voci.
- `updateTagValue` resta, perché la usano i test, e diventa una chiamata ad `applicaValori` con una voce.

**`ws/coalescenza.ts`**, nuovo.
- `accoda(voci)` mette le voci in attesa. Per ogni id vince l'ultima.
- `svuotaOra()` applica subito.
- `impostaPianificatore()` serve ai test.
- Il pianificatore usa `requestAnimationFrame`, più un `setTimeout(100)` di riserva per la scheda nascosta. Parte chi arriva prima, l'altro si annulla.
- Con la pagina in ritardo i messaggi si fondono invece di accodarsi.

**`ws/tagStream.ts:108-134`**:
- snapshot e delta passano da `accoda()`;
- l'`ack` con errore (:95-106) resta immediato;
- dopo uno snapshot `lastSeq` torna a −1. Sul server snapshot e delta hanno contatori diversi (`router.rs:9222`, :9315), e da lì vengono i falsi «seq gap».

Niente `flushSync` della pagina nel fotogramma. Lo store si ridisegna nel microtask dopo la callback di rAF, quindi prima della pittura. Così il tubo che segue la pompa resta nello stesso fotogramma (`tests/motoVivo.test.tsx`).

**Test**: `tests/tagStream.test.ts`, nuovo. Usa `vi.mock("@/ws/singletonWs")` con un socket finto.
- **Rossi oggi**:
  - tre delta da 10 voci nello stesso giro producono una sola notifica dello store. Oggi ne producono 30;
  - la stessa tripla arrivata due volte lascia lo stesso riferimento e nessuna notifica.
- Guardie:
  - uno snapshot da 500 voci fa una sola scrittura, e le altre voci restano;
  - un `ack` con errore lancia subito `sws:write-failed`;
  - senza rAF i valori arrivano entro 100 ms.

### Passo 3 — il template Montagna a 1 Hz (1 h)
- In `project.yaml:128-153` si tolgono i due `generator:`. Le descrizioni dei due tag dicono che li scrive lo script «giornata».
- Nello script `giornata`, dopo il calcolo di `h`, si aggiungono due scritture:
  - `s.rete_scambio`: `r = abs((h / 3.0) % 2.0 - 1.0)`, poi `round(-60.0 + 150.0 * (1.0 - r), 1)`. È un triangolo da −60 a 90 con periodo di 150 s;
  - `s.energia_oggi`: `round(5200.0 * h / 24.0, 0)`.
- `README.md:35` del template va corretto: i due tag non sono più generatori.
- I progetti già creati dal template restano a 10 Hz: quello del pannello e `~/sws_projects/test`. Il pannello resta così per il collaudo del codice, e dopo si aggiorna a mano.
- Verifiche:
  - `check_templates` dentro `check_static.sh`;
  - le due pagine mostrano gli stessi tag di prima: `Impianto — Opus 5.5.yaml:101` e :116, `Impianto — Kimi K3.1 Pro.yaml:193` e :203.

### Chiusura del ramo A (2 h)
- Definition of done: `cargo check`, `pnpm build`, `./scripts/check_static.sh`, `cargo test`, `pnpm exec vitest run`. Poi si ricompila l'IDE 8460.
- Corse del banco (§9) sulla copia a 10 Hz e sul template.
- `CHANGELOG.md`, sotto `[Unreleased]`.
- `NOVITA.yaml`:
  - IT «Le mini tendenze non rallentano più il pannello col passare del tempo.»
  - EN «Mini-trends no longer slow the panel down over time.»
- `STATUS.md` e `docs/COLLAUDI_IN_SOSPESO.md`, con le voci del §10.
- Scelta «rc.10 completa» (09-11): A, B e l'occhio, annidati, si mergiano insieme in `main` dopo la definition of done; poi la 2.26.0-rc.10 (tag alla costruzione) e il collaudo sul WP630, che chiude la definition of done dopo (vedi `/test-changes`). I rami si eliminano subito dopo lo squash.

## 5-bis. Ramo A, in più: i segnali decisi il 09-11 e LVGL

**Dati in ritardo, web** (2-3 h).
- **Cosa misura.** L'età del dato *quando la pagina lo applica*: `adesso − ts` della voce, meno lo scarto fra orologio del server e del browser stimato come il **minimo** `adesso − ts` visto sulla connessione (così un orologio sfasato non dà falsi allarmi). Si calcola in `coalescenza.ts` al momento dell'applicazione: è lì che si vede la coda.
- **In più il socket**: chiuso o in riconnessione da più di 5 s vale come «in ritardo». Un impianto fermo che non manda niente **non** è in ritardo: senza messaggi non si accende niente, finché il socket è vivo.
- **Cosa si vede.** Oltre 5 s: la fascia in alto con `dati_in_ritardo` (`{n}` i secondi, arrotondati) e lo stile «non aggiornato» su tutti gli oggetti della pagina, lo stesso dello stale (`SvgCanvas.tsx:2037-2038`). Si spegne quando l'età torna sotto i 5 s. Nell'IDE in edit no: è un segnale per l'operatore.
- **Test rossi oggi**: voci con `ts` vecchio di 8 s → fascia con «8 s» e oggetti grigi; scarto d'orologio di +60 s ma età vera 0 → niente fascia; socket chiuso da 6 s → fascia.

**Le attese del login e dell'aggiornamento** (1,5 h).
- `LoginScreen.tsx`: dopo 10 s il pulsante dice «Il pannello risponde lentamente…» (i18n, it/en: l'interfaccia non ha altre lingue; con le credenziali dell'installazione, cioè l'IDE, «Il server risponde lentamente…», perché lì un pannello non c'è); a 60 s la richiesta si annulla (`AbortController`) e compare «Nessuna risposta, riprova», con il pulsante di nuovo attivo. Un `AbortSignal` passa per `request()` di `api/client.ts` solo per il login (niente timeout globale in questo ramo).
- `AvvisoAggiornamento.tsx`: dal tocco su «Aggiorna ora» fino alla risposta di `/api/update/apply`, compreso il login chiesto in mezzo, il testo è «Aggiornamento in avvio…»; e «Aggiorna ora» resta spento anche quando la pagina sa da `/api/update/status` che un aggiornamento è già in corso (oggi si spegne solo per lo stato locale, `AvvisoAggiornamento.tsx:98`).
- **Test rossi oggi**: con timer finti e un login che non risponde, a 10 s il testo cambia e a 60 s compare l'errore; con `in_corso: true` dal server «Aggiorna ora» è spento.

**LVGL** (2-3 h), crate `sws-lvgl-viewer`.
- **Il poller della sparkline** (`client.rs:1089-1129`) si ferma quando nessuno lo usa più (`Arc::strong_count`, come il poller dei trend a :1213); un test che cambia pagina tre volte e conta i poller vivi.
- **Il buffer della sparkline** LVGL non cresce oltre la larghezza (stesso principio dei secchielli), se oggi cresce: da misurare prima, con un test.
- *Superati dalla revisione del 09-11:* il poller chiedeva comunque l'ora intera ogni 2 s per mini tendenza, e il costo cadeva sul runtime del pannello. Ora la sparkline LVGL è la `MiniSerie` del web portata in `mini_serie.rs` (`Viva`): il seme una volta, i valori del socket negli stessi secchi, la testa che scorre al confine del secchio. Niente poller.
- **Dati in ritardo**: stessa regola del web (5 s, scarto d'orologio dal minimo, socket chiuso) e lo stesso testo `Testo::DatiInRitardo`; la fascia in alto e lo stile «non aggiornato» (`effects.rs:138-173`) su tutti gli oggetti.

## 6. Ramo B — `fix/ridisegno-mirato`

Il ramo B **si annida su A** (scelta «rc.10 completa»: si mergiano insieme dopo le verifiche).

Fa due cose:
- ridisegna solo gli oggetti con almeno un tag cambiato;
- fa funzionare davvero il filtro di pagina.

Tutte e due possono lasciare un oggetto fermo senza avviso. Per questo stanno nello stesso ramo, dietro la stessa guardia.

### Passo 4 — una fonte sola per le dipendenze, e il filtro che non si perde (4 h)

**`canvas/parametriFaceplate.ts`**, nuovo.
- Contiene `substituteFaceplateParams` (oggi a :3556) ed `effectiveFaceplateParams` (oggi a :3590).
- Aggiunge `figliDelFaceplate(istanza, def)`: parametri effettivi più `faceplate_overrides` (:6921-6926).
- Li usano la raccolta dei tag, l'istanza (:6918-6926) e il popup (:3654).
- `SvgCanvas.tsx` li riesporta. `collectTagIds.ts` smette di importare da `SvgCanvas.tsx`.

**`runtime-view/collectTagIds.ts`**: nasce `dipendenzeOggetto(obj, faceplates, objects?)`.
- Restituisce `{ ids, conTempo, tutti }`.
- Il risultato si tiene in una `WeakMap` sull'oggetto. Per i tubi la chiave include anche `objects`.
- `collectTagIds` diventa l'unione delle dipendenze, più i figli dei popup.
- Le dipendenze coprono:
  - tutto quello che `collectTagIds` raccoglie oggi;
  - i figli dei faceplate, con `figliDelFaceplate` a ogni livello e la guardia anti-ciclo. Oggi :110 usa i parametri grezzi;
  - i figli del popup aperto da `open_faceplate` (:2086-2090), con i parametri del bottone;
  - per i tubi, i legami e il `motion_tag` delle ancore (:4333-4337, `motoVivo.ts:84-99`);
  - `tutti: true` quando un legame riscrive un campo-tag. Lo schema lo permette (`types/index.ts:665`), e in quel caso l'oggetto confronta tutta la mappa;
  - `conTempo` quando c'è una tabella con la colonna «time». ~~O `stale_after_s`~~: tolto il 09-11 su rilievo della revisione — la ⌛ la mette l'involucro di pagina, fuori dal memo, e un oggetto con lo stale su un tag ritrasmesso uguale a 1 Hz si ridisegnava ogni secondo per niente.

**`tagDellaVista(...)`**, nuova, usata da `RuntimeView.tsx:221-230`. Aggiunge il `background_tag` della pagina-finestra, che oggi manca (:528).

**`ws/tagStream.ts`**: la sottoscrizione voluta sta in una variabile di modulo e all'inizio vale `["*"]`.
- `sendSubscribe` (:64-66) la aggiorna e la manda se il socket è aperto.
- `onOpen` (:86) manda quella, non più `["*"]` fisso.
- `RuntimeView` la riporta a `["*"]` quando si smonta.
- L'IDE non chiama mai `sendSubscribe` e resta su `["*"]` (`App.tsx:313`).

**Test rossi oggi.**
- `tests/tagStream.test.ts`: `sendSubscribe(["a","b"])` col socket ancora in CONNECTING, poi `open`. Il primo subscribe mandato deve essere `["a","b"]`, oggi è `["*"]`. Lo stesso dopo una riconnessione e dopo un cambio di token.
- `collectTagIds.test.ts`:
  - un'istanza che usa il valore predefinito raccoglie `default.x`, non `{p}.x`;
  - un override con un altro tag viene raccolto;
  - un bottone `open_faceplate` fa raccogliere i figli del popup;
  - `tagDellaVista`, con una finestra aperta, contiene il `background_tag` della finestra;
  - un tubo raccoglie i legami e il `motion_tag` delle sue ancore.
- `tests/dipendenzeComplete.test.tsx`, la guardia.
  - Prende gli oggetti dei template `demo-items-web`, `demo-items-lvgl` (39 tipi), `grid-playground` e `montagna-rinnovabile`.
  - Ogni oggetto si monta con `SvgObject` e un `tagValues` dentro un `Proxy`.
  - Il Proxy risponde a ogni chiave con un valore buono, così tutti i rami leggono, e registra le letture.
  - Ogni lettura deve stare in `dipendenzeOggetto(obj)`. Un `ownKeys`, cioè un oggetto che scorre tutta la mappa, è un errore.
  - Diventa rossa oggi aggiungendo un faceplate di prova col parametro predefinito.
- Girano anche i test di `tagUsage`, `findObjects`, `rinominaTag` e `search`.

### Passo 5 — il ridisegno mirato (7 h)

**5a. La mappa scende di un livello.**
- In `RuntimeView.tsx` nasce un figlio, `PaginaViva`. Prende la mappa (oggi a :137) e disegna lo sfondo (:508, :528), `SvgCanvas` e `PaginaFinestra`.
- Così barra, toast, login e `FunctionTestPanel` smettono di ridisegnarsi a ogni messaggio.
- La stringa `pagineNavigabili(pages).map(` resta in `RuntimeView`, perché la cerca `tests/bootTipi.test.ts:88-100`.
- In `EditorShell.tsx:708` e :1181-1184 si fa lo stesso, con un figlio `CanvasVivo`.
- In `EditorShell.tsx:3226` e :3587 la mappa diventa un selettore su un tag solo, come `ValoreLive` (`editor/proprieta/Collegamenti.tsx:146`).

**5b. Callback stabili dentro `SvgCanvas`.**
- Un ref tiene le ultime `onSelect`, `onWriteTag`, `onScript`, `onNavigate`, `onSelectCell*`, `onSelectSubCell` e `startDrag` (:1665). Le funzioni passate agli oggetti sono stabili, create una volta, e chiamano sempre le ultime.
- La presenza si conserva: se la callback non c'è, resta `undefined`. Il codice controlla `onScript ?` e `onMove ?`.
- Così basta un intervento solo, e vale sia per `RuntimeView` sia per `EditorShell`.
- I default di `tagValues` (:693), `customSymbols` (:705) e `faceplates` (:706) diventano costanti di modulo.
- Diventa stabile anche l'`onClose` del popup (:1775).

**5c. `SvgObject` diventa memo, con un confronto sulle dipendenze** (:3677).
- Tutte le prop si confrontano per riferimento, con due eccezioni:
  - `tagValues`: si confrontano solo gli id di `dipendenzeOggetto`. Valore con `Object.is`, qualità, e il timestamp solo se c'è `conTempo`;
  - `objects`: conta solo per `pipe`, `grid` e `faceplate`.
- Con `tutti` l'oggetto si ridisegna sempre.
- L'involucro di pagina (:1987-2189) resta nel ciclo della radice, che ha ancora la mappa intera: visibilità, lampeggio, stale, Bad, moto e bordo d'allarme non cambiano. Il `<g data-moto>` resta dov'è (`motoVivo.ts:62-79`).
- I figli di griglie e faceplate nascono nuovi a ogni render (:4072-4076, :6768-6772). Si ridisegnano insieme al padre, che ha già le loro dipendenze.

**5d. Letture che oggi si aggiornano solo perché si ridisegna tutto.**
- Lo stile del progetto si legge fuori da React (:4362, :6507, `coloriPredefiniti.ts:128`). `SvgObjectCorpo` chiama `useStileProgetto()`, così ogni oggetto si aggiorna quando lo stile cambia.
- `lang_button` e `lang_selector` leggono `getState()` dentro il render (:4757, :4789). Si aggiungono due selettori.

**5e. Piccoli costi.**
- In `TrendCanvas` gli array `tags`, `seriesLabels` e `seriesStyles` vanno in un `useMemo` (:5595-5604). Oggi ogni render li ricrea e ridisegna tutto il canvas (`TrendCanvas.tsx:1189`).
- In `descrizioniDeiTag` il default `types = []` diventa una costante (`tag/forma.ts:169`). Oggi, se il progetto non ha tipi, la cache non funziona mai.
- `sanitizeSvg` dei simboli inline va in un `useMemo` (:6556).

**Test.**
- `tests/ridisegnoMirato.test.tsx`, **rosso oggi**.
  - Monta `SvgCanvas` con gli oggetti della pagina iniziale di Montagna. Senza un parser YAML si usano 30 oggetti sintetici.
  - Cambia solo `s.rete_scambio`.
  - `localizeObject` (`i18n/projectI18n.ts:88`, contato con `vi.mock`) deve essere chiamato solo per `bil_rete`. Oggi è chiamato per tutti e 39 gli oggetti.
  - Si ripete in edit, con callback scritte in linea come fa `EditorShell`.
- `tests/oggettoMemo.test.tsx`, guardie verdi prima e dopo:
  - si cambia un tag non suo, poi il suo; l'incremento parte dal valore nuovo;
  - stale con `stale_after_s: 5` e timer finti. Se il timestamp si rinfresca ogni secondo, la ⌛ non compare. Se il tag resta fermo 6 s, compare;
  - `impostaStileProgetto` cambia il tubo, senza nessun cambio di tag;
  - il cambio di lingua aggiorna il `lang_button`.
- Devono restare verdi senza modifiche: `domandeViewer` (:95), `sliderFase1`, `tuboSegueOggetto`, `motoVivo`, `opacitaLegataStabile`, `lucchettoRuolo`, `scorrimentoPagine`, `simboli*`, `assegnazioni`, `linguaContenuti`, `stileProgetto`.

### Chiusura del ramo B (1,5 h)
Come per il ramo A. Le righe di `NOVITA.yaml`:
- IT «La pagina ridisegna solo gli oggetti i cui valori cambiano.»
- EN «The page redraws only the objects whose values change.»

## 7. Se non basta: l'iscrizione per oggetto

Questa tappa si apre solo se, dopo il ramo B, succede almeno una di queste cose:
- la copia a 10 Hz resta al 25% o più a ×6;
- l'IDE su CasaDomotica resta lento quando si trascina o si scrive;
- una pagina con centinaia di oggetti mostra il ciclo della radice nel profilo.

L'idea, da progettare allora:
- l'involucro di pagina diventa un componente per oggetto, iscritto allo store con `useSyncExternalStore` sulle sue dipendenze;
- lo stale diventa un timer per oggetto;
- popup e sfondo si iscrivono da soli;
- la sorgente dei valori resta iniettabile, con un default fisso per miniature, `rasterizza` e test.

Il primo passo è una sessione di plan dedicata.

## 8. Il server, e il seme 2026-10-17

- `TagDb::set` non cambia (§4). Il contratto «ogni scrittura è un evento» resta (`sws-banco/src/main.rs:15-17`).
- Il punto degli allarmi del seme è già risolto dal commit `ce5c6b91`.
- Nel client, dopo il passo 2 le triple identiche non producono più nessun lavoro.
- **Passo facoltativo (3-4 h)** sul batcher WS (`router.rs:9290-9380`). Si apre se il journal del WP630 contiene «ws/tags subscriber lagged», o se si collegano molti browser. Cosa fa:
  - per ogni connessione scarta le voci identiche all'ultima mandata, dopo l'espansione delle foglie. Il modello è il plugin MQTT (`sws-plugin-mqtt/src/lib.rs:543-548`);
  - usa un solo contatore `seq` per snapshot e delta;
  - smette di bloccarsi su `.send().await` (:9375) e continua ad accumulare in `pending`;
  - su `Lagged` (:9325-9327) manda uno snapshot di riallineamento;
  - lo snapshot dopo un subscribe parte con `try_send` (:9249) e può perdersi, quindi la mappa «ultimo mandato» si svuota a ogni snapshot.

## 9. Come si misura

```
cd /home/ut1/sws/tmp/viewer-leggero/banco
WWW=../www-<passo> TEMPLATE=../montagna-10hz ./banco.sh <passo>-10hz
WWW=../www-<passo> TEMPLATE=../montagna-10hz SOLO_X6=1 DUR6=900 ./banco.sh <passo>-10hz-15min
WWW=../www-<passo> ./banco.sh <passo>-1hz            # dal passo 3 in poi
node confronta.js esiti/base esiti/<passo>-10hz
```

| misura | base | dopo il ramo A | dopo il ramo B |
|---|---|---|---|
| crescita nella corsa da 15 min: f25−f05 e f30−f10 | il pannello satura | ≤ 3 punti sulla copia a 10 Hz | ≤ 3 punti |
| punti in pagina, ogni finestra | 796 → 21.708 | ≤ 4 per colonna piena, ≤ 7.000 | uguale |
| impronta, mediana / massimo per finestra (15 min) | 3,0 → 10 s | ≤ 3,5 s / ≤ 4 s | uguale |
| dato vecchio, massimo (solo copia a 10 Hz) | fino a 7,2 s | ≤ 0,5 s | ≤ 0,5 s |
| tempo di risposta della pagina, massimo | fino a 7,2 s | ≤ 100 ms | ≤ 100 ms |
| occupato ×6, template a 1 Hz | — | < 25% in ogni finestra | < 15% (indicativo) |
| occupato ×6, copia a 10 Hz | 43 → 99% | piatto; atteso 40-55%, non è un obiettivo | **< 25% in ogni finestra** |
| occupato ×1, copia a 10 Hz | 23-26% | ≤ 10% (indicativo) | ≤ 5% (indicativo) |

## 10. Collaudo con `/test-changes` (voci per `COLLAUDI_IN_SOSPESO.md`)

**Ramo A**, sul WP630 col progetto ancora a 10 Hz:
1. 30 minuti sulla pagina iniziale di Montagna. Il login si apre subito. I valori sono freschi (si confrontano con l'IDE). Le mini tendenze scorrono anche a valore fermo.
2. CPU del renderer con `top`. Prima si chiede l'accesso SSH. La CPU resta piatta fra il minuto 5 e il minuto 30; la base è il 96%.
3. Journal del runtime: non deve contenere «ws/tags subscriber lagged». Se c'è, si apre il passo facoltativo del §8.
4. IDE 8460, Montagna in edit: le kpi mostrano mini tendenza e variazione.

**Ramo A, i segnali del 09-11:**
- Dati in ritardo, **socket giù**: si ferma il runtime per 10 s (sul pannello serve SSH: chiederlo prima). Il socket si chiude; dopo 5 s compaiono la fascia «Dati in ritardo di N s» e gli oggetti grigi, e il numero sale di 1 al secondo; al riavvio spariscono. Sul viewer web e sul viewer LVGL. *Non* staccando la rete: il socket resta aperto per minuti, nessuno dei due motori ha un battito, e per decisione un socket vivo e muto è un impianto fermo (revisione del 09-11; il battito è negli Appunti).
- Dati in ritardo, **aspetto**: sul LVGL `--ritardo-di-prova 8`.
- Dati in ritardo, **età vera**: sul banco, con `WWW` sulla base e la copia a 10 Hz a ×6, la fascia deve comparire; col ramo A no (le tre corse del 09-11: mai comparsa).
- Login: «Il pannello risponde lentamente…» dopo 10 s si prova solo con un pannello lento; sull'IDE dice «Il server risponde lentamente…». L'aggiornamento dal viewer, web e LVGL, mostra «Aggiornamento in avvio…» dal tocco fino alla partenza, e «Aggiorna ora» è spento se un aggiornamento è già in corso.
- LVGL: Montagna sul viewer LVGL per 30 minuti, CPU del viewer **e del runtime** piatte (fino alla revisione la mini tendenza LVGL chiedeva l'ora intera ogni 2 s, e quel costo cadeva sul runtime).

**Ramo B:**
5. Popup faceplate e pagina-finestra con sfondo da variabile: i valori si muovono.
6. Il tubo segue la pompa. Toggle con conferma, incremento e checkbox funzionano. Il badge stale compare quando deve.
7. IDE su CasaDomotica: il trascinamento è fluido, il pannello proprietà non è in ritardo, nessun valore resta fermo.

Su CasaDomotica non c'è niente da aggiungere: la kpi in edit è una correzione di parità, non una funzione nuova.

## 11. Rischi

| rischio | come si tiene |
|---|---|
| Un oggetto legge un tag che non ha dichiarato e resta fermo (filtro o memo) | una sola funzione serve al filtro e al memo; guardia `dipendenzeComplete`; `tutti` per i legami sui campi-tag; prova su CasaDomotica |
| Il tubo si stacca dalla pompa | ancore fra le dipendenze; `tuboSegueOggetto` e `motoVivo` verdi; prova a occhio |
| Lo stale si capovolge | si scartano solo le triple identiche; la ⌛ la calcola l'involucro di pagina con la mappa intera, fuori dal memo; il bus non cambia; test nuovo sullo stale |
| Stile o lingua restano fermi col memo | passo 5d, coi suoi test |
| Il memo non salta niente | passo 5b; `ridisegnoMirato` anche in edit |
| rAF fermo (scheda nascosta, jsdom) | timer di riserva e pianificatore iniettabile |
| Ricerca e rinomina cambiano | girano i loro test |
| Una build di un'altra sessione cambia la misura | `WWW=` su una copia di `dist` per ogni passo |
| Il banco è x86 a ×6, non il pannello | collaudo sul WP630 |

## 12. Cosa NON fare
- Non scartare i valori uguali in `TagDb::set` né sul bus.
- Non confrontare solo valore e qualità.
- Non usare `React.memo` senza il confronto sulle dipendenze.
- Non far leggere agli oggetti `getState().tagValues` direttamente: si romperebbero miniature, `rasterizza` e test.
- Non usare il render come orologio della mini tendenza.
- Non ritardare l'`ack` d'errore.
- Non fare `flushSync` della pagina nel fotogramma.
- Non mettere un `<g>` con `transform` fra il gruppo di pagina e `<g data-moto>`.
- Non cambiare il template prima di aver fatto la copia a 10 Hz.
- Non partire col §7 prima di aver misurato il ramo B.

## 13. Fuori ambito, rimandato (dal 10-11-2026 nel seme [i viewer dopo il viewer leggero](semi/2026-11-10-viewer-prestazioni-e-protocollo.md))
- ~~LVGL ha la stessa crescita~~: **entrata nel ramo A (§5-bis)** per decisione del maintainer (09-11). Il commento in `client.rs` cita Q14, ma la domanda Q14 non si tocca.
- Il viewer web ignora `project_changed` (`router.rs:9333-9339`) e chiede l'impronta ogni 3 s (`projectWatcher.ts:107`).
- `ReconnectingWs` smette di ritentare dopo circa 61 s (`reconnectingWs.ts:40`, :100-108) e non avvisa nessuno (`singletonWs.ts:38`).
- `KpiDelta` fa 2 richieste ogni 30 s per riquadro. Basterebbe una sola `getHistoryBuckets` a due secchielli.
- `XyPlotCanvas` ha un intervallo da 200 ms per oggetto, anche a impianto fermo (`XyPlotCanvas.tsx:126-144`).
- Le miniature del `LeftPanel` (:393-399) montano kpi vive, che chiedono storico e statistiche.
- In edit i figli di griglie e faceplate girano con `isEditMode=false` (:6787, :6965). `data_log` in edit mostra un segnaposto (:6178-6182). Sono divergenze dalla regola UI 1.
- Un faceplate dentro una cella di griglia non riceve `faceplates` (:6781-6791).
- Una pagina senza tag manda `subscribe []`, che per il server vuol dire «tutti» (`router.rs:9475`).
- Nell'IDE `TagsTab` (:254) e `AlberoTagLive` (:54) si ridisegnano a ogni messaggio.
- LVGL non manda mai `subscribe` (`client.rs:1630-1760`) e clona tutta la mappa a ogni fotogramma (`main.rs:1913-1929`).
- Un campo «ritmo» nei generatori: è un cambio di prodotto.
- Montagna «realistica»: lo scambio con la rete come produzione meno consumo.
- Lo stale confronta `Date.now()` del pannello col timestamp del server: un orologio sfasato lo falsa.

## 14. Ore

| | ore | sessioni |
|---|---|---|
| Ramo A: passi 0-3 e chiusura | 11 | 3 (passi 0-1; passi 2-3 e banco; chiusura, rc, collaudo) |
| Ramo B: passi 4-5 e chiusura | 12,5 | 4 |
| §7, solo se serve | 10-13 | — |
| §8, passo facoltativo | 3-4 | — |

## 15. Stato (09-11-2026)

- **Ramo A fatto** il 09-11 (`fix/mini-tendenze-leggere`: passi 0-3, §5-bis, correzioni della revisione). Al banco,
  copia a 10 Hz a ×6 per 15 minuti: dal 43 → 99% della base a 33-43% di notte e 49-55% di giorno, 594 punti, risposte
  entro 24 ms, dati vecchi al più di 0,1 s. Voci in `CHANGELOG.md` («Il viewer leggero, ramo A»).
- **Ramo B fatto** il 09-11 (`fix/ridisegno-mirato`, annidato su A: passi 4-5, le correzioni delle due revisioni, e le
  attese del login sul LVGL, che il §5-bis dava solo al web). Stesso banco: 27-34% di notte e 55-60% di giorno, nessuna
  crescita, 493 punti, impronta ≤ 3,1 s, dati vecchi ≤ 0,1 s, risposta mediana ~10 ms (massimo 101 ms in una finestra),
  fascia mai comparsa. Template a 1 Hz, di giorno: 25,4-26,9% (A: 23,5-25,3%); ×1: 1,2-2,6%. Copia a 10 Hz a ×1:
  6,5-8,6% (A: 9-12,6%). Profilo t60-90 s a ×6: script da 10,2 a 4,3 s ogni 30 s, React dal 16,9% al 6,4%, occupato dal
  60,8% al 41,9%. Voci in `CHANGELOG.md` («Il viewer leggero, ramo B»).
- **L'obiettivo del §9 «meno del 25% a ×6 sulla copia a 10 Hz» non è raggiunto.** Il profilo dice perché: il nostro
  JavaScript ora pesa poco, e quello che resta del thread è pittura, layout e compositing del browser (Paint 17%),
  circa 20 fotogrammi al secondo per l'animazione `sws-flow` dei tubi e per i valori a 10 Hz. Per lo stesso motivo il
  template a 1 Hz sta al 25-27% di giorno, sopra il «< 15% indicativo».
- **Decisione del maintainer (09-11-2026)**: si accetta così per la 2.26.0-rc.10. L'animazione dei tubi, e con lei
  tutte le animazioni (flusso, lampeggio, moto lungo un percorso, dissolvenze, barre), si analizzano quando saranno un
  problema vero: la riga è nel seme [i viewer dopo il viewer leggero](semi/2026-11-10-viewer-prestazioni-e-protocollo.md) (era in Appunti.txt, commit
  988fc4fc). In questo ramo l'animazione non si tocca.
- **Rinviati** nello stesso seme: il §7 (un involucro per oggetto; i costi facili del ciclo della radice sono
  già tolti), il protocollo del subscribe («niente finché non chiedi»: il server nasce «tutti» e `[]` vale «tutti»),
  l'animazione. Il §8 (batcher del server) resta facoltativo, da aprire solo se il journal del WP630 dice «lagged».
- Il collaudo è in `docs/COLLAUDI_IN_SOSPESO.md`, «Il viewer leggero (09-11-2026)», voci 1-14. A, B e l'occhio sulle
  password vanno in `main` insieme e nella rc.10 (§4, «rc.10 completa»).
| LVGL, il poller della sparkline | 1-2 | un ramo suo |