# Report programmati (P3) — piano d'esecuzione

> **Archiviato il 29-10-2026**, provato dal vivo dal maintainer: dal cloud, con `tc620-garage` collegato, «Genera ora»
> produce PDF ed Excel. Serve il deploy prima (il pannello genera con la definizione del suo progetto). L'email e il
> cron restano da vedere: in `docs/plans/Appunti.txt`.

> **FATTO il 26-10-2026, da collaudare** sul ramo `feat/report-programmati` (annidato). Il PDF del campione passa
> `qpdf --check` e si legge con `pdftotext`; l'Excel si apre con openpyxl e LibreOffice. Collaudo vero sul pannello in
> `COLLAUDI_IN_SOSPESO.md` §A-quater.

> Nato dal [piano prima fascia e CRA](2026-10-15-piano-prima-fascia-e-cra.md), voce P3, e dal programma delle funzioni
> utente (gruppo 9). Decisione del maintainer del 25-10-2026: **PDF ed Excel, con le tabelle dello storico** (per ogni
> tag scelto min/max/media e le aggregazioni del periodo, più gli allarmi), per turno/giorno/settimana/mese, **salvati
> nel progetto e inviati per email** con l'SMTP già configurato.

## Misurato il 26-10-2026

- Lo storico c'è: `Registry::query(tag, da, a)` (campioni del datastore assegnato al tag), `aggregate_samples(campioni,
  passo)` (min/max/media/primo/ultimo/conteggio per intervallo), `Historian::query_alarm_events(…, da, a, limite)`.
- Pianificazione: `sws-web/src/cron.rs` (`analizza`, cinque campi) è lo stesso degli script globali.
- Email: `lettre` con `builder` (allegati con `MultiPart`), `SmtpConfig` delle notifiche.
- **Nessuna dipendenza nuova**: l'Excel è un `.xlsx` scritto a mano (SpreadsheetML in uno zip, `zip` c'è già); il PDF
  è un PDF 1.4 di sole tabelle con Helvetica (WinAnsi), scritto a mano. Il piano CRA tratta ogni dipendenza come
  superficie da dichiarare: qui non serve.

## Il modello

`project.yaml` → `reports: []`, ognuno:

| Campo | |
|---|---|
| `id`, `titolo` | |
| `periodo` | `turno` (8 h), `giorno` (24 h), `settimana` (7 giorni), `mese` (dallo stesso giorno del mese prima): la finestra **finisce** quando il report parte |
| `quando` | cron a cinque campi; vuoto = il predefinito del periodo (turno `0 6,14,22 * * *`, giorno `0 6 * * *`, settimana `0 6 * * 1`, mese `0 6 1 * *`) |
| `tags` | i tag del report |
| `intervallo_min` | l'intervallo delle righe dell'andamento; vuoto = 15 min (turno), 60 (giorno), 1 giorno (settimana e mese) |
| `allarmi` | includere gli allarmi del periodo (predefinito sì) |
| `formati` | `pdf`, `xlsx` (predefinito tutti e due) |
| `email` | destinatari (`Destinatario`, come le notifiche); vuoto = solo salvato |
| `conserva` | quanti file per report tenere (predefinito 30) |

## Il lavoro

1. **sws-core**: `ReportDef` nel progetto, validazione (cron, tag esistenti, formati, id unici).
2. **sws-web `report/`**: `dati.rs` (dai campioni alle tabelle, puro, testato), `pdf.rs` e `xlsx.rs` (scrittori puri,
   testati: il PDF si rilegge con le sue xref, l'xlsx è uno zip con le parti giuste), `mod.rs` (genera, salva in
   `<progetto>/reports/<id>/`, pota oltre `conserva`, manda l'email con gli allegati) e il supervisore che a ogni
   minuto guarda i cron, avviato con il progetto come le notifiche. Solo il ruolo che fa girare l'impianto: nel cloud
   le sorgenti non partono e lo storico è del pannello.
3. **Rotte**: `GET /api/reports` (definizioni e file), `GET /api/reports/:id/:file`, `POST /api/reports/:id/genera`
   (Supervisor, audit `report.generate`), con i gemelli remoti.
4. **Editor**: Configurazione → Progetto → **Report**: le definizioni, «Genera ora», i file da scaricare.
5. Documenti: manuale (capitolo nuovo nella guida dell'editor), CHANGELOG, NOVITA, collaudi.

## Fuori, dichiarato

Grafici dentro il PDF (scelta del maintainer: tabelle), report su richiesta con periodo arbitrario dall'IDE (c'è già
l'esportazione CSV dello storico), firme digitali dei PDF.
