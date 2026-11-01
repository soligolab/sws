# Il sito hmify.com, col login che porta al cloud — seme

> **Stato: seme — decisione.** Nato il 01-11-2026, il giorno in cui il maintainer ha scelto il nome **hmify** e
> registrato su OVHcloud `hmify.com`, `hmify.net`, `hmify.eu` e `hmify.cloud`.
>
> **Quando questo lavoro comincia, il primo passo è una sessione di plan approfondita, dedicata, per sviscerarne
> tutti i dettagli.** Quello che segue è materiale per quella sessione, non un piano d'esecuzione.

## L'idea, con le parole del maintainer

«Ricorda anche lo slogan *hmify your data*, è una buona introduzione. Poi, l'idea è di pubblicare su hmify.com un
sito web bootstrap con il contenuto appoggiato a un repository git; in alto a destra, in una barra menu, ci deve
essere il pulsante "hmify login" che reindirizza a un sottodominio tipo ide.hmify.com (suggerisci le opzioni
migliori).»

- Slogan d'apertura: **«hmify your data»**.
- Sito vetrina in Bootstrap, contenuto in un repository git: si pubblica con un push.
- Barra in alto, a destra il bottone **«hmify login»**, che porta al cloud (il gateway che oggi è `sws.soligo.net`).

## Cosa c'è oggi (misurato il 01-11-2026)

- **Il cloud** è un solo instradamento di Traefik sul VPS: `deploy/vps/traefik/dynamic/sws-gateway.yml`,
  `rule: "Host(`sws.soligo.net`)"`, certificato Let's Encrypt. Aggiungere un nome è una riga
  (`Host(`a`) || Host(`b`)`) e un certificato in più, che Traefik prende da sé.
- **Il nome nel codice**: `sws.soligo.net` compare in 15 file di `sws-runtime` e `sws-editor`, ma quasi sempre in
  commenti, test e rimandi al piano `2026-10-26-aprire-sws-soligo-net.md`. Il punto delicato è
  `sws-core/src/pin_tls.rs`: i pannelli memorizzano l'impronta per `host:porta`, quindi un pannello già collegato a
  `sws.soligo.net` va lasciato lì. **Il nome vecchio resta servito accanto a quello nuovo**, non sostituito.
- **Il gateway non è solo l'IDE**: serve la registrazione, il login, l'IDE, la console di piattaforma e lo schermo
  remoto `/schermo/<pannello>/`. È un'indicazione per il nome del sottodominio.

## Le opzioni già visibili

### Dove sta il sito

| | Come | Pro | Contro |
|---|---|---|---|
| **A** (proposta) | **GitHub Pages** da un repository `hmify/hmify.com`, Jekyll (Pages lo costruisce da sé) o Hugo con una Action, Bootstrap 5 | gratis, HTTPS automatico, un push pubblica, il sito non dipende dal VPS | serve l'organizzazione GitHub `hmify` (libera il 01-11-2026) |
| B | un container nginx/caddy statico sul VPS dietro Traefik, aggiornato da un `git pull` | tutto in un posto | un servizio in più da tenere; se il VPS cade, cade anche la vetrina |
| C | Cloudflare Pages / Netlify | come A | un altro account e un altro fornitore |

Occasione da valutare: il manuale (`docs/manual/`) è già Markdown e potrebbe uscire sullo stesso sito come
`hmify.com/docs/`.

### Dove porta «hmify login»

| | Indirizzo | Pro | Contro |
|---|---|---|---|
| **1** (proposta) | **`app.hmify.com`** | è il nome che ci si aspetta; dice «l'applicazione», non solo l'IDE: dentro c'è anche lo schermo remoto e la console | nessuno di rilievo |
| 2 | `ide.hmify.com` | chiarissimo per chi disegna | stretto: il cliente che guarda solo lo schermo del suo pannello non usa un «IDE» |
| 3 | `hmify.cloud` (o `app.hmify.cloud`) | un dominio registrabile **diverso** dalla vetrina: cookie e `localStorage` del prodotto mai sullo stesso sito del materiale di marketing | due nomi da spiegare; `.cloud` è meno familiare |

Per la vetrina e il prodotto sullo stesso dominio (opzione 1) basta che i cookie del gateway restino **host-only**
(senza attributo `Domain`): da verificare nella sessione di plan.

**Legame con un altro seme**: [lo schermo su un'origine sua](2026-10-29-schermo-su-un-origine-sua.md) cerca
un'origine separata per la pagina del pannello. Un dominio nuovo è l'occasione per darla:
`<pannello>.screen.hmify.cloud` o simili. Da decidere là, non qui.

### Cosa resta fuori

Il cambio di nome del prodotto (immagini `ghcr.io/soligolab/sws-runtime`, testi dell'IDE e del pannello, repository)
**non** è parte di questo seme: il sito può nascere col nome hmify anche se dentro il prodotto si chiama ancora SWS.
Prima del sito, la ricerca sul marchio (EUIPO/USPTO; il nome vicino è «Homify», classi 9 e 42).
