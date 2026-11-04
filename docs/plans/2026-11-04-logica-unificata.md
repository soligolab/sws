# La logica in un posto solo: funzioni, script e ricette — seme

> **Stato: seme — decisione.** Nato il 04-11-2026 da una richiesta del maintainer: «La sezione LOGIC è un po'
> confusa, ci sono le funzioni che sono python e poi un sotto menù "Python" in cui ci sono delle funzioni…
> unificherei script e funzioni in un contesto unico nel ramo principale assieme alle Ricette. Rivedrei meglio i
> suggerimenti di codice e i template per renderli più utili».
>
> **Quando questo lavoro comincia, il primo passo è una sessione di plan approfondita, dedicata, per sviscerarne
> tutti i dettagli.** Qui ci sono l'idea e le misure del 04-11-2026, non un progetto.

## L'idea

Un solo ramo **Logica** nel pannello laterale, con tre cose dello stesso livello: le **funzioni** (codice chiamato da
un bottone o da un evento), gli **script** (codice che parte da solo: all'avvio, a intervalli, al cambio di un tag) e
le **ricette**. Oggi le prime due sono Python tutte e due, ma vivono in due posti con due nomi diversi.

Insieme: suggerimenti di codice e modelli pronti più utili.

## Le misure di oggi

| | |
|---|---|
| Funzioni | sezione **Funzioni** del pannello laterale (`FunctionsSection` in `editor/LeftPanel.tsx`), editor `editor/FunctionEditor.tsx` (344 righe); in `project.yaml` sono `functions[]` |
| Script | **Configurazione → Progetto → Python** (`config/schede/GlobalScriptsTab.tsx`, 337 righe; la scheda si chiama `scripts`, l'etichetta è «Python»); in `project.yaml` sono `global_scripts[]`, con `trigger` (`startup`, `interval`, …) |
| Ricette | Configurazione → Progetto → Ricette (`recipes`) |
| Stile VS Code | la voce **Logica** della barra di attività mette già insieme `FunctionsSection` e le schede `scripts` e `recipes` (`VOCI_SINISTRA` in `editor/LeftPanel.tsx`); nell'albero classico restano in due rami diversi |
| Editor del codice | `components/PythonEditor.tsx`: CodeMirror 6 con `@codemirror/lang-python`, **senza completamento**: non suggerisce `tags.read`/`tags.write`, i nomi dei tag, le funzioni del progetto |
| Modelli | sei frammenti fissi in `FunctionEditor.tsx` (`SNIPPETS`: increment, toggle, conditional, reset_many, diagnostic, skeleton), in inglese, con nomi di tag inventati (`counter`, `light`, `input_a`) che nel progetto non esistono; gli script non ne hanno |
| Regole della sandbox | RestrictedPython: niente `import`, niente `min`/`max`/`sum`, le costanti dentro le funzioni (vedi il commento di `demo-sim` in `examples/templates/demo-items-web/project.yaml`) — oggi le scopre chi scrive, al primo errore sul pannello |

## Da decidere nella sessione di plan

- un elenco unico con un filtro (funzioni / script) o due gruppi nello stesso ramo; se `functions[]` e
  `global_scripts[]` restano due campi del progetto (cambiarli tocca il runtime, i template, la validazione e
  l'assistente) o si unificano anche lì;
- il completamento: `tags.read("…")` che propone i tag del progetto, le funzioni chiamabili, i parametri dichiarati;
  e gli avvisi della sandbox mentre si scrive (`controlla_python` esiste già lato server per l'assistente);
- i modelli: quali casi veri (contatore di ore di marcia, media mobile, allarme con isteresi, scrittura a orario,
  ricetta da applicare…), nella lingua dell'IDE, con i tag scelti dal progetto invece che inventati;
- dove va la voce nell'albero classico, e cosa ne è della scheda «Python» di Configurazione.
