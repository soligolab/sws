# Q36 — `min_role` non esiste sul pannello LVGL

> Trasferito da `docs/OPEN_QUESTIONS.md` (Q36) il 2026-09-12, aperta il 2026-09-05. Presenta
> la domanda, non la decide. **Non confondere con**
> `docs/plans/2026-09-12-ruolo-minimo-avviso-noauth.md`: quello è l'avviso nell'editor per il
> caso no-auth sul motore **web**, già deciso e pronto da costruire. Questa scheda è diversa e
> più grande: il motore **LVGL** non ha alcun concetto di ruolo, con o senza auth.

## Il problema

`grep min_role` su `sws-lvgl-viewer/src/` dà solo le dichiarazioni di campo in `model.rs`:
`lvgl_render.rs` non le usa mai. Un oggetto `min_role: Admin` sul pannello si disegna e riceve
tocchi come qualunque altro, mentre nel browser verrebbe nascosto o reso inerte.

**Non è un buco di sicurezza** — l'enforcement vero è per-tag (`TagDef.write_min_role`,
verificato dal server), e `min_role` sugli oggetti è dichiarato "UX, non un confine di
sicurezza" (`sws-core/src/project.rs:79`). È una **UX di sicurezza che sul pannello non
esiste**: con utenti definiti, un client LVGL è un Viewer anonimo e si vede respingere *tutte*
le scritture (non solo quelle sotto `min_role`), con un fallimento muto per chi tocca lo
schermo — un'esperienza peggiore, non un rischio.

## Opzioni, dalla più piccola alla più grande

1. **Lasciare il gap, dichiarato** — già fatto: il commento accanto ai due campi in `model.rs`
   dice che sono conosciuti e non resi. Zero lavoro in più.
2. **Un ruolo da configurazione del pannello**: il viewer LVGL nasce con un ruolo dichiarato nel
   suo file di avvio e applica gli stessi gate del browser. Piccolo, ma è un ruolo *del
   dispositivo*, non di chi lo tocca in quel momento.
3. **Una sessione vera nel client LVGL**, oggi anonimo per costruzione. Il lavoro grosso — tira
   dentro l'autenticazione su un pannello senza tastiera (che tastierino virtuale userebbe?).

**Default per il PoC**: opzione 1 (stato attuale).

## Prossimo passo

Chiedere al maintainer se il caso reale che ha fatto emergere la domanda giustifica l'opzione 2
(un ruolo di dispositivo dichiarato all'avvio) — è il gradino di mezzo, non richiede
autenticazione vera sul pannello ma darebbe comunque un gate coerente con la UX del browser.

## File coinvolti (solo se si sceglie 2 o 3)

`sws-lvgl-viewer/src/model.rs` (i due campi già dichiarati), `sws-lvgl-viewer/src/lvgl_render.rs`
(dove applicare il gate), il file/flag di avvio del viewer (opzione 2) o un meccanismo di sessione
nuovo (opzione 3, molto più grande — da non sottovalutare in stima).

---

## Testo originale della scheda (spostato da `docs/OPEN_QUESTIONS.md` il 2026-09-12)

## Q36 — `min_role` non esiste sul pannello LVGL

*Aperta il 2026-09-05. Il sospetto era scritto in `docs/plans/2026-08-21-scada-widgets.md:122-126`
(«il viewer LVGL ha il concetto di ruolo? verificare») e la verifica non era mai stata fatta.
Adesso è fatta.*

`grep min_role` su tutto `sws-lvgl-viewer/src/` dà **due righe**: le dichiarazioni di campo in
`model.rs`. `lvgl_render.rs` non le menziona mai, e nel crate non esiste alcun concetto di ruolo.
Un oggetto `min_role: Admin` viene disegnato sul pannello come qualsiasi altro, con i suoi handler
di tocco registrati, mentre **nel browser** viene nascosto o reso inerte
(`SvgCanvas.tsx`, gate `min_role_effect`).

Non è un buco di sicurezza, ed è importante dire perché: l'enforcement vero è **per-tag**,
`tag_write_allowed` applica `TagDef.write_min_role` lato server, e la divisione è già dichiarata in
`sws-core/src/project.rs:79` — *«è l'enforcement che il server può davvero garantire — il min_role
degli oggetti è UX»*. È una **UX di sicurezza che sul pannello non esiste**. L'esito pratico
dipende dalla modalità auth: senza utenti definiti il client LVGL passa per Admin sintetico e
l'oggetto è operabile; con utenti definiti è un Viewer anonimo e gli vengono respinte **tutte** le
scritture, non solo quelle sotto `min_role`, con un fallimento muto per chi tocca lo schermo.

**Options**

1. **Lasciare il gap, dichiarandolo** (fatto: il commento accanto ai due campi in `model.rs` dice
   che sono conosciuti e non resi, come prescrive la policy in testa a quel file).
2. **Un ruolo da configurazione del pannello**: il viewer LVGL nasce con un ruolo dichiarato nel
   suo file di avvio e applica i gate come il browser. Piccolo, ma è un ruolo *del dispositivo*,
   non di chi lo tocca.
3. **Una sessione vera nel client LVGL**, che oggi è anonimo per costruzione. È il lavoro grosso, e
   tira dentro l'autenticazione su un pannello senza tastiera.

**Default for PoC**: opzione 1. **Decided**: not yet.
