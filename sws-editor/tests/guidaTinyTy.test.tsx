/** The install guide of the welcome screen: the device first (15-11-2026). The
 *  panels with podman keep the steps they had; the Tiny TY gets a package
 *  downloaded from this site, checked against its checksum, unpacked and installed. */
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { describe, it, expect, afterEach } from "vitest";
import "../src/i18n";
import { GuidaInstallazione, passiTinyTy, TINY_TY_DOWNLOAD } from "../src/components/benvenuto/InstallaRuntime";

afterEach(cleanup);

/** What the guide tells to type: the commands, not the words around them. */
const commands = () => Array.from(document.querySelectorAll("pre")).map((p) => p.textContent ?? "").join("\n");

describe("the install guide", () => {
  it("starts with the container steps, and the Tiny TY has its own", () => {
    render(<GuidaInstallazione />);
    expect(commands()).toContain("podman pull");
    expect(screen.getByTestId("guida-openplc")).toBeTruthy();
    fireEvent.click(screen.getByTestId("guida-prodotto-tiny-ty"));
    const text = commands();
    // No podman on a Tiny TY: a package, from this site, checked before it is installed.
    expect(text).not.toContain("podman");
    expect(text).toContain(`${window.location.origin}${TINY_TY_DOWNLOAD}/latest.tar.gz`);
    expect(text).toContain("sha256sum -c latest.tar.gz.sha256");
    expect(text).toContain("sudo ./install.sh");
    // OpenPLC is a container option: not offered here.
    expect(screen.queryByTestId("guida-openplc")).toBeNull();
    // And back.
    fireEvent.click(screen.getByTestId("guida-prodotto-container"));
    expect(commands()).toContain("podman pull");
  });

  it("the steps are in the order that cannot install what was not checked", () => {
    const steps = passiTinyTy("https://sws.soligo.net", (k) => k).map(([, cmd]) => cmd);
    expect(steps[0]).toMatch(/^ssh pixsys@/);
    expect(steps[1]).toContain("https://sws.soligo.net/download/tiny-ty/latest.tar.gz");
    // In the home, not in /tmp (a small memory disk on the panel).
    expect(steps[1]).toMatch(/^cd ~ /);
    expect(steps.findIndex((c) => c.includes("sha256sum -c"))).toBeLessThan(steps.findIndex((c) => c.includes("tar xzf")));
    expect(steps.findIndex((c) => c.includes("tar xzf"))).toBeLessThan(steps.findIndex((c) => c.includes("sudo ./install.sh")));
  });
});
