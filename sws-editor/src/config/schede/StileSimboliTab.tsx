// Configurazione → Progetto → Stile: lo stile dei simboli del progetto (Fase 4
// del piano docs/archive/2026-10-14-motore-simboli-lib.md, decisioni 17, 18 e M5).
//
// Quattro gruppi — stati, materiali, resa, animazioni — e un'anteprima viva di
// alcuni simboli della libreria disegnati con la bozza, non con quanto salvato:
// si vede l'effetto prima di salvare. Un campo vuoto vale il predefinito; ogni
// oggetto può poi sovrascrivere quello che gli serve.

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/api/client";
import { useAppStore } from "@/store";
import { S, SaveBar } from "@/config/comuni";
import { regola } from "@/coloriPredefiniti";
import { svgLibCaricato, useManifestoLib } from "@/symbols/lib/libreria";
import { SimboloLibSvg } from "@/symbols/lib/SimboloLib";
import { CONTORNO_DISEGNO, type StileSimboliProgetto } from "@/symbols/stileProgetto";

type Campo = keyof StileSimboliProgetto;
const STATI: { campo: "state_off_color" | "state_on_color" | "state_alarm_color"; chiave: string }[] = [
  { campo: "state_off_color", chiave: "props.colorOff" },
  { campo: "state_on_color", chiave: "props.colorOn" },
  { campo: "state_alarm_color", chiave: "props.colorAlarm" },
];
/** I simboli dell'anteprima: corpo, livello, rotore, lancetta, spie. */
const ANTEPRIMA = ["lib:process/centrifugal-pump", "lib:process/vertical-tank", "lib:process/pressure-gauge", "lib:machines/stack-light"];

/** Toglie i campi vuoti: nel file restano solo le scelte vere. */
function pulito(s: StileSimboliProgetto): StileSimboliProgetto | null {
  const out: StileSimboliProgetto = {};
  for (const [k, v] of Object.entries(s) as [Campo, unknown][]) {
    if (v === undefined || v === "" || (typeof v === "number" && !Number.isFinite(v))) continue;
    if (k === "materials") {
      const m = Object.fromEntries(Object.entries(v as Record<string, string>).filter(([, c]) => !!c));
      if (Object.keys(m).length) out.materials = m;
      continue;
    }
    (out as Record<string, unknown>)[k] = v;
  }
  return Object.keys(out).length ? out : null;
}

export function StileSimboliTab() {
  const { t } = useTranslation();
  const salvato = useAppStore((s) => s.project?.symbol_style);
  const progetto = useAppStore((s) => s.project);
  const setProject = useAppStore((s) => s.setProject);
  const manifesto = useManifestoLib();
  const [bozza, setBozza] = useState<StileSimboliProgetto>(() => salvato ?? {});
  const [toccato, setToccato] = useState(false);
  useEffect(() => { if (!toccato) setBozza(salvato ?? {}); }, [salvato, toccato]);

  const metti = (p: Partial<StileSimboliProgetto>) => { setToccato(true); setBozza((b) => ({ ...b, ...p })); };
  const mettiMateriale = (m: string, c: string | undefined) =>
    metti({ materials: { ...(bozza.materials ?? {}), [m]: c ?? "" } });
  const numero = (v: string) => (v.trim() === "" ? undefined : Number(v));

  const salva = async () => {
    const corpo = pulito(bozza);
    await api.updateSymbolStyle(corpo);
    if (progetto) setProject({ ...progetto, symbol_style: corpo ?? undefined });
    setToccato(false);
  };

  // Anteprima: la bozza al posto dello stile salvato, solo per questi disegni.
  const anteprima = useMemo(() => pulito(bozza) ?? undefined, [bozza]);

  const materiali = Object.entries(manifesto?.materials ?? {});
  const colore = (valore: string | undefined, predef: string, onChange: (v: string | undefined) => void, id: string) => (
    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
      <input id={id} type="color" value={valore || predef} onChange={(e) => onChange(e.target.value)}
        style={{ ...S.input, width: 44, padding: 2, height: 28, flex: "none" }} />
      <span style={{ fontSize: 11, color: "var(--brand-text-muted, #94a3b8)", fontStyle: valore ? "normal" : "italic" }}>
        {valore ? valore : `${predef} · ${t("stileTab.predefinito")}`}
      </span>
      {valore && (
        <button type="button" style={S.btnXs} onClick={() => onChange(undefined)} title={t("stileTab.ripristina")}>↺</button>
      )}
    </div>
  );

  return (
    <div style={S.page}>
      <SaveBar onSave={salva} section="symbol_style" dirty={toccato} />
      <div style={{ fontSize: 12, color: "var(--brand-text-muted, #94a3b8)", marginBottom: 12, lineHeight: 1.5 }}>{t("stileTab.intro")}</div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 16, alignItems: "start" }}>
        <div>
          <div style={S.sectionTitle}>{t("stileTab.stati")}</div>
          {STATI.map(({ campo, chiave }) => {
            const r = regola("symbol", campo);
            return (
              <div key={campo} style={{ marginBottom: 6 }}>
                <label style={S.label} htmlFor={`stile-${campo}`}>{t(chiave)}</label>
                {colore(bozza[campo], r && "hex" in r ? r.hex : "#808080", (v) => metti({ [campo]: v }), `stile-${campo}`)}
              </div>
            );
          })}

          <div style={{ ...S.sectionTitle, marginTop: 14 }}>{t("stileTab.resa")}</div>
          <label style={S.label} htmlFor="stile-volume">{t("stileTab.volume")}: {bozza.volume ?? 100}%</label>
          <input id="stile-volume" type="range" min={0} max={100} value={bozza.volume ?? 100}
            onChange={(e) => metti({ volume: Number(e.target.value) })} style={{ width: "100%" }} />
          <div style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", marginBottom: 8 }}>{t("stileTab.volumeHint")}</div>
          <label style={S.label} htmlFor="stile-contorno">{t("stileTab.contorno")}</label>
          {colore(bozza.outline_color, CONTORNO_DISEGNO, (v) => metti({ outline_color: v }), "stile-contorno")}
          <label style={S.label} htmlFor="stile-spessore">{t("stileTab.spessore")}</label>
          <input id="stile-spessore" type="number" step={0.1} min={0} max={10} placeholder="1" style={S.input}
            value={bozza.outline_width ?? ""} onChange={(e) => metti({ outline_width: numero(e.target.value) })} />

          <div style={{ ...S.sectionTitle, marginTop: 14 }}>{t("stileTab.animazioni")}</div>
          <label style={S.label} htmlFor="stile-giro">{t("stileTab.giro")}</label>
          <input id="stile-giro" type="number" step={0.1} min={0.05} placeholder="2" style={S.input}
            value={bozza.spin_s ?? ""} onChange={(e) => metti({ spin_s: numero(e.target.value) })} />
          <label style={S.label} htmlFor="stile-lampeggio">{t("stileTab.lampeggio")}</label>
          <input id="stile-lampeggio" type="number" step={50} min={50} placeholder="800" style={S.input}
            value={bozza.blink_ms ?? ""} onChange={(e) => metti({ blink_ms: numero(e.target.value) })} />
          <label style={S.label} htmlFor="stile-livello">{t("stileTab.livello")}</label>
          <input id="stile-livello" type="number" step={50} min={0} placeholder="0" style={S.input}
            value={bozza.level_transition_ms ?? ""} onChange={(e) => metti({ level_transition_ms: numero(e.target.value) })} />
        </div>

        <div>
          <div style={S.sectionTitle}>{t("stileTab.anteprima")}</div>
          <div style={{ ...S.card, display: "flex", flexWrap: "wrap", gap: 10, justifyContent: "center", background: "#d0d6dc", padding: 12 }}>
            {manifesto && ANTEPRIMA.map((id) => {
              const sim = manifesto.symbols.find((s) => s.id === id);
              const svg = sim ? svgLibCaricato(sim) : undefined;
              if (!sim || !svg) return null;
              const [w, h] = sim.viewBox;
              const k = 96 / Math.max(w, h);
              return (
                <svg key={id} width={w * k} height={h * k}>
                  <SimboloLibSvg sim={sim} svg={svg} manifesto={manifesto} prefisso={`stile-${id.replace(/[^\w-]/g, "_")}`}
                    x={0} y={0} w={w * k} h={h * k} progetto={anteprima}
                    valori={{ corpo: id.endsWith("pump") ? (bozza.state_on_color || (regola("symbol", "state_on_color") as { hex: string }).hex) : null,
                      livello: 0.6, gira: true, periodoS: bozza.spin_s ?? 2 }} />
                </svg>
              );
            })}
          </div>
          <div style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", margin: "4px 0 14px" }}>{t("stileTab.anteprimaHint")}</div>

          <div style={S.sectionTitle}>{t("stileTab.materiali")}</div>
          {materiali.map(([m, predef]) => (
            <div key={m} style={{ marginBottom: 4, display: "grid", gridTemplateColumns: "minmax(0, 9em) minmax(0, 1fr)", gap: 6, alignItems: "center" }}>
              <label style={{ ...S.label, marginBottom: 0 }} htmlFor={`stile-mat-${m}`}>{m}</label>
              {colore(bozza.materials?.[m] || undefined, predef, (v) => mettiMateriale(m, v), `stile-mat-${m}`)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
