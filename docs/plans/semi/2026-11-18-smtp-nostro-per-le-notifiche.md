# Un servizio SMTP nostro per le notifiche e-mail

> **Seme — decisione.** Nato il 18-11-2026 dagli appunti presi in velocità dal maintainer in una riunione: «servizio SMTP nostro (tipo smtp2go) per le notifiche e-mail quando il cliente non ha accesso al suo». **Quando questo lavoro comincerà, il primo passo è una sessione di plan approfondita e dedicata, per sviscerarne tutti i dettagli.** Qui c'è solo l'idea, così come è stata detta: nessuna misura nel codice, nessun progetto.

## L'idea

Per le **notifiche e-mail**, prevedere un **servizio nostro, tipo smtp2go**, per il caso in cui il cliente **non abbia accesso alle impostazioni del suo SMTP**. **Definire i limiti.**

## Da sapere quando si riprende

- Da decidere: i limiti (messaggi al mese per cliente, destinatari, dimensione), chi paga, il mittente e il dominio (SPF/DKIM), l'abuso, dove passa: dal gateway del VPS o dal pannello. Un servizio in più da mantenere: è una decisione di prodotto, non solo di codice.
