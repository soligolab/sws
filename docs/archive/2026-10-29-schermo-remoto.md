# Lo schermo del pannello dal cloud — piano d'esecuzione

> Sessione di plan del 29-10-2026, nata da una domanda del maintainer: dall'IDE su sws.soligo.net, il tasto «Viewer»
> per aprire in una scheda lo schermo del pannello. Le decisioni sono sue; il resto è misurato nel codice lo stesso
> giorno.

## Le decisioni del maintainer (29-10-2026)

1. **La pagina operatore web del pannello, attraverso il tunnel.** Non i pixel dello schermo (su un TC620 o un WP630
   il disegno è di LVGL, qui si vede quello del browser), ma le stesse pagine coi valori veri, cliccabili. È
   un'**anteprima dell'accesso remoto** al pannello, al posto di soluzioni pesanti come VNC.
2. **Come chi sta davanti allo schermo**: si entra **senza login del pannello**, con quello che il progetto permette
   a chi non ha fatto l'accesso; se vuole, l'utente fa il login con gli utenti del progetto, come sul pannello.
3. **Chi lo apre**: chi appartiene all'azienda del pannello — le stesse persone che oggi possono collegargli l'IDE.
4. **Acceso da subito** su ogni pannello abbinato, **spegnibile per pannello** dalla console. Ogni apertura si registra.
5. **La pagina è quella del pannello**: HTML, script e dati arrivano tutti dal pannello, quindi sono della stessa
   versione anche con un pannello non aggiornato. Il gateway non ci mette del suo.
6. **Si apre dal tasto Viewer** dell'IDE collegato a un pannello, e da un link per pannello nella console.

## Misurato il 29-10-2026

| Pezzo | Oggi | Cosa vuol dire qui |
|---|---|---|
| Il tasto Viewer | `ViewerLink.tsx` ricava la pagina operatore dalla porta (`viewerUrlFromAdmin`: porta di gestione − 1). Nel cloud l'indirizzo del pannello è `https://sws.soligo.net/dev/<pannello>`, **senza porta**, quindi il tasto **non compare** | Serve un indirizzo per lo schermo, non una porta |
| Il tunnel | `/dev/<pannello>/*` (`tunnel/gateway.rs::inoltra`): controlla l'azienda (`puo_parlargli`, 404 se non è tua), aggiunge la firma del gateway (`x-sws-dal-gateway`), apre uno stream e ci parla HTTP; i websocket passano già (`attraverso`, 10-10-2026) | La strada c'è. Ma **ogni stream va alla porta di gestione** del pannello (`tunnel/pannello.rs`: `127.0.0.1:<porta_gestione>`), cioè la 7444; la pagina operatore sta sulla 7443 |
| La firma del gateway | il pannello la verifica col suo token (`abbinamento.rs`, `INTESTAZIONE_GATEWAY`) | Il pannello sa riconoscere una richiesta che viene dal suo gateway |
| L'autenticazione nel cloud | gettone `Bearer` in `localStorage`, nessun cookie | Una **scheda nuova** e un **websocket** non possono mandare quell'intestazione: aprire `/schermo/…` direttamente non avrebbe niente con cui farsi riconoscere dal gateway |
| La pagina operatore | `index.html` con percorsi **assoluti** (`/assets/main-….js`, `/fonts/font.css`, `/avvio-tema.js`), Vite con base `/` | Sotto un prefisso (`/schermo/<pannello>/`) quei percorsi finirebbero al gateway, cioè alla versione del cloud: contro la decisione 5 |
| Il prefisso nel client | `api/prefisso.ts`: riconosce solo `/p/<azienda>/<progetto>` | Va esteso al prefisso dello schermo, così API e websocket vanno al pannello |

## Il disegno

**Indirizzo**: `https://sws.soligo.net/schermo/<pannello>/`.

**Il biglietto.** Dall'IDE (o dalla console) si chiede al gateway, col gettone di sempre,
`POST /api/pannelli/<pannello>/schermo`. Il gateway controlla azienda e interruttore del pannello e risponde con un
indirizzo monouso, `…/schermo/<pannello>/?biglietto=<codice>` (valido pochi secondi). Aprendolo, il gateway scambia il
codice con un **cookie tecnico** `HttpOnly`, `Secure`, `SameSite=Strict`, ristretto al percorso
`/schermo/<pannello>/`, legato alla sessione cloud (scade con lei, al massimo 8 ore), e rimanda alla pagina. Da lì
pagina, script, API e websocket portano il cookie da soli. Il gateway lo verifica a ogni richiesta, **lo toglie**
prima di passare nel tunnel (il pannello non vede mai le credenziali del cloud), e aggiunge la sua firma.

L'intestazione `Authorization` resta libera e passa com'è: è quella del **login del pannello**, se l'utente lo fa.
Così le due autenticazioni non si toccano.

**Sul pannello**: una rotta `/schermo/*` sulla porta di gestione che inoltra alla **propria pagina operatore**
(`127.0.0.1:<porta viewer>`), websocket compresi, **solo con la firma del gateway valida**. Senza firma risponde 404:
la porta di gestione è raggiungibile in rete locale, e non deve diventare una seconda porta della pagina operatore.
Il tunnel non cambia.

**La pagina sotto un prefisso.** È il punto tecnico da sciogliere per primo (passo 1): i percorsi assoluti della
pagina operatore vanno resi relativi al prefisso, senza rompere l'IDE nel cloud e il pannello in rete locale. Due
strade da provare: la base di Vite relativa (`./`), o l'indirizzo degli asset calcolato a runtime
(`experimental.renderBuiltUrl`) più `index.html` con percorsi relativi. Il gateway **non** riscrive l'HTML.

**Interruttore e registro.** Nella console, scheda Pannelli: «Schermo remoto», acceso di default, lo cambia un
amministratore dell'azienda. Il gateway registra ogni apertura (chi, quale pannello, quando) nel registro delle
attività.

## Il lavoro

Un ramo, `feat/schermo-remoto`, in quattro passi; ognuno verificabile da solo.

1. **La pagina operatore sotto un prefisso.** La prova prima di tutto: la stessa build servita alla radice (pannello in
   LAN), sotto `/p/<azienda>/<progetto>/` (IDE nel cloud) e sotto `/schermo/<pannello>/`. Prefisso nel client esteso.
2. **Il pannello**: `/schermo/*` sulla porta di gestione, con la firma, HTTP e websocket. Test: senza firma 404, con
   la firma la risposta della pagina operatore, un websocket che passa.
3. **Il gateway**: il biglietto, il cookie, la rotta `/schermo/<pannello>/*` sopra `attraverso`, l'interruttore per
   pannello nel registro degli abbinati e nella console, la riga nel registro delle attività. Test: azienda sbagliata
   404, interruttore spento 404, cookie di un altro pannello rifiutato, il cookie non arriva al pannello.
4. **Le entrate**: il tasto Viewer dell'IDE quando è collegato a un pannello dal cloud, il link nella console; un
   pannello di una versione che non conosce `/schermo` dice «aggiorna il pannello», non una pagina bianca.

Poi i documenti: manuale (capitolo 18, container e comunicazione; capitolo 04, il tasto Viewer), l'**informativa
privacy** (`docs/legale/`: oggi dice «nessun cookie»; questo è un cookie tecnico, senza consenso, ma va scritto),
CHANGELOG, NOVITA, collaudi.

## Verifica

- Le cinque voci della *definition of done*.
- Dal vivo: dal cloud, IDE collegato a `tc620-garage`, tasto Viewer → la pagina operatore di CasaDomotica coi valori
  veri; un comando dalla scheda arriva al campo come dal pannello; login con un utente del progetto e uscita.
- Interruttore spento dalla console: il tasto dice perché non si apre.
- Un utente di un'altra azienda, con l'indirizzo copiato: 404.

## Fuori, dichiarato

- **I pixel veri dello schermo LVGL** (un'immagine aggiornata ogni pochi secondi): è l'altra strada vista il
  29-10-2026, scartata per ora. Resta utile per vedere le differenze di disegno di LVGL.
- **Chi sta guardando**: il pannello non sa che qualcuno lo guarda da remoto, e non lo mostra a chi ha davanti lo
  schermo. Se servirà, è un lavoro a parte.
- **Lo schermo senza cloud**, in rete locale: c'è già, è la porta 7443.

## Stato (29-10-2026, sera)

**Fatto e validato dal maintainer, archiviato il 29-10-2026.** I quattro passi sono entrati in `main` con lo squash
`b4b0330b` e sono usciti nella **2.23.7**. Il maintainer l'ha provato dal cloud, col gateway e il pannello alla
2.23.7: «funziona perfettamente lo schermo remoto». Il limite qui sotto è diventato il seme
[lo schermo del pannello su un'origine sua](../plans/2026-10-29-schermo-su-un-origine-sua.md).

Quello che è andato diverso dal disegno, detto qui:

- **L'interruttore lo cambia chi amministra la piattaforma**, non l'amministratore dell'azienda: la pagina *Pannelli*
  della console è della piattaforma (stato, ban, spostamento). Portarla agli amministratori d'azienda è un lavoro a
  parte, che vale per tutte le colonne, non solo per questa.
- **Il cookie è legato alla sessione cloud davvero**: a ogni richiesta il gateway ricontrolla il gettone di chi ha
  aperto lo schermo e la sua appartenenza all'azienda del pannello. Logout, scadenza, uscita dall'azienda o pannello
  spostato chiudono lo schermo subito, non dopo 8 ore.
- **Il login dello schermo ha una chiave sua** in `localStorage` (`sws.auth@/schermo/<pannello>`). La pagina sta
  sulla stessa origine dell'IDE del cloud: con la chiave di sempre avrebbe mandato al pannello il gettone del cloud,
  e un login nello schermo avrebbe sostituito quello dell'IDE nelle altre schede.
- **I risultati 403/503/409 del biglietto** dicono perché lo schermo non si apre (spento, pannello non collegato,
  pannello dichiarato a mano), e il tasto lo mostra accanto a sé.

### Limite da decidere: la pagina del pannello sull'origine del cloud

La decisione 5 («la pagina è quella del pannello») vuol dire che HTML e script **scritti dal pannello** girano
sull'origine `sws.soligo.net`. Con il pannello nostro, che serve la nostra immagine, è la stessa pagina che gira in
rete locale. Ma un pannello **manomesso** (accesso fisico, root) potrebbe servire uno script che legge dal
`localStorage` di quell'origine il gettone cloud di chi apre il suo schermo — anche di chi amministra la
piattaforma, dal link della console. La chiave separata del login non basta: lo script può leggere tutte le chiavi.

La strada che chiude il problema è un'**origine separata** per gli schermi (un sottodominio, per esempio
`schermo.sws.soligo.net`, o uno per pannello), dove il gettone del cloud non c'è: il biglietto si scambia lì, e il
cookie nasce lì. Costa un nome DNS e un certificato in più su Traefik. Da decidere prima che lo schermo esca dalla
prova con i due clienti di oggi.

