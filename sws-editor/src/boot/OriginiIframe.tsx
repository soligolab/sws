import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/api/client";

/** Le origini che possono mostrare il dispositivo collegato dentro un iframe
 *  (C6, 17-10-2026): diventano `frame-ancestors` nella CSP del runtime. Vuoto vuol
 *  dire «solo SWS stesso». Una per riga, `https://host:porta`, senza percorso. */
export function OriginiIframe() {
  const { t } = useTranslation();
  const [testo, setTesto] = useState<string | undefined>(undefined);
  const [msg, setMsg] = useState<{ ok: boolean; testo: string } | null>(null);
  const [inCorso, setInCorso] = useState(false);

  useEffect(() => {
    let vivo = true;
    api.remoteOriginiIframe()
      .then((r) => { if (vivo) setTesto(r.origini_iframe.join("\n")); })
      .catch(() => { if (vivo) setTesto(""); });
    return () => { vivo = false; };
  }, []);

  const salva = async () => {
    setInCorso(true);
    setMsg(null);
    try {
      const origini = (testo ?? "").split("\n").map((r) => r.trim()).filter(Boolean);
      const r = await api.remoteScriviOriginiIframe(origini);
      setTesto(r.origini_iframe.join("\n"));
      setMsg({ ok: true, testo: t("originiIframe.salvate") });
    } catch (e: any) {
      setMsg({ ok: false, testo: e?.message ?? String(e) });
    } finally {
      setInCorso(false);
    }
  };

  return (
    <section>
      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--brand-text-muted, #94a3b8)", marginBottom: 8, textTransform: "uppercase", letterSpacing: 1 }}>
        {t("originiIframe.titolo")}
      </div>
      <div style={{ fontSize: 12, color: "var(--brand-text-subtle, #64748b)", marginBottom: 6 }}>
        {t("originiIframe.spiegazione")}
      </div>
      <textarea
        data-testid="frame-origins"
        rows={3}
        value={testo ?? ""}
        disabled={testo === undefined}
        placeholder="https://casa.example:8123"
        onChange={(e) => setTesto(e.target.value)}
        style={{ width: "100%", maxWidth: 480, fontFamily: "monospace", fontSize: 12 }}
      />
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 4 }}>
        <button type="button" onClick={() => void salva()} disabled={inCorso || testo === undefined}>
          {t("originiIframe.salva")}
        </button>
        {msg && (
          <span style={{ fontSize: 12, color: msg.ok ? "var(--brand-success, #22c55e)" : "var(--brand-danger, #ef4444)" }}>
            {msg.testo}
          </span>
        )}
      </div>
    </section>
  );
}
