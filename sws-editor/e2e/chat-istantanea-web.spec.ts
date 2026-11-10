import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect } from "@playwright/test";
import { test, apriChatDellIde, modelloDellaChat } from "./fixtures";

/**
 * La foto di una pagina di un progetto **web** la fa il browser dell'IDE
 * (decisione del maintainer, 10-11-2026): il server manda `fotografa` alla
 * chat, l'IDE disegna con lo stesso `SvgCanvas` dell'editor e risponde col PNG,
 * che torna in chat come immagine. Il viewer LVGL non c'entra.
 *
 * # Come si lancia
 *
 *     SWS_AI_FAKE=$PWD/sws-runtime/crates/sws-web/tests/ai/istantanea-web.json \
 *       ./scripts/start_editor_develop.sh --instance 5 --no-spa
 *     # primo accesso: il codice che l'IDE stampa all'avvio
 *     curl -X POST http://localhost:8468/api/identita/primo-amministratore \
 *       -H 'Content-Type: application/json' \
 *       -d '{"codice":"<codice>","email":"admin@prova.local","password":"Segretissima-1"}'
 *     cd sws-editor && SWS_E2E_ADMIN=http://localhost:8468 \
 *       SWS_ADMIN_USER=admin@prova.local SWS_ADMIN_PASSWORD=Segretissima-1 \
 *       SWS_AI_FAKE=istantanea-web npx playwright test e2e/chat-istantanea-web.spec.ts
 *
 * `SWS_AI_FAKE` va dato **anche** a playwright (basta il nome): il runtime può
 * girare con un altro copione, e questo test si salta invece di provare la cosa
 * sbagliata. Le due foto finiscono in `tmp/istantanea-web/` del checkout, dove
 * il maintainer le vede (`SWS_E2E_FOTO_DIR` per un'altra cartella). Provato il
 * 10-11-2026: verde in 12 s.
 */

const PROGETTO = "e2e-istantanea-web";

test("la foto di una pagina web la fa il browser dell'IDE", async ({ page, request }) => {
  test.skip(!(process.env.SWS_AI_FAKE ?? "").includes("istantanea-web"),
            "serve il runtime col copione istantanea-web.json (e SWS_AI_FAKE anche qui)");
  test.setTimeout(150_000);
  await apriChatDellIde(page, request, PROGETTO);

  const composizione = page.getByPlaceholder(/Scrivi qui/);
  await expect(composizione).toBeVisible();
  const chat = page.locator("aside").filter({ has: page.getByPlaceholder(/Scrivi qui/) }).last();
  const testoChat = await modelloDellaChat(chat);
  if (!testoChat.includes("finto")) test.skip(true, "runtime avviato senza SWS_AI_FAKE");

  await composizione.fill("disegna la gabbia e fammi vedere la pagina");
  await composizione.press("Enter");

  // Due foto: la pagina intera del copione (bozza prj: + pompa di libreria) e
  // una pagina del disco.
  const foto = chat.locator('img[src^="data:image/png;base64,"]');
  await expect(foto).toHaveCount(2, { timeout: 90_000 });
  const testi = await chat.locator("a[title]").evaluateAll((a) => a.map((x) => x.getAttribute("title") ?? ""));
  const web = testi.filter((t) => t.includes("Istantanea web"));
  expect(web).toHaveLength(2);
  expect(web[0]).toContain("800x480");

  // playwright gira da sws-editor/: la cartella è quella del checkout.
  const dir = process.env.SWS_E2E_FOTO_DIR ?? resolve(process.cwd(), "../tmp/istantanea-web");
  mkdirSync(dir, { recursive: true });
  const srcs = await foto.evaluateAll((img) => img.map((x) => (x as HTMLImageElement).src));
  srcs.forEach((s, i) => {
    const png = Buffer.from(s.replace(/^data:image\/png;base64,/, ""), "base64");
    // La misura sta nell'intestazione: la prima foto è alla misura della pagina.
    if (i === 0) expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([800, 480]);
    writeFileSync(resolve(dir, i === 0 ? "pagina-composta.png" : "pagina-del-disco.png"), png);
  });
});
