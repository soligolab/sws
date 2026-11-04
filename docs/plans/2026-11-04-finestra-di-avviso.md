# La «Finestra di avviso» al posto dei pop-up del browser — seme

> **Stato: seme — decisione.** Nato il 04-11-2026 da una richiesta del maintainer: «ora per i pop-up usi quelli
> nativi del browser e sembrano errori, la gente diffida dei pop-up del browser. Implementerei una funzione "Finestra
> di avviso" che apra un'area in centro alla pagina, in cui presentare tutto quello che ora viene mostrato come
> pop-up. La stessa funzione sarà usata anche per spostare alcune configurazioni» (come l'impostazione iniziale del
> progetto, [seme](2026-11-04-impostazione-iniziale-del-progetto.md)).
>
> **Quando questo lavoro comincia, il primo passo è una sessione di plan approfondita, dedicata, per sviscerarne
> tutti i dettagli.** Qui ci sono l'idea e le misure del 04-11-2026, non un progetto.

## L'idea

Un componente solo, con lo stile dell'IDE, al centro della pagina sopra un velo scuro: un titolo, un testo, i suoi
bottoni. Sostituisce `alert`, `confirm` e `prompt` del browser, e può ospitare anche un piccolo modulo (più campi, un
«Salva»), che è quello che serve all'impostazione iniziale del progetto.

## Le misure di oggi

| | |
|---|---|
| Pop-up nativi | nei `.ts`/`.tsx` dell'editor (test esclusi): circa **68** `confirm(`, **22** `alert(`, **11** `prompt(`, in **43** file |
| Finestre già fatte a mano | `components/QuickCreateTagModal.tsx`, `ReAuthModal.tsx`, `RinominaTagModal.tsx`, `scala/DialogoRisoluzione.tsx`, `accesso/ChiudiAccount.tsx`, `runtime-view/AvvisoAggiornamento.tsx`: ognuna col suo velo, il suo stile e la sua gestione dei tasti |
| Un vincolo | `confirm`/`prompt` **fermano** il codice e restituiscono subito la risposta; una finestra React no. Ogni chiamata diventa `await chiedi(…)`: si cambia la forma delle funzioni che le usano, non solo una riga |

## Da decidere nella sessione di plan

- l'interfaccia: `await avviso({ titolo, testo, bottoni })`, `await conferma(…)`, `await chiedi(…)` per un testo, e una
  forma con un modulo;
- i tre livelli visivi (informazione, conferma, azione pericolosa) e quale bottone è quello predefinito;
- Invio, Esc e il focus, come oggi nelle finestre fatte a mano;
- se le sei finestre esistenti passano sullo stesso componente;
- una guardia statica che impedisca di reintrodurre `confirm(`, `alert(`, `prompt(` nel codice dell'editor;
- il viewer web: anche lì c'è qualche pop-up nativo (per esempio la conferma di un comando)?
