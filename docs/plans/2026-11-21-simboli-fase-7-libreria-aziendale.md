# Editor dei simboli, fase 7 — la libreria aziendale — piano

> Sessione di plan del 21-11-2026 (sera), gruppo 2, secondo ramo dopo la [fase 3](2026-11-21-simboli-fase-3-foto.md).
> Piano madre: [editor dei simboli](2026-11-18-editor-dei-simboli.md), che rimandava «a inizio fase 7» le domande sul
> cloud (chi vede cosa, azienda).

Ramo: **`feat/symbol-library`**.

## Decisioni del maintainer (21-11-2026)
1. **La libreria è dell'azienda.** Nel cloud chi si iscrive da solo ha già un'azienda personale; nell'IDE locale c'è
   l'azienda implicita. Un modello solo per tutti i casi.
2. **Tutti i membri scrivono** (Sviluppatori e Amministratori), come per i progetti dell'azienda.
3. **I simboli usati si copiano nel progetto** (il pannello non dipende dalla libreria). Se in libreria c'è una versione
   più nuova, l'IDE lo dice e la si prende con un clic; oggetti e tag restano collegati.
4. **La libreria tiene anche le varianti** dei simboli di SWS: lo stile aziendale di pompe e valvole si porta in ogni
   progetto.

## Cosa c'era il 21-11-2026
- Aziende sempre presenti (`sws-identita/src/lib.rs`, tabella `aziende`, colonna `cartella`; vuota per l'implicita),
  membri in `membri`. Progetti in `<radice>/<cartella azienda>/<progetto>`.
- Il container di un progetto vede solo la cartella del progetto (decisione 25 del 05-10): non vede l'azienda.
- Cartella per radice già usata: `<radice>/.ambiente/` (`dispositivi.yaml`, `sws-web/src/dispositivi.rs`), nascosta
  dall'elenco progetti dal punto iniziale.
- Galleria: `RamoSimboli` in `sws-editor/src/editor/LeftPanel.tsx`; copia nel progetto oggi = `writeSymbols` in
  `symbols/editor/open.ts` (riscrive la lista `project.simboli`).

## Cosa si fa
- **Dove**: `<radice progetti>/<cartella azienda>/.ambiente/symbols/<slug>/` con `symbol.json` (la stessa busta del file
  `.swsym`) e le immagini. Nell'IDE locale `<radice>/.ambiente/symbols/`.
- **Rotte servite dal gateway** (o dall'IDE locale), mai inoltrate al container: `GET /api/library/:company/symbols`,
  `GET|PUT|DELETE /api/library/:company/symbols/:slug`, con il controllo di appartenenza di `mie-aziende`; nell'IDE
  locale `:company` è `-`. Ogni voce porta `version` (impronta del contenuto), `updated_by`, `updated_ms`.
- **Copia nel progetto**: la descrizione copiata porta `library: { slug, version }` (campo nuovo, facoltativo, inglese);
  le foto vanno in `images/` (nome già preso → suffisso). Una variante copiata diventa la variante del progetto; se il
  progetto ne ha già una per lo stesso simbolo di SWS, si chiede quale tenere.
- **IDE**:
  - famiglia «Libreria aziendale» in `RamoSimboli`: trascinare un simbolo in pagina lo copia nel progetto;
  - «Salva in libreria» nell'editor dei simboli (nuovo o aggiornamento della voce da cui il simbolo era venuto);
  - all'apertura del progetto, confronto delle versioni → avviso «in libreria c'è una versione più nuova di N simboli»
    con «Aggiorna». Stesso slug e stessi ingressi: oggetti e tag restano collegati; se cambiano gli attacchi dei tubi,
    l'avviso che c'è già.
- **Seme del backup per azienda** (`semi/2026-11-10-backup-per-azienda.md`): una riga, la libreria è un bene
  dell'azienda da mettere nel backup.

## Verifica
`cargo test` (rotte con appartenenza: un membro sì, un estraneo 403; impronta stabile; copia con foto e suffisso),
`pnpm exec vitest run` (avviso di aggiornamento, copia di una variante), `pnpm build`, `./scripts/check_static.sh`;
`/test-changes` nell'IDE locale e nel cloud (due utenti della stessa azienda). Un esempio in CasaDomotica: un simbolo
preso dalla libreria.

## Com'è andata (22-11-2026, notte)
Fatto sul ramo `feat/symbol-library` (annidato su `feat/symbol-photo`), da collaudare. Due scostamenti:
- **un clic, non un trascinamento**: nella galleria gli elementi si usano con un clic (come i simboli di SWS); il clic
  copia nel progetto e mette l'oggetto in pagina. Una variante si copia e basta: sostituisce il simbolo di SWS ovunque;
- **la galleria non mostra l'anteprima** degli elementi della libreria, solo il nome (◆ simbolo, ◇ variante): per
  disegnarli servirebbe compilarli e scaricarne le foto prima di usarli. Da rivedere al collaudo.
La riga nel seme del backup per azienda è scritta.
