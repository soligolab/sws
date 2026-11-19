# La galleria dei simboli mostra solo i simboli dello stesso tipo

> Piano del 19-11-2026, una sessione breve. Primo passo dell'esecuzione: copiarlo in
> `docs/plans/2026-11-19-galleria-simboli-stesso-tipo.md`, con la riga in `docs/plans/README.md`. Ramo
> **`feat/symbol-gallery-kind`, annidato su `fix/setpoint-lvgl`** (che contiene `feat/symbol-def`, di cui questo lavoro
> tocca il codice), nel worktree `/home/ut1/sws-nav-links`. Codice nuovo in inglese, testi it/en.

## Contesto

Selezionando un simbolo, il pannello proprietà («Parametri → Simbolo») mostra `SymbolGallery`
(`sws-editor/src/editor/EditorShell.tsx:254-306`) con **tutti** i 195 simboli della libreria, e un clic cambia il
simbolo con uno qualsiasi: una pompa può diventare un pulsante d'emergenza. Il maintainer lo trova confuso e chiede una
prova: la galleria mostra solo i simboli **dello stesso tipo**. Inoltre oggi la galleria non mostra per niente i
simboli fatti con l'editor (`prj:`).

**Decisioni del maintainer (19-11-2026):**
1. «Stesso tipo» = **stessa tipologia** (`kind` del manifest: 27, uniche fra le famiglie; pompe 9, valvole 13…).
2. **Nessuna via d'uscita**: solo lo stesso tipo; per cambiare tipo si rimette l'oggetto. La ricerca resta, dentro la
   tipologia.
3. **La variante prende il posto dell'originale**: una pompa di libreria modificata nel progetto si vede col disegno
   modificato nella tessera della pompa (è quello che il progetto disegna comunque). Le copie «Salva come…» e i simboli
   nuovi hanno una tessera loro, in testa.
4. **La «Categoria» dell'editor dei simboli diventa un elenco** delle tipologie della libreria, tradotte, più «Altro»
   da scrivere: un simbolo nuovo messo in «Pompe» compare fra le pompe.

## Il lavoro

**La tipologia di un simbolo** — `sws-editor/src/symbols/lib/libreria.ts`, funzione nuova `symbolKind(m, id)`:
- `lib:` o alias vecchio (`pump`) → `simboloOriginale(m, id).kind`;
- `prj:` variante (`overrides`) → la tipologia dell'originale; `prj:` copia o nuovo → il suo `kind` (`tipo` della
  descrizione, che «Salva come…» conserva e un simbolo nuovo ha `project`);
- `custom:` (SVG importati) → `"custom"`: la galleria mostra solo gli SVG importati;
- sconosciuto → `null`: la galleria mostra tutto, come oggi.
Usa gli helper che ci sono già: `cercaSimbolo`, `simboloOriginale`, `varianteDi` (libreria.ts:285-311).

**La galleria** — `SymbolGallery` riceve `kind?: string | null`:
- dal pannello proprietà (`EditorShell.tsx:5718-5728`) si passa `symbolKind(manifest, obj.symbol_id)`; il selettore
  all'inserimento (`SymbolPickerModal`, :354-398) non lo passa e resta completo;
- con la tipologia: prima i simboli del progetto di quella tipologia che non sono varianti (`useSimboliProgetto`,
  libreria.ts:142), poi quelli di libreria della tipologia; un'intestazione sola, il nome tradotto della tipologia
  (`symbols.lib.tipo.<kind>`, con `project` → «Del progetto» nuovo e il nome grezzo per una tipologia sconosciuta);
- la tessera di un simbolo di libreria con una variante nel progetto mostra il disegno della variante
  (`varianteDi`) e un segno «modificato nel progetto»; il clic scrive l'id di libreria, come oggi;
- la tessera selezionata: id uguale, alias (`replaces`), o la variante dell'originale;
- la ricerca filtra dentro la tipologia.

**La Categoria nell'editor** — `sws-editor/src/symbols/editor/SymbolEditor.tsx:616-617`: un `<select>` con le
tipologie del manifest (in ordine di famiglia, nomi `symbols.lib.tipo.*`), «Del progetto» (`project`) e «Altro…» che
mostra il campo di testo di oggi (stesse regole: minuscole, a-z 0-9 -, 2-30 caratteri, `simboli_prj.rs:1188-1193`).
Una tipologia scritta che non è nell'elenco si mostra come «Altro» col suo testo.

**i18n** (it/en): `symbols.lib.tipo.project`, il segno della variante, «Altro…» della categoria.

**Documenti**: manuale (la sezione del simbolo, se descrive la galleria), CHANGELOG, voce di collaudo, `NOVITA.yaml`
insieme alle altre del rilascio.

## Test

- `symbolKind`: libreria, alias, variante, copia, nuovo (`project`), `custom:`, sconosciuto.
- La galleria con la tipologia: una pompa mostra solo pompe; la copia di una pompa in testa; la tessera della pompa con
  variante mostra la variante; il clic scrive l'id; senza tipologia (modale) l'elenco completo.
- L'editor: il menu della categoria scrive `tipo`; «Altro…» col testo libero; una tipologia sconosciuta si legge.
- `pannelloProprieta.test.tsx` (inventario dei campi, da rigenerare se cambia).

## Verifica

1. Definition of done completa e i controlli della CI.
2. IDE 8462 (dal worktree) sulla copia della fiera: selezionata la pompa, la galleria mostra solo le pompe; un serbatoio
   solo i serbatoi; dopo «Modifica simbolo» sulla pompa e salvataggio, la tessera della pompa mostra la variante; una
   «Salva come…» compare in testa fra le pompe.
3. Collaudo del maintainer.
