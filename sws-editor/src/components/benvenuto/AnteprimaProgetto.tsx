import { useEffect, useState } from "react";
import { api } from "@/api/client";
import { IconaUI } from "@/ui/IconaUI";

/** La miniatura della pagina iniziale di un progetto nell'elenco (29-10-2026,
 *  ramo D del piano «aprire sws.soligo.net»), o l'icona se non ce l'ha.
 *
 *  Si scarica con la sessione (un `<img src>` non porterebbe il gettone) e si
 *  mostra come `blob:`; `ms` è la data della miniatura, e cambia quando l'IDE
 *  ne scrive una nuova. Il riquadro ha la stessa misura con o senza miniatura,
 *  così le schede della griglia restano allineate. */
export function AnteprimaProgetto({ riferimento, ms, riga = false }: {
  riferimento: string;
  ms?: number;
  /** Il quadratino della vista a elenco; senza, la scheda della griglia, a
   *  tutta larghezza. */
  riga?: boolean;
}) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    setUrl(null);
    if (!ms) return;
    let vivo = true;
    let creato: string | null = null;
    api.scaricaAnteprima(riferimento, ms)
      .then((b) => {
        if (!vivo || !b) return;
        creato = URL.createObjectURL(b);
        setUrl(creato);
      })
      .catch(() => { /* senza miniatura resta l'icona */ });
    return () => {
      vivo = false;
      if (creato) URL.revokeObjectURL(creato);
    };
  }, [riferimento, ms]);

  const scheda = !riga;
  return (
    <div data-testid="anteprima-progetto" data-con-miniatura={url ? "si" : "no"} style={{
      ...(scheda ? { width: "100%", aspectRatio: "16 / 10" } : { width: 40, height: 40, flexShrink: 0 }),
      borderRadius: scheda ? 6 : 8, overflow: "hidden",
      background: "var(--brand-surface-2, #334155)",
      display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      {url
        ? <img src={url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
        : <IconaUI nome="progetto" px={scheda ? 40 : 20} colore="var(--brand-text-muted, #94a3b8)" />}
    </div>
  );
}
