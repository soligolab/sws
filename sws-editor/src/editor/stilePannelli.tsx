/** La scala dei due pannelli dell'editor, e i pezzi che entrambi usano.
 *
 *  ## Perché esiste
 *
 *  Fino al 2026-09-11 il pannello sinistro e quello destro non condividevano
 *  nulla: `S.sectionHead` di qua e `CollapsibleSection` di là avevano colore,
 *  spaziatura, `letterSpacing`, glifo della freccia e comportamento diversi; a
 *  destra lo stato aperto si ricordava, a sinistra no; e righe dello stesso
 *  rango erano scritte a 10, 11 o 12 px a seconda di chi le aveva aggiunte. Le
 *  spaziature erano numeri a mano in ogni riga. Di qui l'impressione del
 *  maintainer che «si fondono un po' tutte le sezioni»: non è un'impressione,
 *  è la somma di scelte prese in momenti diversi.
 *
 *  Questo modulo è il passo 1 di T-56 (piano del 2026-09-10): la scala e i due
 *  componenti condivisi, adottati da entrambi i pannelli **senza spostare
 *  niente**. Il riordino vero — una vista per volta a sinistra, sezioni
 *  canoniche a destra — sono i passi 2 e 3, e si appoggiano su questo.
 *
 *  ## Cosa NON sta qui
 *
 *  I colori: restano i token `--brand-*` di `theme.ts`, che hanno già un posto
 *  loro. Qui ci sono solo misure, e i componenti che le applicano.
 */
import React, { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

/** Spaziature. Quattro valori, non un continuo: la scala serve a togliere le
 *  decisioni, non a spostarle da `padding: 5px` a `SPAZIO.cinque`. */
export const SPAZIO = { xs: 4, s: 6, m: 8, l: 12 } as const;

/** Dimensioni del testo, per **rango** e non per posto: due righe dello stesso
 *  rango devono avere la stessa dimensione anche se vivono in pannelli
 *  diversi. */
export const TESTO = {
  /** Intestazione di sezione, in maiuscoletto. */
  titoloSezione: 11,
  /** Etichetta di un campo, sopra il controllo. */
  etichetta: 11,
  /** Riga di contenuto: voce di elenco, valore, nome di oggetto. */
  riga: 12,
  /** Nota, suggerimento, testo secondario. */
  nota: 10,
} as const;

/** Il prefisso **unico** sotto cui vive la memoria aperto/chiuso dei pannelli.
 *
 *  Unico di proposito: le chiavi si moltiplicano (una per sezione, e dal passo
 *  3 una per sezione **per tipo di oggetto**), e un giorno vanno azzerate
 *  insieme — con un prefisso solo è una riga, con tre è un'archeologia. */
export const PREFISSO_MEMORIA = "sws.pannelli.";

/** `localStorage` può lanciare (Safari in navigazione privata, storage
 *  disabilitato): un pannello che non ricorda è un fastidio, un pannello che
 *  non si apre è un guasto. */
function leggiGrezzo(chiave: string): string | null {
  try {
    return localStorage.getItem(chiave);
  } catch {
    return null;
  }
}

/** Era aperta l'ultima volta? `difetto` quando non se ne sa niente. */
export function sezioneAperta(chiaveMemoria: string | undefined, difetto: boolean): boolean {
  if (!chiaveMemoria) return difetto;
  const v = leggiGrezzo(PREFISSO_MEMORIA + chiaveMemoria);
  if (v === "1") return true;
  if (v === "0") return false;
  return difetto;
}

export function ricordaSezione(chiaveMemoria: string | undefined, aperta: boolean): void {
  if (!chiaveMemoria) return;
  try {
    localStorage.setItem(PREFISSO_MEMORIA + chiaveMemoria, aperta ? "1" : "0");
  } catch {
    /* senza memoria si riparte dai default: non è un errore da mostrare */
  }
}

/** Porta sotto il prefisso unico le chiavi `sws.objprops.*` scritte prima del
 *  2026-09-11 dal pannello destro, così chi aveva già disposto le sue sezioni
 *  non se le ritrova tutte richiuse. Gira una volta sola all'avvio; le vecchie
 *  si cancellano, altrimenti resterebbero per sempre a dire una cosa che
 *  nessuno legge più. Restituisce quante ne ha spostate (serve al test). */
export function migraMemorieVecchie(): number {
  let spostate = 0;
  try {
    const vecchie: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith("sws.objprops.")) vecchie.push(k);
    }
    for (const k of vecchie) {
      const v = localStorage.getItem(k);
      const nuova = PREFISSO_MEMORIA + "props." + k.slice("sws.objprops.".length);
      if (v !== null && localStorage.getItem(nuova) === null) {
        localStorage.setItem(nuova, v);
        spostate++;
      }
      localStorage.removeItem(k);
    }
  } catch {
    /* vedi leggiGrezzo */
  }
  return spostate;
}

/** Lo stato aperto/chiuso di una sezione, con la memoria già dentro.
 *
 *  Vive qui e non nei due componenti perché il passo 2 toglierà le
 *  fisarmoniche dal pannello sinistro: quando succederà, la memoria delle
 *  viste userà lo stesso meccanismo senza doverlo riscrivere. */
export function useSezioneAperta(
  chiaveMemoria: string | undefined,
  difetto: boolean,
): [boolean, () => void] {
  const [aperta, setAperta] = useState(() => sezioneAperta(chiaveMemoria, difetto));
  const commuta = useCallback(() => {
    setAperta((v) => {
      ricordaSezione(chiaveMemoria, !v);
      return !v;
    });
  }, [chiaveMemoria]);
  return [aperta, commuta];
}

export interface IntestazioneSezioneProps {
  titolo: string;
  aperta: boolean;
  onToggle: () => void;
  /** Glifo davanti al titolo (le viste del pannello sinistro, dal passo 2). */
  icona?: React.ReactNode;
  /** Numero fra parentesi dopo il titolo: «Struttura (12)». Zero si mostra,
   *  `undefined` no — «(0)» è un'informazione, l'assenza è ambigua. */
  contatore?: number;
  /** Slot in coda, prima della freccia (badge, pulsante ⚙). I click non
   *  commutano la sezione: se ne occupa questo componente, così ogni chiamante
   *  non deve ricordarsi lo `stopPropagation`. */
  azione?: React.ReactNode;
  /** Sfondo pieno e riga sotto, per una **colonna** di sezioni: senza, in una
   *  pila di sette fisarmoniche non si distingue dove finisce una e comincia
   *  l'altra. Lo usa oggi il pannello sinistro e sparirà col passo 2, quando
   *  resterà una vista per volta. */
  rilievo?: boolean;
}

/** L'intestazione di sezione dei due pannelli: una sola.
 *
 *  È un `<button>` e non un `<div>`: il pannello destro lo era già, il sinistro
 *  no, e una fisarmonica che non si apre da tastiera è inaccessibile a chi non
 *  usa il mouse. Il `type="button"` non è decorativo — dentro un `<form>` un
 *  bottone senza tipo invia. */
export function IntestazioneSezione({
  titolo, aperta, onToggle, icona, contatore, azione, rilievo = false,
}: IntestazioneSezioneProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={aperta}
      style={{
        width: "100%",
        display: "flex",
        alignItems: "center",
        gap: SPAZIO.s,
        textAlign: "left",
        cursor: "pointer",
        userSelect: "none",
        flexShrink: 0,
        fontSize: TESTO.titoloSezione,
        fontWeight: 700,
        letterSpacing: 0.5,
        color: "var(--brand-text-muted, #94a3b8)",
        background: rilievo ? "var(--brand-bg, #0f172a)" : "transparent",
        border: "none",
        borderBottom: rilievo ? "1px solid var(--brand-surface-2, #334155)" : "none",
        padding: rilievo ? `${SPAZIO.s}px ${SPAZIO.m}px` : `${SPAZIO.xs}px 0`,
      }}
    >
      <span
        aria-hidden="true"
        style={{ fontSize: 9, width: 10, flexShrink: 0, color: "var(--brand-text-subtle, #64748b)" }}
      >
        {aperta ? "▼" : "▶"}
      </span>
      {icona && <span aria-hidden="true" style={{ flexShrink: 0 }}>{icona}</span>}
      <span style={{ flex: 1, textTransform: "uppercase", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {titolo}
        {contatore !== undefined && (
          <span style={{ fontWeight: 400, color: "var(--brand-text-subtle, #64748b)" }}> ({contatore})</span>
        )}
      </span>
      {azione && (
        // `onClick` e non `onClickCapture`: l'azione deve poter fare il suo
        // mestiere, solo non deve aprire/chiudere la sezione che la contiene.
        <span onClick={(e) => e.stopPropagation()} style={{ display: "flex", alignItems: "center", gap: SPAZIO.xs }}>
          {azione}
        </span>
      )}
    </button>
  );
}

/** L'intestazione di una **vista**: stessa scala dell'intestazione di sezione,
 *  ma senza freccia e senza click — non c'è niente da aprire, la vista è già
 *  aperta, e sceglierne un'altra si fa dalla barra delle icone.
 *
 *  Resta ferma mentre scorre solo il contenuto sotto: è il pezzo che dà ai due
 *  pannelli la stessa forma. */
export function TitoloVista({ titolo, azione }: { titolo: string; azione?: React.ReactNode }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: SPAZIO.s, flexShrink: 0,
      padding: `${SPAZIO.s}px ${SPAZIO.m}px`,
      fontSize: TESTO.titoloSezione, fontWeight: 700, letterSpacing: 0.5,
      textTransform: "uppercase", color: "var(--brand-text-muted, #94a3b8)",
      background: "var(--brand-bg, #0f172a)",
      borderBottom: "1px solid var(--brand-surface-2, #334155)",
    }}>
      <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {titolo}
      </span>
      {azione}
    </div>
  );
}

/** Una voce della barra delle icone. `chiave` è una chiave i18n, non un testo:
 *  la barra la risolve da sé, così i chiamanti non devono passarsi `t`. */
export interface VoceBarra {
  readonly id: string;
  readonly icona: string;
  readonly chiave: string;
}

/** La colonna di icone che sceglie la vista: sempre visibile, **fuori** dalla
 *  zona che si ridimensiona e da quella che scorre.
 *
 *  Una sola, per tutti e due i pannelli: `lato` decide soltanto da che parte
 *  cade il bordo. Nata a sinistra l'11-09-2026 (T-56 passo 2) ed estratta qui
 *  il giorno stesso, quando il pannello destro ha preso la stessa forma. */
export function BarraIcone<T extends string>({
  voci, attiva, onScegli, lato,
}: {
  voci: readonly VoceBarra[];
  attiva: T;
  onScegli: (v: T) => void;
  lato: "sinistra" | "destra";
}) {
  const { t } = useTranslation();
  return (
    <div
      role="tablist"
      aria-orientation="vertical"
      style={{
        width: 40, flexShrink: 0, display: "flex", flexDirection: "column",
        alignItems: "center", gap: SPAZIO.xs, padding: `${SPAZIO.s}px 0`,
        background: "var(--brand-bg, #0f172a)",
        [lato === "sinistra" ? "borderRight" : "borderLeft"]:
          "1px solid var(--brand-surface-2, #334155)",
      }}
    >
      {voci.map((v) => {
        const scelta = v.id === attiva;
        return (
          <button
            key={v.id}
            role="tab"
            aria-selected={scelta}
            title={t(v.chiave)}
            onClick={() => onScegli(v.id as T)}
            style={{
              width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 15, lineHeight: 1, cursor: "pointer", borderRadius: 4,
              background: scelta ? "var(--brand-surface-2, #334155)" : "transparent",
              // Il bordo c'è sempre, trasparente quando non serve: senza, la
              // scelta sposterebbe le icone di un pixel a ogni clic.
              border: `1px solid ${scelta ? "var(--brand-border, #475569)" : "transparent"}`,
              color: scelta ? "var(--brand-text, #e2e8f0)" : "var(--brand-text-subtle, #94a3b8)",
            }}
          >
            <span aria-hidden="true">{v.icona}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Una riga del pannello proprietà: etichetta sopra, controllo sotto.
 *
 *  Oggi ogni `field()` locale la ridefinisce, e sono tre: due in `EditorShell`
 *  e una implicita nei blocchi scritti a mano. La `key` resta l'etichetta, come
 *  nei `field()` che sostituisce: sono righe di una lista statica per tipo. */
export function RigaProprieta({
  etichetta, inLinea = false, larghezzaEtichetta = 38, children,
}: {
  etichetta: string;
  /** Etichetta **a fianco** del controllo invece che sopra: recupera una riga
   *  per campo. Si usa dove i campi sono corti e l'etichetta è una parola o una
   *  lettera (nome, X, Y, W, H); sopra i campi lunghi resta il default, perché
   *  a pannello stretto l'etichetta a fianco mangerebbe larghezza al controllo. */
  inLinea?: boolean;
  /** Larghezza fissa della colonna dell'etichetta quando è in linea: senza,
   *  «Nome» e «X» allineerebbero i controlli in due punti diversi. */
  larghezzaEtichetta?: number;
  children: React.ReactNode;
}) {
  const stileEtichetta: React.CSSProperties = {
    fontSize: TESTO.etichetta,
    color: "var(--brand-text-muted, #94a3b8)",
  };
  if (inLinea) {
    // `<label>`: il click sul testo porta il fuoco nel campo, che con
    // etichette di una lettera è l'unico bersaglio comodo che resti.
    return (
      <label style={{ display: "flex", alignItems: "center", gap: SPAZIO.s, marginBottom: 2 }}>
        <div style={{ ...stileEtichetta, flex: `0 0 ${larghezzaEtichetta}px` }}>{etichetta}</div>
        <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
      </label>
    );
  }
  return (
    <div>
      <div style={{ ...stileEtichetta, marginBottom: 2 }}>{etichetta}</div>
      {children}
    </div>
  );
}
