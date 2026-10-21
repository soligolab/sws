# Licenze, pannelli contesi, e cosa ci dice il loro numero — seme

> Messo insieme il 21-10-2026 da tre domande che erano in tre posti e sono la stessa materia:
> «Resta aperto» del [piano della Fase 4](../archive/2026-10-09-fase-4-gateway.md) e le due cose
> non attuate del seme
> [identità del pannello e token ripetibile](../archive/2026-10-10-identita-del-pannello-e-token-ripetibile.md),
> andati in archivio quel giorno. Tutte e tre chiedono **che cos'è un pannello per il server**:
> un oggetto che si conta, che si fattura, o che qualcuno possiede.
>
> **Quando questo lavoro comincia, il primo passo è una sessione di plan approfondita** per
> decidere ogni dettaglio: qui ci sono le domande e le misure di quando sono nate, non un
> progetto.

## Le tre domande

1. **Cosa ci dice il numero di pannelli di un'azienda.** Il maintainer, il 09-10-2026: «può
   essere un dato statistico utile, non una quota, ma dobbiamo analizzare con un dettaglio
   maggiore cosa ci dice questa informazione». Quanti dispositivi un cliente ha in campo, quanti
   ne tiene accesi, o quante scatole ha comprato, sono tre numeri che divergono appena qualcuno
   riformatta un pannello, ne mette uno a magazzino o ne abbina uno di prova.
2. **Come si contano le licenze.** Dal seme del 10-10: «contare le scatole, non i token».
   L'identità hardware lo rende possibile — ma resta da decidere cosa libera un posto quando un
   pannello viene dismesso, e se un pannello abbinato e spento occupa licenza.
3. **La rivendicazione contesa fra aziende.** Due aziende che rivendicano lo stesso pannello:
   oggi vince chi arriva prima col codice, e non c'è niente che dica cosa succede dopo — un
   pannello rivenduto, un impianto che cambia manutentore, un codice finito nelle mani sbagliate.

## Cosa è misurato

- `max_pannelli` **esiste** nella tabella delle aziende e nella console, e **non viene applicata
  da nessuna parte**. Decisione del 09-10: «fino ad allora la colonna non si tocca e la console
  non la mostra», ed è ancora così.
- I progetti aperti sì che hanno un tetto, applicato dal gateway: è un limite su ciò che gira,
  non un conteggio in un database (Fase 3c, poi ramo 1 della chiusura dei residui).
- **L'identità di un pannello è il seriale del device-tree**, quindi sopravvive a un reset di
  fabbrica: contare le scatole è possibile, contare i token no. Il token è
  `HMAC(segreto del gateway, identità hardware)` — ripetibile senza essere indovinabile dal
  seriale. Attuato l'11-10 ([abbinamento e primo accesso](../archive/2026-10-11-abbinamento-e-primo-accesso.md)).
- Il **ban** si verifica prima del token, apposta perché sopravviva a una riformattazione: è già
  il primo pezzo di «il pannello è un'entità del server con la sua storia», che è il concetto da
  cui le tre domande discendono.

## Domande per la sessione di plan

- Il numero serve a vedere, a fatturare o a fermare? Le tre risposte portano a tre
  implementazioni diverse.
- Una licenza si consuma all'abbinamento o alla prima connessione? E si libera con un comando,
  con un tempo, o mai?
- Chi arbitra una rivendicazione contesa: il primo che arriva, l'amministratore di piattaforma, o
  una prova di possesso fisico (un codice letto sullo schermo del pannello, come già oggi)?
- Va deciso prima o dopo la Fase 5 del tronco cloud (registrazione, email, 2FA), che è l'altro
  pezzo di «un cliente vero con un account vero»?
