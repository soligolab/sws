# Lo stile sobrio dell'IDE — tre colori, scelti dalla persona

> **Stato: FATTO, archiviato il 16-11-2026 prima della rc.20.** Le tre sessioni sono fatte (la 1 nella rc.18, la 2 e
> la 3 il 16-11, con la revisione del ramo). Il collaudo nei due stili è in `docs/COLLAUDI_IN_SOSPESO.md`, «Lo stile
> sobrio, sessioni 2 e 3». Era il seme del 04-11-2026 (`semi/2026-11-04-stile-sobrio.md`), richiesta del
> maintainer: «mi hanno contestato che la grafica di sws è troppo colorata e giocosa (a me piace), valuterei uno stile
> grafico aggiuntivo più sobrio e meno colorato dove il colore serva veramente solo per evidenziare le cose
> importanti». Sessione di plan del 14-11-2026, con una tavola da provare (`sws/tmp/stile-sobrio/tavola.html`, solo
> su theobroma). Le tre cose dello stile VS Code che stavano nel seme sono passate a un seme loro:
> [`semi/2026-11-14-ide-stile-vscode-residui.md`](../plans/semi/2026-11-14-ide-stile-vscode-residui.md).

## Decisioni del maintainer (14-11-2026)

| tema | decisione |
|---|---|
| ambito | **solo l'IDE**. I sinottici restano al seme dello stile di progetto (`semi/2026-10-30-stile-grafico-di-progetto.md`) |
| chi sceglie | **la persona**, in Configurazione → IDE, come chiaro/scuro e la disposizione. Lo stile colorato di oggi resta il predefinito e non cambia |
| colori | **tre, impostabili**, per lo scuro e per il chiaro: **sfondo** (pannelli e bordi sono sue sfumature), **inchiostro** (testi e icone; le scritte secondarie sono lo stesso inchiostro più tenue, almeno 4,5:1), **accento** (solo ciò che è attivo o da fare: voce scelta, selezione, bottone principale) |
| stato | rosso, giallo e verde restano, smorzati, **solo** per allarmi, avvisi, errori ed esiti |
| emoji | nello stile sobrio diventano **icone a linea a due colori**: tratto in inchiostro (accento se attiva), pieni nello sfondo. Nello stile colorato restano le emoji |
| aspetto | quello della tavola, «proviamo così»: predefiniti **grafite `#1c1f24` · grigio caldo `#d6d3cd` · blu acciaio `#5b9bd5`** (scuro) e **`#f4f3f0` · `#2a2d33` · `#2b6cb0`** (chiaro); logo in inchiostro; bottone principale pieno in accento; la voce scelta di una colonna è grigia con un trattino d'accento; titoli dei gruppi, barra di attività e badge senza colori propri |

## Le misure (14-11-2026)

- **Il tema passa da un punto solo**: `applyAppearance(mode)` in `sws-editor/src/theme.ts` scrive tutte le `--brand-*`
  (neutri, stato, primario, `on-*`) e i colori delle barre di attività (`--sws-att-<voce>`, da `COLORI_ATTIVITA` in
  `editor/iconeAttivita.ts`). I componenti usano `var(--brand-…, #fallback)` in circa 2780 punti.
- **Colori scritti a mano fuori dalle variabili**: in 67 file; nell'IDE circa 200 (`EditorShell.tsx` 40,
  `LeftPanel.tsx` 38 con le intestazioni dei gruppi di Strumenti in `coloreGruppo`, le schede di `config/` circa 100,
  `App.tsx` 10). Il resto (`SvgCanvas`, `Trend*`, `AlarmBellPanel`, `ControlPanel`, `RuntimeView`) è il sinottico o il
  runtime: **fuori**.
- **Emoji**: 381 in 88 file, 105 diverse; le più fitte in `config/schede.ts` (42), `LeftPanel.tsx` (34),
  `EditorShell.tsx` (26). Fuori: `catalogoCaratteri.ts`, `testiSistema.ts`, il pannello di controllo, il canvas. I
  segni tipografici `✓ ✗ ✕ ⚠ ⌫ ⏎` restano.
- **Il formato delle icone c'è già**: `iconeAttivita.ts` e `iconeStrumenti.ts`, viewBox 24×24, tratto `currentColor`,
  pieni in una variabile di sfondo.

## Come funziona

- **Preferenza**: `stileIde: "colorato" | "sobrio"` nello store, salvata nel browser come `disposizioneIde`; i colori
  sobri `{scuro: {sfondo, inchiostro, accento}, chiaro: {…}}` accanto. La scheda Configurazione → IDE mostra
  «Colorato / Sobrio» e, col sobrio, i tre selettori della variante attiva, il contrasto e «Ripristina».
- **Il tema dai tre colori**: funzione pura `paletteSobria(colori, variante)` in `theme.ts`, la stessa della tavola:
  - `surface`, `surface2` e `border` sono lo sfondo mescolato verso l'inchiostro al 4,5, 10 e 20 %;
  - `text2` e `textMuted` sono l'inchiostro mescolato verso lo sfondo quanto basta a restare ≥ 7:1 e ≥ 4,5:1 su tutte
    e tre le superfici;
  - il primario è l'accento, e `on-primary` / `primary-testo` si calcolano come oggi;
  - lo stato è smorzato.
  `applyAppearance(mode)` legge lo stile dallo store, sceglie fra i neutri di oggi e `paletteSobria`, e scrive
  `data-stile` su `<html>`. Le finestre staccate seguono anche lo stile (`initThemeStorageListener`).
- **Colori per voce**: nello stile sobrio le barre di attività e i gruppi di Strumenti prendono `textMuted`; la voce
  attiva prende l'accento. Le intestazioni dei gruppi passano da `coloreGruppo` a una variabile `--sws-gruppo-<id>`,
  scritta dal tema come i colori delle barre.
- **Icone**: componente `<Icona nome emoji />`. Nel colorato disegna l'emoji, nel sobrio l'SVG del registro
  `ICONE_IDE`; se l'SVG non c'è ricade sull'emoji. Le icone di `iconeAttivita` si riusano dove il concetto è lo
  stesso.
- **Guardia**: `scripts/check_colori_ide.sh`, dentro `check_static.sh`. Niente colori esadecimali fuori da `var()`
  nei file dell'IDE, con l'elenco dei file esclusi (canvas, runtime, pannello di controllo).

## Sessioni

1. **Motore e preferenze**:
   - `paletteSobria` coi test di contrasto;
   - `stileIde` e i colori nello store;
   - la scheda IDE;
   - barre di attività e gruppi di Strumenti nel sobrio;
   - le finestre staccate.
   Istantanee prima e dopo.
2. **Colori scritti a mano**: i circa 200 dell'IDE vanno nelle variabili, più la guardia `check_colori_ide.sh`.
3. **Icone**: `Icona`, `ICONE_IDE`, poi l'albero di Configurazione, la colonna di sinistra, il menu principale e la
   barra degli strumenti; le emoji rimaste si contano qui.

Ramo `feat/stile-sobrio`, annidato su `feat/control-panel-5` (regola «un ramo alla volta», opzione 2): tocca gli
stessi file e quel ramo aspetta il collaudo.

## Decisioni del 16-11-2026 (per chiudere il piano)

- **Le icone vengono da Tabler Icons** (MIT): si copiano nel repo solo quelle usate, come stringhe SVG nel registro
  `ICONE_IDE`, con la licenza accanto. Stesso formato delle icone dell'IDE (24×24, tratto `currentColor`).
- **Le emoji dentro i file di lingua restano** anche nello stile sobrio: si sostituiscono solo quelle scritte nel codice.
- Sessioni 2 e 3 in un ramo solo, prima della rc.20.

## Stato

- **14-11-2026**: piano scritto dopo la tavola. Sessione 1 avviata.
- **14-11-2026**: sessione 1 in `main` (`00f7d451`, rc.18), collaudata dal maintainer.
- **16-11-2026, sessione 2 fatta** (ramo `feat/stile-sobrio-2-3`): circa 190 colori scritti a mano sono diventati
  `var(--sws-<nome>, #colore-di-sempre)`. Le variabili sono diciannove (`IDE_TOKENS` in `theme.ts`) e il tema le scrive
  solo nello stile sobrio: il colorato legge il ripiego, cioè lo stesso valore di prima. I colori dei gruppi di
  Strumenti stanno in `GROUP_COLORS` (`iconeAttivita.ts`) e arrivano come `--sws-gruppo-<id>`. La guardia
  `check_colori_ide.sh` gira dentro `check_static.sh`: 296 file controllati, 20 esclusioni ciascuna col suo motivo, 37
  righe segnate «fixed-colour» (colori che sono dati del progetto o che devono restare come sono).
- **16-11-2026, sessione 3 fatta** (stesso ramo): `<Icona>` in `components/Icona.tsx` e il registro `ICONE_IDE` in
  `editor/iconeIde.ts`. Le icone sono 87: 69 copiate da Tabler Icons 3.31.0 (licenza in `iconeIde.LICENSE.txt` accanto
  al registro, nota in `third-party/tabler.md`) e 18 riusate da `iconeAttivita.ts`. 79 emoji hanno la loro icona. Nel
  colorato l'emoji resta il testo di prima, senza involucro; nel sobrio l'icona prende il colore delle icone
  (`--sws-icone`), quello del testo sui bottoni pieni, l'accento sulla foglia scelta dell'albero di Configurazione.
  **Emoji scritte nel codice dell'IDE: 161 in 37 file. 157 passano da `<Icona>` e hanno tutte l'icona. Ne restano 4**:
  tre sono il confronto `startsWith("🚀")` sulle righe di log dell'installazione (il codice non le disegna), una è il
  🌐 dentro un `<option>` della barra degli strumenti, che nel sobrio lascia il posto all'icona accanto al menù. Fuori
  ambito e non toccate: 61 (canvas 14, vista runtime 4, campanella e storico allarmi 7, `catalogoCaratteri.ts` 21,
  `testiSistema.ts` 15). Nei file di lingua restano 48 emoji per lingua, per la decisione del 16-11.
- **16-11-2026, la revisione del ramo** (due revisori, otto rilievi, tutti veri, su cinque cose: le quattro qui sotto,
  corrette, e la riga dell'indice dei piani, aggiornata):
  - quattro bottoni nel sobrio avevano il testo sbagliato per il loro fondo, con contrasti fra 1,3 e 2,5: «Unisci
    celle» (inchiostro sopra l'accento), «Abbina» spento, «Cambia password» e «Crea» il primo amministratore mentre la
    richiesta è in corso (testo fatto per l'accento sopra un fondo che non è l'accento). Ora ognuno ha il testo del
    suo fondo, e `tests/soberButtons.test.tsx` disegna i quattro bottoni e misura il contrasto (≥ 4,5 nei due sobri;
    nel colorato gli stessi colori di prima);
  - **le altre finestre seguivano i colori ma non le icone**: l'evento `storage` ridipingeva le variabili e lasciava
    fermo lo store, da cui `<Icona>` sceglie fra emoji e icona. Ora `followAppearanceOfOtherWindows` (nello store,
    chiamata da `avvio.tsx`) aggiorna anche `ideStyle` e `soberColors`; quest'ultimo evita che un cambio fatto nella
    seconda finestra riscriva i colori vecchi;
  - la guardia `check_colori_ide.sh` prendeva per commento un `/*` scritto dentro una stringa (`accept="image/*"`) e
    non vedeva più i colori fino al `*/` successivo. Ora legge il testo sapendo se è dentro una stringa, e a ogni
    avvio **prova sé stessa** su sette casi: se la lettura si rompe la guardia diventa rossa invece di restare verde
    senza vedere niente. Sul codice di oggi il risultato non cambia (296 file, 37 righe segnate);
  - i due nomi nuovi in italiano sono diventati `GROUP_COLORS` e `groupVar`.
- **16-11-2026, all'unione con G5**: la scheda «Spesa» della configurazione IA (💶) non aveva l'icona, e il test del
  registro lo ha visto. Aggiunta `euro` (Tabler `currency-euro`): le icone sono 88, 70 da Tabler.
- **Resta**: il collaudo del maintainer (`/test-changes`) nello stile sobrio e nel colorato; poi il piano si archivia.
  Da guardare nel collaudo: nel sobrio scuro il testo d'accento sopra il fondo di selezione (`--sws-select-text` su
  `--sws-select-bg`) fa 4,2:1 coi colori predefiniti, sopra la soglia di 3 che il test chiede e sotto il 4,5 del testo
  normale.
