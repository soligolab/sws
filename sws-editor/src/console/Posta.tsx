import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/api/client";
import { avviso, campo, errore as stileErrore, pulsante, scheda, titoletto } from "@/ui/base";
import { CampiSmtp } from "./CampiSmtp";

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
 *
 * Resta della piattaforma: è quella di PIN e registrazione, e il ripiego delle
 * aziende che non hanno una posta loro (quella sta nella scheda dell'azienda,
 * 10-11-2026).
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
        {/* I campi sono gli stessi della posta dell'azienda (`CampiSmtp`,
            10-11-2026); caricare, salvare e provare restano qui. */}
        <CampiSmtp
          valore={{ ...cfg, port: String(cfg.port) }}
          onChange={(v) => setCfg({ ...v, port: Number(v.port) })}
          segnapostoMittente="SWS &lt;noreply@soligo.net&gt;"
        />
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
