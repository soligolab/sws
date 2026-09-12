# Collaudo dal vivo: "gli occhi" della chat AI nella finestra staccata

## Contesto

Ciclo `/riprendi` del 2026-09-12. Il piano vivo `2026-08-31-chat-ai-nelleditor.md` e il suo
indice in `docs/plans/README.md` segnalavano come residuo "i passi 3-6 e la chat staccata" —
ma quella nota si è rivelata datata. Il grosso della Fase D del piano T-50 (prompt di sistema,
prova col modello vero) è stato ampiamente esercitato ben oltre T-50: `CHANGELOG.md` documenta
bug reali trovati e corretti "alla prima prova col modello vero" (funzioni cancellate, script
spariti, schema che mentiva per omissione).

Il residuo **vero**, confermato in `STATUS.md` (sezione T-51/fase 3, ramo già su `main` a
`5af3be4`), è più stretto:

> «Da provare con un modello vero: che l'assistente chiami lo strumento [`istantanea_pagina`]
> e usi l'immagine. Il percorso HTTP e il blocco immagine sono scritti ma nessun modello li ha
> ancora esercitati — è la stessa cosa che manca alla chat staccata.»

Cioè: lo strumento che dà "gli occhi" all'assistente (foto di come LVGL disegna una pagina, via
`sws-lvgl-viewer --istantanea` orchestrato da `istantanea.rs`) non è mai stato provato con un
modello reale **nella finestra di chat staccata** (`index-chat.html` / `ChatWindow.tsx`). Il
maintainer ha scelto di fare questo collaudo dal vivo in questa sessione, non di scrivere nuovo
codice.

## Cosa è già pronto (verificato, non da rifare)

- **Chiave IA già configurata su questa macchina**: `~/.config/sws/kimi.key` +
  `.run-editor/config/ai.yaml` (`fornitore: kimi`). Nessuna chiave da creare.
- **`sws-lvgl-viewer` già compilato**: `sws-runtime/target/debug/sws-lvgl-viewer` esiste nella
  stessa directory del binario `sws-runtime` — è il requisito che `istantanea.rs:207-217`
  controlla per non rifiutare la chiamata.
- **Progetto demo con target LVGL**: `examples/templates/demo-items-lvgl/project.yaml`.
- **Un'istanza editor è già in ascolto su :8460.** Su questa macchina ("ufficio") l'editor si
  avvia sempre così, **senza** `--instance N` (istruzione del maintainer 2026-09-12): non
  esistono istanze numerate qui. Quella attiva è quindi un'istanza di test — si può fermare, ma
  va chiesta conferma prima di farlo o di riavviarla.

## Passi del collaudo

1. Chiedere conferma al maintainer se l'istanza già attiva su :8460 va fermata e riavviata, o se
   la avvia lui stesso quando è pronto. Non fermarla né avviarne una nuova senza quel sì.
2. Con `./scripts/start_editor.sh` (nessun `--instance`, porta 8460, dati `.run-editor/`),
   aprire/duplicare il progetto `demo-items-lvgl` (ha `target.kind: lvgl_framebuffer`, è quello
   per cui `istantanea_pagina` produce un'immagine sensata).
3. Nell'IDE: Menu ☰ → Assistente IA → staccare la chat nella sua finestra (`index-chat.html`,
   gesto già cablato in `App.tsx` — `staccaChat`). È il percorso mai esercitato con un modello
   vero.
4. Nella finestra staccata, mandare una richiesta che *obbliga* l'uso di `istantanea_pagina`:
   per esempio chiedere di guardare come una pagina del progetto appare sul pannello LVGL e
   segnalare problemi di disegno. Se conviene una prova più mirata, usare una pagina/oggetto con
   una divergenza web/LVGL già nota e documentata (es. Q28, scala del `bar_chart` diversa fra i
   due motori) per vedere se l'assistente la nota guardando l'immagine.
5. Verificare nel pannello delle chiamate-strumento (visibili in diretta) che
   `istantanea_pagina` viene davvero invocato — non solo `leggi_pagina`/`schema_oggetto` — e che
   la risposta dell'assistente cita dettagli visivi concreti (posizione, sovrapposizione,
   colore) e non genericità: è il segno che l'immagine è stata guardata sul serio.
6. Annotare l'esito onestamente, qualunque sia:
   - **Se funziona**: chiudere il residuo "T-51/fase 3" in `STATUS.md` e correggere la nota
     obsoleta in `docs/plans/README.md` (riga del piano `2026-08-31-chat-ai-nelleditor.md`).
   - **Se emergono difetti** (nello strumento, nel prompt, nel bridge della finestra staccata):
     trattarli come qualunque bug trovato "alla prima prova col modello vero" — corretti se
     piccoli e dentro questo scope, altrimenti segnati in `docs/OPEN_QUESTIONS.md` se sono
     scelte architetturali, mai decisi in autonomia.
7. A fine collaudo, chiedere di nuovo conferma prima di fermare l'istanza su :8460 (o lasciarla
   com'era se il maintainer preferisce gestirla lui).
8. A collaudo concluso, chiedere al maintainer se il piano `2026-08-31-chat-ai-nelleditor.md` è
   da archiviare (i residui restanti — Fase 4, server MCP autonomo — sono esplicitamente fuori
   scope per ora) o se resta vivo per altro.

## File coinvolti

- `sws-editor/src/App.tsx` (`staccaChat`), `sws-editor/src/components/ChatWindow.tsx`,
  `sws-editor/src/components/ChatPanel.tsx` — solo lettura/osservazione, salvo bug da correggere.
- `sws-runtime/crates/sws-web/src/istantanea.rs`,
  `sws-runtime/crates/sws-web/src/ai/{mod,tools,client,prompt}.rs` — stesso trattamento.
- `STATUS.md`, `docs/plans/README.md`, eventualmente `docs/OPEN_QUESTIONS.md` e `CHANGELOG.md`
  a fine collaudo.

## Verifica / definizione di fatto

- Nessuna riga di codice nuova prevista: se il collaudo passa pulito, il "fatto" è
  l'osservazione registrata in `STATUS.md`, non una build.
- Se il collaudo scopre un difetto e lo si corregge sul momento: `cargo check --workspace` e
  `pnpm build` verdi **e** conferma esplicita del maintainer, come da definition of done di
  `CLAUDE.md` — prima di qualunque commit.
- Commit solo dopo conferma; push solo su richiesta esplicita in questa sessione, nominando il
  ramo prima di pusharlo.

## Nota — pulizia rami eseguita nello stesso ciclo

Cancellati dieci rami locali confermati superati (contenuto già su `main` sotto altro nome,
verificato nel codice, non solo per data): `fix/mqtt-topic-vuoto`,
`salvataggio-main-2026-09-09`, `test/validazione-2026-09-06`, `feat/Q41-risorse-chat`,
`fix/Q37-cornice-lvgl`, `fix/Q38-ratio-materializza`, `fix/Q17-ricette-soglia`,
`fix/Q42-scaling-script`, `fix/Q27-tipo-in-scrittura`, `fix/revisione-documenti`.

---

## Esito — collaudo riuscito, archiviato il 2026-09-12

Nel mezzo, un problema di ambiente non di codice: la macchina ha concluso un avanzamento a
Ubuntu 26.04.1 LTS durante la sessione. `python3` di sistema è passato alla 3.14 senza il
pacchetto `-dev`, e il link di `sws-pyscript`/pyo3 falliva. Risolto in modo definitivo con
`sudo apt install -y python3.14-dev` (lanciato dal maintainer). Dettaglio completo in
`STATUS.md` (voce del 12-09) e nella memoria di sessione, non ripetuto qui.

Il collaudo vero: progetto scratch dal template `demo-items-lvgl`, chat staccata nella sua
finestra, richiesta mirata sulla pagina «Grafici e tabelle». L'assistente (Kimi) ha chiamato
davvero `istantanea_pagina` + `leggi_pagina` + `schema_oggetto`, e la risposta cita dettagli
concreti e verificabili (i colori esadecimali dichiarati delle serie, le soglie a 70/90) —
non genericità. **Il percorso funziona nella chat staccata con un modello vero.**

Osservazione emersa durante il collaudo, verificata nel codice e **non un difetto**: le tre
barre del `bar_chart` apparivano identiche a valore 0 — comportamento atteso (l'indicatore
colorato è invisibile a zero, resta visibile solo il track di sfondo), non un bug di
`lvgl_render.rs`. Il maintainer ha scelto di non riverificarlo con dati vivi.
