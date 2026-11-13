# Il cestino dei progetti, con 30 giorni di ritenzione

**Piano, 13-11-2026** — richiesta del maintainer guardando la pagina iniziale. Ramo `feat/cestino-progetti`.

## Context

Oggi la X sulla scheda di un progetto (pagina iniziale, `WelcomeScreen.tsx:547`) chiama `DELETE /api/projects/…` e
cancella la cartella subito, con una conferma «non reversibile». Richiesta del maintainer (13-11-2026): la X deve
spostare il progetto in un **Cestino**, visibile come la sezione «ARCHIVIATI», da cui dopo **30 giorni** si cancella da
sé. I giorni devono vedersi nel titolo della sezione («CESTINO (30 giorni di ritenzione)») e su ogni progetto, come
giorni mancanti alla cancellazione.

Decisioni del maintainer (13-11-2026):
- nel cestino: **Ripristina** (torna com'era, anche fra gli archiviati) ed **Elimina ora** (conferma «non reversibile»);
- anche la X degli **archiviati** sposta nel cestino: la cancellazione vera la fa solo il cestino.

Fuori dal cestino restano i **progetti esterni** (cartelle registrate, la X li toglie dall'elenco senza toccare i
file: invariato) e il `DELETE` delle API, che deve restare una cancellazione vera — il deploy remoto lo usa sui
pannelli (`remote.rs:3723`, e `preserve_state` a 3465/3540).

Ramo `feat/cestino-progetti` da `main` (nessun ramo aperto). Codice nuovo in inglese, testi nei file di lingua.

## Come

**Il modello è l'archivio** (`sws-web/src/archivio.rs`): un segno nella cartella del progetto, letto dall'elenco e
rispettato da apertura e duplicazione. Il cestino è un secondo segno, `.cestino` → `{quando_ms, da}`, nello stesso
file e con la stessa forma (`Archiviato` riusato o gemello `Trashed`).

### Server (`sws-runtime/crates/sws-web/`)
- `archivio.rs`: `TRASH_MARK = ".cestino"`, `RETENTION_DAYS = 30`, `read_trash(dir)`; handler `trash` e `untrash`
  costruiti come `archivia_o_ripristina` (stesso `project_switch_lock`, `risolvi_progetto`, 409 se il progetto è
  aperto, audit `project.trash` / `project.untrash`). Ripristinare toglie solo `.cestino`: un archiviato resta
  archiviato.
- `router.rs`: `POST /api/projects/:azienda/:nome/trash` e `/untrash` (più le forme a un segmento, come
  `/archive`), nel gruppo `project_lifecycle`. «Elimina ora» è il `DELETE` di sempre.
- `projects.rs`:
  - `list_projects` (~629) riempie anche `cestino: {quando_ms, da, scade_ms}`; `scade_ms` lo calcola il server
    (`quando_ms + 30 g`), così il numero sta in un posto solo;
  - `open_project` (~1656) rifiuta un progetto nel cestino (409), come per l'archivio; `duplicate` (~2711) non copia
    il segno;
  - `delete_project` scrive anche l'audit `project.delete` (oggi manca).
- **La pulizia**: `trash_purge.rs` sul modello di `ciclo_account.rs` (attesa iniziale, poi `interval(1h)`, `giro(s,
  ora_ms)` con l'ora iniettata per i test): per ogni progetto con `.cestino` scaduto fa quello che fa
  `delete_project` (spegnere il container con `spegni_container` se c'è la regia, `remove_dir_all`,
  `known_projects.remove`, audit `project.purge`). Si avvia in `sws-runtime/src/main.rs` **sul gateway e sull'IDE
  locale**, non sui pannelli (che non hanno la pagina iniziale). Una funzione condivisa estratta da `delete_project`
  per non avere due cancellazioni diverse.
- I progetti nel cestino **contano nella quota** dell'azienda (sono ancora su disco): resta così, e il testo della
  sezione lo dice.

### Editor (`sws-editor/src/`)
- `types/index.ts` `ProjectListEntry`: `cestino?: { quando_ms: number; da: string; scade_ms: number }`.
- `api/client.ts`: `trashProject(rif)`, `untrashProject(rif)`.
- `components/WelcomeScreen.tsx`:
  - la X (`handleDelete`): per un progetto non esterno chiama `trashProject`, conferma leggera («va nel cestino, si
    cancella fra 30 giorni»); esterni invariati;
  - elenco principale e archiviati escludono i progetti nel cestino;
  - sezione **CESTINO** copiata da quella degli archiviati (728-754), sotto di lei: toggle
    `cestino-toggle` col testo «Cestino ({{n}}) — 30 giorni di ritenzione»; ogni riga `cestino-<rif>` con, sopra
    l'icona, un'etichetta «fra N giorni» (`Math.ceil((scade_ms - ora) / giorno)`, «oggi» sotto 1), più
    «Ripristina» e «Elimina ora» (conferma con `pericolo`, `welcome.confirmDelete`).
- i18n it/en: `welcome.cestino`, `cestinoRitenzione`, `cestinoGiorni` (con plurale), `confermaCestino`,
  `ripristinaDalCestino`, `eliminaOra`, `errCestino`.

### Documenti
Piano in `docs/plans/2026-11-13-cestino-dei-progetti.md`; `CHANGELOG.md`; una voce in `NOVITA.yaml` (2.26.0 è a 15
voci: si accorpa); capitolo HOWTO se c'è quello dell'archivio. CasaDomotica: non si applica (è una funzione
dell'elenco dei progetti, non dell'impianto) — annotarlo.

## Verifica
- `cargo test`: segno letto anche rovinato; `trash`/`untrash` (409 se aperto, archiviato che resta archiviato);
  `giro` con l'ora iniettata — scaduto cancellato, non scaduto lasciato, cartella sospetta non toccata (come in
  `ciclo_account.rs:226-277`).
- vitest `tests/cestinoProgetti.test.tsx`: la X chiama `trashProject`, la sezione mostra «30 giorni di ritenzione» e
  «fra N giorni», Ripristina ed Elimina ora chiamano le API giuste.
- `pnpm build`, `./scripts/check_static.sh`, vitest completo.
- A mano sull'IDE 8460 e poi nel cloud (rc successiva): X → cestino, giorni giusti, Ripristina, Elimina ora; un
  `.cestino` con `quando_ms` di 31 giorni fa sparisce al giro successivo.
