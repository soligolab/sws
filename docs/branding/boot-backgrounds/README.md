# Boot/login backgrounds — pannelli Pixsys

Cartella di atterraggio per gli sfondi di boot/login generati esternamente a partire dal prompt in
`../BRAND_SWS.md` (sezione "Sfondi di boot/login per pannelli Pixsys").

**Questi file non sono referenziati da codice**, ma da T-72 c'è un percorso per portare un'immagine su un
pannello: nell'IDE si crea una *pagina di boot* (sezione «Immagini di boot»), ci si mette dentro l'immagine
(oggetto «Immagine», caricata fra le immagini di progetto), la si abilita e si fa il deploy — il launcher Pixsys
la mostra al prossimo avvio. Vedi `docs/HOWTO.md` §17. Lo splash **OS-level** (prima del launcher) resta aperto:
`docs/plans/` → seme dell'immagine di boot, Appendice B (ex Q13).

## File attesi

Master a 1920×1080, poi un export per ciascuna risoluzione target:

- `480x272.png`
- `800x480.png`
- `1280x768.png`
- `1280x800.png`
- `1366x768.png`
- `1920x1080.png`

Quando arrivano, si caricano nell'IDE come immagine di progetto e si mettono in una pagina di boot alla
risoluzione giusta; questa cartella resta il riferimento per gli originali.
