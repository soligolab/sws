import { describe, expect, it } from "vitest";
import { containerDeployPayload, effectiveDataPath, type ContainerDeployInput } from "../src/containerDeploy";

const base: ContainerDeployInput = {
  source: "registry",
  imageTarball: "sws-runtime-2026.7.0-aarch64-image.tar.gz",
  imageRef: "",
  cleanInstall: false,
  host: "192.168.1.105",
  port: 22,
  user: "user",
  password: "segreta",
  remoteDir: "/tmp/sws-deploy",
  dataPath: "/data/user/sws",
};

describe("containerDeployPayload", () => {
  // Dal registry l'archivio non c'entra: mandarlo lo stesso lascerebbe nel
  // payload un'informazione che contraddice la scelta dell'utente.
  it("dal registry non manda l'archivio", () => {
    const p = containerDeployPayload(base);
    expect(p.image_source).toBe("registry");
    expect(p.image_tarball).toBe("");
    expect(p.image_ref).toBe("");
  });

  it("dal registry manda il riferimento quando c'è, ripulito dagli spazi", () => {
    const p = containerDeployPayload({ ...base, imageRef: "  ghcr.io/soligolab/sws-runtime:2026.7.0-arm64 " });
    expect(p.image_ref).toBe("ghcr.io/soligolab/sws-runtime:2026.7.0-arm64");
  });

  it("da archivio manda l'archivio e non il riferimento", () => {
    const p = containerDeployPayload({ ...base, source: "archive", imageRef: "reg:tag" });
    expect(p.image_source).toBe("archive");
    expect(p.image_tarball).toBe("sws-runtime-2026.7.0-aarch64-image.tar.gz");
    expect(p.image_ref).toBe("");
  });

  // L'azzeramento non deve poter partire per inerzia: viaggia solo se chiesto.
  it("clean_install viaggia esattamente com'è", () => {
    expect(containerDeployPayload(base).clean_install).toBe(false);
    expect(containerDeployPayload({ ...base, cleanInstall: true }).clean_install).toBe(true);
  });
});

describe("effectiveDataPath", () => {
  // Il testo di conferma deve poter dire QUALE cartella sparisce, anche quando
  // l'utente non ha scritto niente e decide l'installer.
  it("ricade sul default dell'installer quando il campo è vuoto", () => {
    expect(effectiveDataPath("")).toBe("/data/user/sws");
    expect(effectiveDataPath("   ")).toBe("/data/user/sws");
  });

  it("rispetta un percorso scelto", () => {
    expect(effectiveDataPath("/opt/sws-data")).toBe("/opt/sws-data");
  });
});
