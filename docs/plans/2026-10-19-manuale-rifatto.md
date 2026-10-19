# Piano — il manuale rifatto, e un capitolo nuovo su container e comunicazione

> 19-10-2026. Dal seme [`2026-09-19-screenshot-del-manuale.md`](../archive/2026-09-19-screenshot-del-manuale.md)
> (rimandato «a progetto stabilizzato»): il maintainer avvia il lavoro sulla documentazione e chiede in più «un
> capitolo molto esaustivo su come è organizzato il container runtime, e tutto quello che riguarda la comunicazione».

## Decisioni del maintainer (19-10-2026)

- **Perimetro del capitolo nuovo**: l'immagine `sws-runtime` **ovunque** — com'è fatta, e i suoi tre ruoli: sul
  pannello, come gateway del cloud, come container di progetto nel cloud.
- **Comunicazione**: **tutto, dal browser al campo** — porte e listener, API e WebSocket, autenticazione, IDE ↔
  dispositivo, cloud ↔ pannello (tunnel), gateway ↔ container, TLS e fiducia nei certificati, mDNS, aggiornamenti
  dal registry; i protocolli di campo con un rimando al capitolo 06.
- **Pubblico**: **integratore e chi installa** — cosa gira dove, quali porte aprire, cosa passa sulla rete, come si
  diagnostica. Schemi e tabelle; i file di codice solo come riferimento in fondo alle sezioni.
- **Ordine**: prima il capitolo nuovo, poi ogni capitolo riletto contro il codice (uno per ramo, con l'elenco di
  cosa è cambiato), infine le schermate (prima l'elenco delle inquadrature da approvare, poi lo scatto).

## Ramo 1 — capitolo 18 «Container e comunicazione»

Misure da fare sul codice, non sulla memoria: Containerfile (base, pacchetti, utente, cartelle, etichette,
healthcheck, entrypoint), quadlet del pannello e del VPS, `install-container.sh`, `immagini.sh`; `gateway/` (container
per progetto, inoltro, identità, chiave di ritorno); `tunnel/` (WebSocket uscente, multiplexing); `remote.rs` e
`remote_relay.rs`; listener e porte in `sws-runtime/src/main.rs`; certificati; mDNS; aggiornamento e conferma.

Schemi in Mermaid (GitHub li disegna): l'immagine e i suoi tre ruoli; le porte; i flussi (operatore → pannello,
IDE → pannello in LAN, IDE nel cloud → pannello via tunnel, deploy, aggiornamento). Tabelle: porte, canali WebSocket,
intestazioni e token, cartelle e volumi, variabili d'ambiente. Una sezione di diagnosi («non si collega» → cosa
guardare).

## Ramo 2 — revisione dei capitoli 01–17

Uno per ramo, contro il codice. Per ognuno: cosa è cambiato, cosa manca, cosa togliere. `MAIN.md` (dice ancora
«versione documentata 2026.7.0») e il capitolo 03 vanno allineati al 18.

## Ramo 3 — le schermate

Prima l'elenco delle inquadrature, capitolo per capitolo, da approvare; poi lo scatto con
`sws-editor/e2e/screenshots.spec.ts` (`./scripts/check_e2e.sh --screenshots`). Oggi dieci schermate, quattro non
citate da nessun capitolo.

## Stato

- **19-10-2026 — ramo 1 fatto**: `docs/manual/18_container_e_comunicazione.md` (540 righe), nell'indice di `MAIN.md`.
  Verificato contro il codice punto per punto; corretti in rilettura il limite dei login (falliti, per nome utente),
  i permessi di `/ws/logs` e il trust store di OPC UA. Da rileggere dal maintainer.
- Prossimo: ramo 2, la revisione dei capitoli 01–17.
