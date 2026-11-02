# Unità e struttura delle variabili dal catalogo: dove si vedono e chi le eredita

## Contesto

Il maintainer, preparando il collaudo dell'inverter (02-11-2026), ha aggiunto il dispositivo ZCS dal catalogo e ha
aperto la variabile `inverter` in Tag: il campo «Unit» era vuoto. Le unità ci sono, ma stanno nei **membri del tipo**
(`zcs_azzurro_hy…`, un membro per registro, `unit`/`decimals` da `daCatalogo.ts:134`). Ne sono uscite tre richieste:

1. **In Tag la variabile strutturata si deve poter espandere** e vedere da cosa è composta. Oggi la tabella mostra
   solo la radice, e il suo dettaglio offre i campi di una variabile semplice (Unit, Decimals, Range, Scaling,
   Limits) che su una struttura non fanno niente.
2. **«Dove vedo ora le strutture dati?»** Nella disposizione Stile VS Code la voce Tag della barra ha
   `schede: ["tags", "types"]` (`LeftPanel.tsx:2304`), ma la colonna (`case "tag"`, `LeftPanel.tsx:2401`) mostra solo
   l'albero live e il bottone «Tabella»: la foglia **Tipi non si raggiunge**. È un difetto dello stile VS Code.
3. **Gli oggetti che usano il tag devono ricevere l'unità come preconfigurazione, poi modificabile.** Misurato:
   - web: `applyTagDefaults` (`SvgCanvas.tsx:543`) applica già unità, decimali, range e limiti, **anche dalle foglie**
     (usa `descrizioniDeiTag`, `tag/forma.ts:148`);
   - LVGL: `applica_predefiniti_tag` (`sws-web/src/synoptic.rs:897`) cerca il tag per id esatto fra `p.tags`, quindi
     **una foglia come `inverter.grid_power` non riceve niente** sul pannello;
   - pannello proprietà: `textInput("unit", "")` e `numInput` non mostrano il valore ereditato. Il campo vuoto sembra
     «nessuna unità» mentre a schermo l'unità c'è: la preconfigurazione esiste ma non si vede.

## Modifiche (un ramo, `feat/unita-dal-tag`)

### 1. Tag: la struttura si espande
- `config/schede/TagsTab.tsx`: una riga con `type_ref` (o `array`) ha un ▸ che mostra sotto le **foglie**, da
  `foglieDiTolleranti(tag, types)` (`tag/forma.ts:120`, la stessa che usa `AlberoTagLive`): percorso, tipo, unità,
  decimali, range, valore live. **Sola lettura**: si modificano nel tipo (regola «una sezione per dato»).
- Il dettaglio (⚙) di una variabile strutturata non mostra più i campi di una variabile semplice; al loro posto una
  riga: «Unità, decimali, scala e limiti stanno nei membri del tipo `X`» con il bottone **Apri il tipo** (vista Tipi
  di questa scheda, sul tipo giusto).

### 2. Tipi raggiungibili dalla barra
- `editor/LeftPanel.tsx`, `case "tag"`: sotto l'albero live le foglie della voce (`foglie(voce)`, come fanno le altre
  voci), cioè **Variabili** (la tabella) e **Tipi**. Il bottone «✎ Tabella» resta solo se diventasse un doppione:
  si toglie, la foglia Variabili fa la stessa cosa.

### 3. La preconfigurazione dal tag, vista e uguale sui due motori
- **Pannello proprietà** (`editor/EditorShell.tsx`): un aiuto `ereditatoDalTag(obj, campo)` su
  `descrizioniDeiTag(tags, types).get(obj.tag)` — gli stessi campi di `applyTagDefaults` (unit, decimals, min/max da
  range, soglie da limiti). `textInput` e `numInput` lo usano quando il campo è vuoto: si vede il valore ereditato,
  in grigio corsivo, col titolo «dal tag `inverter.grid_power` — scrivi per cambiarlo». Un punto solo, per tutti i
  tipi di oggetto.
- **LVGL**: `applica_predefiniti_tag` prende anche i `types` e risolve le foglie con `Forma::da_tag` + `foglie`
  (`sws-core/src/percorso.rs:271`), usando il `Membro` della foglia (unit, decimals, range_lo/hi, limit_*). Chiamata
  in `router.rs:7292` con `&p.types`. Copre anche la voce di `Appunti.txt` sulla parità LVGL di unità e decimali delle
  foglie, che si toglie.

## File toccati
`config/schede/TagsTab.tsx`, `editor/LeftPanel.tsx`, `editor/EditorShell.tsx`, `tag/forma.ts` (eventuale aiuto),
i18n it/en, `sws-web/src/synoptic.rs`, `sws-web/src/router.rs`; manuale `docs/manual/` (variabili strutturate e
predefiniti dal tag), CHANGELOG, NOVITA, `Appunti.txt`.

## Verifica
- Rust: `applica_predefiniti_tag` dà a un oggetto su `inverter.grid_power` l'unità del membro; un valore scritto
  sull'oggetto vince; un tag semplice come prima.
- vitest: la riga strutturata in Tag si espande e mostra le foglie con l'unità; il dettaglio della struttura porta al
  tipo; nella colonna Tag dello stile VS Code c'è la foglia Tipi; il campo Unit di un oggetto legato a una foglia mostra
  l'unità ereditata come segnaposto e scriverci la sostituisce.
- DoD completa (cargo check/test, pnpm build, vitest, check_static), IDE 8460 ricompilato, immagine amd64 sul VPS.
- Il maintainer, su CasaDomotica (inverter): espande `inverter` in Tag, apre il tipo dalla colonna Tag, lega un valore
  a `inverter.grid_power` e vede «W» precompilato; sul pannello LVGL lo stesso valore ha l'unità.
