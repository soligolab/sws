import { describe, expect, it } from "vitest";
import { conModifica, patchDaBozza, zoneDaTesto } from "../src/config/schede/usersDraft";

const u = {
  username: "op", role: "Operator" as const, must_change_password: false, created_at_ms: 1, updated_at_ms: 1,
  session_ttl_secs: null, allowed_zones: ["a"], display_name: "Op",
};

describe("the draft of the Users page", () => {
  it("asks only for what differs", () => {
    expect(patchDaBozza(u, { role: "Operator", zones: "a,", display_name: " Op " })).toEqual({});
    expect(patchDaBozza(u, { display_name: "" })).toEqual({ display_name: null });
    expect(patchDaBozza(u, { session_ttl_secs: 0, must_change_password: true })).toEqual({
      session_ttl_secs: 0, must_change_password: true,
    });
    expect(patchDaBozza(u, { zones: "a, b ,," })).toEqual({ allowed_zones: ["a", "b"] });
  });

  it("drops a user whose draft is back to the server's values", () => {
    const one = conModifica({}, u, { role: "Admin" });
    expect(one).toEqual({ op: { role: "Admin" } });
    expect(conModifica(one, u, { role: "Operator" })).toEqual({});
  });

  it("reads the zones as typed", () => {
    expect(zoneDaTesto(" z1 , ,z2,")).toEqual(["z1", "z2"]);
  });
});
