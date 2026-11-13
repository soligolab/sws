import { CampoPassword } from "@/components/CampoPassword";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/api/client";
import { asksForCredentials, dettaglio } from "@/config/schede/AbbinaPannelloCloud";

type Company = { id: number; nome: string; implicita: boolean; cartella?: string };

/** The code as the panel shows it, from whatever was typed or scanned. */
export function normalizeCode(raw: string): string | null {
  const c = raw.toUpperCase().replace(/[\s-]/g, "");
  if (!/^[0-9A-Z]{16}$/.test(c)) return null;
  return c.match(/.{4}/g)!.join("-");
}

/**
 * «Abbina un pannello» with no project open (13-11-2026, plan
 * `docs/plans/2026-11-13-qr-di-abbinamento.md`): from the panel QR, with the
 * code already filled in, or from the user menu, with the code typed by hand.
 * The panel goes to one of the user's companies; any member may pair it. The
 * project comes later, with Connetti and the first deploy.
 *
 * Same steps as `AbbinaPannelloCloud` inside a project, but straight to the
 * gateway: the panel name it proposes is shown before confirming, and user and
 * password are asked only when the panel already has users.
 */
export function PairPanel({ initialCode, onClose }: { initialCode?: string; onClose: () => void }) {
  const { t } = useTranslation();
  const [code, setCode] = useState(initialCode ?? "");
  const [name, setName] = useState("");
  const [proposed, setProposed] = useState<string | null>(null);
  const [notWaiting, setNotWaiting] = useState(false);
  const [companies, setCompanies] = useState<Company[] | null>(null);
  const [company, setCompany] = useState("");
  const [askCredentials, setAskCredentials] = useState(false);
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ nome: string; azienda: string; url?: string } | null>(null);

  useEffect(() => {
    let alive = true;
    api.mieAziende()
      .then((list) => {
        if (!alive) return;
        setCompanies(list);
        if (list.length === 1) setCompany(list[0].cartella ?? "");
      })
      .catch(() => alive && setCompanies([]));
    return () => { alive = false; };
  }, []);

  const normalized = normalizeCode(code);
  useEffect(() => {
    setProposed(null);
    setNotWaiting(false);
    if (!normalized) return;
    let alive = true;
    api.waitingPanel(normalized)
      .then((r) => alive && setProposed(r.nome_proposto))
      .catch(() => alive && setNotWaiting(true));
    return () => { alive = false; };
  }, [normalized]);

  const many = (companies?.length ?? 0) > 1;
  const ready = !!normalized && !!company
    && (!askCredentials || (user.trim() !== "" && password !== ""));

  const pair = async () => {
    if (!ready || busy || !normalized) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.pairPanel({
        codice: normalized,
        nome: name.trim() || undefined,
        azienda: company,
        username: askCredentials ? user.trim() : undefined,
        password: askCredentials ? password : undefined,
      });
      setPassword("");
      setDone(r);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (asksForCredentials(msg)) setAskCredentials(true);
      setError(dettaglio(msg));
    } finally {
      setBusy(false);
    }
  };

  const companyName = (folder: string) =>
    companies?.find((c) => c.cartella === folder)?.nome ?? folder;

  return (
    <div style={VEIL} onClick={onClose}>
      <div data-testid="pair-panel" style={BOX} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontSize: 18, fontWeight: 700, color: "var(--brand-text, #e2e8f0)" }}>
          {t("abbinamento.cloudTitolo")}
        </div>

        {done ? (
          <>
            <p data-testid="pair-panel-done" style={TEXT}>
              {t("abbinamento.pairDone", { nome: done.nome, azienda: companyName(done.azienda) })}
            </p>
            {done.url && (
              <div style={{ ...TEXT, fontFamily: "ui-monospace, monospace", userSelect: "all", wordBreak: "break-all" }}>
                {done.url}
              </div>
            )}
            <p style={NOTE}>{t("abbinamento.pairNext")}</p>
          </>
        ) : (
          <>
            <p style={NOTE}>{t("abbinamento.pairExplain")}</p>
            <input
              aria-label={t("abbinamento.codiceConnetti")}
              style={{ ...INPUT, fontFamily: "ui-monospace, monospace", letterSpacing: 1, fontSize: 16 }}
              placeholder="XXXX-XXXX-XXXX-XXXX" value={code} spellCheck={false} autoCapitalize="characters"
              onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => e.key === "Enter" && pair()}
            />
            {proposed && (
              <div data-testid="pair-panel-proposed" style={TEXT}>
                {t("abbinamento.pairWaiting", { nome: proposed })}
              </div>
            )}
            {notWaiting && <div style={NOTE}>{t("abbinamento.pairNotWaiting")}</div>}
            <input style={INPUT} placeholder={t("abbinamento.cloudNome")} value={name} onChange={(e) => setName(e.target.value)} />
            {many && (
              <label style={{ ...NOTE, display: "flex", flexDirection: "column", gap: 4 }}>
                {t("abbinamento.pairCompany")}
                <select style={INPUT} value={company} onChange={(e) => setCompany(e.target.value)}>
                  <option value="">—</option>
                  {companies!.map((c) => (
                    <option key={c.id} value={c.cartella ?? ""}>{c.nome}</option>
                  ))}
                </select>
              </label>
            )}
            {companies !== null && companies.length === 0 && (
              <div style={NOTE}>{t("abbinamento.pairNoCompany")}</div>
            )}
            {askCredentials && (
              <>
                <span style={NOTE}>{t("abbinamento.cloudCredenzialiEsistenti")}</span>
                <input style={INPUT} placeholder={t("abbinamento.utente")} value={user}
                  onChange={(e) => setUser(e.target.value)} autoComplete="off" />
                <CampoPassword style={INPUT} placeholder={t("abbinamento.passwordSemplice")} value={password}
                  onChange={(e) => setPassword(e.target.value)} autoComplete="off"
                  onKeyDown={(e) => e.key === "Enter" && pair()} />
              </>
            )}
            {error && <div style={{ fontSize: 13, lineHeight: 1.4, color: "var(--brand-danger-soft, #fca5a5)" }}>{error}</div>}
          </>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
          <button style={GHOST} onClick={onClose}>{t("common.close")}</button>
          {!done && (
            <button onClick={pair} disabled={!ready || busy} style={primary(ready && !busy)}>
              {busy ? t("abbinamento.creazione") : t("abbinamento.cloudAbbina")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

const VEIL: React.CSSProperties = {
  position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 9000,
  display: "flex", alignItems: "center", justifyContent: "center",
};
// Opened from a phone more often than not: the width follows the screen.
const BOX: React.CSSProperties = {
  background: "var(--brand-bg, #0f172a)", border: "1px solid var(--brand-surface-2, #334155)",
  borderRadius: 10, padding: 20, width: 440, maxWidth: "calc(100vw - 32px)", boxSizing: "border-box",
  display: "flex", flexDirection: "column", gap: 10,
};
const TEXT: React.CSSProperties = { fontSize: 14, lineHeight: 1.5, color: "var(--brand-text, #e2e8f0)", margin: 0 };
const NOTE: React.CSSProperties = { fontSize: 13, lineHeight: 1.5, color: "var(--brand-text-muted, #94a3b8)", margin: 0 };
const INPUT: React.CSSProperties = {
  background: "var(--brand-surface, #1e293b)", border: "1px solid var(--brand-surface-2, #334155)",
  borderRadius: 6, color: "var(--brand-text, #e2e8f0)", padding: "9px 10px", fontSize: 14,
  width: "100%", boxSizing: "border-box",
};
const GHOST: React.CSSProperties = {
  background: "transparent", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 6,
  color: "var(--brand-text-2, #cbd5e1)", padding: "8px 14px", fontSize: 13, cursor: "pointer",
};
function primary(on: boolean): React.CSSProperties {
  return {
    background: on ? "var(--brand-primary, #2563eb)" : "var(--brand-surface-2, #334155)",
    border: "none", borderRadius: 6, color: "#fff", padding: "8px 16px", fontSize: 13,
    cursor: on ? "pointer" : "default", opacity: on ? 1 : 0.7,
  };
}
