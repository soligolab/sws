# I valori delle variabili sul codice Python — seme

> **Stato: seme — decisione.** Nato il 05-11-2026 da una domanda del maintainer, guardando lo script «giornata» di
> Montagna: «c'è modo di avere un debug on-line che mostri il valore delle variabili sovrapposto al codice?»
>
> **Quando questo lavoro comincia, il primo passo è una sessione di plan approfondita, dedicata, per sviscerarne
> tutti i dettagli.** Qui ci sono l'idea, le misure del 05-11-2026 e le opzioni, non un progetto. Le prove stanno in
> `tmp/debug-inline/` (solo su theobroma): tre misure, una proposta e due verifiche indipendenti.

## Oggi

Non c'è. Si vedono il `print` nel registro (dal 05-11, L0: col nome dello script, ma **solo nei giri riusciti** —
in errore o timeout lo stdout si perde, `lib.rs` `run_in_python`), i tag che lo script scrive, e per le funzioni il
«Prova» del viewer (stdout ed errore, niente variabili). A Rust tornano solo stdout e stderr (`ExecOutput`).

I pezzi però ci sono:
- l'harness installa già `sys.settrace` (per il kill switch); lo script si compila come `<inline>` senza righe
  davanti, quindi la riga N della traccia è la riga N dell'editor;
- `@codemirror/view` 6.43 ha i widget a fine riga: un prototipo gira sulle versioni installate
  (`tmp/debug-inline/ide-widget-prova.mjs`);
- un raccoglitore Python provato su «giornata» (Python 3.12.3 + RestrictedPython 8.5, cioè l'immagine 2.25.1):
  a fianco di `h = h + 0.04` mostra `h = 11.04`, di `portata = 80.0 + 100.0 * f` mostra `portata = 164.0`; le righe
  non eseguite restano vuote, quindi si vede anche dove è passato lo script. Circa 150 byte per giro.

## Le opzioni

| | Cosa si vede | Dove gira | Costo | Rischio principale |
|---|---|---|---|---|
| **A. Valori dell'ultimo giro** | accesa «Valori», i valori del giro vero accanto a ogni riga, aggiornati a ogni giro | lo script che gira (IDE o pannello) | ~+1,5 ms per giro su x86 (stima, raccoglitore precompilato); **sul WP630 non misurato**; da spento zero, se il trace si sceglie quando si installa | un'eccezione nel raccoglitore toglie il trace e **con lui il kill switch** (provato: un ciclo infinito che oggi si ferma resta in corsa) |
| **B. Prova a secco** | «Prova» nell'editor, anche col codice non salvato: un giro, coi valori, niente scritto | l'IDE soltanto | un giro per clic | **riapre Q47**: una rotta che esegue il codice della richiesta (`/api/script/exec` tolto il 09-09-2026) |
| **A0. Valore dei tag accanto a `tags.read`/`tags.write`** | il valore attuale del tag a fine riga | l'IDE soltanto | nessuno sul runtime | è il valore di adesso, non quello del giro |
| **C. Debug a passi** | punti di arresto, avanti di una riga | lo script che gira | — | fermo, blocca il giro dopo (`s.ora` non avanza), lascia l'impianto mezzo aggiornato, il timeout lo uccide: **no** sull'impianto. Al suo posto, «passi registrati» dentro B |

## Le contromisure già viste (dalle due verifiche)

- **A**: il raccoglitore non solleva mai (un `repr()` di un intero oltre 4300 cifre fa fallire lo script); meglio
  `sys.monitoring` (PEP 669, c'è nelle due immagini), separato dal trace del kill switch, sui soli oggetti codice
  dello script; campionare (un giro raccolto al secondo per script, anche con `interval_ms` a 50); tetto di eventi e
  di tempo; acceso solo finché qualcuno guarda, con ping/pong e un tetto di 10 minuti imposto dal pannello; valori
  resi in testo senza markup (`textContent`); un test di equivalenza: con la vista accesa e spenta lo script scrive
  gli stessi tag. Sul pannello il canale va nel gruppo Admin `gestione` come `/ws/logs`, con un test che lo tenga lì
  e uno che confronti gli elenchi dei canali di `remote_relay.rs` e `wsUrl.ts` (se il canale manca in `wsUrl.ts` si
  vedono in silenzio i valori della copia nell'IDE).
- **B**: ruolo Admin (chi salva gli script), rotta solo nel router dell'IDE con un test strutturale, eccezione a Q47
  dichiarata; identità e `state` propri della prova; nessuna riga di log; `functions.run` e `send_telegram` finti
  che registrano «chiamerebbe…»; `tags.write` che registra dopo `coerce_for_write`.
- **Due copie**: con l'IDE collegato a un pannello lo script gira due volte (IDE e pannello). La vista deve dire da
  quale arrivano i valori, e confrontare l'impronta del codice che gira con quello nell'editor.

## La proposta del 05-11 (da decidere)

Ordine **B → A0 → A**, C no: B fa senza toccare il pannello i due pezzi che servono ad A (raccoglitore e widget), e si
innesta dopo L1 della [logica unificata](../../archive/2026-11-04-logica-unificata.md) (il «Prova» c'è solo per le funzioni); A0 sta
bene accanto a L2; A è un ramo suo, prima sull'IDE 8460 e poi sul pannello con la misura sul WP630.

Domande per il maintainer: l'ordine (A, cioè l'impianto che gira, prima?); quale copia mostrare quando l'IDE è
collegato; il ruolo per vedere le variabili (Operator nell'IDE come `/ws/logs`, Admin sul pannello come già il relay);
codice diverso da quello che gira: nascondere i valori o mostrarli in grigio.
