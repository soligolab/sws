# Catalogo Pixsys

I dispositivi Pixsys del catalogo dei dispositivi noti (piano `docs/plans/2026-10-04-catalogo-dispositivi.md`).

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

Dalla tabella dei codici d'ordine della pagina del prodotto (04-10-2026): 1AD 16 DO; 2AD 16 DI + 3 encoder; 3AD 8 DI + 8
DO + 3 encoder; 4AD 8 DI + 8 relè; 5AD 4 AI + 2 AO; 9AD 4 AI + 2 AO + 16 linee digitali selezionabili come DI o DO + 4
encoder. Le word 10 (DI) e 20 (DO) e gli analogici 30-33/40-41 vengono dalla mappa generica MCM: **da verificare** sul
manuale di ogni variante, in particolare quale bit corrisponde a quale morsetto nelle 3AD e 4AD (qui: i bit 0-7).
Gli encoder/contatori non ci sono: la mappa non riporta i loro registri.
