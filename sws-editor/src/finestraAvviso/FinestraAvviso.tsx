/** L'host della Finestra di avviso: mostra la prima richiesta della coda
 *  (`finestraAvviso.ts`) al centro della pagina, sopra tutto il resto.
 *
 *  Le regole decise col maintainer il 04-11-2026 (piano, «Da decidere all'inizio»):
 *  - «Annulla» a sinistra, l'azione a destra, come su LVGL;
 *  - su un'azione pericolosa il predefinito è Annulla: Invio la esegue solo se
 *    il fuoco è sul suo bottone;
 *  - il clic sul velo chiude solo un avviso o una conferma non pericolosa;
 *  - Esc annulla, Tab resta dentro la finestra, il fuoco torna a chi l'aveva.
 *
 *  I tasti premuti dentro la finestra non arrivano alle scorciatoie
 *  dell'editor (`stopPropagation`); quelli che partono da fuori — il fuoco su
 *  `body` — li ferma un ascoltatore in cattura e il fuoco torna qui. */
import { useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { finestreAperte, iscriviti, rispondiA, type Richiesta } from "./finestraAvviso";

/** Sopra le finestre dell'IDE (fino a 10000) e del viewer (9600). */
const Z = 10050;

/** Un host solo disegna, anche se ne vengono montati due (React StrictMode
 *  monta, smonta e rimonta; e una pagina non deve mostrare la finestra doppia). */
let hostAttivo: symbol | null = null;

export function FinestraAvviso() {
  const [io] = useState(() => Symbol("host"));
  const [mio, setMio] = useState(false);
  useEffect(() => {
    if (hostAttivo === null) hostAttivo = io;
    setMio(hostAttivo === io);
    return () => { if (hostAttivo === io) hostAttivo = null; };
  }, [io]);
  const aperte = useSyncExternalStore(iscriviti, finestreAperte, finestreAperte);
  if (!mio || aperte.length === 0 || typeof document === "undefined") return null;
  // Sotto, i moduli da cui discende la richiesta attiva: restano montati (dentro
  // c'è chi aspetta la risposta) ma non rispondono a niente.
  return createPortal(
    <>{aperte.map((r, i) => <Finestra key={r.id} r={r} attiva={i === aperte.length - 1} livello={i} />)}</>,
    document.body,
  );
}

const FOCALIZZABILI = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

/** Ctrl+S (⌘S): fermata qui, o il browser apre la sua finestra «Salva pagina». */
const eSalva = (e: { key: string; ctrlKey: boolean; metaKey: boolean }) =>
  (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s";

/** Invio è ancora giù? Una finestra aperta **dal** tasto Invio — il campo testo
 *  che conferma col `blur` e chiede «Cambia solo qui / dappertutto» — nasce
 *  mentre quel tasto non è finito: il fuoco va al predefinito nello stesso
 *  evento, e il `keypress` che segue lo preme. Per `scegli` il predefinito è
 *  Annulla, quindi la domanda si apriva e si chiudeva da sola e il testo tornava
 *  com'era (collaudo F2.7, 06-11-2026). Ascoltato in cattura su `window`, così
 *  vale già durante l'evento che apre la finestra. */
let invioGiu = false;
if (typeof window !== "undefined") {
  window.addEventListener("keydown", (e) => { if (e.key === "Enter") invioGiu = true; }, true);
  window.addEventListener("keyup", (e) => { if (e.key === "Enter") invioGiu = false; }, true);
  window.addEventListener("blur", () => { invioGiu = false; });
}

function valoreAnnullato(r: Richiesta): unknown {
  return r.tipo === "avviso" ? undefined : r.tipo === "conferma" ? false : null;
}

function Finestra({ r, attiva = true, livello = 0 }: { r: Richiesta; attiva?: boolean; livello?: number }) {
  const { t } = useTranslation();
  const scatola = useRef<HTMLDivElement>(null);
  const predefinito = useRef<HTMLElement | null>(null);
  const daRiprendere = useRef<Element | null>(typeof document !== "undefined" ? document.activeElement : null);
  const [testo, setTesto] = useState(r.tipo === "chiedi" ? r.iniziale ?? "" : "");
  const [errore, setErrore] = useState<string | null>(null);

  const chiudibile = r.tipo !== "modulo" || r.chiudibile !== false;
  const chiudi = (v: unknown) => rispondiA(r.id, v);
  const annulla = () => { if (chiudibile) chiudi(valoreAnnullato(r)); };
  const pericolo = r.tipo === "conferma" && !!r.pericolo;
  const veloChiude = r.tipo === "avviso" || (r.tipo === "conferma" && !r.pericolo);

  const invia = () => {
    if (r.tipo !== "chiedi") return;
    const msg = r.valida?.(testo) ?? null;
    if (msg) { setErrore(msg); return; }
    chiudi(testo);
  };

  // Il fuoco al predefinito all'apertura, e a chi l'aveva alla chiusura. «Chi
  // l'aveva» si legge al primo disegno; se non c'è più (la finestra prima nella
  // coda, appena smontata), è chi ha il fuoco adesso, cioè a chi lei l'ha reso.
  // Il ritorno aspetta la fine del commit: chiusa una conferma aperta da un
  // modulo, il modulo sotto smette di essere `inert` solo in quel commit, e su
  // un elemento `inert` il fuoco non va.
  useLayoutEffect(() => {
    const r0 = daRiprendere.current;
    const prima = r0 instanceof HTMLElement && r0.isConnected ? r0 : document.activeElement;
    const el = predefinito.current ?? scatola.current?.querySelector<HTMLElement>(FOCALIZZABILI) ?? scatola.current;
    // Aperta da Invio: il fuoco aspetta sulla scatola che il tasto si alzi
    // (vedi `invioGiu`), poi va al predefinito.
    let alRilascio: ((e: KeyboardEvent) => void) | null = null;
    if (invioGiu && el instanceof HTMLButtonElement) {
      scatola.current?.focus();
      alRilascio = (e) => {
        if (e.key !== "Enter") return;
        window.removeEventListener("keyup", alRilascio!, true);
        alRilascio = null;
        if (el.isConnected && document.activeElement === scatola.current) el.focus();
      };
      window.addEventListener("keyup", alRilascio, true);
    } else {
      el?.focus();
    }
    // Come `prompt`: il valore iniziale di `chiedi` già selezionato, così chi
    // scrive un nome nuovo lo sostituisce invece di aggiungerlo.
    if (el instanceof HTMLInputElement) el.select();
    return () => {
      if (alRilascio) window.removeEventListener("keyup", alRilascio, true);
      queueMicrotask(() => { if (prima instanceof HTMLElement && prima.isConnected) prima.focus(); });
    };
  }, []);

  // I tasti che partono fuori dalla finestra (fuoco su `body` o altrove) non
  // devono arrivare all'editor: si fermano qui e il fuoco rientra. Solo la
  // finestra attiva: un modulo sotto una conferma aspetta e basta.
  useEffect(() => {
    if (!attiva) return;
    const fuori = (e: KeyboardEvent) => {
      if (scatola.current?.contains(e.target as Node)) return;
      e.stopPropagation();
      if (eSalva(e)) e.preventDefault();
      if (e.key === "Escape") { e.preventDefault(); annulla(); return; }
      if (e.key === "Tab") e.preventDefault();
      (predefinito.current ?? scatola.current)?.focus();
    };
    window.addEventListener("keydown", fuori, true);
    return () => window.removeEventListener("keydown", fuori, true);
  });

  const tasto = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    // Le scorciatoie dell'editor non arrivano: Ctrl+S aprirebbe il «Salva pagina»
    // del browser. I campi di un modulo salvano già da soli.
    if (eSalva(e)) { e.preventDefault(); return; }
    if (e.key === "Escape") { e.preventDefault(); annulla(); return; }
    if (e.key === "Tab") {
      const els = [...(scatola.current?.querySelectorAll<HTMLElement>(FOCALIZZABILI) ?? [])];
      if (els.length === 0) { e.preventDefault(); return; }
      const i = els.indexOf(document.activeElement as HTMLElement);
      const dopo = e.shiftKey ? (i <= 0 ? els.length - 1 : i - 1) : (i === els.length - 1 ? 0 : i + 1);
      e.preventDefault();
      els[dopo].focus();
      return;
    }
    if (e.key === "Enter") {
      // L'Invio tenuto giù che ha aperto la finestra si ripete: non è una risposta.
      if (e.repeat) { e.preventDefault(); return; }
      const bersaglio = e.target as HTMLElement;
      // Un bottone col fuoco si preme da sé; in un testo a più righe Invio va a capo.
      if (bersaglio.tagName === "BUTTON" || bersaglio.tagName === "TEXTAREA") return;
      if (r.tipo === "chiedi") { e.preventDefault(); invia(); return; }
      if (r.tipo === "modulo") return;
      e.preventDefault();
      (predefinito.current as HTMLButtonElement | null)?.click();
    }
  };

  const titolo = r.titolo;
  const errorePerLivello = r.tipo === "avviso" && r.livello === "errore";

  return (
    <div data-testid={attiva ? "finestra-avviso-velo" : undefined} inert={!attiva || undefined}
      onMouseDown={(e) => { if (attiva && e.target === e.currentTarget && veloChiude) annulla(); }}
      style={{
        position: "fixed", inset: 0, zIndex: Z + livello, background: "rgba(0,0,0,0.55)",
        // Il portale sta in `body`, fuori dalla radice dell'IDE che dà il font.
        fontFamily: "system-ui, sans-serif, 'SWS Emoji'",
        display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
      }}>
      <div ref={scatola} role={pericolo || errorePerLivello ? "alertdialog" : "dialog"} aria-modal="true"
        aria-labelledby={titolo ? `finestra-avviso-titolo-${r.id}` : undefined}
        aria-describedby={r.tipo !== "modulo" && r.testo ? `finestra-avviso-testo-${r.id}` : undefined}
        data-testid={attiva ? "finestra-avviso" : "finestra-avviso-sotto"} data-tipo={r.tipo} tabIndex={-1}
        onKeyDown={attiva ? tasto : undefined}
        style={{
          background: "var(--brand-surface, #1e293b)", color: "var(--brand-text, #e2e8f0)",
          border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 10,
          boxShadow: "0 12px 40px rgba(0,0,0,0.5)", width: r.tipo === "modulo" ? "auto" : 420,
          maxWidth: "min(92vw, 720px)", maxHeight: "88vh", overflow: "auto", outline: "none",
          padding: "18px 20px", display: "flex", flexDirection: "column", gap: 12,
          borderTop: errorePerLivello || pericolo ? "3px solid var(--brand-danger, #ef4444)" : undefined,
        }}>
        {titolo && (
          <div id={`finestra-avviso-titolo-${r.id}`} style={{
            fontSize: 15, fontWeight: 700,
            color: errorePerLivello ? "var(--brand-danger-soft, #fca5a5)" : "var(--brand-text, #e2e8f0)",
          }}>{titolo}</div>
        )}
        {r.tipo !== "modulo" && r.testo && (
          <div id={`finestra-avviso-testo-${r.id}`} data-testid="finestra-avviso-testo"
            style={{ fontSize: 13, lineHeight: 1.5, whiteSpace: "pre-wrap", color: "var(--brand-text-muted, #cbd5e1)" }}>
            {r.testo}
          </div>
        )}
        {r.tipo === "chiedi" && (
          <div>
            <input data-testid="finestra-avviso-campo" type={r.password ? "password" : "text"} value={testo}
              autoComplete={r.password ? "current-password" : "off"}
              ref={(el) => { predefinito.current = el; }}
              onChange={(e) => { setTesto(e.target.value); setErrore(null); }}
              aria-invalid={errore ? true : undefined}
              style={{
                width: "100%", boxSizing: "border-box", padding: "8px 10px", fontSize: 13, borderRadius: 5,
                background: "var(--brand-bg, #0f172a)", color: "var(--brand-text, #e2e8f0)",
                border: `1px solid ${errore ? "var(--brand-danger, #ef4444)" : "var(--brand-border, #475569)"}`,
              }} />
            {errore && (
              <div role="alert" data-testid="finestra-avviso-errore"
                style={{ fontSize: 12, marginTop: 6, color: "var(--brand-danger-soft, #fca5a5)" }}>{errore}</div>
            )}
          </div>
        )}
        {r.tipo === "modulo" && r.corpo((v) => chiudi(v))}
        {r.tipo !== "modulo" && (
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
            {r.tipo !== "avviso" && (
              <Bottone testid="finestra-avviso-annulla" onClick={annulla}
                rif={pericolo || r.tipo === "scegli" ? (el) => { predefinito.current = el; } : undefined}>
                {(r.tipo === "conferma" || r.tipo === "chiedi" || r.tipo === "scegli" ? r.no : undefined) ?? t("common.cancel")}
              </Bottone>
            )}
            {r.tipo === "scegli" && r.scelte.map((s, i) => (
              <Bottone key={i} testid={`finestra-avviso-scelta-${i}`} tipo={s.pericolo ? "pericolo" : "azione-primaria"}
                onClick={() => chiudi(s.valore)}>{s.etichetta}</Bottone>
            ))}
            {r.tipo === "avviso" && (
              <Bottone testid="finestra-avviso-ok" tipo="azione-primaria" onClick={() => chiudi(undefined)}
                rif={(el) => { predefinito.current = el; }}>{r.ok ?? t("common.ok")}</Bottone>
            )}
            {r.tipo === "conferma" && (
              <Bottone testid="finestra-avviso-ok" tipo={pericolo ? "pericolo" : "azione-primaria"} onClick={() => chiudi(true)}
                rif={pericolo ? undefined : (el) => { predefinito.current = el; }}>{r.si ?? t("common.confirm")}</Bottone>
            )}
            {r.tipo === "chiedi" && (
              <Bottone testid="finestra-avviso-ok" tipo="azione-primaria" onClick={invia}>{r.ok ?? t("common.ok")}</Bottone>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function Bottone({ children, onClick, tipo = "secondario", testid, rif }: {
  children: React.ReactNode;
  onClick: () => void;
  tipo?: "azione-primaria" | "pericolo" | "secondario";
  testid?: string;
  rif?: (el: HTMLButtonElement | null) => void;
}) {
  const colori = tipo === "azione-primaria"
    ? { background: "var(--brand-primary, #3b82f6)", color: "var(--brand-on-primary, #fff)" }
    : tipo === "pericolo"
      ? { background: "var(--brand-danger, #ef4444)", color: "var(--brand-on-danger, #fff)" }
      : { background: "var(--brand-surface-2, #334155)", color: "var(--brand-text, #e2e8f0)" };
  return (
    <button type="button" data-testid={testid} ref={rif} onClick={onClick}
      style={{
        ...colori, border: "none", borderRadius: 5, padding: "8px 16px", fontSize: 13, fontWeight: 600, fontFamily: "inherit",
        cursor: "pointer", minWidth: 88,
      }}>
      {children}
    </button>
  );
}

/** Le cornici aperte, dalla prima all'ultima: solo l'ultima sente i tasti. */
let pilaCornici: symbol[] = [];
const ascoltatoriPila = new Set<() => void>();
function iscriviPila(f: () => void): () => void {
  ascoltatoriPila.add(f);
  return () => { ascoltatoriPila.delete(f); };
}
function entraNellaPila(io: symbol): () => void {
  pilaCornici = [...pilaCornici, io];
  ascoltatoriPila.forEach((f) => f());
  return () => {
    pilaCornici = pilaCornici.filter((x) => x !== io);
    ascoltatoriPila.forEach((f) => f());
  };
}

/** La stessa cornice per una finestra che vive nell'albero di chi la apre (F3,
 *  05-11-2026): il modulo di un tag nuovo, la rinomina, la password scaduta,
 *  l'avviso di aggiornamento del viewer. Prima ognuna aveva il suo velo, il
 *  suo z-index (da 50 a 10000) e i suoi tasti, e nessuna teneva il Tab dentro.
 *
 *  Non passa dalla coda perché il suo contenuto ha stato e contesto di chi la
 *  apre, e chi la apre la chiude smontandola. Sta un gradino sotto l'host della
 *  coda: una conferma chiesta da dentro le compare sopra, e finché c'è i tasti
 *  sono suoi. */
export function Cornice({ titolo, onChiudi, chiudibile = true, veloChiude = false, larghezza, z = Z - 1, sotto = false, children, testid }: {
  titolo?: React.ReactNode;
  /** Esc, il velo (se `veloChiude`) e la ✕. */
  onChiudi?: () => void;
  /** `false` per una finestra che va finita (la password scaduta). */
  chiudibile?: boolean;
  veloChiude?: boolean;
  larghezza?: number;
  /** Il viewer ha le sue soglie (login a 9600): chi ne ha bisogno la sposta. */
  z?: number;
  /** Qualcosa di non suo le sta sopra (il login del viewer): aspetta, e i
   *  tasti non sono suoi. */
  sotto?: boolean;
  children: React.ReactNode;
  testid?: string;
}) {
  const scatola = useRef<HTMLDivElement>(null);
  const idTitolo = useId();
  // Chi aveva il fuoco prima, letto al primo disegno: dopo, l'`autoFocus` di un
  // campo dentro l'ha già spostato lì (revisione di F3).
  const daRiprendere = useRef(typeof document !== "undefined" ? document.activeElement : null);
  const [io] = useState(() => Symbol("cornice"));
  useLayoutEffect(() => entraNellaPila(io), [io]);
  const inCima = useSyncExternalStore(iscriviPila, () => pilaCornici.at(-1) === io, () => true);
  const aperte = useSyncExternalStore(iscriviti, finestreAperte, finestreAperte);
  // Una richiesta della coda aperta sopra, o un'altra cornice aperta dopo (la
  // sessione scaduta sopra una rinomina): i tasti sono suoi, e questa aspetta.
  const attiva = aperte.length === 0 && !sotto && inCima;
  const chiudi = () => { if (chiudibile) onChiudi?.(); };

  useLayoutEffect(() => {
    const prima = daRiprendere.current;
    // Un campo con `autoFocus` l'ha già preso: si lascia dov'è.
    if (!scatola.current?.contains(document.activeElement)) {
      (scatola.current?.querySelector<HTMLElement>(FOCALIZZABILI) ?? scatola.current)?.focus();
    }
    return () => {
      queueMicrotask(() => { if (prima instanceof HTMLElement && prima.isConnected) prima.focus(); });
    };
  }, []);

  useEffect(() => {
    if (!attiva) return;
    const fuori = (e: KeyboardEvent) => {
      if (scatola.current?.contains(e.target as Node)) return;
      // Un campo fuori da qui con il fuoco è di qualcosa che le sta sopra e che
      // non è una cornice (il login del viewer, a 9600): si scrive lì.
      if (e.target instanceof HTMLElement && e.target.closest("input, textarea, select, [contenteditable='true']")) return;
      e.stopPropagation();
      if (eSalva(e)) e.preventDefault();
      if (e.key === "Escape") { e.preventDefault(); chiudi(); return; }
      if (e.key === "Tab") e.preventDefault();
      scatola.current?.focus();
    };
    window.addEventListener("keydown", fuori, true);
    return () => window.removeEventListener("keydown", fuori, true);
  });

  const tasto = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (eSalva(e)) { e.preventDefault(); return; }
    if (e.key === "Escape") { e.preventDefault(); chiudi(); return; }
    if (e.key === "Tab") {
      const els = [...(scatola.current?.querySelectorAll<HTMLElement>(FOCALIZZABILI) ?? [])];
      if (els.length === 0) { e.preventDefault(); return; }
      const i = els.indexOf(document.activeElement as HTMLElement);
      const dopo = e.shiftKey ? (i <= 0 ? els.length - 1 : i - 1) : (i === els.length - 1 ? 0 : i + 1);
      e.preventDefault();
      els[dopo].focus();
    }
  };

  if (typeof document === "undefined") return null;
  return createPortal(
    <div data-testid={testid ? `${testid}-velo` : undefined} inert={!attiva || undefined}
      onMouseDown={(e) => { if (attiva && e.target === e.currentTarget && veloChiude) chiudi(); }}
      style={{
        position: "fixed", inset: 0, zIndex: z, background: "rgba(0,0,0,0.55)",
        fontFamily: "system-ui, sans-serif, 'SWS Emoji'",
        display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
      }}>
      <div ref={scatola} role="dialog" aria-modal="true" tabIndex={-1} data-testid={testid}
        aria-labelledby={titolo ? idTitolo : undefined}
        onKeyDown={attiva ? tasto : undefined}
        style={{
          background: "var(--brand-surface, #1e293b)", color: "var(--brand-text, #e2e8f0)",
          border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 10,
          boxShadow: "0 12px 40px rgba(0,0,0,0.5)", width: larghezza ?? "auto",
          maxWidth: "min(92vw, 720px)", maxHeight: "88vh", overflow: "auto", outline: "none", boxSizing: "border-box",
          padding: "18px 20px", display: "flex", flexDirection: "column", gap: 12,
        }}>
        {titolo && <div id={idTitolo} style={{ fontSize: 15, fontWeight: 700, color: "var(--brand-text, #e2e8f0)" }}>{titolo}</div>}
        {children}
      </div>
    </div>,
    document.body,
  );
}
