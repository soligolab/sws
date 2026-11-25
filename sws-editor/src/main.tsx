import { avvia } from "@/avvio";
import { keepStreamsAlive } from "@/ws/streamPolicy";
import { RuntimeViewer } from "./viewer/RuntimeViewer";

// The viewer of a panel: nobody loads the page again, so the live streams
// never give up (`ws/streamPolicy.ts`).
keepStreamsAlive();
void avvia(RuntimeViewer, { controlPanel: true });
