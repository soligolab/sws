/** Le variabili del progetto coi loro valori **live**, come albero.
 *
 *  ## Dove vive
 *
 *  Dal 25-09-2026 sotto la foglia `Progetto › Variabili` dell'albero di
 *  configurazione: cliccando la foglia si aprono le variabili da modificare,
 *  e subito sotto si vedono le stesse **mentre si muovono** (richiesta del
 *  maintainer). Prima era un ramo di primo livello a sé, «TAG».
 *
 *  ## Le tre cose che fa e prima non faceva
 *
 *  1. **Le istanze si espandono.** Di `motore1`, che è un `Motore`, prima non
 *     si vedeva nessun valore: la radice non ne ha uno, ce l'hanno le foglie
 *     (`motore1.velocita`). Ora l'istanza è un nodo che si apre.
 *  2. **Si raggruppa**, e il criterio si sceglie: per tipo di dato, per tipo
 *     struttura, per sorgente. La scelta si ricorda.
 *  3. **Gli usi sono raggruppati** per categoria — vedi `RigaTagLive`.
 */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { buildTagUsage, type TagUse } from "@/search/tagUsage";
import { useAppStore } from "@/store";
import { categoriaDi } from "@/tag/tipiScalari";
import { foglieDiTolleranti } from "@/tag/forma";
import { tagCatalog } from "@/tagCatalog";
import type { TagDef } from "@/types";
import { RigaTagLive } from "./RigaTagLive";
import { PREFISSO_MEMORIA, TESTO, guideAlbero } from "./stilePannelli";

/** Come si raggruppano le variabili nell'elenco. */
export type Raggruppa = "nessuno" | "dato" | "tipo" | "sorgente";
const CRITERI: readonly Raggruppa[] = ["nessuno", "dato", "tipo", "sorgente"];

const MEMORIA = PREFISSO_MEMORIA + "albero.tagRaggruppa";

function ricordato(): Raggruppa {
  try {
    const v = localStorage.getItem(MEMORIA);
    return (CRITERI as readonly string[]).includes(v ?? "") ? (v as Raggruppa) : "nessuno";
  } catch { return "nessuno"; }
}

export function AlberoTagLive({ rientro = 20, puoAprire = true }: {
  rientro?: number;
  /** Chi non può configurare vede i valori ma non apre la scheda di
   *  modifica: per lui il clic non fa niente. */
  puoAprire?: boolean;
}) {
  const { t } = useTranslation();
  const project   = useAppStore((s) => s.project);
  const tagValues = useAppStore((s) => s.tagValues);
  const pages     = useAppStore((s) => s.pages);
  const faceplates = useAppStore((s) => s.faceplates);
  // Il clic porta al dettaglio nella scheda Variabili. Chi non può
  // configurare quella scheda non la apre: per lui la riga è in sola lettura.
  const navigateToConfig = useAppStore((s) => s.navigateToConfig);
  const apri = puoAprire ? (id: string) => navigateToConfig("tags", id) : undefined;

  const [aperto, setAperto] = useState<string | null>(null);
  const [criterio, setCriterio] = useState<Raggruppa>(ricordato);

  const tags = useMemo(() => project?.tags ?? [], [project?.tags]);
  const types = useMemo(() => project?.types ?? [], [project?.types]);

  const usage = useMemo(
    () => buildTagUsage({
      pages, faceplates, alarms: project?.alarms, tags,
      globalScripts: project?.global_scripts,
    }),
    [pages, faceplates, project?.alarms, project?.global_scripts, tags],
  );
  const usiDi = (id: string): TagUse[] => usage.get(id) ?? [];

  /** La sorgente di ogni id, dal catalogo: è l'unico posto che sa leggere le
   *  mappature di dieci protocolli diversi. */
  const sorgenteDi = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of tagCatalog(project)) if (e.source) m.set(e.id, e.source);
    return m;
  }, [project]);

  const gruppoDi = (tag: TagDef): string => {
    if (criterio === "dato") return categoriaDi(tag.data_type ?? "") ?? t("editor.raggruppaAltro");
    if (criterio === "tipo") return tag.type_ref ?? t("editor.raggruppaSemplici");
    if (criterio === "sorgente") return sorgenteDi.get(tag.id) ?? t("editor.raggruppaInterne");
    return "";
  };

  const gruppi = useMemo(() => {
    if (criterio === "nessuno") return [{ nome: "", tags }];
    const m = new Map<string, TagDef[]>();
    for (const tg of tags) {
      const g = gruppoDi(tg);
      m.set(g, [...(m.get(g) ?? []), tg]);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([nome, ts]) => ({ nome, tags: ts }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tags, criterio, sorgenteDi]);

  if (tags.length === 0) {
    return (
      <p style={{ padding: `4px 12px 4px ${rientro}px`, fontSize: 11, color: "var(--brand-text-subtle, #94a3b8)", margin: 0 }}>
        {t("leftPanel.noTagsLoadAProject")}
      </p>
    );
  }

  const riga = (tg: TagDef, ultimo: boolean, dentro: boolean) => {
    const foglie = foglieDiTolleranti(tg, types);
    const stile = {
      paddingLeft: rientro + (dentro ? 12 : 0),
      paddingRight: 6,
      ...guideAlbero(dentro ? [13] : [], { x: dentro ? 25 : 13, finoA: rientro + (dentro ? 12 : 0) - 2, ultimo }),
    };
    return (
      <RigaTagLive
        key={tg.id}
        tag={tg}
        valore={tagValues[tg.id]}
        usi={usiDi(tg.id)}
        aperta={aperto === tg.id}
        onToggle={() => setAperto(aperto === tg.id ? null : tg.id)}
        onApri={apri && (() => apri(tg.id))}
        stileRiga={stile}
        figli={foglie.length === 0 ? undefined : (
          <>
            {foglie.map((f, i) => (
              <RigaTagLive
                key={f.percorso}
                tag={{ id: f.percorso }}
                etichetta={f.percorso.slice(tg.id.length).replace(/^\./, "")}
                valore={tagValues[f.percorso]}
                usi={usiDi(f.percorso)}
                aperta={aperto === f.percorso}
                onToggle={() => setAperto(aperto === f.percorso ? null : f.percorso)}
                onApri={apri && (() => apri(f.percorso))}
                stileRiga={{
                  paddingLeft: rientro + 14 + (dentro ? 12 : 0),
                  paddingRight: 6,
                  ...guideAlbero(dentro ? [13, 25] : [13], {
                    x: (dentro ? 25 : 13) + 12,
                    finoA: rientro + 12 + (dentro ? 12 : 0),
                    ultimo: i === foglie.length - 1,
                  }),
                }}
              />
            ))}
          </>
        )}
      />
    );
  };

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 4, padding: `2px 6px 4px ${rientro}px` }}>
        <span style={{ fontSize: TESTO.nota, color: "var(--brand-text-subtle, #64748b)" }}>
          {t("editor.raggruppaPer")}
        </span>
        <select
          value={criterio}
          onChange={(e) => {
            const v = e.target.value as Raggruppa;
            setCriterio(v);
            try { localStorage.setItem(MEMORIA, v); } catch { /* storage negato */ }
          }}
          style={{
            flex: 1, minWidth: 0, fontSize: TESTO.nota, padding: "1px 2px",
            background: "var(--brand-bg, #020617)", color: "var(--brand-text-muted, #94a3b8)",
            border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 3,
          }}
        >
          {CRITERI.map((c) => (
            <option key={c} value={c}>{t(`editor.raggruppa.${c}`)}</option>
          ))}
        </select>
      </div>

      {gruppi.map((g, ig) => (
        <div key={g.nome || "tutti"}>
          {g.nome !== "" && (
            <div style={{
              fontSize: TESTO.nota, fontWeight: 600, color: "var(--brand-text-subtle, #94a3b8)",
              padding: `2px 6px 1px ${rientro}px`,
              ...guideAlbero([], { x: 13, finoA: rientro - 2, ultimo: ig === gruppi.length - 1 }),
            }}>
              {g.nome} ({g.tags.length})
            </div>
          )}
          {g.tags.map((tg, i) => riga(tg, i === g.tags.length - 1, g.nome !== ""))}
        </div>
      ))}
    </>
  );
}
