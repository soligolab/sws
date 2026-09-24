import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Tenuta } from "@/components/Tenuta";
import { normalizzaScheda, schedaDa, schedeVisibili, type IdScheda } from "@/config/schede";
import { useAppStore } from "@/store";
import { canConfigureProject } from "@/auth/permissions";
import { S } from "@/config/comuni";
import { TagsTab } from "@/config/schede/TagsTab";
import { ProtocolsTab } from "@/config/schede/ProtocolsTab";
import { AlarmsTab } from "@/config/schede/AlarmsTab";
import { IdePreferencesTab } from "@/config/schede/IdePreferencesTab";
import { SystemTab } from "@/config/schede/SystemTab";
import { UsersTab } from "@/config/schede/UsersTab";
import { ResourcesTab } from "@/config/schede/ResourcesTab";
import { DatastoresTab } from "@/config/schede/DatastoresTab";
import { GlobalScriptsTab } from "@/config/schede/GlobalScriptsTab";
import { FaceplatesTab } from "@/config/schede/FaceplatesTab";
import { RecipesTab } from "@/config/schede/RecipesTab";
import { NotificationsTab } from "@/config/schede/NotificationsTab";
import { RuntimeConnectionTab } from "@/config/schede/RuntimeConnectionTab";
import { DevicesTab } from "@/config/schede/DevicesTab";
import { LanguagesTab } from "@/config/schede/LanguagesTab";
import { BackupsTab } from "@/config/schede/BackupsTab";

/** Il componente di ogni scheda. Un `Record` e non un elenco: se una scheda
 *  entra in `SCHEDE` e non qui, è il compilatore a dirlo. */
const COMPONENTI: Record<IdScheda, React.ComponentType> = {
  tags: TagsTab,
  protocols: ProtocolsTab,
  alarms: AlarmsTab,
  scripts: GlobalScriptsTab,
  faceplates: FaceplatesTab,
  recipes: RecipesTab,
  notifications: NotificationsTab,
  languages: LanguagesTab,
  datastores: DatastoresTab,
  users: UsersTab,
  resources: ResourcesTab,
  system: SystemTab,
  backups: BackupsTab,
  devices: DevicesTab,
  runtime: RuntimeConnectionTab,
  ide: IdePreferencesTab,
};

export function ConfigView() {
  const { t } = useTranslation();
  const storeTab    = useAppStore((s) => s.configTab);
  const setStoreTab = useAppStore((s) => s.setConfigTab);
  const [tab, setTab] = useState<IdScheda>(() => normalizzaScheda(storeTab));
  const authRole = useAppStore((s) => s.authRole);
  const isAdmin = authRole === "Admin";
  const project          = useAppStore((s) => s.project);
  const projectLoadError = useAppStore((s) => s.projectLoadError);

  // Sync when the store tab changes (e.g. navigateToConfig from LeftPanel).
  useEffect(() => { setTab(normalizzaScheda(storeTab)); }, [storeTab]);

  const handleSetTab = (t: IdScheda) => {
    setTab(t);
    setStoreTab(t);
  };

  const visibili = schedeVisibili(isAdmin);
  const corrente = schedaDa(tab);

  // Un non-admin che arriva su una scheda da admin (stato salvato, link,
  // ruolo cambiato) torna alle variabili.
  useEffect(() => {
    if (corrente.soloAdmin && !isAdmin) handleSetTab("tags");
  }, [tab, isAdmin]);

  // Guard: the tabs that initialise their local state from store.project
  // must not render before it loads — empty inputs over a populated YAML,
  // and a subsequent save would wipe the file. The others stay available.
  const projectLoading = project === null && corrente.richiedeProgetto;

  // Belt-and-braces: App.tsx already gates mode="config" via effectiveMode,
  // so this is unreachable for non-Supervisor+ today. Kept so a future
  // direct mount can't slip past the role check. Placed after all hooks
  // to keep React's rules-of-hooks invariant intact across role changes.
  if (!canConfigureProject(authRole)) return null;

  return (
    <div style={S.page}>
      {/* Tab bar */}
      <div style={S.tabBar}>
        {visibili.map((sc) => (
          <button key={sc.id} style={S.tab(tab === sc.id)} onClick={() => handleSetTab(sc.id)}>
            {t(`config.tabs.${sc.id}`)}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={S.body}>
        {projectLoading ? (
          projectLoadError ? (
            <div style={{ color: "#dc2626", fontSize: 13, padding: 24, whiteSpace: "pre-wrap" }}>
              <strong>{t("cfgUi.errorLoadingProject")}</strong><br />{projectLoadError}
            </div>
          ) : (
            <div style={{ color: "var(--brand-text-subtle, #64748b)", fontSize: 13, padding: 24 }}>
              {t("cfgUi.loadingProject")}
            </div>
          )
        ) : (
          <>
            {/* Le schede che portano una bozza del progetto restano montate
                (nascoste) una volta viste: la bozza e la sua registrazione fra
                le sezioni pendenti sopravvivono al cambio di scheda, e il
                Salva unico le trova. Le altre (istanza, dispositivo) si
                montano e smontano come prima. */}
            {visibili.map((sc) => {
              const Scheda = COMPONENTI[sc.id];
              return sc.portaBozza
                ? <Tenuta key={sc.id} attiva={tab === sc.id}><Scheda /></Tenuta>
                : tab === sc.id && <Scheda key={sc.id} />;
            })}
          </>
        )}
      </div>
    </div>
  );
}
