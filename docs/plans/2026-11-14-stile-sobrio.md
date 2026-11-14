# Lo stile sobrio dell'IDE — tre colori, scelti dalla persona

> **Stato: piano — in corso.** Era il seme del 04-11-2026 (`semi/2026-11-04-stile-sobrio.md`), richiesta del
> maintainer: «mi hanno contestato che la grafica di sws è troppo colorata e giocosa (a me piace), valuterei uno stile
> grafico aggiuntivo più sobrio e meno colorato dove il colore serva veramente solo per evidenziare le cose
> importanti». Sessione di plan del 14-11-2026, con una tavola da provare (`sws/tmp/stile-sobrio/tavola.html`, solo
> su theobroma). Le tre cose dello stile VS Code che stavano nel seme sono passate a un seme loro:
> [`semi/2026-11-14-ide-stile-vscode-residui.md`](semi/2026-11-14-ide-stile-vscode-residui.md).

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

## Stato

- **14-11-2026**: piano scritto dopo la tavola. Sessione 1 avviata.
