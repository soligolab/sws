# Cosa ci dice il numero di pannelli di un'azienda — seme

> Estratto il 21-10-2026 da «Resta aperto» del [piano della Fase 4](../archive/2026-10-09-fase-4-gateway.md),
> andato in archivio lo stesso giorno a lavoro finito. È l'unica domanda di quel piano che non
> ha ancora una risposta, e un piano in archivio non è il posto dove tenerla.
>
> **Quando questo lavoro comincia, il primo passo è una sessione di plan approfondita** per
> decidere ogni dettaglio: qui c'è la domanda e le misure di allora, non un progetto.

## La domanda

Il maintainer, il 09-10-2026: «può essere un dato statistico utile, non una quota, ma dobbiamo
analizzare con un dettaglio maggiore cosa ci dice questa informazione».

Il numero di pannelli abbinati a un'azienda non è un numero solo. Può voler dire quanti
dispositivi un cliente ha in campo (un dato commerciale), quanti ne tiene accesi adesso (un dato
operativo), o quante scatole ha comprato (un dato di licenza) — e le tre cose divergono appena
qualcuno riformatta un pannello, ne mette uno a magazzino o ne abbina uno di prova.

## Cosa era misurato il 09-10-2026

- La colonna `max_pannelli` **esiste** nel database delle aziende e nella console, e **non viene
  applicata da nessuna parte**. Decisione di quel giorno: «fino ad allora la colonna non si tocca
  e la console non la mostra», ed è ancora così.
- I progetti aperti sì che hanno un tetto, ed è applicato dal gateway: è un limite su ciò che
  gira, non un conteggio in un database (Fase 3c, poi ramo 1 della chiusura dei residui).
- L'identità di un pannello è il seriale del device-tree, quindi **sopravvive a un reset di
  fabbrica**: contare le scatole è possibile, contare i token no (seme
  [identità del pannello](2026-10-10-identita-del-pannello-e-token-ripetibile.md), che tiene
  aperta la parte licenze).

## Domande per la sessione di plan

- Il numero serve a vedere (statistica), a fatturare (licenza) o a fermare (quota)?
- Se è licenza: cosa conta, la scatola o l'abbinamento attivo? E chi libera un posto quando un
  pannello viene dismesso?
- Va deciso insieme alla parte licenze del seme sull'identità del pannello, o prima?
