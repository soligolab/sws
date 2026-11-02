import { useAppStore } from "@/store";
import { effectiveProjectLang, localizePageName } from "@/i18n/projectI18n";

/** Il nome di una pagina come lo legge chi disegna (02-11-2026): un nome della
 *  tabella lingue (`{{t0072}}`, come nei template) si risolve nella lingua
 *  d'anteprima dell'editor, come fa già il navigatore del viewer. Prima l'albero
 *  e le linguette mostravano la chiave nuda. */
export function useNomePagina(): (nome: string) => string {
  const tabella = useAppStore((s) => s.project?.languages);
  const anteprima = useAppStore((s) => s.editorPreviewLang);
  const lingua = anteprima || effectiveProjectLang(tabella);
  return (nome: string) => (nome && nome.includes("{{") ? localizePageName(nome, lingua, tabella) : nome);
}
