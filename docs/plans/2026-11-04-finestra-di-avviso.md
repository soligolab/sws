# La «Finestra di avviso» al posto dei pop-up del browser — piano d'esecuzione

> **Stato: piano d'esecuzione, sessioni F1–F3 della [serie coordinata](README.md#-la-serie-coordinata-del-04-11-2026--lordine-delle-sessioni).**
> Nato come seme il 04-11-2026 da una richiesta del maintainer: «ora per i pop-up usi quelli nativi del browser e sembrano
> errori, la gente diffida dei pop-up del browser. Implementerei una funzione "Finestra di avviso" che apra un'area in
> centro alla pagina, in cui presentare tutto quello che ora viene mostrato come pop-up. La stessa funzione sarà usata
> anche per spostare alcune configurazioni» (l'[impostazione iniziale del progetto](2026-11-04-impostazione-iniziale-del-progetto.md)).
> Diventato piano lo stesso giorno, con la misura del codice (`tmp/piani-misure/finestra-avviso.md`, solo su theobroma)
> e le decisioni qui sotto.

## Decisioni del maintainer (04-11-2026)

- **Tutti i pop-up nativi si sostituiscono**, nella stessa serie, con una guardia che impedisce di rimetterne. Il
  maintainer aveva scelto «due sessioni»; la misura (106 chiamate, e nel viewer un contratto che cambia) ne chiede
  **tre**: F1, F2, F3.
- La finestra serve anche come **modulo**: la usa l'impostazione iniziale del progetto (I1) e la logica (L1, L3).

## La misura (04-11-2026)

| | |
|---|---|
| Chiamate | **106** in **41 file**: 74 `confirm`, 21 `alert`, 11 `prompt` |
| Per categoria | azione pericolosa **51**, conferma **23**, informazione **21**, richiesta di testo **11** |
| Per forma del codice | **67** già in una funzione `async` (basta `await`); **25** in un gestore sincrono che diventa `async`; **5** dove cambia la firma per chi chiama; **9** «spara e dimentica» |
| Dove | IDE 37 file; console 4 file (7 chiamate); viewer operatore `canvas/SvgCanvas.tsx` (11, fra cui **una password in un `prompt` in chiaro**, :3722); chat e log 0 |
| Le 5 con la firma che cambia | `SvgCanvas.tsx:3686` `guardedWrites(): boolean` (17 chiamanti; il booleano lo usa lo slider, `SliderSvg.tsx:79`); `boot/AggiornamentoRuntime.tsx:35` `conferma(): boolean` (un chiamante già `async`) |
| Finestre fatte a mano | `QuickCreateTagModal`, `ReAuthModal`, `RinominaTagModal`, `scala/DialogoRisoluzione`, `accesso/ChiudiAccount`, `runtime-view/AvvisoAggiornamento` (tre finestre); in più le modifiche non salvate (`App.tsx:1146-1180`, tre bottoni) e il pull (`RuntimeConnectionTab.tsx:944-951`). Ognuna col suo velo, il suo z-index (da 50 a 10000), i suoi tasti; **nessuna trappola del focus** in tutto l'IDE |
| Test che dipendono dai pop-up | 8 file vitest con `vi.spyOn(window, "confirm"|"prompt")`; e2e `import-tags.spec.ts:46` |
| Guardia di oggi | `check_i18n_ui.sh` §2 vede solo i pop-up col testo letterale: le 106 passano tutte. ESLint senza `no-alert` |
| Difetti già oggi | `props.targetRiskyConfirm` mostra `\n` letterali e dice che LVGL non disegna PNG/JPG (falso dalla 2.25.0); manca `common.ok`; la catena di conferme dopo un 428 del deploy è scritta tre volte (`store/index.ts:910-935`, `DevicesTab.tsx:88-104`, `RuntimeConnectionTab.tsx:357-385`) |

## Il disegno

Funzioni di modulo, non hook (le usa anche `store/index.ts`), in `src/finestra/`; un host montato **una volta** in
`avvia()` (`avvio.tsx`), che copre IDE, viewer, console, chat e log.

```ts
avviso({ titolo?, testo, livello?: "info" | "errore", ok? }): Promise<void>
conferma({ titolo?, testo, pericolo?: boolean, si?, no? }): Promise<boolean>
chiedi({ titolo?, testo, iniziale?, password?: boolean, valida?: (v) => string | null, ok? }): Promise<string | null>
scegli<K>({ titolo?, testo, scelte: { valore: K; etichetta; pericolo? }[] }): Promise<K | null>
modulo<T>({ titolo, corpo: (fine: (v: T | null) => void) => ReactNode, chiudibile? }): Promise<T | null>
```

- Esc annulla; Invio preme il bottone predefinito; il focus va sul predefinito e torna a chi aveva aperto; trappola del
  Tab; `keydown` in cattura con `stopPropagation`, così le scorciatoie dell'editor (`EditorShell.tsx:797-800`) e gli Esc
  delle altre finestre non partono.
- z-index sopra 10000 nell'IDE e sopra 9600 nel viewer (il login di `AvvisoAggiornamento.tsx:169`).
- Testo in `pre-wrap`; colori dai token `--brand-*` di `ui/base.ts`; etichette sovrascrivibili (nel viewer i testi di
  sistema nella lingua dei contenuti, `testoSistema`).
- La coda regge un host montato due volte (React StrictMode in sviluppo, `avvio.tsx:29`).
- Un aiuto per vitest (`rispondi(…)`) al posto di `vi.spyOn(window, "confirm")`.
- **La guardia**: uno script `check_finestra_avviso.sh` in `STATICHE` (o una sezione di `check_i18n_ui.sh`) con un
  tetto per file che può solo scendere; a fine F3 il tetto è zero e l'elenco sparisce.

## Le sessioni

**F1 — `feat/finestra-avviso`: il componente e la configurazione (≈40 chiamate).**
- Componente, host, le cinque funzioni, l'aiuto per i test, la guardia coi tetti.
- `BackupsTab` (6) come prova completa; poi le schede di configurazione e boot già `async` (34): SystemTab 3, UsersTab 1,
  RitenzioneAutomatica 1, InstallTab 1, ContainerTab 1, CertificatiTab 1, MqttSezioni 1, RuntimeCtrl 1, WelcomeScreen 2,
  GitStoria 2, OpenplcSulPannello 2, StatoBootImage 1, ConfigurazioneServizio 1, ConfermaAggiornamento 1, MainMenu 5,
  LanguagesTab 10.
- I cinque testi col titolo in maiuscolo sulla prima riga si dividono in titolo e testo; `common.ok`.
- Test: `certificatiTab`, `logicaPlc` (×2), `openplcSulPannello`, e2e `import-tags`.
- Prova del maintainer: ripristinare ed eliminare un backup, Salva come e Rinomina, un'azione di Sistema; Esc, Invio,
  Tab; la finestra sta sopra le altre.

**F2 — `feat/finestra-avviso-2`: deploy ed editor (≈48 chiamate).** — *fatta il 05-11-2026: la catena del 428 in `store/conferme428.ts`, `deployServeAdmin.ts` assorbito.*
- Deploy (17): **una funzione sola** per la catena di conferme dopo il 428, usata dai tre percorsi; `deployServeAdmin`,
  `App.tsx:933` e `:998`, `AggiornamentoRuntime` (la firma che cambia), `FinestraAggiornamento`.
- Editor (31): LeftPanel 10, EditorShell 5 (con il testo di `targetRiskyConfirm` corretto), CampoTestoTradotto 2 (con
  `scegli`: oggi Esc vuol dire «cambia dappertutto»), ProprietaFaceplate, ProprietaCornice, CampoSfondoArea,
  PlanimetriaEditor, AlarmsTab, GitTab 3, MqttSourceCard, BannerProvaGit, DatastoresTab 4 (il selettore di file dopo una
  conferma asincrona va provato in Chrome e Firefox).
- Test: `campoTestoTradotto`, `cardSorgenti`, `planimetrieEditor`.
- Prima: un pannello raggiungibile per provare il deploy (l'indirizzo lo dà il maintainer).

**F3 — `feat/finestra-avviso-3`: viewer, console, finestre fatte a mano (≈18 chiamate + 8 finestre).** — *fatta il 05-11-2026: le finestre fatte a mano sulla `Cornice` (in `FinestraAvviso.tsx`), la guardia a zero e `no-alert`. Decisioni 1, 3, 4, 5 come proposte; la 2 (password anche su LVGL) in `Appunti.txt`. Il piano si archivia al merge, dopo il collaudo.*
- Viewer (11): `guardedWrites` diventa `Promise<boolean>` coi 17 chiamanti e il contratto `scrivi` dello slider; la
  password con `chiedi({ password: true })` (o `ReAuthModal`); i motivi obbligatori con `valida`.
- Console (7).
- Le sei finestre fatte a mano, le modifiche non salvate e il pull sulla stessa cornice (se il maintainer non decide
  diversamente, vedi sotto).
- La guardia a zero; il piano si archivia.
- Prova sul pannello (WP630 o TC620, kiosk WebKit): un comando con conferma, uno critico con la password, un motivo
  obbligatorio, gli allarmi.
- **Immagine** (il viewer cambia sul pannello).

## Da decidere all'inizio di ogni sessione

La proposta vale se il maintainer non dice altro.

**F1**
1. Ordine dei bottoni: «Annulla» a sinistra, l'azione a destra (come LVGL, `lvgl_render.rs:967-968`). *Proposta: sì.*
2. Su un'azione pericolosa, Invio cosa fa? *Proposta: niente finché il focus non è sull'azione; il predefinito è Annulla.*
3. Clic sul velo: *proposta: chiude solo `avviso` e `conferma` non pericolose; mai un `modulo` o un'azione pericolosa.*
4. La guardia: *proposta: uno script a sé in `STATICHE`, più `no-alert` in ESLint.*
5. Il nome: `avviso` è già una costante CSS (`ui/base.ts:74`). *Proposta: le funzioni restano `avviso`/`conferma`/…, la
   costante si rinomina.*

**F2**
1. La funzione unica delle conferme dopo il 428: *proposta: in `store/`, chiamata dai tre percorsi.*
2. La scelta a due vie dei testi tradotti: con Esc *non succede niente* (proposta), invece di «cambia dappertutto».
3. Il caricamento del database: la conferma *prima* di scegliere il file, come oggi (proposta).

**F3**
1. Pulsante momentaneo con `require_confirm`: *proposta: come LVGL, senza conferma* (una finestra fra pressione e
   rilascio rende il comando impossibile da tenere premuto).
2. Un comando `critical` senza `require_confirm`: il web chiede la password, LVGL la conferma (`lvgl_render.rs:4142`).
   *Proposta: tutti e due la password.*
3. Il toggle calcola il valore al clic (`SvgCanvas.tsx:3753`): *proposta: lo ricalcola alla conferma.*
4. Le finestre fatte a mano sulla cornice comune: *proposta: sì, tutte e otto.*
5. La lingua dei bottoni nel viewer: *proposta: la lingua dei contenuti (`testoSistema`), come gli altri testi del pannello.*

## Rischi

- Chiamate diventate asincrone: una scrittura che parte prima della risposta, un `onClick` che restituisce una Promise
  ignorata. Coperti dai vitest citati; nessuna regola `no-floating-promises`.
- e2e: Playwright chiudeva da solo i pop-up nativi; una finestra in pagina resta aperta e può bloccare un flusso.
- Viewer sul kiosk: tocco, z-index, lingua. Si prova a mano su un pannello.
- Manuale: T10:52-61, T11:75, T02:88 e alcuni passi di 04, 05, 11 descrivono i pop-up (se ne occupa M5).
