import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { uguale } from "@/ai/confronto";
import { useAppStore } from "@/store";
import { ascolta, chiedi } from "@/ws/aiStream";
import type { MsgIn, Riga, VoceDiff } from "@/types/ai";
import type { ProjectInfo, SynopticPage } from "@/types";

/**
 * La chat dell'assistente di progettazione (T-50).
 *
 * Ricalca `LogPanel`: aperta/chiusa da App, ricordata in localStorage, voce nel
 * menu ☰. È però un cassetto **laterale** e non in basso — una conversazione è
 * alta, non larga.
 *
 * Tre cose sono deliberate e vale la pena dirle:
 *
 *  * **le chiamate a strumento si vedono mentre accadono.** Metà della fiducia
 *    in un assistente è sapere cosa sta guardando; l'altra metà è il diff.
 *  * **il diff non è YAML.** Sono tre elenchi — tag, sorgenti, oggetti in
 *    pagina — perché una proposta che nessuno rilegge davvero passa lo stesso,
 *    ed è il rischio vero di tutta questa funzione.
 *  * **Applica non salva.** Applica allo store: da lì c'è Ctrl+Z, e il disco
 *    aspetta che qualcuno prema Salva.
 */
export function ChatPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const applyAiProposal = useAppStore((s) => s.applyAiProposal);

  const [righe, setRighe]     = useState<Riga[]>([]);
  const [bozza, setBozza]     = useState("");
  const [attesa, setAttesa]   = useState(false);
  const [stato, setStato]     = useState<{ attivo: boolean; modello: string; motivo?: string | null } | null>(null);
  const fondo = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    return ascolta((m: MsgIn) => {
      switch (m.t) {
        case "pronto":
          setStato({ attivo: m.attivo, modello: m.modello, motivo: m.motivo });
          break;
        case "testo":
          setRighe((r) => appendiTesto(r, m.delta));
          break;
        case "pensiero":
          // Il ragionamento non si mostra: è rumore per chi sta disegnando, e
          // mostrarlo invita a leggerlo invece del diff.
          break;
        case "strumento":
          setRighe((r) => aggiornaStrumento(r, m.nome, m.stato, m.messaggio));
          break;
        case "proposta": {
          // Il diff si calcola **adesso**, contro lo stato di adesso, e resta
          // quello. Ricalcolandolo a ogni render, dopo l'applicazione
          // confronterebbe la proposta con sé stessa e direbbe «non cambia
          // niente» — cioè cancellerebbe dallo schermo la cosa che l'utente ha
          // appena approvato.
          const s = useAppStore.getState();
          const diff = riassumi(m.project ?? null, m.pages ?? null, s.project, s.pages);
          setRighe((r) => [...r, { tipo: "proposta", msg: m, diff }]);
          break;
        }
        case "errore":
          setRighe((r) => [...r, { tipo: "errore", testo: m.messaggio }]);
          break;
        case "fine":
          setAttesa(false);
          break;
      }
    });
  }, [open]);

  useEffect(() => {
    fondo.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [righe.length, open]);

  if (!open) return null;

  const invia = () => {
    const testo = bozza.trim();
    if (!testo || attesa) return;
    if (!chiedi(testo)) {
      setRighe((r) => [...r, { tipo: "errore", testo: t("chat.noConnection") }]);
      return;
    }
    setRighe((r) => [...r, { tipo: "utente", testo }]);
    setBozza("");
    setAttesa(true);
  };

  const applica = async (indice: number) => {
    const riga = righe[indice];
    if (riga?.tipo !== "proposta") return;
    const esito = await applyAiProposal({
      id: riga.msg.id,
      motivo: riga.msg.motivo,
      project: riga.msg.project,
      pages: riga.msg.pages,
      impronta: riga.msg.impronta,
    });
    setRighe((r) => r.map((x, i) => i !== indice || x.tipo !== "proposta" ? x : {
      ...x,
      esito: esito.ok ? "applicata" : "rifiutata",
      nota: esito.ok ? esito.avviso : esito.motivo,
    }));
  };

  const scarta = (indice: number) => {
    setRighe((r) => r.map((x, i) =>
      i !== indice || x.tipo !== "proposta" ? x : { ...x, esito: "scartata" }));
  };

  return (
    <aside style={PANNELLO}>
      <div style={INTESTAZIONE}>
        <strong style={{ fontSize: 12, letterSpacing: 0.5, color: "var(--brand-text, #e2e8f0)" }}>
          {t("chat.title")}
        </strong>
        <span style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)" }}>
          {stato?.modello ?? "…"}
        </span>
        <div style={{ flex: 1 }} />
        <button style={BTN} onClick={() => setRighe([])} title={t("chat.clear")}>⌫</button>
        <button style={BTN} onClick={onClose} title={t("chat.close")}>✕</button>
      </div>

      {stato && !stato.attivo && (
        <div style={AVVISO}>{stato.motivo ?? t("chat.inactive")}</div>
      )}

      <div style={LISTA}>
        {righe.length === 0 && (
          <div style={{ color: "var(--brand-text-subtle, #64748b)", fontSize: 12, padding: "12px 10px", lineHeight: 1.6 }}>
            {t("chat.empty")}
            <div style={{ marginTop: 10, fontStyle: "italic", opacity: 0.85 }}>
              {t("chat.example")}
            </div>
          </div>
        )}

        {righe.map((r, i) => {
          if (r.tipo === "utente") {
            return <div key={i} style={BOLLA_UTENTE}>{r.testo}</div>;
          }
          if (r.tipo === "assistente") {
            return <div key={i} style={BOLLA_ASSISTENTE}>{r.testo}</div>;
          }
          if (r.tipo === "errore") {
            return <div key={i} style={BOLLA_ERRORE}>{r.testo}</div>;
          }
          if (r.tipo === "strumento") {
            const icona = r.stato === "errore" ? "✗" : r.stato === "fatto" ? "✓" : "…";
            return (
              <div key={i} style={{ ...RIGA_STRUMENTO,
                    color: r.stato === "errore" ? "var(--brand-danger, #ef4444)"
                                                : "var(--brand-text-subtle, #64748b)" }}>
                {icona} {r.nome}{r.messaggio ? ` — ${r.messaggio}` : ""}
              </div>
            );
          }
          return (
            <Proposta key={i} riga={r}
                      onApplica={() => applica(i)} onScarta={() => scarta(i)} />
          );
        })}
        {attesa && <div style={RIGA_STRUMENTO}>…</div>}
        <div ref={fondo} />
      </div>

      <div style={COMPOSITORE}>
        <textarea
          value={bozza}
          onChange={(e) => setBozza(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); invia(); }
          }}
          placeholder={t("chat.placeholder")}
          rows={3}
          style={TESTO_INPUT}
          disabled={stato != null && !stato.attivo}
        />
        <button style={{ ...BTN_PRIMARIO, opacity: attesa || !bozza.trim() ? 0.5 : 1 }}
                disabled={attesa || !bozza.trim()} onClick={invia}>
          {attesa ? t("chat.working") : t("chat.send")}
        </button>
      </div>
    </aside>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// La proposta e il suo diff
// ─────────────────────────────────────────────────────────────────────────────

function Proposta({ riga, onApplica, onScarta }: {
  riga: Extract<Riga, { tipo: "proposta" }>;
  onApplica: () => void;
  onScarta: () => void;
}) {
  const { t } = useTranslation();
  const diff = riga.diff;
  const nuovi = (riga.msg.giudizio?.rilievi ?? []).filter((x) => !x.preesistente);

  return (
    <div style={CARTA}>
      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--brand-text, #e2e8f0)", marginBottom: 6 }}>
        {riga.msg.motivo}
      </div>

      {diff.length === 0 ? (
        <div style={{ fontSize: 12, color: "var(--brand-text-subtle, #64748b)" }}>{t("chat.noChanges")}</div>
      ) : (
        <ul style={{ margin: "0 0 8px", paddingLeft: 16, fontSize: 12, lineHeight: 1.6,
                     color: "var(--brand-text-muted, #94a3b8)" }}>
          {diff.map((d, i) => (
            <li key={i}>
              <span style={{ color: d.verso === "+" ? "var(--brand-success, #22c55e)"
                                   : d.verso === "-" ? "var(--brand-danger, #ef4444)"
                                                     : "var(--brand-warning, #f59e0b)" }}>
                {d.verso}
              </span>{" "}
              {d.testo}
            </li>
          ))}
        </ul>
      )}

      {nuovi.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          {nuovi.map((x, i) => (
            <div key={i} style={{ fontSize: 11, lineHeight: 1.5,
                  color: x.severity === "error" ? "var(--brand-danger, #ef4444)"
                                                : "var(--brand-warning, #f59e0b)" }}>
              {x.severity === "error" ? "✗" : "!"} {x.path} — {x.message}
            </div>
          ))}
        </div>
      )}

      {riga.esito ? (
        <div style={{ fontSize: 11, color: riga.esito === "applicata"
                          ? "var(--brand-success, #22c55e)" : "var(--brand-text-subtle, #64748b)" }}>
          {t(`chat.outcome.${riga.esito}`)}
          {riga.nota ? <div style={{ marginTop: 4, color: "var(--brand-warning, #f59e0b)" }}>{riga.nota}</div> : null}
        </div>
      ) : (
        <div style={{ display: "flex", gap: 6 }}>
          <button style={BTN_PRIMARIO} onClick={onApplica}>{t("chat.apply")}</button>
          <button style={BTN} onClick={onScarta}>{t("chat.discard")}</button>
        </div>
      )}
      <div style={{ fontSize: 10, color: "var(--brand-text-subtle, #64748b)", marginTop: 6 }}>
        {t("chat.applyNote")}
      </div>
    </div>
  );
}

/** Il diff leggibile: cosa cambia, non come. */
export function riassumi(
  propProject: ProjectInfo | null,
  propPages: SynopticPage[] | null,
  project: ProjectInfo | null,
  pages: SynopticPage[],
): VoceDiff[] {
  const out: VoceDiff[] = [];
  // `uguale` e non `JSON.stringify`: l'ordine delle chiavi differisce fra
  // l'API (ordine del file YAML) e la proposta (ordine della struct Rust), e
  // con lo stringify il diff dichiarava «modificati» quasi tutti gli oggetti
  // della pagina.
  const stessa = uguale;

  const perId = <T extends { id: string }>(v: T[] | undefined | null) =>
    new Map((v ?? []).map((x) => [x.id, x]));

  if (propProject && project) {
    for (const [etichetta, prima, dopo] of [
      ["tag",      perId(project.tags),    perId(propProject.tags)],
      ["sorgente", perId(project.sources as { id: string }[]), perId(propProject.sources as { id: string }[])],
      ["allarme",  perId(project.alarms),  perId(propProject.alarms)],
    ] as [string, Map<string, unknown>, Map<string, unknown>][]) {
      for (const [id, v] of dopo) {
        if (!prima.has(id)) out.push({ verso: "+", testo: `${etichetta} \`${id}\`` });
        else if (!stessa(prima.get(id), v)) out.push({ verso: "~", testo: `${etichetta} \`${id}\`` });
      }
      for (const id of prima.keys()) {
        if (!dopo.has(id)) out.push({ verso: "-", testo: `${etichetta} \`${id}\`` });
      }
    }
  }

  for (const pg of propPages ?? []) {
    const attuale = pages.find((p) => p.name === pg.name);
    if (!attuale) {
      out.push({ verso: "+", testo: `pagina «${pg.name}» (${pg.objects.length} oggetti)` });
      continue;
    }
    const prima = new Map(attuale.objects.map((o) => [o.id, o]));
    const dopo  = new Map(pg.objects.map((o) => [o.id, o]));
    for (const [id, o] of dopo) {
      if (!prima.has(id)) out.push({ verso: "+", testo: `${o.type} \`${id}\` in «${pg.name}»` });
      else if (!stessa(prima.get(id), o)) out.push({ verso: "~", testo: `${o.type} \`${id}\` in «${pg.name}»` });
    }
    for (const [id, o] of prima) {
      if (!dopo.has(id)) out.push({ verso: "-", testo: `${o.type} \`${id}\` da «${pg.name}»` });
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────

function appendiTesto(righe: Riga[], delta: string): Riga[] {
  const ultima = righe[righe.length - 1];
  if (ultima?.tipo === "assistente") {
    return [...righe.slice(0, -1), { tipo: "assistente", testo: ultima.testo + delta }];
  }
  return [...righe, { tipo: "assistente", testo: delta }];
}

/** Uno strumento che passa da «eseguo» a «fatto» aggiorna la sua riga invece
 *  di aggiungerne una: altrimenti una conversazione di dieci strumenti diventa
 *  venti righe di rumore. */
function aggiornaStrumento(righe: Riga[], nome: string, stato: string, messaggio?: string): Riga[] {
  for (let i = righe.length - 1; i >= 0; i--) {
    const r = righe[i];
    if (r.tipo !== "strumento") break;
    if (r.nome === nome && r.stato !== "fatto" && r.stato !== "errore") {
      const copia = [...righe];
      copia[i] = { tipo: "strumento", nome, stato, messaggio };
      return copia;
    }
  }
  return [...righe, { tipo: "strumento", nome, stato, messaggio }];
}

// ── Stili, sulla falsariga di LogPanel ───────────────────────────────────────

const PANNELLO: React.CSSProperties = {
  width: 380,
  flexShrink: 0,
  background: "var(--brand-bg, #0b1220)",
  borderLeft: "1px solid var(--brand-surface-2, #334155)",
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
};

const INTESTAZIONE: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 6, padding: "6px 8px",
  background: "var(--brand-bg, #0f172a)",
  borderBottom: "1px solid var(--brand-surface-2, #334155)", flexShrink: 0,
};

const LISTA: React.CSSProperties = {
  flex: 1, overflowY: "auto", padding: "8px 10px",
  display: "flex", flexDirection: "column", gap: 8,
};

const COMPOSITORE: React.CSSProperties = {
  borderTop: "1px solid var(--brand-surface-2, #334155)", padding: 8,
  display: "flex", flexDirection: "column", gap: 6, flexShrink: 0,
};

const TESTO_INPUT: React.CSSProperties = {
  background: "var(--brand-bg, #0f172a)", color: "var(--brand-text, #e2e8f0)",
  border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4,
  padding: "6px 8px", fontSize: 12, fontFamily: "inherit", resize: "vertical",
};

const BTN: React.CSSProperties = {
  background: "var(--brand-surface, #1e293b)", color: "var(--brand-text, #e2e8f0)",
  border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4,
  padding: "4px 10px", fontSize: 12, cursor: "pointer",
};

const BTN_PRIMARIO: React.CSSProperties = { ...BTN, background: "#1d4ed8", color: "#fff" };

const BOLLA_UTENTE: React.CSSProperties = {
  alignSelf: "flex-end", maxWidth: "88%", background: "var(--brand-surface, #1e293b)",
  borderRadius: 8, padding: "6px 10px", fontSize: 12, lineHeight: 1.5,
  color: "var(--brand-text, #e2e8f0)", whiteSpace: "pre-wrap",
};

const BOLLA_ASSISTENTE: React.CSSProperties = {
  maxWidth: "95%", fontSize: 12, lineHeight: 1.6,
  color: "var(--brand-text-muted, #94a3b8)", whiteSpace: "pre-wrap",
};

const BOLLA_ERRORE: React.CSSProperties = {
  fontSize: 12, lineHeight: 1.5, color: "var(--brand-danger, #ef4444)",
  border: "1px solid var(--brand-danger, #ef4444)", borderRadius: 6, padding: "6px 8px",
};

const RIGA_STRUMENTO: React.CSSProperties = {
  fontSize: 11, fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
  color: "var(--brand-text-subtle, #64748b)",
};

const AVVISO: React.CSSProperties = {
  fontSize: 11, lineHeight: 1.5, padding: "6px 10px",
  background: "rgba(245,158,11,0.12)", color: "var(--brand-warning, #f59e0b)",
  borderBottom: "1px solid var(--brand-surface-2, #334155)",
};

const CARTA: React.CSSProperties = {
  border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 6,
  padding: "8px 10px", background: "var(--brand-surface, #1e293b)",
};
