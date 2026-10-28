import { useEffect, useState } from "react";
import { api } from "@/api/client";

/** La versione del runtime, chiesta **una volta sola** per tutta la sessione.
 *
 *  Richiesta del maintainer del 28-10-2026: «sarebbe comodo vedere la versione
 *  del runtime in uso». Scelta sua, nello stesso scambio: **dopo il login, non
 *  prima** — la versione esatta mostrata a chi non è ancora entrato la dice
 *  anche a chi sta cercando quali difetti noti provare, e su un'istanza aperta
 *  a esterni è un regalo gratuito.
 *  Piano: docs/plans/2026-10-26-aprire-sws-soligo-net.md, ramo B punto 8.
 *
 *  Una fetch sola, e il valore vive nel modulo: la versione di un processo non
 *  cambia mentre quel processo gira, e se cambia è perché il runtime è
 *  ripartito — e allora riparte anche la pagina. Chiederla a intervalli
 *  sarebbe esattamente il genere di traffico che il 28-10 abbiamo tolto dai
 *  trend. */
let ricordata: string | null = null;
let inVolo: Promise<string> | null = null;

/** Per i test: dimentica quello che si è già chiesto. */
export function dimenticaVersione(): void {
  ricordata = null;
  inVolo = null;
}

export function usaVersioneRuntime(): string | null {
  const [versione, setVersione] = useState<string | null>(ricordata);
  useEffect(() => {
    if (ricordata !== null) {
      setVersione(ricordata);
      return;
    }
    let vivo = true;
    inVolo ??= api
      .getSystemStatus()
      .then((s) => {
        ricordata = s.runtime_version ?? "";
        return ricordata;
      })
      .catch(() => {
        // Un runtime che non risponde non è un motivo per mostrare «—»:
        // meglio non scrivere niente che scrivere una versione falsa. E non
        // si ricorda il fallimento, così il prossimo montaggio riprova.
        inVolo = null;
        return "";
      });
    void inVolo.then((v) => {
      if (vivo && v) setVersione(v);
    });
    return () => { vivo = false; };
  }, []);
  return versione && versione.length > 0 ? versione : null;
}
