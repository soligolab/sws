# L'editor dei simboli: esplodere, animare, farsi aiutare dall'IA

> **Seme — decisione.** Nato il 18-11-2026 dagli appunti presi in velocità dal maintainer in una riunione: «editor dei simboli: esplodere, animare, aspetto legato al tag». **Quando questo lavoro comincerà, il primo passo è una sessione di plan approfondita e dedicata, per sviscerarne tutti i dettagli.** Qui c'è solo l'idea, così come è stata detta: nessuna misura nel codice, nessun progetto.

## L'idea

Un editor dei simboli vero, con queste capacità:
- **esplodere** un simbolo ed **editare i singoli pezzi**;
- **l'aspetto legato a un tag** (lo stato): ogni pezzo cambia in funzione del valore;
- **animazioni**, scelte da un menù delle più tipiche: rotazione, oscillazione, riempimento, sfocatura, bollicine, fumo, fuoco, neon, vibrazione, ecc.;
- **ogni componente del simbolo ha le sue proprietà**, tra cui il **punto di ancoraggio** per il movimento;
- un **form dedicato per l'IA**, per modificare il simbolo a parole.

## Da sapere quando si riprende

- Seme [libreria dei simboli più ricca](2026-11-03-libreria-simboli-piu-ricca.md) e piano archiviato dell'[assistente che disegna i simboli](../../archive/2026-11-03-assistente-genera-simboli-e-sinottici.md): la sorgente dei simboli e l'IA che li disegna esistono già.
- Da decidere nella sessione di plan: dove vive l'animazione (dato del simbolo o dell'oggetto), la parità con il motore LVGL (regola WYSIWYG e due motori), il costo sui pannelli piccoli.
