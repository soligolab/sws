# Report con grafici, riepiloghi e un aspetto configurabile

> **Seme — decisione.** Nato il 12-11-2026, mentre CasaDomotica passava a un report settimanale su consumi e stato
> del sistema. Richiesta del maintainer: «il generatore di report va migliorato per poter includere grafici, riepiloghi
> di un dato, e deve essere configurabile l'aspetto di ciascun report». **Quando questo lavoro comincerà, il primo
> passo è una sessione di plan approfondita e dedicata** per sviscerarne tutti i dettagli: qui ci sono solo l'idea e
> le misure di oggi.

## L'idea

Oggi un report è una sequenza di tabelle. Il maintainer lo vuole come un documento:
- **grafici**: l'andamento di un tag, più tag sovrapposti, barre per giorno;
- **riepiloghi di un dato**: per esempio il consumo della settimana di un contatore, il massimo con la sua ora, il
  tempo sopra una soglia;
- **un aspetto configurabile per ciascun report**: titolo, logo, colori, quali sezioni e in che ordine.

## Le misure di oggi (12-11-2026)

- **Il modello.** `ReportDef` in `sws-runtime/crates/sws-core/src/project.rs`: `id`, `titolo`, `periodo` (turno,
  giorno, settimana, mese), `quando` (cron), `tags`, `intervallo_min`, `allarmi`, `formati` (`pdf`, `xlsx`),
  `email`, `conserva`. Niente che parli di aspetto o di sezioni.
- **Il codice.** Sta in `sws-runtime/crates/sws-web/src/report/` (`dati.rs`, `pdf.rs`, `xlsx.rs`, `mod.rs`): 1 623
  righe. Per ogni tag dà minimo, massimo e media, più l'andamento a intervalli, e in fondo gli allarmi del periodo.
- **Il PDF è scritto a mano, di proposito** (P3, 26-10-2026): PDF 1.4 con Helvetica, nessuna dipendenza nuova,
  perché il piano CRA tratta ogni crate come superficie da dichiarare. Un grafico in PDF vuol dire o disegnarlo a
  mano (linee e rettangoli PDF), o una dipendenza (da pesare col CRA), o passare da un SVG.
- **Il caso che l'ha fatto nascere.** Il `report_1` di CasaDomotica, «Casa — consumi e stato del sistema» (12-11),
  ha 32 tag:
  - per i contatori cumulativi (pompa di calore, prese, rack) il consumo della settimana va calcolato a mano come
    massimo meno minimo;
  - gli «oggi» dell'inverter richiedono di leggere il massimo di ogni giorno.

  È il primo riepilogo che manca. La colonna «consumo» per i contatori è stata proposta per la rc.16.

## Da decidere nella sessione di plan

- **Dove si descrive l'aspetto:** nel `ReportDef` o in un modello di report riusabile, sul modello delle cornici.
- **Quali grafici, e come si disegnano** nel PDF scritto a mano e nell'Excel (che i grafici li ha nativi).
- **Quali riepiloghi**, e come si dichiarano per un tag (contatore, misura istantanea, stato).
- **Se l'editor dei report diventa visuale**, con un'anteprima.
- **Le lingue del report**, e se segue la lingua dei contenuti.
