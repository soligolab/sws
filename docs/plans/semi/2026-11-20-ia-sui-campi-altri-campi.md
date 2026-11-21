# L'IA sui campi — i campi rimasti fuori dal primo giro

> Seme del 20-11-2026, nato aprendo il ramo `feat/ai-fields` (piano
> [l'IA sui campi](../2026-11-20-ia-sui-campi.md)). Il maintainer aveva scelto «i campi difficili»: espressione λ dei
> tag, condizioni d'allarme, formati, regole delle animazioni. Il primo giro ne copre due; gli altri chiedono una cosa
> diversa da un campo di testo, ed è meglio deciderla che improvvisarla.
>
> **Quando questo lavoro comincia, il primo passo è una sessione di plan approfondita e dedicata**, per sviscerarne
> tutti i dettagli.

## Cosa c'è (20-11-2026)
- `POST /api/ai/field` (`ai/field_assist.rs`) conosce due tipi: `tag_expression` (con i vicini `unit` e `decimals`)
  e `format`. Il pulsante è `components/AiFieldButton.tsx`; lo usano `TagsTab.tsx` (riga dell'espressione λ) e il
  campo «Formato» del pannello proprietà (`EditorShell.tsx`, `formatInput`).
- Le proposte sono **testo**: un valore per campo, applicato tutto o niente.

## Cosa resta, e perché non è un campo di testo
- **Le condizioni d'allarme** non sono testo: un allarme ha dei **livelli**, ognuno con una condizione scelta da un
  elenco (`AlarmCondition` in `sws-core/src/alarm.rs`: soglie, uguaglianze, booleani, `Not`…), una severità, un
  messaggio e una banda morta. L'IA dovrebbe proporre **livelli interi** (JSON validato con lo schema
  dell'allarme), mostrati come prima → dopo per livello. È un altro tipo di risposta.
- **Le regole delle animazioni dei simboli** (scheda «Pezzo» dell'editor dei simboli, «Anima…»): da misurare quali
  campi sono testo libero e quali scelte da elenco.
- **Il codice Python** di funzioni e script: un campo grande, dove l'IA servirebbe più come «modifica questo pezzo»
  che come «scrivi il campo». Si lega al seme [valori sul codice Python](2026-11-05-valori-sul-codice-python.md) e
  alla sandbox (`sandbox-degli-script-secondo-giro`).

## Le domande per la sessione di plan
1. Per gli allarmi: proporre livelli interi, o solo la condizione di un livello scelto?
2. Per il codice: un pop-up come per i campi, o un pannello accanto all'editor del codice con la differenza riga per
   riga?
3. Le regole del progetto per lo scopo `fields` (`RegoleIaPerScopo` oggi non ha la voce): servono?
