/** The second factor at login (plan docs/plans/2026-11-21-p6-2fa-e-ldap.md):
 *  the window asks the code, and setting 2FA up shows the recovery codes
 *  before the session. */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import "../src/i18n/index";
import i18n from "../src/i18n/index";
import { FinestraAvviso } from "../src/finestraAvviso/FinestraAvviso";
import { askSecondFactor, isSecondFactor, SecondFactorCancelled, type SecondFactorCalls } from "../src/auth/secondFactor";
import type { LoginOk } from "../src/api/client";

const OK: LoginOk = { token: "t", username: "m@x.it", role: "Admin", expires_at_ms: 1, must_change_password: false };

function calls(over: Partial<SecondFactorCalls> = {}): SecondFactorCalls {
  return {
    code: vi.fn().mockResolvedValue(OK),
    setup: vi.fn().mockResolvedValue({ secret: "JBSWY3DPEHPK3PXP", uri: "otpauth://totp/SWS:m%40x.it?secret=JBSWY3DPEHPK3PXP" }),
    setupConfirm: vi.fn().mockResolvedValue({ ...OK, recovery_codes: ["AAAA-BBBB", "CCCC-DDDD"] }),
    ...over,
  };
}

describe("the second factor", () => {
  it("tells a challenge from a session", () => {
    expect(isSecondFactor({ second_factor: "code", challenge: "c" })).toBe(true);
    expect(isSecondFactor(OK)).toBe(false);
  });

  it("asks the code, says when it is wrong, and gives the session", async () => {
    render(<FinestraAvviso />);
    const c = calls({ code: vi.fn().mockRejectedValueOnce(new Error("API: 401")).mockResolvedValue(OK) });
    const done = askSecondFactor({ second_factor: "code", challenge: "ch" }, c);
    const field = await screen.findByTestId("second-factor-code");
    fireEvent.change(field, { target: { value: "000000" } });
    fireEvent.click(screen.getByTestId("second-factor-go"));
    await screen.findByText(i18n.t("twoFactor.wrong"));
    fireEvent.change(field, { target: { value: "123456" } });
    fireEvent.click(screen.getByTestId("second-factor-go"));
    await expect(done).resolves.toEqual(OK);
    expect(c.code).toHaveBeenLastCalledWith("ch", "123456");
  });

  it("sets 2FA up when it is required, and shows the recovery codes before the session", async () => {
    render(<FinestraAvviso />);
    const c = calls();
    const done = askSecondFactor({ second_factor: "setup", challenge: "ch" }, c);
    expect((await screen.findByTestId("two-factor-secret")).textContent).toBe("JBSWY3DPEHPK3PXP");
    fireEvent.change(screen.getByTestId("two-factor-code"), { target: { value: "654321" } });
    fireEvent.click(screen.getByText(i18n.t("twoFactor.activate")));
    expect((await screen.findByTestId("recovery-codes")).textContent).toContain("CCCC-DDDD");
    fireEvent.click(screen.getByTestId("recovery-codes-done"));
    const r = await done;
    expect(r.token).toBe("t");
    expect("recovery_codes" in r).toBe(false);
  });

  it("closed without a code, the login fails", async () => {
    render(<FinestraAvviso />);
    // The rejection is caught at once: it comes while the test waits for the window to close.
    const done = askSecondFactor({ second_factor: "code", challenge: "ch" }, calls()).catch((e: unknown) => e);
    await screen.findByTestId("second-factor-code");
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("second-factor-code")).toBeNull());
    expect(await done).toBeInstanceOf(SecondFactorCancelled);
  });
});
