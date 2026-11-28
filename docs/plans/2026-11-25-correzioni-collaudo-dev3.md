# Le correzioni del collaudo della 2.27.0-dev.3 sul PLX800 (25-11-2026)

## Contesto

Il collaudo del 25-11-2026 sul PLX800 (sezione in [`COLLAUDI_IN_SOSPESO.md`](../COLLAUDI_IN_SOSPESO.md)) ha lasciato tre
anomalie da correggere subito e tre cose da guardare. La prima pesa su chi sta davanti allo schermo: la pagina del
monitor resta ferma, con i comandi che non partono. Per la regola di `CLAUDE.md` passa davanti.

Il Save nella testata ha un piano suo ([2026-11-25-save-nella-testata.md](2026-11-25-save-nella-testata.md)) e si fa
dopo, su un ramo suo.

## Le decisioni del maintainer (25-11-2026)

| | Domanda | Decisione |
|---|---|---|
| 1 | La pagina ferma dopo «Elimina solo il progetto» | **Tutte e due le correzioni**: dopo «Elimina» il pannello di controllo si chiude e la pagina si ricarica appena il runtime risponde; e i socket di tag e allarmi del viewer non si arrendono più. |
| 2 | I faceplate stirati da «Cambia risoluzione» | **Conversione uniforme + scelta**: la conversione scala il contenuto col fattore della pagina; la casella «Scala al riquadro» diventa una scelta (no / stirando / mantenendo le proporzioni); web e LVGL fanno la stessa cosa. |

## Ramo

`fix/dev3-collaudo` da `main`, un ramo solo per le parti A, B e C. Poi una dev (2.27.0-dev.4) e il collaudo sul PLX800.

## A. La pagina del monitor ferma dopo «Elimina solo il progetto»

**Visto.** Dopo «Eliminare solo il progetto, restando nel cloud» e un deploy, la pagina del monitor del PLX800 restava
ferma: valori fermi, comandi che non partivano, fascia «Dati in ritardo» che contava. Un riavvio del browser la
sbloccava. Il socket anonimo aperto da fuori riceveva i dati con 30 ms di ritardo.

**Causa, dal codice.**
1. Il socket dei tag del viewer (`socketCondiviso` in `ws/singletonWs.ts`) è un `ReconnectingWs` senza
   `persistent`. Dopo 6 collegamenti falliti di fila, circa 1 minuto, **si arrende** (`reconnectingWs.ts:40`, `:113`).
2. Dopo il reset il runtime riparte senza progetto né utenti. Per circa 2 minuti, fino al deploy, rifiuta i
   collegamenti (`abbinamento.rs`: «in attesa: non entra nessuno»). Il socket si arrende.
3. Il sorvegliante del progetto (`viewer/RuntimeViewer.tsx`, `useProjectWatcher`) riapre i socket solo quando il
   runtime torna dopo un fermo (`onRitorno` → `riprovaFlussoTag`). Qui il runtime non è mai stato irraggiungibile:
   rispondeva, ma rifiutava. Al deploy il sorvegliante ricarica le pagine e chiede `whoami`; il token del kiosk resta
   lo stesso, quindi `useTagStream` non riparte e il socket resta arreso.

**Correzione.**
1. **Il pannello di controllo, dopo «Elimina»** (`control-panel/ControlPanel.tsx`, `doReset`): mostra il messaggio
   di oggi, aspetta che il runtime risponda di nuovo (`/health`, ogni 2 s, come `RIPROVA_RIAVVIO_MS` del viewer) e
   ricarica la pagina (`window.location.reload()`). Il pannello si chiude con la ricarica. Vale per tutti e due i reset
   («solo il progetto» e «tutto»).
2. **I socket del viewer non si arrendono**: il socket dei tag e quello degli allarmi del viewer nascono con
   `{ persistent: true }`, come il registro del pannello (`ws/remoteLogStream.ts:113`). Dopo i 6 tentativi riprovano
   ogni 30 s, in silenzio. Le chiusure definitive (4404, 4495) li fermano ancora. L'IDE resta com'è.
3. **Ogni cambio di progetto riapre i socket giù**: nel sorvegliante, dopo `loadProjectData`, `riprovaFlussoTag()` e
   `riprovaFlussoAllarmi()`. `riprovaSubito` non tocca un socket aperto o in apertura.

**Test.** vitest: un `ReconnectingWs` persistente che fallisce 10 volte riprova ancora; il sorvegliante che vede un
progetto nuovo chiama `riprovaFlussoTag`; il pannello di controllo dopo un reset riuscito ricarica quando `/health`
risponde (con `fetch` e `location.reload` finti).

## B. «Cambia risoluzione» stira il contenuto dei faceplate

**Visto.** Sul PLX800, dopo la conversione da 1280×800 a 1920×1080, i testi dei faceplate `punto` erano schiacciati o
allargati: `in0` 135×48,6 su una definizione 144×36 (0,94 × 1,35), `fresh` 221×48,6 (1,54 × 1,35).

**Causa.**
- `scalaOggetto` (`sws-editor/src/scala/scalaPagina.ts:113-116`, dal 24-11) mette `faceplate_scale: true` su ogni
  faceplate scalato.
- Con `faceplate_scale` il web scala il contenuto sul riquadro, asse per asse (`SvgCanvas.tsx:7149`,
  `scale(w/dw, h/dh)`): il testo si deforma.
- Il pannello LVGL scala posizioni e misure per asse, ma i caratteri col fattore minore (`lvgl_render.rs:17387-17412`,
  `scala_figlio`). Quindi i due motori già differiscono.
- I riquadri dei faceplate nel template non hanno le proporzioni della definizione: prima del 24-11 non contava,
  perché il contenuto si disegnava alla sua misura.

**Correzione.**
1. **Un campo nuovo, `faceplate_zoom`** (numero, assente = 1): il contenuto si disegna alla misura della definizione
   per quel fattore, ancorato in alto a sinistra come oggi. «Cambia risoluzione» moltiplica `faceplate_zoom` per il
   fattore della pagina e **non** mette più `faceplate_scale`. Se l'istanza ha già `faceplate_scale`, la conversione
   non tocca lo zoom: il riquadro scala in modo uniforme e il contenuto lo segue.
2. **`faceplate_scale` diventa una scelta**: assente (no), `"stretch"` (stirando), `"fit"` (mantenendo le
   proporzioni: il fattore minore dei due, centrato nel riquadro). `true` resta letto come `"stretch"`, perché i
   progetti salvati lo hanno.
3. **Stirando, sui due motori allo stesso modo**: posizioni e misure dei figli per asse, i caratteri col fattore
   minore. È quello che fa già `scala_figlio` su LVGL; il web passa dalla trasformazione SVG a figli ricalcolati, con
   una funzione gemella in TypeScript.
4. **Pannello proprietà** (`EditorShell.tsx:6005-6009`): la casella diventa un menu a tre voci. Lo zoom non ha un
   campo suo nel pannello (regola UI 2: un dato, una sezione): lo scrive la conversione.
5. **Formato**: `faceplate_scale` e `faceplate_zoom` in `types/index.ts`, `sws-web/src/synoptic.rs`,
   `sws-lvgl-viewer/src/model.rs`, `synoptic_schema.rs` (schema dell'IA) e il validatore. Nomi nuovi in inglese; lo
   zoom entra nel glossario del seme «codice in inglese» prima del commit.

**Test.** vitest: la conversione di un faceplate con riquadro diverso dalla definizione dà `faceplate_zoom = f` e
nessun `faceplate_scale`; la funzione gemella di `scala_figlio` per stretch e fit. cargo test: `scala_del_faceplate`
con `true`, `"stretch"`, `"fit"` e lo zoom. `check_lvgl_parity` e i gemelli `demo-items-*` (un faceplate per modo).
Istantanee web e LVGL a confronto in `tmp/`.

**Compatibilità (regola di CasaDomotica e dei progetti):** due progetti sono nati dalla conversione del 24-25-11 con
`faceplate_scale: true` messo dalla conversione: la copia verticale di CasaDomotica «CasaDomotica (TC620_Verticale)»
e `PLX800_Verticale`. Si propone al maintainer la correzione (togliere `faceplate_scale`, mettere lo zoom del fattore
usato), con la copia di sicurezza prima. Senza il suo sì non si tocca niente.

## C. La rinomina nel cloud del progetto aperto

**Visto.** Rinominato `PLX800` in `PLX800_Verticale` dall'IDE del cloud: errore rosso, poi il progetto vuoto. La
rinomina era riuscita.

**Causa.** `handleRename` (`sws-editor/src/components/MainMenu.tsx:166-197`) rilegge il progetto con `api.getProject()`
dallo stesso indirizzo `/p/<azienda>/<nome vecchio>/`, che per il gateway non esiste più.

**Correzione.** Come fa già «Salva come» nello stesso file (righe 150-155): nel cloud (`prefissoGateway()`), dopo la
rinomina si va al nuovo indirizzo con `window.location.assign(`/p/${azienda}/${nuovo}/`)`, tenendo l'ancora della
scheda. Fuori dal cloud non cambia niente. Da misurare prima: che il gateway, dopo la rinomina, non lasci acceso il
container col nome vecchio.

**Test.** vitest: con un `pathname` del gateway la rinomina chiama `location.assign` col nuovo nome e non `getProject`.

## D. Da guardare, senza una correzione decisa

Si misura nello stesso ramo. Una correzione piccola e ovvia entra; il resto va in un seme.
1. **Il log «in attesa di abbinamento» dopo il reset che tiene il cloud** (`sws-runtime/src/main.rs:1518-1535`): il
   ramo col codice viene prima di quello del tunnel, quindi un pannello abbinato dice di essere in attesa. Da misurare
   se in quello stato il codice permette un abbinamento dalla rete locale; il messaggio va corretto in ogni caso.
2. **Tre conferme di fila in un deploy** (utenti, cancellazione, rotazione), la prima con un altro stile.
3. **Due login falliti dal cloud** dopo un deploy che sostituisce gli utenti, poi il 429.

## Stato (25-11-2026)

- **A, B e C fatte** sul ramo `fix/dev3-collaudo` (`e43f96e2`, `fa672528`, `65a8fbb4`).
- **D**: il log all'avvio è corretto (il messaggio del cloud prima, niente codice stampato). Il resto è in due semi:
  [il codice di abbinamento col cloud senza utenti](semi/2026-11-25-codice-di-abbinamento-col-cloud-senza-utenti.md) e
  [le conferme del deploy e il login dopo gli utenti](semi/2026-11-25-deploy-conferme-e-login-dopo-gli-utenti.md).
- **Revisione a più agenti** (25-11-2026, 66 agenti, verifica avversaria a tre voti): 19 rilievi confermati su 20,
  13 distinti dopo i doppioni. Corretti nel ramo: la ricarica dopo il reset annullata dal 401 della sessione; lo
  stiramento che lasciava fermi `x2`/`y2`, `points` e `motion_path`; su LVGL linee e polilinee del faceplate non
  spostate dall'istanza (preesistente); lo zoom detto nel menu; la misura 120×80 di LVGL senza riquadro; il log col
  tunnel configurato davvero; la voce di NOVITA col nome esatto del comando; la rinomina nel cloud con modifiche non
  salvate; il nome codificato in «Salva come» e nella schermata iniziale; `/health` col prefisso dello schermo remoto.
  Restano annotati: `faceplate_scale` senza un controllo dei valori; il test della parte C che prova la funzione e non
  il menu; fit e zoom su LVGL che non scalano tratti e raggi (preesistente). Il pannello di controllo dallo schermo
  remoto è un seme: [pannello di controllo dallo schermo remoto](semi/2026-11-25-pannello-di-controllo-dallo-schermo-remoto.md).
- **Verifica fatta**: vitest 3057/3057, cargo test 2252/0, `pnpm build`, lint, type-check, fmt, clippy come la CI,
  `check_static.sh` 58/58. Da fare: la revisione a più agenti, la dev.4, il collaudo sul PLX800.
- **Compatibilità da proporre al maintainer**: la copia verticale di CasaDomotica e `PLX800_Verticale` hanno il
  `faceplate_scale: true` della conversione del 24-25-11. Con la correzione il testo non si deforma più, ma il
  contenuto segue ancora il riquadro per asse; la correzione dei due progetti (zoom al posto della scala) aspetta il
  suo sì. **Fatto il 25-11-2026** per la copia verticale di CasaDomotica (30 faceplate a `fit`, col sì del maintainer);
  `PLX800_Verticale` non aveva `faceplate_scale`.

## Verifica

1. `cargo check`, `cargo test`, `pnpm build`, `pnpm exec vitest run`, `./scripts/check_static.sh`, più fmt, clippy e
   lint della CI.
2. Una dev (2.27.0-dev.4) e `/test-changes` sul PLX800: «Elimina solo il progetto» col monitor acceso, poi un deploy
   (la pagina riparte da sola); un fermo del runtime oltre il minuto (i valori tornano senza ricaricare); «Cambia
   risoluzione» su `PLX800_Verticale` (i testi dei faceplate non si deformano, web e LVGL); la rinomina nel cloud.
3. `CHANGELOG.md` e `NOVITA.yaml` (it/en) per le tre correzioni.
