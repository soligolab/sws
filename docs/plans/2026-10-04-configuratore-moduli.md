# Un configuratore che manda il setup ai moduli all'avvio

> **Seme — decisione** (04-10-2026). Idea del maintainer durante il collaudo dei due MCM260X sul TC620: «sarebbe
> interessante un configuratore da usare per inviare il setup ai moduli allo start del runtime».
>
> **Quando questo lavoro comincia, il primo passo è una sessione di plan approfondita, dedicata, per sviscerarne
> tutti i dettagli.** Quello che segue è l'idea e le misure di oggi, non un progetto.

## L'idea

Il progetto dice com'è configurato ogni dispositivo (tipo di sonda di ogni ingresso, unità, tipo di uscita, setup
degli encoder…), e il runtime lo fa valere sul modulo quando si collega. Un modulo sostituito, o resettato, torna
configurato da solo; la configurazione sta nel progetto, versionata con lui, e non solo nella memoria del modulo.

## Misurato il 04-10-2026

- Il 5AD usciva di fabbrica con le quattro sonde «disabilitate» (2021-2024 = 0): gli AI leggevano 0 finché i
  parametri non sono stati scritti a mano (script Modbus diretto, runtime fermo). Valori trovati provando: AI1
  PTC1K (12), AI2 NTC10K (11), AI3-AI4 NTC10K (11) provvisorio.
- Il catalogo ha già il gruppo **«configurazione»** (`tipo_sensore_aiN`, `tipo_gradi`, `tipo_uscita_aoN`,
  `setup_encN`, `compatibilita_mcm260`), con i valori ammessi scritti solo nella descrizione.
- **Usura della memoria**: per gli MCM260X i parametri scritti in **2001-2100 si salvano a ogni scrittura**, quelli in
  **4001-4100** (stessi parametri) **dopo 10 s dall'ultima** (manuale 2300.10.265 RevG §9.2). Scrivere a ogni avvio
  senza confrontare sarebbe un consumo inutile: la strada naturale è leggere, confrontare, scrivere solo ciò che
  differisce (e, per gli MCM, nell'area «ritardata»).
- Il motore Modbus (`sws-plugin-modbus`) ha già la sessione per bus e il punto in cui il dispositivo «risponde» per
  la prima volta (`StatoSorgenti` → `Ok`): è lì che un setup si aggancerebbe.

## Domande da cui partire

1. Dove si scrive il setup: valori sul **dispositivo** nel progetto (`devices[].setup: {tipo_sensore_ai1: 12, …}`), o
   sulle variabili del gruppo «configurazione» come valore desiderato?
2. **Quando**: a ogni connessione, solo alla prima risposta dopo l'avvio, su comando («Invia setup»)? E se il modulo
   è stato configurato a mano con valori diversi: vince il progetto, si avvisa, si chiede?
3. **Enumerazioni nel catalogo**: i valori ammessi (`9 = Pt100`, `12 = PTC1K`…) come dato strutturato, per una
   tendina nell'IDE invece di un numero.
4. Un registro di setup che il modulo rifiuta (eccezione 3, valore non ammesso): tag Bad, avviso, stato del
   dispositivo «configurazione non applicata»?
5. Altri costruttori: un parametro da applicare con un ritardo, una sequenza (sblocco con password, poi parametri),
   un riavvio del modulo dopo il setup.
