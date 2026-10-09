import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/api/client";
import { useAppStore } from "@/store";
import { identitaPagina, paginaVecchia } from "@/versione";

/**
 * La barra sopra l'elenco dei progetti: chi sei, per conto di chi, e cosa
 * puoi fare da qui.
 *
 * **Perché esiste.** Dopo il login la schermata mostrava un elenco di
 * progetti e nient'altro: nessun nome, nessuna azienda, nessun modo di
 * uscire, e la console di amministrazione si raggiungeva **solo** digitando
 * `/index-console.html` a mano. Richiesta del maintainer del 07-10-2026:
 * «quello che mi aspetto è che dopo il login compaia una console di selezione
 * dei progetti e una barra che mi dia le informazioni base tipo chi sono e
 * cosa ci faccio la».
 *
 * Sta **solo** qui, non dentro l'editor: a progetto aperto lo spazio
 * verticale è del canvas (scelta del maintainer fra le tre proposte).
 *
 * L'azienda si nomina solo quando c'è davvero qualcosa da nominare: chi sta
 * nella sola azienda implicita non deve incontrare un concetto che per lui
 * non esiste — è la stessa regola dei titoli di gruppo nell'elenco.
 */
export function BarraIdentita({
  onCambiaPassword,
  dove = "ide",
}: {
  onCambiaPassword: () => void;
  /** Dove sta la barra. Una sola barra per due posti: nell'IDE offre la
   *  console, nella console offre il ritorno all'IDE. Due componenti
   *  sarebbero due «Esci» da tenere d'accordo. */
  dove?: "ide" | "console";
}) {
  const { t } = useTranslation();
  const authUser = useAppStore((s) => s.authUser);
  const clearAuth = useAppStore((s) => s.clearAuth);
  const [amministratore, setAmministratore] = useState(false);
  const [aziende, setAziende] = useState<{ nome: string; implicita: boolean; ruolo?: string }[]>([]);
  // La firma della build, in fondo al menu. Non una schermata «info»: la
  // domanda «quello che vedo e aggiornato?» viene mentre si lavora, e la
  // risposta deve stare dove si e gia cliccato.
  const [sistema, setSistema] = useState<import("@/api/client").SystemStatus | null>(null);
  const [aperto, setAperto] = useState(false);
  const box = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    api
      .whoami()
      .then((me) => setAmministratore(me.amministratore_piattaforma === true))
      .catch(() => setAmministratore(false));
    api.mieAziende().then(setAziende).catch(() => setAziende([]));
    api.getSystemStatus().then(setSistema).catch(() => setSistema(null));
  }, []);

  // Un menu che non si chiude cliccando fuori resta aperto sopra il contenuto
  // e sembra rotto.
  useEffect(() => {
    if (!aperto) return;
    const fuori = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setAperto(false);
    };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setAperto(false); };
    document.addEventListener("mousedown", fuori);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", fuori);
      document.removeEventListener("keydown", esc);
    };
  }, [aperto]);

  // Chi amministra almeno un'azienda entra in console quanto chi amministra
  // la piattaforma: il ruolo lo porta gia `mie-aziende`, non serve chiederlo
  // di nuovo.
  const amministraUnAzienda = aziende.some((a) => a.ruolo === "amministratore");
  const pagina = identitaPagina();
  const vecchia = paginaVecchia(sistema);
  const proprie = aziende.filter((a) => !a.implicita);
  const etichettaAzienda =
    proprie.length === 0
      ? null
      : proprie.length <= 2
        ? proprie.map((a) => a.nome).join(" · ")
        : t("welcome.barraNAziende", { n: proprie.length });

  const esci = () => {
    void api.logout().catch(() => {});
    clearAuth();
  };

  const voce: React.CSSProperties = {
    display: "block", width: "100%", textAlign: "left",
    background: "transparent", border: "none",
    color: "var(--brand-text, #e2e8f0)", fontSize: 13,
    padding: "9px 14px", cursor: "pointer", whiteSpace: "nowrap",
  };

  return (
    <div
      style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        gap: 12, padding: "0 20px 0 20px", height: 44,
        borderBottom: "1px solid var(--brand-surface-2, #334155)",
        background: "var(--brand-surface, #1e293b)",
        // La barra sta in cima alla finestra, non dentro la colonna centrata
        // dell'elenco: il contenitore ha `padding: 32px 0`, quindi si risale
        // di altrettanto invece di cambiare il padding e muovere tutto.
        // Nella WelcomeScreen la barra sta dentro un contenitore con
        // `padding: 32px 0` e deve risalirlo; nella console sta in cima a una
        // colonna e non deve muoversi.
        margin: dove === "console" ? 0 : "-32px 0 28px",
        position: dove === "console" ? "static" : "sticky",
        top: dove === "console" ? undefined : -32,
        zIndex: 5,
        // Il contenitore e una colonna flex con `align-items: center`: senza
        // `stretch` la barra sarebbe larga quanto il suo contenuto e centrata.
        alignSelf: "stretch", flexShrink: 0, boxSizing: "border-box",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
        <span style={{ fontWeight: 700, letterSpacing: 1.5, fontSize: 14 }}>SWS</span>
      </div>

      <div ref={box} style={{ position: "relative" }}>
        <button
          onClick={() => setAperto((v) => !v)}
          style={{
            display: "flex", alignItems: "center", gap: 8,
            background: "transparent", border: "none", cursor: "pointer",
            color: "var(--brand-text-2, #cbd5e1)", fontSize: 13, padding: "6px 4px",
            maxWidth: "60vw", overflow: "hidden",
          }}
          title={t("welcome.barraMenu")}
        >
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {authUser ?? "—"}
            {etichettaAzienda && (
              <span style={{ color: "var(--brand-text-subtle, #64748b)" }}> · {etichettaAzienda}</span>
            )}
          </span>
          <span style={{ fontSize: 10, color: "var(--brand-text-subtle, #64748b)" }}>▾</span>
        </button>

        {aperto && (
          <div
            style={{
              position: "absolute", right: 0, top: "100%", marginTop: 4, minWidth: 220,
              background: "var(--brand-surface, #1e293b)",
              border: "1px solid var(--brand-surface-2, #334155)",
              borderRadius: 6, padding: "4px 0", zIndex: 10,
              boxShadow: "0 8px 24px #0008",
            }}
          >
            {/* Solo a chi la console serve davvero: a un utente normale
                l'indirizzo risponderebbe 403, e un comando che non può
                riuscire non si offre.
                **Non basta l'amministratore di piattaforma**: dal 08-10-2026
                nella console entra anche chi amministra un'azienda, e a lui
                il link non compariva — segnalato dal maintainer entrando
                come amministratore di una sola azienda. */}
            {dove === "ide" && (amministratore || amministraUnAzienda) && (
              <button
                style={voce}
                onClick={() => { window.location.href = "/index-console.html"; }}
              >
                {t("welcome.barraConsole")}
              </button>
            )}
            {/* E la via del ritorno, che dalla console non c'era: si entrava
                e l'unico modo di uscirne era riscrivere l'indirizzo. */}
            {dove === "console" && (
              <button
                style={voce}
                onClick={() => { window.location.href = "/index-admin.html"; }}
              >
                {t("welcome.barraIde")}
              </button>
            )}
            <button style={voce} onClick={() => { setAperto(false); onCambiaPassword(); }}>
              {t("welcome.barraCambiaPassword")}
            </button>
            <div style={{ height: 1, background: "var(--brand-surface-2, #334155)", margin: "4px 0" }} />
            <button style={{ ...voce, color: "var(--brand-danger-soft, #fca5a5)" }} onClick={esci}>
              {t("welcome.barraEsci")}
            </button>
            <div style={{ height: 1, background: "var(--brand-surface-2, #334155)", margin: "4px 0" }} />
            {/* La firma, in fondo e in piccolo: si legge quando la si cerca e
                non disturba quando non serve. L'avviso invece si vede. */}
            <div
              style={{
                padding: "6px 14px 4px", fontSize: 11, lineHeight: 1.5,
                color: vecchia ? "var(--brand-warning-soft, #fbbf24)" : "var(--brand-text-subtle, #64748b)",
              }}
              title={t("welcome.barraBuildTitolo")}
            >
              {vecchia && <div style={{ marginBottom: 3 }}>⚠ {t("welcome.barraPaginaVecchia")}</div>}
              {pagina.versione} · {pagina.git}
              {pagina.costruitoMs !== null && ` · ${new Date(pagina.costruitoMs).toLocaleString()}`}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
