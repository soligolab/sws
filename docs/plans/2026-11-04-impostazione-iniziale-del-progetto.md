# L'impostazione iniziale di un progetto nuovo — seme

> **Stato: seme — decisione.** Nato il 04-11-2026 da una richiesta del maintainer: «quando inizio un progetto vuoto
> l'area di lavoro è vuota e la pagina non configurata, l'impatto è dispersivo. Servirebbe una finestra [la Finestra
> di avviso] che chieda di definire gli aspetti di progetto di default per tutte le pagine tra cui "Page size",
> "Background (light)" e "Background (dark)", "Rendering engine", "Full-screen viewer" e le poche altre info di setup
> iniziale del progetto da valutare assieme».
>
> **Quando questo lavoro comincia, il primo passo è una sessione di plan approfondita, dedicata, per sviscerarne
> tutti i dettagli.** Qui ci sono l'idea e le misure del 04-11-2026, non un progetto. Dipende dalla
> [Finestra di avviso](2026-11-04-finestra-di-avviso.md).

## L'idea

Appena creato un progetto vuoto, una finestra al centro raccoglie le scelte che valgono per tutte le pagine e che oggi
stanno sparse nel pannello Proprietà della pagina. Si conferma una volta, e la prima pagina nasce già giusta.

## Le misure di oggi

| | |
|---|---|
| Cosa chiede oggi «Nuovo progetto» | `components/benvenuto/NuovoProgetto.tsx`: nome, azienda, destinazione (web o LVGL con il dispositivo framebuffer), cartella |
| Dove stanno le scelte, dopo | nel pannello Proprietà quando nessun oggetto è selezionato: *Page size* (preset di dispositivo, tra cui i Pixsys WP/TC), *Default format* (dimensione e sfondi chiaro/scuro delle pagine nuove, «Apply to pages without their own format»), *Rendering engine*, *Sizing mode*, *Home page*, *Full-screen viewer*, *Frame* (cornice predefinita), *Active area background image* |
| Altre scelte di progetto | lingue (Configurazione → Lingue), stile dei simboli (Stile), e da oggi le regole IA del progetto (piano [un modello per ogni scopo](2026-11-04-un-modello-per-ogni-scopo.md)) |
| Doppione da evitare | la destinazione chiesta alla creazione e il *Rendering engine* sono lo stesso dato in due posti (regola UI «una sezione per dato») |

## Candidati per la finestra (da scegliere insieme)

dispositivo o dimensione della pagina; sfondo chiaro e scuro; motore di rendering; visualizzatore a tutto schermo;
cornice (intestazione e navigazione); lingue del progetto; stile dei simboli; tipo di impianto per l'assistente IA.

Domande per la sessione di plan: la finestra compare solo per il progetto vuoto o anche per un template? Si può
riaprire dopo (per esempio da Progetto → Impostazioni)? Cosa resta nel pannello Proprietà?
