← [Indice](MAIN.md) | [← Test e Diagnostica](14_testing.md)

---

# 15 — Multilingua

SWS gestisce **due lingue distinte e indipendenti**:

| Asse | Cosa traduce | Chi la sceglie | Dove si imposta |
|------|--------------|----------------|-----------------|
| **Lingua UI** | La *chrome* dell'IDE e del viewer (menu, pulsanti, pannelli, tab) | L'utente dell'IDE / l'operatore | Selettore lingua nell'header |
| **Lingua contenuti** | I *messaggi del progetto* (testi che l'autore scrive negli oggetti) | Definita dal progettista, cambiata a runtime | Tab **Configurazione → Lingue** + oggetti in pagina |

Le due lingue sono **separate**: puoi avere l'IDE in inglese e il contenuto del
sinottico in italiano, o viceversa.

---

## 1. Lingua dell'interfaccia (UI)

L'IDE e il viewer sono tradotti in **Italiano** (base) e **Inglese**.

- **Cambio lingua**: il menù a tendina lingua nell'header dell'IDE (accanto al
  tema) e nella barra di navigazione del Viewer operatori. La scelta è
  **ricordata sul dispositivo** (`localStorage: sws.uiLang`).
- **Lingua iniziale**: preferenza salvata → lingua del browser → italiano.
  Fallback all'inglese per eventuali chiavi mancanti.
- **Ambito**: header, menu principale, controlli runtime (Start/Stop/Reboot),
  editor (palette, pannello proprietà), tutti i tab di Configurazione, viewer
  operatori, schermate di login/benvenuto, allarmi.

> **Nota**: la lingua UI **non** tocca i testi che l'operatore ha scritto nei
> sinottici — quelli sono contenuto di progetto (vedi sotto).

**Aggiungere una lingua UI (sviluppatori)**: creare `sws-editor/src/i18n/<code>.json`
sul modello di `it.json`/`en.json`, registrarlo in `src/i18n/index.ts`
(`resources` + `UI_LANGS`). Nessuna modifica al runtime Rust.

---

## 2. Tabella lingue di progetto

Serve a tradurre i **messaggi che l'autore scrive negli oggetti** (etichette di
pulsanti, testi, unità, label delle tubazioni…) senza duplicare i sinottici.

### Come funziona

1. Nei campi testo degli oggetti si scrive un **token** tra doppie graffe:
   `{{avvio_pompa}}` invece del testo letterale.
2. La **tabella lingue** del progetto associa ogni token a una traduzione per
   ciascuna lingua definita.
3. A runtime il Viewer sostituisce i token con il testo nella **lingua corrente**;
   se manca la traduzione usa la lingua *predefinita*, e se manca anche quella
   mostra il token grezzo (utile per accorgersi di una chiave non tradotta).

Il testo misto è supportato: `{{stato}}: {{acceso}}` risolve entrambi i token.

### Il tab "Lingue"

**Configurazione → Lingue** (Admin):

- **Lingua predefinita (sorgente)**: la lingua di riferimento del progetto.
- **+ Lingua**: aggiunge un codice lingua (es. `en`, `de`, `fr`).
- **Griglia**: una riga per messaggio; la colonna **Chiave** è il token, poi una
  colonna per ogni lingua con la traduzione.
- **+ Messaggio**: aggiunge una riga; **✕** rimuove riga o lingua.
- **Esporta CSV / Importa CSV**: la tabella viaggia come CSV (`key,<lingua1>,<lingua2>,…`)
  per tradurre fuori dall'IDE (es. affidando il CSV a un traduttore) e reimportarla.
- **Salva tabella**: persiste sul progetto.

La tabella è salvata in `project.yaml` (`languages:`) e viaggia automaticamente
con **export/import ZIP** del progetto.

### Inserire i token negli oggetti

Nel pannello proprietà dell'editor, il campo **"Inserisci token"** elenca le
chiavi della tabella e le inserisce come `{{chiave}}` nel campo testo primario
dell'oggetto selezionato. In alternativa si può digitare il token a mano.

> **In editor** il canvas mostra il testo già **risolto nella lingua
> predefinita** (per leggibilità), mentre il pannello proprietà mostra il
> **token grezzo** `{{…}}` così puoi vederlo e modificarlo.

---

## 3. Cambiare lingua a runtime (oggetti in pagina)

Due oggetti della palette (gruppo **Controlli**) permettono all'operatore di
cambiare la lingua dei contenuti direttamente dal sinottico:

| Oggetto | Comportamento |
|---------|---------------|
| **Lingua ▾** (`lang_selector`) | Menù a tendina con tutte le lingue del progetto |
| **Lingua btn** (`lang_button`) | Pulsante che imposta una lingua specifica (proprietà *Lingua di destinazione*); si evidenzia quando è la lingua attiva |

La lingua scelta è **ricordata sul dispositivo** (`localStorage: sws.projectLang`);
al primo caricamento si parte dalla lingua predefinita della tabella.

---

## 4. Template di esempio

Dal 16-09-2026 **tutti i testi dei template passano dalla tabella lingue**,
messaggi d'allarme compresi — prima erano testo letterale, quindi un allarme
restava in italiano su qualunque pannello. Le chiavi sono **id opachi**
(`t0001`, `t0002`…) e non parole: il testo si legge dalla colonna della lingua,
non dal nome della chiave, così cambiare una frase non fa mentire la chiave che
la nomina.

**Tokenizzato non vuol dire tradotto**, e il manuale lo diceva: fino a oggi
questa sezione dichiarava tutti i template «già conformi IT/EN», mentre tre non
avevano nemmeno una voce in tabella. La fotografia vera, oggi:

La fotografia è cambiata il 17-09-2026 col Passo 5 della revisione template e
la regola **R2** (`examples/templates/README.md`): sei template sono completi in
tre lingue, e per gli altri quanto manca è **scritto e contato** dentro
`check_templates.sh`, non lasciato all'occhio.

| Template | Lingue | Voci | Testo del sinottico ancora in chiaro |
|---|---|---:|---:|
| `homeassistant-pro` | it, en, es | 171 | 0 |
| `casa-locale` | it, en | 141 | 20 |
| `homeassistant-demo` | it, en, es | 77 | 0 |
| `grid-playground` | it, en | 28 | 1 |
| `opcua-demo` | it, en, es | 27 | 0 |
| `s7-demo`, `enip-demo`, `sparkplug-demo` | it, en, es | 12 | 0 |
| `demo-items-web` / `-lvgl` | it, en | 6 | 114 |
| `nebulizzatore-sandokan` | it | 2 | 12 |

**Tokenizzato non vuol dire tradotto, e tradotto non vuol dire completo.** Le
due colonne dicono cose diverse: «voci» conta la tabella lingue, l'ultima conta
il testo che sul sinottico è ancora scritto a mano e quindi non cambia lingua
mai. Fino al 17-09 i due `demo-items` avevano 6 voci in tabella e 114 stringhe
in chiaro: chi apriva quei template e cambiava lingua vedeva cambiare gli
allarmi e nient'altro.

I template con contenuto grafico hanno un **selettore lingua** in alto a destra
della prima pagina — apri il viewer e cambia lingua per vedere i testi tradursi.

> **Attenzione ai caratteri speciali.** I template usano 18 emoji (🏠 💡 🔐 🦟 …)
> che il **pannello LVGL non disegna affatto**: il suo font copre il Piano
> Multilingue di Base, dove le emoji vere non stanno. Sul browser si vedono, sul
> vetro no — e LVGL senza glifo non mostra nemmeno un quadratino. Vedi T-71.

---

## 5. Note tecniche

- **API**: `PUT /api/project/languages` scrive la tabella; è inclusa in
  `GET /api/project`. Il runtime la persiste soltanto — la risoluzione dei token
  avviene lato client (Viewer/editor).
- **Cosa NON viene tradotto**: tag, colori, `format`, espressioni Python,
  identificatori. La risoluzione tocca solo i campi testo degli oggetti
  (`label`, `text`, `unit`, `pipe_label`, label di opzioni/righe/liste).
- **CSV**: intestazione `key` + un codice lingua per colonna; le virgolette
  proteggono virgole e a capo.

---

← [Indice](MAIN.md) | [← Test e Diagnostica](14_testing.md)
