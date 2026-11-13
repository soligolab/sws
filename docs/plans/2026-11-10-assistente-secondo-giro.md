# L'assistente, secondo giro: la planimetria, l'SVG libero, un secondo protocollo

> **Stato: piano — pronto, da prendere dopo il collaudo del primo giro.** Nato il 10-11-2026 chiudendo il piano
> [l'assistente disegna i simboli e compone il sinottico](../archive/2026-11-03-assistente-genera-simboli-e-sinottici.md)
> (F0–F4 fatte nella 2.25.0, F5 misurata a mano il 04-11): quello che restava era lavoro vero, non punti brevi, e il
> maintainer ha scelto di chiudere il primo piano e raccogliere il resto qui («ok» alla proposta del 10-11-2026).
> Il disegno di dettaglio di F6 e F7 sta ancora nel piano archiviato, sezioni «Il disegno» e «Le fasi»: si parte da lì.

## Da dove riparte

- **F5, banco dei tubi d'acciaio**: misurato a mano il 04-11-2026 con due conversazioni vere (resoconti in
  `tmp/ai-misure/2026-11-04-*.json`, solo su theobroma): `kimi-k3` 15 minuti, 1,01 $, 9 simboli nuovi, 37 oggetti;
  `kimi-k3.1-pro` 19 minuti, ≈2 $, 7 simboli nuovi + 3 di libreria, 56 oggetti. Non ci sono il progetto di prova fisso
  (`tests/fixtures/ai-bench/tubi-acciaio/`), il copione finto né il test e2e, e manca il giudizio del maintainer da 1 a 5.
- **Revisione delle prime bozze (03-11-2026)**: libreria da arricchire (seme
  [libreria più ricca](semi/2026-11-03-libreria-simboli-piu-ricca.md)), modello predefinito `claude-opus-5-5`, revisione
  dei simboli decisa dalla persona.

## Le fasi

**G1 — Il banco fisso dei tubi (era F5).** Il progetto vuoto a 1280×800 con cornice; il copione dell'agente finto e il
test e2e; il test `#[ignore]` col modello vero che scrive il resoconto in `sws/tmp/ai-misure/`. Poi il **giudizio del
maintainer** sulle due pagine del 04-11 e su una nuova con `claude-opus-5-5`: è quello che decide quanto lavoro di
prompt serve prima di promettere il «prompt semplice».

**G1, fatto il 12-11-2026 notte** (ramo `feat/assistente-g1`, annidato su `fix/aggiornamento-timeout-avvio`):
banco `tests/fixtures/ai-bench/tubi-acciaio/`, copione `sinottico-tubi.json` (scritto a mano: le tracce del 04-11 stanno
solo su theobroma), test Rust `ai/banco_tubi.rs`, e2e `chat-tubi.spec.ts`, `scripts/banco_tubi.sh [--vero]`.
**Scostamento**: la prova col modello vero non è un `#[ignore]` ma `banco_tubi.sh --vero`, perché dal 10-11 la foto di
un progetto web la fa il browser dell'IDE. Due prove con `kimi-k3` (unica chiave su `ufficio`):
- 22:39, **1,43 $, 15 min**, 20 giri, 8 bozze, 4 istantanee: proposta validata ma rimandata (bozze nello stesso turno),
  e il test non ha mai risposto «procedi» perché la riga dello strumento restava «scrivo» — difetto della chat,
  corretto;
- 23:25, **0,95 $, 10 min**, 18 giri, 5 bozze, 2 istantanee, 0 correzioni, un «procedi»: 25 oggetti, 5 simboli
  `prj:`, 6 di libreria, 2 tubi, il tipo `macchina_linea` e un faceplate «Macchina di linea» per ogni macchina.
  Materiale in `sws/tmp/banco-tubi/2026-11-12-232548-vero/` (progetto salvato, `pagina.png`, `misure/`).

**Resta di G1**: il **giudizio del maintainer** da 1 a 5 su questa pagina e su quelle del 04-11, e una prova con
`claude-opus-5-5` quando c'è la chiave (`SWS_AI_CHIAVI=<cartella> ./scripts/banco_tubi.sh --vero`).

**G2 — Planimetria e banco della casa (era F6).** L'assistente scrive una `Planimetria` nel modello che esiste
(`sws-editor/src/planimetrie/modello.ts`, `planimetrie/<id>.yaml`, in metri); `pianta_svg` in Rust (muri, porte con
l'arco, finestre, aree, niente testo) come sfondo della pagina; lo strumento `pianta` dà stanze e finestre in pixel di
pagina; una **tapparella `prj:` con parte `level`** generata; il progetto di prova con una quindicina di variabili in
stile Home Assistant. Misurato il 10-11-2026: lo strumento `pianta` e `pianta_svg` non esistono.

**G3 — SVG libero con le bocche (era F7, richiesta dal maintainer il 03-11-2026).** `bozza_simbolo` accetta un SVG con
`view_box` e `ports` → `custom:` con bocche; i due campi facoltativi nuovi su `CustomSymbol` (`sws-core/src/project.rs`),
letti da `bocchePer`, `ancora_di` e dal validatore; validazione con `svg_ostile`, i vietati di `genera.py`, i limiti di
dimensione e la tavola LVGL. Misurato il 10-11-2026: `CustomSymbol` non ha `view_box` né `ports`.

**G4 — Un secondo protocollo per il testo.** Oggi `enum Fornitore` (`ai/client.rs`) ha `Anthropic` e `Kimi`, che parlano
la stessa API Messages. Un secondo ciclo SSE, un secondo formato dei blocchi e una seconda resa degli strumenti, in
stile OpenAI «chat completions»: apre **OpenAI** e soprattutto un **fornitore europeo** (Mistral, o modelli aperti da
Scaleway/OVH) — vedi il seme [fornitore IA europeo](semi/2026-11-10-fornitore-ia-europeo.md), che con questa fase si
assorbe. Da misurare sui banchi G1 e G2 prima di proporlo.

**G5 — Immagini e spesa.** Altri fornitori di immagini (FLUX.2 Pro, Imagen 4) accanto a `gpt-image-2`
(`ai/immagini.rs`); una **storia della spesa** per scopo e per mese nell'installazione (`config_dir`, accanto a
`ai.yaml`: chiavi e tetti stanno lì), oggi assente — c'è solo il tetto per conversazione e per scopo. Il prezzo di
`kimi-k3.1-pro` in `prezzi()` (`ai/client.rs`, oggi stimato «≈» ai prezzi di Opus 5) quando si conosce il listino.

## Da decidere all'inizio

- L'ordine: la proposta è G1 → G2 → G3 → G4 → G5, perché il giudizio di G1 dice quanto vale il resto.
- G4: Mistral o un modello aperto europeo per primo.
- G5: il listino di `kimi-k3.1-pro` lo cerca la sessione o il maintainer.

## Fuori da questo piano (dal piano archiviato, «In Appunti, a fine lavoro»)

Una libreria aziendale nel cloud (`prj:` condivisi fra progetti); un faceplate generato per tipo; le sorgenti dal
catalogo dispositivi; un'impaginazione automatica con tubi che girano intorno agli ostacoli; un editor a mano delle
descrizioni; `clear_tool_uses` lato server se le misure lo chiedono. Se uno diventa una domanda, nasce un seme.

MCP resta di sola lettura (14 strumenti il 10-11-2026): riaprire solo con un bisogno vero, la motivazione è nel piano
archiviato, «Nota a parte».

## Collaudo

Le voci del primo giro stanno in `docs/COLLAUDI_IN_SOSPESO.md`, «L'assistente: faceplate e sfondi». Per questo piano:
G1 il giudizio sulle pagine; G2 una pagina della casa accettata e vista nel viewer web e su LVGL; G3 un simbolo SVG
libero agganciato a un tubo; G4 una conversazione con il fornitore nuovo sul banco dei tubi; G5 la spesa del mese in
console. Prima di chiudere, la funzione va in CasaDomotica (regola del progetto di riferimento).
