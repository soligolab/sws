# Un robot ROS 2 come sorgente dello SCADA

> **Come si legge questo piano.** Nasce da una o più schede di
> `docs/OPEN_QUESTIONS.md`, spostate qui il 18-09-2026 per decisione del maintainer: le domande
> non vivono più in un elenco, diventano file di piano. **Il testo delle schede è riportato
> integralmente più sotto**, non riassunto — è la misura fatta quando la domanda è nata, e
> riassumerla vorrebbe dire rifare il lavoro a naso.
>
> ⚠️ **Quando si prenderà in mano questo lavoro, la prima cosa da fare è una sessione di plan
> approfondita.** Quello che segue è materiale, non un piano d'esecuzione: le misure hanno la
> data che hanno, il codice si è mosso, e alcune opzioni potrebbero non avere più senso.

## Stato

Segnalata dal maintainer il 26-08-2026, **da analizzare più avanti**. Non c'è un bisogno in corso:
questo file tiene insieme l'analisi già fatta perché non vada persa, non apre un lavoro.

È una **superficie dati nuova** — DDS, topic tipizzati, servizi — e non assomiglia a nessuno dei
protocolli che lo SCADA parla oggi (Modbus, MQTT, OPC UA, script Python). Tenuta separata da
[MCP](2026-09-18-mcp-editing-con-ia.md), che è invece una superficie di *editing*: sono due
aperture verso l'esterno, ma non si somigliano abbastanza da stare in un piano solo.


---

## Dalla scheda Q23 — Collegare lo SCADA a un robot ROS 2

**Aperta** — segnalata dal maintainer il 2026-08-26, da analizzare più avanti.

Oggi i dati entrano nello SCADA da Modbus, MQTT, OPC UA e dagli script Python. Un robot basato
su **ROS 2** non parla nessuno di questi: parla DDS, con topic tipizzati, servizi e azioni.

Da decidere, e sono due domande distinte che conviene non impastare:

1. **Il driver.** Un *source* ROS 2 accanto agli altri. Le strade plausibili sono almeno tre e
   costano molto diversamente: linkare `rclrs` (client Rust nativo, ancora giovane), appoggiarsi a
   `rosbridge` via WebSocket/JSON (nessuna dipendenza DDS, ma un processo in più da installare sul
   robot), oppure parlare DDS direttamente con un'implementazione Rust. Va tenuto presente che il
   modello dati qui è **tag piatti con un valore scalare**, mentre ROS 2 pubblica messaggi
   strutturati: la mappatura messaggio → tag non è un dettaglio implementativo, è la domanda vera.
2. **Gli oggetti sinottici.** Un robot non si rappresenta con una `gauge`. Servirebbero oggetti
   propri — posa/giunti, stato della missione, pulsanti che lanciano un'*azione* e ne seguono il
   feedback, e un modo di mostrare l'emergenza. Vale anche la pena chiedersi se il comando di un
   robot debba passare per il normale meccanismo di scrittura tag o richieda una strada a parte:
   un'azione ROS 2 ha un ciclo di vita (accettata, in corso, annullabile, conclusa) che un tag
   scalare non sa rappresentare.

**Precisazione del maintainer (2026-08-26): la portata è molto più piccola di così.**

In questa fase allo SCADA serve dialogare con **dati semplici** del robot, non rappresentarlo. In
concreto: una `gauge` agganciata a velocità, direzione o consumi; `led` e `trend` agganciati a dati
di diagnostica dello stesso genere; qualche `button` che manda avvio e arresto. Tutta roba che gli
oggetti esistenti già sanno fare.

**Non è richiesto** rappresentare il robot (nessuna vista posa/giunti) né emulare servizi di
simulazione.

Questo sposta il peso della domanda: il punto 2 qui sopra — gli oggetti sinottici dedicati —
**decade quasi del tutto**, e resta il punto 1, cioè far arrivare quei valori dentro dei tag. Il
che riduce il problema a un *source* in più, che è un lavoro di tutt'altra taglia rispetto a una
famiglia di oggetti nuovi. Anche la questione "e sul pannello LVGL?" si dissolve da sé: gauge, led,
trend e button il motore LVGL li disegna già.

Restano da decidere solo la strada del driver (`rclrs` / `rosbridge` / DDS nativo) e la mappatura
messaggio strutturato → tag scalare.

Da non affrontare prima che il PoC sia stabile.
