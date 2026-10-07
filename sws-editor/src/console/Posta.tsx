import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/api/client";
import { avviso, campo, errore as stileErrore, pulsante, riga, scheda, titoletto } from "./stile";

/**
 * La posta dell'**installazione**, distinta da quella del progetto.
 *
 * Serve alle email che riguardano la piattaforma e non l'impianto: verifica
 * dell'indirizzo alla registrazione, inviti, recupero password. Vive in
 * `<config>/smtp.yaml` con permessi 0600, fuori dal progetto — quindi fuori da
 * backup, export e deploy, perché non ha niente a che fare con l'impianto.
 *
 * **La password non si rilegge**: il server manda un segnaposto, e rimandarlo
 * indietro significa «tieni quella di prima». Così si può cambiare l'indirizzo
 * del server senza ridigitare una password che non si è mai vista.
 */
export function Posta() {
  const { t } = useTranslation();
  const [cfg, setCfg] = useState({ host: "", port: 587, from: "", username: "", password: "", starttls: true });
  const [configurata, setConfigurata] = useState(false);
  const [a, setA] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [esito, setEsito] = useState<string | null>(null);

  useEffect(() => {
    api.amministrazioneSmtp()
      .then((r) => {
        setConfigurata(!!r.configurata);
        if (r.smtp) {
          setCfg({
            host: r.smtp.host ?? "", port: r.smtp.port ?? 587, from: r.smtp.from ?? "",
            username: r.smtp.username ?? "", password: r.smtp.password ?? "",
            starttls: r.smtp.starttls ?? true,
          });
        }
      })
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : String(e)));
  }, []);

  const salva = async () => {
    setErr(null); setEsito(null);
    try {
      await api.amministrazioneSalvaSmtp(cfg);
      setConfigurata(true);
      setEsito(t("console.posta.salvata"));
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  const prova = async () => {
    setErr(null); setEsito(null);
    try {
      await api.amministrazioneProvaSmtp(a);
      setEsito(t("console.posta.inviata", { a }));
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div style={{ maxWidth: 560, display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={scheda}>
        <Campo etichetta={t("console.posta.host")}>
          <input value={cfg.host} onChange={(e) => setCfg({ ...cfg, host: e.target.value })} style={campo} />
        </Campo>
        <Campo etichetta={t("console.posta.porta")}>
          <input type="number" value={cfg.port} onChange={(e) => setCfg({ ...cfg, port: Number(e.target.value) })} style={campo} />
        </Campo>
        <Campo etichetta={t("console.posta.mittente")}>
          <input value={cfg.from} onChange={(e) => setCfg({ ...cfg, from: e.target.value })} placeholder="SWS &lt;noreply@soligo.net&gt;" style={campo} />
        </Campo>
        <Campo etichetta={t("console.posta.utente")}>
          <input value={cfg.username} onChange={(e) => setCfg({ ...cfg, username: e.target.value })} autoComplete="off" style={campo} />
        </Campo>
        <Campo etichetta={t("console.posta.password")}>
          <input type="password" value={cfg.password} onChange={(e) => setCfg({ ...cfg, password: e.target.value })} autoComplete="new-password" style={campo} />
        </Campo>
        <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, marginBottom: 12 }}>
          <input type="checkbox" checked={cfg.starttls} onChange={(e) => setCfg({ ...cfg, starttls: e.target.checked })} />
          {t("console.posta.starttls")}
        </label>
        <button onClick={salva} style={pulsante(!!cfg.host && !!cfg.from)} disabled={!cfg.host || !cfg.from}>
          {t("console.posta.salva")}
        </button>
      </div>

      <div style={avviso}>{t("console.posta.ovhAvviso")}</div>

      {configurata && (
        <div style={scheda}>
          <div style={titoletto}>{t("console.posta.prova")}</div>
          <div style={{ display: "flex", gap: 8 }}>
            <input value={a} onChange={(e) => setA(e.target.value)} placeholder={t("console.posta.indirizzo")} type="email" style={campo} />
            <button onClick={prova} disabled={!a.includes("@")} style={pulsante(a.includes("@"))}>
              {t("console.posta.invia")}
            </button>
          </div>
          <p style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", margin: "6px 0 0", lineHeight: 1.4 }}>
            {t("console.posta.provaNota")}
          </p>
        </div>
      )}

      {err && <div style={stileErrore}>{err}</div>}
      {esito && <div style={{ ...avviso, color: "var(--brand-success-soft, #86efac)", background: "#14532d33" }}>{esito}</div>}
    </div>
  );
}

function Campo({ etichetta, children }: { etichetta: string; children: React.ReactNode }) {
  return (
    <div style={riga}>
      <label style={titoletto}>{etichetta}</label>
      {children}
    </div>
  );
}
