# La prova comparata dei modelli

> Seme, non piano. Nato il 17-11-2026 col piano [l'IA a scelta del cliente](../../archive/2026-11-17-ia-a-scelta-del-cliente.md).
> **Quando si comincia, il primo passo è una sessione di plan dedicata per vederne i dettagli.**

## L'idea

Una sessione di prove fra i modelli che SWS sa usare: Claude, Kimi, Mistral e almeno un modello in casa (Ollama o
vLLM su una macchina con GPU). Stessi compiti per tutti, col banco della casa (`scripts/bench_house.sh --real`) e
quello dei tubi (`scripts/banco_tubi.sh`): quanto riesce, quanto costa, quanto ci mette.

## Perché aspetta

Il maintainer, 17-11-2026: il cliente sceglie un modello più per fiducia che per competenza tecnica. Le misure
servono, ma non ora: il lavoro del 17-11 dà la libertà di scelta, le misure la renderanno informata.

## Da sapere quando si riprende

- `bench_house.sh` oggi esce se nella cartella delle chiavi non c'è un file `*.key` (riga 38): un modello in casa non
  ha chiave, quindi va adattato.
- Le prove con i fornitori a pagamento costano: vanno decise prima, con un tetto.
