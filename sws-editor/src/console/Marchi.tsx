import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, type MarchioCompleto } from "@/api/client";
import {
  avviso, campo, elencoEDettaglio, errore as stileErrore,
  pulsante, riga, rigaElenco, scheda, titoletto,
} from "./stile";

/**
 * I marchi: stili grafici e predefiniti dell'IDE (decisione 45).
 *
 * **Due origini, l'utente vince.** Quelli del prodotto stanno nell'immagine e
 * non si modificano: un aggiornamento la riscrive per intero e se li
 * riporterebbe via. Modificarne uno significa crearne una versione
 * dell'installazione che lo copre — l'originale resta sotto, e cancellare la
 * copia lo fa tornare. È lo stesso schema del catalogo dei dispositivi.
 *
 * **I colori e i nomi hanno i loro campi; il resto è JSON.** I predefiniti dei
 * pannelli e dei percorsi dati sono elenchi strutturati, e dargli
 * un'interfaccia dedicata è un lavoro a sé: qui si modificano come testo, che
 * è onesto — si vede esattamente cosa si sta scrivendo — invece di un editor a
 * metà che nasconde metà dei campi.
 */
/** `piattaforma` decide se si puo **modificare**, non cosa si vede: il
 *  server l'elenco lo confina gia da se. Chi amministra un'azienda vede il
 *  suo marchio e basta, e i comandi per cambiarlo non gli compaiono — un
 *  comando che non puo riuscire non si offre. */
export function Marchi({ piattaforma = true }: { piattaforma?: boolean }) {
  const { t } = useTranslation();
  const [marchi, setMarchi] = useState<MarchioCompleto[]>([]);
  const [sceltaId, setSceltaId] = useState<string | null>(null);
  const [bozza, setBozza] = useState<Record<string, unknown> | null>(null);
  const [avanzato, setAvanzato] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [nuovo, setNuovo] = useState("");
  const fileLogo = useRef<HTMLInputElement>(null);

  const ricarica = useCallback(async () => {
    try {
      const v = await api.amministrazioneMarchi();
      setMarchi(v);
      setSceltaId((a) => a ?? v[0]?.id ?? null);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => { void ricarica(); }, [ricarica]);

  const scelto = marchi.find((m) => m.id === sceltaId) ?? null;

  // La bozza si rifà quando cambia il marchio scelto: si modifica una copia e
  // si salva su richiesta, perché qui un salvataggio a ogni tasto
  // riscriverebbe un file su disco a ogni lettera del nome.
  useEffect(() => {
    if (!scelto) { setBozza(null); return; }
    const c = { ...(scelto.contenuto as Record<string, unknown>) };
    const { colors, name, shortName, logo, favicon, id, ...resto } = c;
    setBozza({ colors: colors ?? {}, name: name ?? "", shortName: shortName ?? "", logo, favicon, id });
    setAvanzato(JSON.stringify(resto, null, 2));
  }, [scelto]);

  const salva = async () => {
    if (!scelto || !bozza) return;
    setErr(null);
    let resto: Record<string, unknown> = {};
    try {
      resto = avanzato.trim() ? JSON.parse(avanzato) : {};
    } catch (e: unknown) {
      setErr(`${t("console.marchi.jsonNonValido")} ${e instanceof Error ? e.message : ""}`);
      return;
    }
    try {
      await api.amministrazioneSalvaMarchio(scelto.id, { ...resto, ...bozza, id: scelto.id });
      await ricarica();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  const caricaLogo = async (f: File | undefined) => {
    if (!f || !scelto || !bozza) return;
    setErr(null);
    try {
      await api.amministrazioneCaricaFileMarchio(scelto.id, f.name, f);
      setBozza({ ...bozza, logo: f.name });
      // Il nome del file va anche dentro `brand.json`, altrimenti il file c'è
      // e nessuno lo guarda.
      await api.amministrazioneSalvaMarchio(scelto.id, {
        ...(scelto.contenuto as Record<string, unknown>),
        ...bozza,
        logo: f.name,
        id: scelto.id,
      });
      await ricarica();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  const crea = async (e: React.FormEvent) => {
    e.preventDefault();
    const id = nuovo.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-");
    if (!id) return;
    setErr(null);
    try {
      await api.amministrazioneSalvaMarchio(id, {
        id, name: nuovo.trim(), shortName: nuovo.trim(), colors: {},
      });
      setNuovo("");
      await ricarica();
      setSceltaId(id);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  const colori = (bozza?.colors ?? {}) as Record<string, string>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {!piattaforma && (
        <div style={avviso}>{t("console.marchi.soloLettura")}</div>
      )}
      {piattaforma && (
      <form onSubmit={crea} style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input
          value={nuovo}
          onChange={(e) => setNuovo(e.target.value)}
          placeholder={t("console.marchi.nomeNuovo")}
          style={{ ...campo, maxWidth: 300 }}
        />
        <button type="submit" disabled={!nuovo.trim()} style={pulsante(!!nuovo.trim())}>
          {t("console.marchi.crea")}
        </button>
      </form>
      )}

      {err && <div style={stileErrore}>{err}</div>}

      <div style={elencoEDettaglio}>
        <div style={{ ...scheda, padding: 0, overflow: "hidden" }}>
          {marchi.map((m) => (
            <div
              key={m.id}
              style={{ ...rigaElenco(m.id === sceltaId), gridTemplateColumns: "auto 1fr auto auto" }}
              onClick={() => setSceltaId(m.id)}
            >
              <img
                src={`/branding/${m.id}/${(m.contenuto as Record<string, string>).logo ?? "logo.svg"}`}
                alt=""
                style={{ width: 18, height: 18, objectFit: "contain" }}
                onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = "hidden"; }}
              />
              <span>{m.nome}</span>
              <span style={{ color: "var(--brand-text-subtle, #64748b)", fontSize: 11 }}>
                {m.proprio ? t("console.marchi.proprio") : t("console.marchi.delProdotto")}
              </span>
              <span style={{ color: "var(--brand-text-muted, #94a3b8)", fontSize: 11 }}>
                {m.dispositivi > 0 ? t("console.aziende.conDispositivi", { n: m.dispositivi }) : ""}
              </span>
            </div>
          ))}
        </div>

        {scelto && bozza && (
          <div style={scheda}>
            {!scelto.proprio && (
              <div style={{ ...avviso, marginBottom: 12 }}>{t("console.marchi.delProdottoAvviso")}</div>
            )}

            <div style={riga}>
              <label style={titoletto}>{t("console.marchi.nome")}</label>
              <input
                value={String(bozza.name ?? "")}
                onChange={(e) => setBozza({ ...bozza, name: e.target.value })}
                style={campo}
              />
            </div>
            <div style={riga}>
              <label style={titoletto}>{t("console.marchi.nomeBreve")}</label>
              <input
                value={String(bozza.shortName ?? "")}
                onChange={(e) => setBozza({ ...bozza, shortName: e.target.value })}
                style={campo}
              />
            </div>

            <div style={riga}>
              <label style={titoletto}>{t("console.marchi.logo")}</label>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <img
                  src={`/branding/${scelto.id}/${String(bozza.logo ?? "logo.svg")}`}
                  alt=""
                  style={{ height: 28, maxWidth: 120, objectFit: "contain" }}
                  onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = "hidden"; }}
                />
                <input
                  ref={fileLogo}
                  type="file"
                  accept=".svg,.png,.webp,.jpg,.jpeg"
                  onChange={(e) => void caricaLogo(e.target.files?.[0])}
                  style={{ fontSize: 12, color: "var(--brand-text-muted, #94a3b8)" }}
                />
              </div>
            </div>

            <div style={riga}>
              <label style={titoletto}>{t("console.marchi.colori")}</label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                {Object.entries(colori).map(([k, v]) => (
                  <label key={k} style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 11 }}>
                    <input
                      type="color"
                      value={/^#[0-9a-f]{6}$/i.test(v) ? v : "#000000"}
                      onChange={(e) => setBozza({ ...bozza, colors: { ...colori, [k]: e.target.value } })}
                      style={{ width: 28, height: 24, padding: 0, border: "none", background: "none" }}
                    />
                    <span style={{ color: "var(--brand-text-muted, #94a3b8)" }}>{k}</span>
                  </label>
                ))}
              </div>
            </div>

            <div style={riga}>
              <label style={titoletto}>{t("console.marchi.avanzato")}</label>
              <textarea
                value={avanzato}
                onChange={(e) => setAvanzato(e.target.value)}
                spellCheck={false}
                style={{ ...campo, minHeight: 140, fontFamily: "ui-monospace, monospace", fontSize: 12 }}
              />
              <p style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", margin: "4px 0 0", lineHeight: 1.4 }}>
                {t("console.marchi.avanzatoNota")}
              </p>
            </div>

            <div style={{ display: "flex", gap: 8 }}>
              {piattaforma && (
              <button onClick={salva} style={pulsante(true)}>{t("console.marchi.salva")}</button>
              )}
              {piattaforma && scelto.proprio && (
                <button
                  onClick={async () => {
                    setErr(null);
                    try {
                      await api.amministrazioneEliminaMarchio(scelto.id);
                      setSceltaId(null);
                      await ricarica();
                    } catch (e: unknown) {
                      setErr(e instanceof Error ? e.message : String(e));
                    }
                  }}
                  style={{ ...pulsante(true), background: "transparent", color: "var(--brand-danger-soft, #fca5a5)" }}
                >
                  {t("console.marchi.elimina")}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
