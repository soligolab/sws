import type { ReactNode } from "react";
import { S } from "@/config/comuni";
import { PastigliaStato } from "@/config/sorgenti/card/PastigliaStato";
import type { StatoCollegamento } from "@/types";

/** La testata di ogni card di Protocolli (29-10-2026, piano
 *  `docs/plans/2026-10-29-card-delle-sorgenti.md`): tipo · id · riepilogo ·
 *  stato · azioni · ▲.
 *
 *  Prima ognuna delle nove card la scriveva da sé, e quattro non avevano
 *  nemmeno `S.cardHead`. **Lo stato sta qui**, cioè si legge a card chiusa:
 *  con dieci sorgenti in elenco, quella che non risponde si vede senza
 *  aprirle tutte. Le sorgenti che non sanno dire se rispondono (Host, il
 *  server OPC-UA) passano `senzaStato`. */
export function TestataSorgente({
  tipo,
  colore,
  id,
  riepilogo,
  aperta,
  onToggle,
  azioni,
  senzaStato = false,
  stato,
}: {
  tipo: string;
  colore: string;
  id: string;
  riepilogo?: ReactNode;
  aperta: boolean;
  onToggle: () => void;
  azioni?: ReactNode;
  senzaStato?: boolean;
  /** Lo stato di un dispositivo invece di quello della sorgente. */
  stato?: StatoCollegamento;
}) {
  return (
    <div style={S.cardHead} onClick={onToggle} data-testid={`testata-${id}`}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", minWidth: 0 }}>
        <span style={{ fontSize: 11, color: colore, fontWeight: 700, letterSpacing: 1, whiteSpace: "nowrap" }}>{tipo}</span>
        <span style={{ fontWeight: 600, color: "var(--brand-text, #e2e8f0)" }}>{id}</span>
        {riepilogo && <span style={{ color: "var(--brand-text-subtle, #94a3b8)", fontSize: 12 }}>{riepilogo}</span>}
        {!senzaStato && <PastigliaStato id={id} stato={stato} />}
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
        {azioni}
        <span style={{ color: "var(--brand-text-subtle, #94a3b8)", fontSize: 14, cursor: "pointer" }} onClick={onToggle}>
          {aperta ? "▲" : "▼"}
        </span>
      </div>
    </div>
  );
}
