# Il menù degli strumenti: gerarchia, filtro, icone

> **Superato il 14-10-2026** dal piano [strumenti, simboli e comandi](2026-10-14-strumenti-simboli-comandi.md),
> che unisce questo seme all'altro e porta le decisioni del maintainer. Qui resta la misura di quando è nato.

> **Seme — decisione.** Quando questo lavoro comincerà, la prima cosa è una **sessione di plan
> approfondita** per sviscerarne tutti i dettagli. Qui c'è l'idea del maintainer e quello che si è
> misurato nel codice il 14-10-2026, non un piano d'esecuzione.

## L'idea del maintainer (14-10-2026)

Tre cose insieme, perché toccano lo stesso pannello:

1. **Riorganizzare completamente il menù Strumenti** con una gerarchia più sensata.
2. **Aggiungere un campo filtro** per trovare più in fretta lo strumento.
3. **Ridisegnare tutte le icone** con uno stile coerente e moderno.

## Misurato il 14-10-2026, in `sws-editor/src/editor/LeftPanel.tsx`

L'elenco autorevole è `PALETTE_GROUPS` (riga 655). Oggi:

| | |
|---|---|
| gruppi | **5** — Forme, Controlli, Display, SCADA, Layout |
| strumenti | **38** |
| il gruppo più grosso | **Display, 18 strumenti** — quasi metà di tutto |
| il più piccolo | **Layout, 1 strumento** (la griglia) |

Tre cose concrete che danno corpo alle tre richieste:

**La gerarchia non regge il peso.** Con 18 voci su 38 in un gruppo solo, «Display» non è una
categoria: è il posto dove è finito tutto ciò che non era una forma né un controllo. Ci stanno
insieme un LED, una tabella, quattro tipi di grafico e quattro oggetti di allarme — che fra loro
hanno in comune solo di non essere le altre due cose. «Layout» con un elemento è il sintomo
opposto.

**Le icone sono due famiglie mischiate.** Dei 38 glifi, **9 sono emoji vere** (🖼 🎯 🌐 🏳 🔴 🔔
🕘 📋 🧩) e gli altri 29 sono simboli geometrici Unicode (▭ ○ ╱ 〰 ⬡ ⊡ ☰ ◔ ∿ ⌇ ◧ ▐ ◑). Le due
famiglie non si somigliano in niente: le emoji sono a colori, disegnate dal sistema operativo e
**cambiano aspetto fra una macchina e l'altra**; i simboli geometrici seguono il colore del testo
e sono monocromatici. Non è una questione di gusto: è che metà del pannello non è disegnata da
noi.

**C'è un doppione**: `≣` è l'icona sia di `data_log` sia di `text_list`. Due strumenti diversi,
stessa icona.

### Il filtro: una cosa da sapere prima di progettarlo

Un filtro sugli strumenti cerca nei nomi, e i nomi **non stanno dove sembra**. In
`PALETTE_GROUPS` ogni voce ha un campo `label` in italiano (`label: "Rettangolo"`), ma quel campo
**non lo legge nessuno**: la riga si disegna con `t(\`editor.palette.item.${type}\`)` (LeftPanel
riga ~768). Quindi `label` è un doppione morto, e il filtro va costruito sulle chiavi i18n — o
cercherà in una lingua e mostrerà l'altra.

Nel pannello **c'è già un filtro**, ma è un'altra cosa: `filter` + `findObjects`
(LeftPanel riga 960 e `src/search/findObjects.ts`) cerca fra gli **oggetti piazzati** in tutte le
pagine, non fra gli strumenti da piazzare. Riusarne la forma visiva sì, la logica no.

### Due vincoli che la sessione di plan non deve scoprire a metà

- **`PALETTE_GROUPS` è l'inventario dei tipi piazzabili**, e due test ci iterano sopra:
  `tests/pannelloProprieta.test.tsx:96` e `tests/predefinitiCampi.test.ts:17`. Riorganizzare i
  gruppi va benissimo; togliere o rinominare un `type` rompe quei test, ed è giusto che li rompa.
- **La palette si filtra già due volte** per contesto (LeftPanel righe 846-853): le pagine di boot
  mostrano solo `BOOT_TYPES`, i progetti LVGL solo `LVGL_SUPPORTED_TYPES`. Una gerarchia nuova
  deve reggere anche quando due terzi delle voci spariscono — un gruppo che resta vuoto non si
  disegna.

## Da decidere quando si comincia

- Se le icone restano glifi di testo (una famiglia sola, niente emoji) o diventano **SVG nostri**:
  la seconda dà coerenza vera e il controllo del tratto, ma sono 38 disegni da fare e da mantenere,
  e va deciso dove vivono e come si colorano col tema.
- Se la gerarchia nuova è a due livelli come oggi o a tre, e se il filtro la sostituisce quando è
  attivo (elenco piatto dei risultati) o la tiene (gruppi che si svuotano).
- Se la stessa gerarchia e le stesse icone valgono anche altrove — la palette non è l'unico posto
  dove un tipo di oggetto si nomina.
