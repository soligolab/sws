// Configuration → Instance → Device → «Screen and access» (14-11-2026): the
// project fields about how the device behaves. Only an Admin writes the project.

import { DeviceScreenSettings } from "@/editor/DeviceScreenSettings";
import type { IdScheda } from "@/config/schede";

export function DeviceScreenTab(_: { scheda: IdScheda }) {
  return <DeviceScreenSettings />;
}
