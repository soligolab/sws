# Lock del progetto, «Salva come…» col repository, sorgenti spegnibili, sandbox piccola — piano

> Sessione di plan del 21-11-2026 (sera), sul «gruppo 1» scelto dal maintainer: i difetti che possono far perdere
> lavoro. Quattro rami annidati sopra `feat/ai-fields`, dal più piccolo al più grosso. Nascono da quattro semi, che
> restano vivi per le parti non prese qui:
> [due editor](semi/2026-10-21-due-editor-sullo-stesso-progetto.md),
> [Salva come e il repository](semi/2026-11-10-salva-come-e-il-repository.md),
> [sorgenti](semi/2026-11-10-sorgenti-spegnere-assenze-e-inverter.md),
> [sandbox, secondo giro](semi/2026-11-10-sandbox-degli-script-secondo-giro.md).

## 1. Sandbox degli script, la parte piccola — `fix/sandbox-small`
Scelta del maintainer: C1 + C2 + C3 + A3 del seme.
- **C1**: quando un giro finisce in errore o in timeout, quello che lo script ha stampato fino a lì arriva nel registro
  accanto all'errore (oggi si perde).
- **C2**: `_apply_` fornito (`f(*lista)`, `f(**diz)` funzionano anche con RestrictedPython), anche nel controllo.
- **C3**: lo script gira con un dizionario solo, così le costanti di primo livello si vedono dentro un `def`. I due testi
  che documentano il limite (`schema_python` in `ai/tools.rs`, `docs/HOWTO.md` §15) si aggiornano.
- **A3**: un parametro di funzione non può cominciare con `_` né chiamarsi come un nome fornito (`tags`, `state`,
  `print`…): rifiutato al salvataggio, con il motivo.

## 2. Sorgenti: attiva, e tolleranza per giri — `feat/source-enabled`
Scelta del maintainer: «attiva + tolleranza».
- Campo `enabled` su ogni sorgente, default `true` (i progetti esistenti non cambiano). Spenta: non parte, i suoi tag
  sono `Bad`, `<sorgente>.disponibile` è falso; il validatore non segnala i suoi tag. Interruttore nell'IDE, un posto
  solo.
- Campo `tolerance_rounds` sulle sorgenti a giro (Modbus TCP e RTU, dove c'è `marca_bad`): una risposta persa lascia
  l'ultimo valore, con qualità `Uncertain`, per N giri; poi `Bad`. Default 0 = come oggi.
- I tre stati «sempre / mai / solo quando…» (l'assenza prevista, l'inverter di notte) restano nel seme.

## 3. «Salva come…» su un repository git — `feat/save-as-git`
Scelta del maintainer: tre scelte, il merge dopo.
- Il dialogo compare solo se l'originale è un repository. Tre scelte:
  - **nuovo repository**: la storia resta, `origin` e la chiave SSH no (come il fork da un commit);
  - **nessun repository**: la copia senza `.git`;
  - **un ramo con un nome**: la copia tiene `.git` e passa al ramo nuovo; il primo Push imposta l'upstream.
- Nel cloud il lavoro sul repository lo fa chi duplica (il gateway), con git che ha dal 15-10-2026.
- «Porta qui le modifiche di un altro ramo» (merge, conflitti senza terminale) resta nel seme.

## 4. Lock del progetto — `feat/project-lock`
Scelte del maintainer: proteggere l'apertura una seconda volta con un lock vero.
- Il lock lo tiene **il runtime che serve il progetto** (il container nel cloud, il runtime in LAN): in memoria, per
  progetto. Il titolare è **una scheda dell'IDE** (un identificativo per scheda), con il nome dell'utente quando c'è.
- La scheda lo tiene vivo con un battito ogni 15 s; **scade dopo 1 minuto** senza battiti (browser chiuso, rete giù).
- Chi apre un progetto già preso vede chi lo ha e da quando, e sceglie: **Apri in sola lettura / Prendi il controllo /
  Annulla**. Vale anche fra due schede dello stesso utente («aperto da te in un'altra scheda»).
- **In sola lettura** si guarda tutto; il salvataggio è spento e una fascia in alto lo dice, con «Prendi il controllo»
  sempre a portata.
- **Prendere il controllo** lo può chi può modificare il progetto, dopo una conferma. L'altra scheda lo scopre al
  battito dopo («mario ha preso il controllo») e passa in sola lettura: le modifiche non salvate restano a schermo ma
  non si salvano.
- **Il server lo fa rispettare**: una scrittura di progetto da una scheda che non ha il lock riceve 423. Una richiesta
  senza l'identificativo di scheda (script, `curl`, il viewer) passa come oggi, la stessa regola di `If-Match`.
- La finestra a tempo di 20 s dell'avviso «il progetto è cambiato» (`App.tsx`) si tiene: col lock il cambio venuto da
  un altro IDE non può più accadere mentre si lavora, e restano deploy e pull, che non sono nostri.

## Verifica
Ogni ramo: `cargo check`, `pnpm build`, `check_static.sh`, `cargo test`, vitest. Collaudo del maintainer dall'IDE
locale (`start_editor_develop.sh`) col ramo in cima: due schede sullo stesso progetto (lock), «Salva come…» su un
progetto con repository, una sorgente spenta e una Modbus con tolleranza in CasaDomotica, uno script con una costante
usata in un `def` e un `print` prima di un errore.
