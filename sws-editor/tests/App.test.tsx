import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { App } from "../src/App";

// Minimal smoke test — verifies the app shell renders without crashing.
describe("App", () => {
  it("renders mode toggle buttons", () => {
    render(<App />);
    expect(screen.getByText("Edit")).toBeDefined();
    expect(screen.getByText("View")).toBeDefined();
  });
});
