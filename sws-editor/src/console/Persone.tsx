import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, type Azienda, type UtenteInstallazione } from "@/api/client";
import {
  avviso, campo, elencoEDettaglio, errore as stileErrore,
  pulsante, riga, rigaElenco, scheda, titoletto,
} from "./stile";

/**
 * Le persone che possono aprire l'IDE.
 *
 * **Si disattiva, non si cancella.** Il registro di audit cita gli utenti per
 * nome: un id che sparisce rende illeggibile la storia di chi ha fatto cosa, e
 * quella storia è il motivo per cui il registro esiste.
 */
export function Persone() {
  const { t } = useTranslation();
  const [utenti, setUtenti] = useState<UtenteInstallazione[]>([]);
  const [aziende, setAziende] = useState<Azienda[]>([]);
  const [sceltaId, setSceltaId] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [nuovo, setNuovo] = useState({ email: "", nome: "", password: "" });
  const [inCorso, setInCorso] = useState(false);

  const ricarica = useCallback(async () => {
    try {
      const v = await api.amministrazioneUtenti();
      setUtenti(v);
      setSceltaId((a) => a ?? v[0]?.id ?? null);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void ricarica();
    api.amministrazioneAziende().then(setAziende).catch(() => setAziende([]));
  }, [ricarica]);

  const scelta = utenti.find((u) => u.id === sceltaId) ?? null;

  const crea = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nuovo.email.includes("@") || nuovo.password.length < 8 || inCorso) return;
    setErr(null);
    setInCorso(true);
    try {
      const u = await api.amministrazioneCreaUtente(nuovo);
      setNuovo({ email: "", nome: "", password: "" });
      await ricarica();
      setSceltaId(u.id);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setInCorso(false);
    }
  };

  const modifica = async (m: Record<string, unknown>) => {
    if (!scelta) return;
    setErr(null);
    try {
      await api.amministrazioneModificaUtente(scelta.id, m);
      await ricarica();
    } catch (e: unknown) {
      // Qui arriva anche il rifiuto «è l'ultimo amministratore di
      // piattaforma»: va mostrato parola per parola, perché spiega da solo
      // cosa fare.
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  const pronto = nuovo.email.includes("@") && nuovo.password.length >= 8;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <form onSubmit={crea} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <input
          value={nuovo.email}
          onChange={(e) => setNuovo({ ...nuovo, email: e.target.value })}
          placeholder={t("console.persone.email")}
          type="email"
          style={{ ...campo, maxWidth: 240 }}
        />
        <input
          value={nuovo.nome}
          onChange={(e) => setNuovo({ ...nuovo, nome: e.target.value })}
          placeholder={t("console.persone.nome")}
          style={{ ...campo, maxWidth: 180 }}
        />
        <input
          value={nuovo.password}
          onChange={(e) => setNuovo({ ...nuovo, password: e.target.value })}
          placeholder={t("console.persone.passwordIniziale")}
          type="password"
          autoComplete="new-password"
          style={{ ...campo, maxWidth: 200 }}
        />
        <button type="submit" disabled={!pronto || inCorso} style={pulsante(pronto && !inCorso)}>
          {t("console.persone.crea")}
        </button>
      </form>
      <div style={avviso}>{t("console.persone.passwordAvviso")}</div>

      {err && <div style={stileErrore}>{err}</div>}

      <div style={elencoEDettaglio}>
        <div style={{ ...scheda, padding: 0, overflow: "hidden" }}>
          {utenti.map((u) => (
            <div key={u.id} style={rigaElenco(u.id === sceltaId)} onClick={() => setSceltaId(u.id)}>
              <span style={{ opacity: u.attivo ? 1 : 0.45 }}>
                {u.email}
                {!u.attivo && (
                  <span style={{ fontSize: 11, marginLeft: 6, color: "var(--brand-text-subtle, #64748b)" }}>
                    {t("console.persone.disattivato")}
                  </span>
                )}
              </span>
              <span style={{ color: "var(--brand-text-muted, #94a3b8)" }}>{u.nome || "—"}</span>
              <span style={{ color: "var(--brand-text-muted, #94a3b8)" }}>
                {t(`console.ruolo.${u.ruolo}`)}
              </span>
              <span title={t("console.persone.piattaforma")}>
                {u.amministratore_piattaforma ? "★" : ""}
              </span>
            </div>
          ))}
        </div>

        {scelta && (
          <div style={scheda}>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 2 }}>{scelta.email}</div>
            <div style={{ fontSize: 12, color: "var(--brand-text-subtle, #64748b)", marginBottom: 14 }}>
              {scelta.nome || t("console.persone.senzaNome")}
            </div>

            <div style={riga}>
              <label style={titoletto}>{t("console.persone.azienda")}</label>
              <select
                defaultValue=""
                onChange={(e) => {
                  const id = Number(e.target.value);
                  if (id) void modifica({ azienda_id: id, amministratore: scelta.ruolo === "Amministratore" });
                }}
                style={campo}
              >
                <option value="">{t("console.persone.scegliAzienda")}</option>
                {aziende.map((a) => (
                  <option key={a.id} value={a.id}>{a.nome}</option>
                ))}
              </select>
            </div>

            <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, marginBottom: 10 }}>
              <input
                type="checkbox"
                checked={scelta.amministratore_piattaforma}
                onChange={(e) => modifica({ amministratore_piattaforma: e.target.checked })}
              />
              {t("console.persone.piattaforma")}
            </label>
            <p style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", margin: "0 0 14px", lineHeight: 1.5 }}>
              {t("console.persone.piattaformaNota")}
            </p>

            {scelta.attivo && (
              <button onClick={() => modifica({ attivo: false })} style={pulsante(true)}>
                {t("console.persone.disattiva")}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
