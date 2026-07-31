/** Da dove il dispositivo prende l'immagine del container. */
export type ContainerSource = "registry" | "archive";

export interface ContainerDeployInput {
  source: ContainerSource;
  /** Archivio scelto in dist/. Ignorato quando la sorgente è il registry. */
  imageTarball: string;
  /** Riferimento del registry. Vuoto = lo compone il dispositivo. */
  imageRef: string;
  cleanInstall: boolean;
  host: string;
  port: number;
  user: string;
  password: string;
  remoteDir: string;
  dataPath: string;
}

/**
 * Costruisce il corpo di `POST /api/deploy/device-container`.
 *
 * Estratta dal componente per una ragione precisa: è l'unico punto in cui una
 * scelta della UI diventa un'operazione **distruttiva** su un dispositivo, e i
 * campi che non appartengono alla sorgente scelta devono partire vuoti. Mandare
 * un `image_tarball` insieme a `image_source: "registry"` non romperebbe il
 * backend, ma lascerebbe nel payload un'informazione che contraddice la scelta
 * dell'utente — il tipo di ambiguità che poi si legge nei log e non si spiega.
 */
export function containerDeployPayload(i: ContainerDeployInput): Record<string, unknown> {
  return {
    image_source: i.source,
    image_tarball: i.source === "archive" ? i.imageTarball : "",
    image_ref: i.source === "registry" ? i.imageRef.trim() : "",
    clean_install: i.cleanInstall,
    host: i.host,
    port: i.port,
    user: i.user,
    password: i.password,
    remote_dir: i.remoteDir,
    data_path: i.dataPath,
  };
}

/**
 * Il percorso che verrà davvero azzerato da un'installazione pulita.
 *
 * Il default `/data/user/sws` è quello dell'installer, non dell'IDE: mostrarlo
 * all'utente evita che la conferma dica "verranno cancellati i dati" senza dire
 * quali. Deve combaciare con `DATA` in `deploy/container/install-container.sh`.
 */
export function effectiveDataPath(dataPath: string): string {
  return dataPath.trim() || "/data/user/sws";
}
