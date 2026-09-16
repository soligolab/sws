// Selettore di caratteri speciali per i campi di testo (T-71).
//
// Stesso schema di `SymbolPickerModal`/`SymbolGallery` in `EditorShell.tsx`
// (overlay pieno schermo, griglia cliccabile, chiusura su Esc o click fuori)
// — qui in un file a sé perché si aggancia a un campo di testo qualunque, non
// solo al piazzamento di un oggetto, ed è pensato per restare aperto poco: un
// click sceglie e chiude, non c'è un passo di conferma separato.
//
// Catalogo curato (non una tastiera Unicode libera): vedi
// `@/i18n/catalogoCaratteri` per il perché e per l'elenco.

import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { CATALOGO_CARATTERI } from "@/i18n/catalogoCaratteri";

/** `onMouseDown` con `preventDefault` invece di lasciare il click nudo: un
 *  bottone normale ruba il focus al mousedown, e il campo di testo che ha
 *  aperto questo selettore perderebbe il fuoco **prima** che `onPick` giri —
 *  il suo `onBlur` confermerebbe una bozza a metà, magari creando una voce
 *  nella tabella lingue per un testo che l'utente non aveva ancora finito di
 *  scrivere. Tenere il fuoco sul campo per tutta l'interazione evita il
 *  problema alla radice, invece di doverlo aggiustare dopo. */
function nonRubareIlFuoco(e: React.MouseEvent) {
  e.preventDefault();
}

function CharacterGallery({ onPick }: { onPick: (carattere: string) => void }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {CATALOGO_CARATTERI.map((cat) => (
        <div key={cat.id}>
          <div style={{ fontSize: 11, color: "var(--brand-text-muted, #94a3b8)", marginBottom: 4 }}>
            {cat.label}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {cat.caratteri.map((c) => (
              <button
                key={c}
                type="button"
                title={c}
                onMouseDown={nonRubareIlFuoco}
                onClick={() => onPick(c)}
                style={{
                  width: 34,
                  height: 34,
                  fontSize: 18,
                  lineHeight: 1,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: "var(--brand-bg, #0f172a)",
                  border: "1px solid var(--brand-surface-2, #334155)",
                  borderRadius: 4,
                  cursor: "pointer",
                }}
              >
                {c}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function CharacterPickerModal({ onPick, onCancel }: {
  onPick: (carattere: string) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onCancel]);

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        background: "rgba(0,0,0,0.7)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div style={{
        background: "var(--brand-bg, #0f172a)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 8,
        width: 300, maxHeight: "70vh",
        display: "flex", flexDirection: "column", overflow: "hidden",
      }}>
        <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--brand-surface, #1e293b)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 13, color: "var(--brand-text-2, #cbd5e1)", fontWeight: 600 }}>{t("characterPicker.title")}</span>
          <button
            type="button"
            onMouseDown={nonRubareIlFuoco}
            onClick={onCancel}
            style={{ background: "transparent", border: "none", color: "var(--brand-text-subtle, #64748b)", cursor: "pointer", fontSize: 16 }}
          >
            ✕
          </button>
        </div>
        <div style={{ overflowY: "auto", padding: 12, flex: 1 }}>
          <CharacterGallery onPick={onPick} />
        </div>
      </div>
    </div>
  );
}
