import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, type Azienda, type Marchio } from "@/api/client";
import {
  avviso, campo, coloreStato, elencoEDettaglio, errore as stileErrore,
  pulsante, riga, rigaElenco, scheda, titoletto,
} from "./stile";

/**
 * Le aziende: approvarle, dar loro un marchio, fissare la versione predefinita.
 *
 * Elenco a sinistra e dettaglio a destra (scelta del maintainer, 06-10-2026):
 * con decine di aziende si confrontano a colpo d'occhio, cosa che una scheda
 * per azienda non permette.
 *
 * **L'azienda implicita si vede ma non si amministra.** Su un'installazione
 * singola ne esiste una sola, creata da sé, e il concetto non deve comparire a
 * chi ha un impianto solo. Qui compare — questa è la console, il posto dove si
 * guarda com'è fatta la macchina — ma segnata come tale e senza il nome
 * modificabile.
 */
export function Aziende() {
  const { t } = useTranslation();
  const [aziende, setAziende] = useState<Azienda[]>([]);
  const [marchi, setMarchi] = useState<Marchio[]>([]);
  const [sceltaId, setSceltaId] = useState<number | null>(null);
  const [nuova, setNuova] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [inCorso, setInCorso] = useState(false);

  const ricarica = useCallback(async () => {
    try {
      const v = await api.amministrazioneAziende();
      setAziende(v);
      setSceltaId((attuale) => attuale ?? v[0]?.id ?? null);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void ricarica();
    api.amministrazioneMarchi().then(setMarchi).catch(() => setMarchi([]));
  }, [ricarica]);

  const scelta = aziende.find((a) => a.id === sceltaId) ?? null;

  const crea = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nuova.trim() || inCorso) return;
    setErr(null);
    setInCorso(true);
    try {
      const a = await api.amministrazioneCreaAzienda(nuova.trim());
      setNuova("");
      await ricarica();
      setSceltaId(a.id);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setInCorso(false);
    }
  };

  // Campo assente = non toccare, `null` = svuota. La distinzione vive nel
  // corpo JSON e la regge `doppia_opzione` nel Rust: qui basta non mandare
  // ciò che non si sta cambiando.
  const modifica = async (m: Record<string, unknown>) => {
    if (!scelta) return;
    setErr(null);
    try {
      await api.amministrazioneModificaAzienda(scelta.id, m);
      await ricarica();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <form onSubmit={crea} style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input
          value={nuova}
          onChange={(e) => setNuova(e.target.value)}
          placeholder={t("console.aziende.nomePlaceholder")}
          style={{ ...campo, maxWidth: 320 }}
        />
        <button type="submit" disabled={!nuova.trim() || inCorso} style={pulsante(!!nuova.trim() && !inCorso)}>
          {t("console.aziende.crea")}
        </button>
      </form>

      {err && <div style={stileErrore}>{err}</div>}

      <div style={elencoEDettaglio}>
        <div style={{ ...scheda, padding: 0, overflow: "hidden" }}>
          <div
            style={{
              ...rigaElenco(false),
              cursor: "default",
              color: "var(--brand-text-muted, #94a3b8)",
              fontSize: 11,
              textTransform: "uppercase",
              letterSpacing: 0.5,
              borderBottom: "1px solid var(--brand-surface-2, #334155)",
            }}
          >
            <span>{t("console.aziende.colonnaNome")}</span>
            <span>{t("console.aziende.colonnaStato")}</span>
            <span>{t("console.aziende.colonnaMarchio")}</span>
            <span>{t("console.aziende.colonnaVersione")}</span>
          </div>
          {aziende.map((a) => (
            <div key={a.id} style={rigaElenco(a.id === sceltaId)} onClick={() => setSceltaId(a.id)}>
              <span>
                {a.nome}
                {a.implicita && (
                  <span style={{ color: "var(--brand-text-subtle, #64748b)", fontSize: 11, marginLeft: 6 }}>
                    {t("console.aziende.implicita")}
                  </span>
                )}
              </span>
              <span style={{ color: coloreStato(a.stato) }}>{t(`console.stato.${a.stato}`)}</span>
              <span style={{ color: "var(--brand-text-muted, #94a3b8)" }}>{a.marchio ?? "—"}</span>
              <span style={{ color: "var(--brand-text-muted, #94a3b8)" }}>
                {a.versione_predefinita ?? "—"}
              </span>
            </div>
          ))}
          {aziende.length === 0 && (
            <div style={{ padding: 20, textAlign: "center", color: "var(--brand-text-subtle, #64748b)", fontSize: 13 }}>
              {t("console.aziende.nessuna")}
            </div>
          )}
        </div>

        {scelta && (
          <div style={scheda}>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 14 }}>{scelta.nome}</div>

            <div style={riga}>
              <label style={titoletto}>{t("console.aziende.stato")}</label>
              <select value={scelta.stato} onChange={(e) => modifica({ stato: e.target.value })} style={campo}>
                <option value="in_prova">{t("console.stato.in_prova")}</option>
                <option value="approvata">{t("console.stato.approvata")}</option>
                <option value="sospesa">{t("console.stato.sospesa")}</option>
              </select>
            </div>

            <div style={riga}>
              <label style={titoletto}>{t("console.aziende.marchio")}</label>
              <select
                value={scelta.marchio ?? ""}
                onChange={(e) => modifica({ marchio: e.target.value || null })}
                style={campo}
              >
                <option value="">{t("console.aziende.marchioPredefinito")}</option>
                {marchi.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.nome}
                    {m.dispositivi > 0 ? ` — ${t("console.aziende.conDispositivi", { n: m.dispositivi })}` : ""}
                  </option>
                ))}
              </select>
              {/* Un marchio non è solo aspetto: porta con sé il catalogo dei
                  pannelli (decisione 43). Dirlo qui evita la sorpresa di
                  assegnare un logo e cambiare i dispositivi disponibili. */}
              <p style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", margin: "4px 0 0", lineHeight: 1.4 }}>
                {t("console.aziende.marchioNota")}
              </p>
            </div>

            <div style={riga}>
              <label style={titoletto}>{t("console.aziende.versione")}</label>
              <input
                key={`${scelta.id}-${scelta.versione_predefinita ?? ""}`}
                defaultValue={scelta.versione_predefinita ?? ""}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v === (scelta.versione_predefinita ?? "")) return;
                  void modifica({ versione_predefinita: v || null });
                }}
                placeholder={t("console.aziende.versionePlaceholder")}
                style={campo}
              />
            </div>

            <div style={avviso}>{t("console.aziende.versioneAvviso")}</div>
          </div>
        )}
      </div>
    </div>
  );
}
