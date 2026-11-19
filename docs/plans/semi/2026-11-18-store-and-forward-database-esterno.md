# Store and forward per il database esterno

> **Seme — decisione.** Nato il 18-11-2026 dagli appunti presi in velocità dal maintainer in una riunione: «store and forward per il database esterno, in caso di perdita di connessione». **Quando questo lavoro comincerà, il primo passo è una sessione di plan approfondita e dedicata, per sviscerarne tutti i dettagli.** Qui c'è solo l'idea, così come è stata detta: nessuna misura nel codice, nessun progetto.

## L'idea

Nel caso di **database esterno**, prevedere lo **store and forward** quando la connessione si perde.

## Da sapere quando si riprende

- Da decidere: dove si accumula (disco del pannello), quanto, cosa succede se si riempie, l'ordine di invio al ritorno della rete, i duplicati.
