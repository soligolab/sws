# Seme — uno stile grafico di progetto per tutti gli oggetti

**Seme, non piano d'esecuzione.** Nato il 30-10-2026 dalla revisione dello slider
([piano](2026-10-30-revisione-slider.md)). **Quando si comincia questo lavoro, il primo passo è una sessione di
plan approfondita per sviscerarne tutti i dettagli.**

## L'idea

Lo slider avrà quattro stili per oggetto (`slider_style`: classico, pillola, piastra, ISA-101). Un integratore che
vuole «tutto ISA-101», o «tutto domotica», oggi dovrebbe sceglierlo oggetto per oggetto, e per ogni tipo con un
campo diverso. Serve uno **stile di progetto** che dia il default a tutti i tipi, sovrascrivibile per oggetto.

## Cosa c'è oggi (30-10-2026)

- Il precedente è `project.symbol_style` (`sws-editor/src/symbols/stileProgetto.ts`,
  `sws-runtime/crates/sws-core/src/stile_simboli.rs`): volume da 0 (piatto, ISA-101) a 100, valido per i simboli.
- Sui sinottici **non ci sono temi**: il tema chiaro/scuro dell'app veste solo l'IDE. Il colore del testo segue la
  luminanza dello sfondo della pagina (Q18).
- I default stanno in `tests/fixtures/colori-predefiniti.json` e `predefiniti-campi.json`, letti dai due motori.

## Le domande da sciogliere

- Uno stile di progetto è un **insieme di default** per tipo (tabelle come quelle di oggi, una per stile) o un campo
  che ogni tipo interpreta a modo suo?
- Come convive con `symbol_style`: lo assorbe o resta accanto?
- Cosa vuol dire «ISA-101» per i tipi che non hanno stili (gauge, bottone, progress_bar)?
