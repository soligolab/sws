# Lo schedulatore: tag, condizione, azione, modificabile a runtime

> **Seme — decisione.** Nato il 18-11-2026 dagli appunti presi in velocità dal maintainer in una riunione: «schedulatore: da un tag, una condizione di verifica e un'azione, modificabile a runtime». **Quando questo lavoro comincerà, il primo passo è una sessione di plan approfondita e dedicata, per sviscerarne tutti i dettagli.** Qui c'è solo l'idea, così come è stata detta: nessuna misura nel codice, nessun progetto.

## L'idea

Uno **schedulatore**: a partire da un **tag**, una **condizione di verifica** e un'**azione collegata**.

Esempio: accendere le luci quando un tag dice che **fra mezz'ora sarà notte**.

Poi il **componente schedulatore**, per **modificare le schedulazioni a runtime**: nello stesso esempio, l'utente potrebbe voler cambiare l'ora di accensione delle luci.

## Da sapere quando si riprende

- Da decidere: rapporto con gli script e la Logica unificata (una schedulazione è una regola o un oggetto a parte?), dove si salvano le modifiche fatte a runtime, quale ruolo può cambiarle, cosa succede se il pannello è spento all'ora prevista.
- Un posto sensato in CasaDomotica c'è (le luci): è il primo candidato per la regola di `CLAUDE.md` sul progetto di riferimento.
