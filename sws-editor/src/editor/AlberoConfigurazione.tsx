/** L'albero della Configurazione: la vista ⚙ del pannello sinistro.
 *
 *  ## Perché esiste
 *
 *  Fino al 24-09-2026 la Configurazione era una barra di sedici schede in cima
 *  a un'area a sé, e il pannello sinistro in Configurazione non c'era. L'idea
 *  del maintainer (seme del 22-09, piano
 *  `docs/plans/2026-09-24-configurazione-ad-albero-piano.md`): un albero sempre
 *  a portata di mano, come negli SCADA che mettono il progetto in una colonna,
 *  per arrivare più in fretta a tutte le opzioni — anche mentre si disegna.
 *
 *  Rami e foglie vengono da `config/schede.ts`: questo è un modo di **leggere**
 *  il registro, non un quinto elenco da tenere allineato. Una foglia porta alla
 *  sua scheda, e se si è nell'editor porta anche in Configurazione.
 *
 *  ## Il secondo livello
 *
 *  Le schede con un elenco (sorgenti, script, faceplate, ricette, datastore,
 *  utenti) si aprono sui loro elementi. Gli elementi vengono **dalla bozza**
 *  della scheda (`elenchiConfig`, pubblicato da `config/fogliaConfig.ts`), così
 *  una sorgente aggiunta e non ancora salvata compare subito. Finché la scheda
 *  non è mai stata aperta, si leggono dal progetto; ricette e utenti non stanno
 *  nel progetto e si chiedono una volta al montaggio.
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/api/client";
import { useAppStore, type VoceElencoConfig } from "@/store";
import { RAMI, schedeVisibili, type IdScheda, type RamoConfig, type SchedaConfig } from "@/config/schede";
import { IntestazioneSezione, SPAZIO, TESTO, useSezioneAperta } from "./stilePannelli";

/** Gli elementi di ricette e utenti, che il progetto non porta: una richiesta
 *  al montaggio dell'albero, come fanno le loro schede. */
function useElementiDaApi(isAdmin: boolean) {
  const [ricette, setRicette] = useState<VoceElencoConfig[]>([]);
  const [utenti, setUtenti] = useState<VoceElencoConfig[]>([]);
  useEffect(() => {
    api.listRecipes()
      .then((l) => setRicette(l.map((r) => ({ id: r.id, etichetta: r.name || r.id }))))
      .catch(() => { /* nessun progetto aperto: nessuna foglia */ });
    if (isAdmin) {
      api.listUsers()
        .then((l) => setUtenti(l.map((u) => ({ id: u.username, etichetta: u.username }))))
        .catch(() => { /* senza utenti o senza permesso: nessuna foglia */ });
    }
  }, [isAdmin]);
  return { ricette, utenti };
}

/** Gli elementi di una scheda: la bozza pubblicata se c'è, altrimenti il
 *  progetto salvato. */
function useElementi(isAdmin: boolean): (id: IdScheda) => VoceElencoConfig[] {
  const pubblicati  = useAppStore((s) => s.elenchiConfig);
  const project     = useAppStore((s) => s.project);
  const faceplates  = useAppStore((s) => s.faceplates);
  const daApi = useElementiDaApi(isAdmin);
  return (id) => {
    const p = pubblicati[id];
    if (p) return p;
    switch (id) {
      case "protocols":  return (project?.sources ?? []).map((x) => ({ id: x.id, etichetta: x.id }));
      case "scripts":    return (project?.global_scripts ?? []).map((x) => ({ id: x.id, etichetta: x.id }));
      case "faceplates": return faceplates.map((f) => ({ id: f.id, etichetta: f.label || f.id }));
      case "datastores": return (project?.datastores ?? []).map((d) => ({ id: d.id, etichetta: d.label || d.id }));
      case "recipes":    return daApi.ricette;
      case "users":      return daApi.utenti;
      default:           return [];
    }
  };
}

/** Il pallino «modificato» (25-09-2026): stesso colore del «● non salvato»
 *  della testata, perché dice la stessa cosa — e dice **dove**. */
function Pallino({ testid }: { testid: string }) {
  const { t } = useTranslation();
  return (
    <span
      data-testid={testid}
      title={t("app.unsavedShort")}
      aria-label={t("app.unsavedShort")}
      style={{ flexShrink: 0, width: 6, height: 6, borderRadius: "50%", background: "var(--brand-warning, #f59e0b)" }}
    />
  );
}

/** Una scheda è «modificata» se la sua bozza è fra le sezioni pendenti del
 *  Salva unico, o se uno dei suoi elementi lo è. */
function useSchedaModificata(): (s: SchedaConfig, elementi: VoceElencoConfig[] | null) => boolean {
  const pendenti = useAppStore((s) => s.pendingSections);
  return (s, elementi) =>
    (s.sezione !== undefined && s.sezione in pendenti) || !!elementi?.some((v) => v.modificato);
}

const stileRiga = (scelta: boolean, rientro: number): React.CSSProperties => ({
  width: "100%", display: "flex", alignItems: "center", gap: SPAZIO.s,
  padding: `3px ${SPAZIO.m}px 3px ${rientro}px`,
  border: "none", borderRadius: 4, cursor: "pointer", textAlign: "left",
  fontSize: TESTO.riga,
  background: scelta ? "var(--brand-surface-2, #334155)" : "transparent",
  color: scelta ? "var(--brand-text, #e2e8f0)" : "var(--brand-text-muted, #94a3b8)",
  fontWeight: scelta ? 600 : 400,
});

const stileEtichetta: React.CSSProperties = {
  flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
};

function Foglia({ scheda, elementi, modificata }: {
  scheda: SchedaConfig; elementi: VoceElencoConfig[] | null; modificata: boolean;
}) {
  const { t } = useTranslation();
  const inConfig   = useAppStore((s) => s.appMode === "config");
  const configTab  = useAppStore((s) => s.configTab);
  const configFocus = useAppStore((s) => s.configFocus);
  const navigateToConfig = useAppStore((s) => s.navigateToConfig);
  const id = scheda.id as IdScheda;
  const suQuesta = inConfig && configTab === id;
  // Chiusa la prima volta: con dieci sorgenti e venti faceplate aperti insieme
  // l'albero smetterebbe di essere la mappa d'insieme che deve essere.
  const [aperta, commuta] = useSezioneAperta(`config.foglia.${id}`, false);
  // Un elemento scelto (da un link, o dalla scheda stessa) apre il suo ramo.
  const mostraFigli = elementi !== null && (aperta || (suQuesta && configFocus !== null));

  return (
    <>
      <div style={{ display: "flex", alignItems: "center" }}>
        <button
          type="button"
          data-testid={`foglia-config-${id}`}
          aria-current={suQuesta && configFocus === null ? "page" : undefined}
          onClick={() => navigateToConfig(id)}
          style={stileRiga(suQuesta && configFocus === null, SPAZIO.l + SPAZIO.m)}
        >
          {/* Altezza fissa: alcune emoji hanno un'altezza di riga diversa dal
              testo e sfalsavano la foglia di qualche pixel. */}
          <span aria-hidden="true" style={{ width: 16, height: 16, lineHeight: "16px", fontSize: 12, flexShrink: 0, textAlign: "center", overflow: "hidden" }}>{scheda.icona}</span>
          <span style={stileEtichetta}>{t(`config.tabs.${id}`)}</span>
          {modificata && <Pallino testid={`dirty-config-${id}`} />}
          {elementi !== null && (
            <span style={{ fontSize: TESTO.nota, color: "var(--brand-text-subtle, #64748b)", fontWeight: 400 }}>
              {elementi.length}
            </span>
          )}
        </button>
        {elementi !== null && elementi.length > 0 && (
          <button
            type="button"
            data-testid={`expand-config-${id}`}
            aria-expanded={mostraFigli}
            title={t(mostraFigli ? "editor.treeHide" : "editor.treeShow")}
            onClick={commuta}
            style={{
              flexShrink: 0, width: 18, border: "none", background: "transparent", cursor: "pointer",
              fontSize: 9, color: "var(--brand-text-subtle, #64748b)", padding: 0,
            }}
          >
            {mostraFigli ? "▼" : "▶"}
          </button>
        )}
      </div>
      {mostraFigli && elementi.map((v) => {
        const scelta = suQuesta && configFocus === v.id;
        return (
          <button
            key={v.id}
            type="button"
            data-testid={`elemento-config-${id}-${v.id}`}
            aria-current={scelta ? "page" : undefined}
            onClick={() => navigateToConfig(id, v.id)}
            title={v.etichetta}
            style={stileRiga(scelta, SPAZIO.l * 2 + SPAZIO.m + 4)}
          >
            <span style={stileEtichetta}>{v.etichetta}</span>
            {v.modificato && <Pallino testid={`dirty-config-${id}-${v.id}`} />}
          </button>
        );
      })}
    </>
  );
}

function Ramo({ ramo, icona, elementiDi }: {
  ramo: RamoConfig; icona: string; elementiDi: (id: IdScheda) => VoceElencoConfig[];
}) {
  const { t } = useTranslation();
  const isAdmin = useAppStore((s) => s.authRole === "Admin");
  // Tutti aperti la prima volta: l'albero serve a vedere tutto d'un colpo.
  const [aperto, commuta] = useSezioneAperta(`config.${ramo}`, true);

  const modificataFn = useSchedaModificata();
  const foglie = schedeVisibili(isAdmin).filter((s) => s.ramo === ramo).map((s) => {
    const elementi = "elementi" in s && s.elementi ? elementiDi(s.id) : null;
    return { s, elementi, modificata: modificataFn(s, elementi) };
  });
  if (!foglie.length) return null;

  return (
    <div style={{ padding: `0 ${SPAZIO.m}px` }}>
      <IntestazioneSezione
        titolo={t(`config.rami.${ramo}`)}
        icona={icona}
        aperta={aperto}
        onToggle={commuta}
        // Col ramo chiuso è l'unico segno che dentro c'è qualcosa da salvare.
        azione={foglie.some((f) => f.modificata) ? <Pallino testid={`dirty-ramo-${ramo}`} /> : undefined}
      />
      {aperto && foglie.map(({ s, elementi, modificata }) => (
        <Foglia key={s.id} scheda={s} elementi={elementi} modificata={modificata} />
      ))}
    </div>
  );
}

export function AlberoConfigurazione() {
  const isAdmin = useAppStore((s) => s.authRole === "Admin");
  const elementiDi = useElementi(isAdmin);
  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: `${SPAZIO.xs}px 0` }}>
      {RAMI.map((r) => <Ramo key={r.id} ramo={r.id} icona={r.icona} elementiDi={elementiDi} />)}
    </div>
  );
}
