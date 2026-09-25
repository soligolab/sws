/** Una variabile nell'albero: id, valore live, e — aperta — dove è usata.
 *
 *  ## Perché è un componente a sé
 *
 *  La stessa riga serve in due posti: il ramo TAG del pannello e (dal
 *  25-09-2026) le foglie sotto `Progetto › Variabili`. Scritta due volte
 *  diverge al primo ritocco, e questa riga porta quattro informazioni
 *  sovrapposte — qualità, valore, «non usata», usi — che è proprio il genere
 *  di cosa che diverge male.
 *
 *  ## Gli usi, raggruppati
 *
 *  Il maintainer, guardando l'elenco di prima: «mostrati così quei dati non
 *  dicono nulla all'utente finale». Erano righe `· page "Home"` una sotto
 *  l'altra, più una frase sul limite ripetuta sotto ogni tag. Ora sono gruppi
 *  con un conteggio — **Pagine (2)**, **Allarmi (1)** — e la voce di pagina
 *  dice **quale oggetto** usa la variabile, non solo dove cercarla. Il limite
 *  su ricette e Python è un ⓘ da sfiorare: vale sempre, e ripeterlo per esteso
 *  a ogni riga lo rendeva invisibile.
 */
import { useTranslation } from "react-i18next";
import type { CategoriaUso, TagUse } from "@/search/tagUsage";
import type { TagDef, TagState } from "@/types";

/** L'ordine in cui compaiono i gruppi: prima dove si guarda più spesso. */
const ORDINE: readonly CategoriaUso[] = ["pagina", "allarme", "espressione", "script"];

function colorePallino(q: string | undefined): string {
  if (q === "Good") return "var(--brand-success, #22c55e)";
  if (q === "Bad") return "var(--brand-danger, #ef4444)";
  if (q === undefined) return "var(--brand-surface-2, #334155)";
  return "var(--brand-warning, #eab308)";
}

export function PallinoQualita({ qualita }: { qualita?: string }) {
  return (
    <span
      aria-hidden="true"
      style={{
        display: "inline-block", width: 6, height: 6, borderRadius: "50%",
        background: colorePallino(qualita), flexShrink: 0,
      }}
    />
  );
}

export function UsiDelTag({ usi, onVaiAPagina }: {
  usi: readonly TagUse[];
  onVaiAPagina?: (pageId: string) => void;
}) {
  const { t } = useTranslation();
  if (usi.length === 0) {
    return (
      <div style={{ fontSize: 10, color: "var(--brand-text-subtle, #94a3b8)" }}>
        {t("editor.tagUnused")} <Nota testo={t("editor.tagUsageScope")} />
      </div>
    );
  }
  return (
    <>
      {ORDINE.map((cat) => {
        const voci = usi.filter((u) => u.categoria === cat);
        if (voci.length === 0) return null;
        return (
          <div key={cat} style={{ marginBottom: 2 }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: "var(--brand-text-subtle, #94a3b8)" }}>
              {t(`editor.tagUsageGroup.${cat}`)} ({voci.length})
            </div>
            {voci.map((u, i) => (
              <div
                key={i}
                onClick={u.pageId && onVaiAPagina ? () => onVaiAPagina(u.pageId!) : undefined}
                title={u.where}
                style={{
                  fontSize: 10, color: "var(--brand-text-muted, #94a3b8)", padding: "1px 0 1px 8px",
                  cursor: u.pageId && onVaiAPagina ? "pointer" : "default",
                  textDecoration: u.pageId && onVaiAPagina ? "underline dotted" : undefined,
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}
              >
                {u.oggetto ? `${etichettaBreve(u.where)} › ${u.oggetto}` : etichettaBreve(u.where)}
              </div>
            ))}
          </div>
        );
      })}
      <Nota testo={t("editor.tagUsageScope")} />
    </>
  );
}

/** Il nome fra virgolette, senza la parola che dice già il gruppo: dentro
 *  «Pagine (2)» la voce «pagina "Home"» ripeterebbe «pagina» a ogni riga. */
function etichettaBreve(where: string): string {
  const m = where.match(/"([^"]+)"(.*)$/);
  return m ? m[1] + (m[2] ?? "") : where;
}

function Nota({ testo }: { testo: string }) {
  return (
    <span
      title={testo}
      aria-label={testo}
      style={{ fontSize: 10, color: "var(--brand-text-subtle, #64748b)", cursor: "help", marginLeft: 2 }}
    >
      ⓘ
    </span>
  );
}

export function RigaTagLive({ tag, valore, usi, aperta, onToggle, onApri, stileRiga, figli, etichetta }: {
  tag: Pick<TagDef, "id">;
  valore?: TagState;
  usi: readonly TagUse[];
  /** Solo per le istanze: se le foglie sono in vista. */
  aperta: boolean;
  /** Apre/chiude le foglie. Senza `figli` non serve. */
  onToggle: () => void;
  /** Il clic sulla riga: porta al dettaglio nella scheda Variabili, dove c'è
   *  lo spazio per leggerlo (scelta del maintainer, 25-09-2026 — il riquadro
   *  dentro l'albero «crea confusione»). */
  onApri?: () => void;
  /** Lo stile della riga lo decide chi la monta: i due posti in cui vive
   *  hanno rientri e guide diversi. */
  stileRiga?: React.CSSProperties;
  /** Le foglie di un'istanza (`motore1.velocita` e sorelle). Di un'istanza la
   *  radice non ha un valore — ce l'hanno le foglie — quindi senza questo di
   *  `motore1` non si vedrebbe niente. */
  figli?: React.ReactNode;
  /** Il nome da mostrare, quando non è l'id: una foglia dentro la sua
   *  istanza mostra `velocita`, non `motore1.velocita`. */
  etichetta?: string;
}) {
  const { t } = useTranslation();
  return (
    <div>
      <div
        style={{ display: "flex", alignItems: "center", gap: 6, justifyContent: "space-between", cursor: onApri ? "pointer" : "default", ...stileRiga }}
        onClick={onApri}
        title={usi.length > 0 ? t("editor.tagUsesCount", { count: usi.length }) : t("editor.tagUsesNone")}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
          {figli !== undefined ? (
            <button
              type="button"
              aria-expanded={aperta}
              onClick={(e) => { e.stopPropagation(); onToggle(); }}
              title={t(aperta ? "editor.treeHide" : "editor.treeShow")}
              style={{ width: 12, flexShrink: 0, border: "none", background: "transparent", cursor: "pointer", fontSize: 9, color: "var(--brand-text-subtle, #64748b)", padding: 0 }}
            >
              {aperta ? "▼" : "▶"}
            </button>
          ) : <span style={{ width: 12, flexShrink: 0 }} />}
          <PallinoQualita qualita={valore?.quality} />
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={tag.id}>
            {etichetta ?? tag.id}
          </span>
          {figli === undefined && usi.length === 0 && (
            <span
              aria-hidden="true"
              title={t("editor.tagUnused")}
              style={{ display: "inline-block", width: 5, height: 5, borderRadius: "50%", background: "#f59e0b", flexShrink: 0 }}
            />
          )}
        </div>
        {valore != null && (
          <span style={{ color: "var(--brand-text-subtle, #64748b)", fontSize: 11, flexShrink: 0 }}>
            {String(valore.value)}
          </span>
        )}
      </div>
      {aperta && figli}
    </div>
  );
}
