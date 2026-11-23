# Più servizi VPN nei pannelli: ZeroTier e OpenVPN (seme, 23-11-2026)

> **Seme — decisione.** Quando questo lavoro comincia, **il primo passo è una sessione di plan dedicata e
> approfondita** che ne sviscera tutti i dettagli. Quello che segue è l'idea e le misure di oggi, non un progetto: fra
> la domanda e il lavoro cambia troppo, e un disegno scritto mesi prima è un disegno che mente.

## L'idea

Il maintainer, 23-11-2026: «nei pannelli prevedere più servizi vpn, uno è zerotier che uso a casa, uno è openvpn che i
pannelli pixsys con PixsysOS già supportano».

Cioè: dal pannello di SWS si può mettere il dispositivo **dentro una VPN del cliente**, scegliendo il servizio. I primi
due sono:
- **ZeroTier**, quello che il maintainer usa a casa (`ldap.soligo.net` risolve anche via ZeroTier, vedi STATUS del
  22-11);
- **OpenVPN**, che i TC/WP con PixsysOS supportano già.

## Cosa NON è: la decisione 38 resta

Il 05-10-2026 la **decisione 38** ha tolto la VPN come collegamento fra l'IDE del cloud e il runtime, e l'ha sostituita
con **un tunnel per dispositivo** (`tunnel.soligo.net`). Il motivo: un pannello può essere rooted dal cliente, e una
VPN comune lo metterebbe su una rete condivisa con quelli degli altri clienti
([identità, utenti e istanze](../../archive/2026-09-18-identita-utenti-istanze.md), decisioni 7-11 superate;
[cloud, utenti, aziende](../../archive/2026-10-05-cloud-utenti-aziende-spazi.md), «Regole VPN per azienda»).

Questo seme è un'altra cosa: **la VPN è del cliente**, non di SWS. SWS non ospita nessun server VPN e non mette due
clienti sulla stessa rete. Il pannello entra nella rete che il cliente ha già (la sua ZeroTier, il suo server OpenVPN),
come oggi entra nel suo Wi-Fi. Il tunnel verso il cloud resta com'è. La sessione di plan deve comunque confermarlo in
modo esplicito, perché la parola «VPN» in questo repo ha una storia.

## Le misure di oggi (23-11-2026)

- **Il pannello di controllo** di SWS gestisce già la rete del sistema operativo via **D-Bus**
  (`sws-web/src/control_panel/dbus.rs`, `backend.rs`): NetworkManager (schede, Wi-Fi, hotspot), `timedate1`,
  `login1`. È lo stesso su TC/WP (PixsysOS), Tiny TY (Ubuntu) e PC Linux; cambia chi concede i permessi (polkit).
  Mostra solo le sezioni che il dispositivo sa fare («probed, not presumed»).
  Piano: [pannello di controllo](../../archive/2026-11-13-pannello-di-controllo.md).
- **OpenVPN su PixsysOS**: fra i servizi del TY c'è `openvpn-auto-login`, e PixsysPortal ha una sua VPN con
  registrazione e password monouso ([le funzioni di tyx_panelcontrol](../../archive/2026-11-14-funzioni-di-tyx-panelcontrol.md),
  §10 e l'elenco dei servizi). Allora la raccomandazione fu «no, è un servizio Pixsys». Su TC/WP il maintainer disse il
  27-09-2026 che «esiste una implementazione openvpn predisposta», mai misurata.
- **NetworkManager** ha un plugin per OpenVPN (`NetworkManager-openvpn`): se c'è sul dispositivo, una connessione
  OpenVPN si crea e si accende con le stesse chiamate D-Bus che il pannello di controllo usa per il Wi-Fi. **Da
  verificare** su TC/WP e Tiny TY.
- **ZeroTier** non passa da NetworkManager: è un demone a sé (`zerotier-one`) con la sua API locale (porta 9993, con un
  token in un file di root) e la sua CLI. Non è installato su nessun dispositivo di prova, che si sappia.
- **Nel codice di SWS** oggi non c'è nessuna riga su ZeroTier, OpenVPN o WireGuard. Le uniche menzioni di «VPN» sono
  nei documenti (la porta 7444 «si può chiudere con una VPN», manuale capitoli 3 e 10) e nella storia archiviata.

## Le domande per la sessione di plan

1. **Dove sta il servizio VPN**: sul sistema operativo, gestito da SWS via D-Bus o API locale (come il Wi-Fi), o in un
   container accanto a `sws-runtime`? Il primo riusa quello che il dispositivo ha già (OpenVPN di PixsysOS); il secondo
   funziona uguale ovunque ma ha bisogno di `NET_ADMIN` e di `/dev/net/tun`.
2. **Chi installa ZeroTier**: il pacchetto non c'è sui pannelli. Lo porta l'immagine di SWS, l'installer
   (`install-container.sh`), o lo installa il cliente?
3. **Cosa si chiede all'utente**: per ZeroTier l'id della rete (poi l'autorizzazione si dà dal controller di ZeroTier);
   per OpenVPN un file `.ovpn` più eventuali credenziali o certificati. Dove si caricano e dove si conservano: sono
   segreti, e i pannelli sono nel perimetro del CRA ([credenziali e CRA](2026-11-07-credenziali-cra.md)).
4. **Dal pannello, dall'IDE o da tutti e due**: il pannello di controllo è sul dispositivo; l'IDE del cloud oggi non
   tocca la rete del pannello (l'API dal cloud è nel seme [Tiny TY: funzioni rimaste](2026-11-15-tiny-ty-funzioni-rimaste.md)).
   Configurare una VPN da remoto ha il rischio solito: se la configurazione sbagliata taglia la rete, il rollback di 60 s
   del pannello di controllo copre anche questo caso?
5. **Quali prodotti**: TC/WP (PixsysOS, con OpenVPN predisposto), Tiny TY (Ubuntu), PC Linux. Una VPN che un prodotto
   non sa fare non si mostra, come le altre sezioni.
6. **Altri servizi dopo i primi due** (WireGuard, Tailscale): la forma deve permettere di aggiungerne senza rifare
   tutto, ma la sessione di plan decide se serve un'astrazione o se due casi bastano.
7. **CasaDomotica**: il TC620 di casa nella ZeroTier del maintainer è il caso di prova naturale, e la regola di
   CasaDomotica chiede che la funzione ci entri.
