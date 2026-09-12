# Q31 — Verificare dal vivo la chat con un runtime remoto collegato

> Trasferito da `docs/OPEN_QUESTIONS.md` (Q31) il 2026-09-12, aperta il 2026-09-01. Non un
> piano di codice: il codice è già scritto e verificato **a lettura**, manca solo la conferma
> a schermo con un runtime remoto vero.

## Cosa è già risolto, verificato nel codice

- Il socket della chat (`/ws/ai`) resta locale: `buildWsUrl` dirotta sul relay solo `tags`,
  `alarms`, `logs` (`sws-editor/src/ws/wsUrl.ts`), e un commento accanto al `matches!` del
  relay (`sws-web/src/remote_relay.rs`) spiega perché `ai` non va aggiunto.
- Il pannello lo dice: `ChatPanel.tsx:196` mostra un avviso quando `remoteConnected`.
- La premessa temuta era sbagliata: con un runtime remoto collegato, l'utente modifica sempre
  il progetto **locale** (`remote_deploy` ne manda una copia al device); l'assistente che legge
  il locale legge quindi il progetto giusto, non uno abbandonato.

## Cosa manca

**Nessuna riga di questo è stata provata dal vivo** con un runtime remoto vero — solo verificata
leggendo il codice. Da fare quando capita un momento con un dispositivo (o una seconda istanza
locale) collegato come remoto:

1. Collegare l'editor a un runtime remoto (`ConfigView → Runtime → Connetti`).
2. Aprire la chat: verificare che l'avviso «stai lavorando sul progetto locale» compaia.
3. Fare una richiesta che tocchi il progetto, verificare che la proposta rifletta il progetto
   locale (non quello del dispositivo remoto).
4. Controllare che il socket della chat non passi dal relay (nessun errore 404, nessuna
   riconnessione perpetua).

## Domanda collegata, non decisa

Se un giorno servisse un assistente che *guarda* il dispositivo (i suoi tag dal vivo, il suo
storico, i suoi log) — diverso da questo, che lavora sul progetto — è un secondo insieme di
strumenti, discusso in `docs/archive/2026-08-31-chat-ai-nelleditor.md`. Non affrontarlo qui.

## Esito

Una volta fatta la prova a schermo, chiudere Q31 in `docs/OPEN_QUESTIONS.md` (spostarla
nell'archivio chiuse) — è il maintainer a farlo, non questa sessione.
