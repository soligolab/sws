/** «Dominio (LDAP)» in the Users tab (plan docs/plans/2026-11-21-p6-2fa-e-ldap.md). */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import "../src/i18n/index";
import i18n from "../src/i18n/index";
import { api } from "../src/api/client";
import { LdapSection } from "../src/config/schede/LdapSection";
import { useAppStore } from "../src/store";

afterEach(() => { vi.restoreAllMocks(); });

describe("the LDAP section", () => {
  it("adds a domain with a group and saves it in the project", async () => {
    useAppStore.setState({ project: { meta: { name: "p", version: "1" }, tags: [], sources: [], alarms: [] } as never });
    const save = vi.spyOn(api, "saveLdap").mockResolvedValue(undefined);
    render(<LdapSection />);
    fireEvent.click(screen.getByTestId("ldap-add"));
    fireEvent.change(screen.getByPlaceholderText(i18n.t("ldap.urlExample")), { target: { value: "ldaps://dc.x" } });
    fireEvent.change(screen.getByPlaceholderText(i18n.t("ldap.userBaseExample")), { target: { value: "DC=x" } });
    fireEvent.click(screen.getByText(`+ ${i18n.t("ldap.addGroup")}`));
    fireEvent.change(screen.getByPlaceholderText(i18n.t("ldap.groupExample")), { target: { value: "CN=Op,DC=x" } });
    fireEvent.click(screen.getByTestId("ldap-save"));
    await waitFor(() => expect(save).toHaveBeenCalled());
    const cfg = save.mock.calls[0][0]!;
    expect(cfg).toMatchObject({ url: "ldaps://dc.x", user_base: "DC=x", groups: [{ dn: "CN=Op,DC=x", role: "operator", zones: [] }] });
    await screen.findByText(i18n.t("ldap.saved"));
    expect(useAppStore.getState().project?.ldap?.url).toBe("ldaps://dc.x");
  });

  it("says what the test found", async () => {
    useAppStore.setState({ project: { meta: { name: "p", version: "1" }, tags: [], sources: [], alarms: [],
      ldap: { enabled: true, url: "ldaps://dc.x", starttls: false, user_base: "DC=x", user_filter: "(uid={user})", groups: [], timeout_ms: 5000 } } as never });
    vi.spyOn(api, "testLdap").mockResolvedValue({ ok: false, code: "refused" });
    render(<LdapSection />);
    fireEvent.click(screen.getByTestId("ldap-test"));
    await screen.findByText(i18n.t("ldap.testRefused"));
  });
});
