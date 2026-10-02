# Dopo un aggiornamento il pannello può restare senza schermo — seme

> Nato il 01-10-2026 collaudando la rc.15 sul WP630.
>
> **Quando questo lavoro comincerà, il primo passo è una sessione di plan approfondita per
> sviscerarne tutti i dettagli.** Qui ci sono l'idea e ciò che è stato misurato adesso.

## L'idea

Il maintainer aggiorna il pannello dal pulsante «Aggiorna ora». L'aggiornamento riesce, l'esito
compare, tutto come previsto — ma poco dopo **il viewer LVGL non c'è più**: servizio `inactive`,
container inesistente, schermo senza interfaccia. L'ha riacceso una sessione, a mano.

Un pannello che si aggiorna da sé e resta senza schermo è peggio di un pannello che non si
aggiorna: chi sta davanti al vetro non ha modo di accorgersi del perché, e non ha un IDE lì.

## Misurato sul WP630, 01-10-2026

Dal journal dell'utente `user`:

- **17:29:34 → 17:30:12** `podman-auto-update.service` ferma e riavvia **`sws-runtime.service`**, poi
  «Finished». `sws-lvgl-viewer.service` **non compare affatto** nell'operazione.
- **17:55:19** il viewer parte (immagine `rc-arm64` già nuova) e alle **17:55:44** c'è un tocco a
  schermo — coerente col «Chiudi» sull'esito.
- Poco dopo il container non esiste più, e il servizio è `inactive (dead)`.

I due quadlet, letti sul dispositivo:

| | `sws-runtime.container` | `sws-lvgl-viewer.container` |
|---|---|---|
| `AutoUpdate` | `registry` | `registry` |
| `Restart` | **`always`** | **`on-failure`** |
| ordine | — | `After=sws-runtime.service`, senza `Requires=` (voluto: «un viewer che aspetta è meglio di un viewer che non parte») |

Due cose si tengono insieme: `podman auto-update` **non tocca un servizio fermo**, e
`Restart=on-failure` **non fa ripartire un'uscita pulita**. Quale delle due abbia spento il viewer
la prima volta resta da stabilire — il log sopra non lo dice.

## Opzioni visibili

- **`Restart=always` anche per il viewer**, come il runtime: la più semplice, ma arriva solo
  reinstallando — vedi [il quadlet che non viaggia](2026-09-29-quadlet-che-non-viaggia.md), ed è lo
  stesso difetto di fondo.
- **Il runtime se ne occupa via D-Bus**: ha già il bus utente e dalla Fase 4 commuta il display da
  sé (`display_target.rs`). Dopo un riavvio potrebbe verificare che il viewer sia su e, se il
  progetto vuole LVGL, riavviarlo. Niente di nuovo da installare.
- **Un controllo periodico**: il runtime guarda lo stato dell'unit ogni tanto e lo dice nell'IDE
  («lo schermo del pannello non sta mostrando niente»), senza agire.

## Perché conta più di quanto sembri

È il terzo della stessa famiglia: l'aggiornamento riesce, ma qualcosa intorno resta indietro — il
quadlet, il fuso orario, e ora lo schermo. Vale la pena che la sessione di plan guardi i tre
insieme invece di tapparli uno per volta.
