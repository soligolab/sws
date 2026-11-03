# Il manuale su `sws.soligo.net/manuale/`, con le letture contate e un menù Aiuto nell'IDE

> Richiesta del maintainer, 03-11-2026: «integrare il manuale direttamente su sws.soligo.net sia come link nella
> pagina principale, credo possa essere utile vederla anche prima del login, sarebbe interessante però raccogliere
> statistiche di quanti la leggono e proteggerla dai BOT. Poi la stessa documentazione dovrebbe essere sempre
> accessibile dall'IDE tramite un menù di help».
>
> **Stato: piano d'esecuzione, decisioni prese il 03-11-2026; da iniziare quando la catena di
> `docs/manuale-tutorial` è mergiata** («un ramo alla volta»).

## Le decisioni del 03-11-2026

| Domanda | Scelta |
|---|---|
| Da dove si serve | **un sito statico a parte sul VPS**, non dentro il runtime. Si aggiorna senza rilasciare SWS; l'IDE di un cliente senza internet non lo raggiunge, ed è accettato |
| Indirizzo | **`sws.soligo.net/manuale/`**: Traefik manda quel prefisso al container statico, il resto al gateway. Stessa origine, niente DNS nuovo, niente CORS per il contatore |
| Cosa si pubblica | **solo i capitoli per chi usa SWS**: fuori 03 architettura, 13 API, 14 test (e quello che il passo 1 trova di analogo) |
| Quando si aggiorna | **a ogni release**, dallo stesso giro che costruisce e spinge le immagini |
| Bot | **niente crawler IA e niente scaricamento in massa** (non è chiesto il «non indicizzato») |
| Statistiche | **un contatore nel gateway, visto dalla console**: letture per capitolo e per giorno, visitatori distinti con un hash che cambia ogni giorno, niente cookie, niente IP salvati |

## Misure al 03-11-2026

- `docs/manual/`: 18 capitoli (01–18) + T01–T11, `MAIN.md` come indice, 4 MB con le schermate
  (`screenshots/`, `screenshots/tutorial/` 37 immagini). Markdown puro, link relativi fra capitoli; alcuni capitoli
  linkano file del repo (`../../scripts/…`) che sul sito non esisteranno.
- L'editor **non ha un renderer markdown** (`package.json`), e nessuna parte dell'IDE linka il manuale.
- VPS (`deploy/vps/`): Traefik con `traefik/dynamic/sws-gateway.yml` (`Host(sws.soligo.net)` → `sws-gateway:8444`),
  `accessLog: {}` già acceso, quadlet per traefik, gateway, portainer, rete `sws-rete`.
- Pagine pubbliche già servite dal runtime: `GET /condizioni` e `GET /privacy` (`registrazione.rs:252`), testo da
  `docs/legale/`. L'informativa (`docs/legale/informativa-privacy.md`) dovrà dire del contatore.
- Login: `sws-editor/src/components/LoginScreen.tsx`. Console: `sws-editor/src/console/` (Aziende, Pannelli, Persone,
  Posta, Risorse, Marchi, Installazione).
- Barra stile VS Code: `VOCI_SINISTRA` in `editor/LeftPanel.tsx:2301`, con `preferenze` in fondo; stile classico:
  `editor/EditorToolbar.tsx`.

## Fasi

Ognuna si chiude in una sessione con qualcosa da provare.

### 1. Il sito, in locale
- Uno script `scripts/manuale/genera_sito.sh` che produce HTML statico da `docs/manual/` con la lista dei capitoli
  pubblici dichiarata in un file (`scripts/manuale/capitoli_pubblici.txt`), non dedotta.
- Generatore proposto: **mkdocs-material lanciato con podman** (immagine `squidfunk/mkdocs-material` a versione fissa):
  navigazione, ricerca e lettura da telefono già fatte, niente da installare sulla macchina. Da confermare all'inizio
  della fase contro l'alternativa «script Python con `markdown`» (più piccolo, ma ricerca e menù da scrivere).
- I link verso capitoli esclusi o file del repo: o diventano testo, o puntano al repo. Una guardia
  (`check_manuale_sito.sh`) che fallisce su un link rotto nel sito generato.
- Il risultato si apre da `sws/tmp/manuale-sito/` per guardarlo.

### 2. Sul VPS, protetto
- Un quadlet `deploy/vps/quadlet/sws-manuale.container` (nginx o caddy statico, sola lettura su `~/sws-vps/manuale/`).
- `deploy/vps/traefik/dynamic/sws-manuale.yml`: `Host(sws.soligo.net) && PathPrefix(/manuale/)`, con:
  - middleware **ratelimit** per IP (valori da misurare: una persona che legge fa poche richieste al secondo, chi
    scarica tutto ne fa centinaia);
  - blocco degli user-agent dei crawler IA noti (GPTBot, ClaudeBot, CCBot, Google-Extended, Bytespider, PerplexityBot,
    Amazonbot, …) → 403, nella configurazione del server statico;
  - `robots.txt` che li esclude per nome (vale per chi lo rispetta, ed è quello che li identifica nei log).
- `scripts/manuale/pubblica.sh`: genera e copia sul VPS. Agganciato al giro di rilascio dopo il push delle immagini.
- `deploy/vps/STATO.md` e il README del VPS aggiornati (copia maestra).

### 3. Le letture contate, nella console
- Nel gateway una rotta aperta `POST /api/manuale/letto` con `{capitolo}`, chiamata da un piccolo script nelle pagine
  del sito: chi non esegue JavaScript (quasi tutti i bot) non conta. Il gateway scarta anche gli user-agent noti dei
  bot e limita le chiamate per IP.
- Si salva solo: giorno, capitolo, hash di (IP + user-agent + sale del giorno). Il sale si butta a fine giornata, quindi
  un visitatore non si riconosce da un giorno all'altro e niente IP resta su disco.
- La console mostra una tabella: capitolo × letture × visitatori distinti, per gli ultimi 30 giorni, e il totale.
- Solo sul gateway (o dove il sito è servito): un pannello o un IDE da cliente non conta niente.
- L'informativa privacy dice cosa si conta e cosa no.

### 4. Il link prima del login e il menù Aiuto
- Pagina di login (`LoginScreen.tsx`): un link «Manuale» visibile senza accedere.
- IDE: un **menù Aiuto** raggiungibile sempre, nei due stili (barra VS Code e toolbar classica), con «Manuale» che apre
  `https://sws.soligo.net/manuale/` in una scheda nuova. Da decidere nella fase: se il menù porta anche al capitolo
  giusto per la schermata aperta (es. dalla scheda Allarmi → `07_alarms`), e se l'indirizzo si può cambiare dal brand
  (`brand.json`) per un marchio che pubblica il proprio manuale.
- Testi it/en, `CHANGELOG`, `NOVITA.yaml`, e il manuale stesso che dice dove si trova.

## Cosa non fa questo piano
- Non traduce il manuale in inglese.
- Non mette il manuale dentro l'immagine: senza internet il menù Aiuto non apre niente. Se un giorno servisse offline,
  è un seme a parte.
