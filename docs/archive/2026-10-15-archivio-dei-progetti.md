# Seme — archiviare un progetto

> **Seme — decisione.** Idea del maintainer, 15-10-2026, guardando gli avvisi di un progetto dimostrativo vecchio
> («quello era un demo che è tutto sbagliato, vedrò di archiviarlo… devo ricordarmi di implementare la funzione di
> archivio ma va studiata bene»).
>
> **Quando questo lavoro inizia, il primo passo è una sessione di plan approfondita per definirne tutti i dettagli.**

## L'idea

Un progetto che non serve più ma non si vuole perdere: sparisce dall'elenco, non conta nelle quote, non si apre per
sbaglio, e si può riprendere quando serve. Oggi le scelte sono solo tenerlo fra quelli attivi o cancellarlo.

## Misurato oggi (main `443913f0`)

- Ciclo di vita dei progetti: creare, aprire, chiudere, rinominare, duplicare, cancellare, caricare uno ZIP
  (`/api/projects…` in `sws-web/src/router.rs`); l'esportazione è un pacchetto di file scelti; i backup sono
  istantanee di un elenco chiuso di file (`backups.rs`). Nessuno stato «archiviato».
- Nel cloud un progetto aperto occupa un container e conta nel tetto dei progetti aperti dell'azienda
  (`gateway/progetti.rs`); uno chiuso occupa solo disco.
- I progetti hanno spesso un repository git (`git_deploy.rs`): l'archivio potrebbe appoggiarsi a un tag o a un
  ramo, o essere indipendente.

## Domande per la sessione di plan

- Dove sta un progetto archiviato: stessa cartella con un segno, cartella `archivio/`, uno ZIP compresso?
- Cosa resta consultabile (pagine in sola lettura, storico, audit) e cosa no.
- Chi può archiviare e ripristinare; cosa finisce nell'audit; quote del cloud.
- Rapporto col CRA (conservazione dei dati) e col reset di fabbrica (C5 del
  [piano d'azione](2026-10-15-piano-prima-fascia-e-cra.md)).

## 18-10-2026 — fatto (gruppo 4 del programma delle funzioni utente), da collaudare

Decisione del maintainer: resta al suo posto con un segno, nascosto e non apribile, **contato nella quota di spazio**.
`archivio.rs`, rotte Admin archive/unarchive, sezione «Archiviati» nella schermata dei progetti; manuale, capitolo 04.
