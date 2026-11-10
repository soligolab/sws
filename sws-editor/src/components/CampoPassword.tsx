/** Il campo password con l'occhio (09-11-2026, piano
 *  `docs/archive/2026-11-09-occhio-sulle-password.md`).
 *
 *  Sul pannello, col touch e la tastiera a schermo, una password si sbaglia
 *  facilmente e non si vede dove. L'occhio dentro il campo, a destra, mostra
 *  quello che si è scritto; un secondo tocco lo nasconde. Le regole, decise
 *  dal maintainer il 09-11-2026:
 *
 *  - parte nascosta, e torna nascosta quando il campo si smonta (la finestra
 *    che si chiude): lo stato vive qui e muore col componente;
 *  - si mostra quello che si sta scrivendo, non quello che si scriverà: nei
 *    moduli che restano montati (Utenti → nuovo utente, la console) l'occhio
 *    si richiude da solo quando il modulo si invia e quando il valore si
 *    svuota (il modulo che pulisce i campi dopo «Crea»);
 *  - un valore già salvato e mascherato dal server (`MASCHERA_SERVER`) resta
 *    mascherato: l'occhio è spento, mostra solo quello che si è scritto;
 *  - il bottone è `type="button"` e non ruba il fuoco al campo (il `mousedown`
 *    non passa), così Invio invia ancora il modulo e la tastiera a schermo del
 *    pannello non si chiude;
 *  - il bersaglio è 40×40 px, da dito, anche quando il campo è più basso: il
 *    bottone sporge sopra e sotto, trasparente;
 *  - **Tab lo salta** (`tabIndex={-1}`, decisione del maintainer del 10-11-2026):
 *    da tastiera, dopo la password, Tab va al pulsante del modulo e Invio
 *    entra; prima andava sull'occhio, e Invio lì mostrava la password invece
 *    di inviare. L'occhio resta per il mouse e per il dito;
 *  - lo stato lo dice l'etichetta che cambia («Mostra» / «Nascondi»), senza
 *    `aria-pressed`: col lettore di schermo le due cose insieme si
 *    contraddicono («Nascondi la password, premuto»).
 *
 *  Le stesse prop di un `<input>`, così la sostituzione di `<input
 *  type="password">` è meccanica (guardia `scripts/check_campi_password.sh`).
 *  Lo `style` si divide in due: le proprietà di posto — larghezza, flex,
 *  margini, griglia — vanno al contenitore, il resto al campo, che riempie il
 *  contenitore e lascia a destra il posto dell'occhio. Così `{ ...INPUT,
 *  width: 120 }` o `{ flex: 1 }` valgono per l'insieme campo + occhio. Senza
 *  una larghezza nello stile il contenitore si stringe sul campo, che misura
 *  quanto un `<input>` nudo più i 32 px in più di padding a destra: nei
 *  moduli dell'editor non capita — tutti i campi hanno `width` (100 % o
 *  fissa) o `flex: 1` — ma un campo nuovo senza larghezza esce più largo dei
 *  vicini. */
import { useCallback, useEffect, useRef, useState, type ComponentProps, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { IconaUI } from "@/ui/IconaUI";

/** La sentinella con cui il server maschera un segreto già salvato
 *  (`segreti.rs`, `amministrazione.rs`): otto asterischi. Rimandarla indietro
 *  invariata lascia il valore com'è. `config/comuni.tsx` la riesporta come
 *  `MASKED`. */
export const MASCHERA_SERVER = "********";

/** Il posto dell'occhio, in px: il bersaglio minimo per il dito. */
export const OCCHIO_PX = 40;

/** Le proprietà di `style` che dicono DOVE sta il campo, non com'è fatto. */
const DI_POSTO = new Set<string>([
  "width", "minWidth", "maxWidth",
  "flex", "flexGrow", "flexShrink", "flexBasis", "order",
  "margin", "marginTop", "marginRight", "marginBottom", "marginLeft",
  "gridColumn", "gridRow", "gridArea", "alignSelf", "justifySelf",
  "display",
]);

/** Divide lo stile di un `<input>` fra il contenitore (il posto) e il campo
 *  (l'aspetto). Esportata per il test, che la guarda da vicino. */
export function dividiStile(style: CSSProperties | undefined): { posto: CSSProperties; campo: CSSProperties } {
  const posto: Record<string, unknown> = {};
  const campo: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(style ?? {})) (DI_POSTO.has(k) ? posto : campo)[k] = v;
  return { posto, campo };
}

export type CampoPasswordProps = Omit<ComponentProps<"input">, "type">;

export function CampoPassword({ style, value, disabled, ref, ...resto }: CampoPasswordProps) {
  const { t } = useTranslation();
  const [visibile, setVisibile] = useState(false);
  const mascherato = value === MASCHERA_SERVER;
  // Il valore torna mascherato dopo un salvataggio: l'occhio si richiude, e
  // quello che si scriverà dopo partirà nascosto come la prima volta.
  useEffect(() => { if (mascherato) setVisibile(false); }, [mascherato]);
  // Il valore si svuota senza che il campo si smonti — il modulo che pulisce
  // i campi dopo «Crea» (Utenti, console Persone, Dispositivi): la password
  // del prossimo non deve nascere in chiaro. Chi cancella tutto a mano perde
  // solo la vista su un campo vuoto.
  const precedente = useRef(value);
  useEffect(() => {
    const era = precedente.current;
    precedente.current = value;
    if (era && !value) setVisibile(false);
  }, [value]);
  // Il modulo si invia e resta montato (login fallito, console): quello che
  // c'era da controllare è partito, il campo torna nascosto. Il modulo è
  // quello del campo (`input.form`), letto una volta al montaggio.
  const mio = useRef<HTMLInputElement | null>(null);
  const refUnito = useCallback((el: HTMLInputElement | null) => {
    mio.current = el;
    if (typeof ref === "function") ref(el);
    else if (ref) ref.current = el;
  }, [ref]);
  useEffect(() => {
    const modulo = mio.current?.form;
    if (!modulo) return;
    const nascondi = () => setVisibile(false);
    modulo.addEventListener("submit", nascondi);
    return () => modulo.removeEventListener("submit", nascondi);
  }, []);
  const mostra = visibile && !mascherato;
  const spento = !!disabled || mascherato;
  const etichetta = mostra ? t("campoPassword.nascondi") : t("campoPassword.mostra");
  const { posto, campo } = dividiStile(style);
  return (
    <span style={{ position: "relative", display: "inline-flex", verticalAlign: "top", ...posto }}>
      <input
        {...resto}
        ref={refUnito}
        value={value}
        disabled={disabled}
        type={mostra ? "text" : "password"}
        style={{ ...campo, width: "100%", minWidth: 0, boxSizing: "border-box", paddingRight: OCCHIO_PX }}
      />
      <button
        type="button"
        data-testid="occhio-password"
        tabIndex={-1}
        aria-label={etichetta}
        title={etichetta}
        disabled={spento}
        // Il fuoco resta nel campo: niente blur, la tastiera a schermo resta
        // aperta e Invio continua a inviare il modulo.
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setVisibile((v) => !v)}
        style={{
          position: "absolute", right: 0, top: "50%", transform: "translateY(-50%)",
          width: OCCHIO_PX, height: "100%", minHeight: OCCHIO_PX,
          display: "flex", alignItems: "center", justifyContent: "center",
          padding: 0, margin: 0, border: "none", borderRadius: 4, background: "transparent",
          color: "var(--brand-text-muted, #94a3b8)",
          cursor: spento ? "default" : "pointer",
          opacity: spento ? 0.35 : 1,
        }}
      >
        <IconaUI nome={mostra ? "occhioBarrato" : "occhio"} px={20} />
      </button>
    </span>
  );
}
