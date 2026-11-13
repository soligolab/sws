# Abbinare un pannello dall'account, senza aprire un progetto

**Seme, nato il 12-11-2026.** Osservazione del maintainer: «per aggiungere il dispositivo ora l'unico modo è
creare un progetto vuoto e connetterlo da là, non è urgente ma potrebbe essere utile un sistema di
abbinamento all'interno delle impostazioni dell'account utente».

**Quando questo lavoro comincia, il primo passo è una sessione di plan dedicata per sviscerarne i dettagli.**

## Com'è oggi (12-11-2026)

- «Abbina un pannello» esiste solo nell'IDE nel cloud, **dentro un progetto aperto**: Configurazione →
  Istanza → Device → Connessione (`sws-editor/src/config/schede/AbbinaPannelloCloud.tsx`, piano archiviato
  `docs/archive/2026-10-11-abbinamento-e-primo-accesso.md`, fette D ed E).
- Il pannello abbinato **entra nell'azienda di quel progetto** e riceve il suo nome nel tunnel. Il progetto
  serve oggi solo a dire quale azienda: gli utenti il pannello li riceve dopo, col primo deploy.
- Il testo dopo l'installazione lo dice apertamente (`installCloudDopo` in `i18n/it.json`): «torna qui, apri
  un progetto e usa "Abbina un pannello"».

## L'idea

Un posto nelle impostazioni dell'account (o dell'azienda) dove inserire il codice, scegliere l'azienda se
l'utente ne ha più d'una, e dare il nome al pannello. Il progetto si sceglie dopo, col deploy.

Si lega al seme [QR del codice di abbinamento](2026-11-12-qr-del-codice-di-abbinamento.md): il link nel QR
avrebbe qui la sua destinazione naturale, perché chi inquadra il QR col telefono non ha un progetto aperto.

## Da decidere nella sessione di plan

- Account o azienda: chi può abbinare un pannello a un'azienda (ruoli dell'azienda).
- Cosa si mostra dopo l'abbinamento: l'elenco dei pannelli dell'azienda c'è già da qualche parte, o nasce qui?
- Se la scheda dentro il progetto resta, o diventa un rimando a questa.
