/** L'avviso di versione nuova **sullo schermo del pannello** (decisioni 41 e
 *  44 del piano dell'aggiornamento, 28-09-2026).
 *
 *  ## Quando compare
 *
 *  Solo se il progetto **non ha utenti**. Senza utenti chiunque stia davanti
 *  al pannello è già Admin, quindi il pulsante non dà un potere che non
 *  avrebbe già; con utenti definiti l'aggiornamento resta il percorso
 *  dell'Admin dall'IDE, e sullo schermo non compare niente.
 *
 *  Il controllo si fa **all'avvio**, una volta (scelta del maintainer): un
 *  pannello acceso da mesi lo scopre al riavvio, e chi vuole sapere subito
 *  guarda dall'IDE, che interroga il registry quando si apre la scheda.
 *
 *  ## Le due vie d'uscita, che non sono la stessa cosa
 *
 *  «Più tardi» nasconde l'avviso fino al prossimo avvio: la versione resta
 *  nuova e lo si rivedrà. «Ignora questa versione» lo nasconde **finché non
 *  ne esce una più nuova ancora**, e quella scelta sopravvive al riavvio —
 *  altrimenti non sarebbe un ignorare, sarebbe un rimandare.
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, type StatoAggiornamento } from "@/api/client";
import { useAppStore } from "@/store";

const IGNORATA = "sws.aggiornamento.ignorata";

function versioneIgnorata(): string | null {
  try { return localStorage.getItem(IGNORATA); } catch { return null; }
}

function ignora(versione: string): void {
  try { localStorage.setItem(IGNORATA, versione); } catch { /* storage negato */ }
}

export function AvvisoAggiornamento() {
  const { t } = useTranslation();
  const progettoHaUtenti = useAppStore((s) => s.progettoHaUtenti);
  const [stato, setStato] = useState<StatoAggiornamento | null>(null);
  const [chiuso, setChiuso] = useState(false);
  const [novitaAperte, setNovitaAperte] = useState(false);
  const [inCorso, setInCorso] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);

  // Una volta sola, all'avvio, e solo dove ha senso chiedere: con utenti
  // definiti l'avviso non si mostra comunque, e la domanda al registry
  // sarebbe traffico per niente.
  useEffect(() => {
    if (progettoHaUtenti !== false) return;
    let vivo = true;
    api.statoAggiornamento()
      .then((s) => { if (vivo) setStato(s); })
      .catch(() => { /* registry irraggiungibile: nessun avviso, e nessun allarme */ });
    return () => { vivo = false; };
  }, [progettoHaUtenti]);

  const nuova = stato?.disponibile ?? null;
  if (chiuso || !nuova || progettoHaUtenti !== false) return null;
  if (versioneIgnorata() === nuova) return null;

  const avvisi = (stato?.novita ?? []).filter((n) => n.compatibilita);

  const aggiorna = async () => {
    setInCorso(true);
    setErrore(null);
    try {
      await api.avviaAggiornamento();
      // Da qui il runtime si riavvia e questa pagina cade: non c'è niente da
      // mostrare dopo, e un messaggio di successo mentirebbe sul fatto che
      // l'aggiornamento è finito.
    } catch (e) {
      setErrore(e instanceof Error ? e.message : String(e));
      setInCorso(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("aggiornamentoPannello.titolo", { a: nuova })}
      style={{
        position: "fixed", inset: 0, zIndex: 9000,
        background: "rgba(2, 6, 23, 0.72)",
        display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
      }}
    >
      <div style={{
        background: "var(--brand-surface, #1e293b)",
        border: "1px solid var(--brand-surface-2, #334155)",
        borderRadius: 8, padding: 20, maxWidth: 520, width: "100%",
        maxHeight: "80vh", overflowY: "auto",
        boxShadow: "0 10px 40px rgba(0,0,0,0.5)",
      }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: "var(--brand-text, #e2e8f0)", marginBottom: 6 }}>
          {t("aggiornamentoPannello.titolo", { a: nuova })}
        </div>
        <div style={{ fontSize: 13, color: "var(--brand-text-muted, #94a3b8)" }}>
          {t("aggiornamentoPannello.da", { da: stato?.versione ?? "?" })}
        </div>

        {/* Gli avvisi di compatibilità stanno in cima e non si nascondono:
            sono l'unica parte per cui vale la pena fermarsi. */}
        {avvisi.length > 0 && (
          <div style={{
            marginTop: 12, padding: "8px 10px", borderRadius: 4,
            background: "var(--brand-danger-bg, #450a0a)",
            border: "1px solid var(--brand-danger, #ef4444)",
          }}>
            {avvisi.map((n) => (
              <div key={n.versione} style={{ fontSize: 12, color: "var(--brand-danger-soft, #fca5a5)", whiteSpace: "pre-wrap" }}>
                ⚠ {n.compatibilita}
              </div>
            ))}
          </div>
        )}

        {(stato?.novita?.length ?? 0) > 0 && (
          <div style={{ marginTop: 12 }}>
            <button
              type="button"
              onClick={() => setNovitaAperte(!novitaAperte)}
              style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: 13, color: "var(--brand-primary, #3b82f6)" }}
            >
              {novitaAperte ? "▼" : "▶"} {t("aggiornamentoPannello.novita")}
            </button>
            {novitaAperte && (
              <div style={{ marginTop: 6, maxHeight: "32vh", overflowY: "auto" }}>
                {stato!.novita!.map((n) => (
                  <div key={n.versione} style={{ marginBottom: 8 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "var(--brand-text-2, #cbd5e1)" }}>{n.versione}</div>
                    <div style={{ fontSize: 12, color: "var(--brand-text-muted, #94a3b8)", whiteSpace: "pre-wrap" }}>{n.testo}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {errore && (
          <div style={{ marginTop: 10, fontSize: 12, color: "var(--brand-danger-soft, #f87171)" }}>{errore}</div>
        )}

        <div style={{ marginTop: 16, display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
          <button type="button" onClick={() => { ignora(nuova); setChiuso(true); }} disabled={inCorso}>
            {t("aggiornamentoPannello.ignora")}
          </button>
          <button type="button" onClick={() => setChiuso(true)} disabled={inCorso}>
            {t("aggiornamentoPannello.piuTardi")}
          </button>
          <button
            type="button"
            onClick={() => void aggiorna()}
            disabled={inCorso}
            style={{ fontWeight: 600, background: "#1d4ed8", color: "#fff", border: "1px solid var(--brand-primary-hover, #2563eb)", borderRadius: 5, padding: "6px 14px", cursor: "pointer" }}
          >
            {inCorso ? t("aggiornamentoPannello.inCorso") : t("aggiornamentoPannello.aggiorna")}
          </button>
        </div>
      </div>
    </div>
  );
}
