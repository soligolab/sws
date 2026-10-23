# OpenPLC sul dispositivo — le decisioni, dopo la sessione di plan

> **DECISO dal maintainer il 23-10-2026.** Le otto scelte sono in testa, qui sotto; il materiale
> che le ha istruite resta in coda. Da qui si apre un ramo, non un'altra sessione di plan.
>
> **Era un seme, dal 22-10-2026 portava le decisioni.** La sessione di plan che il seme chiedeva è
> stata fatta quella notte, misurando il codice e i documenti. Le misure del laboratorio del
> 20-10 reggono quasi tutte; quello che è cambiato è scritto qui sotto.
>
> Richiesta del maintainer, 20-10-2026: «valuta se può avere più senso far girare OpenPLC
> direttamente sul device e poterlo usare anche in produzione», e poi «quindi non solo un
> laboratorio ma una funzione di SWS».


## Le decisioni (23-10-2026)

| | Scelta |
|---|---|
| **Governo** | **Ibrido**: quadlet nostro per farlo partire e farlo ripartire dopo un riavvio, aggiornamento suo. È il modello di `portainer` sul VPS — quadlet nostro, nessun `AutoUpdate` |
| **Destinatario** | **Tutti e due**: si parte dalle board generiche, i Pixsys arrivano dopo, quando la convivenza con CODESYS si decide a parte |
| **Opzionale** | **Sì, e questo è un vincolo, non una preferenza**: «non è detto che a tutti i clienti serva». Niente si installa senza che qualcuno lo chieda |
| **Spazio** | **Anche sui pannelli piccoli**, accettando il conto stretto. Va rivista la soglia |
| **La logica ST** | In **`<progetto>/openplc/`**, e deve viaggiare: git **e** deploy |
| **IDE nel cloud** | **Scarica e ricarica la cartella**: due rotte che esportano e reimportano la sola `openplc/` |
| **Quadlet** | Entra nel minimo **solo se installata** |
| **La 4840** | **Si documenta**: entrambe le porte sono configurabili |

### Cosa discende da ciascuna, misurato

**La cartella `openplc/` è in git gratis.** Il git di progetto fa `git add -A`, non una lista: prende
tutto quello che c'è nella cartella del progetto tranne ciò che il `.gitignore` esclude. Zero righe.

**E l'Editor di OpenPLC la apre da sé**, perché è una cartella normale in `~/sws_projects/<nome>/`.
La difficoltà che il maintainer vedeva si scioglie da sola — **finché l'IDE gira sul suo PC**.

**Il deploy invece costa cinque righe in cinque posti**, ed è l'opposto del git: `BACKED_UP`
(`backups.rs`), `SERVE` (`istantanea.rs`), `build_project_zip`, l'impronta del deploy e
`sync_yaml_dir_from_zip` (tutte e tre in `router.rs`) sono elenchi **scritti a mano**. E già
divergono: `backups.rs` non ha `faceplates` né `cornici`, che gli altri hanno. Aggiungere `openplc/`
è il momento buono per chiedersi se quelle cinque liste vadano unificate in una sola — **è una
domanda aperta, non una decisione presa**.

**«Entra nel minimo solo se installata» chiede una cosa che oggi non c'è.** `installata()`
(`quadlet.rs`) fa `vr.min(vv)`, e un'unità non caricata vale 0 perché si **presume** sia
un'installazione precedente al suo quadlet. Un'unità che non si vuole vale 0 per sempre, e il
pannello chiederebbe un aggiornamento dei quadlet a ogni giro. Serve **un segno sul disco** che dica
quali unità questo pannello ha scelto: è il pezzo di lavoro che questa decisione fa nascere.

**Il rootless morde due volte.** In podman rootless non si pubblicano porte sotto la **1024**, e il
sysctl che abbassa la soglia esiste **solo sul VPS**: il laboratorio del 20-10 girava tutto
rimappato (`-p 1502:502`), quindi la coabitazione sulle porte vere non è mai stata provata. E il
**tempo reale** resta fuori: `sched_setscheduler` fallisce in rootless, nessun quadlet del repo
aggiunge capacità, e il rootless è una scelta di disegno.

### L'ordine dei rami — **tutti e cinque fatti il 23-10-2026**

1. ~~**Il segno delle unità scelte** e il minimo che lo rispetta.~~ **FATTO il 23-10-2026**, ramo
   `feat/openplc-1-unita-scelte`. L'installer scrive `unita-scelte.json` — è l'unico che sa cosa
   ha messo — e `minimo_installato` conta solo le unità scelte. **Senza il file si fa come
   prima**: un pannello installato prima che esistesse è davvero un pannello che precede il suo
   quadlet, e lì la presunzione vecchia è giusta. Cinque prove sulla regola, separata dal bus
   apposta — una regola che si può provare solo con un systemd davanti non si prova mai. Guardia
   `check_unita_scelte.sh`, provata rossa aggiungendo una terza unità al solo lato Rust: è
   esattamente l'errore che il ramo 2 potrebbe fare.
2. ~~**Il quadlet di OpenPLC**, opzionale, senza `AutoUpdate`.~~ **FATTO**, ramo
   `feat/openplc-2-quadlet`. Due decisioni prese senza il maintainer, dopo il suo «procedi»: lo
   installa una bandiera (`--con-openplc`), e le porte di Modbus e S7 sono **alte**, perché in
   rootless sotto la 1024 non si pubblica e il sysctl che abbassa la soglia sul pannello non c'è.
3. ~~**`openplc/` nelle cinque liste**~~ **FATTO**, ramo `feat/openplc-3-logica-nel-progetto`. In
   **quattro**, non cinque: l'istantanea no, perché disegna una pagina e la logica non c'entra.
   Modulo `logica_plc.rs` invece di quattro copie della stessa logica. **La domanda se unificare
   le liste resta aperta**, e non è una decisione presa.
4. ~~**Le due rotte** scarica/ricarica della cartella.~~ **FATTO**, ramo
   `feat/openplc-4-rotte-logica`. Lo zip va e torna **senza** il prefisso `openplc/`: chi scarica
   vuole il progetto OpenPLC, non una cartella dentro un'altra.
5. ~~**Documentazione**~~ **FATTO**, ramo `feat/openplc-5-documentazione`: `docs/HOWTO.md`
   capitolo 28, con le porte vere, il tempo reale che non c'è, i due server OPC-UA e CODESYS.

Il punto 1 era il solo che toccasse codice già in produzione. Dal 2 in poi si è aggiunto.

**Quello che resta, e non è di questo piano**: il server Modbus di SWS — vedi il seme
[server Modbus](2026-10-23-server-modbus.md) — e il tempo reale, che in rootless non si ha e che
qui non si è toccato.

---

## Tre cose che la misura ha cambiato

**1. Il conflitto sulla 8443 non esiste più.** Era il motivo per cui il seme diceva di aprire
insieme il seme figlio sulle porte. Quel seme è nato, è stato deciso e archiviato **lo stesso
giorno**, e il 21-10 SWS si è spostato su 7443/7444 lasciando la 8443 libera. Le immagini sono
state costruite e il WP630 collaudato. **Il seme figlio non c'è più da aprire.**

Resta un residuo da guardare: il viewer LVGL ha un ripiego che, se il runtime non risponde sulla
7443, **prova la 8443**. Su un pannello con OpenPLC lì sopra, ogni avvio in cui il runtime non è
ancora su manda una sonda TLS al server Flask di OpenPLC. Oggi è innocuo; va deciso se lo resta.

**2. L'ingombro è il doppio, non quindici volte.** L'immagine di SWS è **556 MB su arm64** (273 su
amd64): i «63-65 MB» dei documenti sono l'archivio compresso sul registry, non quello che occupa
sul pannello. Quindi il confronto con il GB di OpenPLC è 556 contro ~1000.

Ma **lo spazio sui pannelli non basta con comodità**: il TC620 ha 3,1 GB liberi su una partizione
da 10 GB, il WP630 ha 1979 MB di RAM e disco 4/10. E ogni immagine va contata **due volte**, perché
la precedente si tiene per il ritorno.

**3. Il precedente di un container di terzi esiste già**, e la misura diceva il contrario: sul VPS
girano `traefik:v3` (con `AutoUpdate=registry` su un tag mobile) e `portainer-ce:latest`, accanto
al quadlet che gira l'immagine di SWS. Cioè l'opzione «immagine estranea che si aggiorna sul
calendario di un altro» è **già accettata e in produzione**. Sul pannello è più delicata, ma non è
la prima volta.

## Quello che è stato misurato

**Puntare SWS a OpenPLC in locale costa zero righe di codice**: `ModbusTcpConfig` ha `host` e
`port`, basta una sorgente su `127.0.0.1`. Di tutti e tre i protocolli che OpenPLC espone — Modbus
TCP, S7, OPC-UA — **Modbus è di gran lunga il più maturo da noi** (1 516 righe, quattro aree,
decodifica dal tipo, scrittura sulla singola foglia).

*Ma c'è un però, e lo ha trovato lo scettico*: in podman **rootless** non si pubblicano porte sotto
la 1024, e il sysctl che abbassa la soglia esiste **solo sul VPS**. Il laboratorio del 20-10 girava
tutto rimappato (`-p 1502:502`): la coabitazione sulle porte vere non è mai stata provata.

**Un posto dove vive del codice sorgente dentro il progetto esiste già**, e sta **dentro
`project.yaml`**: il Python delle funzioni e degli script globali è in linea nello YAML, con un
tetto di 64 KiB, e l'IDE lo edita con CodeMirror. Conta per la decisione 4.

**Aggiungere un terzo quadlet tocca ~10 file.** Il meccanismo che fa viaggiare i quadlet conosce
esattamente **due** unità, cablate, e la versione installata è il **minimo** fra le due.

**Il tempo reale resta il punto non risolto**: in rootless `sched_setscheduler` fallisce, nessun
quadlet del repo aggiunge capacità, e il rootless è una scelta di disegno — l'installer si ferma
se non riesce ad abilitare il linger.

**E in produzione il pannello non ha l'IDE**: dal 02-09-2026 parte con `--no-admin`. Chi
comanderebbe il PLC non sta sul pannello.

---

## Le decisioni

### 1. Per chi è?

- **a — un cliente senza PLC**, su board generiche. Lì non c'è CODESYS, nessuno litiga per lo
  schermo, e di solito c'è più disco. Il lavoro è solo tecnico.
- **b — un'alternativa a CODESYS sui Pixsys.** Sul TC620 girano già `codesyscontrol` e
  `codesysedge`, e **CODESYS riscrive `/etc/pixsys/main-config.toml` undici secondi dopo** che SWS
  ha puntato il browser alla 7443: chi vince il browser è chi scrive per ultimo. Serve prima una
  storia di convivenza — la leva D-Bus esiste già.
- **c — solo laboratorio**, lo stato di oggi.

### 2. Chi risponde del ciclo PLC, e chi lo aggiorna?

- **a — SWS lo governa**: quadlet nostro, e il ciclo conferma/ritorno di SWS esteso a un'immagine
  di un altro registry. È il lavoro vero: due unità cablate diventano tre, la versione è il minimo
  su tre, due guardie hanno elenchi espliciti — **più la parte che non esiste affatto**, cioè cosa
  vuol dire «tornare indietro» su un'immagine che non è nostra.
- **b — OpenPLC è indipendente**: si installa e si aggiorna per conto suo, SWS lo legge su
  `127.0.0.1` come qualunque PLC in rete. **È la direzione che hai già indicato il 21-10**: «voglio
  che possa essere usato come software PLC autonomo e indipendente».
- **c — ibrido**: quadlet nostro per farlo partire, aggiornamento suo.

### 3. Si installa anche sui TC620/WP630?

I numeri: TC620 **3,1 GB liberi**; WP630 **1979 MB di RAM**, disco 4/10 GB; SWS 556 MB più la
precedente; OpenPLC ~1000 MB più la sua.

- **a — anche lì**, accettando il conto stretto. Va rivista la soglia dello spazio.
- **b — solo dove c'è spazio.** *Attenzione*: la sonda del dispositivo **non blocca niente** — è un
  rapporto JSON e nessuno si ferma sul suo errore. Il cancello vero è in shell, nell'installer, e
  **non sa niente di una seconda immagine**.
- **c — mai sui pannelli piccoli.**

### 4. Come si versiona la logica ST?

- **a — in linea in `project.yaml`**, come già fa il Python. **Costa zero nel viaggio**: entra da
  sé nel backup, nell'istantanea, nel deploy, nell'export, nell'impronta di sincronizzazione e nel
  git di progetto.
- **b — una cartella nuova** (`logica/*.st`). Va aggiunta a **cinque elenchi scritti a mano**, e
  quegli elenchi **già divergono fra loro**: `backups.rs` non ha `faceplates` né `cornici`, che gli
  altri due hanno. È la prova misurata che aggiungerne una costa, e che il costo si ripete.
- **c — fuori da SWS**: il progetto OpenPLC resta un albero suo, come nel laboratorio.

### 5. La 4840: due server OPC-UA sullo stesso pannello

- **a — si documenta**: entrambe le porte sono configurabili, e chi accende tutti e due ne cambia
  una. È la classificazione che il piano delle porte aveva già dato.
- **b — SWS sposta il suo predefinito**, come ha già fatto con la 8443.
- **c — si lascia**, e il secondo server non parte.

---

## Quanto costa, per strada

| Strada | Costo |
|---|---|
| **1 — companion container** | 300-500 righe su ~12 file, un ramo, 1-2 sessioni — *se* ci si ferma a farlo partire. L'aggiornamento di un'immagine di terzi dentro il nostro ciclo di conferma e ritorno è **una sessione di plan a sé** |
| **2 — il PLC nell'IDE** | Non misurabile da qui: vuole Electron nell'immagine dell'IDE, o un compilatore ST in casa |
| **3 — solo laboratorio** | Zero. È lo stato di oggi |

**La domanda che decide tutto è la 2**, e il 21-10 l'avevi già quasi risposta. Se vale ancora
«autonomo e indipendente», la strada è la **b**, il lavoro è **configurazione più documentazione**,
e le decisioni 1 e 3 diventano domande di prodotto senza codice dietro.
