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
/**
 * Lo stato modificabile di un'azienda, prima che venga scritto.
 *
 * Le risorse — spazio e progetti aperti — sono cio che l'azienda ha
 * *concordato*: scriverle per sbaglio passando su un campo e peggio che
 * scriverle tardi.
 */
type Bozza = {
  nome: string;
  stato: string;
  marchio: string;
  versione_predefinita: string;
  /** In GB, l'unita in cui si tratta con un cliente. Vuoto = nessun limite. */
  spazio_gb: string;
  progetti_aperti: string;
};

const GB = 1_073_741_824;

function bozzaDa(a: Azienda): Bozza {
  return {
    nome: a.nome,
    stato: a.stato,
    marchio: a.marchio ?? "",
    versione_predefinita: a.versione_predefinita ?? "",
    spazio_gb: a.max_byte !== null ? String(a.max_byte / GB) : "",
    progetti_aperti: a.max_progetti_aperti !== null ? String(a.max_progetti_aperti) : "",
  };
}

/** `piattaforma` decide cosa e **modificabile**, non cosa si vede: stato,
 *  marchio, versione e quote le decide la piattaforma, e a chi amministra
 *  un'azienda si mostrano spente. Prima erano modificabili e il salvataggio
 *  rispondeva 403: un comando che non puo riuscire non si offre — segnalato
 *  dal maintainer l'08-10-2026, con il 403 in mano. */
export function Aziende({ piattaforma = true }: { piattaforma?: boolean }) {
  const { t } = useTranslation();
  const [aziende, setAziende] = useState<Azienda[]>([]);
  const [marchi, setMarchi] = useState<Marchio[]>([]);
  const [sceltaId, setSceltaId] = useState<number | null>(null);
  const [nuova, setNuova] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [inCorso, setInCorso] = useState(false);
  // Tutto dietro il «Salva», come il pannello delle persone: un comando che
  // si applica da solo appena lo tocchi, senza conferma ne riscontro, sembra
  // non essere avvenuto. Era l'ultima pagina della console a fare altrimenti
  // — segnalato dal maintainer l'08-10-2026, che il pulsante lo cercava.
  const [bozza, setBozza] = useState<Bozza | null>(null);
  const [salvando, setSalvando] = useState(false);

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

  // La bozza segue la selezione, e si rigenera quando l'elenco viene riletto
  // dal server dopo un salvataggio riuscito.
  useEffect(() => {
    setBozza(scelta ? bozzaDa(scelta) : null);
  }, [scelta]);

  const originale = scelta ? bozzaDa(scelta) : null;
  const sporca =
    !!bozza && !!originale && JSON.stringify(bozza) !== JSON.stringify(originale);

  /** Cambiare azienda con modifiche non salvate le butterebbe via in silenzio. */
  const scegli = (id: number) => {
    if (id === sceltaId) return;
    if (sporca && !window.confirm(t("console.aziende.abbandona"))) return;
    setSceltaId(id);
  };

  // Campo assente = non toccare, `null` = svuota. La distinzione vive nel
  // corpo JSON e la regge `doppia_opzione` nel Rust: qui si manda tutto
  // quello che il pannello mostra, perche e tutto quello che si e potuto
  // cambiare.
  const salva = async () => {
    if (!scelta || !bozza || salvando) return;
    setErr(null);
    setSalvando(true);
    try {
      const gb = bozza.spazio_gb.trim();
      const pa = bozza.progetti_aperti.trim();
      // Chi amministra un'azienda manda solo cio che puo cambiare: mandare
      // anche il resto, pur senza averlo toccato, prenderebbe un 403 — il
      // server guarda i campi presenti, non quelli cambiati.
      await api.amministrazioneModificaAzienda(scelta.id, {
        ...(scelta.implicita ? {} : { nome: bozza.nome }),
        ...(piattaforma
          ? {
              stato: bozza.stato,
              marchio: bozza.marchio || null,
              versione_predefinita: bozza.versione_predefinita || null,
              max_byte: gb === "" ? null : Math.round(Number(gb) * GB),
              max_progetti_aperti: pa === "" ? null : Math.round(Number(pa)),
            }
          : {}),
      });
      await ricarica();
    } catch (e: unknown) {
      // Qui arriva anche il rifiuto «il marchio e gia di un'altra azienda»:
      // va mostrato parola per parola, perche spiega da solo cosa fare.
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Creare un'azienda e l'atto con cui la piattaforma accetta un cliente
          nuovo: a chi ne amministra una il modulo non compare. */}
      {piattaforma && (
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
      )}

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
            <div key={a.id} style={rigaElenco(a.id === sceltaId)} onClick={() => scegli(a.id)}>
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

        {scelta && bozza && (
          <div style={scheda}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 14 }}>
              <div style={{ fontSize: 15, fontWeight: 600 }}>{scelta.nome}</div>
              {sporca && (
                <span style={{ fontSize: 11, color: "var(--brand-warning-soft, #fbbf24)" }}>
                  ● {t("console.aziende.nonSalvate")}
                </span>
              )}
            </div>

            {!scelta.implicita && (
              <div style={riga}>
                <label style={titoletto}>{t("console.aziende.nome")}</label>
                <input
                  value={bozza.nome}
                  onChange={(e) => setBozza({ ...bozza, nome: e.target.value })}
                  style={campo}
                />
              </div>
            )}

            <div style={riga}>
              <label style={titoletto}>{t("console.aziende.stato")}</label>
              <select
                value={bozza.stato}
                disabled={!piattaforma}
                onChange={(e) => setBozza({ ...bozza, stato: e.target.value })}
                style={{ ...campo, opacity: piattaforma ? 1 : 0.6 }}
              >
                <option value="in_prova">{t("console.stato.in_prova")}</option>
                <option value="approvata">{t("console.stato.approvata")}</option>
                <option value="sospesa">{t("console.stato.sospesa")}</option>
              </select>
            </div>

            <div style={riga}>
              <label style={titoletto}>{t("console.aziende.marchio")}</label>
              <select
                value={bozza.marchio}
                disabled={!piattaforma}
                onChange={(e) => setBozza({ ...bozza, marchio: e.target.value })}
                style={{ ...campo, opacity: piattaforma ? 1 : 0.6 }}
              >
                <option value="">{t("console.aziende.marchioPredefinito")}</option>
                {/* Un marchio e di UNA sola azienda (regola del maintainer,
                    08-10-2026): quelli gia presi da un'altra non si offrono,
                    perche il server li rifiuterebbe — e un comando che non
                    puo riuscire non si offre. Chi serve a due aziende si
                    duplica con un altro nome. */}
                {marchi
                  .filter((m) =>
                    m.id === scelta.marchio ||
                    !aziende.some((a) => a.id !== scelta.id && a.marchio === m.id))
                  .map((m) => (
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
                {t("console.aziende.marchioNota")} {t("console.aziende.marchioEsclusivo")}
              </p>
            </div>

            <div style={riga}>
              <label style={titoletto}>{t("console.aziende.versione")}</label>
              <input
                value={bozza.versione_predefinita}
                disabled={!piattaforma}
                onChange={(e) => setBozza({ ...bozza, versione_predefinita: e.target.value })}
                placeholder={t("console.aziende.versionePlaceholder")}
                style={{ ...campo, opacity: piattaforma ? 1 : 0.6 }}
              />
            </div>
            <div style={avviso}>{t("console.aziende.versioneAvviso")}</div>

            {/* Le risorse concordate. Le decide la piattaforma: sono cio che
                l'azienda ha *concordato*, e una parte che rinegozia da sola
                non e un accordo (decisione del maintainer, 08-10-2026). */}
            <div style={{ ...riga, marginTop: 16 }}>
              <label style={titoletto}>{t("console.aziende.spazio")}</label>
              <input
                type="number"
                min={0}
                step="0.5"
                value={bozza.spazio_gb}
                disabled={!piattaforma}
                onChange={(e) => setBozza({ ...bozza, spazio_gb: e.target.value })}
                placeholder={t("console.aziende.senzaLimite")}
                style={{ ...campo, opacity: piattaforma ? 1 : 0.6 }}
              />
            </div>

            <div style={riga}>
              <label style={titoletto}>{t("console.aziende.progettiAperti")}</label>
              <input
                type="number"
                min={0}
                step={1}
                value={bozza.progetti_aperti}
                disabled={!piattaforma}
                onChange={(e) => setBozza({ ...bozza, progetti_aperti: e.target.value })}
                placeholder={t("console.aziende.senzaLimite")}
                style={{ ...campo, opacity: piattaforma ? 1 : 0.6 }}
              />
            </div>
            <div style={avviso}>{t("console.aziende.progettiApertiAvviso")}</div>
            {!piattaforma && (
              <div style={{ ...avviso, marginTop: 8 }}>{t("console.aziende.soloLettura")}</div>
            )}

            <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
              <button
                disabled={!sporca || salvando}
                onClick={salva}
                style={{ ...pulsante(sporca && !salvando), flex: 1 }}
              >
                {salvando ? t("console.aziende.salvataggio") : t("console.aziende.salva")}
              </button>
              <button
                disabled={!sporca || salvando}
                onClick={() => setBozza(originale)}
                style={pulsante(sporca && !salvando)}
              >
                {t("console.aziende.annulla")}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
