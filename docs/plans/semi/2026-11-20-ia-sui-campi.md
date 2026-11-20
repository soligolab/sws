# L'IA sui campi dell'IDE — una piccola icona che apre un pop-up per scrivere il campo

> Seme del 20-11-2026, dal maintainer, durante il collaudo: «introdurre una piccola icona "IA", che come forma richiama
> quella del menù laterale, su ogni campo dell'IDE che permette di aprire un piccolo pop-up per editare il campo. Un
> esempio è il campo "λ expression" nell'elenco dei tag dove per esempio vorrei chiedere all'assistente di convertire
> il dato "55044.44921875" di ram che ora è mostrato così in un dato in MB pari a 55,04 MB».
>
> **Quando questo lavoro comincia, il primo passo è una sessione di plan approfondita e dedicata**, per sviscerarne
> tutti i dettagli.

## L'idea
Accanto a un campo dell'IDE, una piccola icona con la forma di quella dell'assistente nel menù laterale. Un clic apre
un pop-up piccolo: si scrive cosa si vuole («converti in MB con due decimali»), il modello propone il valore nuovo
del campo, e lo si accetta o no. È l'assistente della chat ridotto a un campo solo, senza aprire la chat.

## Cosa c'è nel codice (misurato il 20-11-2026)
- **L'icona**: l'assistente nel menù laterale è «una scintilla grande e una piccola»
  (`sws-editor/src/editor/iconeAttivita.ts`, riga 31). La versione piccola da campo non c'è.
- **Il campo dell'esempio**: «λ espressione» dei tag sta in `config/schede/TagsTab.tsx`. Il pulsante λ (riga 604)
  apre un `input` semplice (riga 798) che scrive `tag.expression`.
- **L'esempio chiede più di un campo**: per mostrare `55,04 MB` serve l'espressione (`x / 1000`, o `/ 1024` se sono
  KiB: va chiesto), ma anche l'**unità** (`unit: MB`) e i **decimali** (`decimals: 2`), che sono campi a parte dello
  stesso tag. Il pop-up di un campo dovrà poter proporre anche i campi vicini, o dire quali toccare.
- **Una chiamata singola al modello esiste già**: il traduttore (`traduttore.rs`) e il disegno dei simboli
  (`symbol_draw.rs`) usano `client::chiedi_con_uso` / `ask_shaped`, con il modello di uno scopo, il tetto di spesa e
  la risposta tenuta a uno schema JSON sui modelli locali. Il pop-up può usare la stessa strada.
- **Il contesto utile al modello**: il nome del campo e il suo schema (il catalogo dei campi c'è per l'assistente,
  `schema_tag`, `schema_oggetto`), il valore di adesso e, per un tag, il **valore vivo** (il `55044.44921875`
  dell'esempio, che lo store dell'IDE ha già).

## Le domande per la sessione di plan
1. **Su quali campi**: su tutti, o solo su quelli dove scrivere è difficile (espressioni, script Python, formati,
   condizioni d'allarme, regole delle animazioni)? Un'icona su ogni campo rischia di riempire il pannello proprietà.
2. **Cosa vede il modello**: solo il campo, o anche l'oggetto e il tag interi, e i valori vivi?
3. **Cosa può cambiare**: solo il campo, o anche i campi vicini (unità e decimali nell'esempio), mostrati prima di
   accettare?
4. **Quale modello**: quello dell'assistente, o uno scopo nuovo (piccolo e veloce, anche locale)?
5. **L'intervista**: come nella scheda IA dei simboli e nella chat (20-11-2026), il modello chiede quando la richiesta
   è ambigua (kB o KiB?).
6. Nel cloud e in locale funziona uguale; sul pannello no (l'IA è solo dell'IDE).
