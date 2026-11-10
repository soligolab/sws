# La copia dei dati del cloud anche su un secondo server (seme)

> **Stato: seme — decisione.** Nato il 10-11-2026 dalla richiesta del maintainer, quando si è deciso di dichiarare
> nell'informativa privacy le copie giornaliere conservate 30 giorni: «implementiamo un meccanismo di backup automatico
> […] poi crea il seme per implementare il backup con possibilità di una seconda copia su un server remoto aggiuntivo».
> **Quando questo lavoro comincerà, il primo passo è una sessione di plan approfondita e dedicata, per sviscerarne tutti
> i dettagli.**

## Cosa c'è (10-11-2026)

`backup-dati.sh` sul VPS (`deploy/vps/backup-dati.sh`, `deploy/vps/STATO.md` «La copia giornaliera dei dati»): ogni
giorno alle 03:15 UTC copia account e progetti in `~/sws-vps/backup-dati/AAAA-MM-GG/`, 30 giorni, link fisici per i file
non cambiati (prima copia 2,3 GB, poi ~140 MB al giorno), istantanee coerenti dei 19 database SQLite vivi. **Tutto sulla
stessa macchina**: se si perde il VPS (guasto, account OVH, errore di chi lo amministra) si perdono anche le copie.

## L'idea

Una seconda copia, cifrata, su un server remoto diverso da OVH. Le domande per la sessione di plan:

- **Dove**: un altro VPS, uno spazio a oggetti (S3 compatibile: Infomaniak Swiss Backup, Backblaze B2, Hetzner Storage
  Box), il PC di casa del maintainer. Fornitore nell'UE o in Svizzera, perché va scritto nell'informativa (§4-5).
- **Come**: `restic` o `borg` (deduplicazione, cifratura lato client, potatura per età) invece di `rsync`; la chiave di
  cifratura dove sta, e chi la tiene se il VPS sparisce.
- **Quanto**: stessa ritenzione (30 giorni) o più lunga per la copia remota; l'informativa va allineata.
- **Prova di ripristino**: un ripristino vero, periodico, su una macchina vuota, scritto in `deploy/vps/STATO.md`.
- **Costi** e la banda in uscita del VPS.
- Si collega al seme [backup per azienda](2026-11-10-backup-per-azienda.md): quello è la copia che l'utente scarica, questa è
  quella di chi gestisce il servizio.
