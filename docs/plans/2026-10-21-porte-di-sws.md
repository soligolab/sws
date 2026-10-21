# Le porte di SWS, e chi gliele porta via — seme

> Nato il 21-10-2026, mentre si guardava il laboratorio di OpenPLC del tutorial
> ([seme OpenPLC sul dispositivo](2026-10-20-openplc-sul-dispositivo.md)). Il maintainer, dopo
> aver visto che l'API REST di OpenPLC v4 ascolta sulla **8443**: rivedere le porte di SWS
> «contestualmente a quel piano».
>
> **Quando questo lavoro comincia, il primo passo è una sessione di plan approfondita** per
> decidere ogni dettaglio: qui ci sono l'idea, le misure di oggi e le strade che si vedono già,
> non un progetto.

## L'idea

Le due porte di SWS sono scelte di tanto tempo fa e non sono nostre: la **8443** è la porta
HTTPS alternativa più usata al mondo, e la **8444** sta un numero più in là solo perché era
libera. Finché sul pannello gira solo SWS non succede niente. Nel momento in cui accanto a
`sws-runtime` deve girare qualcos'altro — e OpenPLC è il primo caso concreto, ma non è l'unico
che si vedrà — la 8443 è già occupata, e chi arriva secondo non parte.

La domanda non è «quale numero mettiamo al posto di 8443». È: **quanto di SWS presuppone quei
due numeri**, e quanto costa renderli una configurazione vera invece che una convenzione
scritta in venti posti.

## Cosa è stato misurato il 21-10-2026

**Chi le sceglie davvero.** Una sola delle tre porte ha un valore predefinito nel codice:
`--admin-port`, `8444` (`sws-runtime/crates/sws-runtime/src/main.rs:130`). `--viewer-port` e
`--http-port` sono `Option<u16>` senza default: senza il flag, il viewer non si avvia e la
pagina di accettazione del certificato non c'è. I numeri 8443 e 8444 li mettono quindi **gli
avviatori**, uno per uno, e sono quattro:

| Chi avvia | Dove | Porte |
|---|---|---|
| Yocto / pacchetto nativo | `deploy/yocto/sws-runtime-launch.sh:60-61` | `--viewer-port 8443 --admin-port 8444` |
| Container (le due immagini) | `deploy/container/Containerfile.x86_64:161-162`, `.aarch64` | idem, nel `CMD`, con `EXPOSE 8443 8444` |
| Quadlet del dispositivo | `deploy/container/sws-runtime.container:68-69` | `PublishPort=8443:8443`, `8444:8444` |
| Gateway sul VPS | `deploy/vps/quadlet/sws-gateway.container:57` | solo `--admin-port 8444`, niente viewer |
| IDE di sviluppo | `deploy/editor/run-editor.sh:27` | `SWS_ADMIN_PORT`, default **8460** |

`SWS_ADMIN_PORT` è l'**unica** variabile d'ambiente che cambia una porta, e la legge solo
l'avviatore dell'IDE. Il runtime non ne ha nessuna.

**Chi le presuppone.** Qui sta il costo vero, e non è nel codice che ascolta:

- **`viewerUrlFromAdmin` deduce la porta del viewer come `admin − 1`**
  (`sws-editor/src/runtimeUrl.ts`). Il commento lo dichiara già: «è una convenzione, non un
  dato… chi avvia il runtime con porte arbitrarie ottiene un indirizzo sbagliato». È il bottone
  «Viewer ↗» dell'IDE. Qualunque scelta nuova deve o mantenere la coppia adiacente, o
  pubblicare la porta del viewer come dato.
- **Il viewer LVGL** ha `--base-url https://127.0.0.1:8443` come default
  (`sws-lvgl-viewer/src/main.rs:154`), e `sws-kiosk` lo stesso
  (`sws-kiosk/src/main.rs:13`). Il quadlet del viewer LVGL lo riscrive esplicitamente
  (`deploy/container/sws-lvgl-viewer.container:45`).
- **L'installer** pubblica, sonda e stampa i due numeri a mano: `PORTS=(-p 8443:8443 -p
  8444:8444)`, `/health` su 8443, il codice di abbinamento su 8444, il riepilogo finale
  («viewer : …:8443   IDE : …:8444») — `deploy/container/install-container.sh:506-828`.
- **L'`HEALTHCHECK`** delle immagini prova 8443 e ripiega su 8444 (il gateway non ha viewer).
- **La documentazione** nomina `8443` o `8444` in **176 righe**, su venti file fra manuale,
  `HOWTO.md`, `TEST_SETUPS.md`, `CONTEXT.md` e le due guide di deploy.
- **Non le presuppone l'mDNS**: l'annuncio porta la porta del viewer in `get_port()` e quella
  admin nella proprietà `admin_port`, con `8444` solo come ripiego
  (`sws-web/src/discover.rs:193-197`). La scoperta dei dispositivi è già indipendente dai
  numeri — è l'unico pezzo che lo è.

**Chi ce le porta via.** OpenPLC Runtime v4: API REST su **8443**, con la porta **fissa** anche
nella CLI dell'Editor (`RUNTIME_API_PORT`), misurato il 20-10-2026. La 8443 è inoltre la porta
di Tomcat/`https-alt`, di Plesk e di mezzo mondo di apparati: su un pannello che fa anche
qualcos'altro il conflitto è la regola, non l'eccezione.

## Le strade che si vedono già

1. **Non toccare niente, spostare OpenPLC.** Il companion container di OpenPLC nasce su una
   porta interna nostra; nessuno dei venti file cambia. Costa zero e vale solo finché il
   secondo servizio è uno che controlliamo noi.
2. **Una variabile d'ambiente per ogni porta**, come `SWS_ADMIN_PORT` fa già per l'IDE, e la
   porta del viewer **pubblicata** come dato (in `/api/system`, dove l'IDE la legge invece di
   dedurla). Non cambia nessun numero predefinito: toglie la convenzione dal codice che la
   indovina. È la più piccola che risolve qualcosa.
3. **Numeri nostri.** Scegliere una coppia poco contesa e cambiarla ovunque — immagini,
   quadlet, installer, documentazione, e i pannelli già installati, che dopo l'aggiornamento
   risponderebbero altrove. Il costo non è la scelta, è la migrazione silenziosa.
4. **Una porta sola**, con viewer e IDE distinti per percorso invece che per porta. È la forma
   che il cloud ha già (il gateway sta dietro Traefik su 443 e smista per percorso), ma sul
   pannello le due porte sono anche un confine di sicurezza — `--no-admin` spegne l'IDE
   lasciando il viewer, e la 8444 si può chiudere sul firewall. Unirle è una decisione di
   superficie d'attacco, non di comodità.

## Domande per la sessione di plan

- Il problema da risolvere è **OpenPLC** (e allora basta la strada 1) o **il pannello che ospita
  software di terzi** (e allora serve la 2)?
- Se le porte diventano configurabili: chi le dichiara su un dispositivo già installato, e cosa
  legge l'IDE per sapere dove trovarle? Oggi deduce, e il commento dice già che è sbagliato.
- Le due porte restano un confine di sicurezza (`--no-admin`, firewall) o lo diventa il percorso?
- Un cambio di numeri predefiniti si applica anche ai pannelli esistenti all'aggiornamento, o
  solo alle installazioni nuove?
