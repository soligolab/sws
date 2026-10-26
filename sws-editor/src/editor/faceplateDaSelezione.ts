// «Crea faceplate dalla selezione» (P2 del piano prima fascia, 25-10-2026).
//
// Il maintainer, davanti alla misura: i faceplate sono già i template
// d'oggetto (parametri, istanze che seguono la definizione, web e LVGL); manca
// il modo di farne uno da oggetti già disegnati. Questa funzione è pura: dagli
// oggetti scelti esce la definizione del faceplate e la sua prima istanza, che
// prende il loro posto nella pagina.
import type { FaceplateDef, FaceplateParamDef, SynopticObject } from "@/types";
import { objectBBox } from "@/pageLayout";
import { faceplateDefBBox } from "@/canvas/SvgCanvas";
import { TAG_FIELDS } from "@/runtime-view/collectTagIds";

export interface DaSelezione {
  def: FaceplateDef;
  istanza: SynopticObject;
}

/** I tag della selezione, campo per campo. */
function tagsDi(oggetti: readonly SynopticObject[]): string[] {
  const out = new Set<string>();
  for (const o of oggetti) {
    for (const f of TAG_FIELDS) {
      const v = (o as unknown as Record<string, unknown>)[f];
      if (typeof v === "string" && v.trim() !== "") out.add(v);
    }
  }
  return [...out].sort();
}

/** La radice comune dei tag (`motore1` per `motore1.velocita`, `motore1.marcia`),
 *  se tutti ne hanno una e non sono la radice stessa. */
function radiceComune(tags: readonly string[]): string | null {
  if (tags.length === 0) return null;
  const radici = new Set(tags.map((t) => t.split(".")[0]));
  if (radici.size !== 1) return null;
  const r = [...radici][0];
  return tags.every((t) => t.startsWith(`${r}.`)) ? r : null;
}

/** Il faceplate e la sua prima istanza dagli oggetti selezionati.
 *
 *  - **Le coordinate** diventano relative all'angolo del riquadro della
 *    selezione, punti di tubi e linee compresi.
 *  - **I tag diventano parametri**: se hanno tutti una radice comune
 *    (`motore1.…`), un parametro solo `p` di tipo istanza e i campi diventano
 *    `{p}.velocita` — il modo naturale di un faceplate su una struttura; se no,
 *    un parametro per tag (`tag1`, `tag2`…), col tag originale come
 *    predefinito.
 *  - **Un tubo agganciato fuori dalla selezione** perde l'aggancio (resta col
 *    suo disegno): dentro un faceplate non c'è niente a cui agganciarsi.
 *  - **L'istanza** ha le misure della definizione (scala 1:1) e i parametri che
 *    rifanno esattamente gli oggetti di prima. */
export function faceplateDallaSelezione(oggetti: readonly SynopticObject[], id: string, label: string, idIstanza: string): DaSelezione {
  const boxes = oggetti.map((o) => objectBBox(o));
  const x0 = Math.min(...boxes.map((b) => b.x1));
  const y0 = Math.min(...boxes.map((b) => b.y1));
  const dentro = new Set(oggetti.map((o) => o.id));

  const tags = tagsDi(oggetti);
  const radice = radiceComune(tags);
  const params: FaceplateParamDef[] = [];
  const valori: Record<string, string> = {};
  const sostituto = new Map<string, string>();
  if (radice) {
    params.push({ name: "p", type: "istanza" });
    valori.p = radice;
    for (const t of tags) sostituto.set(t, `{p}${t.slice(radice.length)}`);
  } else {
    tags.forEach((t, i) => {
      const nome = `tag${i + 1}`;
      params.push({ name: nome, type: "tag", default: t });
      valori[nome] = t;
      sostituto.set(t, `{${nome}}`);
    });
  }

  const objects = oggetti.map((o) => {
    const c: SynopticObject = { ...o, x: (o.x ?? 0) - x0, y: (o.y ?? 0) - y0 };
    if (o.x2 != null) c.x2 = o.x2 - x0;
    if (o.y2 != null) c.y2 = o.y2 - y0;
    if (o.points) c.points = o.points.map((p) => ({ ...p, x: p.x - x0, y: p.y - y0 }));
    if (o.from_obj_id && !dentro.has(o.from_obj_id)) { delete c.from_obj_id; delete c.from_port; }
    if (o.to_obj_id && !dentro.has(o.to_obj_id)) { delete c.to_obj_id; delete c.to_port; }
    const rec = c as unknown as Record<string, unknown>;
    for (const f of TAG_FIELDS) {
      const v = rec[f];
      if (typeof v === "string" && sostituto.has(v)) rec[f] = sostituto.get(v);
    }
    return c;
  });

  const def: FaceplateDef = { id, label, params, objects };
  const { w, h } = faceplateDefBBox(def);
  const istanza: SynopticObject = {
    id: idIstanza, type: "faceplate", x: x0, y: y0, width: w, height: h,
    faceplate_id: id, faceplate_params: valori,
  } as SynopticObject;
  return { def, istanza };
}
