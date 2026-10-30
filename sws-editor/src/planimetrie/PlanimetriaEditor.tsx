/** L'editor di una planimetria (29-10-2026, ramo 1 del piano
 *  `docs/plans/2026-10-25-planimetrie-3d.md`): la pianta in 2D.
 *
 *  Prende il posto del canvas come l'editor delle funzioni. La pianta è in
 *  **metri**: l'SVG disegna direttamente nelle unità del modello, e la scala
 *  la fa il `viewBox`. Una bozza sola con il suo «Salva», registrata anche fra
 *  le sezioni del Salva generale: una planimetria non è una pagina e sta fuori
 *  dalla storia delle pagine.
 *
 *  Gli strumenti: seleziona (sposta blocchi, trascina i vertici del muro
 *  scelto), muro e area (clic per punto, doppio clic o Invio per chiudere, Esc
 *  per lasciar perdere), porta e finestra (un clic vicino a un muro), blocco
 *  (un clic). La vista 3D e «Genera sfondo» arrivano col ramo 2. */
import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/api/client";
import { useAppStore } from "@/store";
import {
  PREDEFINITI, aggancia, centroDi, idNuovo, ingombro, normalizza, proiezione, puntoA, senzaOrfani, spigoliBlocco, tuttiGliId,
  type Apertura, type Area, type Blocco, type Muro, type Planimetria, type Punto,
} from "./modello";

type Strumento = "seleziona" | "muro" | "porta" | "finestra" | "area" | "blocco";
type Scelto = { tipo: "muro" | "apertura" | "area" | "blocco"; id: string } | null;
type Trascina = { tipo: "blocco"; id: string; dx: number; dy: number } | { tipo: "vertice"; id: string; i: number } | { tipo: "vista"; da: Punto; vb: Vista } | null;
type Vista = { x: number; y: number; w: number; h: number };

const STRUMENTI: Strumento[] = ["seleziona", "muro", "porta", "finestra", "area", "blocco"];
const ICONE: Record<Strumento, string> = { seleziona: "↖", muro: "▬", porta: "🚪", finestra: "🪟", area: "▦", blocco: "⬛" };
const PASSI = [0.05, 0.1, 0.25, 0.5, 1];
/** Quanto vicino a un muro (metri) un clic aggancia una porta o una finestra. */
const VICINO_AL_MURO = 0.6;

export function PlanimetriaEditor({ id }: { id: string }) {
  const { t } = useTranslation();
  const apri = useAppStore((s) => s.apriPlanimetria);
  const registerPendingSection = useAppStore((s) => s.registerPendingSection);
  const [bozza, setBozza] = useState<Planimetria | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [sporca, setSporca] = useState(false);
  const [strumento, setStrumento] = useState<Strumento>("seleziona");
  const [scelto, setScelto] = useState<Scelto>(null);
  const [inCorso, setInCorso] = useState<Punto[]>([]);
  const [cursore, setCursore] = useState<Punto | null>(null);
  const [passo, setPasso] = useState(0.1);
  const [vista, setVista] = useState<Vista | null>(null);
  const trascina = useRef<Trascina>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    let vivo = true;
    setBozza(null);
    setErrore(null);
    api.planimetria(id)
      .then((p) => {
        if (!vivo) return;
        const n = normalizza(p);
        setBozza(n);
        setVista(ingombro(n));
        setSporca(false);
      })
      .catch((e: unknown) => vivo && setErrore(e instanceof Error ? e.message : String(e)));
    return () => { vivo = false; };
  }, [id]);

  const cambia = useCallback((f: (p: Planimetria) => Planimetria) => {
    setBozza((p) => (p ? f(p) : p));
    setSporca(true);
  }, []);

  const salva = useCallback(async () => {
    const p = bozza;
    if (!p) return;
    await api.salvaPlanimetria(senzaOrfani(p));
    setSporca(false);
  }, [bozza]);

  // Il Salva generale la trova come le schede della Configurazione.
  useEffect(() => {
    registerPendingSection(`planimetria:${id}`, sporca ? salva : null);
    return () => registerPendingSection(`planimetria:${id}`, null);
  }, [id, sporca, salva, registerPendingSection]);

  const chiudi = () => {
    if (sporca && !window.confirm(t("planimetrie.sporcaChiudi"))) return;
    apri(null);
  };

  // Da coordinate dello schermo a metri.
  const inMetri = (e: { clientX: number; clientY: number }): Punto | null => {
    const svg = svgRef.current;
    const m = svg?.getScreenCTM?.();
    if (!svg || !m) return null;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return [p.x, p.y];
  };
  const agganciato = (p: Punto): Punto => [aggancia(p[0], passo), aggancia(p[1], passo)];

  const chiudiTraccia = useCallback(() => {
    setInCorso((punti) => {
      if (strumento === "muro" && punti.length >= 2) {
        cambia((p) => {
          const m: Muro = { id: idNuovo("m", tuttiGliId(p)), punti, spessore: PREDEFINITI.spessoreMuro, altezza: PREDEFINITI.altezzaMuro };
          setScelto({ tipo: "muro", id: m.id });
          return { ...p, muri: [...p.muri, m] };
        });
      } else if (strumento === "area" && punti.length >= 3) {
        cambia((p) => {
          const a: Area = { id: idNuovo("z", tuttiGliId(p)), punti, colore: PREDEFINITI.area.colore };
          setScelto({ tipo: "area", id: a.id });
          return { ...p, aree: [...p.aree, a] };
        });
      }
      return [];
    });
  }, [strumento, cambia]);

  const eliminaScelto = useCallback(() => {
    if (!scelto) return;
    cambia((p) => senzaOrfani({
      ...p,
      muri: scelto.tipo === "muro" ? p.muri.filter((x) => x.id !== scelto.id) : p.muri,
      aperture: scelto.tipo === "apertura" ? p.aperture.filter((x) => x.id !== scelto.id) : p.aperture,
      aree: scelto.tipo === "area" ? p.aree.filter((x) => x.id !== scelto.id) : p.aree,
      blocchi: scelto.tipo === "blocco" ? p.blocchi.filter((x) => x.id !== scelto.id) : p.blocchi,
    }));
    setScelto(null);
  }, [scelto, cambia]);

  useEffect(() => {
    const tasto = (e: KeyboardEvent) => {
      const dentroUnCampo = (e.target as HTMLElement | null)?.closest?.("input, textarea, select");
      if (dentroUnCampo) return;
      if (e.key === "Escape") { setInCorso([]); setScelto(null); }
      else if (e.key === "Enter") chiudiTraccia();
      else if ((e.key === "Delete" || e.key === "Backspace") && scelto) { e.preventDefault(); eliminaScelto(); }
    };
    window.addEventListener("keydown", tasto);
    return () => window.removeEventListener("keydown", tasto);
  }, [chiudiTraccia, eliminaScelto, scelto]);

  if (errore) return <div style={{ padding: 24, color: "var(--brand-danger, #ef4444)" }}>{t("planimetrie.errore", { message: errore })}</div>;
  if (!bozza || !vista) return <div style={{ padding: 24, color: "var(--brand-text-subtle, #94a3b8)" }}>{t("planimetrie.caricamento")}</div>;

  const clicSulFondo = (e: React.MouseEvent) => {
    const p0 = inMetri(e);
    if (!p0) return;
    const p = agganciato(p0);
    if (strumento === "muro" || strumento === "area") {
      setInCorso((punti) => [...punti, p]);
    } else if (strumento === "porta" || strumento === "finestra") {
      const vicino = bozza.muri
        .map((m) => ({ m, ...proiezione(m.punti, p0) }))
        .sort((a, b) => a.distanza - b.distanza)[0];
      if (!vicino || vicino.distanza > VICINO_AL_MURO) return;
      const base = strumento === "porta" ? PREDEFINITI.porta : PREDEFINITI.finestra;
      cambia((pl) => {
        const a: Apertura = { id: idNuovo(strumento === "porta" ? "p" : "f", tuttiGliId(pl)), muro: vicino.m.id, t: vicino.t, tipo: strumento, ...base };
        setScelto({ tipo: "apertura", id: a.id });
        return { ...pl, aperture: [...pl.aperture, a] };
      });
    } else if (strumento === "blocco") {
      cambia((pl) => {
        const b: Blocco = { id: idNuovo("b", tuttiGliId(pl)), x: p[0], y: p[1], rotazione: 0, ...PREDEFINITI.blocco };
        setScelto({ tipo: "blocco", id: b.id });
        return { ...pl, blocchi: [...pl.blocchi, b] };
      });
    } else {
      setScelto(null);
      trascina.current = { tipo: "vista", da: [e.clientX, e.clientY], vb: vista };
    }
  };

  const muovi = (e: React.MouseEvent) => {
    const p0 = inMetri(e);
    if (p0) setCursore(agganciato(p0));
    const tr = trascina.current;
    if (!tr) return;
    if (tr.tipo === "vista") {
      const svg = svgRef.current;
      const scala = svg ? tr.vb.w / svg.clientWidth : 0;
      setVista({ ...tr.vb, x: tr.vb.x - (e.clientX - tr.da[0]) * scala, y: tr.vb.y - (e.clientY - tr.da[1]) * scala });
      return;
    }
    if (!p0) return;
    if (tr.tipo === "blocco") {
      const [x, y] = agganciato([p0[0] - tr.dx, p0[1] - tr.dy]);
      cambia((pl) => ({ ...pl, blocchi: pl.blocchi.map((b) => (b.id === tr.id ? { ...b, x, y } : b)) }));
    } else {
      const q = agganciato(p0);
      cambia((pl) => ({ ...pl, muri: pl.muri.map((m) => (m.id === tr.id ? { ...m, punti: m.punti.map((v, i) => (i === tr.i ? q : v)) } : m)) }));
    }
  };

  const rotella = (e: React.WheelEvent) => {
    const p = inMetri(e);
    if (!p) return;
    const f = e.deltaY > 0 ? 1.15 : 1 / 1.15;
    setVista({ x: p[0] - (p[0] - vista.x) * f, y: p[1] - (p[1] - vista.y) * f, w: vista.w * f, h: vista.h * f });
  };

  const sceltoE = (tipo: NonNullable<Scelto>["tipo"], idx: string) => scelto?.tipo === tipo && scelto.id === idx;
  const traccia = cursore && inCorso.length ? [...inCorso, cursore] : inCorso;
  const linea = Math.max(vista.w, vista.h) / 400; // un pixel circa, in metri

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0, overflow: "hidden" }} data-testid="editor-planimetria">
      <div style={BARRA}>
        <strong style={{ marginRight: 8 }}>🏠 {bozza.nome || bozza.id}</strong>
        {STRUMENTI.map((s) => (
          <button key={s} data-testid={`strumento-${s}`} title={t(`planimetrie.aiuto.${s}`)}
            onClick={() => { setStrumento(s); setInCorso([]); }}
            style={{ ...PULSANTE, ...(strumento === s ? PULSANTE_ATTIVO : {}) }}>
            {ICONE[s]} {t(`planimetrie.strumenti.${s}`)}
          </button>
        ))}
        <label style={{ fontSize: 12, marginLeft: 8 }}>{t("planimetrie.passo")}{" "}
          <select value={passo} onChange={(e) => setPasso(Number(e.target.value))} style={CAMPO_PICCOLO}>
            {PASSI.map((x) => <option key={x} value={x}>{x} m</option>)}
          </select>
        </label>
        <span style={{ flex: 1 }} />
        <button style={{ ...PULSANTE, ...(sporca ? PULSANTE_ATTIVO : {}) }} disabled={!sporca} data-testid="planimetria-salva"
          onClick={() => void salva().catch((e: unknown) => setErrore(e instanceof Error ? e.message : String(e)))}>
          💾 {t("planimetrie.salva")}
        </button>
        <button style={PULSANTE} onClick={chiudi}>✕ {t("planimetrie.chiudi")}</button>
      </div>
      <div style={{ fontSize: 11, color: "var(--brand-text-subtle, #94a3b8)", padding: "2px 12px" }}>{t(`planimetrie.aiuto.${strumento}`)}</div>

      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        <svg ref={svgRef} data-testid="pianta" style={{ flex: 1, background: bozza.sfondo ?? "#0f172a", cursor: strumento === "seleziona" ? "default" : "crosshair" }}
          viewBox={`${vista.x} ${vista.y} ${vista.w} ${vista.h}`} preserveAspectRatio="xMidYMid meet"
          // Con uno strumento di disegno il clic vale ovunque, anche sopra un
          // muro — è proprio lì che va una porta. Con «seleziona» gli elementi
          // fermano il clic da sé, e qui arriva solo quello sul fondo.
          onMouseDown={(e) => { if (e.button === 0 && (strumento !== "seleziona" || e.target === e.currentTarget)) clicSulFondo(e); }}
          onMouseMove={muovi} onMouseUp={() => { trascina.current = null; }} onMouseLeave={() => { trascina.current = null; setCursore(null); }}
          onDoubleClick={() => chiudiTraccia()} onWheel={rotella}>
          <Griglia vista={vista} linea={linea} />
          {bozza.aree.map((a) => {
            const [cx, cy] = centroDi(a.punti);
            return (
              <g key={a.id} onMouseDown={(e) => { if (strumento === "seleziona") { e.stopPropagation(); setScelto({ tipo: "area", id: a.id }); } }}>
                <polygon points={a.punti.map((p) => p.join(",")).join(" ")} fill={a.colore} fillOpacity={0.55}
                  stroke={sceltoE("area", a.id) ? "#38bdf8" : a.colore} strokeWidth={linea * 2} />
                {a.etichetta && <text x={cx} y={cy} fontSize={linea * 12} fill="#e2e8f0" textAnchor="middle" dominantBaseline="middle" pointerEvents="none">{a.etichetta}</text>}
              </g>
            );
          })}
          {bozza.muri.map((m) => (
            <g key={m.id} onMouseDown={(e) => { if (strumento === "seleziona") { e.stopPropagation(); setScelto({ tipo: "muro", id: m.id }); } }}>
              <polyline points={m.punti.map((p) => p.join(",")).join(" ")} fill="none" stroke={sceltoE("muro", m.id) ? "#38bdf8" : "#cbd5e1"}
                strokeWidth={m.spessore} strokeLinecap="square" strokeLinejoin="miter" />
              {sceltoE("muro", m.id) && m.punti.map((p, i) => (
                <circle key={i} cx={p[0]} cy={p[1]} r={linea * 5} fill="#38bdf8" style={{ cursor: "move" }}
                  onMouseDown={(e) => { e.stopPropagation(); trascina.current = { tipo: "vertice", id: m.id, i }; }} />
              ))}
            </g>
          ))}
          {bozza.aperture.map((a) => {
            const muro = bozza.muri.find((m) => m.id === a.muro);
            if (!muro) return null;
            const { x, y, angolo } = puntoA(muro.punti, a.t);
            const sp = muro.spessore + linea * 4;
            return (
              <rect key={a.id} x={x - a.larghezza / 2} y={y - sp / 2} width={a.larghezza} height={sp}
                transform={`rotate(${(angolo * 180) / Math.PI} ${x} ${y})`}
                fill={a.tipo === "porta" ? "#f59e0b" : "#38bdf8"} stroke={sceltoE("apertura", a.id) ? "#fff" : "none"} strokeWidth={linea * 2}
                onMouseDown={(e) => { if (strumento === "seleziona") { e.stopPropagation(); setScelto({ tipo: "apertura", id: a.id }); } }} />
            );
          })}
          {bozza.blocchi.map((b) => (
            <g key={b.id} style={{ cursor: strumento === "seleziona" ? "move" : undefined }}
              onMouseDown={(e) => {
                if (strumento !== "seleziona") return;
                e.stopPropagation();
                setScelto({ tipo: "blocco", id: b.id });
                const p = inMetri(e);
                if (p) trascina.current = { tipo: "blocco", id: b.id, dx: p[0] - b.x, dy: p[1] - b.y };
              }}>
              <polygon points={spigoliBlocco(b).map((p) => p.join(",")).join(" ")} fill={b.colore}
                stroke={sceltoE("blocco", b.id) ? "#38bdf8" : "#0f172a"} strokeWidth={linea * 2} />
              {b.etichetta && (
                // Dentro il blocco: il corpo si stringe con l'etichetta lunga.
                <text x={b.x} y={b.y} fontSize={Math.min(linea * 11, (b.larghezza * 1.6) / Math.max(1, b.etichetta.length), b.profondita * 0.6)}
                  fill="#e2e8f0" textAnchor="middle" dominantBaseline="middle" pointerEvents="none">{b.etichetta}</text>
              )}
            </g>
          ))}
          {traccia.length > 0 && (
            <polyline points={traccia.map((p) => p.join(",")).join(" ")} fill={strumento === "area" ? "#1e3a5f55" : "none"}
              stroke="#38bdf8" strokeWidth={strumento === "muro" ? PREDEFINITI.spessoreMuro : linea * 2} strokeDasharray={`${linea * 6} ${linea * 4}`} pointerEvents="none" />
          )}
          {cursore && strumento !== "seleziona" && <circle cx={cursore[0]} cy={cursore[1]} r={linea * 3} fill="#38bdf8" pointerEvents="none" />}
        </svg>
        <Proprieta bozza={bozza} scelto={scelto} cambia={cambia} elimina={eliminaScelto} />
      </div>
    </div>
  );
}

/** La griglia metrica: una riga ogni metro, più marcata ogni cinque. */
function Griglia({ vista, linea }: { vista: Vista; linea: number }) {
  const righe: ReactElement[] = [];
  const passo = vista.w > 80 ? 5 : 1;
  for (let x = Math.floor(vista.x / passo) * passo; x <= vista.x + vista.w; x += passo) {
    righe.push(<line key={`x${x}`} x1={x} y1={vista.y} x2={x} y2={vista.y + vista.h} stroke="#1e293b" strokeWidth={x % 5 === 0 ? linea * 1.5 : linea} />);
  }
  for (let y = Math.floor(vista.y / passo) * passo; y <= vista.y + vista.h; y += passo) {
    righe.push(<line key={`y${y}`} x1={vista.x} y1={y} x2={vista.x + vista.w} y2={y} stroke="#1e293b" strokeWidth={y % 5 === 0 ? linea * 1.5 : linea} />);
  }
  return <g pointerEvents="none">{righe}</g>;
}

/** Il pannello delle proprietà: dell'elemento scelto, o della pianta. */
function Proprieta({ bozza, scelto, cambia, elimina }: {
  bozza: Planimetria; scelto: Scelto; cambia: (f: (p: Planimetria) => Planimetria) => void; elimina: () => void;
}) {
  const { t } = useTranslation();
  const num = (etichetta: string, valore: number, imposta: (v: number) => void, passo = 0.05) => (
    <label style={ETICHETTA} key={etichetta}>{t(`planimetrie.campi.${etichetta}`)}
      <input type="number" step={passo} value={Number.isFinite(valore) ? Number(valore.toFixed(3)) : 0} style={CAMPO}
        onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) imposta(v); }} />
    </label>
  );
  const testo = (etichetta: string, valore: string | undefined, imposta: (v: string) => void, tipo = "text") => (
    <label style={ETICHETTA} key={etichetta}>{t(`planimetrie.campi.${etichetta}`)}
      <input type={tipo} value={valore ?? ""} style={CAMPO} onChange={(e) => imposta(e.target.value)} />
    </label>
  );
  const aggiorna = <K extends "muri" | "aperture" | "aree" | "blocchi">(chiave: K, id: string, patch: Partial<Planimetria[K][number]>) =>
    cambia((p) => ({ ...p, [chiave]: (p[chiave] as { id: string }[]).map((x) => (x.id === id ? { ...x, ...patch } : x)) }));

  let corpo: ReactElement[] = [];
  if (!scelto) {
    corpo = [
      testo("nome", bozza.nome, (v) => cambia((p) => ({ ...p, nome: v }))),
      testo("sfondo", bozza.sfondo, (v) => cambia((p) => ({ ...p, sfondo: v })), "color"),
      <div key="nota" style={{ fontSize: 11, color: "var(--brand-text-subtle, #94a3b8)", lineHeight: 1.4 }}>{t("planimetrie.nessunaSelezione")}</div>,
    ];
  } else if (scelto.tipo === "muro") {
    const m = bozza.muri.find((x) => x.id === scelto.id);
    if (m) corpo = [
      num("spessore", m.spessore, (v) => aggiorna("muri", m.id, { spessore: Math.max(0.02, v) })),
      num("altezza", m.altezza, (v) => aggiorna("muri", m.id, { altezza: Math.max(0.1, v) })),
    ];
  } else if (scelto.tipo === "apertura") {
    const a = bozza.aperture.find((x) => x.id === scelto.id);
    if (a) corpo = [
      <label style={ETICHETTA} key="tipo">{t("planimetrie.campi.tipo")}
        <select value={a.tipo} style={CAMPO} onChange={(e) => aggiorna("aperture", a.id, { tipo: e.target.value as Apertura["tipo"] })}>
          <option value="porta">{t("planimetrie.strumenti.porta")}</option>
          <option value="finestra">{t("planimetrie.strumenti.finestra")}</option>
        </select>
      </label>,
      num("posizione", a.t, (v) => aggiorna("aperture", a.id, { t: Math.min(1, Math.max(0, v)) }), 0.01),
      num("larghezza", a.larghezza, (v) => aggiorna("aperture", a.id, { larghezza: Math.max(0.1, v) })),
      num("altezza", a.altezza, (v) => aggiorna("aperture", a.id, { altezza: Math.max(0.1, v) })),
      ...(a.tipo === "finestra" ? [num("daTerra", a.da_terra ?? PREDEFINITI.finestra.da_terra, (v) => aggiorna("aperture", a.id, { da_terra: Math.max(0, v) }))] : []),
    ];
  } else if (scelto.tipo === "area") {
    const a = bozza.aree.find((x) => x.id === scelto.id);
    if (a) corpo = [
      testo("etichetta", a.etichetta, (v) => aggiorna("aree", a.id, { etichetta: v || undefined })),
      testo("colore", a.colore, (v) => aggiorna("aree", a.id, { colore: v }), "color"),
    ];
  } else {
    const b = bozza.blocchi.find((x) => x.id === scelto.id);
    if (b) corpo = [
      testo("etichetta", b.etichetta, (v) => aggiorna("blocchi", b.id, { etichetta: v || undefined })),
      num("larghezza", b.larghezza, (v) => aggiorna("blocchi", b.id, { larghezza: Math.max(0.05, v) })),
      num("profondita", b.profondita, (v) => aggiorna("blocchi", b.id, { profondita: Math.max(0.05, v) })),
      num("altezza", b.altezza, (v) => aggiorna("blocchi", b.id, { altezza: Math.max(0.05, v) })),
      num("rotazione", b.rotazione, (v) => aggiorna("blocchi", b.id, { rotazione: v }), 15),
      testo("colore", b.colore, (v) => aggiorna("blocchi", b.id, { colore: v }), "color"),
    ];
  }
  return (
    <div style={{ width: 240, flexShrink: 0, borderLeft: "1px solid var(--brand-surface-2, #334155)", padding: 12, display: "flex", flexDirection: "column", gap: 10, overflowY: "auto" }}
      data-testid="proprieta-planimetria">
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, color: "var(--brand-text-subtle, #94a3b8)" }}>
        {scelto ? t(`planimetrie.tipi.${scelto.tipo}`) : t("planimetrie.titoloPianta")}
      </div>
      {corpo}
      {scelto && (
        <button style={{ ...PULSANTE, color: "var(--brand-danger, #ef4444)" }} onClick={elimina}>{t("planimetrie.eliminaElemento")}</button>
      )}
    </div>
  );
}

const BARRA: CSSProperties = {
  display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", flexWrap: "wrap",
  borderBottom: "1px solid var(--brand-surface-2, #334155)", fontSize: 13, color: "var(--brand-text, #e2e8f0)",
};
const PULSANTE: CSSProperties = {
  background: "var(--brand-surface, #1e293b)", color: "var(--brand-text, #e2e8f0)", border: "1px solid var(--brand-surface-2, #334155)",
  borderRadius: 4, padding: "3px 8px", fontSize: 12, cursor: "pointer",
};
const PULSANTE_ATTIVO: CSSProperties = { background: "var(--brand-primary, #3b82f6)", borderColor: "var(--brand-primary, #3b82f6)", color: "#fff" };
const ETICHETTA: CSSProperties = { display: "flex", flexDirection: "column", gap: 3, fontSize: 11, color: "var(--brand-text-subtle, #94a3b8)" };
const CAMPO: CSSProperties = {
  background: "var(--brand-bg, #0f172a)", color: "var(--brand-text, #e2e8f0)", border: "1px solid var(--brand-border, #475569)",
  borderRadius: 3, padding: "3px 6px", fontSize: 12,
};
const CAMPO_PICCOLO: CSSProperties = { ...CAMPO, padding: "1px 4px" };
