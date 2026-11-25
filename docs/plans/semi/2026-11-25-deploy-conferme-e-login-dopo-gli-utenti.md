# Le conferme di un deploy, e il login dopo che gli utenti cambiano (seme, 25-11-2026)

> **Seme — decisione.** Quando questo lavoro comincia, **il primo passo è una sessione di plan dedicata e
> approfondita** che ne sviscera tutti i dettagli. Quello che segue è l'idea e le misure di oggi.

## L'idea

Collaudo della 2.27.0-dev.3 sul PLX800 (25-11-2026), deploy dall'IDE del cloud di un progetto verticale con
«Sostituisci anche gli utenti».

1. **Tre conferme di fila** per un solo deploy: gli utenti sostituiti, il progetto `test` cancellato col suo storico,
   la rotazione con il riavvio. La prima finestra ha uno stile diverso (pulsante arancione, niente bordo rosso); le
   altre due hanno il bordo rosso. Tre domande in sequenza si leggono male, e la terza (quella che riavvia) arriva
   quando l'attenzione è già calata.
2. **Due login falliti dal cloud** subito dopo il deploy (registro del pannello, righe 45-55 del 25-11): l'IDE riprova
   il login con la password vecchia del pannello, che il deploy ha appena sostituito con quella del progetto. Ogni
   tentativo conta nel blocco (5 errori → 60 s, `SWS_LOGIN_RATE_*` in `sws-runtime/src/main.rs`). Il maintainer ha poi
   provato a mano ed è arrivato al 429 «Too Many Requests» senza capire perché.

## Le misure di oggi

- Le conferme del deploy: `sws-editor/src/store/conferme428.ts` (le 428 del pannello, una alla volta) e la conferma
  sugli utenti nell'IDE prima del deploy (`cfg.deployReplaceUsers…` in `i18n/it.json`).
- Il blocco del login: `sws-auth/src/lib.rs`, `record_failure` e `check_lockout`; ogni tentativo durante il blocco lo
  allunga di 60 s.

## Le domande

- Le domande di un deploy si raccolgono in una finestra sola, con un elenco di cosa succederà, e un solo «Procedi»?
  Oppure restano separate ma con lo stesso stile, e la rotazione per prima?
- Dopo un deploy che sostituisce gli utenti, l'IDE deve smettere di riprovare il login con la password vecchia, e
  chiedere la nuova al primo 401, prima di consumare i tentativi?
