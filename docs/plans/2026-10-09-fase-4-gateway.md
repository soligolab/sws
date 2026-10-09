# Fase 4 — il gateway

> Dettaglio della **Fase 4** del [tronco cloud](2026-10-05-cloud-utenti-aziende-spazi.md).
> Le Fasi 1, 2 e 3 sono chiuse e in archivio.
>
> **Le specifiche sono decise** (09-10-2026, in fondo). Il disegno di dettaglio no: quando il
> lavoro comincerà serve ancora una sessione di plan su come è fatto il gateway dentro. Qui ci
> sono le misure di quel giorno, le decisioni prese e le due cose da provare prima di scrivere
> codice.

## Cos'è, in una riga

Un processo che sta davanti a tutti gli altri: serve le pagine pubbliche, fa l'autenticazione, e
**instrada ogni progetto al proprio container**, avviandolo a richiesta e spegnendolo da fermo.

È il pezzo che trasforma «un IDE con le aziende dentro» in «un servizio cloud», ed è anche quello
che rende sufficiente un VPS-1 (decisione 39): senza lo spegnimento da fermo, ogni progetto mai
aperto resterebbe un container acceso.

## Cosa dice già il tronco cloud

- `sws-runtime --gateway`: SPA pubblica, accesso, registrazione, pannello dell'azienda; instrada
  `/p/<progetto>/*` al container del progetto.
- `--auth-delegata` sul figlio: accetta l'identità dall'intestazione del gateway **solo** da socket
  locale. Il piano del 27-09 lo segnala per nome: «`ide_only` dietro il gateway deve voler dire
  *l'autenticazione la fa il gateway*, e le due cose non vanno confuse».
- Container podman rootless, immagine del runtime, montata **solo** la cartella del progetto
  (decisione 25).
- **Branding per azienda** (decisione 43): il gateway serve `/branding/active.json` per azienda.

## Misurato il 09-10-2026

1. **Non esiste niente**: nessuna opzione `--gateway`, nessun `--auth-delegata`, nessun codice di
   proxy inverso in `sws-runtime/crates/sws-runtime/src/main.rs`. Le opzioni di avvio attuali sono
   `--projects-root`, `--www`, `--viewer-port`, `--admin-port`, `--no-admin`,
   `--senza-autenticazione`.
2. **Il prerequisito infrastrutturale NON è soddisfatto.** Il tronco cloud chiede un'immagine
   **amd64** pubblicata su ghcr prima di questa fase: il gateway gira su un server x86. La 2.12.0
   ha pubblicato **solo arm64** (`2.12.0-arm64`, `latest-arm64`, `rc-arm64`, più il tag di commit).
   `scripts/build_container_x86_64.sh` esiste e sa già i tag `latest-amd64`/`rc-amd64`, ma nessuna
   release li ha mossi.
3. **Il branding per azienda è già risolto a metà**, e non come previsto: dal 09-10-2026 il
   marchio segue chi entra via `GET /api/identita/marchio`, e il frontend ricarica il tema dopo
   l'accesso. Il gateway non deve più servire un `active.json` diverso per azienda — gli resta solo
   il caso **prima** del login, dove l'azienda non si conosce ancora.
4. **Il confinamento c'è già** ed è stato costruito per reggere qui: `risolvi_progetto` verifica
   l'appartenenza a ogni indirizzo, `confine()` fa lo stesso nella console. Il gateway li eredita,
   non li rifà.

## Le decisioni (maintainer, 09-10-2026)

### Le quote sono due

- **Il numero di progetti non è una quota.** Lo spazio lo copre già: cento progetti piccoli e uno
  grande pesano per quello che occupano, non per quanti sono. Sparisce.
- **I progetti aperti insieme sì.** Ogni progetto aperto è un container avviato, cioè memoria e
  CPU. È la quota che decide quante aziende sta su un VPS.
- **I pannelli no.** Il loro numero resta un dato utile da vedere, ma non limita niente. Cosa
  dica davvero quel numero va capito a parte (vedi «Resta aperto»).

Questo **supera la decisione 23**, che diceva «numero di progetti, spazio su disco, numero di
pannelli» e che in due punti del tronco cloud escludeva esplicitamente i progetti aperti. Le
parole del maintainer dell'08-10: «non è un problema il numero di utenti ma lo spazio, il numero
di progetti contemporanei aperti (quindi il numero di container da avviare), che saranno definiti
dall'admin globale».

### Quando il tetto è pieno, si rifiuta

Messaggio semplice: il tetto è pieno, riprova più tardi. Niente elenco di chi ha aperto cosa,
nessuno spegnimento automatico per far posto. Chi ha aperto un progetto non se lo ritrova chiuso
perché qualcun altro ne voleva uno.

### Un container si spegne quando nessuno è più collegato

Il segnale è il **browser**: finché una finestra è aperta su quel progetto c'è un WebSocket
attivo. Chiusa l'ultima, parte un timer; allo scadere il container si spegne. Riaprendo il
progetto riparte, con qualche secondo di attesa.

Predefinito **20 minuti**, modificabile dalla console.

Si è scartato «nessuna richiesta HTTP da N minuti» perché una scheda dimenticata aperta continua a
fare richieste da sola, e il container non si spegnerebbe mai.

### Il gateway è un container, dietro Traefik

Come gli altri servizi del VPS. Traefik, che c'è già, gli manda il traffico di `sws.soligo.net`.
Si aggiorna come ogni altra immagine.

Deve però poter avviare e fermare altri container, e questo da dentro un container va concesso
apposta: **è la prima cosa da provare**, prima di scrivere codice.

### `sws.soligo.net` diventa il gateway

L'IDE a istanza singola che gira lì adesso si spegne. I progetti che ci sono si rifanno o si
ricaricano. Un indirizzo solo, nessuna convivenza.

### Già deciso altrove

Al container di un progetto si monta **solo la cartella del progetto** (decisione 25). Quindi non
vede `identita.db`, e l'identità di chi sta lavorando gli arriva dal gateway. Non c'è niente da
decidere: la decisione 25 risponde già.

## Resta aperto

- **Cosa ci dice il numero di pannelli.** Il maintainer: «può essere un dato statistico utile, non
  una quota, ma dobbiamo analizzare con un dettaglio maggiore cosa ci dice questa informazione».
  Fino ad allora la colonna `max_pannelli` non si tocca e la console non la mostra.
- **Un container può avviarne un altro?** Podman rootless, accesso al socket. Da provare sul VPS.
  Dal risultato dipende se il gateway resta un container o diventa un servizio della macchina.

## Il primo passo concreto

**Pubblicare l'immagine amd64 su ghcr.** Il gateway gira su x86 e la 2.12.0 ha pubblicato solo
`arm64`. `scripts/build_container_x86_64.sh` esiste e conosce già i tag `latest-amd64` e
`rc-amd64`; il login su ghcr c'è e l'albero è pulito. Serve l'autorizzazione del maintainer —
pubblicare è un'azione verso l'esterno — e un occhio al disco, al 98%.

Poi la prova di podman dentro un container. Il codice del gateway viene dopo tutti e due.
