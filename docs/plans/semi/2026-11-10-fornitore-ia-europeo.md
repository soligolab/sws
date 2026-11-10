# Un fornitore di IA europeo per l'assistente (seme)

> **Stato: seme — decisione.** Nato il 10-11-2026, rivedendo i testi legali per l'apertura del cloud. Osservazione del
> maintainer: «in questo momento il sistema usa o IA cinesi o americane, manca una opzione europea». **Quando questo
> lavoro comincerà, il primo passo è una sessione di plan approfondita e dedicata, per sviscerarne tutti i dettagli.**

## Cosa c'è (10-11-2026)

L'assistente parla con **Anthropic** (Stati Uniti) e **Moonshot/Kimi** (`api.moonshot.ai`, Cina), che usano la stessa API
«Messages» (`sws-runtime/crates/sws-web/src/ai/client.rs`; il prezzo per modello in `prezzi()`). Nel cloud parte solo con la
chiave dell'utente. L'informativa privacy (§5) deve avvertire che tutti e due i fornitori portano i dati fuori dall'UE.

## L'idea

Un fornitore con sede e trattamento nell'UE — il candidato ovvio è **Mistral AI** (Francia), ma anche modelli aperti
serviti da un fornitore europeo (es. Scaleway, OVH AI Endpoints). Per un cliente industriale europeo può essere la
differenza fra poter usare l'assistente o no.

## Le domande per la sessione di plan

- **Il protocollo**: Mistral e gli altri parlano un'API in stile OpenAI («chat completions», strumenti con un formato
  diverso), non «Messages». È lo stesso lavoro della voce «OpenAI o altri come fornitore di testo» nel piano
  [dell'assistente](../2026-11-03-assistente-genera-simboli-e-sinottici.md) (sezione «Code annotate il 10-11-2026»): un
  secondo protocollo di chiamata e di strumenti, fatto una volta, apre tutti e due.
- **La qualità** con i nostri strumenti (proposte di sinottico, simboli `prj:`): misurarla sui due banchi del piano
  dell'assistente prima di proporlo come scelta.
- **I prezzi** in `prezzi()` e il tetto di spesa.
- **L'informativa**: un fornitore UE si scrive fra i servizi che l'utente attiva, senza trasferimento extra-UE.
- Se diventare il **predefinito** nel cloud, con Anthropic e Kimi come alternative.
