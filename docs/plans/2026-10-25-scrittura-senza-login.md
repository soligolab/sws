# «Chiunque, anche senza login» — il permesso di comandare sta nel tag

## Context

Il maintainer (25-10-2026): in un sinottico, un pulsante che accende la luce della stanza non
deve chiedere il login, ma con «Ruolo minimo per operare: Nessun vincolo» il login viene chiesto
lo stesso.

Misurato nel codice:
- **Il ruolo minimo dell'oggetto vale solo nell'interfaccia** (`isRoleAllowed` in
  `sws-editor/src/canvas/SvgCanvas.tsx:534`): con «Nessun vincolo» il clic passa.
- **Il server lo blocca.** Ogni scrittura di tag chiede almeno Operator, in due punti:
  - la `PUT /api/tags/:id` sta in `operator_routes` con `require_operator`
    (`sws-web/src/router.rs`, `build_runtime_inner` ~1550; idem sul router admin ~602);
  - il WebSocket ha un `if role < Role::Operator` prima di tutto (`router.rs` ~8247).
- **Un anonimo sulla porta del viewer è Viewer**: `optional_auth` (~2429) inserisce un `AuthUser`
  Viewer, e `ruolo_adesso` (~8032) fa lo stesso sul WS.
- **Un difetto già vivo**: la scheda Tag offre «Ruolo minimo di scrittura: Viewer»
  (`TagsTab.tsx:668`, `TagDef.write_min_role`), e `tag_write_allowed` (`router.rs:244`) la saprebbe
  applicare. Però il blocco Operator scatta prima, quindi quella scelta oggi non ha effetto.

**Decisione del maintainer (25-10-2026): valgono tutti e due, tag e oggetto, e vince il più
severo.** Il maintainer vuole poter avere due pulsanti sullo stesso tag in due sinottici con
esigenze diverse.

| | Tag | Oggetto | Risultato |
|---|---|---|---|
| A (stanza) | Chiunque | Nessun vincolo | senza login |
| B (pagina tecnica) | Chiunque | Operator | login |
| qualunque | Operator (default) | Nessun vincolo | login (com'è oggi) |

- **Il tag è il vincolo che il server fa rispettare.** Vale per web, LVGL, script e API.
- **L'oggetto può solo restringere**, e lo fa nell'interfaccia, come `isRoleAllowed` oggi.
- **Da dire in chiaro nel pannello**: un tag aperto a «Chiunque» è comandabile da chiunque, da A o
  dall'API. La restrizione di B tiene lontano dal comando chi sta davanti a quella pagina, ma non
  rende privato il tag.

## Prima: chiudere la chiave IA (già fatta, non committata)

Nel working tree c'è `sws-web/src/gateway/progetti.rs`, già verificato: `cargo test` verde,
`pnpm build`, `check_static` 50/50.
- **Cosa fa**: il gateway monta `<radice>/.sws-config/<azienda>/<progetto>` (0700) su
  `/var/sws/config` del container del progetto. Così la chiave IA sopravvive alla riapertura.
  Scelta del maintainer: per progetto, fuori dal progetto.
- **Da fare**: CHANGELOG, NOVITA it/en e commit sul ramo.
- **Limite da scrivere in CHANGELOG**: rinominare o duplicare un progetto non porta con sé la sua
  cartella di configurazione.

## Il lavoro — nidificato sul ramo aperto `fix/esito-ricordato-dal-runtime`

### Server (`sws-runtime/crates/sws-web/src/router.rs`)
1. **La PUT esce da `operator_routes`** (viewer e admin) e va con le rotte a `optional_auth` /
   autenticate. `write_tag` (~3030) controlla già `tag_write_allowed` e scrive l'audit del rifiuto,
   quindi decide lui. Un tag senza `write_min_role` resta Operator (default invariato).
2. **WS**: via il blocco `role < Role::Operator`. Resta `tag_write_allowed`, con lo stesso default.
3. Nessun cambiamento al significato di `write_min_role`. «Viewer» = chiunque, anonimo compreso,
   perché l'anonimo è Viewer.
4. **Test**:
   - aggiornare la guardia delle rotte che oggi vuole `/api/tags/:id` sotto `require_operator`;
   - nuovo test: anonimo → tag `Viewer` scrive (200 / ack ok);
   - anonimo → tag senza soglia → 403 / ack «ruolo insufficiente»;
   - Viewer loggato → tag `Operator` → rifiuto.

### Interfaccia (`sws-editor`)
5. **Scheda Tag** (`TagsTab.tsx:668`): l'opzione `Viewer` si legge «Chiunque, anche senza login»,
   in i18n nelle cinque lingue; «Operator (default)» resta.
6. **Viewer: la regola più severa.** Oggi il clic passa se `isRoleAllowed(obj.min_role, ruolo)`,
   anche quando il tag richiede di più, e poi il server rifiuta.
   - **Cosa cambia**: vale la più severa fra `obj.min_role` e il `write_min_role` del tag scritto
     (default Operator). Sotto quel ruolo l'oggetto apre il login invece di mandare una scrittura
     destinata al rifiuto.
   - **Gemello LVGL**: `role_allowed` in `sws-lvgl-viewer/src/session.rs:55`.
   - **Test**: per le due funzioni, con la tabella del Context.
7. **Pannello proprietà dell'oggetto**, sezione Sicurezza (`EditorShell.tsx` ~5908): sotto il
   ruolo minimo compare una riga **in sola lettura** con cosa richiede il tag che l'oggetto scrive.
   - **Quali tag**: `obj.tag` o `obj.command_tag`, a seconda del tipo. Se serve, un piccolo helper
     `tagScrittiDa(obj)` accanto a `collectTagIds`.
   - **Il testo**, per esempio: «Per comandare serve il permesso del tag «luce_stanza»: Operator.
     Senza login non si comanda.», con il collegamento al tag in Configurazione → Tag.
   - **Una sezione per dato**: niente seconda select che scrive `write_min_role` dall'oggetto.
   - **Quando**: solo se il progetto ha utenti (`progettoHaUtenti`), altrimenti è già tutto Admin.
   - **Avviso**: con il tag a «Chiunque» e un ruolo sull'oggetto, una riga dice che la restrizione
     vale per questo pulsante, non per il tag.
8. **LVGL**: scrive con `put_tag` (HTTP PUT), quindi la correzione server basta. **Fatto il 25-10**:
   un comando rifiutato (401/403) apre il pannellino d'accesso dell'avviso (`chiedi_accesso_per_comando`,
   `AzioneRichiesta::Comando`), che non ripete il comando dopo l'accesso.

### Documenti
9. **Manuale e note**:
   - capitolo sicurezza/utenti del manuale: una riga sul permesso di scrittura del tag;
   - CHANGELOG (Fixed: «Viewer» di scrittura non aveva effetto);
   - NOVITA it/en.
10. **CasaDomotica**: un tag luce con «Chiunque, anche senza login» e due pulsanti sullo stesso tag (uno libero, uno da Operator),
   come richiede la regola del progetto di riferimento.

## Verifica

- `cargo check`, `cargo test`, `pnpm build`, `pnpm exec vitest run`, `./scripts/check_static.sh`
  verdi.
- **Dal vivo** (runtime locale di prova, dichiarato e poi fermato; poi TC620):
  - progetto con utenti, tag `luce` con «Chiunque»: dal viewer anonimo il pulsante A comanda
    senza login, il pulsante B (Operator) sullo stesso tag apre il login;
  - un tag senza soglia dallo stesso viewer: rifiutato, con il toast.
- **Immagini**: `<hash>-arm64` sul TC620 e `<hash>-amd64` sul VPS, solo tag del commit; in
  questa stessa build entra anche la chiave IA.
- Il maintainer conferma, poi squash di tutto il ramo su `main`, eliminazione del ramo, push quando
  lo chiede.
