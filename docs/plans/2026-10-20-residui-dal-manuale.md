# Residui trovati rifacendo il manuale — seme

> Nato il 20-10-2026, durante il ramo 2 del [piano del manuale](2026-10-19-manuale-rifatto.md): rileggendo i capitoli
> contro il codice sono emerse cose **del codice**, che in un ramo di documentazione non si toccano. Il manuale
> descrive il codice com'è; qui c'è quello che forse va cambiato.
>
> **Quando questo lavoro comincia, il primo passo è una sessione di plan approfondita** per decidere ogni punto:
> due sono decisioni del maintainer, gli altri piccole correzioni da raggruppare in un ramo solo.

## Da decidere

1. **Il pull git basta un Operator.** `POST /api/project/deploy` (`git pull --ff-only` e ricarica del progetto) sta
   nel gruppo `require_operator` (`sws-web/src/router.rs:627`), mentre Rollback, prova e fork vogliono l'Admin
   (`router.rs:440-448`, gruppo `require_admin`). Il pull cambia il progetto quanto un rollback. Svista o scelta?
   Il capitolo 12 lo descrive com'è.
2. **La ritenzione dei datastore non è automatica.** `retention_rows` e `retention_days` si applicano solo con
   `POST /api/datastores/:id/purge` (Admin); non c'è una pulizia programmata (`sws-core/src/project.rs`,
   `DatastoreConfig`; `sws-historian/src/backend.rs`). Un `retention_days: 365` scritto nel progetto, da solo, non
   cancella niente. Renderla automatica (quando, con quale finestra, sul pannello e nel cloud) è una decisione.

## Da correggere

3. **`SWS_IP_ALLOWLIST` e `X-Forwarded-For`.** L'allowlist vale solo per il login, e se manca l'indirizzo della
   connessione ripiega su `X-Forwarded-For`, che chiunque può scrivere (`router.rs:2475-2490`). Da verificare se il
   caso «manca l'indirizzo» capita davvero; se sì, non fidarsi dell'intestazione (vedi anche il seme
   [indirizzo vero dietro Traefik](2026-10-18-indirizzo-vero-dietro-traefik.md)).
4. **Testi rimasti indietro nel codice**:
   - `sws-runtime/crates/sws-runtime/src/main.rs:533-536`: il commento parla di «no-auth mode, all routes are open»,
     che non esiste dall'11-10-2026;
   - `sws-core/src/project.rs:949`: il commento di `security_policy` dice «only "None" is wired end-to-end», ma le
     sei policy sono collegate (`parse_security_policy`, `sws-plugin-opcua/src/lib.rs`);
   - `cfgUi.noCertificatesInTheTrust` (card OPC UA, `it.json`/`en.json`) consiglia di «abilitare temporaneamente
     "Accetta qualsiasi"» per la prima connessione: con la fiducia al primo contatto non serve, e il consiglio va
     nella direzione sbagliata;
   - `sws-editor/src/types/index.ts`, `critical`: «saltato in no-auth mode».
