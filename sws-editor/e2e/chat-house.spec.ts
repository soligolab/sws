import { expect } from "@playwright/test";
import { test, ensureLoggedIn, authHeaders, modelloDellaChat } from "./fixtures";
import { ADMIN } from "./_env";

/**
 * The fixed bench of the house (plan 2026-11-10-assistente-secondo-giro, G2):
 * from the request in chat to the page «Casa» on disk, drawn on its floor
 * plan, with the lights, the shutters and the climate bound to the variables
 * the project already has.
 *
 * # How to run it
 *
 * Not by hand: `./scripts/bench_house.sh` copies the bench project
 * (`tests/fixtures/ai-bench/house/`) into `sws/tmp/bench-house/`, starts a
 * throwaway IDE and stops it at the end. Two ways:
 *
 *   - fake (default): the fake agent replays `house-floor-plan.json`. The
 *     test checks the drawing in chat, the diff, Apply and Save — the
 *     deterministic proof;
 *   - `--real`: a real model, which costs money. The test plays the person:
 *     sends the request, answers «procedi» when the turn stops without a
 *     proposal, applies and saves when the proposal comes, and leaves the
 *     picture of the page in `SWS_BENCH_DIR`. The report (rounds, tokens,
 *     cost, minutes) is written by the runtime (`SWS_AI_MISURE`). The vote
 *     from 1 to 5 stays the maintainer's.
 */

const PROJECT = "bench-house";
const REAL = process.env.SWS_AI_VERO === "1";
const REQUEST =
  "Disegna nella pagina Casa la pianta del mio appartamento, 12 per 8 metri: soggiorno a nord-ovest (7 × 5 m), " +
  "camera a nord-est, cucina a sud-ovest (4 × 3 m), ingresso al centro con la porta a sud, bagno a sud-est. " +
  "Finestre a nord in soggiorno e in camera, a ovest in cucina, a est in bagno. Metti una luce per stanza, " +
  "le tapparelle alle finestre con la loro apertura, i contatti delle finestre e il clima, " +
  "usando le variabili che ci sono già.";
const GO_ON = "Va bene così, procedi con la proposta della pagina intera.";

test("the bench of the house: from the chat to the page Casa on disk", async ({ page, request }) => {
  test.setTimeout(REAL ? 45 * 60_000 : 120_000);
  if (!REAL && !(process.env.SWS_AI_FAKE ?? "").includes("house-floor-plan")) {
    test.skip(true, "needs the runtime of scripts/bench_house.sh (SWS_AI_FAKE here too)");
  }

  let headers = await authHeaders(request);
  await request.post(`${ADMIN}/api/projects/${PROJECT}/open`, { headers });
  headers = await authHeaders(request);
  await page.addInitScript(() => {
    try { localStorage.setItem("sws.chatPanel.open", "1"); } catch { /* storage denied */ }
  });
  await page.goto(`${ADMIN}/`, { waitUntil: "networkidle" });
  await ensureLoggedIn(page);
  await page.waitForTimeout(1500);
  const card = page.getByRole("button", { name: new RegExp(PROJECT) }).first();
  if (await card.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await card.click();
    await page.waitForTimeout(2000);
  }

  const composer = page.getByPlaceholder(/Scrivi qui/);
  await expect(composer).toBeVisible();
  const chat = page.locator("aside").filter({ has: composer }).last();
  const model = await modelloDellaChat(chat);
  if (REAL) expect(model).not.toMatch(/finto|nessuna chiave/i);
  else expect(model).toMatch(/finto/i);

  await composer.fill(REQUEST);
  await composer.press("Enter");

  const apply = chat.getByRole("button", { name: "Applica", exact: true });
  if (REAL) {
    // The person: when a turn ends without a proposal (after the plan in
    // words, after the drafts) answers «procedi», three times at most.
    let answers = 0;
    const end = Date.now() + 40 * 60_000;
    while (!(await apply.isVisible())) {
      expect(Date.now(), "no proposal in 40 minutes").toBeLessThan(end);
      await page.waitForTimeout(10_000);
      const working = await chat.getByRole("button", { name: /Sto lavorando/ }).count();
      if (working === 0 && !(await apply.isVisible())) {
        expect(answers, "three «procedi» without a proposal").toBeLessThan(3);
        await composer.fill(GO_ON);
        await composer.press("Enter");
        answers++;
        await page.waitForTimeout(5_000);
      }
    }
  } else {
    await apply.waitFor({ state: "visible", timeout: 60_000 });
    // The person sees the floor plan and the drafted shutter before the proposal.
    await expect(chat.getByTestId("chat-floor-plan")).toHaveCount(1);
    const text = await chat.innerText();
    expect(text).toContain("Tapparella con apertura");
    // And the diff says what gets written besides the page.
    expect(text).toContain("planimetria «Casa»");
    expect(text).toContain("images/ai-floor-plan-casa.svg");
  }

  await apply.click();
  await expect(chat).toContainText("Applicata", { timeout: 10_000 });
  await page.getByRole("button", { name: /non salvato/ }).click();
  await page.waitForTimeout(3000);

  const project = await (await request.get(`${ADMIN}/api/project`, { headers })).json();
  const pg = await (await request.get(`${ADMIN}/api/synoptics/casa`, { headers })).json();
  const objects: Array<{ type: string; symbol_id?: string; fill_level_tag?: string }> = pg.objects ?? [];
  const prj = objects.filter((o) => o.symbol_id?.startsWith("prj:")).length;
  const lib = objects.filter((o) => o.symbol_id?.startsWith("lib:")).length;
  const plans: Array<{ id: string }> = await (await request.get(`${ADMIN}/api/planimetrie`, { headers })).json();

  const dir = process.env.SWS_BENCH_DIR;
  if (dir) {
    // The whole page in the picture, not the slice the canvas shows, and
    // large enough to judge it.
    await page.setViewportSize({ width: 2200, height: 1300 });
    await page.getByRole("button", { name: /Adatta pagina/ }).click().catch(() => {});
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${dir}/page.png`, fullPage: true });
  }
  // The page is on a floor plan, and its drawing is in the project.
  expect(String(pg.sfondo_immagine ?? "")).toMatch(/^\/api\/project\/images\/ai-floor-plan-.+\.svg$/);
  const drawing = await request.get(`${ADMIN}${pg.sfondo_immagine}`, { headers });
  expect(drawing.status()).toBe(200);
  expect(drawing.headers()["content-type"]).toContain("image/svg+xml");
  expect(plans.length, "the floor plan is in planimetrie/").toBeGreaterThan(0);
  // And the person finds it in the left panel, without reloading.
  await expect(page.getByTestId(`planimetria-${plans[0].id}`)).toBeVisible();
  if (REAL) {
    if (dir) {
      const fs = await import("node:fs");
      fs.writeFileSync(`${dir}/counts.json`, JSON.stringify({
        new_symbols: (project.simboli ?? []).length, objects: objects.length, prj, lib,
        tags: (project.tags ?? []).length, floor_plans: plans.map((p) => p.id),
      }, null, 2));
    }
    expect(prj + lib, "the page has the things of a house").toBeGreaterThan(5);
  } else {
    expect(plans.map((p) => p.id)).toEqual(["casa"]);
    const plan = await (await request.get(`${ADMIN}/api/planimetrie/casa`, { headers })).json();
    expect(plan.muri.length).toBe(4);
    expect(plan.aperture.length).toBe(9);
    expect((project.simboli ?? []).length).toBe(1);
    // Bound to the variables that exist: none added.
    expect((project.tags ?? []).length).toBe(15);
    expect({ prj, lib }).toEqual({ prj: 3, lib: 8 });
    expect(objects.filter((o) => o.fill_level_tag?.startsWith("tapparella.")).length).toBe(3);
  }
});
