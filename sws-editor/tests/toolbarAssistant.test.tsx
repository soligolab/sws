/** «AI assistant» in the editor toolbar (20-11-2026): the detached chat in one
 *  click, the open window brought forward, nothing for who is not Admin. */
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { createRef } from "react";
import "../src/i18n/index";
import { EditorToolbar } from "../src/editor/EditorToolbar";
import { registraComandiChat } from "../src/ai/comandiChat";
import { useAppStore } from "../src/store";
import type { CanvasViewApi } from "../src/canvas/SvgCanvas";

afterEach(() => { cleanup(); act(() => registraComandiChat(null)); });

function setup(role: string, staccata: boolean) {
  const apri = vi.fn();
  const stacca = vi.fn();
  act(() => {
    useAppStore.setState({ authRole: role } as never);
    registraComandiChat({ apri, stacca, aperta: false, staccata });
  });
  render(<EditorToolbar viewApi={createRef<CanvasViewApi>()} zoom={1} canFitPage />);
  return { apri, stacca };
}

describe("the AI assistant button of the toolbar", () => {
  it("opens the chat in its own window", () => {
    const { apri, stacca } = setup("Admin", false);
    fireEvent.click(screen.getByTestId("toolbar-assistant"));
    expect(stacca).toHaveBeenCalledTimes(1);
    expect(apri).not.toHaveBeenCalled();
  });

  it("brings the window forward when the chat is already detached", () => {
    const { apri, stacca } = setup("Admin", true);
    fireEvent.click(screen.getByTestId("toolbar-assistant"));
    expect(apri).toHaveBeenCalledTimes(1);
    expect(stacca).not.toHaveBeenCalled();
  });

  it("is not there for who is not Admin", () => {
    setup("Operator", false);
    expect(screen.queryByTestId("toolbar-assistant")).toBeNull();
  });
});
