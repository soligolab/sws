# Ruolo di questo template

**Applicazione realistica**, versione "completa": inverter fotovoltaico, monitoraggio
elettrico multi-circuito, clima 5 stanze, sicurezza perimetrale, tapparelle e luci in
scrittura, presenza persona, tag derivati Python, allarmi con dead-band, storico SQLite —
6 pagine, 86 tag. Il gemello ricco di `homeassistant-demo`.

## Il metro con cui giudicarlo

Deve mostrare quanto in profondità SWS può integrarsi con un impianto HomeAssistant maturo:
qui la ricchezza (86 tag, 13 allarmi, 9 derivati) è il punto, non un eccesso da tagliare.
Va giudicato sulla coerenza interna (i dati raccontano un impianto plausibile) più che sul
numero — se una sezione non aggiunge un caso d'uso nuovo rispetto alle altre, è lì che si
taglia, non per principio di brevità.

Non giudicarlo con il metro di un banco di prova (né di protocollo né di feature): qui la
scala è voluta, è quello che lo distingue da `homeassistant-demo`.

## Cosa mostra in più (04-11-2026)

- **Tipi e faceplate** (regola R8): le due stringhe FV, le cinque stanze e i due contatori sono istanze
  di un tipo (`stringa_fv`, `stanza`, `contatore`) con gli stessi percorsi di prima; le pagine le
  disegnano coi faceplate di `faceplates/`, che servono anche porte, finestre, rilevatori, luci e
  tapparelle.
- **La gestione dei permessi** (regola R7, eccezione dichiarata): tutti i comandi si usano col ruolo
  Viewer tranne due, apposta — la luce del cancelletto chiede Operator, la tapparella del garage
  Supervisor. Il ruolo sta sul tag (`write_min_role`), e il prodotto mette sul comando un lucchetto col ruolo che
  serve a chi non ce l'ha.

_Revisione template, 2026-09-15 (`docs/archive/2026-09-14-revisione-template.md`, passo 2)._
