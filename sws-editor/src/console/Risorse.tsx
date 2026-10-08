import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, type RisorseConsole } from "@/api/client";
import { avviso, errore as stileErrore, scheda, titoletto } from "./stile";

/**
 * Il sinottico delle risorse: la prima pagina della console.
 *
 * Richiesta del maintainer, 08-10-2026: «un sinottico dove poter visualizzare
 * in un colpo d'occhio unico tutte le risorse disponibili e quante sono al
 * limite». L'amministratore di piattaforma vede una riga per azienda, quello
 * d'azienda vede solo la sua — stessa schermata, contenuto confinato dal
 * server.
 *
 * **Lo spazio si spacca in progetti e storico** (decisione del maintainer):
 * chi arriva al limite ci arriva quasi sempre per lo storico, che cresce da
 * solo nel tempo mentre i sinottici no. Dire «sei pieno» senza dire di cosa
 * non aiuta a decidere cosa cancellare.
 */
const SOGLIA_AVVISO = 0.85;

function byte(n: number): string {
  if (n < 1024) return `${n} B`;
  const u = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i += 1; }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${u[i]}`;
}

/** La barra. `max` nullo = nessun tetto: si mostra il numero e **non** la
 *  barra, perché una barra senza fondo scala suggerisce una quota che non
 *  c'è. */
function Barra({ parti, max }: { parti: { quota: number; colore: string }[]; max: number }) {
  return (
    <div style={{
      height: 8, borderRadius: 4, overflow: "hidden", display: "flex",
      background: "var(--brand-bg, #0f172a)", border: "1px solid var(--brand-surface-2, #334155)",
    }}>
      {parti.map((p, i) => (
        <div key={i} style={{ width: `${Math.min(100, (p.quota / max) * 100)}%`, background: p.colore }} />
      ))}
    </div>
  );
}

export function Risorse() {
  const { t, i18n } = useTranslation();
  const [dati, setDati] = useState<RisorseConsole | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const leggi = () =>
      api.amministrazioneRisorse().then(setDati).catch((e: unknown) =>
        setErr(e instanceof Error ? e.message : String(e)),
      );
    void leggi();
    // La misura lato server vale un minuto: ricontrollare più spesso
    // servirebbe solo a rileggere lo stesso numero.
    const h = setInterval(() => void leggi(), 60_000);
    return () => clearInterval(h);
  }, []);

  if (err) return <div style={stileErrore}>{err}</div>;
  if (!dati) return <div style={{ color: "var(--brand-text-subtle, #64748b)", fontSize: 13 }}>{t("console.risorse.attendi")}</div>;

  const quando = new Date(dati.misurato_ms).toLocaleTimeString(i18n.language);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {dati.aziende.map((a) => {
        const usato = a.progetti_byte + a.storico_byte;
        const quota = a.max_byte ?? null;
        const frazione = quota ? usato / quota : 0;
        const vicino = quota !== null && frazione >= SOGLIA_AVVISO;
        return (
          <div key={a.id} style={scheda}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 10 }}>
              <strong style={{ fontSize: 15 }}>
                {a.implicita ? t("console.persone.questaInstallazione") : a.nome}
              </strong>
              {vicino && (
                <span style={{ fontSize: 11, color: "var(--brand-warning-soft, #fbbf24)" }}>
                  ⚠ {frazione >= 1 ? t("console.risorse.esaurito") : t("console.risorse.quasiEsaurito")}
                </span>
              )}
            </div>

            <label style={titoletto}>{t("console.risorse.spazio")}</label>
            {quota !== null ? (
              <>
                <Barra
                  max={quota}
                  parti={[
                    { quota: a.progetti_byte, colore: "var(--brand-primary, #3b82f6)" },
                    { quota: a.storico_byte, colore: frazione >= SOGLIA_AVVISO ? "var(--brand-warning, #f59e0b)" : "#64748b" },
                  ]}
                />
                <div style={{ fontSize: 12, marginTop: 5, color: "var(--brand-text-muted, #94a3b8)" }}>
                  {byte(usato)} / {byte(quota)}
                </div>
              </>
            ) : (
              <div style={{ fontSize: 12, color: "var(--brand-text-muted, #94a3b8)" }}>
                {byte(usato)} — {t("console.risorse.senzaTetto")}
              </div>
            )}
            {/* Le due voci separate: è ciò che dice COSA cancellare. */}
            <div style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", marginTop: 4, display: "flex", gap: 14 }}>
              <span>■ {t("console.risorse.progetti")} {byte(a.progetti_byte)}</span>
              <span>■ {t("console.risorse.storico")} {byte(a.storico_byte)}</span>
            </div>

            <div style={{ marginTop: 12 }}>
              <label style={titoletto}>{t("console.risorse.progettiAperti")}</label>
              <div style={{ fontSize: 13 }}>
                {dati.progetti_aperti_ora} / {a.max_progetti_aperti ?? "—"}
              </div>
              {!dati.progetti_aperti_si_applicano && (
                <div style={{ ...avviso, marginTop: 6 }}>{t("console.risorse.tettoNonApplicato")}</div>
              )}
            </div>
          </div>
        );
      })}

      {dati.macchina && (
        <div style={scheda}>
          <label style={titoletto}>{t("console.risorse.macchina")}</label>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginTop: 6 }}>
            <div>
              <div style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)" }}>{t("console.risorse.disco")}</div>
              <div style={{ fontSize: 13 }}>
                {byte(dati.macchina.disco_totale_byte - dati.macchina.disco_libero_byte)} / {byte(dati.macchina.disco_totale_byte)}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)" }}>{t("console.risorse.ram")}</div>
              <div style={{ fontSize: 13 }}>{byte(dati.macchina.ram_usata_byte)} / {byte(dati.macchina.ram_totale_byte)}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)" }}>{t("console.risorse.cpu")}</div>
              <div style={{ fontSize: 13 }}>{Math.round(dati.macchina.cpu_percento)}%</div>
            </div>
          </div>
        </div>
      )}

      {/* Il momento della misura, accanto ai numeri: sommare un albero di
          cartelle costa, quindi si misura una volta al minuto — e un dato
          vecchio che si dichiara vecchio è utile, uno che finge di essere
          fresco no. */}
      <div style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)" }}>
        {t("console.risorse.misurato", { ora: quando })}
      </div>
    </div>
  );
}
