import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/api/client";
import { scheda, titoletto } from "./stile";

/**
 * I pannelli del gateway (11-10-2026, fetta D dell'abbinamento): chi è
 * abbinato col codice, a quale azienda, se è collegato adesso, e il suo stato.
 *
 * **Il ban sta sull'hardware**: un pannello bandito è rifiutato prima ancora di
 * guardare il token, e resta bandito anche se lo si riformatta e lo si abbina di
 * nuovo. Sospeso è lo stesso, ma pensato per tornare.
 *
 * **L'azienda si cambia solo da qui** (21-10-2026). Fino a quel giorno un
 * pannello sospeso lo poteva rivendicare chiunque avesse il codice, e quello era
 * l'unico modo di spostarlo: un effetto collaterale, non una decisione. Ora
 * sospeso vuol dire fermo, e lo spostamento è una scelta esplicita di chi
 * amministra la piattaforma — col tunnel che si stacca, perché gli stream
 * aperti erano stati autorizzati per l'azienda di prima.
 */
type Riga = {
  nome: string;
  azienda: string;
  hw: string;
  stato: "attivo" | "sospeso" | "bandito";
  abbinato_ms: number;
  ultimo_ms: number;
  collegato: boolean;
  /** Si è annunciato spento (ms), se dopo non è più tornato. */
  spento_ms?: number;
};
type Elenco = {
  abbinati: Riga[];
  dichiarati: { nome: string; azienda: string; collegato: boolean; spento_ms?: number }[];
  in_attesa: number;
};

export function Pannelli() {
  const { t } = useTranslation();
  const [elenco, setElenco] = useState<Elenco | null>(null);
  const [aziende, setAziende] = useState<{ segmento: string; nome: string }[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const carica = useCallback(() => {
    api.pannelliAmministrazione()
      .then((e) => { setElenco(e as Elenco); setErr(null); })
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : String(e)));
  }, []);
  useEffect(() => { carica(); }, [carica]);
  // Le aziende servono per il menù «sposta»: il segmento è come il gateway le
  // nomina, ed è quello che la riga del pannello tiene in `azienda`. Lo porta
  // già il sinottico delle risorse, quindi niente rotta nuova.
  useEffect(() => {
    api.amministrazioneRisorse()
      .then((r) => setAziende(r.aziende.map((a) => ({
        segmento: a.segmento ?? "-",
        // L'azienda implicita ha un nome scritto nel database in italiano:
        // nell'IDE in inglese si traduce, come fa il sinottico delle risorse.
        nome: a.implicita ? t("console.persone.questaInstallazione") : a.nome,
      }))))
      .catch(() => setAziende([]));
  }, [t]);

  const cambia = async (nome: string, stato: Riga["stato"]) => {
    if (stato === "bandito" && !window.confirm(t("console.pannelli.confermaBan", { nome }))) return;
    try {
      await api.statoPannello(nome, stato);
      carica();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  const sposta = async (nome: string, azienda: string) => {
    if (!window.confirm(t("console.pannelli.confermaSposta", { nome, azienda }))) return;
    try {
      await api.spostaPannelloAzienda(nome, azienda);
      carica();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  const rinomina = async (nome: string) => {
    const nuovo = window.prompt(t("console.pannelli.nuovoNome", { nome }), nome);
    if (!nuovo || nuovo.trim() === nome) return;
    try {
      await api.rinominaPannelloGateway(nome, nuovo.trim());
      carica();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  if (err) return <div style={scheda}>{err}</div>;
  if (!elenco) return <div style={scheda}>{t("console.verifica")}</div>;
  const quando = (ms: number) => (ms > 0 ? new Date(ms).toLocaleString() : "—");
  // Tre stati (ramo 7 dei residui): vivo, spento annunciato, perso.
  const pallino = (c: boolean, spento?: number) => (
    <span data-testid="pallino"
      title={c ? t("console.pannelli.collegato") : spento ? t("console.pannelli.spento", { quando: quando(spento) }) : t("console.pannelli.scollegato")}
      style={{ display: "inline-block", width: 8, height: 8, borderRadius: 4, background: c ? "#22c55e" : spento ? "#eab308" : "#64748b", marginRight: 6 }} />
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={scheda}>
        <span style={titoletto}>{t("console.pannelli.abbinati")}</span>
        <p style={{ fontSize: 12, color: "var(--brand-text-muted, #94a3b8)", margin: "4px 0 10px" }}>
          {t("console.pannelli.inAttesa", { n: elenco.in_attesa })}
        </p>
        {elenco.abbinati.length === 0 ? (
          <div style={{ fontSize: 13, color: "var(--brand-text-subtle, #64748b)" }}>{t("console.pannelli.nessuno")}</div>
        ) : (
          <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", color: "var(--brand-text-muted, #94a3b8)" }}>
                <th>{t("console.pannelli.nome")}</th><th>{t("console.pannelli.azienda")}</th>
                <th>{t("console.pannelli.hardware")}</th><th>{t("console.pannelli.ultimo")}</th>
                <th>{t("console.pannelli.stato")}</th>
              </tr>
            </thead>
            <tbody>
              {elenco.abbinati.map((r) => (
                <tr key={r.hw} style={{ borderTop: "1px solid var(--brand-surface-2, #334155)" }}>
                  <td style={{ padding: "6px 4px" }}>
                    {pallino(r.collegato, r.spento_ms)}{r.nome}
                    <button onClick={() => rinomina(r.nome)} title={t("console.pannelli.rinomina")}
                      style={{ marginLeft: 6, background: "transparent", border: "none", cursor: "pointer", color: "var(--brand-text-muted, #94a3b8)", fontSize: 12 }}>✎</button>
                  </td>
                  <td>
                    {aziende.length > 0 ? (
                      <select value={r.azienda} title={t("console.pannelli.spostaAiuto")}
                        onChange={(e) => void sposta(r.nome, e.target.value)}
                        style={{ background: "var(--brand-bg, #0f172a)", color: "var(--brand-text, #e2e8f0)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4, fontSize: 12 }}>
                        {/* Il segmento di oggi c'è sempre, anche se l'azienda
                            non è più nell'elenco: altrimenti il menù mostrerebbe
                            un'azienda diversa da quella vera. */}
                        {!aziende.some((a) => a.segmento === r.azienda) && (
                          <option value={r.azienda}>{r.azienda}</option>
                        )}
                        {aziende.map((a) => (
                          <option key={a.segmento} value={a.segmento}>{a.nome}</option>
                        ))}
                      </select>
                    ) : r.azienda}
                  </td>
                  <td style={{ fontFamily: "ui-monospace, monospace", fontSize: 11 }}>{r.hw}</td>
                  <td style={{ fontSize: 11 }}>{quando(r.ultimo_ms)}</td>
                  <td>
                    <select value={r.stato} onChange={(e) => cambia(r.nome, e.target.value as Riga["stato"])}
                      style={{ background: "var(--brand-bg, #0f172a)", color: r.stato === "bandito" ? "#fca5a5" : "var(--brand-text, #e2e8f0)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4, fontSize: 12 }}>
                      <option value="attivo">{t("console.pannelli.attivo")}</option>
                      <option value="sospeso">{t("console.pannelli.sospeso")}</option>
                      <option value="bandito">{t("console.pannelli.bandito")}</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {elenco.dichiarati.length > 0 && (
        <div style={scheda}>
          <span style={titoletto}>{t("console.pannelli.dichiarati")}</span>
          {elenco.dichiarati.map((d) => (
            <div key={d.nome} style={{ fontSize: 13, padding: "3px 0" }}>{pallino(d.collegato, d.spento_ms)}{d.nome} · {d.azienda}</div>
          ))}
        </div>
      )}
    </div>
  );
}
