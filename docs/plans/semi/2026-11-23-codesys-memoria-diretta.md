# CODESYS a memoria diretta, come LogicLab (seme, 23-11-2026)

> **Seme — decisione.** Quando questo lavoro comincia, **il primo passo è una sessione di plan dedicata e
> approfondita** che ne sviscera tutti i dettagli. Quello che segue è l'idea e le misure di oggi, non un progetto: fra
> la domanda e il lavoro cambia troppo, e un disegno scritto mesi prima è un disegno che mente.

## L'idea

Il 23-11-2026 è stato pianificato il driver LogicLab a memoria diretta
([piano](../2026-11-23-logiclab-memoria-diretta.md)): un plugin dentro il runtime del PLC che espone le variabili a
SWS senza protocolli, con la mappa delle variabili presa dal file dei simboli. Fra i runtime dei dispositivi Pixsys c'è
anche **CODESYS**. Il maintainer ha deciso che entra **dopo**: «Dopo, solo LogicLab ora».

## Cosa si sa oggi

- Sui TC620 girano `codesys-control` e `codesysedge` (`docs/archive/2026-11-14-funzioni-di-tyx-panelcontrol.md`);
  CODESYS si prende il browser all'avvio (`docs/TEST_SETUPS.md`).
- Sul PLX800, `codesyscontrol` (container `plx-codesys-full`) mappa `/dev/shm/qmb800_registers` ed è uno scrittore
  senza lock (`/home/ut1/Git/openplc/analisi.md` §7).
- Nel codice SWS CODESYS compare solo in `sws-web/src/display_target.rs` (l'URL del browser via D-Bus).
- Nessun materiale del produttore in mano: SDK dei componenti, formato dei simboli, licenza.

## Le domande per la sessione di plan
- Esiste un meccanismo ufficiale equivalente al plugin LLExec (componenti dell'SDK di CODESYS Control, memoria
  condivisa, la configurazione dei simboli) e con che licenza?
- Che formato ha il file dei simboli, e dove sta sul dispositivo?
- Quanto del lato SWS del driver LogicLab (canale, mappatura per nome, finestra d'importazione) si può riusare
  identico?
