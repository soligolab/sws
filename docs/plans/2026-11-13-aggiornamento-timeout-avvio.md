# L'aggiornamento che torna indietro sui pannelli lenti — quadlet 8

> Nato il 13-11-2026 dalla richiesta del maintainer «prova a capire perché il TC620 non si aggiorna».
> Ramo `fix/aggiornamento-timeout-avvio`, annidato su `feat/tiny-ty-armv7` (scelta del maintainer).

## Cosa succede

Il 12-11-2026 il TC620 (podman 5.0.2, kernel 6.12) ha provato a passare dalla rc.13 alla rc.15 ed è tornato indietro
da solo. Dal journal dell'utente `user`:

| ora | evento |
|---|---|
| 18:48:48 | `podman auto-update` parte; il download dura 93 s, **prima** del riavvio |
| 18:50:23 | systemd avvia `sws-runtime.service`: da qui contano i 90 s (`TimeoutStartUSec=1min 30s`, il predefinito) |
| 18:50:23 → 18:51:26 | **63 s** di podman senza log, poi `container create` |
| 18:51:27 | la rc.15 è in ascolto sulla 7443 (`tls:true`, CasaDomotica aperto): sana in 1 s |
| 18:51:53 | `start operation timed out. Terminating.` → `rolled back` |
| 18:51:59 | la rc.13 crea il container in 0,2 s; *healthy* alle 18:52:30, esattamente 30 s dopo |

Il controllo di salute dell'immagine (`--interval=30s`) passa per la prima volta 30 s dopo l'avvio del container.
63 + 30 = 93 s > 90 s. **Non** è il disco (48 %), né lo storico, né il TLS, né un difetto della rc.15. Con il quadlet 7
ogni aggiornamento del TC620 torna indietro, rc.16 compresa.

I 63 s sono, quasi certamente, la preparazione dei layer di un'immagine mai usata per `UserNS=keep-id`: la stessa
immagine, già usata, riparte in 0,2 s. Non misurato oltre: non serve per la correzione.

**Seconda misura, 12-11-2026 alle 22:16** (rc.13 → rc.16, col drop-in già messo e avviato con
`systemctl --user start podman-auto-update.service`, perché «Aggiorna ora» via API chiedeva un Admin): download 91 s,
preparazione **48 s**, runtime in ascolto dopo 2 s. Il controllo di salute parte **subito** all'avvio del container,
fallisce (la 7443 non ascolta ancora) e il successivo arriva 30 s dopo: unità avviata dopo **80 s**. Riuscito, ma
sarebbe passato anche senza drop-in, con 10 s di margine: la preparazione varia fra 48 e 63 s, e il margine non c'è.
Il TC620 gira la rc.16; il drop-in resta finché non arriva un'immagine col quadlet 8.

## La correzione

- `deploy/container/sws-runtime.container`: `TimeoutStartSec=600` in `[Service]`, quadlet **8** (anche il viewer passa
  a 8: `check_quadlet.sh` vuole lo stesso numero). Il download avviene prima del riavvio, quindi il limite largo non
  ritarda niente quando va bene: allunga solo l'attesa prima di un ritorno indietro vero.
- L'immagine **non cambia** (decisione del maintainer del 13-11): niente controllo di salute più fitto, che
  triplicherebbe gli eventi nel journal (vedi la nota del 22-10 nel quadlet).

## La transizione — una volta, a mano

Il quadlet 8 arriva su un pannello solo **dopo** un aggiornamento riuscito (`quadlet.rs`, «Configurazione del
servizio»), ed è proprio quello che fallisce. Scelta del maintainer: il passo si fa a mano, una volta, sui pannelli
lenti. Sul TC620, come utente `user`, prima di «Aggiorna ora»:

```
mkdir -p ~/.config/systemd/user/sws-runtime.service.d
printf '[Service]\nTimeoutStartSec=600\n' > ~/.config/systemd/user/sws-runtime.service.d/avvio-lento.conf
systemctl --user daemon-reload
```

Dopo l'aggiornamento il pannello chiede di aggiornare la configurazione del servizio (quadlet 8); fatto quello, il
drop-in si può togliere. Un pannello di un cliente sul quadlet 7 e lento come il TC620 avrebbe lo stesso blocco: oggi
non ce ne sono.

## Verifica

1. `check_static.sh` (guardia dei quadlet compresa) verde.
2. TC620: drop-in, «Aggiorna ora» verso la rc che contiene questo ramo, journal in diretta: l'unità deve risultare
   avviata dopo il primo controllo di salute, senza `timed out`, e l'evento «riuscito» sul pannello.
3. Poi «Configurazione del servizio» → Aggiorna: `systemctl --user show sws-runtime -p TimeoutStartUSec` dice `10min`.
