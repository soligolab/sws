import i18n from "@/i18n";
import { api, type CopyRepository } from "@/api/client";
import { chiedi, scegli } from "@/finestraAvviso/finestraAvviso";

/** «Save as…» on a project that is a git repository (21-11-2026, plan
 *  `docs/plans/2026-11-21-lock-salva-come-sorgenti-sandbox.md`): what the copy
 *  does with it.
 *
 *  `undefined` = the project is not a repository, nothing to ask; `null` = the
 *  person cancelled. A branch name is proposed from the copy's name. */
export async function askCopyRepository(copyName: string): Promise<CopyRepository | undefined | null> {
  const t = i18n.t.bind(i18n);
  let branch: string;
  try {
    branch = (await api.getGitStatus()).branch;
  } catch {
    return undefined; // 404: not a repository
  }
  const mode = await scegli<CopyRepository["mode"]>({
    testo: t("menu.copyGitQuestion", { branch }),
    scelte: [
      { valore: "branch", etichetta: t("menu.copyGitBranch") },
      { valore: "new_repository", etichetta: t("menu.copyGitNew") },
      { valore: "no_repository", etichetta: t("menu.copyGitNone") },
    ],
  });
  if (mode === null) return null;
  if (mode !== "branch") return { mode };
  const name = (await chiedi({ testo: t("menu.copyGitBranchPrompt"), iniziale: branchName(copyName) }))?.trim();
  return name ? { mode, name } : null;
}

/** A branch name from the copy's name: lower case, dashes, nothing git refuses. */
export function branchName(copyName: string): string {
  return copyName
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .replace(/\.\.+/g, ".") || "copy";
}
