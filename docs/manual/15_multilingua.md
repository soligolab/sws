← [Indice](MAIN.md) | [← Test e Diagnostica](14_testing.md) | [Successivo → Prestazioni](16_prestazioni.md) →

---

# 15 — Multilingua

> Le lingue di SWS: quella dell'interfaccia, quella dei contenuti di progetto, quella delle notifiche, e le parole
> che il runtime scrive da sé. Per chi progetta impianti in più lingue.
>
> Misurato sul codice il 20-10-2026.

SWS gestisce **due lingue distinte e indipendenti** — più una terza categoria, il testo di sistema
([§5](#5-note-tecniche)):

| Asse | Cosa traduce | Chi la sceglie | Dove si imposta |
|------|--------------|----------------|-----------------|
| **Lingua UI** | La *chrome* dell'IDE e del viewer (menu, pulsanti, pannelli, tab) | L'utente dell'IDE / l'operatore | Selettore lingua nell'header |
| **Lingua contenuti** | I *messaggi del progetto* (testi che l'autore scrive negli oggetti) | Definita dal progettista, cambiata a runtime | **Configurazione → Progetto → Lingue** + oggetti in pagina |

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

**Configurazione → Progetto → Lingue** (`LanguagesTab.tsx`):

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

**Il testo digitato diventa da solo una voce.** Si scrive «Avvio pompa» in un campo di testo: alla conferma (non a
ogni tasto) nel progetto va `{{t0001}}`, e la tabella prende la riga con il testo nella lingua predefinita. Se lo
stesso testo c'è già, l'IDE **propone** di riusare quella chiave e dice quante volte è usata. Le chiavi nuove
proseguono la numerazione e non riempiono i buchi lasciati dalle righe cancellate.

In alternativa, il campo **"Inserisci token"** del pannello proprietà elenca le chiavi della tabella e le inserisce
come `{{chiave}}`; oppure si digita il token a mano.

### Traduzione automatica

Dalla scheda Lingue si riempie una colonna con un fornitore di traduzione (`sws-web/src/traduttore.rs`):

| Fornitore | Cosa serve |
|---|---|
| **MyMemory** | niente: è il predefinito, senza chiave, con un tetto giornaliero |
| **LibreTranslate** | un'istanza, anche ospitata in casa |
| **Google** | una chiave |
| **IA** | l'assistente già configurato nell'IDE |

- **Solo dall'IDE**: tradurre è progettazione, e un dispositivo in campo spesso non ha Internet. Sui pannelli le rotte
  (`POST /api/project/languages/translate`, `/api/traduzione/config`) rispondono 404.
- I segnaposti di formato (`{value:.1f}`…) escono dal testo prima della traduzione e rientrano identici; se il
  fornitore ne perde uno, la riga si scarta.
- Una traduzione **scritta a mano non si sovrascrive mai**: le voci automatiche sono marcate (`auto`) e vanno
  rilette.
- La chiave del fornitore si salva in un file della cartella di configurazione dell'istanza, con permessi stretti
  (`segreti.rs`), mai nel progetto; impostarla e toglierla finisce nell'audit
  (`traduzione.key_set`, `traduzione.key_removed`).

> **In editor** il canvas mostra il testo già **risolto nella lingua
> predefinita** (per leggibilità), mentre il pannello proprietà mostra il
> **token grezzo** `{{…}}` così puoi vederlo e modificarlo.

---

## 3. Cambiare lingua a runtime (oggetti in pagina)

Due oggetti della palette (gruppo **Navigazione e lingua**) permettono all'operatore di
cambiare la lingua dei contenuti direttamente dal sinottico:

| Oggetto | Comportamento |
|---------|---------------|
| **Lingua ▾** (`lang_selector`) | Menù a tendina con tutte le lingue del progetto |
| **Lingua btn** (`lang_button`) | Pulsante che imposta una lingua specifica (proprietà *Lingua di destinazione*); si evidenzia quando è la lingua attiva |

Nel browser la lingua scelta è **ricordata** (`localStorage: sws.projectLang`); al primo caricamento si parte dalla
lingua predefinita della tabella. Sul pannello LVGL vale per tutto il processo del viewer (`SharedLang`,
`sws-lvgl-viewer/src/client.rs`).

---

## 4. Template di esempio

Dal 16-09-2026 **tutti i testi dei template passano dalla tabella lingue**,
messaggi d'allarme compresi — prima erano testo letterale, quindi un allarme
restava in italiano su qualunque pannello. Le chiavi sono **id opachi**
(`t0001`, `t0002`…) e non parole: il testo si legge dalla colonna della lingua,
non dal nome della chiave, così cambiare una frase non fa mentire la chiave che
la nomina.

Dal 17-09-2026, con il Passo 5 della revisione template e la regola **R2**
(`examples/templates/README.md`), **tutti i template sono completi in tre
lingue** — italiano, inglese e spagnolo — e ogni testo che un operatore legge
passa dalla tabella. Non solo i messaggi d'allarme: etichette, titoli, unità
dentro i formati, messaggi di conferma.

Misurati il 20-10-2026: tutti e tredici i template hanno italiano, inglese e spagnolo, e nessuna voce vuota.

| Template | Lingue | Voci |
|---|---|---:|
| `homeassistant-pro` | it, en, es | 171 |
| `demo-items-web` / `-lvgl` | it, en, es | 99 |
| `homeassistant-demo` | it, en, es | 77 |
| `tc620-sistema` | it, en, es | 60 |
| `grid-playground` | it, en, es | 29 |
| `opcua-demo` | it, en, es | 27 |
| `comandi-pompa-pozzo` | it, en, es | 21 |
| `nebulizzatore-sandokan` | it, en, es | 14 |
| `host-monitor` | it, en, es | 13 |
| `s7-demo`, `enip-demo`, `sparkplug-demo` | it, en, es | 12 |

**Com'era prima, e perché la misura conta.** La versione 2.8.0 aveva
tokenizzato i *messaggi d'allarme* di undici template, e il manuale poteva
sembrare a posto. Ma il testo dei sinottici no: i due `demo-items` avevano 6
voci in tabella e **114 stringhe scritte a mano** nelle pagine. Chi apriva quei
template e cambiava lingua vedeva cambiare gli allarmi e nient'altro. Contare
le voci della tabella diceva mezza verità; ora `check_templates.sh` conta anche
l'altra metà — il testo che nella tabella non c'è — e non può più tornare a
crescere in silenzio.

I template con contenuto grafico hanno un **selettore lingua** in alto a destra
della prima pagina — apri il viewer e cambia lingua per vedere i testi tradursi.

> **Le emoji sul pannello.** I template usano emoji (🏠 💡 🔐 🦟 …). Sul browser si vedono a colori; sul
> pannello LVGL si vedono **in monocromo**, dal font Noto Emoji agganciato come ripiego del font del testo (T-71,
> `sws-lvgl-viewer/src/lvgl_font.rs`). Se il font emoji manca, il testo resta leggibile e solo le emoji spariscono.

---

## 5. Note tecniche

- **API**: `PUT /api/project/languages` scrive la tabella; è inclusa in
  `GET /api/project`.
- **Chi risolve i token.** Tre risolutori con una tabella di casi in comune (`tests/fixtures/risoluzione-token.json`):
  il viewer web, il viewer LVGL e `sws-core`, che serve alle notifiche. La guardia `check_i18n_parita.sh` verifica
  che web e LVGL traducano gli stessi campi.
- **Le notifiche** non hanno uno schermo: la loro lingua sta nel progetto (`notify_lang`, con `notify_lang_email` e
  `notify_lang_telegram` per canale; si sceglie nella scheda Lingue). Un destinatario email può avere la sua
  (`{ indirizzo, lingua }`, [capitolo 07](07_alarms.md#parametri)).
- **Negli script**: `tr("chiave")` **non traduce**, restituisce `{{chiave}}`. Lo risolve chi lo mostra, nella sua
  lingua — il pannello di un operatore italiano e quello di un collega spagnolo leggono lo stesso valore. Una chiave
  che non esiste non ferma lo script: va nel log e si vede come `{{chiave}}`.
- **Il testo di sistema** è la terza categoria: intestazioni di colonna, «sì»/«no», «N/D», il titolo di una
  notifica — parole che il runtime scrive da sé. Stanno in `sws-core/src/testi_sistema.rs`, in una tabella sola per
  web, LVGL e notifiche, e seguono la lingua dei contenuti; una lingua non elencata ripiega sull'inglese.
- **Cosa NON viene tradotto**: tag, colori, `format`, espressioni Python,
  identificatori. La risoluzione tocca solo i campi testo degli oggetti
  (`label`, `text`, `unit`, `pipe_label`, label di opzioni/righe/liste).
- **CSV**: intestazione `key` + un codice lingua per colonna; le virgolette
  proteggono virgole e a capo.

---

← [Indice](MAIN.md) | [← Test e Diagnostica](14_testing.md) | [Successivo → Prestazioni](16_prestazioni.md) →
