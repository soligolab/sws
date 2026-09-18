# L'immagine di boot del pannello: disegnarla nell'IDE, e installarla al deploy

> **Come si legge questo piano.** Nasce dalla scheda Q13 di `docs/OPEN_QUESTIONS.md`, spostata
> qui il 18-09-2026 per decisione del maintainer: le domande non vivono più in un elenco,
> diventano file di piano. **Il testo della scheda è riportato integralmente più sotto**, non
> riassunto.
>
> ⚠️ **Quando si prenderà in mano questo lavoro, la prima cosa da fare è una sessione di plan
> approfondita.** Quello che segue è materiale, non un piano d'esecuzione.

## Com'è cambiata la domanda

La scheda originale (01-08-2026) chiedeva una cosa sola: *come arrivano gli sfondi di boot su un
pannello Pixsys reale?* La risposta di allora era «non lo sappiamo, serve il pannello sotto mano»,
e il maintainer aveva scelto di rimandare.

Il 18-09-2026 la domanda è diventata **due cose concrete**, e la seconda ha una risposta tecnica
già trovata da lui sul campo:

1. **Disegnare l'immagine di boot nell'IDE**, invece di preparare dei PNG a parte.
2. **Installarla sul dispositivo al deploy**, via D-Bus, dove il prodotto lo permette (tipicamente
   i pannelli Pixsys).

---

## 1. Una «pagina» statica che si esporta come PNG

L'idea, parole del maintainer:

> «Permettere dall'IDE di generare una immagine di Boot usando gli oggetti dell'IDE. In pratica
> sarà un tipo speciale di "Pagina", statica ma dove riuseremo gli oggetti Web a disposizione e di
> cui potremo esportare il .png a risoluzione definita per darlo all'utente da caricare nel
> pannello manualmente.»

Quello che rende l'idea economica è che **non serve un editor nuovo**: è il canvas che c'è già,
con i widget che ci sono già, in una pagina che dichiara di essere statica. Chi sa disegnare un
sinottico sa disegnare uno splash.

### Cosa andrà verificato nella sessione di plan

- **Cos'è «statica», esattamente.** Una pagina di boot non ha tag vivi, non ha comandi, non ha
  allarmi: metà delle proprietà dei widget non hanno senso. Va deciso se è un `kind` di pagina
  nuovo, un flag su `page_layout`, o un tipo di documento a sé — e cosa fa il pannello proprietà
  davanti a un `button` in una pagina che non può ricevere un tocco.
- **La risoluzione.** Il PNG va esportato alla risoluzione del pannello, che non è
  necessariamente quella della pagina. `docs/branding/boot-backgrounds/` aveva già lo scaffold per
  **sei** risoluzioni: se ne prende l'elenco, o lo si sostituisce con un campo libero?
- **Come si rasterizza.** Sul web c'è l'SVG del canvas, e il runtime ha già `resvg`+`tiny-skia`
  (Q15/Q16) per rasterizzare SVG. Andrà deciso se esportare dal browser o dal runtime: il secondo
  dà lo stesso risultato su ogni macchina, il primo è più immediato.
- **Il motore LVGL non c'entra.** Questa pagina non la disegna il viewer: è un'immagine prodotta
  in fase di progettazione. Vale la pena scriverlo, perché la regola «WYSIWYG su entrambi i
  motori» qui **non si applica**, ed è l'unica eccezione che mi viene in mente.

---

## 2. Installarla al deploy, via D-Bus (Pixsys)

> «Nei casi in cui il prodotto lo permetta (tipicamente prodotti Pixsys) implementare la funzione
> dBus per configurare l'immagine di boot al deploy dello strumento.»

Il maintainer ha già trovato e verificato il meccanismo sul dispositivo. Le note qui sotto sono
sue, e **vanno lette prima di scrivere lo script**: contengono una trappola che non si vede
provando.

### Il comando che funziona

```sh
busctl --system call net.pixsys.Config1 /net/pixsys/Config1/Launcher \
    net.pixsys.Config1.Launcher SetBackgroundImage s "/tmp/boot.png"
```

Funziona, **ma non per il motivo che sembra**, e vale la pena saperlo prima di metterlo in uno
script.

### Il dettaglio che cambia tutto

Il metodo non accetta un path del filesystem: è progettato per prendere un path **relativo al
mount point USB**. Nel codice del launcher:

```rust
let mut usb_image_path = main_config.config.usb_storage.mount_point.clone();  // "/run/media"
usb_image_path.push(path);
```

Quindi l'uso previsto è `SetBackgroundImage s "sda1/branding/boot.png"`, cioè quello che
restituisce `USBDrives.GetImages`.

Il caso con un path assoluto funziona perché **`PathBuf::push` in Rust, con un path assoluto,
sostituisce l'intero path** invece di concatenarlo. Verificato compilando:

```
push("boot.png"          ) -> /run/media/boot.png
push("/tmp/boot.png"     ) -> /tmp/boot.png            <-- esce dal mount point
push("../../tmp/boot.png") -> /run/media/../../tmp/boot.png
```

**È comportamento non voluto, non una feature documentata**: nessuno ha scritto quel metodo
pensando di accettare path assoluti. Se un domani qualcuno normalizza l'input — ed è una
correzione ragionevole, visto che oggi si può leggere qualsiasi file del filesystem — uno script
che si appoggia a questo smette di funzionare senza preavviso.

> **Conseguenza per noi**: lo script di deploy deve **copiare il file sotto `/run/media/…` e
> passare il path relativo**, non passare un path assoluto. Costa una riga in più e non dipende da
> un difetto altrui.

### Cosa succede davvero

Il file viene copiato in `/etc/pixsys/pixsys-launcher/assets/boot.png` e il path della copia
finisce in `pixsys-launcher.toml`. Quindi il fatto che `/tmp` sia tmpfs non è un problema:
l'originale può sparire al reboot, la copia sta sull'overlay persistente di `/etc`. L'eventuale
immagine precedente viene cancellata.

Tre vincoli reali:

1. **Estensione** `png`, `jpg` o `jpeg`, maiuscole/minuscole indifferenti. Controlla solo
   l'estensione, **non il contenuto**: un file non-PNG rinominato passa il check e poi il launcher
   non lo mostra.
2. **Nessun controllo polkit** su questo metodo: lo può invocare qualunque utente locale sul
   system bus.
3. **Non ha effetto immediato**: `pixsys-launcher` legge il TOML all'avvio.

### Sequenza completa

```sh
# 1. imposta
busctl --system call net.pixsys.Config1 /net/pixsys/Config1/Launcher \
    net.pixsys.Config1.Launcher SetBackgroundImage s "/tmp/boot.png"

# 2. verifica: ritorna SOLO il nome file, non il path
busctl --system call net.pixsys.Config1 /net/pixsys/Config1/Launcher \
    net.pixsys.Config1.Launcher GetBackgroundImage
# s "boot.png"        ("Default" se non c'è nessuna immagine custom)

# 3. conferma che la copia esista
ls -l /etc/pixsys/pixsys-launcher/assets/
grep background_image_path /etc/pixsys/pixsys-launcher.toml

# 4. applica
systemctl restart pixsys-launcher.service     # oppure un reboot pulito
```

Per tornare all'immagine di fabbrica (cancella anche il file copiato):

```sh
busctl --system call net.pixsys.Config1 /net/pixsys/Config1/Launcher \
    net.pixsys.Config1.Launcher ResetBackgroundImage
```

### Cosa andrà deciso nella sessione di plan

- **Dove sta il pezzo D-Bus.** Il deploy verso un dispositivo oggi passa dalle API; questo è un
  comando locale sul dispositivo. Va deciso se lo esegue l'installer, il runtime del pannello, o
  uno script chiamato dal deploy — e cosa succede sui dispositivi che `net.pixsys.Config1` non ce
  l'hanno (la gran parte del mondo).
- **Il riavvio.** L'immagine non si vede finché `pixsys-launcher` non riparte. Un deploy che
  riavvia il launcher di un pannello in servizio è un effetto collaterale da dichiarare, non da
  fare di nascosto.
- **«Nessun controllo polkit»** vuol dire che chiunque sul dispositivo può cambiare lo splash.
  Non è un problema che creiamo noi, ma è un fatto da scrivere dove qualcuno lo leggerà.

---

## 3. Resta la domanda originale

Le due cose sopra coprono lo splash **del launcher Pixsys**. La scheda originale parlava del boot
splash **OS-level** (psplash o equivalente), che è un'altra cosa e arriva prima: quella parte
resta senza risposta, e resta legata alla stessa condizione di allora — il maintainer con il
pannello sotto mano.

---

## Dalla scheda Q13 — Come arrivano davvero gli sfondi di boot su un pannello Pixsys reale?

**Context**: emerso il 2026-08-01 preparando lo scaffold per gli export PNG del brief (6 risoluzioni,
`docs/branding/boot-backgrounds/`). Sono pensati per il boot splash **OS-level** del pannello Pixsys,
ma nessun meccanismo del genere esiste oggi in questo repo — verificato con grep su `docs/`,
`deploy/`, `scripts/`, `sws-editor/src/`: nessun riferimento a psplash o equivalente. Il kiosk SWS
(`sws-kiosk`) apre solo una URL fullscreen dopo che il sistema è già partito; non gestisce lo splash
di boot.

**Options**:
1. Consegna manuale al maintainer, che li carica con lo strumento di configurazione Pixsys — nessuna
   integrazione in questo repo, mai.
2. Se Yocto/Pixsys espone una recipe per il boot splash, documentarla in `docs/YOCTO_CROSSCOMPILE.md`
   e versionare gli asset finali lì invece che in `docs/branding/`.

**Default for PoC**: opzione 1 — richiede la conoscenza del maintainer sul tooling Pixsys reale, non
deducibile dal codice.

**Decided**: not yet — il maintainer ha scelto (2026-08-21) di **rimandare**: la domanda resta
aperta finché non avrà il pannello sotto mano per verificare il meccanismo reale.

> *Aggiornamento 18-09-2026: il pannello l'ha avuto sotto mano, e la parte «launcher» ha una
> risposta — sta in §2. La parte OS-level no.*
