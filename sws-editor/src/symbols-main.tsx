// Entry point of the symbol editor's own window (22-11-2026), twin of
// `chat-main.tsx`: the order of the calls matters, see `setForceLocalApi`.

import { avvia } from "@/avvio";
import { segnaFinestraSimboli } from "@/symbols/editor/ponteSimboli";
import { FinestraSimboli } from "@/symbols/editor/FinestraSimboli";

segnaFinestraSimboli();
void avvia(FinestraSimboli, { apiLocale: true });
