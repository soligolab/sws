# Backup e ripristino per azienda (seme)

> **Stato: seme — decisione.** Nato il 10-11-2026 chiudendo il piano
> [aprire sws.soligo.net](../../archive/2026-10-26-aprire-sws-soligo-net.md), dove era arrivato da `Appunti.txt`
> (punto del 05-11-2026, scritto il giorno in cui il tronco cloud è stato archiviato). È il punto 4 della
> scheda Q44. **Quando questo lavoro comincerà, il primo passo è una sessione di plan approfondita e
> dedicata, per sviscerarne tutti i dettagli**: questo file è materiale, non un piano d'esecuzione.

## L'idea

Oggi i backup sono **per progetto**: `sws-runtime/crates/sws-web/src/backups.rs` (653 righe il
10-11-2026) **non sa niente dell'azienda** — la parola non compare nel file. Nel cloud servirebbe
salvare e ripristinare **insieme tutti i progetti di un'azienda**.

## Da dove viene

È il punto 4 della scheda Q44 («Ospitare l'editor come servizio, con aziende, utenti e quote»), il cui
testo sta in [`docs/archive/2026-09-18-identita-utenti-istanze.md`](../../archive/2026-09-18-identita-utenti-istanze.md):
«**Backup e ripristino per azienda**, non per progetto come oggi.» L'intestazione del tronco cloud
archiviato ([`2026-10-05-cloud-utenti-aziende-spazi.md`](../../archive/2026-10-05-cloud-utenti-aziende-spazi.md),
05-11-2026) dice «Self-host e backup per azienda sono in `docs/plans/Appunti.txt`»: il self-host è
coperto dalla guardia `scripts/check_primo_utente.sh` (estesa il 10-11-2026), il backup per azienda è
questo seme.

## Cosa resta da capire, e non si decide qui

- cosa entra nel backup di un'azienda oltre alle cartelle dei progetti: la riga in `aziende` con
  quote, marchio, stato e (dal 10-11-2026) l'SMTP dell'azienda; i membri; i pannelli abbinati; le
  anteprime `anteprima.png`, che stanno fuori da Git e dal deploy;
- se il ripristino **sovrascrive** o **affianca** i progetti con lo stesso nome;
- dove il file viene scritto e letto nel cloud, dove il container del progetto e il gateway non
  condividono il filesystem se non per la cartella del progetto;
- se il backup per azienda conta nella quota `max_byte`.
