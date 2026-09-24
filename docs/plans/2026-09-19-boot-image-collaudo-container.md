# Immagine di boot: il giro completo col runtime nel container

> **Come si legge questo file.** Seme di piano, nato il 19-09-2026 chiudendo T-72 (l'immagine di boot del
> pannello, `docs/archive/2026-09-18-immagine-di-boot.md`): tiene ciò che a T-72 è rimasto «non fatto», con le
> misure di quel giorno, perché non vada perso. Categoria: **verifica**.

⚠️ **Quando si prenderà in mano questo lavoro, la prima cosa da fare è una sessione di plan
approfondita** per sviscerarne tutti i dettagli. Quello che segue è materiale, non un piano
d'esecuzione: le misure hanno la data che hanno, e il codice nel frattempo si muove.

## Cosa è stato provato e cosa no

Il 19-09-2026, sul TC620 `tc620-a-p3-c6-07aff9` (PixsysOS 2.1.1, appena formattato) come `user`: la **metà host**
— le unit `sws-boot-image.{path,service}` e `sws-boot-image-apply.sh`, con un PNG 1280×800 e un trigger scritti
**a mano** — installa l'immagine, `GetBackgroundImage` risponde `boot.png`, e il maintainer ha visto l'immagine
al riavvio. La **metà runtime** (`sws-web/src/boot_image.rs`) è coperta dai test con cartelle temporanee, ma
**non è mai girata nel container sul dispositivo**: l'immagine del container non è stata ricostruita.

## Il disegno cambia: niente unit sull'host, D-Bus dal container (24-09-2026)

**Vincolo del maintainer, detto oggi**: «nell'host non puoi toccare nulla, tutto deve essere fatto
con chiamate dBus dal container».

Il disegno attuale fa il contrario, ed è per questo che il collaudo si è fermato. Oggi funziona così:
il runtime nel container scrive due file (`boot-image/boot.png` e `boot-image/trigger`); sull'host
tre pezzi installati da `install-container.sh` — `sws-boot-image.path` che osserva il `trigger`,
`sws-boot-image.service` che lo esegue, e `sws-boot-image-apply.sh` che fa la chiamata vera:

```
busctl --system call net.pixsys.Config1 /net/pixsys/Config1/Launcher \
    net.pixsys.Config1.Launcher SetBackgroundImage s "<percorso>"
```

Il file `trigger` esiste solo perché un container **non chiama D-Bus**: serviva qualcuno sull'host a
farlo per lui. Se il container ci arriva da solo, `trigger`, `status`, `applied`, le tre unit e lo
script spariscono tutti insieme, e con loro il collaudo dei permessi fra i due mondi.

### Misurato sul WP630 il 24-09-2026

| | |
|---|---|
| socket del bus di sistema sull'host | `/run/dbus/system_bus_socket`, `srw-rw-rw-` (chiunque può connettersi) |
| il container lo vede | **no**: non è montato dal quadlet (che monta solo config, projects, logs, devicetree) |
| `busctl` dentro l'immagine | **non c'è** |
| il launcher risponde | **sì**: `SetBackgroundImage(s)`, `GetBackgroundImage() → s`, `ResetBackgroundImage()` |

Quindi la strada è aperta e mancano due cose, entrambe piccole: **montare il socket** nel container e
**parlare D-Bus dal runtime**.

**Quando questo lavoro comincerà, la prima cosa è una sessione di plan approfondita**, perché le
domande vere sono di disegno e non di codice:

- **`zbus` nel runtime o `busctl` nell'immagine?** Una libreria Rust toglie una dipendenza esterna e
  dà errori tipizzati; `busctl` è una riga di shell e un binario in più da installare.
- **Il socket montato è una porta aperta**: da dentro il container si raggiunge *tutto* il bus di
  sistema, non solo il launcher. Va deciso se va bene su un prodotto, o se serve un filtro.
- **Chi dice com'è andata**: oggi lo dice `status`, scritto dall'host e letto dalla scheda Runtime.
  Se la chiamata la fa il runtime, l'esito ce l'ha già in mano e `status` può sparire — ma la scheda
  va cambiata di conseguenza.
- **Il quadlet è comunque un file sull'host**: `sws-runtime.service` esiste già e va modificato per
  montare il socket. «Non toccare l'host» va inteso come «non aggiungere pezzi nuovi», non come
  «non cambiare quello che c'è»; da confermare col maintainer.

## Cosa resta da vedere

1. `./scripts/build_container.sh` (aarch64), poi `install-container.sh` sul dispositivo: le tre unit si installano
   da sole e `sws-boot-image.path` risulta attiva (l'installer lo controlla e lo dice).
   **Stato al 24-09-2026**: le unit **non sono installate** sul WP630 (`systemctl list-unit-files | grep boot` è
   vuoto, e il dispositivo era stato ripulito apposta il 19-09). Quindi il `trigger` che il container scrive non
   lo legge nessuno e `status` non viene mai creato: è questo, oggi, a bloccare i punti 2, 4 e 5 — non i permessi.
2. Dall'IDE: progetto con una pagina di boot abilitata e il PNG generato → deploy → `boot-image/` compare in
   `/data/user/sws/config/` → `status` scritto dall'host → la riga «Immagine di boot» della scheda Runtime.
3. ~~**Permessi fra container e host**~~ — **misurato il 24-09-2026 sul WP630, non è un problema.** La cartella
   che il container rootless crea è `user:setup-user` con modo `755`, e dentro ci sono `boot.png` e `trigger`
   scritti dal container. L'utente host **può scrivere** in quella cartella (provato creando e togliendo un file):
   è lui il proprietario. Restava il dubbio per via della mappatura degli uid di podman rootless; non si pone.
4. Un deploy **senza** pagina abilitata: `trigger` = `none`, stato `nessuna_immagine`, l'immagine del dispositivo
   intatta.
5. Un PC/scheda **senza** launcher: stato `non_supportato`, nessun errore.

## Da sapere prima di cominciare

Il ripristino sul dispositivo di prova: `busctl --system call net.pixsys.Config1 /net/pixsys/Config1/Launcher
net.pixsys.Config1.Launcher ResetBackgroundImage`. Il dispositivo è stato ripulito il 19-09 (unit e file tolti).

