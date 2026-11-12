# CasaDomotica: le quattro cose da fare insieme al maintainer nel progetto di riferimento — piano

> Nato il 10-11-2026 da `Appunti.txt` (punti del 30-10, 03-11, 04-11 e 06-11-2026), quando il maintainer ha
> chiesto di trasformare gli appunti in semi e piani e di eliminare il file.

**Stato: piano — da fare insieme al maintainer, nel progetto sul VPS**

## Perché un piano solo

CasaDomotica è il **progetto di riferimento** (regola di [`CLAUDE.md`](../../CLAUDE.md) del 16-10-2026: ogni
funzione visibile che entra in `main` va messa anche lì, perché il progetto resti rappresentativo di cosa il prodotto
sa fare; il 16-10-2026 usava 16 tipi su 39). CasaDomotica **vive sul VPS** ed è l'**impianto vero di casa del
maintainer**: si fa dal cloud, con lui, non da soli e non in un progetto di prova.

I quattro punti qui sotto erano sparsi in `Appunti.txt`. Hanno tutti la stessa condizione — una sessione col
maintainer, IDE nel cloud aperto su CasaDomotica — e per questo stanno in un piano solo. Si possono fare in una
sessione sola o in più sessioni; l'ordine proposto è quello sotto, dal più piccolo al più lungo.

## Da dove viene

`Appunti.txt`, 10-11-2026. I punti originali:

| Punto | Data del punto | Piano d'origine |
|---|---|---|
| La planimetria vera e il suo sfondo, poi la pagina su LVGL | 30-10-2026 (ramo 3 rimasto, passato in Appunti quando il piano è stato archiviato) | [Planimetrie: la pianta si disegna nell'IDE, la vista 3D diventa lo sfondo](../archive/2026-10-25-planimetrie-3d.md), archiviato il 30-10-2026 con i rami 1 e 2 fatti e visti a schermo |
| Lo slider nuovo in CasaDomotica | 03-11-2026 | [Lo slider: difetti, disegno SVG proprio, quattro stili, tacche, bande, PV, molla](../archive/2026-10-30-revisione-slider.md), fase 7; le fasi 1-6 sono in `main` dalla 2.23.8 |
| Le regole del progetto (blocco `ai:`) | 04-11-2026 | [Un modello IA per ogni scopo, e il menù IA dell'IDE](../archive/2026-11-04-un-modello-per-ogni-scopo.md), F7; archiviato il 04-11-2026 |
| `report_1` nomina `core2.cpu0` e `core2.cpu1` | 06-11-2026 | collaudo della 2.26.0-rc.2/rc.3 sul TC620 di casa; la scheda «tc-report» del banco |

## Fatto col maintainer il 12-11-2026 (sul VPS, a progetto chiuso, con le copie di sicurezza)

- **Punto 1, `report_1`.** È diventato «Casa — consumi e stato del sistema», settimanale, con 32 tag:
  - energia dell'inverter (oggi), pompa di calore, prese, contatore del rack;
  - CPU, i sei core `core.cpu0`…`core.cpu5` (i `core2.*` erano un vecchio test), RAM, disco, carico e temperature.

  Copia: `project.yaml.prima-report-settimanale-20261112-042558`.
- **Punto 2, il blocco `ai:`.** Scritto con le parole decise insieme: impianto, generali (stanze, unità, Sandokan),
  assistente, simboli, traduzione, sfondi. Copia: `project.yaml.prima-regole-ia-…`.
- **In più, le tapparelle e le finestre** (generatore in `tmp/casadomotica-tapparelle/`, solo su `ufficio`). La
  pagina «Tapparelle e finestre» prende il posto di «Finestre e porte» (stesso id). Contiene:
  - un riquadro per piano con le aperture aperte e le tapparelle alzate (tag derivati `openings.*`);
  - «Apri tutto» e «Chiudi tutto»: funzione `tapparelle_tutte`, su tutte le 19 tapparelle previste, che salta le
    portafinestre col contatto aperto;
  - «Sicurezza e garage»: perimetrali, portoncino, portone sezionale con Apri/Ferma/Chiudi critici;
  - due finestre modali, «Piano terra» e «Piano superiore», con un faceplate `serramento` per apertura.

  Le aperture non domotiche hanno già i loro tag, in inglese (es. `shutter_kitchen_left`, `window_study`). Dalla
  rc.16 diranno «non collegata» da sole. Provato in un runtime di prova: zero rilievi, foto web e LVGL, «Chiudi
  tutto» con una portafinestra aperta.
- **Restano**:
  - il punto 3: le luci in piastra e il termostato con PV, nella rc.16;
  - il punto 4: la planimetria, che ora ha un seme suo
    ([planimetrie 3D complete](semi/2026-11-12-planimetrie-3d-complete.md)).

## Le cose da fare

### 1. `report_1` nomina `core2.cpu0` e `core2.cpu1`, che non esistono (il più piccolo)

**Cosa c'è (06-11-2026).** In CasaDomotica il report `report_1` elenca fra i suoi tag `core2.cpu0` e `core2.cpu1`.
Nel progetto quei tag **non esistono**: la validazione dà **due errori**, **preesistenti** (non li ha introdotti il
lavoro di quei giorni). La scheda «tc-report» del banco di collaudo lo diceva. Da sistemare col maintainer, nel
progetto nel cloud.

**Dove lo dice il codice.** `rilievi_report` in `sws-runtime/crates/sws-web/src/validate.rs`: per ogni tag di un
report che non è dichiarato nel progetto produce l'errore «il tag `…` non è dichiarato», con il suggerimento «nel
report resterebbe una riga vuota: correggi il riferimento o toglilo». Il report parte lo stesso; le due righe
escono vuote.

**Nota del 10-11-2026.** Il banco (`python3 scripts/banco_collaudo/server.py`, porta 8471) oggi contiene le prove
della 2.26.0-rc.10: la scheda «tc-report» non è più in `scripts/banco_collaudo/prove.json`. Gli esiti di quel
collaudo stavano in `tmp/collaudo/esiti-06-11-casa.json`, cartella fuori da git. Il fatto resta: i due tag vanno
cercati nel progetto sul VPS.

**Da fare.** Aprire il report `report_1` nell'IDE del cloud, capire col maintainer che cosa volevano essere i due
tag (la CPU di un dispositivo? un nome cambiato in una sorgente?), e poi: o sostituirli con i tag veri, o toglierli.
Rilanciare la validazione del progetto e vedere i due errori sparire.

### 2. Le regole del progetto (il blocco `ai:` di `project.yaml`)

**Cosa c'è (04-11-2026).** Il piano «un modello per ogni scopo» ha portato nel progetto il blocco `ai:` di
`project.yaml`: `impianto` (una riga) e `regole:` con `generali`, `assistente`, `simboli`, `traduzione`, `sfondi`,
tutti facoltativi. Nell'IDE si scrivono dalla voce **«Regole del progetto»** del ramo **IA** del pannello laterale
(`sws-editor/src/config/schede/IaTab.tsx`; solo Admin, solo sull'istanza IDE). Vanno al modello dopo il testo fisso
del sistema, in un blocco «Regole del progetto»; **non scavalcano le regole del prodotto**. Ogni campo ha un tetto di
4000 caratteri (`REGOLE_IA_MAX` in `sws-runtime/crates/sws-core/src/project.rs`, controllato da `rilievi_regole_ia`
in `sws-runtime/crates/sws-web/src/validate.rs`): entrano in ogni chiamata e costano. Sono testo del progetto: si
vedono nel diff del Salva e in git. Il capitolo 7 di [`docs/HOWTO.md`](../HOWTO.md) («Accendere l'assistente IA
nell'editor») le spiega.

Il punto F7 del piano diceva: «Le regole del progetto in CasaDomotica restano da mettere insieme al maintainer:
CasaDomotica vive sul VPS ed è l'impianto vero di casa sua». La regola del progetto di riferimento chiede di
metterci le funzioni visibili, e questa lo è.

**Proposta (04-11-2026), da confermare col maintainer:**

- impianto: «casa unifamiliare con fotovoltaico, pompa di calore e domotica Home Assistant»;
- generali: «nomi delle stanze come in casa (soggiorno, camera, taverna); unità SI»;
- traduzione: «tapparella = shutter, taverna = basement».

**Da fare.** Compilare le tre voci nell'IDE del cloud con le parole del maintainer (i nomi veri delle stanze li sa
lui). Salvare. Provare l'assistente con una richiesta che tocchi una stanza e vedere che il nome torni come scritto
nelle regole.

### 3. Lo slider nuovo: luci, tapparelle e un termostato con PV (fase 7 dello slider)

**Cosa c'è (03-11-2026).** Le fasi 1-6 della revisione dello slider sono in `main` dalla **2.23.8** (commit
`cfcbeea7` … `bb1b4285`, poi `7e7f4996`); il progetto di collaudo è diventato il template «Slider — stili e modi»
nella 2.24.1 (`b25bf081`) e sta anche in
[`allegati/2026-10-30-revisione-slider/collaudo-slider/`](allegati/2026-10-30-revisione-slider/collaudo-slider/LEGGIMI.md),
quattro pagine con tutti i tipi di slider. Lo slider ha quattro stili (`slider_style`: `classico`, `pillola`,
`piastra`, `isa`); la **piastra** è lo stile domotico: la traccia è il riquadro, niente cursore, si trascina
ovunque, etichetta, valore e icona dentro; le icone sono 8 fisse (lampadina, tapparella, termometro, ventola, presa,
volume, goccia, sole) e si mostrano solo sulla piastra. Il **valore misurato (PV)** viene da `slider_pv_tag` e
`slider_pv_color`: un triangolino sulla traccia e il PV accanto al valore («62 % · PV 58 %», stesse unità e
decimali).

La fase 7 del piano era: «Luci e tapparelle in piastra, un termostato con PV (regola di `CLAUDE.md`), quando lo
slider nuovo entra in `main`. Il progetto sta sul VPS: si fa dal cloud, col maintainer.» È rimasta non fatta perché
breve e da fare con lui.

**Da fare.** Nelle pagine di CasaDomotica che hanno già luci e tapparelle, passare quegli slider allo stile
«piastra» con l'icona giusta (lampadina, tapparella). Per il termostato, uno slider col setpoint e `slider_pv_tag`
sul tag della temperatura misurata. Guardare il risultato sul web e sul TC620 di casa (LVGL).

### 4. La planimetria vera e il suo sfondo, poi la pagina su un pannello LVGL (il più lungo)

**Cosa c'è (30-10-2026).** Il piano delle planimetrie è stato archiviato il 30-10-2026 con i rami 1 e 2 fatti e visti
a schermo: la pianta si disegna nell'IDE (ramo **Planimetrie** del pannello sinistro,
`sws-editor/src/planimetrie/PlanimetriaEditor.tsx`), la vista 3D (three.js in un pezzo suo, 172 KB gzip, mai
precaricato) genera un PNG che finisce fra le immagini del progetto come `planimetria-<id>.png`, e la pagina lo usa
come sfondo (`sfondo_immagine`; sul server lo compone `sfondo_area` in `sws-runtime/crates/sws-web/src/cornici.rs`).
La pianta vive in `planimetrie/<id>.yaml` e viaggia con export, deploy, backup e git. Il capitolo del manuale c'è
già: «Planimetrie (dal 29-10-2026)» in [`docs/manual/04_editor_guide.md`](../manual/04_editor_guide.md).

Il **ramo 3** (`feat/planimetrie-casadomotica` nel piano) era: planimetria della casa (o del garage) su
CasaDomotica, sfondo della pagina corrispondente, manuale (capitolo editor), CHANGELOG + NOVITA (it+en). Il
manuale è fatto; restano la planimetria vera e la prova sul pannello. È anche la regola di `CLAUDE.md` su
CasaDomotica, che va rispettata ora che le planimetrie sono in `main`.

**La prova su LVGL.** La strada raster degli sfondi è confermata dalla **2.23.3** (27-10-2026: feature
`raster-images` di resvg, il raster avvolto in un SVG con un `data:` dentro; tetto di 4096 px per lato per lo sfondo
di una pagina), e il maintainer l'ha vista sul WP630 il 28-10-2026. Ma **con un PNG di planimetria nessuno l'ha
vista**: la verifica del piano diceva «disegnare la pianta del garage, generare lo sfondo, metterlo a una pagina,
verificare sul WP630 che LVGL la mostri».

**Da fare.** Col maintainer, nell'IDE del cloud: disegnare la pianta vera (la casa o il garage — decide lui), con
muri, porte e finestre; generare lo sfondo dalla vista 3D; assegnarlo alla pagina corrispondente e piazzare sopra gli
oggetti già esistenti (luci, sensori) dove si vedono nella vista. Poi deploy e guardare quella pagina su un pannello
LVGL: il WP630 in ufficio o il TC620 di casa. Annotare il peso del PNG e il tempo di apertura della pagina.

## Da decidere col maintainer

- **Punto 1**: che cosa erano `core2.cpu0` e `core2.cpu1` — sostituire o togliere.
- **Punto 2**: il testo definitivo delle tre voci; se compilare anche `assistente`, `simboli` e `sfondi` (la proposta
  del 04-11 non le toccava).
- **Punto 3**: quali pagine e quali slider; se il termostato ha già un tag di temperatura misurata da usare come PV.
- **Punto 4**: la casa o il garage; quale pagina riceve lo sfondo; se gli oggetti sopra restano quelli di oggi o se ne
  aggiungono.
- **Ordine e sessioni**: una sessione sola o una per punto.

## Collaudo

- **Punto 1**: la validazione di CasaDomotica nell'IDE del cloud senza i due errori su `report_1`; il report
  generato senza righe vuote.
- **Punto 2**: il blocco `ai:` nel `project.yaml` sul VPS con le tre voci; una risposta dell'assistente che usa i
  nomi delle stanze come scritti.
- **Punto 3**: luci e tapparelle in piastra con l'icona, il termostato con il PV, sul web e sul TC620 (LVGL).
- **Punto 4**: la pagina con lo sfondo della planimetria sul web e su un pannello LVGL (WP630 o TC620); il peso del
  PNG; gli oggetti al posto giusto sopra la pianta.
- Ogni punto chiuso si segna in [`docs/COLLAUDI_IN_SOSPESO.md`](../COLLAUDI_IN_SOSPESO.md) e in `STATUS.md`, come
  vuole `/test-changes`.
