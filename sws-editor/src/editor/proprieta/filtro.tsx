// «Filtra proprietà» (01-11-2026, piano
// docs/plans/2026-11-01-pannello-proprieta-per-frequenza.md, fase 4): si scrive
// «colore» e si vedono i campi colore di tutti i rami. È la promessa dello
// stile VS Code — trovo tutto cercando — e risponde al «non ricordo dove sta»
// che nessuna disposizione dei rami toglie del tutto.
//
// Il filtro lavora sul DOM disegnato, non su una tabella dei campi: una tabella
// scritta a mano andrebbe d'accordo col pannello solo finché qualcuno se la
// ricorda (i campi sono più di trecento, in quaranta tipi). Si guarda il testo
// che chi usa il pannello legge — etichette, titoli, bottoni — e non i valori
// dei campi né le voci dei menu a tendina.
import { useTranslation } from "react-i18next";
import { SPAZIO, TESTO } from "../stilePannelli";

/** Il testo che si legge in un pezzo di pannello: niente valori dei campi né
 *  voci delle tendine, che farebbero passare un blocco per la parola sbagliata. */
function testoLetto(el: HTMLElement): string {
  // `data-alias`: le parole con cui si cerca una cosa che non le scrive — chi
  // cerca «tag» vuole Collegamenti, che dice «Valore», «Rotazione», «Allarme».
  const pezzi: string[] = [el.dataset.alias ?? "", ...Array.from(el.querySelectorAll<HTMLElement>("[data-alias]"), (a) => a.dataset.alias ?? "")];
  const giro = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement?.closest("select, option, textarea") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  for (let n = giro.nextNode(); n; n = giro.nextNode()) pezzi.push(n.textContent ?? "");
  return pezzi.join(" ").toLowerCase();
}

/** Nasconde o rimette `el`. Il `display` che aveva (un `flex` di React) si
 *  tiene da parte e si rimette uguale: toglierlo e basta romperebbe la riga. */
const nascondi = (el: HTMLElement, si: boolean) => {
  const nascosto = el.dataset.filtroPrima !== undefined;
  if (si && !nascosto) {
    el.dataset.filtroPrima = el.style.display;
    el.style.setProperty("display", "none", "important");
  } else if (!si && nascosto) {
    el.style.removeProperty("display");
    if (el.dataset.filtroPrima) el.style.display = el.dataset.filtroPrima;
    delete el.dataset.filtroPrima;
  }
};

/** Mostra in `radice` solo ciò che corrisponde a `testo`. Una sezione il cui
 *  titolo corrisponde resta intera; altrimenti restano i suoi blocchi che
 *  corrispondono, e una sezione senza blocchi sparisce. Testo vuoto: tutto
 *  com'era. Si richiama a ogni disegno: React non sa niente di queste modifiche. */
export function applicaFiltro(radice: HTMLElement, testo: string): void {
  const q = testo.trim().toLowerCase();
  for (const sezione of radice.querySelectorAll<HTMLElement>("[data-section]")) {
    const [titolo, corpo] = Array.from(sezione.children) as HTMLElement[];
    if (!titolo || !corpo) continue;
    const intera = !q || testoLetto(titolo).includes(q);
    let visti = 0;
    for (const blocco of Array.from(corpo.children) as HTMLElement[]) {
      // Un blocco fatto di righe (Collegamenti) si filtra riga per riga.
      const righe = blocco.querySelectorAll<HTMLElement>("[data-row]");
      if (righe.length > 0) {
        let dentro = 0;
        for (const r of righe) {
          const ok = intera || testoLetto(r).includes(q);
          nascondi(r, !ok);
          if (ok) dentro++;
        }
        nascondi(blocco, false);
        visti += dentro;
        continue;
      }
      const ok = intera || testoLetto(blocco).includes(q);
      nascondi(blocco, !ok);
      if (ok) visti++;
    }
    nascondi(sezione, !intera && visti === 0);
  }
  // Il nome di un ramo senza niente sotto non serve: i rami e le loro sezioni
  // condividono le centinaia di `order` (100, 200, 300…).
  const ordini = Array.from(radice.querySelectorAll<HTMLElement>("[data-section]"))
    .filter((s) => s.style.display !== "none")
    .map((s) => Number(s.style.order));
  for (const ramo of radice.querySelectorAll<HTMLElement>("[data-branch]")) {
    const base = Number(ramo.dataset.branch);
    nascondi(ramo, !!q && !ordini.some((o) => o > base && o < base + 100));
  }
}

/** Il campo del filtro, in testa alla colonna. */
export function CampoFiltro({ valore, onValore }: { valore: string; onValore: (v: string) => void }) {
  const { t } = useTranslation();
  return (
    <div style={{ padding: `${SPAZIO.s}px ${SPAZIO.l}px`, borderBottom: "1px solid var(--brand-surface-2, #334155)", flexShrink: 0 }}>
      <input type="search" data-testid="filtro-proprieta" value={valore} placeholder={t("props.filtro.segnaposto")}
        aria-label={t("props.filtro.segnaposto")}
        onChange={(e) => onValore(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Escape") onValore(""); }}
        style={{
          width: "100%", boxSizing: "border-box", fontSize: TESTO.etichetta, padding: "3px 6px", borderRadius: 4,
          background: "var(--brand-bg, #0f172a)", color: "var(--brand-text, #e2e8f0)", border: "1px solid var(--brand-surface-2, #334155)",
        }} />
    </div>
  );
}
