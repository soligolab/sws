/** L'albero della Configurazione: la vista ⚙ del pannello sinistro.
 *
 *  ## Perché esiste
 *
 *  Fino al 24-09-2026 la Configurazione era una barra di sedici schede in cima
 *  a un'area a sé, e il pannello sinistro in Configurazione non c'era. L'idea
 *  del maintainer (seme del 22-09, piano
 *  `docs/archive/2026-09-24-configurazione-ad-albero-piano.md`): un albero sempre
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
import { RAMI, SCHEDE, SOTTORAMI, schedeVisibili, type IdScheda, type RamoConfig, type SchedaConfig, type SottoRamo } from "@/config/schede";
import { useRepoDisponibile } from "@/config/repoDisponibile";
import { AlberoTagLive } from "./AlberoTagLive";
import { IntestazioneSezione, SPAZIO, TESTO, guideAlbero, useSezioneAperta } from "./stilePannelli";

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

/** Lo slot della freccia: la stessa larghezza che usano l'albero delle pagine
 *  e quello degli oggetti, così i tre alberi del pannello si leggono come uno
 *  solo. */
const LARGHEZZA_FRECCIA = 14;
/** La colonna su cui corrono le guide: quella della freccia, così la linea
 *  esce da sotto la freccia del genitore e arriva ai suoi figli. */
/** Le guide corrono al centro dello slot della freccia del figlio, e il
 *  trattino entra fino al bordo sinistro della sua icona: la L che il
 *  maintainer ha chiesto. `xIcona` è dove comincia l'icona della riga. */
const COLONNA_RAMO = SPAZIO.l + SPAZIO.m - LARGHEZZA_FRECCIA + Math.round(LARGHEZZA_FRECCIA / 2);
const gancio = (xIcona: number, ultimo: boolean, x = COLONNA_RAMO) =>
  ({ x, finoA: xIcona - 2, ultimo });

const stileFreccia: React.CSSProperties = {
  flexShrink: 0, width: LARGHEZZA_FRECCIA, border: "none", background: "transparent",
  cursor: "pointer", fontSize: 9, color: "var(--brand-text-subtle, #64748b)", padding: 0,
};

/** Altezza fissa: alcune emoji hanno un'altezza di riga diversa dal testo e
 *  sfalsavano la riga di qualche pixel. */
const stileIcona: React.CSSProperties = {
  width: 16, height: 16, lineHeight: "16px", fontSize: 12,
  flexShrink: 0, textAlign: "center", overflow: "hidden",
};

function Foglia({ scheda, elementi, modificata, dentroSottoRamo = false, ultimo = false, navigabile = true }: {
  scheda: SchedaConfig; elementi: VoceElencoConfig[] | null; modificata: boolean;
  /** Una foglia dentro un sotto-ramo sta un gradino più a destra, e con lei i
   *  suoi elementi. */
  dentroSottoRamo?: boolean;
  /** L'ultima voce del suo elenco: la verticale si ferma a metà e chiude
   *  l'angolo invece di proseguire nel vuoto. */
  ultimo?: boolean;
  /** Chi non può configurare vede la foglia «Variabili» — le servono i valori
   *  live che ci stanno sotto — ma il clic non apre la scheda di modifica. */
  navigabile?: boolean;
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
  // Le variabili non hanno un elenco di elementi come le altre: hanno sotto
  // **sé stesse, live** (25-09-2026). Sono centinaia, quindi nascono chiuse.
  const tagLive = id === "tags";
  // Un elemento scelto (da un link, o dalla scheda stessa) apre il suo ramo.
  const mostraFigli = tagLive ? aperta : elementi !== null && (aperta || (suQuesta && configFocus !== null));
  const gradino = dentroSottoRamo ? SPAZIO.l : 0;

  return (
    <>
      {/* La freccia a sinistra, come a ogni altro livello dell'albero
          (richiesta del maintainer, 25-09-2026: qui era l'unica a destra).
          Lo slot si disegna anche quando non c'è nulla da aprire, o le
          etichette delle foglie con e senza figli non sarebbero allineate. */}
      <div style={{
        display: "flex", alignItems: "center",
        paddingLeft: SPAZIO.l + SPAZIO.m + gradino - LARGHEZZA_FRECCIA,
        ...guideAlbero([], gancio(SPAZIO.l + SPAZIO.m + gradino, ultimo)),
      }}>
        {tagLive || (elementi !== null && elementi.length > 0) ? (
          <button
            type="button"
            data-testid={`expand-config-${id}`}
            aria-expanded={mostraFigli}
            title={t(mostraFigli ? "editor.treeHide" : "editor.treeShow")}
            onClick={commuta}
            style={stileFreccia}
          >
            {mostraFigli ? "▼" : "▶"}
          </button>
        ) : (
          <span style={{ width: LARGHEZZA_FRECCIA, flexShrink: 0 }} />
        )}
        <button
          type="button"
          data-testid={`foglia-config-${id}`}
          aria-current={suQuesta && configFocus === null ? "page" : undefined}
          onClick={navigabile ? () => navigateToConfig(id) : commuta}
          style={stileRiga(suQuesta && configFocus === null, 0)}
        >
          <span aria-hidden="true" style={stileIcona}>{scheda.icona}</span>
          <span style={stileEtichetta}>{t(`config.tabs.${id}`)}</span>
          {modificata && <Pallino testid={`dirty-config-${id}`} />}
          {elementi !== null && (
            <span style={{ fontSize: TESTO.nota, color: "var(--brand-text-subtle, #64748b)", fontWeight: 400 }}>
              {elementi.length}
            </span>
          )}
        </button>
      </div>
      {mostraFigli && tagLive && <AlberoTagLive rientro={SPAZIO.l + SPAZIO.m + gradino + LARGHEZZA_FRECCIA} puoAprire={navigabile} />}
      {mostraFigli && !tagLive && elementi !== null && elementi.map((v, i) => {
        const scelta = suQuesta && configFocus === v.id;
        return (
          <button
            key={v.id}
            type="button"
            data-testid={`elemento-config-${id}-${v.id}`}
            aria-current={scelta ? "page" : undefined}
            onClick={() => navigateToConfig(id, v.id)}
            title={v.etichetta}
            style={{
              ...stileRiga(scelta, SPAZIO.l * 2 + SPAZIO.m + 4 + gradino),
              // Un elemento è figlio della sua foglia: la verticale del ramo
              // resta piena, la L parte dalla foglia.
              ...guideAlbero([COLONNA_RAMO], {
                x: SPAZIO.l + SPAZIO.m + gradino - Math.round(LARGHEZZA_FRECCIA / 2),
                finoA: SPAZIO.l * 2 + SPAZIO.m + 4 + gradino - 2,
                ultimo: i === elementi.length - 1,
              }),
            }}
          >
            <span style={stileEtichetta}>{v.etichetta}</span>
            {v.modificato && <Pallino testid={`dirty-config-${id}-${v.id}`} />}
          </button>
        );
      })}
    </>
  );
}

type FogliaCalcolata = {
  s: SchedaConfig; elementi: VoceElencoConfig[] | null; modificata: boolean;
};

/** Un raggruppamento dentro un ramo (25-09-2026): si apre e si chiude come il
 *  ramo, ma disegna una riga come le foglie — perché sta al loro livello, non
 *  a quello dei titoli. */
function SottoRamoNodo({ id, icona, foglie }: {
  id: SottoRamo; icona: string; foglie: FogliaCalcolata[];
}) {
  const { t } = useTranslation();
  // Aperto la prima volta: sotto ci sono le cose che si guardano ogni giorno.
  const [aperto, commuta] = useSezioneAperta(`config.sottoramo.${id}`, true);
  if (!foglie.length) return null;

  return (
    <>
      {/* Stessa struttura delle foglie: la freccia sta **fuori** dal bottone,
          nello slot a sinistra. Così un sotto-ramo e una foglia diretta —
          che sono allo stesso livello — hanno la freccia sulla stessa
          colonna, e le foglie del sotto-ramo un gradino più a destra. */}
      <div style={{
        display: "flex", alignItems: "center",
        paddingLeft: SPAZIO.l + SPAZIO.m - LARGHEZZA_FRECCIA,
        ...guideAlbero([], gancio(SPAZIO.l + SPAZIO.m, false)),
      }}>
        <button
          type="button"
          data-testid={`sottoramo-config-${id}`}
          aria-expanded={aperto}
          onClick={commuta}
          style={stileFreccia}
        >
          {aperto ? "▼" : "▶"}
        </button>
        <button type="button" onClick={commuta} style={stileRiga(false, 0)}>
          <span aria-hidden="true" style={stileIcona}>{icona}</span>
          <span style={{ ...stileEtichetta, fontWeight: 600 }}>{t(`config.sottorami.${id}`)}</span>
          {foglie.some((f) => f.modificata) && <Pallino testid={`dirty-sottoramo-${id}`} />}
        </button>
      </div>
      {aperto && foglie.map(({ s, elementi, modificata }, i) => (
        <Foglia key={s.id} scheda={s} elementi={elementi} modificata={modificata} dentroSottoRamo
          ultimo={i === foglie.length - 1} />
      ))}
    </>
  );
}

function Ramo({ ramo, icona, elementiDi, repo }: {
  ramo: RamoConfig; icona: string; elementiDi: (id: IdScheda) => VoceElencoConfig[];
  /** Q51: senza checkout del repo le schede di sviluppo non esistono, e il
   *  loro sotto-ramo resta vuoto — quindi non si disegna. */
  repo: boolean;
}) {
  const { t } = useTranslation();
  const isAdmin = useAppStore((s) => s.authRole === "Admin");
  // Tutti aperti la prima volta: l'albero serve a vedere tutto d'un colpo.
  const [aperto, commuta] = useSezioneAperta(`config.${ramo}`, true);

  const modificataFn = useSchedaModificata();
  const foglie: FogliaCalcolata[] = schedeVisibili(isAdmin, repo).filter((s) => s.ramo === ramo).map((s) => {
    const elementi = "elementi" in s && s.elementi ? elementiDi(s.id) : null;
    return { s, elementi, modificata: modificataFn(s, elementi) };
  });
  if (!foglie.length) return null;

  // Prima i sotto-rami, poi le foglie dirette: l'ordine è quello di
  // `SOTTORAMI`, non quello in cui le schede stanno nel registro.
  const sottorami = SOTTORAMI.filter((sr) => sr.ramo === ramo).map((sr) => ({
    ...sr, foglie: foglie.filter((f) => f.s.sottoRamo === sr.id),
  }));
  const dirette = foglie.filter((f) => f.s.sottoRamo === undefined);

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
      {aperto && sottorami.map((sr) => (
        <SottoRamoNodo key={sr.id} id={sr.id} icona={sr.icona} foglie={sr.foglie} />
      ))}
      {aperto && dirette.map(({ s, elementi, modificata }, i) => (
        <Foglia key={s.id} scheda={s} elementi={elementi} modificata={modificata}
          ultimo={i === dirette.length - 1} />
      ))}
    </div>
  );
}

/** I rami di configurazione. Stanno in fondo all'albero unico del pannello
 *  sinistro (`LeftPanel`), che scorre per intero. */
export function AlberoConfigurazione({ soloVariabili = false }: {
  /** Chi non può configurare non vede la Configurazione, ma **le variabili
   *  live sì**: erano l'unica cosa che aveva nel pannello prima del
   *  25-09-2026, e spostandole sotto una foglia di configurazione le avrebbe
   *  perse. Vede quella foglia sola, e il clic apre i valori invece della
   *  scheda di modifica. */
  soloVariabili?: boolean;
}) {
  const isAdmin = useAppStore((s) => s.authRole === "Admin");
  const elementiDi = useElementi(isAdmin);
  const repo = useRepoDisponibile();
  if (soloVariabili) {
    const tags = SCHEDE.find((s) => s.id === "tags");
    if (!tags) return null;
    return (
      <div style={{ padding: `0 ${SPAZIO.m}px` }}>
        <Foglia scheda={tags} elementi={null} modificata={false} ultimo navigabile={false} />
      </div>
    );
  }
  return (
    <>
      {RAMI.map((r) => <Ramo key={r.id} ramo={r.id} icona={r.icona} elementiDi={elementiDi} repo={repo} />)}
    </>
  );
}
