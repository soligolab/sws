# C4 — TLS acceso di default sul pannello

> **Misurato sul codice il 23-10-2026.** La voce C4 di
> [`2026-10-15-piano-prima-fascia-e-cra.md`](2026-10-15-piano-prima-fascia-e-cra.md) è marcata
> `[plan]` e la sua domanda aperta sta alla riga 64 di quel file: «come arriva la fiducia nel
> certificato del pannello (pinning all'abbinamento?)». Questo file porta la misura, il pezzo
> già fatto, e le domande che restano al maintainer.
>
> Il piano CRA dice che C4 e **P6** (2FA/LDAP) condividono una sola sessione di plan. Resta vero
> per il pezzo 3; i pezzi 1 e 2 no, e il pezzo 1 è già chiuso.

## Com'è fatto oggi, in una riga

Il TLS si accende perché **esiste un file**, e per nient'altro: `main.rs:517`, «se
`config/tls.crt` c'è, parti in TLS». Nessun flag, nessuna variabile d'ambiente, nessuna riga di
configurazione — `grep SWS_TLS` nel repo non trova niente. E **nessuno semina mai quel file**: la
funzione che genera un certificato esiste in due copie gemelle (`main.rs:2186` e
`system.rs:1000`) ma la chiamata nel runtime sta **dentro** l'`if ...exists()`, cioè serve solo a
riparare un certificato illeggibile, mai a crearne il primo. L'unico seme vero è
`POST /api/system/tls/generate`, il pulsante nella card dell'IDE.

## Quello che c'è già, ed è più di quanto sembrasse

- **Il motore della fiducia è finito e condiviso.** `sws_core::pin_tls` prova **prima** le
  autorità pubbliche (serve al gateway con Let's Encrypt) e solo se falliscono applica la fiducia
  al primo contatto per impronta SHA-256, rifiutando se l'impronta cambia. Lo usano tre
  consumatori indipendenti con tre archivi: l'IDE verso i dispositivi, il plugin MQTT, il viewer
  LVGL. Il «dimentica» c'è come rotta e come pulsante, e **non è mai automatico**.
- **mDNS annuncia già lo schema** (`scheme` nelle TXT, `https` quando la proprietà manca): la
  scoperta è già pronta a un pannello in HTTPS.
- **Il pannello ha già un segreto mostrato fisicamente**: il codice di abbinamento, 80 bit,
  monouso, su schermo, log, installer e pagina locale.
- **Il ramo Yocto è già scritto per HTTPS**: unit, installer e launcher. Lì C4 è quasi solo
  allineare la realtà alla documentazione.

## Pezzo 1 — lo schema non si scrive più a mano — **FATTO** (23-10-2026)

Ramo `fix/c4-schema-non-cablato`. Non cambia il comportamento di un pannello in chiaro, e
**correggeva un difetto vivo**, non un rischio futuro.

Il controllo di salute delle due immagini chiedeva `/health` solo in chiaro, e il quadlet del
runtime ha `Notify=healthy`: il servizio risulta avviato solo quando quel comando passa.
Accendere il TLS dall'IDE non si vedeva subito — `system_reboot` è un `exec()` in posto e systemd
non vede nessun riavvio — ma al **primo riavvio vero** l'unità non sarebbe mai diventata sana, e
con `Restart=always`/`RestartSec=5` il pannello sarebbe ripartito ogni cinque secondi. Un
aggiornamento sarebbe tornato indietro da solo.

Con lui gli altri tre punti cablati: il **browser del pannello** (puntato su `http://` contro una
porta che parla TLS), l'**installer del container** (indirizzi in chiaro, due sonde su tre mute),
e il **ripiego del viewer LVGL** (sapeva cambiare porta, non schema — e il suo quadlet si riscrive
solo quando un operatore lo conferma). Guardia: `scripts/check_schema_tls.sh`.

**Quello che il pezzo 1 ha lasciato fuori di proposito**: il `PublishPort` e il `--http-port` per
la pagina «accetta il certificato» sul pannello. Una misura dice di metterlo, l'altra osserva che
su uno schermo senza tastiera una pagina da leggere non è una risposta. È la domanda 2 qui sotto,
non un dettaglio.

## Pezzo 2 — il certificato — da fare, insieme al piano dei certificati

I due generatori gemelli diventano uno, perché nome e scadenza vanno cambiati una volta sola.
Oggi il certificato è **`CN=rcgen self signed cert` su ogni pannello del mondo** e **non scade
mai** (rcgen: 1975 → 4096). Il piano
[`2026-10-15-certificati-in-un-posto-solo.md`](2026-10-15-certificati-in-un-posto-solo.md) ha già
deciso nome vero e scadenza breve (decisioni 5-6) e dichiara che avviso e rinnovo sono lavoro di
C4. Mancano anche i tre eventi di audit (`tls.generate`, `tls.upload`, `tls.remove`) e le rotte
`/api/remote/system/tls`, che quel piano chiama «il presupposto di C4».

Stima: 200-300 righe per il generatore unico, più 300-400 per rinnovo e avviso.

## Pezzo 3 — il default acceso, e la fiducia — **servono le risposte qui sotto**

Stima 400-700 righe più la sessione di plan vera. **Quando questo lavoro comincia, il primo passo
è una sessione di plan dedicata e approfondita** per sviscerarne i dettagli: fra la domanda e il
lavoro passa troppo tempo perché un disegno scritto oggi resti vero.

### Le domande per il maintainer

**1. Chi accende il TLS di default?** Ogni istanza dell'immagine, o solo il ruolo «pannello»?
Il ruolo si legge già dalla riga di comando (`--gateway`, `--auth-delegata`), e **accenderlo per
tutti spegne il cloud**: il gateway raggiunge i container dei progetti su `http://…:8444` scritto
a mano (`gateway/progetti.rs:250,254`), e davanti c'è già Traefik che termina il TLS.

**2. Il browser del pannello davanti al proprio certificato autofirmato, su uno schermo senza
tastiera.** Loopback in chiaro (zero codice, ma è un'eccezione da dichiarare nel fascicolo CRA),
certificato installato nell'archivio di fiducia del pannello (la risposta pulita, ma è lavoro su
PixsysOS e il filesystem è in sola lettura fuori da `/data`), o un flag a Chromium (che oggi
riceve **solo un URL via D-Bus**: nel repo non c'è un solo flag di chromium). **È l'unica
incognita che il codice non risponde, e va provata sul TC620 prima di prometterla.**

**3. Come arriva la fiducia nel certificato — la domanda di riga 64.** Oggi l'impronta viene
memorizzata **prima** che il codice di abbinamento venga chiesto: al primissimo collegamento un
attaccante sulla rete viene memorizzato come legittimo. Le strade: lasciare il TOFU e **mostrare**
l'impronta appena memorizzata perché chi vuole la confronti con quella sullo schermo (una
ventina di righe, è il modello di SSH); una **conferma a vista obbligatoria** al primo contatto
(~150 righe più il punto dove il pannello mostra la sua impronta); oppure **legare l'impronta al
codice di abbinamento** (~400 righe, e un vincolo nuovo fra due archivi oggi indipendenti —
rigenerare il certificato dovrebbe rigenerare il codice, che è anche la chiave dell'abbinamento
al cloud).

**4. I pannelli già installati.** L'aggiornamento accende il TLS su di loro, solo sulle
installazioni nuove, o su tutti ma con un **marcatore** in `config/` che distingue «non ha mai
scelto» da «ha scelto no»? La terza è venti righe ed è la stessa regola di compatibilità appena
applicata alla policy OPC-UA, dove ha funzionato.

**5. La scadenza, e chi si era già fidato.** Il piano dei certificati ha scelto «uno o due anni
con avviso e rinnovo». La misura aggiunge un dettaglio che lì non c'era: **ogni rinnovo rompe il
pinning di chiunque si fosse già fidato**, perché il verificatore confronta l'impronta della
foglia e basta. Così com'è, ogni due anni ogni IDE e ogni viewer LVGL del campo mostra
«certificato cambiato» e qualcuno deve premere «dimentica».

## Ordine

**C4 prima, vista Certificati dopo.** Lo dice il piano dei certificati di sé stesso: la decisione
2 è «il presupposto di C4», le decisioni 5-6 sono «lavoro di C4, non della vista». Costruire la
vista prima vorrebbe dire costruirla due volte.
