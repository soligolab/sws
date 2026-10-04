# Catalogo Pixsys

I dispositivi Pixsys del catalogo dei dispositivi noti (piano `docs/archive/2026-10-04-catalogo-dispositivi.md`).

## Da dove vengono i registri

Dalla mappa [`mappa-registri-fonte.md`](mappa-registri-fonte.md), fornita dal maintainer il 04-10-2026. **È da
verificare sul manuale di ogni prodotto**: indirizzi, decimali (`Dec.P`) e accessi possono cambiare fra modelli e
revisioni firmware. Una correzione si fa nel frammento della famiglia (`_atr.json`, `_str.json`, `_mcm_di.json`,
`_mcm_do.json`, `_mcm_analogici.json`, `_drr.json`, `_comuni.json`) se vale per tutti i modelli, o nel file del modello se vale solo per lui: un registro con
lo stesso `nome` nel file del modello sostituisce quello del frammento.

Per correggere **solo sul proprio pannello o PC**, senza toccare il prodotto: copia il file in
`<config>/catalogo-dispositivi/pixsys/` (stesso nome) e modificalo lì — vince sul file del prodotto. Il formato è
nel manuale, `docs/HOWTO.md` capitolo «Il catalogo dei dispositivi».

## Le immagini

Prese dal sito pixsys.net il 04-10-2026, ridotte a 160×160:

| Modello | Pagina | Immagine |
|---|---|---|
| `atr121` | https://www.pixsys.net/regolatori-indicatori/regolatori-basici/atr121 | https://26282125.fs1.hubspotusercontent-eu1.net/hubfs/26282125/Prodotti/Regolatori/ATR121/ATR121-trequarti.jpg |
| `atr142` | https://www.pixsys.net/en/discontinued-products | https://26282125.fs1.hubspotusercontent-eu1.net/hubfs/26282125/Prodotti/Prodotti%20obsoleti/atr142.jpg |
| `atr144` | https://www.pixsys.net/en/controllers-indicators/advanced-pid-controllers/atr144 | https://26282125.fs1.hubspotusercontent-eu1.net/hubfs/26282125/Prodotti/Regolatori/ATR144/ATR144_trequarti.jpg |
| `atr244` | https://www.pixsys.net/regolatori-indicatori/regolatori-evoluti/atr244 | https://26282125.fs1.hubspotusercontent-eu1.net/hubfs/26282125/Prodotti/Regolatori/ATR244/ATR244-trequarti.jpg |
| `str551` | https://www.pixsys.net/en/controllers-indicators/panel-meters/str551 | https://26282125.fs1.hubspotusercontent-eu1.net/hubfs/26282125/Prodotti/Visualizzatori/STR551/STR551_trequarti.jpg |
| `str561` | https://www.pixsys.net/regolatori-indicatori/visualizzatori/str561 | https://26282125.fs1.hubspotusercontent-eu1.net/hubfs/26282125/Prodotti/Visualizzatori/STR561/STR561_trequarti.jpg |
| `str571` | https://www.pixsys.net/en/controllers-indicators/panel-meters/str571 | https://26282125.fs1.hubspotusercontent-eu1.net/hubfs/26282125/Prodotti/Visualizzatori/STR571/STR571-trequarti.jpg |
| `mcm260x-1ad` | https://www.pixsys.net/en/io-modules/remote/mcm260 | https://26282125.fs1.hubspotusercontent-eu1.net/hubfs/26282125/Prodotti/Moduli%20IO/MCM260X/MCM260X_1AD_fronte.jpg |
| `mcm260x-3ad` | https://www.pixsys.net/en/io-modules/remote/mcm260 | https://26282125.fs1.hubspotusercontent-eu1.net/hubfs/26282125/Prodotti/Moduli%20IO/MCM260X/MCM260X_3AD_trequarti.jpg — usata anche per **2AD, 4AD e 5AD** (stesso contenitore da 4 moduli; il sito non ha la loro foto) |
| `mcm260x-9ad` | https://www.pixsys.net/en/io-modules/remote/mcm260 | https://26282125.fs1.hubspotusercontent-eu1.net/hubfs/26282125/Prodotti/Moduli%20IO/MCM260X/MCM260X_9AD_trequarti.jpg |
| `mcm280x` | https://www.pixsys.net/en/io-modules/remote/mcm280x | https://26282125.fs1.hubspotusercontent-eu1.net/hubfs/26282125/Prodotti/Moduli%20IO/MCM280X/MCM280X_trequarti.jpg |
| `drr245` | https://www.pixsys.net/en/discontinued-products | https://26282125.fs1.hubspotusercontent-eu1.net/hubfs/26282125/Prodotti/Prodotti%20obsoleti/DRR245.jpg |
| `drr460` | https://www.pixsys.net/regolatori-indicatori/regolatori-guida-din/drr460 | https://26282125.fs1.hubspotusercontent-eu1.net/hubfs/26282125/Prodotti/Regolatori/DRR460/DRR460_trequarti.jpg |

## Le varianti MCM260X

**Dal manuale** `docs/2300.10.265-A5-RevG.pdf` (MCM260X, rev. G), §9.2 «Aree di comunicazione Modbus RTU», non dalla
mappa generica: quella metteva gli I/O a 10-41 e i registri comuni a 0-5, mentre gli MCM260X hanno DI in 1000, DO in
1100, AI del 5AD in 1000-1003 (del 9AD in 1001-1004), AO in 1100-1101 (9AD 1101-1102), e il registro 4 non esiste
(una lettura che lo include viene rifiutata). Frammento `_mcm260x` (0, 1, 2, 5, 6, 7) e un file per variante; gli
encoder (32 bit, word alta prima: ordine ABCD) e i parametri di configurazione che servono (tipo di sonda AI1-4, unità,
tipo di uscita AO, setup encoder del 9AD). Verificato sul campo il 04-10-2026: un 5AD (unit 1) e un 9AD (unit 2) sul
TC620 accettano tutti gli indirizzi del catalogo. Di fabbrica il tipo di sonda è «disabilitato»: gli AI valgono 0 finché
non si imposta `tipo_sensore_aiN`.

L'MCM280X usa ancora i frammenti `_mcm_di`, `_mcm_do`, `_mcm_analogici` della mappa generica: **da verificare** sul suo
manuale.
