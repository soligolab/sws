// Il diff leggibile di una proposta: cosa cambia, non come.
//
// # Perché è un modulo a sé
//
// Stava in `ChatPanel.tsx`. Da quando la chat può vivere in una finestra
// separata, questo calcolo deve girare **nella finestra dell'editor** — è l'unica
// che ha `project`/`pages` aggiornati — mentre chi lo chiede può essere l'altra.
// Il lato-editor del ponte non deve importare un componente React per calcolare
// un diff, quindi la funzione se ne viene qui: nessun React, nessuno store,
// nessun `t()`.

import { uguale } from "@/ai/confronto";
import type { VoceDiff } from "@/types/ai";
import type { ProjectInfo, SynopticPage } from "@/types";

export function riassumi(
  propProject: ProjectInfo | null,
  propPages: SynopticPage[] | null,
  project: ProjectInfo | null,
  pages: SynopticPage[],
): VoceDiff[] {
  const out: VoceDiff[] = [];
  // `uguale` e non `JSON.stringify`: l'ordine delle chiavi differisce fra
  // l'API (ordine del file YAML) e la proposta (ordine della struct Rust), e
  // con lo stringify il diff dichiarava «modificati» quasi tutti gli oggetti
  // della pagina.
  const stessa = uguale;

  const perId = <T extends { id: string }>(v: T[] | undefined | null) =>
    new Map((v ?? []).map((x) => [x.id, x]));

  if (propProject && project) {
    for (const [etichetta, prima, dopo] of [
      ["tag",      perId(project.tags),    perId(propProject.tags)],
      ["sorgente", perId(project.sources as { id: string }[]), perId(propProject.sources as { id: string }[])],
      ["allarme",  perId(project.alarms),  perId(propProject.alarms)],
    ] as [string, Map<string, unknown>, Map<string, unknown>][]) {
      for (const [id, v] of dopo) {
        if (!prima.has(id)) out.push({ verso: "+", testo: `${etichetta} \`${id}\`` });
        else if (!stessa(prima.get(id), v)) out.push({ verso: "~", testo: `${etichetta} \`${id}\`` });
      }
      for (const id of prima.keys()) {
        if (!dopo.has(id)) out.push({ verso: "-", testo: `${etichetta} \`${id}\`` });
      }
    }
  }

  for (const pg of propPages ?? []) {
    const attuale = pages.find((p) => p.name === pg.name);
    if (!attuale) {
      out.push({ verso: "+", testo: `pagina «${pg.name}» (${pg.objects.length} oggetti)` });
      continue;
    }
    const prima = new Map(attuale.objects.map((o) => [o.id, o]));
    const dopo  = new Map(pg.objects.map((o) => [o.id, o]));
    for (const [id, o] of dopo) {
      if (!prima.has(id)) out.push({ verso: "+", testo: `${o.type} \`${id}\` in «${pg.name}»` });
      else if (!stessa(prima.get(id), o)) out.push({ verso: "~", testo: `${o.type} \`${id}\` in «${pg.name}»` });
    }
    for (const [id, o] of prima) {
      if (!dopo.has(id)) out.push({ verso: "-", testo: `${o.type} \`${id}\` da «${pg.name}»` });
    }
  }
  return out;
}
