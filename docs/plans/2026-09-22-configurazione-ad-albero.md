# La configurazione diventa un albero laterale — seme

> **Idea del maintainer, 22-09-2026.** Trasformare il menù di Configurazione in un **albero
> laterale**, ispirato a quello degli SCADA che mettono tutto il progetto in una colonna sola
> (server → sorgenti, display, oggetti, allarmi, storico, utenti, viste…). Le schede che hanno
> bisogno di spazio continuano ad aprirsi **nell'area dell'IDE**, come adesso. Lo scopo dichiarato:
> **arrivare più in fretta a tutte le opzioni**.
>
> **Quando si comincerà questo lavoro, il primo passo è una sessione di plan approfondita, in plan
> mode e senza scrivere codice, per sviscerarne ogni dettaglio.** Questo file è materiale, non un
> piano d'esecuzione: fra la domanda e il lavoro passa troppo tempo, e un disegno scritto mesi
> prima è un disegno che mente.

## Misurato oggi (22-09-2026)

- **Sedici schede**, dichiarate in **tre elenchi paralleli** che nessuno tiene allineati:
  `AppConfigTab` (`store/index.ts:229`), `ConfigTab` (`config/ConfigView.tsx:11153`, copia
  letterale del primo, senza import) e `visibleTabs` in due varianti admin/non-admin
  (`ConfigView.tsx:~11186`). Le etichette vengono da `t("config.tabs.<id>")`.
- `ConfigView.tsx` è **11737 righe** (11629 quando questo seme è nato): ogni scheda è un componente
  dentro quel file, tranne «Tipi», che sta in `config/TipiTab.tsx`.
- **Aggiornamento del 22-09-2026, a Fase 2 dei tag chiusa**: le schede restano sedici, ma «Variabili»
  ne contiene ora **due**, scelte da un selettore interno («Variabili | Tipi»), con una barra Salva
  sola e l'export/import CSV che copre entrambe. È il primo caso di annidamento dentro una scheda, e
  dice qualcosa a questo seme: se l'albero arriva, quelle due diventano due foglie sotto lo stesso
  ramo invece di un selettore fatto a mano. `SezionePendente` (in `ConfigView.tsx`) esiste apposta:
  registra la bozza di una sottoscheda senza disegnare una seconda barra.
- Dal 22-09-2026 le nove schede che portano **contenuto del progetto** restano montate
  (`Tenuta`) e registrano la loro bozza fra le `pendingSections`: il Salva è **uno solo**, quello
  del progetto. Un albero che monta e smonta i rami rompe questo, ed è la prima cosa che la
  sessione di plan dovrà guardare.
- Un albero e una barra di icone **esistono già** e sono condivisi fra pannello sinistro e destro:
  `BarraIcone` e `useSezioneAperta` in `editor/stilePannelli.tsx`, l'albero delle pagine in
  `editor/LeftPanel.tsx` (`PagesSection`, `page_tree` con riordino e gerarchia). Il lavoro nuovo
  dovrebbe partire da lì, non da un terzo albero scritto da capo.
- La memoria delle sezioni aperte è già per chiave (`sws.pannelli.*`): un albero la userebbe per
  ricordare quali rami restano aperti.

## Cosa la sessione di plan dovrà decidere

- **Dove vive l'albero**: una quarta vista del pannello sinistro (accanto a pagine, struttura,
  funzioni, tag, sorgenti) oppure una colonna sua, che compare solo in Configurazione.
- **Cosa sono le foglie**: le sedici schede di oggi, o una gerarchia più fine (una sorgente per
  foglia, un datastore per foglia, un faceplate per foglia) — che è ciò che rende l'albero più
  veloce di sedici schede, e insieme la cosa che costa di più.
- **Il Salva unico**: quali foglie portano bozza, e come restano vive quando non sono selezionate.
- **Le schede larghe**: quali si aprono nell'area dell'IDE e quali stanno nel pannello.
- **I tre elenchi paralleli**: diventano uno solo e dichiarativo (id, etichetta, icona, ruolo
  minimo, sezione padre, «porta bozza»), altrimenti l'albero è il quarto elenco da tenere allineato.
- **Cosa succede alle rotte `#config/<tab>`** e alla `navigateToConfig` che oggi le usa.

## Perché non adesso

Il piano dei tag (`2026-09-21-gestione-tag-oggetto-unico.md`) sta per introdurre una scheda
**«Tipi»** (Fase 2) e cambiare la scheda Variabili in una tabella ad albero: due pezzi che
toccano esattamente la stessa superficie. Farli prima significa disegnare l'albero sapendo che
cosa deve contenere, invece di rifarlo due volte.
