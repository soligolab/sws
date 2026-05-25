// Frontend role gates. Mirror of the backend hierarchy in
// sws-runtime/crates/sws-auth/src/lib.rs (Viewer < Operator < Supervisor < Admin).
//
// Operator is a runtime-only role (read live values, write tag values
// from buttons/sliders, ACK alarms). Editor + project configuration are
// Supervisor+.

import type { Role } from "@/store";

export const canEditProject = (r: Role | null): boolean =>
  r === "Supervisor" || r === "Admin";

export const canConfigureProject = (r: Role | null): boolean =>
  r === "Supervisor" || r === "Admin";
