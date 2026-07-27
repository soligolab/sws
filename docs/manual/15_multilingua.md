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

Tutti i template inclusi (`examples/templates/`) sono **già conformi IT/EN**: i
messaggi sono tokenizzati e la tabella lingue contiene Italiano e Inglese. I
template con contenuto grafico hanno un **selettore lingua** in alto a destra
della prima pagina — apri il viewer e cambia lingua per vedere i testi tradursi.

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
