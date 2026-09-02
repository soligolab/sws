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
import { diffRighe } from "@/ai/diffRighe";
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

  // ── Funzioni e script globali ──────────────────────────────────────────────
  //
  // Fino al 2026-09-02 questo blocco **non c'era**: il riassunto confrontava
  // tag, sorgenti, allarmi e pagine, e niente altro. Una proposta che riscriveva
  // il corpo di una funzione produceva quindi un diff **vuoto**, e il pannello
  // mostrava «nessuna modifica» — su una proposta che cambiava il progetto. È lo
  // stesso difetto contro cui è stata scritta la distinzione fra `null` e `[]`
  // in `Riga.diff`, arrivato però dall'altra parte: non un calcolo mancato, ma
  // un calcolo che non guardava dove serviva.
  //
  // Per il codice la voce porta anche il diff **riga per riga**: «funzione
  // modificata» non dice se è stata aggiunta una riga o riscritta da capo.
  // **Assente non è vuoto**, e vale per entrambe le collezioni. `functions` e
  // `global_scripts` sono opzionali: una proposta che non le nomina non le tocca,
  // e trattarle come liste vuote farebbe comparire nel diff la rimozione di tutto
  // quello che c'è. È la stessa distinzione che `ricomponi_script` difende lato
  // server, e qui va rifatta perché il pannello può ricevere anche la proposta
  // grezza, non solo quella normalizzata.
  if (propProject && project) {
    if (propProject.functions !== undefined) {
      const prima = new Map((project.functions ?? []).map((f) => [f.name, f]));
      const dopo  = new Map(propProject.functions.map((f) => [f.name, f]));
      for (const [nome, f] of dopo) {
        const vecchia = prima.get(nome);
        if (!vecchia) {
          out.push({ verso: "+", testo: `funzione \`${nome}\` (${righe(f.code)} righe)` });
        } else if (!stessa(vecchia, f)) {
          out.push(voceCodice(`funzione \`${nome}\``, vecchia.code, f.code));
        }
      }
      for (const nome of prima.keys()) {
        if (!dopo.has(nome)) out.push({ verso: "-", testo: `funzione \`${nome}\`` });
      }
    }

    if (propProject.global_scripts !== undefined) {
      const prima = new Map((project.global_scripts ?? []).map((g) => [g.id, g]));
      const dopo  = new Map(propProject.global_scripts.map((g) => [g.id, g]));
      for (const [id, g] of dopo) {
        const vecchio = prima.get(id);
        if (!vecchio) {
          out.push({ verso: "+", testo: `script globale \`${id}\` (${righe(g.code)} righe)` });
        } else if (!stessa(vecchio, g)) {
          out.push(voceCodice(`script globale \`${id}\``, vecchio.code, g.code));
        }
      }
      for (const id of prima.keys()) {
        if (!dopo.has(id)) out.push({ verso: "-", testo: `script globale \`${id}\`` });
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

const righe = (code: string) => code.split("\n").length;

/** Una voce del diff che riguarda del codice: porta con sé il diff per righe. */
function voceCodice(testo: string, prima: string, dopo: string): VoceDiff {
  const d = diffRighe(prima, dopo);
  return {
    verso: "~", testo,
    righe: d.righe.length ? d.righe : undefined,
    righeNota: d.nota,
  };
}
