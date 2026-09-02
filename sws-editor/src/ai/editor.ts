// Le due sole cose che la chat chiede all'editor: **calcola il diff** e
// **applica**.
//
// # Perché un'interfaccia e non due rami dentro il pannello
//
// `ChatPanel` è lo stesso componente nel cassetto dell'IDE e nella finestra
// staccata. Nel primo caso parla direttamente allo store; nel secondo deve
// chiedere alla finestra dell'editor, perché è l'unica che ha `project`/`pages`
// aggiornati e l'unica dove `applyAiProposal` può girare. Un'interfaccia con due
// implementazioni tiene quella differenza in un posto solo: nel pannello **non
// cambia niente**, cambia solo cosa gli viene iniettato.
//
// # Chi calcola il diff, e perché non lo calcola la finestra staccata
//
// Si potrebbe mandare alla finestra staccata uno specchio di `project`/`pages` e
// farle calcolare il diff da sé. Si scarta per una ragione sola e sufficiente:
// il diff deve confrontare la proposta con lo stato dell'editor **nel momento in
// cui la proposta arriva**. Contro uno specchio di età ignota si mostrerebbe
// all'utente un diff diverso da ciò che verrà applicato — che è l'unica cosa che
// quella funzione ha da difendere.
//
// Quindi: la finestra staccata manda la proposta grezza, l'editor calcola e
// applica. E `applica` rimanda la proposta **intera**, non un id: così l'editor
// non tiene stato per proposta e la cosa continua a funzionare se è stato
// ricaricato nel frattempo. La guardia vera resta l'impronta, dentro
// `applyAiProposal`.

import { riassumi } from "@/ai/riassunto";
import { nuovoId, Ponte, type Messaggio } from "@/ai/ponte";
import { useAppStore, type AiProposta, type EsitoProposta } from "@/store";
import type { VoceDiff } from "@/types/ai";

export interface EditorAi {
  /** Il diff della proposta contro lo stato *attuale* dell'editor.
   *  Rifiuta se l'editor non è raggiungibile: chi chiama deve distinguere
   *  «nessuna modifica» da «non lo so», e per farlo serve un errore, non `[]`. */
  diff(p: AiProposta): Promise<VoceDiff[]>;
  applica(p: AiProposta): Promise<EsitoProposta>;
}

/** Il caso dell'IDE: lo store è qui. */
export const editorLocale: EditorAi = {
  async diff(p) {
    const s = useAppStore.getState();
    return riassumi(p.project ?? null, p.pages ?? null, s.project, s.pages);
  },
  async applica(p) {
    return useAppStore.getState().applyAiProposal(p);
  },
};

/** Quanto si aspetta una risposta dall'editor prima di dichiararlo assente. */
const ATTESA_MS = 8000;

/**
 * Il caso della finestra staccata.
 *
 * Il timeout su `applica` è la parte delicata: **un timeout non dimostra la
 * non-applicazione**. La proposta può essere stata applicata e la conferma
 * essersi persa. Per questo l'esito non dice «non applicata» ma «nessuna
 * conferma, controlla il canvas» — dire il contrario sarebbe un difetto
 * silenzioso peggiore del problema.
 */
export function editorViaPonte(ponte: Ponte, idEditore: () => string): EditorAi {
  /** Esito che `prendi` può dare per un messaggio: buono, cattivo, o «non è per
   *  questa attesa». Un tipo e non un `throw`, perché `prendi` gira **dentro**
   *  l'handler del canale: lanciare lì non rifiuterebbe la promessa, finirebbe
   *  in un errore non catturato e l'attesa scadrebbe otto secondi dopo dicendo
   *  la cosa sbagliata. */
  type Preso<T> = { ok: T } | { no: string } | undefined;

  const attendi = <T,>(
    invia: (rid: string) => boolean,
    prendi: (m: Messaggio, rid: string) => Preso<T>,
  ): Promise<T> =>
    new Promise<T>((risolvi, rifiuta) => {
      const rid = nuovoId();
      let orologio: ReturnType<typeof setTimeout>;
      const stop = ponte.ascolta((m) => {
        const v = prendi(m, rid);
        if (v === undefined) return;
        clearTimeout(orologio);
        stop();
        if ("ok" in v) risolvi(v.ok);
        else rifiuta(new Error(v.no));
      });
      orologio = setTimeout(() => {
        stop();
        rifiuta(new Error("timeout"));
      }, ATTESA_MS);
      if (!invia(rid)) {
        clearTimeout(orologio);
        stop();
        rifiuta(new Error("ponte chiuso"));
      }
    });

  return {
    diff(p) {
      return attendi<VoceDiff[]>(
        (rid) => ponte.manda({ t: "diff", a: idEditore(), rid, proposta: p }),
        (m, rid) => {
          if (m.t === "diff-ok" && m.rid === rid) return { ok: m.diff };
          if (m.t === "diff-no" && m.rid === rid) return { no: m.errore };
          return undefined;
        },
      );
    },

    applica(p) {
      return attendi<EsitoProposta>(
        (rid) => ponte.manda({ t: "applica", a: idEditore(), rid, proposta: p }),
        (m, rid) =>
          m.t === "applicato" && m.rid === rid
            ? { ok: { ok: m.ok, motivo: m.motivo, avviso: m.avviso } }
            : undefined,
      ).catch(() => ({
        ok: false,
        // Sentinella, tradotta dal pannello. Deliberatamente **non** «non
        // applicata»: un timeout non dimostra la non-applicazione.
        motivo: NESSUNA_CONFERMA,
      }));
    },
  };
}

/** `EsitoProposta.motivo` quando l'editor non ha confermato entro il tempo. */
export const NESSUNA_CONFERMA = "__nessuna_conferma__";
