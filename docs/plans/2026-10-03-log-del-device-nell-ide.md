# Il log del dispositivo collegato, dentro il log dell'IDE

> **Seme — decisione** (03-10-2026). Richiesta del maintainer durante il collaudo dell'aggiornamento con ritorno:
> «quando sono connesso nel log devo poter vedere anche il device con un tag apposito».
>
> **Quando questo lavoro comincia, il primo passo è una sessione di plan approfondita, dedicata, per sviscerarne
> tutti i dettagli.** Quello che segue è l'idea e le misure di oggi, non un progetto.

## L'idea

Con l'IDE collegato a un pannello (Istanza → Device → Connessione), il log dell'IDE mostra anche le righe del runtime
del pannello, marcate con un'etichetta del dispositivo (nome o host), così che un passaggio che attraversa i due —
un deploy, un aggiornamento, un'istantanea — si legga in un posto solo e in ordine.

## Misurato il 03-10-2026

- Il maintainer ha esportato il log dell'IDE (`sws-logs-2026-10-03.jsonl`, 177 righe) cercando la riga
  dell'istantanea presa prima del deploy rc.17 → rc.18: **non c'era**. L'istantanea la prende il runtime del pannello
  (`istantanea_dati.rs`, log `sws_web::istantanea_dati` nel journal del pannello), e la pagina dell'IDE la scrive solo
  nel riquadro del deploy a schermo. Per trovarla è servito l'SSH.
- Nello stesso log mancava anche il fallimento finale del deploy (`Job for sws-runtime.service failed because a
  timeout was exceeded`), che c'era invece nel log del processo dell'editor: il file esportato era stato preso prima
  della fine. Da capire se l'esportazione dice fin dove arriva.
- L'IDE ha già un canale verso il pannello collegato (`remote.rs`, proxy `/api/remote/*`, `remote_relay` per il
  WebSocket) e il runtime ha già un bus dei log (`log_bus`, `log_file.rs`, file `runtime-<data>.jsonl`).

## Domande per la sessione di plan

1. Flusso dal vivo (WebSocket dal pannello) o lettura dei file `runtime-*.jsonl` del pannello su richiesta?
2. Quali righe: tutte, o solo da un livello in su / da certi target (`deploy`, `aggiornamento`, `istantanea_dati`,
   `conferma_aggiornamento`)?
3. L'etichetta: nome dell'istanza, host, o il nome del dispositivo registrato nell'IDE?
4. Le righe del pannello finiscono anche nell'esportazione del log dell'IDE?
5. Con utenti sul pannello: con quale ruolo si leggono i suoi log?
