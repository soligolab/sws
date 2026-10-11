import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { paginaCentrata, schedaModulo } from "@/components/schermataAccesso";
import { useAppStore, type Role } from "@/store";

/**
 * Il pannello è **in attesa di abbinamento** (11-10-2026): non ha nessun
 * utente, e finché qualcuno non crea il suo amministratore non entra nessuno,
 * nemmeno in lettura (decisione CRA 4, piano
 * `docs/archive/2026-10-11-abbinamento-e-primo-accesso.md`).
 *
 * Il codice si mostra grande: è quello da inserire nell'IDE («Connetti») o nel
 * cloud. Chi sta su questa pagina è già nel posto giusto — la pagina locale è
 * il «possesso fisico» che il codice certifica — e può creare l'amministratore
 * da qui, senza ricopiarlo.
 */
export function AbbinamentoScreen({
  codice,
  nome,
  onFatto,
}: {
  codice: string;
  nome: string;
  onFatto: () => void;
}) {
  const { t } = useTranslation();
  const setAuth = useAppStore((s) => s.setAuth);
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [conferma, setConferma] = useState("");
  const [errore, setErrore] = useState<string | null>(null);
  const [inCorso, setInCorso] = useState(false);

  const passwordCorta = password.length > 0 && password.length < 8;
  const nonCombaciano = conferma.length > 0 && password !== conferma;
  const pronto = username.trim() !== "" && password.length >= 8 && password === conferma;

  const invia = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pronto || inCorso) return;
    setErrore(null);
    setInCorso(true);
    try {
      const r = await fetch("/api/abbinamento/rivendica", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ codice, username: username.trim(), password }),
      });
      const corpo = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(corpo.detail ?? `${r.status}`);
      if (corpo.token) {
        setAuth(corpo.token, corpo.username, corpo.role as Role, !!corpo.must_change_password, corpo.expires_at_ms);
      }
      onFatto();
    } catch (e: unknown) {
      setErrore(e instanceof Error ? e.message : String(e));
    } finally {
      setInCorso(false);
    }
  };

  return (
    <div style={paginaCentrata}>
      <form onSubmit={invia} style={schedaModulo(420)}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
          <strong style={{ fontSize: 20, letterSpacing: 1 }}>SWS</strong>
          <span style={{ color: "var(--brand-text-subtle, #64748b)", fontSize: 13 }}>
            {t("abbinamento.titolo", { nome })}
          </span>
        </div>

        <p style={{ fontSize: 12, color: "var(--brand-text-muted, #94a3b8)", margin: 0, lineHeight: 1.5 }}>
          {t("abbinamento.spiegazione")}
        </p>

        <div
          data-testid="codice-abbinamento"
          style={{
            fontFamily: "ui-monospace, monospace",
            fontSize: 26,
            fontWeight: 700,
            letterSpacing: 2,
            textAlign: "center",
            padding: "14px 8px",
            borderRadius: 6,
            background: "var(--brand-bg, #0f172a)",
            border: "1px solid var(--brand-surface-2, #334155)",
            userSelect: "all",
          }}
        >
          {codice}
        </div>

        <p style={{ fontSize: 12, color: "var(--brand-text-muted, #94a3b8)", margin: 0, lineHeight: 1.5 }}>
          {t("abbinamento.oppureQui")}
        </p>

        <Campo etichetta={t("abbinamento.utente")}>
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" style={input} />
        </Campo>
        <Campo etichetta={t("abbinamento.password")}>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            autoFocus
            style={input}
          />
        </Campo>
        <Campo etichetta={t("abbinamento.ripetiPassword")}>
          <input
            type="password"
            value={conferma}
            onChange={(e) => setConferma(e.target.value)}
            autoComplete="new-password"
            style={input}
          />
        </Campo>

        {(passwordCorta || nonCombaciano || errore) && (
          <div
            style={{
              color: "var(--brand-danger-soft, #fca5a5)",
              fontSize: 12,
              background: "#7f1d1d33",
              padding: "6px 10px",
              borderRadius: 4,
              lineHeight: 1.4,
            }}
          >
            {errore ?? (passwordCorta ? t("abbinamento.passwordCorta") : t("abbinamento.nonCombaciano"))}
          </div>
        )}

        <button
          type="submit"
          disabled={!pronto || inCorso}
          style={{
            background: !pronto ? "var(--brand-surface-2, #334155)" : "var(--brand-primary, #3b82f6)",
            color: !pronto ? "var(--brand-text-subtle, #64748b)" : "var(--brand-on-primary, #fff)",
            border: "none",
            borderRadius: 4,
            padding: "8px 12px",
            cursor: !pronto || inCorso ? "default" : "pointer",
            fontSize: 14,
            fontWeight: 600,
          }}
        >
          {inCorso ? t("abbinamento.creazione") : t("abbinamento.crea")}
        </button>
      </form>
    </div>
  );
}

/** Lo stato chiesto alla pagina stessa: è il pannello che la serve a contare,
 *  non quello a cui l'IDE è eventualmente collegato. */
type Stato = {
  in_attesa: boolean;
  codice: string | null;
  nome: string;
  cloud?: string | null;
  /** Abbinato al cloud ma senza utenti: aspetta il primo progetto (fetta E). */
  abbinato_cloud_senza_utenti?: boolean;
};

/** Da mostrare al posto della pagina: il codice, o «in attesa del primo
 *  progetto». `null` = la pagina normale. */
function daMostrare(s: Stato | null): Stato | null {
  if (!s || !s.in_attesa) return null;
  if (s.codice || s.abbinato_cloud_senza_utenti) return s;
  return null;
}

/** Ogni quanto la pagina col codice richiede lo stato: l'abbinamento può
 *  arrivare da fuori (dal cloud, o da «Connetti» su un altro PC). */
export const PASSO_CONTROLLO_MS = 5000;
/** Quanto resta a schermo l'avviso «abbinato» prima di proseguire da solo: un
 *  pannello appeso al muro non deve restare fermo su un pulsante. */
export const AVVISO_MS = 30000;

/**
 * Davanti a tutte le pagine (viewer, IDE, chat, log): se il pannello che le
 * serve è in attesa di abbinamento, mostra il codice al posto di qualunque
 * altra cosa. Un runtime più vecchio non ha la rotta, e allora non si ferma
 * niente.
 *
 * Mentre mostra il codice controlla lo stato ogni pochi secondi: quando il
 * pannello viene abbinato da fuori, al posto del codice compare l'avviso
 * «abbinato» (richiesta del maintainer, 11-10-2026: il codice non deve restare
 * a schermo dopo l'abbinamento), e dopo un po' si prosegue.
 */
export function CancelloAbbinamento({ children }: { children: React.ReactNode }) {
  const [stato, setStato] = useState<Stato | null | "nessuno">(null);
  const [abbinato, setAbbinato] = useState<Stato | null>(null);
  useEffect(() => {
    let vivo = true;
    fetch("/api/abbinamento")
      .then((r) => (r.ok ? r.json() : null))
      .then((s: Stato | null) => { if (vivo) setStato(daMostrare(s) ?? "nessuno"); })
      .catch(() => { if (vivo) setStato("nessuno"); });
    return () => { vivo = false; };
  }, []);

  const inAttesa = stato !== null && stato !== "nessuno";
  useEffect(() => {
    if (!inAttesa) return;
    const t = setInterval(() => {
      fetch("/api/abbinamento")
        .then((r) => (r.ok ? r.json() : null))
        .then((s: Stato | null) => {
          if (s && !s.in_attesa) { setAbbinato(s); setStato("nessuno"); }
          // Abbinato dal cloud mentre si mostrava il codice: niente più codice,
          // ora si aspetta il primo progetto.
          else if (s?.abbinato_cloud_senza_utenti) setStato((prima) => (prima !== "nessuno" && prima?.codice ? s : prima));
        })
        .catch(() => { /* runtime che riparte: si riprova al giro dopo */ });
    }, PASSO_CONTROLLO_MS);
    return () => clearInterval(t);
  }, [inAttesa]);

  if (stato === null) return null;
  if (abbinato) {
    return <AvvisoAbbinato stato={abbinato} onContinua={() => setAbbinato(null)} />;
  }
  if (stato !== "nessuno" && !stato.codice) {
    return <AttesaPrimoProgetto stato={stato} />;
  }
  if (stato !== "nessuno") {
    return <AbbinamentoScreen codice={stato.codice!} nome={stato.nome} onFatto={() => setStato("nessuno")} />;
  }
  return <>{children}</>;
}

/** Abbinato al cloud, ancora senza utenti (fetta E): nessun codice e nessun
 *  modulo — si entra solo dal cloud finché il primo progetto non porta i suoi
 *  utenti. Il controllo ogni 5 s del cancello se ne accorge da solo. */
function AttesaPrimoProgetto({ stato }: { stato: Stato }) {
  const { t } = useTranslation();
  return (
    <div style={paginaCentrata}>
      <div data-testid="attesa-primo-progetto" style={{ ...schedaModulo(440), textAlign: "center" }}>
        <div style={{ fontSize: 34, lineHeight: 1 }}>☁</div>
        <strong style={{ fontSize: 19 }}>{t("abbinamento.attesaTitolo", { nome: stato.cloud ?? stato.nome })}</strong>
        <p style={{ fontSize: 13, color: "var(--brand-text-muted, #94a3b8)", margin: 0, lineHeight: 1.5 }}>
          {t("abbinamento.attesaSpiegazione")}
        </p>
      </div>
    </div>
  );
}

/** «Pannello abbinato»: al posto del codice, finché qualcuno non tocca
 *  «Continua» o non passano {@link AVVISO_MS}. */
function AvvisoAbbinato({ stato, onContinua }: { stato: Stato; onContinua: () => void }) {
  const { t } = useTranslation();
  useEffect(() => {
    const id = setTimeout(onContinua, AVVISO_MS);
    return () => clearTimeout(id);
  }, [onContinua]);
  return (
    <div style={paginaCentrata}>
      <div data-testid="avviso-abbinato" style={{ ...schedaModulo(420), textAlign: "center" }}>
        <div style={{ fontSize: 40, lineHeight: 1 }}>✓</div>
        <strong style={{ fontSize: 20 }}>{t("abbinamento.fattoTitolo")}</strong>
        <p style={{ fontSize: 13, color: "var(--brand-text-muted, #94a3b8)", margin: 0, lineHeight: 1.5 }}>
          {stato.cloud ? t("abbinamento.fattoCloud", { nome: stato.cloud }) : t("abbinamento.fattoLocale", { nome: stato.nome })}
        </p>
        <button onClick={onContinua} style={{
          background: "var(--brand-primary, #3b82f6)", color: "var(--brand-on-primary, #fff)", border: "none",
          borderRadius: 4, padding: "8px 12px", cursor: "pointer", fontSize: 14, fontWeight: 600,
        }}>{t("abbinamento.continua")}</button>
      </div>
    </div>
  );
}

function Campo({ etichetta, children }: { etichetta: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ fontSize: 11, color: "var(--brand-text-muted, #94a3b8)", display: "block", marginBottom: 4 }}>
        {etichetta}
      </label>
      {children}
    </div>
  );
}

const input: React.CSSProperties = {
  width: "100%",
  background: "var(--brand-bg, #0f172a)",
  border: "1px solid var(--brand-surface-2, #334155)",
  borderRadius: 4,
  padding: "7px 10px",
  color: "var(--brand-text, #e2e8f0)",
  fontSize: 14,
  boxSizing: "border-box",
};
