# Licenze, pannelli contesi, e cosa ci dice il loro numero — seme

> Messo insieme il 21-10-2026 da tre domande che erano in tre posti e sono la stessa materia:
> «Resta aperto» del [piano della Fase 4](../archive/2026-10-09-fase-4-gateway.md) e le due cose
> non attuate del seme
> [identità del pannello e token ripetibile](../archive/2026-10-10-identita-del-pannello-e-token-ripetibile.md),
> andati in archivio quel giorno. Tutte e tre chiedono **che cos'è un pannello per il server**:
> un oggetto che si conta, che si fattura, o che qualcuno possiede.
>
> **La sessione di plan si è tenuta il 21-10-2026**, lo stesso giorno: due domande su tre hanno
> avuto risposta e sono state attuate. La terza — quando si consuma e quando si libera una
> licenza — è rimasta aperta per scelta, ed è nel seme
> [quando si libera una licenza](../plans/2026-10-21-quando-si-libera-una-licenza.md). L'esito è
> in fondo a questo file.

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

## Esito della sessione di plan (21-10-2026)

Tre decisioni del maintainer, e due cose misurate che il seme non sapeva.

**Quello che il seme non sapeva.** `prepara()` rifiutava la rivendicazione di un pannello di
un'altra azienda solo se il pannello era **attivo**: se era **sospeso**, passava. Il primo che
avesse avuto il codice se lo sarebbe portato via, azienda compresa. Sospendere un pannello per
manutenzione voleva dire, di fatto, metterlo in vendita — e quello era anche l'unico modo di
spostarlo, perché la strada che il messaggio d'errore prometteva («lo può spostare solo chi
amministra la piattaforma») **non esisteva**: la piattaforma poteva solo elencare, rinominare e
cambiare stato.

**1. Il numero di pannelli serve a vedere, non a fermare.** La console mostra, su ogni azienda,
quanti pannelli ha abbinati e quanti sono accesi adesso, accanto ai progetti aperti. Il
`max_pannelli` concordato compare accanto al numero ed è dichiarato come nota: non rifiuta
nessun abbinamento. Il dato esisteva già nel file del gateway dall'11-10 e non lo leggeva
nessuno.

**2. Un pannello non cambia azienda facendosi rivendicare.** Il controllo guarda l'azienda in
qualunque stato il pannello sia. Sospeso torna a voler dire «fermo» e non «disponibile».

**3. Lo sposta la piattaforma, dalla console.** `POST /api/amministrazione/pannelli/:nome/azienda`,
riservata all'amministratore di piattaforma, con l'audit, e un menù nella pagina *Pannelli*.
L'azienda di destinazione deve esistere — un segmento sbagliato renderebbe il pannello
irraggiungibile da chiunque, senza un errore. Lo spostamento **stacca il tunnel**: il pannello si
ricollega da sé in pochi secondi, ma gli stream aperti in quel momento erano stati autorizzati
per l'azienda di prima.

**Quello che resta aperto, per scelta.** Quando una licenza si consuma e quando si libera: finché
non è deciso, `max_pannelli` non può diventare una quota vera, perché un tetto che nessuno
libera è un tetto che prima o poi blocca un cliente che non ha fatto niente di male. Seme:
[quando si libera una licenza](../plans/2026-10-21-quando-si-libera-una-licenza.md).

Attuato nel ramo `feat/pannelli-conteggio-e-spostamento`.
