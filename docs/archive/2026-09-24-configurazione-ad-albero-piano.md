# Configurazione ad albero, e ConfigView diviso in file — piano

> Sessione di plan approfondita del 24-09-2026 sui due semi gemelli
> [configurazione ad albero](2026-09-22-configurazione-ad-albero.md) e
> [riorganizzare i file dell'editor](../plans/2026-09-22-riorganizzare-i-file-dell-editor.md), decisi insieme
> come chiedono entrambi. **Stato (24-09-2026 sera): passi 0-3 implementati su quattro rami annidati,
> da collaudare a schermo col maintainer prima dello squash.** Vedi «Avanzamento» in fondo.
>
> Del secondo seme questo piano copre **solo `ConfigView.tsx`**. `EditorShell`, `SvgCanvas`, lo store e
> i quattordici colori nelle righe di elenco restano materiale di quel seme, che resta vivo.

## Decisioni del maintainer (24-09-2026)

| domanda | scelta |
|---|---|
| dove vive l'albero | **sempre visibile**, in editor e in Configurazione |
| che forma | **una vista nuova ⚙ «Configurazione»** nel pannello sinistro, che sale a livello di App; non un explorer unico che rifà il pannello |
| profondità | **anche il secondo livello, subito**: una foglia per sorgente, script Python, faceplate, ricetta, datastore, utente. Variabili e Allarmi restano senza foglie (possono essere centinaia) |
| la vista «Sorgenti» di oggi | **si toglie**: la sostituisce il ramo Sorgenti dell'albero |
| ordine | **prima i file**: registro unico, poi `ConfigView` diviso per scheda, poi l'albero |

## Misurato oggi (24-09-2026, `main` a `1a9e427e`)

- `sws-editor/src`: 54 164 righe in 147 file. `config/ConfigView.tsx` **11 914** righe (era 11 629 il 22).
- La Configurazione è una **modalità a sé** (`App.tsx:877`, `<Tenuta attiva={effectiveMode === "config"}>`,
  `type Mode = "edit" | "config"`): in Configurazione il pannello sinistro **non c'è**, perché `LeftPanel`
  vive dentro `EditorShell` (montato due volte: `EditorShell.tsx:615` nel ramo della funzione aperta,
  `:673` nel ramo normale) e `EditorShell` si smonta. La barra delle schede è orizzontale, in cima a
  `ConfigView`.
- `LeftPanel` riceve da `EditorShell` due callback: `onAddObject` (che usa stato locale di `EditorShell`:
  `pendingImagePos`, `symbolPickPos`) e `onFunctionsChanged`. Salire a livello di App vuol dire
  staccarle.
- **Gli elenchi paralleli delle schede sono quattro, non tre**:
  1. `AppConfigTab` — `store/index.ts:241`;
  2. `ConfigTab` — `ConfigView.tsx:11433` (copia letterale);
  3. `visibleTabs` admin / non-admin — `ConfigView.tsx:11464`, più tre `useEffect` che rimbalzano i
     non-admin e la condizione `projectLoading` che elenca a mano le schede «indipendenti»;
  4. `VALID_TABS` — `App.tsx:353`, per il deep link `#config/<tab>`: **sette su sedici**, quindi
     `#config/faceplates` apre la Configurazione sulla scheda precedente. Difetto piccolo, e la prova che
     un elenco in più resta indietro senza che nessuno se ne accorga.
- **Sedici schede**: nove di progetto tenute montate da `Tenuta` (Salva unico via `pendingSections`),
  sette di istanza/dispositivo montate a richiesta. «Tipi» è una sottovista di «Variabili»
  (`ConfigView.tsx:743`).
- Righe per sezione dentro `ConfigView.tsx`: Runtime 1 725 · Variabili 801 + modale 108 · sorgenti (dieci
  card e sei modali, righe 1187-4612) ~3 400 · Protocolli 269 · Allarmi 488 · Stato 365 + audit 90 + TLS
  165 · Preferenze IDE 380 · Utenti 339 · Risorse 229 · Datastore 459 · Python 314 · Faceplate 223 +
  anteprima 61 · Ricette 195 · Notifiche 434 · Device 551 · Lingue 641 · Backup 370 · stili condivisi 143.
- Il secondo livello, scheda per scheda:
  - **Python, Faceplate, Ricette** hanno già elenco + `selected` interni: la foglia imposta la selezione;
  - **Protocolli** disegna una card per sorgente, tutte aperte in colonna, senza selezione;
  - **Datastore, Utenti** sono tabelle senza selezione.
- Mattoni esistenti: `BarraIcone`, `IntestazioneSezione`, `useSezioneAperta`, `PREFISSO_MEMORIA`
  (`editor/stilePannelli.tsx`). L'albero delle pagine (`LeftPanel.tsx:129`, `riconcilia`) è specifico
  delle pagine (trascinamento, rinomina, orfane) e non si generalizza gratis: l'albero di configurazione
  è più semplice (rami fissi, foglie in sola lettura) e usa i mattoni, non `PagesSection`.
- Collegamenti in ingresso: `navigateToConfig("protocols")` dalla vista Sorgenti (`LeftPanel.tsx:1807`,
  `:1834`, che sparisce), `navigateToConfig("runtime")` da `App.tsx:763`.

## Passi

Un ramo per passo, chiuso (definition of done + conferma + squash + ramo eliminato) prima del successivo.

### Passo 0 — un registro solo · `feat/config-albero-0-registro`

`config/schede.ts`, dichiarativo, senza JSX pesante:

```ts
{ id, chiave /* config.tabs.<id> */, icona, ramo, soloAdmin, portaBozza /* → Tenuta */,
  richiedeProgetto /* → projectLoading */, elementi? /* passo 3 */ }
```

Da lì derivano: il tipo `AppConfigTab` (unico, importato da `ConfigView`), le schede visibili, un solo
rimbalzo per i non-admin, `projectLoading`, `VALID_TABS` (che si ripara: ora vale per tutte e sedici).
`types` resta accettato come alias di `tags` per i vecchi `localStorage`, finché il passo 2 non lo fa
diventare una foglia vera.
Nessun cambio visibile tranne il deep link riparato.

### Passo 1 — ConfigView diviso in file · `feat/config-albero-1-file`

**Spostamento puro, un commit per gruppo**, `git mv` dove si può (`log --follow` deve seguire):

- `config/comuni.tsx`: stili `S`, `SaveBar`, `Section`, `SezionePendente`, `Tenuta`, `MASKED` e gli
  altri helper condivisi (righe 133-386);
- `config/sorgenti/`: le dieci card e i sei modali (righe 1187-4612), un file per card o modale;
- `config/schede/<Scheda>.tsx`: una per scheda — Variabili (+ `QuickCreateTagModal`), Protocolli,
  Allarmi, Stato (+ audit, TLS), PreferenzeIde, Utenti, Risorse, Datastore, Python, Faceplate
  (+ anteprima), Ricette, Notifiche, Runtime, Device, Lingue, Backup. `TipiTab.tsx` ci va dentro;
- `ConfigView.tsx` resta il guscio (<300 righe).

Nessuna modifica di comportamento nello stesso commit. Da ridichiarare per percorso: i tetti di
`check_i18n_ui.sh` e ogni guardia che cerca per nome di file (`check_colori.sh`,
`check_tipi_scalari.sh`, `check_segreti.sh`: da verificare con `grep -l ConfigView scripts/`).
Chiude con `pnpm build`, `check_static.sh` e un giro a schermo sulle sedici schede.

### Passo 2 — l'albero, primo livello · `feat/config-albero-2-vista`

1. **`LeftPanel` sale in `App.tsx`**, accanto a `<main>`, visibile in `edit` e in `config`.
   `EditorShell` smette di montarlo (entrambi i rami). Le due callback diventano azioni dello store
   (`richiediAggiuntaOggetto(type)`, osservata da `EditorShell`, che tiene il suo stato locale per
   immagine e simbolo; `onFunctionsChanged` → l'azione che la funzione già chiama).
2. **Vista ⚙ «Configurazione»** in `VISTE`. Rami (da `schede.ts`), chiusi o aperti con
   `useSezioneAperta` (`sws.pannelli.config.<ramo>`):
   - **Progetto** — Variabili, Tipi, Protocolli, Allarmi, Python, Faceplate, Ricette, Notifiche, Lingue
   - **Dati** — Datastore
   - **Sicurezza** — Utenti
   - **Istanza** — Stato, Risorse, Backup, Device, Runtime
   - **IDE** — Preferenze

   Una foglia → `navigateToConfig(id)`: l'area centrale passa alla Configurazione su quella scheda,
   foglia evidenziata. Un clic su una pagina dell'albero delle pagine in Configurazione → torna
   all'editor su quella pagina.
3. **In Configurazione** la barra di icone mostra solo ⚙ (le altre viste — oggetti, struttura, tag,
   funzioni — agiscono sul canvas, che lì non c'è); entrando in Configurazione la vista passa a ⚙, uscendo
   torna a quella di prima. L'albero delle pagine resta in cima.
4. **Via la barra orizzontale** di `ConfigView`: la sceglie l'albero. Il pulsante Configurazione nella
   testata resta (apre sull'ultima scheda).
5. **«Tipi» diventa foglia sua**: il selettore interno di Variabili sparisce, ma la bozza, la barra Salva
   e il CSV restano condivisi (stesso meccanismo `SezionePendente` di oggi).
6. **Via la vista «Sorgenti»** (`SourcesSection`, e la sua chiave in `VISTE`/i18n).

### Passo 3 — secondo livello · `feat/config-albero-3-foglie`

- Store: `configFocus: string | null` accanto a `configTab`; `navigateToConfig(tab, focus?)`;
  deep link `#config/<tab>/<id>`.
- Foglie per **Sorgenti, Python, Faceplate, Ricette, Datastore, Utenti** (Utenti, Datastore solo admin,
  come le schede).
- **Le foglie vengono dalla bozza, non dal salvato**: una sorgente aggiunta e non ancora salvata deve
  comparire, e una cancellata sparire. Le sei schede pubblicano `[id, etichetta, sporca]` del loro elenco
  in un registro dello store (stessa forma di `pendingSections`); finché una scheda non è mai stata
  montata, l'albero legge `project`. Una foglia con modifiche non salvate porta il pallino.
- Cosa fa la scheda col focus:
  - Python, Faceplate, Ricette: la foglia imposta la selezione; l'elenco interno resta (serve per
    aggiungere e cancellare) — da rivedere a schermo se diventa un doppione;
  - Protocolli: **col focus mostra solo quella card**; clic sul ramo = tutte le card come oggi;
  - Datastore, Utenti: col focus la riga scelta si apre e le altre si nascondono; clic sul ramo = tabella
    intera.
- Aggiungere, cancellare, rinominare restano dentro le schede (i pulsanti di oggi); l'albero li segue
  perché legge la bozza. Una rinomina che cambia l'id sposta il focus sul nuovo id.

## Rischi da tenere d'occhio

- **Salire `LeftPanel` a livello di App** tocca l'ordine di montaggio: `LeftPanel` oggi fa
  `api.getProject()` al montaggio, e montandolo una volta sola non si ripete più a ogni rientro
  nell'editor. Da verificare che nessuno ci contasse.
- **`Tenuta` e le bozze**: il passo 2 non monta né smonta schede in modo diverso da oggi (l'albero
  sostituisce solo la barra); il passo 3 aggiunge il focus **dentro** schede già montate. Nessuna bozza
  deve perdersi passando fra foglie: è il controllo a schermo principale.
- `pannelloProprieta.test.tsx` e i test esistenti non toccano `ConfigView`; il passo 1 si verifica con
  build, guardie e giro a schermo.

## Verifica, per ogni passo

`cargo check`, `pnpm build`, `./scripts/check_static.sh` verdi; poi a schermo con
`./scripts/start_editor_develop.sh`: sedici schede raggiungibili (da admin e da non-admin), deep link
`#config/<tab>` (e `#config/<tab>/<id>` al passo 3), una modifica in due schede diverse e un Salva unico
che le prende entrambe, Tipi e Variabili con lo stesso Salva, rientro nell'editor senza perdere la
bozza.

## Avanzamento (24-09-2026, sera)

Quattro rami annidati, uno per passo, ognuno figlio del precedente (regola «Un ramo alla volta»,
opzione 2): `feat/config-albero-0-registro` → `-1-file` → `-2-vista` → `-3-foglie`. Nessuno mergiato:
il collaudo a schermo è del maintainer. Su ciascuno `pnpm build`, i test (815) e le 26 guardie statiche
sono verdi, e una prova Playwright su uno stack di scarto (porte 8673/8674, spento a fine prova) ha
percorso tutte le schede.

Differenze dal disegno sopra, decise durante l'esecuzione:

- **Passo 0** — il rimbalzo dei non-admin ora copre anche Runtime, che prima disegnava un pannello vuoto.
- **Passo 1** — i file hanno il nome del componente (`schede/TagsTab.tsx`, non `Variabili.tsx`): si
  ritrovano cercando il nome che compare nel codice. Resta un ciclo di import innocuo
  `DevicesTab ↔ RuntimeConnectionTab` (nessun nome letto al caricamento). Dei guardiani, solo
  `check_tipi_scalari.sh` cercava `ConfigView.tsx` per nome: ora guarda tutta `config/`.
- **Passo 2** — le due callback di `EditorShell` passano da `editor/azioniEditor.ts`. Senza `canEdit`
  l'albero delle pagine non c'è (porterebbe a un editor vietato), senza `canConfigure` non c'è ⚙.
  L'icona della foglia Preferenze IDE è 🎛, per non confondersi con ⚙ della vista.
- **Passo 3** — il **pallino per l'elemento con modifiche non salvate non c'è**: le schede sanno
  «qualcosa è cambiato», non «quale elemento» (tranne Faceplate). Se serve, è un lavoro a parte.
  Nelle schede con elenco interno (Python, Faceplate, Ricette) l'elenco resta, e la foglia e l'elenco
  si tengono allineati nei due sensi: da rivedere a schermo se sembra un doppione.

Da guardare col maintainer: la resa delle icone emoji sul suo sistema (in Chromium headless alcune
erano più alte del testo, corretto fissando l'altezza), e se i rami devono partire chiusi.
