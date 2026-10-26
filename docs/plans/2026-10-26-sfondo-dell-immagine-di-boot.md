# Immagine di sfondo sulla pagina di boot, e PNG di boot che nel cloud perde le immagini

> **Stato: piano d'esecuzione — da fare.** Rimandato dal maintainer il 26-10-2026: si apre
> quando i rami aperti (freccia → ruolo → tubo → ricerca globale) sono chiusi, mergiati ed
> eliminati. Le righe citate sono quelle di `main` a quella data: rimisurarle prima di partire.

## Contesto

Il maintainer, nel cloud, ha messo sulla pagina di boot un'immagine caricata nel progetto. Il
canvas la mostra. Il PNG no: «1 immagine con indirizzo esterno non incorporabile è stata tolta
dal PNG». Vuole poter caricare un PNG come sfondo, come per le pagine normali.

Sono due cose diverse.

**1. Un difetto.** Dal 25-10-2026 (`c921ebd0`), nel cloud, `ImmagineSvg` scarica le immagini del
progetto e disegna `<image href="blob:…">` (`sws-editor/src/canvas/ImmagineSvg.tsx:58-76`).
Il rasterizzatore del boot clona quell'SVG. La sua `immagineComeDataUri` accetta solo href che
iniziano con `/api/` (`sws-editor/src/boot/rasterizza.ts:154-155`). Un `blob:` non passa, e
`neutralizzaNonStatico` lo toglie come «esterno» (`rasterizza.ts:80-86`).
Risultato: **nel cloud nessuna immagine del progetto arriva nel PNG di boot.** In locale sì.

Due varianti dello stesso difetto:
- se il `blob:` non è pronto entro i 60 ms di attesa (`rasterizza.ts:202`), `ImmagineSvg` non
  disegna niente: l'immagine manca **senza avviso**;
- le immagini del catalogo (`/images/mdi/…`, quelle che offre il «⋯» dell'oggetto immagine) non
  iniziano con `/api/`: mancano dal PNG **anche in locale**.

**2. Una funzione che manca.** Le pagine hanno `sfondo_immagine` (25-10-2026) con il campo
`CampoSfondoArea`: carica, scegli fra le caricate, ✕. Sul boot il campo è nascosto
(`EditorShell.tsx:2248-2250`, `!boot && !cornice`). E il rasterizzatore non lo disegnerebbe:
monta `SvgCanvas` senza la prop `sfondoArea` (`rasterizza.ts:191-200`).

Il canvas dell'editor invece lo disegna già: `corniceDellaPagina` dà `null` per il boot, quindi
`oggettoSfondoArea(pagina, undefined)` copre tutta la pagina (`EditorShell.tsx:646-652`,
`cornici/modello.ts:55-65`). Il campo Rust esiste (`synoptic.rs:31`): il YAML di `boot/` lo
conserva. Il runtime non va toccato: il PNG nasce nel browser.

## Modifiche

### A. Il PNG incorpora ogni immagine che il browser ha potuto disegnare — `rasterizza.ts`

`immagineComeDataUri(href)`:
- `/api/…` → come oggi (base URL + token);
- `blob:…` e percorsi della stessa origine (`/images/…`) → `fetch(href)` semplice: è lo stesso
  URL che il browser ha già usato per disegnarla;
- `http(s)://` di un altro sito → `null`, come oggi (scelta voluta, commento a riga 151).

Il pezzo blob → data URI (`FileReader`) diventa una funzione locale per tutti i rami.

Prima di montare il canvas, nel cloud (`serveScaricare`), si scaricano con `scaricaImmagine`
tutti gli href `/api/…` della pagina (oggetti + `sfondo_immagine`) e si aspetta. Così
`useHrefImmagine` parte già col `blob:` pronto e l'immagine non sparisce per tempo.

### B. Il campo «Immagine di sfondo» sulla pagina di boot — `EditorShell.tsx`, `CampoSfondoArea.tsx`

- `{!boot && !cornice && <CampoSfondoArea…/>}` → `{!cornice && …}`.
- `CampoSfondoArea` prende una prop `boot`: etichetta e suggerimento di oggi parlano di «area
  attiva», cornice e LVGL, che sul boot non valgono. Due chiavi nuove it/en:
  `props.sfondoBoot` («Immagine di sfondo» / «Background image») e `props.sfondoBootHint`
  («Copre tutta l'immagine di boot, sotto gli oggetti, e finisce nel PNG.»).

### C. Il PNG disegna lo sfondo come l'editor — `rasterizza.ts`

In `svgDellaPagina`, a `SvgCanvas` si passa `sfondoArea: oggettoSfondoArea(page, undefined)`.
Stesso oggetto e stesso disegno dell'editor (`xMidYMid slice`, cioè «copri»). Ordine: colore
di sfondo (`fillRect`), poi immagine, poi oggetti.

### D. Test

- `tests/rasterizzaBoot.test.ts`: `immagineComeDataUri` esportata e provata con `fetch` finto —
  `blob:` senza `Authorization`, `/api/` con base URL e token, `/images/…` letto, `https://`
  di un altro sito → `null`. Un caso per lo sfondo: la pagina con `sfondo_immagine` dà a
  `SvgCanvas` la prop `sfondoArea`.
- `tests/pannelloProprieta.test.tsx`, caso «pagina di boot»: il campo sfondo ora c'è.

### E. Documenti e CasaDomotica

- `NOVITA.yaml` it + en: «Immagine di sfondo anche sulla pagina di boot»; «Il PNG di boot ora
  contiene le immagini del progetto anche nel cloud».
- `CHANGELOG.md` `[Unreleased]`; `docs/HOWTO.md` §17, punto 1: lo sfondo si carica nel pannello
  a destra.
- CasaDomotica: la sua pagina di boot riceve un'immagine di sfondo (regola del 16-10).

## Verifica

1. `cargo check`, `pnpm build`, `./scripts/check_static.sh`, `cargo test`,
   `pnpm exec vitest run`.
2. IDE 8460 ricompilato: pagina di boot → «Immagine di sfondo» → carica un PNG → il canvas lo
   mostra a tutta pagina → Ctrl+S → l'anteprima PNG lo contiene, senza avvisi. Si aggiunge
   un'immagine del catalogo: anche quella nel PNG. «Scarica PNG» in `sws/tmp/`, confronto a occhio.
3. Il caso cloud in locale non si riproduce (`prefissoGateway` vuoto): lo coprono i test di A.
   La prova vera la fa il maintainer su `sws.soligo.net` dopo la prossima immagine.

## Trovato per strada (fuori da questo piano)

Sul pannello **LVGL** lo sfondo delle pagine normali probabilmente non si vede, e al suo posto
c'è un rettangolo pieno. Il server compone `sfondo_immagine` come un `rect` con `fill: "none"`
e `bg_image` (`cornici.rs:127-163`). `render_rect` di LVGL non legge `bg_image`, e
`parse_hex_color("none")` dà `None`, quindi il colore ripiega sul predefinito del rettangolo
(`lvgl_render.rs:2868`, `colore_campo`). Visto solo nel codice, non sul dispositivo. Il
suggerimento del campo dice «sul pannello LVGL si vedono solo immagini SVG», ma neanche quelle
si disegnano su un `rect`. Va verificato sul pannello e corretto a parte (almeno: `none` =
trasparente).
