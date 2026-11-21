# L'IA sui campi dell'IDE — una piccola icona che apre un pop-up per scrivere il campo

> Seme del 20-11-2026, dal maintainer, durante il collaudo: «introdurre una piccola icona "IA", che come forma richiama
> quella del menù laterale, su ogni campo dell'IDE che permette di aprire un piccolo pop-up per editare il campo. Un
> esempio è il campo "λ expression" nell'elenco dei tag dove per esempio vorrei chiedere all'assistente di convertire
> il dato "55044.44921875" di ram che ora è mostrato così in un dato in MB pari a 55,04 MB».
>
> **Piano dal 20-11-2026 sera** (sessione di plan col maintainer, da `ufficio`): decisioni qui sotto. Ramo
> `feat/ai-fields`, annidato su `feat/device-per-project` (catena del 20-11; il bug «Later» è rimandato al collaudo sul TC620).

## L'idea
Accanto a un campo dell'IDE, una piccola icona con la forma di quella dell'assistente nel menù laterale. Un clic apre
un pop-up piccolo: si scrive cosa si vuole («converti in MB con due decimali»), il modello propone il valore nuovo
del campo, e lo si accetta o no. È l'assistente della chat ridotto a un campo solo, senza aprire la chat.

## Cosa c'è nel codice (misurato il 20-11-2026)
- **L'icona**: l'assistente nel menù laterale è «una scintilla grande e una piccola»
  (`sws-editor/src/editor/iconeAttivita.ts`, riga 31). La versione piccola da campo non c'è.
- **Il campo dell'esempio**: «λ espressione» dei tag sta in `config/schede/TagsTab.tsx`. Il pulsante λ apre un
  `input` semplice che scrive `tag.expression`.
- **L'esempio chiede più di un campo**: per mostrare `55,04 MB` serve l'espressione (`x / 1000`, o `/ 1024` se sono
  KiB: va chiesto), ma anche l'**unità** (`unit: MB`) e i **decimali** (`decimals: 2`), campi a parte dello stesso tag.
- **Una chiamata singola al modello esiste già**: il traduttore (`traduttore.rs`) e il disegno dei simboli
  (`ai/symbol_draw.rs`) usano `client::chiedi_con_uso` / `ask_shaped`, con il modello di uno scopo, il tetto di spesa e
  la risposta tenuta a uno schema JSON sui modelli locali.
- **Gli scopi** stanno in `ai/scopi.rs` (`Scopo::{Assistente, Simboli, Traduzione, Sfondi}`, con `TUTTI`, `nome`,
  `da_nome`); `simboli` e `traduzione` ricadono sull'assistente se non hanno un fornitore loro. Le scelte stanno in
  `config_dir/ai.yaml` e nell'account (fornitore preferito).
- **L'intervista** (20-11-2026, scheda IA dei simboli e chat): il modello può rispondere con una domanda invece che
  con il lavoro; lo stesso schema vale qui.

## Le decisioni (maintainer, 20-11-2026)
1. **Solo sui campi difficili**: l'espressione λ dei tag, le condizioni d'allarme, i formati, le regole delle
   animazioni. Un elenco nel codice, che si allarga dopo.
2. **Il modello vede l'oggetto intero** (il tag, l'allarme, l'oggetto della pagina) **e il valore vivo** quando c'è.
3. **Può proporre anche i campi vicini** (unità, decimali): l'IDE li mostra come prima → dopo e li applica tutti con un
   clic, o niente.
4. **Se la richiesta è ambigua chiede** (kB o KiB?), come l'intervista dei simboli: una domanda, la risposta nel
   pop-up, si riparte.
5. **Uno scopo nuovo**, `fields`, accanto agli altri, con il suo modello scelto nel progetto e nell'account (anche uno
   piccolo o locale); senza scelta ricade sull'assistente, come `simboli` e `traduzione`.
6. Uguale nel cloud e in locale; sul pannello no (l'IA è solo dell'IDE).

## Come si fa
- **Scopo** `Scopo::Fields` (nome `fields`, codice nuovo in inglese) in `ai/scopi.rs`: `TUTTI`, ricaduta
  sull'assistente, elenco degli scopi di testo nei test e nell'IDE (Scopi del progetto, «Le mie chiavi IA»).
- **Rotta** `POST /api/ai/field` (`ai/field_assist.rs`, nuovo): corpo `{ field, label, value, entity, entity_kind,
  live_value?, allowed: [campi modificabili], request, history: [{question, answer}] }`. Risposta, tenuta a uno
  schema JSON (`ask_shaped`): `{ kind: "proposal", changes: [{ field, value }], note }` oppure
  `{ kind: "question", question }`. Il server scarta i `changes` su campi fuori da `allowed`. Tetto di spesa e
  registro della spesa come gli altri scopi. Il prompt dice cosa sono le espressioni (la sandbox: niente import,
  cicli, `range`, `pow`, `+=`; `x` è il valore grezzo), le condizioni d'allarme e i formati, con i loro esempi.
- **IDE**: `AiFieldButton` (icona piccola, la scintilla di `iconeAttivita.ts`) e un pop-up ancorato al campo:
  richiesta, «Chiedi», poi la proposta come prima → dopo per ogni campo, «Applica» / «Annulla»; o la domanda del
  modello con la casella della risposta. `api.aiField()` in `client.ts`. Il pulsante non compare se l'IA non è
  configurata (stessa condizione della scheda IA dei simboli).
- **I primi campi**: espressione λ dei tag (vicini: `unit`, `decimals`) in `TagsTab.tsx`; condizione d'allarme;
  formato di un valore; le espressioni delle regole d'animazione dei simboli. L'elenco esatto si misura aprendo il
  ramo, e quelli che non entrano nella sessione vanno in un seme.
- **Testi** in `it.json`/`en.json`; NOVITA 2.26.0 (in rc si aggiunge tutto).

## Verifica
- `cargo test`: lo schema della risposta, i `changes` fuori da `allowed` scartati, la ricaduta dello scopo
  sull'assistente, un modello finto che risponde con una domanda e poi con la proposta.
- vitest: il pop-up (proposta applicata a tutti i campi o a nessuno, domanda e risposta), il pulsante nascosto senza
  IA.
- Collaudo: il tag della RAM di CasaDomotica (o un tag a rampa), «converti in MB con due decimali» → la domanda
  kB/KiB, poi espressione, unità e decimali; la stessa cosa con un modello in casa (Ollama).
- CasaDomotica: un tag con l'espressione scritta così (regola di `CLAUDE.md`).
