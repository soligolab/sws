# Il codice di abbinamento di un pannello abbinato al cloud e senza utenti (seme, 25-11-2026)

> **Seme — decisione.** Quando questo lavoro comincia, **il primo passo è una sessione di plan dedicata e
> approfondita** che ne sviscera tutti i dettagli. Quello che segue è l'idea e le misure di oggi.

## L'idea

Collaudo della 2.27.0-dev.3 sul PLX800 (25-11-2026). Dopo «Eliminare solo il progetto, restando nel cloud» il pannello
resta abbinato al cloud e torna senza utenti. All'avvio il log diceva «pannello in attesa di abbinamento […] Codice di
abbinamento: M3Z4-…», mentre il tunnel si apriva come «abbinato». Tre punti del codice dicono tre cose diverse sullo
stesso stato.

## Le misure di oggi

- **Il log all'avvio** (`sws-runtime/src/main.rs`, «Il codice di abbinamento»): con l'accesso `InAttesa` mostra il
  codice se c'è, e solo altrimenti il messaggio «paired to the cloud and without users». Il file `abbinamento.json`
  ha sempre un codice (monouso: usato, se ne genera un altro), quindi il ramo del cloud non si raggiunge mai.
  **Corretto il 25-11-2026 sul ramo `fix/dev3-collaudo`**: il messaggio del cloud viene prima, e il codice non si
  stampa.
- **La pagina di stato** (`abbinamento.rs`, `stato`, `GET /api/abbinamento`): per un pannello abbinato al cloud il
  codice non si mostra («Il codice non c'è più»).
- **La rivendicazione** (`abbinamento.rs`, `rivendica`, `POST /api/abbinamento/rivendica`): rifiuta solo se il pannello
  ha utenti. Un pannello abbinato al cloud e senza utenti accetta il codice valido del file e crea un Admin del
  dispositivo. Il codice non si vede più da nessuna parte (dopo la correzione del log), ma è valido.
- Dal 24-11-2026 (decisione B1) l'abbinamento dal cloud crea anche un Admin del dispositivo. Il reset che tiene il cloud
  lo toglie (`control_panel/reset.rs`, `CONFIG_GOES` comprende `utenti_dispositivo.yaml`).

## La domanda

Un pannello abbinato al cloud e senza utenti deve poter creare un Admin del dispositivo dalla rete locale, col codice?
- **Sì**: allora il codice si mostra sullo schermo come per un pannello nuovo (possesso fisico, decisione D16), e la
  pagina di stato lo dice.
- **No**: allora `rivendica` rifiuta anche in questo stato, e l'Admin del dispositivo si crea solo dal cloud (come B1).
- In tutti e due i casi: il reset che tiene il cloud deve togliere l'Admin del dispositivo creato da B1?
