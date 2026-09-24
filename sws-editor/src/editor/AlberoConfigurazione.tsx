/** L'albero della Configurazione: la vista ⚙ del pannello sinistro.
 *
 *  ## Perché esiste
 *
 *  Fino al 24-09-2026 la Configurazione era una barra di sedici schede in cima
 *  a un'area a sé, e il pannello sinistro in Configurazione non c'era. L'idea
 *  del maintainer (seme del 22-09, piano
 *  `docs/plans/2026-09-24-configurazione-ad-albero-piano.md`): un albero sempre
 *  a portata di mano, come negli SCADA che mettono il progetto in una colonna,
 *  per arrivare più in fretta a tutte le opzioni — anche mentre si disegna.
 *
 *  Rami e foglie vengono da `config/schede.ts`: questo è un modo di **leggere**
 *  il registro, non un quinto elenco da tenere allineato. Una foglia porta alla
 *  sua scheda, e se si è nell'editor porta anche in Configurazione.
 */
import { useTranslation } from "react-i18next";
import { useAppStore } from "@/store";
import { RAMI, schedeVisibili, type RamoConfig } from "@/config/schede";
import { IntestazioneSezione, SPAZIO, TESTO, useSezioneAperta } from "./stilePannelli";

function Ramo({ ramo, icona }: { ramo: RamoConfig; icona: string }) {
  const { t } = useTranslation();
  const isAdmin    = useAppStore((s) => s.authRole === "Admin");
  const appMode    = useAppStore((s) => s.appMode);
  const configTab  = useAppStore((s) => s.configTab);
  const navigateToConfig = useAppStore((s) => s.navigateToConfig);
  // Tutti aperti la prima volta: l'albero serve a vedere tutto d'un colpo.
  const [aperto, commuta] = useSezioneAperta(`config.${ramo}`, true);

  const foglie = schedeVisibili(isAdmin).filter((s) => s.ramo === ramo);
  if (!foglie.length) return null;

  return (
    <div style={{ padding: `0 ${SPAZIO.m}px` }}>
      <IntestazioneSezione
        titolo={t(`config.rami.${ramo}`)}
        icona={icona}
        aperta={aperto}
        onToggle={commuta}
      />
      {aperto && foglie.map((s) => {
        const scelta = appMode === "config" && configTab === s.id;
        return (
          <button
            key={s.id}
            type="button"
            data-testid={`foglia-config-${s.id}`}
            aria-current={scelta ? "page" : undefined}
            onClick={() => navigateToConfig(s.id)}
            style={{
              width: "100%", display: "flex", alignItems: "center", gap: SPAZIO.s,
              padding: `3px ${SPAZIO.m}px 3px ${SPAZIO.l + SPAZIO.m}px`,
              border: "none", borderRadius: 4, cursor: "pointer", textAlign: "left",
              fontSize: TESTO.riga,
              background: scelta ? "var(--brand-surface-2, #334155)" : "transparent",
              color: scelta ? "var(--brand-text, #e2e8f0)" : "var(--brand-text-muted, #94a3b8)",
              fontWeight: scelta ? 600 : 400,
            }}
          >
            {/* Altezza fissa: alcune emoji hanno un'altezza di riga diversa dal
                testo e sfalsavano la foglia di qualche pixel. */}
            <span aria-hidden="true" style={{ width: 16, height: 16, lineHeight: "16px", fontSize: 12, flexShrink: 0, textAlign: "center", overflow: "hidden" }}>{s.icona}</span>
            <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {t(`config.tabs.${s.id}`)}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function AlberoConfigurazione() {
  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: `${SPAZIO.xs}px 0` }}>
      {RAMI.map((r) => <Ramo key={r.id} ramo={r.id} icona={r.icona} />)}
    </div>
  );
}
