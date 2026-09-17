# Le regole dei template — definirle prima di rimettere mano ai template

> **Stato: BOZZA, in attesa delle decisioni del maintainer.** Nessuna riga di codice, nessun
> template toccato finché le regole non sono approvate. È esplicitamente ciò che il maintainer
> ha chiesto il 16-09-2026: «riprendiamo il lavoro dei template ma prima di implementarlo
> definiamo delle regole».

## La richiesta

Testuale, 16-09-2026:

> «tipo che tutti devono avere aspect ratio 16:10 pensato per schermi 1280x800, tutti devono
> supportare almeno 3 lingue (italiano inglese e spagnolo), tutti devono essere semplici e
> mostrare un tipo di risorsa + alcuni casi d'uso più vicini alla realtà come impianti domestici
> etc…»

Quattro regole, più una quinta che propongo io e che nasce da un difetto vero di questa settimana
(§R5).

## Prima le misure, poi le regole

Misurato il 17-09-2026 su `examples/templates/`, dodici template (non undici: `t69-collaudo` non
compare nell'inventario del Passo 2 perché non ha un `README.md` di ruolo).

| Template | Pagine | Prima pagina | Lingue | Voci | Oggetti | Tipi | Testi nei sinottici | di cui tradotti |
|---|---|---|---|---|---|---|---|---|
| `casa-locale` | 5 | 800×680 | it,en | 141 | 298 | 14 | 169 | **160** |
| `demo-items-lvgl` | 4 | 1280×800 | it,en | 6 | 126 | 35 | 101 | **0** |
| `demo-items-web` | 4 | 1280×800 | it,en | 6 | 126 | 35 | 101 | **0** |
| `enip-demo` | 1 | 1280×800 | it,en | 2 | 16 | 5 | 10 | **0** |
| `grid-playground` | 2 | 900×720 | it,en | 28 | 27 | 15 | 28 | 27 |
| `homeassistant-demo` | 3 | 800×620 | it,en | 75 | 153 | 11 | 88 | 87 |
| `homeassistant-pro` | 6 | 800×620 | it,en | 167 | 441 | 12 | 246 | 236 |
| `nebulizzatore-sandokan` | 1 | 1280×600 | **it** | 2 | 21 | 8 | 7 | **0** |
| `opcua-demo` | 2 | 880×660 | it,en | 18 | 27 | 10 | 21 | 16 |
| `s7-demo` | 1 | 1280×800 | it,en | 2 | 16 | 5 | 10 | **0** |
| `sparkplug-demo` | 1 | 1280×800 | it,en | 2 | 18 | 5 | 11 | **0** |
| `t69-collaudo` | 2 | 1280×800 | **it** | 0 | 45 | 6 | 41 | **0** |

### Tre cose che la tabella dice e che conviene leggere prima di decidere

**1. Il multilingua dei template è più piccolo di come l'ho raccontato.** La Fase 7 del piano
multilingua ha tokenizzato **i messaggi d'allarme** — 45, in undici template — e il corpo del
commit lo dice con precisione. Il titolo di quel commit, «i template passano tutti dalla tabella
lingue», promette di più di quello che è stato fatto: **sei template su dodici hanno zero testo
tradotto nei sinottici**. `demo-items-web` e `demo-items-lvgl` ne hanno 101 ciascuno, tutti
letterali. Chi apre quei template e cambia lingua vede cambiare gli allarmi e nient'altro.

Quindi «tutti devono supportare tre lingue» non è «aggiungere una colonna `es`»: per sei template
è **tokenizzare da zero** circa 180 stringhe, e solo dopo tradurle.

**2. Il 16:10 costa molto diverso a seconda del template.** Sei sono già 1280×800. Gli altri sei
no, e i due più lontani sono anche i due più grandi: `homeassistant-pro` (441 oggetti su 6 pagine
a 800×620) e `casa-locale` (298 oggetti su 5 pagine a 800×680). Riflusso a mano di 739 oggetti,
oppure una scelta diversa.

**3. «Semplici» e `homeassistant-pro` non stanno nella stessa frase.** 441 oggetti, 6 pagine, 246
testi. È il template più grande del parco, e il suo `README` lo dichiara «versione completa». O
la regola lo esclude per nome, o quel template cambia natura.

---

## Le regole proposte

Ognuna nella forma: **cosa**, **perché**, **come si verifica**. La terza colonna è la parte che
rende una regola diversa da un'opinione — questo repo ha diciannove guardie e la lezione ricorrente
è che una regola senza guardia scade in silenzio.

### R1 — Rapporto 16:10, 1280×800

**Cosa.** Ogni pagina di ogni template è 1280×800.

**Perché.** È la risoluzione dei pannelli su cui il prodotto gira. Dal 16-09 è anche il default
dell'IDE per una pagina nuova, quindi un template che non la usa è un template che nasce già
diverso da tutto ciò che l'utente creerà dopo. Oggi convivono cinque formati diversi
(800×620, 800×680, 880×660, 900×720, 1280×600, 1280×800) e nessuno dei cinque è una scelta: sono
sedimentazioni.

**Come si verifica.** Una riga in più in `check_templates.sh`: `width: 1280` e `height: 800` in
ogni `synoptics/*.yaml`. Costa niente ed è esatta.

**Cosa comporta.** Sei template da riflussare, di cui due grandi. Vedi la decisione **D1**.

### R2 — Tre lingue davvero: it, en, es

**Cosa.** Ogni template dichiara `langs: [it, en, es]`, **e ogni testo visibile all'operatore
passa dalla tabella**. Non solo gli allarmi: etichette, titoli, unità, messaggi di conferma.

**Perché.** Perché è quello che l'utente si aspetta trovando scritto «multilingua», e perché un
template è ciò che copia: se il template ha le stringhe cablate, l'utente cabla le sue.

**Come si verifica.** `check_templates.sh` ha già la guardia sui token orfani (un `{{t0001}}`
senza voce in tabella). Le manca il verso opposto: **testo visibile che non è un token**. È la
stessa misura della tabella qui sopra, quindi è già scritta — va solo trasformata in guardia, con
un elenco di eccezioni dichiarate per ciò che non si traduce (sigle, unità SI, nomi di prodotto).

**Cosa comporta.** ~180 stringhe da tokenizzare in sei template, poi la traduzione automatica —
che ora esiste e costa un clic per colonna. Il grosso è la tokenizzazione, non la traduzione.

### R3 — Semplici: un tetto dichiarato

**Cosa.** Un template mostra **un tipo di risorsa**, in **al massimo 3 pagine**, con **al massimo
~60 oggetti per pagina**.

**Perché.** «Semplice» non si può verificare; un numero sì. I numeri proposti vengono dalla
misura: nove template su dodici stanno già sotto, e i tre che sfondano sono esattamente quelli che
nessuno consiglierebbe come punto di partenza a un utente nuovo.

**Come si verifica.** Conteggio in `check_templates.sh`, con la lista delle eccezioni dichiarate
nel file della guardia — se `homeassistant-pro` resta com'è, ci sta dentro **con il perché
scritto accanto**, che è meglio di una regola che finge di valere.

**Cosa comporta.** Vedi la decisione **D2**.

### R4 — Un tipo di risorsa, e un caso d'uso vero

**Cosa.** Il `README.md` di ogni template dichiara, in cima: il **tipo di risorsa** mostrato
(una presa smart, un inverter, un PLC, un contatore) e il **caso d'uso** in una frase, preferendo
l'impianto domestico o la piccola macchina all'astrazione.

**Perché.** Il Passo 2 della revisione (già fatto, `701b59f`) ha dato a ognuno un **ruolo**
dichiarato — inventario, banco di prova di protocollo, banco di prova di feature, applicazione
realistica. Questa regola è il gradino successivo: dentro il ruolo «applicazione realistica»,
dire *di cosa* si parla. È anche l'unica delle cinque che non si può verificare con una guardia
utile: la presenza di una sezione sì, la sua verità no.

**Come si verifica.** Presenza e forma della sezione in `README.md`; il contenuto lo legge una
persona.

### R5 — Un template non porta la rete di nessuno *(proposta mia, non nella lista del maintainer)*

**Cosa.** Nessun template dichiara indirizzi, host o credenziali di un impianto reale. Si usano
nomi riservati (`mqtt.example.invalid`), `localhost`, o il nome mDNS convenzionale di un prodotto
(`homeassistant.local`, che è documentazione del prodotto e non la rete di qualcuno).

**Perché.** Il 16-09 aprire un progetto da `nebulizzatore-sandokan` ha prodotto 1950 righe su 2000
di `connection refused` in pochi minuti: il template dichiara `192.168.1.6`, che è il broker di
casa del maintainer. Il rumore è stato mitigato (backoff, commit `413fb8eb`), ma quello era il
sintomo. E non si ferma agli indirizzi: con la stessa naturalezza un template può portare un token
Telegram o una password MQTT — *«i segreti viaggiano col progetto»* è una decisione presa e giusta
**per un progetto**, ma un template non è un progetto: è qualcosa che si dà a chi con
quell'impianto non c'entra niente.

**Come si verifica.** Guardia su `project.yaml`: nessun IP letterale privato, nessun campo
`password`/`token`/`api_key` non vuoto. *(Oggi le credenziali sono già a zero in tutti e dodici —
verificato. Gli indirizzi no: `casa-locale` ha `192.168.1.6` quattro volte,
`nebulizzatore-sandokan` una.)*

**Stato.** Registrata come **Q58** in `docs/OPEN_QUESTIONS.md` il 17-09, con tre vie possibili
(regola + guardia, sorgenti fuori dai template, sorgenti disarmate all'apertura). Questa regola è
la prima delle tre; le altre due sono lavoro di prodotto e restano lì.

---

## Le decisioni che servono prima di scrivere codice

### D1 — Il 16:10 vale per tutti, o solo per i nuovi?

Il costo non è uniforme: riflussare `homeassistant-pro` (441 oggetti) e `casa-locale` (298) è
lavoro vero, e sono anche i due template che un utente apre per vedere «com'è fatta una cosa
finita».

- **(a) Tutti, riflussati a mano.** Coerenza completa, costo alto, rischio di rompere layout che
  oggi funzionano.
- **(b) Tutti, ma con un riflusso proporzionale** — scalare le coordinate di 800×620 → 1280×800
  è un fattore 1,6 su x e 1,29 su y: le proporzioni cambiano, il testo no. Va guardato a schermo,
  non calcolato.
- **(c) Solo i template nuovi e quelli che si toccano comunque nel Passo 5.** I sei già a
  1280×800 restano, i sei fuori formato si sistemano quando gli si mette mano per le altre
  regole. La regola vale da subito per tutto ciò che nasce.

*Raccomandazione: (c).* È l'unica che non blocca il Passo 5 dietro a un riflusso di 739 oggetti, e
la guardia si può accendere con la lista delle eccezioni dichiarate che si svuota man mano.

### D2 — `homeassistant-pro` è un'eccezione o cambia natura?

- **(a) Eccezione dichiarata.** Resta com'è, con il perché scritto nella guardia: è la vetrina del
  «cosa si può fare», non il punto di partenza.
- **(b) Si sfoltisce** fino a rientrare nel tetto.
- **(c) Si divide** in due template, uno base e uno avanzato.

*Raccomandazione: (a).* Un parco template senza nessun esempio completo perde qualcosa che ha
valore, e la parola «pro» nel nome è già l'avviso.

### D3 — `t69-collaudo` è un template?

Non ha `README.md`, quindi il Passo 2 non gli ha dato un ruolo; ha 0 voci di lingua, 41 testi
letterali e una sola lingua. È il banco di prova di T-69, nato per esercitare gli script.
Se resta in `examples/templates/` deve rispettare le regole come tutti; se è uno strumento di
collaudo può vivere altrove e sparire dalla vetrina.

*Raccomandazione: spostarlo fuori dalla vetrina* (o dargli un `README` che dichiari il ruolo
«banco di prova» e un'eccezione esplicita alle regole R1-R3, come per gli altri banchi).

### D4 — Le regole valgono anche per i banchi di prova?

Quattro template sono «banco di prova di un protocollo» (`enip`, `s7`, `sparkplug`, `opcua`) e due
sono inventari (`demo-items-*`). Il loro lavoro è esercitare una cosa, non insegnare un impianto.
R1 la rispettano già; R2 (tre lingue *vere*) su un inventario di 35 tipi di widget significa
tokenizzare 101 etichette che sono **nomi di widget** — cioè documentazione, non testo
d'impianto.

*Raccomandazione:* R1, R4 e R5 valgono per tutti; **R2 e R3 valgono per le applicazioni realistiche
e per gli inventari, non per i banchi di protocollo**, e l'esenzione si dichiara nel `README` di
ciascuno accanto al ruolo. Per i `demo-items-*`, tokenizzare le etichette ha senso proprio perché
sono la vetrina che l'utente copia.

---

## Il lavoro, una volta decise le regole

1. **Le regole diventano un documento breve** in `docs/` (non questo piano: questo è il referto
   della discussione) e una sezione nel `README.md` di `examples/templates/`.
2. **Le guardie**: R1 e R3 sono conteggi in `check_templates.sh`; R2 è il verso mancante della
   guardia sui token; R5 è una guardia nuova e piccola. Tutte provate rosse prima che verdi, con
   la lista delle eccezioni dichiarate che è la misura del debito residuo.
3. **Passo 5 della revisione template** — i sei template fermi al 28-08 — si fa **applicando le
   regole**, non prima e non a parte. È il pezzo che restava del piano
   [2026-09-14-revisione-template.md](2026-09-14-revisione-template.md).

## Rischi dichiarati

- **R2 è la regola cara**: ~180 stringhe da tokenizzare a mano in sei template. La traduzione
  automatica non aiuta con la tokenizzazione, solo con le colonne dopo.
- **Il riflusso a 1280×800 non si calcola, si guarda.** Qualunque scala automatica va verificata
  a schermo, e su `homeassistant-pro` sono sei pagine.
- **Le eccezioni dichiarate sono un debito, non un'assoluzione.** Vanno scritte con il perché e
  devono tendere a zero, altrimenti fra un mese la guardia è verde e le regole non valgono più.
