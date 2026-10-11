import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, type PannelloCloud } from "@/api/client";

/**
 * «Abbina un pannello» — solo nell'IDE nel cloud (piano
 * `docs/archive/2026-10-11-abbinamento-e-primo-accesso.md`, fette D ed E).
 *
 * Un pannello nuovo, acceso e collegato a internet, chiama il gateway da solo e
 * aspetta col codice che mostra sullo schermo. Qui lo si inserisce: il pannello
 * entra nell'azienda di questo progetto e riceve il suo nome nel tunnel.
 *
 * **Nessun utente da creare** (fetta E, scelta del maintainer dell'11-10-2026):
 * gli utenti li porta il primo progetto distribuito; fino ad allora il pannello
 * è chiuso in LAN e lo raggiunge solo il gateway. Utente e password compaiono
 * solo se il pannello ha **già** utenti: lì il codice da solo non basta.
 *
 * Dopo l'abbinamento la finestra mostra il riepilogo del pannello, con
 * «Rinomina» e «Connetti».
 */
export function AbbinaPannelloCloud({ onAbbinato }: { onAbbinato: (url: string) => void }) {
  const { t } = useTranslation();
  const [cloud, setCloud] = useState(false);
  const [codice, setCodice] = useState("");
  const [nome, setNome] = useState("");
  const [chiedeCredenziali, setChiedeCredenziali] = useState(false);
  const [utente, setUtente] = useState("");
  const [password, setPassword] = useState("");
  const [errore, setErrore] = useState<string | null>(null);
  const [inCorso, setInCorso] = useState(false);
  const [abbinato, setAbbinato] = useState<PannelloCloud | null>(null);

  useEffect(() => {
    let vivo = true;
    api.remoteCloud().then((r) => { if (vivo) setCloud(!!r.cloud); }).catch(() => {});
    return () => { vivo = false; };
  }, []);
  if (!cloud) return null;

  const pronto = codice.trim().length >= 16 && (!chiedeCredenziali || (utente.trim() !== "" && password !== ""));

  const riepilogo = async (n: string) => {
    try { setAbbinato(await api.pannelloCloud(n)); }
    catch { setAbbinato({ nome: n, url: "", collegato: false }); }
  };

  const abbina = async () => {
    if (!pronto || inCorso) return;
    setInCorso(true);
    setErrore(null);
    try {
      const r = await api.abbinaPannelloCloud(
        codice.trim(), nome.trim() || undefined,
        chiedeCredenziali ? utente.trim() : undefined, chiedeCredenziali ? password : undefined,
      );
      setCodice(""); setPassword("");
      if (r.url) onAbbinato(r.url);
      await riepilogo(r.nome);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("credenziali_admin") || msg.includes("servono utente e password")) setChiedeCredenziali(true);
      setErrore(dettaglio(msg));
    } finally {
      setInCorso(false);
    }
  };

  return (
    <section data-testid="abbina-pannello-cloud">
      <div style={TITOLO}>{t("abbinamento.cloudTitolo")}</div>
      {abbinato ? (
        <Riepilogo p={abbinato} onRinominato={(n, url) => { void riepilogo(n); if (url) onAbbinato(url); }}
          onConnetti={() => abbinato.url && onAbbinato(abbinato.url)}
          onAltro={() => { setAbbinato(null); setNome(""); setErrore(null); setChiedeCredenziali(false); }} />
      ) : (
        <>
          <p style={NOTA}>{t("abbinamento.cloudSpiegazione")}</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <input style={{ ...INPUT, fontFamily: "ui-monospace, monospace", letterSpacing: 1 }} placeholder="XXXX-XXXX-XXXX-XXXX"
              value={codice} spellCheck={false} onChange={(e) => setCodice(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && abbina()} />
            <input style={INPUT} placeholder={t("abbinamento.cloudNome")} value={nome} onChange={(e) => setNome(e.target.value)} />
            {chiedeCredenziali && (
              <>
                <span style={NOTA}>{t("abbinamento.cloudCredenzialiEsistenti")}</span>
                <div style={{ display: "flex", gap: 6 }}>
                  <input style={{ ...INPUT, flex: 1 }} placeholder={t("abbinamento.utente")} value={utente}
                    onChange={(e) => setUtente(e.target.value)} autoComplete="off" />
                  <input style={{ ...INPUT, flex: 1 }} type="password" placeholder={t("abbinamento.passwordSemplice")} value={password}
                    onChange={(e) => setPassword(e.target.value)} autoComplete="off"
                    onKeyDown={(e) => e.key === "Enter" && abbina()} />
                </div>
              </>
            )}
            <span style={NOTA}>{t("abbinamento.cloudUtentiDalProgetto")}</span>
            <div>
              <button onClick={abbina} disabled={!pronto || inCorso} style={bottone(pronto && !inCorso)}>
                {inCorso ? t("abbinamento.creazione") : t("abbinamento.cloudAbbina")}
              </button>
            </div>
            {errore && <div style={{ fontSize: 12, lineHeight: 1.4, color: "var(--brand-danger-soft, #fca5a5)" }}>{errore}</div>}
          </div>
        </>
      )}
    </section>
  );
}

/** Il pannello appena abbinato: chi è, e cosa si può fare subito. */
function Riepilogo({ p, onRinominato, onConnetti, onAltro }: {
  p: PannelloCloud;
  onRinominato: (nome: string, url?: string) => void;
  onConnetti: () => void;
  onAltro: () => void;
}) {
  const { t } = useTranslation();
  const [nuovo, setNuovo] = useState(p.nome);
  const [esito, setEsito] = useState<string | null>(null);
  const [inCorso, setInCorso] = useState(false);
  useEffect(() => { setNuovo(p.nome); }, [p.nome]);

  const rinomina = async () => {
    if (!nuovo.trim() || nuovo.trim() === p.nome || inCorso) return;
    setInCorso(true); setEsito(null);
    try {
      const r = await api.rinominaPannelloCloud(p.nome, nuovo.trim());
      setEsito(t("abbinamento.rinominato", { nome: r.nome }));
      onRinominato(r.nome, p.url ? p.url.replace(/\/dev\/[^/]+$/, `/dev/${r.nome}`) : undefined);
    } catch (e: unknown) {
      setEsito(dettaglio(e instanceof Error ? e.message : String(e)));
    } finally {
      setInCorso(false);
    }
  };

  const riga = (etichetta: string, valore: React.ReactNode) => (
    <div style={{ display: "flex", gap: 8, fontSize: 12, padding: "2px 0" }}>
      <span style={{ width: 130, color: "var(--brand-text-subtle, #94a3b8)" }}>{etichetta}</span>
      <span style={{ flex: 1 }}>{valore ?? "—"}</span>
    </div>
  );

  return (
    <div data-testid="riepilogo-pannello" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ fontSize: 13, color: "#86efac" }}>✓ {t("abbinamento.cloudFatto", { nome: p.nome })}</div>
      {riga(t("abbinamento.rNome"), <code>{p.nome}</code>)}
      {riga(t("abbinamento.rCollegato"), p.collegato ? t("abbinamento.si") : t("abbinamento.no"))}
      {riga(t("abbinamento.rHostname"), p.hostname)}
      {riga(t("abbinamento.rVersione"), p.versione ? `${p.versione}${p.arch ? ` · ${p.arch}` : ""}` : null)}
      {riga(t("abbinamento.rProgetto"), p.progetto)}
      {p.senza_utenti && <div style={NOTA}>{t("abbinamento.rSenzaUtenti")}</div>}
      <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 4 }}>
        <input style={{ ...INPUT, flex: 1 }} value={nuovo} onChange={(e) => setNuovo(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && rinomina()} aria-label={t("abbinamento.rinomina")} />
        <button onClick={rinomina} disabled={inCorso || !nuovo.trim() || nuovo.trim() === p.nome}
          style={bottone(!inCorso && !!nuovo.trim() && nuovo.trim() !== p.nome)}>{t("abbinamento.rinomina")}</button>
      </div>
      {esito && <div style={NOTA}>{esito}</div>}
      <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
        <button onClick={onConnetti} disabled={!p.url} style={bottone(!!p.url)}>{t("abbinamento.vaiConnetti")}</button>
        <button onClick={onAltro} style={bottone(true, true)}>{t("abbinamento.abbinaAltro")}</button>
      </div>
    </div>
  );
}

/** Il `detail` del gateway, se l'errore lo porta: è la frase scritta per chi
 *  legge («nessun pannello in attesa con questo codice…»). */
function dettaglio(msg: string): string {
  const i = msg.indexOf("{");
  if (i >= 0) {
    try { const d = JSON.parse(msg.slice(i)).detail; if (typeof d === "string") return d; } catch { /* non JSON */ }
  }
  return msg;
}

const TITOLO: React.CSSProperties = {
  fontSize: 13, fontWeight: 600, color: "var(--brand-text-muted, #94a3b8)", marginBottom: 8,
  textTransform: "uppercase", letterSpacing: 1,
};
const NOTA: React.CSSProperties = { fontSize: 11, color: "var(--brand-text-subtle, #94a3b8)", margin: 0, lineHeight: 1.5 };
const INPUT: React.CSSProperties = {
  background: "var(--brand-bg, #0f172a)",
  border: "1px solid var(--brand-surface-2, #334155)",
  borderRadius: 4,
  padding: "6px 10px",
  color: "var(--brand-text, #e2e8f0)",
  fontSize: 13,
  boxSizing: "border-box",
};
function bottone(attivo: boolean, secondario = false): React.CSSProperties {
  return {
    padding: "5px 14px", borderRadius: 4, fontSize: 12, cursor: attivo ? "pointer" : "default",
    border: secondario ? "1px solid var(--brand-surface-2, #334155)" : "none",
    background: secondario ? "transparent" : attivo ? "var(--brand-primary, #3b82f6)" : "var(--brand-surface-2, #334155)",
    color: secondario ? "var(--brand-text-muted, #94a3b8)" : attivo ? "var(--brand-on-primary, #fff)" : "var(--brand-text-subtle, #64748b)",
  };
}
