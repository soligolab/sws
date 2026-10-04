# Un catalogo di dispositivi noti

> **Seme — decisione** (04-10-2026). Richiesta del maintainer, durante il piano «bus → dispositivi»: «prevedi già il
> fatto che poi faremo anche un catalogo di dispositivi noti».
>
> **Quando questo lavoro comincia, il primo passo è una sessione di plan approfondita, dedicata, per sviscerarne
> tutti i dettagli.** Quello che segue è l'idea e le misure di oggi, non un progetto.

## L'idea

Aggiungendo un dispositivo a un bus si sceglie un modello noto (un regolatore, un inverter, un contatore di energia)
invece di scrivere a mano la mappa dei registri: il dispositivo arriva con i suoi registri, l'ordine dei byte, il
timeout, e un **tipo** per i suoi dati, così i tag sono subito un'istanza strutturata.

## Misurato il 04-10-2026 (cosa è già pronto)

- Il piano [bus → dispositivi](2026-10-04-bus-e-dispositivi.md) rende il dispositivo Modbus **autosufficiente**
  (`DispositivoModbus`: ordine, timeout, polling, registri, niente sul bus) e gli dà un campo `modello` («da dove
  viene»), scritto oggi solo a mano.
- «Aggiungi dispositivo» passa da `nuovoDispositivo(bus, base?)` (`sws-editor/src/config/sorgenti/modbusDispositivi.ts`):
  il catalogo è la sua seconda strada.
- La Fase 3 Modbus (04-10-2026) legge un'istanza di un tipo **a blocco** dall'indirizzo di partenza: una voce di
  catalogo può essere «un tipo + una mappatura dell'istanza», non una lista di registri sciolti.
- I tipi (`TypeDef`) vivono nel progetto; i template (`examples/templates/`) sono il precedente per contenuti
  distribuiti col prodotto.

## Domande da cui partire

1. Dove vive il catalogo: nel prodotto (come i template), nel progetto, scaricabile, o tutti e tre a livelli?
2. Una voce è sempre «tipo + blocco», o serve anche la mappa a registri sparsi (dispositivi con buchi nella mappa)?
3. Versioni delle voci (`modello: "marca/prodotto@versione"`): cosa succede a un progetto quando la voce cambia?
4. Solo Modbus o anche gli altri protocolli quando avranno i dispositivi (S7, EtherNet/IP)?
5. Chi scrive le voci: il maintainer a mano, un import da file del costruttore, l'assistente AI?
