/** An export that an import would refuse is still saved, and the menu says why
 *  (decision D11 of the CRA sessions, maintainer's request of 18-11-2026). */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, beforeEach, vi } from "vitest";

const { exportProjectZip } = vi.hoisted(() => ({ exportProjectZip: vi.fn() }));
vi.mock("@/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/api/client")>("@/api/client");
  return { ...actual, api: { ...actual.api, exportProjectZip } };
});

import "../src/i18n/index";
import { MainMenu } from "../src/components/MainMenu";
import { useAppStore } from "../src/store";

function zipResponse(headers: Record<string, string>) {
  return new Response(new Blob(["PK"]), {
    headers: { "content-disposition": 'attachment; filename="sws-project-x.zip"', ...headers },
  });
}

async function exportOnce() {
  render(
    <MainMenu onLogout={() => {}} onCloseProject={() => {}} logOpen={false} onToggleLog={() => {}} onStaccaLog={() => {}} />,
  );
  fireEvent.click(screen.getByRole("button", { name: /menu/i }));
  fireEvent.click(screen.getByText(/salva copia sul pc|save a copy/i));
}

describe("export that an import would refuse", () => {
  beforeEach(() => {
    exportProjectZip.mockReset();
    useAppStore.setState({ authRole: "Admin" } as never);
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();
  });

  it("says the file is saved and why it would be refused", async () => {
    exportProjectZip.mockResolvedValue(
      zipResponse({ "x-sws-export-warning": "the archive is 9.2 MB, and an import or a deploy accepts at most 8 MB" }),
    );
    await exportOnce();
    await waitFor(() => expect(screen.getByText(/sws-project-x\.zip.*accepts at most 8 MB/)).toBeTruthy());
  });

  it("without the warning, only the file name", async () => {
    exportProjectZip.mockResolvedValue(zipResponse({}));
    await exportOnce();
    await waitFor(() => expect(screen.getByText("✓ sws-project-x.zip")).toBeTruthy());
  });
});
