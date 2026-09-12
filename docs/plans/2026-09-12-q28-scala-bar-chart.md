# Q28 — Il grafico a barre usa due scale diverse nei due motori

> Trasferito da `docs/OPEN_QUESTIONS.md` (Q28) il 2026-09-12, aperta il 2026-08-31, misurata
> ma **non decisa**. Questo file presenta la domanda e le opzioni per il maintainer — non
> decide nulla, per la regola di `CLAUDE.md` su `docs/OPEN_QUESTIONS.md`. Rileggere la scheda
> originale per le misure complete (pixel, valori) prima di scegliere.

## Il problema, in breve

`bar_chart` legge la scala in due modi diversi a seconda del motore:

| | Scala |
|---|---|
| **Web** | una sola per tutto il grafico: `obj.min`/`obj.max`, o senza dichiarazione `0..max(valori correnti)` — **si muove coi dati** |
| **Pannello LVGL** | una per serie: `bar_series[i].min/max`, default **`0..100` fissa** |

Misurato sui pixel (2026-09-06): con gli stessi tre tag a 20/45/30, le barre nel browser sono
**più del doppio** di quelle sul pannello, a parità di progetto — perché nessuno dei due template
demo dichiara una scala esplicita, quindi entrambi cadono sui default, che sono diversi. Il
*rapporto* fra le barre è identico nei due motori (partono entrambe da zero); quello che cambia
è "quanto è pieno" il grafico visto da solo.

## Le domande, senza risposta

1. **Quale lettura è quella voluta?** Scala comune (si confrontano le barre fra loro, ma il
   grafico "respira" coi dati) o scala per serie (si legge il riempimento rispetto al proprio
   fondo scala, utile per grandezze diverse nello stesso grafico)? È una scelta di prodotto.
2. Se vince la scala comune: `bar_series[].min/max` va tolto dal modello o ridefinito — lasciarlo
   lì a non fare niente è peggio che non averlo.
3. Se vince la scala per serie: `obj.min`/`obj.max` sul `bar_chart` non significano niente e
   vanno tolti dal pannello proprietà.
4. In entrambi i casi: cosa succede ai progetti esistenti che già dichiarano l'uno o l'altro e
   hanno un aspetto approvato dal cliente.
5. **Anche il default deve coincidere**, qualunque scelta vinca — altrimenti la divergenza resta
   esattamente dov'è per ogni grafico che non dichiara nulla (cioè, oggi, per tutti e due i
   template demo).

## Perché non si può decidere da codice

Non c'è un modo "neutro" di scegliere: dipende da cosa i clienti mettono davvero nello stesso
grafico (grandezze omogenee → scala comune ha senso; grandezze eterogenee → scala per serie).
Serve il giudizio del maintainer su casi d'uso reali, non un'analisi tecnica in più.

## Quando si deciderà

Nessun file coinvolto finché non c'è una risposta alle domande sopra — a quel punto il lavoro è
piccolo (allineare un default, eventualmente togliere campi morti dal pannello proprietà e dal
modello). Nota di copertura: nessuna guardia oggi confronta il disegno web con quello LVGL per
questo tipo di divergenza — `istantanea_pagina`/T-59 potrebbe chiuderla in futuro.

---

## Testo originale della scheda (spostato da `docs/OPEN_QUESTIONS.md` il 2026-09-12)

## Q28 — Il grafico a barre usa due scale diverse nei due motori

*Aperta il 2026-08-31. Misurata, non decisa.*

Lo stesso `bar_chart` misura le barre su scale diverse a seconda del motore:

| | Scala |
|---|---|
| **Web** (`SvgCanvas.tsx`) | una sola per tutto il grafico: `obj.min`/`obj.max`, e in mancanza il minimo e il massimo **dei valori correnti** (ricalcolata a ogni disegno). Il `min`/`max` delle singole serie è **ignorato**. |
| **Pannello** (`lvgl_render.rs`) | una per serie: `bar_series[i].min`/`.max`, con default `0..100`. Il `min`/`max` dell'oggetto è **ignorato**. |

Non è un difetto di uno dei due: sono due letture legittime dello stesso campo,
e nessuna delle due è scritta da nessuna parte.

### Cosa cambia per chi guarda

- Con la **scala comune**, l'altezza si può confrontare fra barre: la più alta è
  la più grande. Ma la scala si muove coi dati, quindi un grafico fermo può
  cambiare aspetto senza che nessun valore sia cambiato molto.
- Con la **scala per serie**, ogni barra dice quanto è piena *rispetto al suo
  fondo scala* — utile per grandezze diverse (una portata e una temperatura
  nello stesso grafico) — ma due barre alte uguali possono valere numeri diversi,
  e chi guarda da lontano legge un confronto che non c'è.

### Perché è emersa adesso

Implementando `bar_show_thresholds` (2026-08-31): una soglia è **un** valore, e
la riga che la disegna attraversa tutto il grafico. Regge solo su una scala sola.
Sul pannello la riga si disegna ora **soltanto quando tutte le serie hanno lo
stesso intervallo**, e in caso contrario non si disegna e il registro dice
perché — meglio una soglia mancante che una sbagliata. Ma è una toppa sul
sintomo, non una risposta.

### Seguito, 2026-09-05 — misurato: la divergenza è già visibile **con i valori predefiniti**

La scheda descrive la divergenza fra chi *dichiara* `obj.min/max` e chi dichiara
`bar_series[].min/max`. Misurando i template del repo, il caso che esiste davvero è un altro, e
riguarda il **default**.

Nel repo ci sono **due soli `bar_chart`** — le pagine «Grafici e tabelle» dei due gemelli
`demo-items-web` e `demo-items-lvgl` — e **nessuno dei due dichiara una scala**, né sull'oggetto né
sulle serie. In quel caso:

| | Scala effettiva senza dichiarazioni |
|---|---|
| **Web** (`SvgCanvas.tsx:4805-4806`) | `0 .. max(valori, 1)` — **si muove coi dati** |
| **Pannello** (`lvgl_render.rs:2457-2458`) | `0 .. 100` — **fissa** |

**Misurato il 2026-09-06 sui pixel**, non dedotto dal codice: stessa pagina 800×480, stesso
`bar_chart` 400×340 senza scala dichiarata, stessi tre tag scritti a 20, 45 e 30, disegnata una
volta dal browser e una dal motore LVGL con `--istantanea`.

| serie (valore) | browser | pannello LVGL |
|---|---|---|
| A (20) | 130 px | 61 px |
| B (45) | **292 px** | **138 px** |
| C (30) | 195 px | 92 px |

Le barre sono **più del doppio** nel browser. B riempie tutta l'area del grafico (292 px su ~292
disponibili) perché il web scala su `0..max(valori)`; sul pannello la stessa B è al 45% perché la
scala è `0..100` fissa.

**Una precisazione che conta per la decisione**: il *rapporto* fra le barre è identico nei due
motori (130/292 = 61/138 = 20/45), perché entrambe le scale partono da zero. Quindi chi **confronta
le barre fra loro** legge la stessa cosa di qua e di là; chi legge **quanto è pieno** il grafico —
che è come si guarda un livello o una percentuale da lontano — legge due cose molto diverse. La
scelta fra le due letture è una scelta su *quale delle due domande* il grafico a barre debba
rispondere.

Ne segue una domanda che la scheda non poneva: qualunque delle due letture vinca, **anche il
default deve coincidere**. Scegliere «scala comune» e lasciare `0..100` sul pannello lascerebbe la
divergenza esattamente dov'è per tutti i grafici che non dichiarano niente — cioè, oggi, per tutti.

Nota di copertura, perché spiega perché nessuno se n'era accorto: `check_demo_templates.sh`
confronta i due gemelli **fra loro nello YAML**, non nel disegno, e `check_wysiwyg.sh` confronta
editor e runtime **web**. Nessuna guardia confronta il disegno web con quello LVGL — è il buco che
`istantanea_pagina` (T-51, fase 3) potrebbe chiudere quando un modello la userà davvero.

### Le domande

1. **Quale delle due è il comportamento voluto?** È una scelta di prodotto:
   dipende da cosa i clienti mettono nello stesso grafico.
2. Se vince la scala comune, `bar_series[].min/max` va **tolto** dal modello o
   ridefinito (per esempio come normalizzazione del valore, non della scala):
   lasciarlo lì a non fare niente è peggio che non averlo.
3. Se vince la scala per serie, `obj.min`/`obj.max` sul `bar_chart` non
   significano niente e vanno tolti dal pannello proprietà.
4. In entrambi i casi: **cosa succede ai progetti esistenti** che dichiarano
   l'uno o l'altro e hanno un aspetto che il cliente ha già approvato.
