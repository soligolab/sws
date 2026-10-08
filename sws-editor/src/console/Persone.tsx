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
/**
 * Lo stato modificabile di un utente, prima che venga scritto.
 *
 * Esiste perche il pannello salva **tutto insieme** (scelta del maintainer,
 * 07-10-2026: «se cambio impostazioni ad un utente non trovo un tasto
 * salva»). Prima ogni comando si applicava da solo appena lo toccavi: la
 * spunta «amministratore di piattaforma» scriveva al click, la tendina delle
 * aziende pure. Un'azione senza conferma ne riscontro sembra non essere
 * avvenuta, e infatti il maintainer ha cercato due volte un pulsante che non
 * c'era.
 */
type Bozza = {
  nome: string;
  ruolo: "amministratore" | "sviluppatore";
  amministratore_piattaforma: boolean;
  attivo: boolean;
  aziende: { id: number; amministratore: boolean }[];
  /** Vuota = non reimpostare. Si applica al salvataggio come tutto il resto. */
  nuovaPassword: string;
};

function bozzaDa(u: UtenteInstallazione): Bozza {
  return {
    nome: u.nome ?? "",
    ruolo: u.ruolo === "Amministratore" ? "amministratore" : "sviluppatore",
    amministratore_piattaforma: u.amministratore_piattaforma,
    attivo: u.attivo,
    aziende: (u.aziende ?? []).map((a) => ({
      id: a.id,
      amministratore: a.ruolo === "amministratore" || a.ruolo === "Amministratore",
    })),
    nuovaPassword: "",
  };
}

export function Persone() {
  const { t } = useTranslation();
  const [utenti, setUtenti] = useState<UtenteInstallazione[]>([]);
  const [aziende, setAziende] = useState<Azienda[]>([]);
  const [sceltaId, setSceltaId] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [nuovo, setNuovo] = useState({ email: "", nome: "", password: "" });
  const [daAggiungere, setDaAggiungere] = useState("");
  const [comeAmministratore, setComeAmministratore] = useState(false);
  const [inCorso, setInCorso] = useState(false);
  // La bozza: tutto quello che il pannello mostra, modificabile in locale e
  // scritto solo al «Salva». Nessun campo si applica da solo.
  const [bozza, setBozza] = useState<Bozza | null>(null);
  const [salvando, setSalvando] = useState(false);

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

  // La bozza segue la selezione. Si rigenera quando cambia l'utente scelto o
  // quando l'elenco viene riletto dal server dopo un salvataggio riuscito.
  useEffect(() => {
    setBozza(scelta ? bozzaDa(scelta) : null);
    setDaAggiungere("");
    setComeAmministratore(false);
  }, [scelta]);

  const originale = scelta ? bozzaDa(scelta) : null;
  const sporca =
    !!bozza && !!originale && JSON.stringify(bozza) !== JSON.stringify(originale);

  /** Cambiare utente con modifiche non salvate le butterebbe via in silenzio. */
  const scegli = (id: number) => {
    if (id === sceltaId) return;
    if (sporca && !window.confirm(t("console.persone.abbandona"))) return;
    setSceltaId(id);
  };

  const salva = async () => {
    if (!scelta || !bozza || salvando) return;
    setErr(null);
    setSalvando(true);
    try {
      await api.amministrazioneModificaUtente(scelta.id, {
        nome: bozza.nome,
        ruolo: bozza.ruolo,
        amministratore_piattaforma: bozza.amministratore_piattaforma,
        attivo: bozza.attivo,
        aziende: bozza.aziende.map((a) => ({
          azienda_id: a.id,
          amministratore: a.amministratore,
        })),
        // Solo se c'e davvero: un campo vuoto non e «reimposta a vuoto».
        ...(bozza.nuovaPassword ? { nuova_password: bozza.nuovaPassword } : {}),
      });
      await ricarica();
    } catch (e: unknown) {
      // Qui arriva anche il rifiuto «e l'ultimo amministratore di
      // piattaforma»: va mostrato parola per parola, perche spiega da solo
      // cosa fare. E il salvataggio NON e avvenuto, quindi la bozza resta
      // com'e: chi legge l'errore ritrova quello che aveva scritto.
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSalvando(false);
    }
  };

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
            <div key={u.id} style={rigaElenco(u.id === sceltaId)} onClick={() => scegli(u.id)}>
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

        {scelta && bozza && (
          <div style={scheda}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 2 }}>
              <div style={{ fontSize: 15, fontWeight: 600 }}>{scelta.email}</div>
              {/* Il pallino dice che c'e qualcosa di non scritto. Senza, «Salva»
                  acceso e l'unico indizio, ed e in fondo al pannello. */}
              {sporca && (
                <span style={{ fontSize: 11, color: "var(--brand-warning-soft, #fbbf24)" }}>
                  ● {t("console.persone.nonSalvate")}
                </span>
              )}
            </div>
            <div style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", marginBottom: 14 }}>
              {t("console.persone.emailNonCambia")}
            </div>

            <div style={riga}>
              <label style={titoletto}>{t("console.persone.nome")}</label>
              <input
                value={bozza.nome}
                onChange={(e) => setBozza({ ...bozza, nome: e.target.value })}
                style={campo}
              />
            </div>

            <div style={riga}>
              <label style={titoletto}>{t("console.persone.ruolo")}</label>
              <select
                value={bozza.ruolo}
                onChange={(e) => setBozza({ ...bozza, ruolo: e.target.value as Bozza["ruolo"] })}
                style={campo}
              >
                <option value="sviluppatore">{t("console.ruolo.Sviluppatore")}</option>
                <option value="amministratore">{t("console.ruolo.Amministratore")}</option>
              </select>
            </div>

            <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, marginBottom: 4 }}>
              <input
                type="checkbox"
                checked={bozza.amministratore_piattaforma}
                onChange={(e) => setBozza({ ...bozza, amministratore_piattaforma: e.target.checked })}
              />
              {t("console.persone.piattaforma")}
            </label>
            <p style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", margin: "0 0 12px", lineHeight: 1.5 }}>
              {t("console.persone.piattaformaNota")}
            </p>

            {/* Appartenenze: si tolgono e si aggiungono nella bozza, e
                diventano vere al salvataggio. Il server riceve l'elenco
                INTERO e lo applica in una transazione. */}
            <div style={riga}>
              <label style={titoletto}>{t("console.persone.appartenenze")}</label>
              {bozza.aziende.length === 0 ? (
                <div style={{ fontSize: 12, color: "var(--brand-text-subtle, #64748b)", padding: "4px 0" }}>
                  {t("console.persone.nessunaAppartenenza")}
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {bozza.aziende.map((a) => {
                    const info = aziende.find((x) => x.id === a.id);
                    return (
                      <div
                        key={a.id}
                        style={{
                          display: "flex", alignItems: "center", gap: 8, fontSize: 13,
                          padding: "5px 8px", borderRadius: 4,
                          background: "var(--brand-bg, #0f172a)",
                        }}
                      >
                        <span>{info?.implicita ? t("console.persone.questaInstallazione") : info?.nome ?? `#${a.id}`}</span>
                        <label style={{ display: "flex", gap: 5, alignItems: "center", fontSize: 11, color: "var(--brand-text-muted, #94a3b8)" }}>
                          <input
                            type="checkbox"
                            checked={a.amministratore}
                            onChange={(e) =>
                              setBozza({
                                ...bozza,
                                aziende: bozza.aziende.map((x) =>
                                  x.id === a.id ? { ...x, amministratore: e.target.checked } : x,
                                ),
                              })
                            }
                          />
                          {t("console.ruolo.Amministratore")}
                        </label>
                        <button
                          onClick={() =>
                            setBozza({ ...bozza, aziende: bozza.aziende.filter((x) => x.id !== a.id) })
                          }
                          title={t("console.persone.togli")}
                          style={{
                            marginLeft: "auto", background: "transparent", border: "none",
                            color: "var(--brand-danger-soft, #fca5a5)", cursor: "pointer", fontSize: 13,
                          }}
                        >
                          ×
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div style={riga}>
              <label style={titoletto}>{t("console.persone.azienda")}</label>
              <div style={{ display: "flex", gap: 6 }}>
                <select
                  value={daAggiungere}
                  onChange={(e) => setDaAggiungere(e.target.value)}
                  style={campo}
                >
                  <option value="">{t("console.persone.scegliAzienda")}</option>
                  {aziende
                    .filter((a) => !bozza.aziende.some((x) => x.id === a.id))
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.implicita ? t("console.persone.questaInstallazione") : a.nome}
                      </option>
                    ))}
                </select>
                <button
                  disabled={!daAggiungere}
                  onClick={() => {
                    const id = Number(daAggiungere);
                    if (!id) return;
                    setBozza({
                      ...bozza,
                      aziende: [...bozza.aziende, { id, amministratore: comeAmministratore }],
                    });
                    setDaAggiungere("");
                    setComeAmministratore(false);
                  }}
                  style={pulsante(!!daAggiungere)}
                >
                  {t("console.persone.aggiungi")}
                </button>
              </div>
              <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12, marginTop: 6, color: "var(--brand-text-muted, #94a3b8)" }}>
                <input
                  type="checkbox"
                  checked={comeAmministratore}
                  onChange={(e) => setComeAmministratore(e.target.checked)}
                />
                {t("console.persone.comeAmministratore")}
              </label>
            </div>

            {/* Il reset della password sta dietro il Salva come tutto il
                resto, ed e l'unico punto in cui questo modello e ambiguo: una
                password «in sospeso» non e ancora cambiata, e finche non si
                salva quella vecchia funziona. Lo dice il testo sotto, a voce
                alta, perche non lo si indovina guardando. */}
            <div style={riga}>
              <label style={titoletto}>{t("console.persone.reset")}</label>
              <input
                type="password"
                value={bozza.nuovaPassword}
                onChange={(e) => setBozza({ ...bozza, nuovaPassword: e.target.value })}
                placeholder={t("console.persone.nuovaPassword")}
                autoComplete="new-password"
                style={campo}
              />
              <p style={{ fontSize: 11, color: bozza.nuovaPassword ? "var(--brand-warning-soft, #fbbf24)" : "var(--brand-text-subtle, #64748b)", margin: "4px 0 0", lineHeight: 1.4 }}>
                {bozza.nuovaPassword ? t("console.persone.resetInSospeso") : t("console.persone.resetNota")}
              </p>
            </div>

            <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, marginBottom: 14 }}>
              <input
                type="checkbox"
                checked={!bozza.attivo}
                onChange={(e) => setBozza({ ...bozza, attivo: !e.target.checked })}
              />
              {t("console.persone.disattivato")}
            </label>

            <div style={{ display: "flex", gap: 8 }}>
              <button
                disabled={!sporca || salvando || (!!bozza.nuovaPassword && bozza.nuovaPassword.length < 8)}
                onClick={salva}
                style={{ ...pulsante(sporca && !salvando && (!bozza.nuovaPassword || bozza.nuovaPassword.length >= 8)), flex: 1 }}
              >
                {salvando ? t("console.persone.salvataggio") : t("console.persone.salva")}
              </button>
              <button
                disabled={!sporca || salvando}
                onClick={() => setBozza(originale)}
                style={pulsante(sporca && !salvando)}
              >
                {t("console.persone.annulla")}
              </button>
            </div>
            {!!bozza.nuovaPassword && bozza.nuovaPassword.length < 8 && (
              <p style={{ fontSize: 11, color: "var(--brand-danger-soft, #fca5a5)", margin: "6px 0 0" }}>
                {t("console.persone.passwordCorta")}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
