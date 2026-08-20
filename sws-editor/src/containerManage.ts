/** Azioni di gestione sul container `sws-runtime` già installato. */
export type ManageAction =
  | "status"
  | "start"
  | "stop"
  | "restart"
  | "enable"
  | "disable"
  | "set_restart_policy"
  | "prune_images"
  | "uninstall";

/** Policy `Restart=` accettate dal backend — stesso dominio chiuso validato
 *  server-side in `restart_policy_is_safe`. */
export type RestartPolicy = "always" | "on-failure" | "no";

export interface ContainerManageInput {
  /** `true` = niente SSH, comando diretto sul host che esegue il backend. */
  local: boolean;
  host: string;
  port: number;
  user: string;
  password: string;
  action: ManageAction;
  /** Solo per `set_restart_policy`. */
  restartPolicy?: RestartPolicy;
  /** Solo per `uninstall`. */
  purge?: boolean;
  dataPath?: string;
}

/**
 * Costruisce il corpo di `POST /api/deploy/device-container/manage`.
 *
 * Estratta dal componente per lo stesso motivo di `containerDeployPayload` in
 * `containerDeploy.ts`: `uninstall` con `purge` è un'operazione distruttiva, e
 * i campi che non appartengono all'azione scelta devono partire vuoti/assenti
 * invece di lasciare nel payload valori che l'utente non ha scelto.
 */
export function containerManagePayload(i: ContainerManageInput): Record<string, unknown> {
  return {
    local: i.local,
    host: i.local ? "" : i.host,
    port: i.port,
    user: i.local ? "" : i.user,
    password: i.local ? "" : i.password,
    action: i.action,
    restart_policy: i.action === "set_restart_policy" ? (i.restartPolicy ?? "") : "",
    purge: i.action === "uninstall" ? !!i.purge : false,
    data_path: i.action === "uninstall" ? (i.dataPath ?? "") : "",
  };
}
