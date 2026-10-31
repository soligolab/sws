// Il pannello proprietà delle cornici (15-10-2026): su una pagina, quale
// cornice mostra; su una cornice aperta, le due fasce e se è la predefinita.

import { useTranslation } from "react-i18next";
import { SelettoreColore } from "@/editor/CampoColore";
import { useAppStore } from "@/store";
import type { FasciaCornice, SynopticPage } from "@/types";
import { SEGNAPOSTI, idCornice, pagineCornice } from "./modello";
import { impostaCornicePredefinita } from "./predefinita";

const LABEL: React.CSSProperties = { fontSize: 11, color: "var(--brand-text-muted, #94a3b8)", marginBottom: 2 };
const INPUT: React.CSSProperties = {
  width: "100%", background: "var(--brand-bg, #0f172a)", color: "var(--brand-text, #e2e8f0)",
  border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4, padding: "3px 6px", fontSize: 13,
  boxSizing: "border-box",
};
const NOTA: React.CSSProperties = { fontSize: 10, color: "var(--brand-text-subtle, #94a3b8)", margin: "4px 0 0" };

const PREDEFINITA = "__predefinita";
const NESSUNA = "__nessuna";

/** Su una pagina sinottica: «Cornice» = predefinita del progetto, una delle
 *  cornici, oppure nessuna. */
export function SceltaCornice({ pagina }: { pagina: SynopticPage }) {
  const { t } = useTranslation();
  const cornici = pagineCornice(useAppStore((s) => s.pages));
  const predefinita = useAppStore((s) => s.project?.page_layout?.cornice_predefinita);
  const updatePageProps = useAppStore((s) => s.updatePageProps);
  const setCurrentPage = useAppStore((s) => s.setCurrentPage);
  const nomeDi = (id: string | undefined) => cornici.find((c) => idCornice(c) === id)?.name;
  const valore = pagina.cornice === undefined ? PREDEFINITA : pagina.cornice === null ? NESSUNA : pagina.cornice;
  const effettiva = pagina.cornice === undefined ? predefinita : pagina.cornice ?? undefined;
  const aperta = cornici.find((c) => idCornice(c) === effettiva);
  return (
    <div style={{ marginTop: 8 }} data-testid="scelta-cornice">
      <div style={LABEL}>{t("cornici.dellaPagina")}</div>
      <select style={{ ...INPUT, cursor: "pointer" }} value={valore} disabled={!!pagina.locked}
        onChange={(e) => {
          const v = e.target.value;
          updatePageProps(pagina.id, { cornice: v === PREDEFINITA ? undefined : v === NESSUNA ? null : v });
        }}>
        <option value={PREDEFINITA}>
          {t("cornici.predefinitaDelProgetto", { nome: nomeDi(predefinita) ?? t("cornici.nessunaMinuscolo") })}
        </option>
        {cornici.map((c) => <option key={c.id} value={idCornice(c)}>{c.name}</option>)}
        <option value={NESSUNA}>{t("cornici.nessunaOpzione")}</option>
      </select>
      {aperta && (
        <button type="button" onClick={() => setCurrentPage(aperta.id)}
          style={{ marginTop: 4, background: "none", border: "none", padding: 0, cursor: "pointer",
            fontSize: 11, color: "var(--brand-primary-testo, #3b82f6)", textDecoration: "underline" }}>
          {t("cornici.modifica", { nome: aperta.name })}
        </button>
      )}
    </div>
  );
}

function Fascia({ titolo, fascia, onChange }: {
  titolo: string; fascia: FasciaCornice; onChange: (f: FasciaCornice) => void;
}) {
  const { t } = useTranslation();
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginTop: 6 }}>
      <div>
        <div style={LABEL}>{titolo} — {t("cornici.altezza")}</div>
        <input type="number" min={0} style={INPUT} value={fascia.altezza}
          onChange={(e) => onChange({ ...fascia, altezza: Math.max(0, Number(e.target.value) || 0) })} />
      </div>
      <div>
        <div style={LABEL}>{t("cornici.fondo")}</div>
        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
          <SelettoreColore value={fascia.sfondo ?? "#1e293b"} disabled={!fascia.sfondo}
            onColore={(e) => onChange({ ...fascia, sfondo: e })}
            style={{ width: 32, height: 24, padding: 0, border: "none", background: "none" }} />
          <label style={{ fontSize: 11, color: "var(--brand-text-muted, #94a3b8)", display: "flex", gap: 3, alignItems: "center" }}>
            <input type="checkbox" checked={!!fascia.sfondo}
              onChange={(e) => onChange({ ...fascia, sfondo: e.target.checked ? "#1e293b" : undefined })} />
            {t("cornici.fondoPieno")}
          </label>
        </div>
      </div>
    </div>
  );
}

/** Su una cornice aperta: le due fasce e la cornice predefinita del progetto. */
export function ProprietaFasce({ pagina }: { pagina: SynopticPage }) {
  const { t } = useTranslation();
  const predefinita = useAppStore((s) => s.project?.page_layout?.cornice_predefinita);
  const updatePageProps = useAppStore((s) => s.updatePageProps);
  const id = idCornice(pagina);
  return (
    <div style={{ marginTop: 8 }} data-testid="proprieta-fasce">
      <p style={{ ...NOTA, marginBottom: 4 }}>{t("cornici.spiegazione")}</p>
      <Fascia titolo={t("cornici.testata")} fascia={pagina.cornice_testata ?? { altezza: 0 }}
        onChange={(f) => updatePageProps(pagina.id, { cornice_testata: f })} />
      <Fascia titolo={t("cornici.piede")} fascia={pagina.cornice_piede ?? { altezza: 0 }}
        onChange={(f) => updatePageProps(pagina.id, { cornice_piede: f })} />
      <label style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8, fontSize: 12, color: "var(--brand-text-2, #cbd5e1)", cursor: "pointer" }}>
        <input type="checkbox" checked={predefinita === id}
          onChange={(e) => {
            impostaCornicePredefinita(e.target.checked ? id : undefined).catch((err) =>
              window.alert(t("cornici.predefinitaFallita", { err: err instanceof Error ? err.message : String(err) })));
          }} />
        {t("cornici.predefinitaCheckbox")}
      </label>
      <p style={NOTA}>{t("cornici.segnaposti", { a: SEGNAPOSTI.paginaNome, b: SEGNAPOSTI.paginaId, c: SEGNAPOSTI.progettoNome })}</p>
    </div>
  );
}
