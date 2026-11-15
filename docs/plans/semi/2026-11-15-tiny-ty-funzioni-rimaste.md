# Tiny TY e pannello di controllo: quello che resta dopo la rc.19

> **Seme — decisione.** Staccato il 15-11-2026 chiudendo i piani [funzioni di
> tyx_panelcontrol](../../archive/2026-11-14-funzioni-di-tyx-panelcontrol.md) e [la
> rotazione](../../archive/2026-11-15-rotazione-dello-schermo.md). **Quando questo lavoro comincerà, il primo passo è
> una sessione di plan approfondita e dedicata** per sviscerarne tutti i dettagli: qui ci sono solo l'elenco e le
> misure di oggi.

## Funzioni di `tyx_panelcontrol` non ancora riprese

- **IP statico sul Wi-Fi** (tutti i prodotti con NetworkManager). La scheda IPv4 della sezione Rete sulla connessione
  Wi-Fi attiva, con la conferma entro 60 s. Oggi si imposta solo la rete cablata.
- **Sezione Servizi** (solo Tiny TY): cosa gira (PLC, Device Finder, VNC, server web, PixsysPortal) e un interruttore
  per quelli che si possono spegnere senza rompere il sistema. Da misurare quali servizi esistono dopo la rimozione di
  `tyx_panelcontrol`.
- **Beep, luce e oscuramento del progetto anche sui TC/WP**, tramite `net.pixsys.Config1`. Da misurare: le unità di
  `SetIdleTimeout` e `SetBrightness`, e se il beep di Pixsys ha solo acceso/spento.
- **Backup su chiavetta USB**: aspetta PixsysOS 2.2.0 o successivo, che lo offre (decisione del maintainer,
  15-11-2026: «è meglio fare il lavoro su PixsysOS 2.2.0 o successivo»). Non si misura niente sulla 2.1.3.

## Rotazione: da collaudare e da finire

- **Progetto verticale sul TY570** (disegno, tocco, angoli, schede del pannello in alto, immagine di avvio girata).
- **TC/WP**: il runtime scrive `Display.SetRotation` (1 = 90° orari; 2 e 3 da confermare a vista) e il pannello si
  riavvia una volta; mai provato sul TC620 con un progetto verticale.
- **Touch resistivo calibrato** (TY750/770): una calibrazione fatta a schermo girato contiene già la rotazione, quindi
  va rifatta dopo un cambio di rotazione. Non c'è un resistivo per provarlo.

## Wi-Fi

- Una chiavetta Realtek 8188 con driver `r8188eu` (wext) non si collega alle reti WPA2/WPA3 miste; una RTL8723BU
  (`rtl8xxxu`, nl80211, firmware portato dal pacchetto) sì. Domande a Pixsys in `deploy/tiny-ty/ty570-1ad-p1.md` §14 e
  §15. La rete di casa non inoltra il DHCP dei client Wi-Fi al cavo (provato il 15-11-2026): da sistemare sul router.

## Altre cose già scritte

- `deploy/tiny-ty/ty570-1ad-p1.md` §13: una chiavetta con `autorun.sh` viene eseguita come root dalla regola udev di
  Pixsys. Segnalato a Pixsys, non toccato.
