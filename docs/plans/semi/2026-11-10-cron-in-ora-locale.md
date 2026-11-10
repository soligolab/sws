# Il cron degli script in ora locale (seme)

> **Stato: seme — decisione.** Nato il 10-11-2026 facendo i modelli di «Nuovo da modello» (sessione L3 del piano
> archiviato [la logica in un posto solo](../../archive/2026-11-04-logica-unificata.md)). **Quando questo lavoro
> comincerà, il primo passo è una sessione di plan approfondita e dedicata, per sviscerarne tutti i dettagli.**

## Il fatto

Il trigger cron degli script globali gira in **UTC** (`sws-runtime/crates/sws-web/src/cron.rs`, intorno alla riga 300) e
nell'IDE niente lo dice. Chi scrive `0 7 * * *` pensando alle 7 italiane accende l'uscita alle 8 d'inverno e alle 9
d'estate. I tre modelli col cron (comando a orario: `0 7 * * *` e `0 22 * * *`; azzeramento a mezzanotte: `0 0 * * *`)
lo scrivono solo in un commento.

## Le strade

- dirlo nel campo del trigger («ora UTC: le 7 italiane sono `0 6` d'inverno e `0 5` d'estate»);
- far girare il cron nel **fuso del pannello** (quello che `finestra.orologio` già mostra nell'IDE), con le due ore
  ambigue del cambio d'ora da decidere (saltare, ripetere);
- un fuso per progetto, accanto al formato e alla lingua.

Tocca anche i report programmati e la finestra di aggiornamento, che hanno già fatto la loro scelta sul fuso: da
allineare.
