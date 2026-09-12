# Il ruolo minimo di un oggetto non avvisa che in no-auth non serve a niente

## Contesto

Da `STATUS.md` "Da fare, dalle sessioni precedenti" (segnalato 2026-08-24, causa isolata e
verificata il 2026-09-06): un oggetto con `min_role: Admin` funziona comunque per chiunque, sul
runtime in modalità senza utenti — e l'editor non lo dice, quindi sembra un difetto del gating
invece che una conseguenza ovvia del no-auth.

**Causa, confermata nel codice e ora anche misurata dal vivo** (`curl -sk .../api/auth/whoami`
su un'istanza senza utenti definiti risponde `{"username":"admin","role":"Admin",...}` — misurato
il 2026-09-12): `optional_auth` inietta un **Admin sintetico** quando il progetto non ha utenti
(`sws-web/src/router.rs:758`), quindi il viewer *è* sempre Admin e
`isRoleAllowed("Admin","Admin")` è vero per costruzione (`SvgCanvas.tsx:444`, ranghi Viewer 0 →
Admin 3). Il gating client-side esiste e funziona (`SvgCanvas.tsx:1502`: `hide` rimuove
l'oggetto, `disable` lo lascia visibile con `pointerEvents: none`) — semplicemente non ha mai
nessuno a cui negare qualcosa, in quello scenario.

Le due parti già chiuse (non da rifare):
- **(a) misura**: fatta, sopra.
- **(c) dichiarare il limite**: fatto — scheda **Q36**, commento «gap dichiarato» accanto a
  `min_role` in `model.rs`, `project.rs:79` dice che l'enforcement vero è `TagDef.write_min_role`
  lato server.

**Resta solo (b)**: l'avviso nell'editor. Questo piano è solo per quello.

## Disegno

Il segnale "siamo in no-auth" è già disponibile in memoria, senza una fetch nuova:
`useAppStore((s) => s.authRole)` vale `"no-auth"` dopo il probe che `App.tsx` fa già
all'avvio (lo stesso `whoami()` copiato in `useAccessoSenzaUtenti.ts` per le finestre staccate).

- In `EditorShell.tsx`, dove si sceglie `min_role` (~riga 4895-4906, accanto al select del ruolo
  minimo e a `min_role_effect`): se `authRole === "no-auth"` **e** `obj.min_role` è impostato,
  mostrare una riga di avviso breve sotto il campo — sullo stile delle note già presenti nel
  pannello (`<p style={{ fontSize: 10, color: "var(--brand-text-subtle, ...)" }}>`).
- Testo (nuove chiavi i18n `props.minRoleNoAuthWarning` in `it.json`/`en.json`, verificate dal
  test di parità): qualcosa come *"Senza utenti definiti nel progetto, ogni visitatore è Admin:
  il ruolo minimo non avrà effetto. Vedi Configurazione → Utenti."* — non un errore bloccante,
  solo perché non sembri un difetto del gating.
- Non serve toccare `router.rs`/`SvgCanvas.tsx`: il gating stesso è corretto e resta com'è.

## File coinvolti

- `sws-editor/src/editor/EditorShell.tsx` (~4895-4906, select `min_role`)
- `sws-editor/src/i18n/it.json`, `en.json` (nuova chiave)

## Verifica

1. `pnpm build` + `tsc` verdi; test di parità i18n verde.
2. A mano: su un'istanza senza utenti, impostare `min_role: Admin` su un oggetto → l'avviso
   compare. Creare un utente non-Admin (o comunque popolare la lista utenti) → l'avviso sparisce
   (se si riesce a far risolvere `authRole` in modo diverso da "no-auth" in editor senza login
   reale, altrimenti verificare almeno che la condizione sia scritta correttamente leggendo il
   codice — il caso "utenti presenti" è meno comodo da riprodurre in editor locale).
3. Nessuna modifica al gating stesso: verificare che un oggetto con `min_role` continui a
   comportarsi come prima (hide/disable) quando l'avviso è visibile.

Branch: `fix/ruolo-minimo-avviso-noauth`.
