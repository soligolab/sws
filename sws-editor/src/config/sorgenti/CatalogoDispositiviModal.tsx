/** «Dal catalogo…»: un dispositivo completo, preconfigurato, dentro un bus
 *  Modbus (04-10-2026, piano `docs/plans/2026-10-04-catalogo-dispositivi.md`).
 *
 *  Due passi: si sceglie il modello (con la sua icona), poi unit id, nome della
 *  variabile e gruppi di registri da leggere. La conferma passa al chiamante
 *  il risultato di `daCatalogo`: tipo, variabile e dispositivo. */
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/api/client";
import type { ElencoCatalogo, VoceCatalogo, VoceCatalogoElenco } from "@/types";
import { S } from "@/config/comuni";
import { useAppStore } from "@/store";
import { motivoNomeIstanza } from "@/tag/istanze";
import { type BusModbus, dispositiviDi, prossimoUnitId } from "@/config/sorgenti/modbusDispositivi";
import { type DaCatalogo, daCatalogo, gruppiDi, nomeProposto, urlImmagine } from "@/config/sorgenti/daCatalogo";

const ETICHETTA = { fontSize: 11, color: "var(--brand-text-subtle, #64748b)", display: "block", marginBottom: 3 } as const;

/** L'elenco del catalogo, chiesto una volta per sessione dell'IDE: serve alle
 *  icone dei dispositivi già nel bus. Il modale invece lo richiede ogni volta,
 *  perché un file corretto si veda subito. */
let elencoInCache: Promise<ElencoCatalogo> | null = null;
export function useElencoCatalogo(): ElencoCatalogo | null {
  const [e, setE] = useState<ElencoCatalogo | null>(null);
  useEffect(() => {
    elencoInCache ??= api.catalogoDispositivi().catch(() => ({ voci: [] }));
    let vivo = true;
    void elencoInCache.then((x) => { if (vivo) setE(x); });
    return () => { vivo = false; };
  }, []);
  return e;
}

/** La voce dell'elenco da cui viene un dispositivo (`modello: "pixsys/atr244@1"`). */
export function voceDelModello(elenco: ElencoCatalogo | null, modello: string | undefined): VoceCatalogoElenco | undefined {
  if (!modello || !elenco) return undefined;
  const id = modello.split("@")[0];
  return elenco.voci.find((v) => v.id === id);
}

/** L'icona di una voce, o un riquadro vuoto se non ce l'ha o non si carica. */
export function IconaCatalogo({ voce, lato = 48 }: { voce: { id: string; immagine?: string }; lato?: number }) {
  const [rotta, setRotta] = useState(false);
  const url = urlImmagine(voce);
  const box = { width: lato, height: lato, borderRadius: 6, flexShrink: 0, background: "#fff" } as const;
  if (!url || rotta) {
    return <span aria-hidden="true" style={{ ...box, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: lato / 2.4, background: "var(--brand-bg, #0f172a)" }}>🔌</span>;
  }
  return <img src={url} alt="" style={{ ...box, objectFit: "contain" }} onError={() => setRotta(true)} />;
}

export function CatalogoDispositiviModal({ bus, onConferma, onClose }: {
  bus: BusModbus;
  onConferma: (r: DaCatalogo) => Promise<void>;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const lingua: "it" | "en" = i18n.language?.startsWith("en") ? "en" : "it";
  const project = useAppStore((s) => s.project);
  const idTag = useMemo(() => (project?.tags ?? []).map((x) => x.id), [project?.tags]);

  const [elenco, setElenco] = useState<ElencoCatalogo | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [cerca, setCerca] = useState("");
  const [voce, setVoce] = useState<VoceCatalogo | null>(null);
  const [unit, setUnit] = useState(prossimoUnitId(bus));
  const [nome, setNome] = useState("");
  const [gruppi, setGruppi] = useState<Set<string>>(new Set());
  const [lavoro, setLavoro] = useState(false);

  useEffect(() => {
    api.catalogoDispositivi().then(setElenco).catch((e) => setErrore(e instanceof Error ? e.message : String(e)));
  }, []);

  const scegli = async (v: VoceCatalogoElenco) => {
    setErrore(null);
    try {
      const piena = await api.voceCatalogo(v.id);
      setVoce(piena);
      setNome(nomeProposto(v.id, unit, idTag));
      setGruppi(new Set(gruppiDi(piena).filter((g) => g.predefinito).map((g) => g.nome)));
    } catch (e) {
      setErrore(e instanceof Error ? e.message : String(e));
    }
  };

  const filtro = cerca.trim().toLowerCase();
  const voci = (elenco?.voci ?? []).filter((v) =>
    !filtro || [v.modello, v.marca, v.famiglia ?? "", v.descrizione?.[lingua] ?? ""].some((x) => x.toLowerCase().includes(filtro)));
  const perFamiglia = new Map<string, VoceCatalogoElenco[]>();
  for (const v of voci) {
    const k = `${v.marca} — ${v.famiglia ?? ""}`;
    perFamiglia.set(k, [...(perFamiglia.get(k) ?? []), v]);
  }

  const unitOccupato = dispositiviDi(bus).some((d) => d.unit_id === unit);
  const motivoNome = motivoNomeIstanza(nome, idTag);
  const risultato = voce && !unitOccupato && !motivoNome
    ? daCatalogo(voce, bus, { unit, nome: nome.trim(), gruppi, lingua }, project?.types ?? [])
    : null;

  const conferma = async () => {
    if (!risultato) return;
    setLavoro(true);
    setErrore(null);
    try {
      await onConferma(risultato);
      onClose();
    } catch (e) {
      setErrore(e instanceof Error ? e.message : String(e));
    } finally {
      setLavoro(false);
    }
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10000 }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}>
      <div data-testid="catalogo-modal" style={{ background: "var(--brand-surface, #1e293b)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 8, padding: 20, width: "min(760px, 94vw)", maxHeight: "86vh", overflow: "auto" }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--brand-text, #e2e8f0)", marginBottom: 4 }}>
          {t("catalogo.titolo", { bus: bus.id })}
        </div>
        <div style={{ fontSize: 11, color: "var(--brand-text-muted, #94a3b8)", marginBottom: 14 }}>{t("catalogo.intro")}</div>

        {!voce && (
          <>
            <input style={{ ...S.input, marginBottom: 12 }} placeholder={t("catalogo.cerca")} value={cerca} autoFocus
              onChange={(e) => setCerca(e.target.value)} data-testid="catalogo-cerca" />
            {elenco === null && !errore && <div style={{ fontSize: 12, color: "var(--brand-text-subtle, #94a3b8)" }}>{t("catalogo.carico")}</div>}
            {elenco !== null && voci.length === 0 && <div style={{ fontSize: 12, color: "var(--brand-text-subtle, #94a3b8)" }}>{t("catalogo.vuoto")}</div>}
            {[...perFamiglia.entries()].map(([famiglia, vv]) => (
              <div key={famiglia} style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "var(--brand-text-subtle, #64748b)", letterSpacing: 0.5, marginBottom: 6 }}>{famiglia}</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 8 }}>
                  {vv.map((v) => (
                    <button key={v.id} type="button" data-testid={`catalog-item-${v.id}`} onClick={() => void scegli(v)}
                      style={{ display: "flex", gap: 10, alignItems: "center", textAlign: "left", padding: 8, cursor: "pointer",
                               background: "var(--brand-bg, #0f172a)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 6, color: "inherit" }}>
                      <IconaCatalogo voce={v} />
                      <span style={{ minWidth: 0 }}>
                        <span style={{ display: "block", fontWeight: 600, color: "var(--brand-text, #e2e8f0)" }}>
                          {v.modello}
                          {v.origine === "utente" && <span style={{ marginLeft: 6, fontSize: 10, color: "var(--brand-warning, #f59e0b)" }}>{t("catalogo.utente")}</span>}
                        </span>
                        <span style={{ display: "block", fontSize: 11, color: "var(--brand-text-subtle, #94a3b8)" }}>{v.descrizione?.[lingua]}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
            {(elenco?.errori ?? []).length > 0 && (
              <div style={{ marginTop: 10, fontSize: 11, color: "var(--brand-danger-soft, #f87171)" }}>
                {t("catalogo.fileRotti")}
                {elenco!.errori!.map((e) => <div key={e.file}>• {e.file}: {e.errore}</div>)}
              </div>
            )}
          </>
        )}

        {voce && (
          <>
            <div style={{ display: "flex", gap: 14, alignItems: "center", marginBottom: 14 }}>
              <IconaCatalogo voce={voce} lato={72} />
              <div>
                <div style={{ fontWeight: 700, fontSize: 15, color: "var(--brand-text, #e2e8f0)" }}>{voce.marca} {voce.modello}</div>
                <div style={{ fontSize: 12, color: "var(--brand-text-subtle, #94a3b8)" }}>{voce.descrizione?.[lingua]}</div>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "110px 1fr", gap: 12, marginBottom: 12 }}>
              <div>
                <label style={ETICHETTA}>{t("cfg.unitId")}</label>
                <input style={{ ...S.input, ...(unitOccupato ? { borderColor: "var(--brand-danger, #ef4444)" } : {}) }} type="number" min={1} max={247}
                  value={unit} onChange={(e) => setUnit(Number(e.target.value))} data-testid="catalogo-unit" />
              </div>
              <div>
                <label style={ETICHETTA}>{t("catalogo.nomeVariabile")}</label>
                <input style={{ ...S.input, ...(motivoNome ? { borderColor: "var(--brand-danger, #ef4444)" } : {}) }} value={nome} spellCheck={false}
                  onChange={(e) => setNome(e.target.value)} data-testid="catalogo-nome" />
              </div>
            </div>
            {unitOccupato && <div style={{ fontSize: 11, color: "var(--brand-danger-soft, #f87171)", marginBottom: 8 }}>{t("catalogo.unitOccupato", { unit })}</div>}
            {motivoNome && <div style={{ fontSize: 11, color: "var(--brand-danger-soft, #f87171)", marginBottom: 8 }}>{t(motivoNome)}</div>}

            <label style={ETICHETTA}>{t("catalogo.gruppi")}</label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginBottom: 12 }}>
              {gruppiDi(voce).map((g) => (
                <label key={g.nome} style={{ fontSize: 12, display: "flex", gap: 6, alignItems: "center", cursor: "pointer" }}>
                  <input type="checkbox" checked={gruppi.has(g.nome)} data-testid={`catalogo-gruppo-${g.nome}`}
                    onChange={(e) => {
                      const n = new Set(gruppi);
                      if (e.target.checked) n.add(g.nome); else n.delete(g.nome);
                      setGruppi(n);
                    }} />
                  {t(`catalogo.gruppo.${g.nome}`, { defaultValue: g.nome })} ({g.n})
                </label>
              ))}
            </div>

            {risultato && (
              <div style={{ fontSize: 11, color: "var(--brand-text-subtle, #94a3b8)", marginBottom: 12 }} data-testid="catalogo-anteprima">
                {t("catalogo.anteprima", { tipo: risultato.tipo.id, nome: risultato.tag.id, n: risultato.dispositivo.registers.length, membri: risultato.tipo.members.length })}
                {risultato.riusaTipo && <> {t("catalogo.tipoRiusato")}</>}
              </div>
            )}
            {risultato?.avvisi.map((a) => (
              <div key={a.chiave} style={{ fontSize: 11, color: "var(--brand-warning, #f59e0b)", marginBottom: 4 }}>⚠ {t(a.chiave, a.valori)}</div>
            ))}
          </>
        )}

        {errore && <div style={{ fontSize: 12, color: "var(--brand-danger-soft, #f87171)", marginTop: 8 }}>{errore}</div>}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
          {voce && <button style={S.btn("ghost")} onClick={() => setVoce(null)}>{t("catalogo.indietro")}</button>}
          <button style={S.btn("ghost")} onClick={onClose}>{t("common.cancel")}</button>
          {voce && (
            <button style={S.btn("primary")} disabled={!risultato || lavoro} onClick={() => void conferma()} data-testid="catalogo-aggiungi">
              {t("catalogo.aggiungi")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
