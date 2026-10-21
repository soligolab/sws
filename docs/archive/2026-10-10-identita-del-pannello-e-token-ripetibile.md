# Il token del pannello: unico, ma ripetibile

> **Seme — decisione.** Quando questo lavoro comincerà, la prima cosa è una **sessione di plan
> approfondita** per sviscerarne tutti i dettagli. Qui c'è l'idea, quello che si è misurato il
> 10-10-2026, e la trappola da non ripetere.

## L'idea del maintainer (10-10-2026)

> «il token dovrebbe essere unico ma ripetibile, in qualche modo legato all'hw»
>
> e poi, precisando: «vorrei poter reinserire il dispositivo nel server, quindi che venga
> **riconosciuto come quello prima del reset**, così oltretutto in futuro posso prevedere dei
> meccanismi di licenza o di ban»

**La precisazione cambia il centro della questione.** Non si tratta di poter riscrivere lo stesso
token: si tratta che **il pannello è un'entità del server**, con una sua storia, e che una
scatola riformattata è la *stessa* scatola. Il token è solo il modo di dimostrarlo.

Da qui discendono cose che un token non avrebbe mai portato con sé:

- **Licenze.** Se il pannello è un'entità, si può contare quanti ne ha un cliente, e dire di no al
  prossimo. Contare i token non servirebbe: basterebbe cancellarne uno e riaverlo.
- **Ban.** Si può rifiutare *quella scatola*, e il rifiuto deve sopravvivere a una
  riformattazione — altrimenti il ban dura quanto ci mette qualcuno a reinstallare il pannello.
- **Storia.** Quando è stato abbinato, a quale azienda, quali progetti ci sono passati. Oggi non
  esiste niente del genere.

Il caso che lo rende concreto: un pannello si guasta, si reinstalla, si riformatta. Oggi
tornerebbe come un pannello **nuovo** — nome nuovo, token nuovo, riga nuova sul gateway — e quello
vecchio resterebbe lì a far finta di esistere. Dopo qualche anno di assistenza il gateway sarebbe
pieno di fantasmi, e nessuno saprebbe più quale riga corrisponde a quale scatola appesa al muro.
Con licenze e ban nel quadro, un fantasma non è disordine: è una licenza consumata per niente e un
ban che non morde.

## La trappola, da dire prima di tutto

**Un token derivato dall'hardware e basta è un token che chiunque può calcolare.** Il numero di
serie di un pannello sta sull'etichetta, lo legge il manutentore, il cliente, chi passa di lì. Se
`token = f(seriale)` con `f` nota, allora chiunque conosca il seriale può presentarsi al gateway al
posto di quel pannello — e un pannello governa un impianto.

La forma giusta è una sola: **`token = HMAC(segreto del gateway, identità hardware)`**.

- **Ripetibile**: il gateway lo ricalcola quando vuole, quindi dopo una reinstallazione si rilegge
  lo stesso identico token e lo si rimette nel pannello. È esattamente quello che chiede il
  maintainer.
- **Non indovinabile**: senza il segreto del gateway, dal seriale non si ricava niente.
- **Niente da custodire per pannello**: il gateway non memorizza nessun token. `pannelli.yaml` (o
  quello che lo sostituirà) tiene *identità hardware → azienda*, e il segreto è uno solo per
  installazione — quello che esiste già, `segreto_persistente` in `gateway/mod.rs`.

**Conseguenza da scrivere a chiare lettere**: se quel segreto cambia, cambiano tutti i token di
tutti i pannelli insieme. Va trattato come il materiale più prezioso della macchina, e il
ripristino del VPS deve portarselo dietro.

**Seconda conseguenza, meno ovvia**: «ripetibile senza che nessuno faccia niente» vorrebbe dire
che un pannello riformattato rientra da solo — e allora anche un impostore che conosce il seriale
rientra da solo, perché dall'esterno le due cose sono **identiche**. Il passo umano non è un
fastidio da togliere: è ciò che distingue una reinstallazione da un furto d'identità. Il
maintainer lo dà già per scontato («vorrei poterlo *inserire* nel server»).

## Quello che non si sa ancora: cos'è l'identità hardware

Serve un identificatore che:

1. **sopravviva a una riformattazione** — e questo esclude `/etc/machine-id`, che si rigenera al
   primo avvio dopo una reinstallazione del sistema;
2. sia **unico** fra i pannelli;
3. si legga **da dentro un container**, perché il runtime gira lì.

I candidati, da misurare su un pannello vero e non da dedurre:

| candidato | dubbio |
|---|---|
| numero di serie Pixsys | dove si legge? c'è un file, una chiamata al launcher sul bus, o sta solo sull'etichetta? |
| MAC della prima interfaccia | stabile, ma un pannello con due interfacce quale usa? e una USB-Ethernet cambia tutto |
| CID della eMMC (`/sys/block/mmcblk*/device/cid`) | legato al chip, non si riformatta via — ma si legge da dentro il container? |
| seriale della CPU (`/proc/cpuinfo`, campo `Serial`) | sugli i.MX c'è, sui Rockchip spesso è zero |

Comando per guardarli tutti insieme su un pannello:

```sh
echo "machine-id: $(cat /etc/machine-id 2>/dev/null)"
echo "mac:        $(cat /sys/class/net/*/address 2>/dev/null | tr '\n' ' ')"
echo "emmc cid:   $(cat /sys/block/mmcblk*/device/cid 2>/dev/null | tr '\n' ' ')"
echo "cpu serial: $(grep -i '^serial' /proc/cpuinfo 2>/dev/null)"
ls /sys/firmware/devicetree/base/serial-number 2>/dev/null && \
  tr -d '\0' < /sys/firmware/devicetree/base/serial-number && echo
```

## Cosa diventa il «pannello» sul gateway

Se il pannello è un'entità con una storia, allora **non è più una riga in un file di
configurazione**: è una riga nell'archivio delle identità, accanto a utenti e aziende, con almeno

| | |
|---|---|
| identità hardware | la chiave, e quella che un reset non cambia |
| azienda | chi può parlargli (c'è già, nella fetta 1 sta nel file) |
| stato | attivo, sospeso, **bandito** — e il bandito vince su tutto, token giusto compreso |
| storia | primo abbinamento, ultima connessione, a cosa è servito |

**Il ban deve stare prima del token nel controllo d'ingresso**, non dopo: se il gateway
verificasse prima il token, una scatola bandita con un token ancora valido entrerebbe. E il ban
riguarda l'hardware, non le credenziali — è l'unica forma che sopravvive a una riformattazione.

Il conto delle licenze è un conto su questa tabella, non sul numero di token distribuiti: un token
si cancella e si rifà, una scatola no.

## Come si lega all'abbinamento (fetta 2 del tunnel)

Le due cose sono lo stesso lavoro e vanno disegnate insieme:

- il pannello mostra un **codice** sullo schermo (decisioni 12 e 14) e nella sua pagina locale;
- chi amministra l'azienda lo rivendica dalla console;
- il gateway lega **identità hardware → azienda**, e il token lo deriva.

Dopo una reinstallazione il pannello mostra lo stesso codice (se il codice stesso è derivato
dall'hardware), chi amministra lo rivendica di nuovo, e il gateway riconosce che quell'hardware
era già suo: stessa riga, nessun fantasma.

## Le domande che la sessione di plan dovrà sciogliere

1. **Cos'è l'identità hardware** su un pannello Pixsys (tabella sopra: da misurare, non dedurre).
2. **Cosa succede quando l'hardware non si lascia identificare**: un pannello su cui nessuno dei
   candidati risponde esiste, e rifiutarlo vorrebbe dire non vendergli niente. Serve un ripiego, e
   serve sapere cosa si perde usandolo.
3. **Chi rivendica una scatola già rivendicata.** Se il pannello di un cliente finisce da un
   altro, qualcuno deve poter dire «è mio adesso» — e qualcun altro deve poter dire di no. Senza
   una risposta, la prima azienda che abbina un pannello se lo tiene per sempre.
4. **Il passo umano dopo una riformattazione.** «Riconosciuto da solo» e «chiunque conosca il
   seriale può prenderne il posto» sono la stessa cosa vista da due lati: il gesto umano è ciò che
   le distingue. Quale gesto, e quanto deve essere scomodo.
5. **Dove vive il segreto di installazione** e come si salva: cambiarlo invalida tutti i token
   insieme.

## Stato al 10-10-2026

Oggi i pannelli si dichiarano a mano in `<config del gateway>/pannelli.yaml`, nome e token scelti
da chi scrive il file (fetta 1 del [tunnel](2026-10-09-fase-6-tunnel-dei-pannelli.md)). Funziona e
basta a far passare un deploy, ma il nome non è legato a niente di fisico: è la cosa che questo
seme sistema.

## Misurato sul TC620 appena resettato — 10-10-2026, sera (a casa)

Factory reset alle 17:50, misura alle 18:37 (acceso da 44 minuti, nessun container, `/data/user` con soli
`browser` e `fonts`), **prima** dell'installazione di SWS. In sola lettura, via SSH come `user`.

| Candidato | Valore | Dopo il reset |
|---|---|---|
| seriale nel device-tree (`/sys/firmware/devicetree/base/serial-number`) | `P052600C00292600014` | sta nel firmware: **resta**. È il seriale di fabbrica Pixsys (modello `TC620-A-P3-C6`), lo stesso che la sorgente Host legge come `numero_serie` |
| MAC `ethernet0` / `ethernet1` | `7c:6c:39:07:af:f9` / `7c:6c:39:07:af:fa` | dall'hardware: **resta**. È anche il suffisso dell'hostname (`tc620-a-p3-c6-07aff9`) |
| CID eMMC (`/sys/block/mmcblk0/device/cid`) | `150100414a54443452033cdcee211500` (serial `0x3cdcee21`) | il chip: **resta**, cambia solo sostituendo la memoria |
| chiavi host SSH | ED25519 `SHA256:NsUahWctLshURXeRGhIRgRlnxRs1AiS1lNt3H7oH77s` | **la stessa di prima del reset** (nessun avviso di `known_hosts`), benché i file portino l'ora del reset (17:50): Pixsys le conserva o le rigenera uguali |
| `machine-id` | `748b5be4d1fb4c159ba60a48892d6bce` | **riscritto al reset** (17:50); se sia uguale a prima non si sa — non era mai stato misurato. Da rimisurare al prossimo reset prima di usarlo |
| seriale CPU (`/proc/cpuinfo`) | vuoto | non disponibile (RK3399) |

**Lettura**: i candidati robusti sono il seriale del device-tree (leggibile da una persona, stampato sull'etichetta
Pixsys?), il MAC e il CID della eMMC; il primo da solo non è un segreto (chi ha il pannello davanti lo legge), quindi
come identità va abbinato a qualcosa che il pannello prova di possedere (la chiave del token). Da decidere nella
sessione di plan, non qui.

