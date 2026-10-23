# Un server MCP per far editare il progetto all'IA

> **Era un seme (Q26, 31-08-2026), dal 22-10-2026 è un referto: il lavoro è stato fatto, in sola
> lettura.** Il seme avvertiva di sé: «da riverificare quando si riprenderà — il repo ha già
> `sws-web/src/ai/` con l'astrazione dei fornitori, e parte del lavoro che questa scheda
> immaginava potrebbe essere già in piedi». Era vero, ed era quasi tutto.

## Cosa diceva il seme, e cosa dice il codice

Il seme poneva sei domande da sciogliere «prima di scrivere una riga». Misurate contro il codice
del 22-10-2026, **cinque erano già decise**, non da decidere:

| La domanda del seme | Cosa dice il codice di oggi |
|---|---|
| 1. Dove gira, e quindi cosa può toccare | Dentro il runtime che ha già il progetto aperto: `tools::esegui` vuole un `AppState`, e quello nasce da `router::build(...)` con trentacinque argomenti |
| 2. Sola lettura o anche scrittura | **Già decisa**: gli strumenti sono 13, e **nessuno scrive**. L'unico con un effetto collaterale è `istantanea_pagina`, che copia il progetto in una cartella temporanea. Il prompt di sistema lo dice al modello in prima persona: «Non scrivi mai sul disco» |
| 3. Chi approva | **Già costruita**: `proponi_modifica` non tocca il disco, manda un evento al browser. `applyAiProposal` (store dell'editor) confronta l'impronta sha256 del progetto su disco e rifiuta se è cambiato, poi fa **un solo** passo di cronologia |
| 4. Come si torna indietro | Ctrl+Z, in un passo, progetto compreso. Le sezioni fuori dalle pagine restano in attesa e partono solo al Salva |
| 5. Rapporto con `write_min_role` e Q17 | Q17 è chiusa dal 06-09-2026: `apply_recipe` fa il pre-controllo `tag_write_allowed` e scrive l'audit. E nessuno strumento dell'IA scrive un tag |
| 6. I segreti viaggiano col progetto | **Non è più il punto più affilato**: `mask_project_secrets` è chiamata anche dallo strumento, non solo dall'handler HTTP, e dal 2026 l'export spedisce i segreti **solo** con `?segreti=1`, con la casella spenta di default |

E tre numeri del seme erano vecchi: 238 campi sono diventati 275 (lo schema generato ne documenta
414 su 39 tipi), «sette guardie» sono diventate 47 statiche, e la frase sull'export in chiaro non
vale più. Il commento in testa a `ai/tools.rs` la ripeteva: è stato corretto.

## Cosa è stato costruito

**`sws-runtime --mcp`**: il progetto come server MCP **in sola lettura** su stdio
(`sws-web/src/mcp.rs`). Espone gli **undici** strumenti che `tools::esegui` smista, cioè quelli
che leggono e basta.

**Perché una modalità del runtime e non un binario a sé.** `AppState` nasce da `router::build`
con trentacinque argomenti — un `TagDb`, un motore Python vivo, i supervisori delle sorgenti, il
progetto aperto. Un secondo binario che se lo costruisse sarebbe una seconda copia di tutto
l'avvio, destinata a divergere. `--mcp` avvia esattamente com'è sempre e, al posto dei listener,
mette un ciclo JSON-RPC su stdin/stdout.

**I due strumenti esclusi, e perché.** `proponi_modifica` non produce un risultato da rimandare
al modello: chiude il turno verso il browser, dove vivono il confronto, i due bottoni, il
controllo dell'impronta e il passo unico di annullamento. Fuori da quella finestra **non ha
destinazione**: un canale che scrive senza nessuno che guarda sarebbe il secondo autore del
progetto che il seme temeva. `istantanea_pagina` copia il progetto e avvia un secondo runtime, e
il suo risultato è un blocco immagine nel formato di Anthropic, che MCP non accetta così com'è.

La scelta è scritta in `tools::SOLA_LETTURA` e `tools::FUORI_DA_ESEGUI`, due elenchi invece di
una deduzione da un `match`, e un test (`nessuno_strumento_sfugge_alla_classificazione`) tiene la
loro unione uguale a `definizioni()`: **un dodicesimo strumento aggiunto domani non si troverà
esposto per inerzia** — farà diventare rosso quel test e costringerà a scegliere.

## Il difetto che si è visto solo provandolo

Al primo avvio vero, il **banner del primo accesso** stampava sei righe su `stdout` prima della
prima risposta. Su stdio il protocollo **è** stdout: un client vero si sarebbe staccato, e il
difetto non si vede nei log — è il client a chiudere.

Due rimedi: il banner va su stderr con `--mcp` (e con lui lo strato `json` di `tracing`, che
scrive su stdout per default), e la guardia `check_mcp.sh` controlla per prima cosa che su stdout
**ci sia solo il protocollo**. È la prova che nessuna lettura del codice avrebbe prodotto.

## Verifica

| Prova | Dove |
|---|---|
| Handshake, versione chiesta e versione di ripiego, `tools/list` con `inputSchema`, metodo sconosciuto, strumento escluso che dichiara di esserlo | 8 prove in `sws-web/src/mcp.rs` |
| I due elenchi coprono esattamente `definizioni()` | `nessuno_strumento_sfugge_alla_classificazione` |
| **Una sessione vera contro un progetto vero**, e stdout pulito | `scripts/check_mcp.sh` (12 controlli) |

Documentazione per chi lo usa: `docs/HOWTO.md` capitolo 26.

## Cosa resta, ed è una decisione, non un lavoro

Se un giorno l'MCP debba anche **scrivere**. Oggi la risposta è no, e non per un ostacolo
tecnico: perché l'approvazione umana vive nell'editor, e riprodurla in un terminale vuol dire
inventare da zero dove va la proposta e chi la guarda. Il punto è in `docs/plans/Appunti.txt`.

**Nota sul progetto di riferimento**: la regola di `CLAUDE.md` dice che una funzione visibile che
entra in `main` va messa anche in CasaDomotica. Questa non ha un posto lì — non è un oggetto
sinottico, è un modo di avviare il runtime. È l'indizio che il suo destinatario non è chi guarda
un impianto, ma chi lo disegna.

---

## Il testo del seme, com'era

L'idea: esporre il progetto SWS attraverso un **server MCP**, così che l'utente possa usare un
assistente IA per costruire e modificare sinottici, tag, allarmi e script — invece di disegnare
tutto a mano nell'IDE.

Cosa rendeva l'idea interessante: il progetto è **già** in una forma che un modello linguistico
maneggia bene — YAML dichiarativo, uno schema unico e autorevole, un parser vero e delle guardie
che dicono no a un progetto malformato. Un assistente che scrive YAML ha quindi un giudice, e non
deve indovinare se ha fatto bene.

Le sei domande sono nella tabella qui sopra, con la risposta che il codice ha dato.
