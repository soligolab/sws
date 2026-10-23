# Il journal del pannello saturato dai messaggi di aggiornamento

> **Referto, 22-10-2026.** Segnalato dal maintainer con uno screenshot del
> `user@wp630-a-p3-07a077.local`: «il journal è spammato dai messaggi di aggiornamento che
> saturano il journal». Rimandato da lui a lavoro finito sugli altri task, e ripreso qui.

## Cosa stava succedendo davvero

Non erano «i messaggi di aggiornamento» nel senso di righe scritte dal runtime. Era **podman**.

Ogni evento che podman manda al journal porta dentro **tutte le etichette del container**. Il
controllo di salute ne produce **due** ogni 30 secondi — `container health_status` e
`container exec_died` — e l'immagine di SWS porta **5 872 byte di etichette**, perché le Novità di
ogni versione viaggiano lì dentro (è la regola «si tagga quando si costruisce»: le voci di
`NOVITA.yaml` diventano etichette OCI).

Le tre grosse, pesate una per una sulla 2.17.0:

| Etichetta | Byte |
|---|---|
| `net.soligo.sws.changelog` | 1 611 |
| `net.soligo.sws.novita.it` | 1 611 |
| `net.soligo.sws.novita.en` | 1 495 |
| tutte le altre insieme | ~1 155 |

E il 31 % di quel carico è **pura duplicazione**: `changelog` è byte per byte uguale a
`novita.it`, e `compat` a `compat.it`. Esistono apposta — i runtime da rc.3 a rc.8 leggono solo le
vecchie — ma oggi pagano doppio in ogni evento.

## La misura, fatta e non calcolata

Ricostruita un'immagine alpine con **le etichette identiche alla 2.17.0** (5 872 byte in
entrambe), due finestre da 153 secondi a confronto:

| | cicli | byte di journal | per ciclo |
|---|---|---|---|
| etichette piene | 25 | 741 595 | 29 664 |
| etichette azzerate | 26 | 224 955 | 8 652 |

**Il 71 % in meno.** A 30 secondi e due container fa circa 171 MB/giorno letti indietro contro
50, e su disco — dove journald comprime — l'ordine di grandezza passa da ~40 a ~12 MB al giorno.

Un conto che va detto giusto, perché la prima versione di questa misura lo diceva male: journald
**deduplica i valori dei campi**, quindi `PODMAN_LABELS` si paga una volta sola per file. Quello
che si paga a ogni evento è il `MESSAGE`, dove podman mette le etichette in chiaro **e** antepone
il proprio timestamp: ogni `MESSAGE` è un valore nuovo, e nessuna deduplicazione lo tocca.

E «saturato» non vuol dire disco pieno: journald ha i suoi limiti predefiniti e si pota da solo.
Vuol dire che **la storia utile viene sfrattata** — che è il motivo per cui il maintainer non
riusciva più a leggerci altro.

## Cosa è stato fatto

**1. Le etichette di contenuto non entrano più nei container.** Sei righe `Label=nome=` nei tre
quadlet (runtime e viewer del pannello, gateway del VPS) e nello spec dei container di progetto
che il gateway crea da Rust.

Non toglie niente a nessuno: il controllo degli aggiornamenti legge le etichette **dal registry**,
dal config blob del manifest, non dal container che gira — e in tutto il codice Rust non c'è una
sola lettura di `podman inspect`. Le Novità restano dove sono sempre state: dentro l'immagine.

Si svuotano **per nome e mai con un carattere jolly**: `net.soligo.sws.progetto` vive nello stesso
spazio di nomi ed è l'unica etichetta che si legge davvero da un container — è così che il gateway
ritrova i progetti dopo un riavvio.

**2. Il viewer non ha più un controllo di salute**, e non è solo rumore in meno. Quello ereditato
dall'immagine misurava **la cosa sbagliata**: con `Network=host` il suo
`curl http://localhost:7443/health` finisce sul *runtime*. Diceva come sta il runtime sotto il nome
del viewer, e del viewer non diceva niente. E nessuno lo leggeva: quella unit non ha `Notify=` né
`HealthOnFailure=`, e riparte comunque con `Restart=always`. Costava metà del rumore.

Quello del **runtime** resta, ed è giusto: sopra ci sta `Notify=healthy`, cioè il ritorno
automatico a una versione che non diventa sana.

## Cosa NON è stato fatto, e perché

**Allungare l'intervallo del controllo di salute da 30 s a 120 s.** Era la mossa che la prima
analisi dava come «la più sicura, da mettere nella build comunque». È il contrario: è quella che
può **rompere gli aggiornamenti**.

Misurato su podman 4.3.1: il primo controllo parte ~120 ms dopo l'avvio, non dopo un intervallo;
il runtime risponde su `/health` dopo circa un secondo, quindi quel primo controllo **fallisce
sempre**; e il successivo arriva un intervallo intero dopo, perché il timer transitorio è
`OnUnitInactiveSec`. Con `Notify=healthy` l'unit risulta avviata solo allora. A 120 secondi, contro
i 90 di `TimeoutStartSec` predefinito, l'avvio va in timeout e `podman auto-update` torna indietro
da solo — a ogni aggiornamento.

La strada pulita esiste e sta in podman 5: `--health-startup-cmd` / `--health-startup-interval`,
cioè un primo controllo rapido e una cadenza lenta. Non è stata presa qui perché l'azzeramento
delle etichette copre il 71 % senza toccare niente di quel meccanismo.

## Verifica

| Prova | Come |
|---|---|
| `--label chiave=` svuota il valore di un'etichetta **ereditata dall'immagine**, e non tocca le vicine | provato a mano su podman 4.3.1, immagine usa e getta: `{"...altro":"questa deve restare","...novita.it":""}` |
| `--health-cmd=none` disattiva l'`HEALTHCHECK` dell'immagine | provato a mano: `Healthcheck.Test` diventa `["NONE"]` |
| I quattro posti dicono la stessa cosa, e `net.soligo.sws.progetto` non è fra quelli azzerati | `scripts/check_etichette_container.sh`, statica, provata rossa togliendo una riga da un quadlet |

**Quello che resta da confermare su un pannello vero**: che la chiave di quadlet `Label=nome=`
diventi `--label nome=`. Questa macchina ha podman 4.3.1 e il generatore quadlet nasce con 4.4, qui
non c'è. La prova vale al livello di `podman run`, che è dove il flag arriva; il passaggio
quadlet → flag non lo deduco. Se non funzionasse, il journal resterebbe com'è: nessun servizio si
ferma.

`HealthCmd=` nasce invece con podman 4.5, e l'installer la commenta sotto la 5 come fa già con
`Notify=healthy` e `Timezone=local`.

## Quello che è rimasto fuori

- **Le etichette duplicate nell'immagine** (`changelog` = `novita.it`, `compat` = `compat.it`):
  1 767 byte su 5 710 sono la stessa cosa scritta due volte. Toglierle alleggerirebbe l'immagine e
  il registry, ma rompe il ripiego per i runtime da rc.3 a rc.8. Da decidere quando quelle versioni
  non esistono più da nessuna parte.
- **Il viewer che interroga lo storico ogni 2 secondi** e, se la lettura fallisce, scrive una riga
  a ogni giro **senza attenuazione** (`sws-lvgl-viewer/src/client.rs`, intorno a riga 1034). Un solo
  widget trend guasto fa 43 200 righe al giorno. Non è il difetto segnalato, ma è lo stesso genere,
  e i WebSocket lì accanto l'attenuazione ce l'hanno già.

Tutti e due in `docs/plans/Appunti.txt`.
