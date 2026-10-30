/** Il logo nel tema chiaro (30-10-2026): la scritta «SWS» del logo standard è
 *  chiara, e sulla schermata d'accesso in tema chiaro quasi non si vedeva. */
import { render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { BrandLogo } from "../src/components/BrandLogo";

afterEach(() => { document.documentElement.removeAttribute("data-theme"); });

describe("BrandLogo", () => {
  it("nel tema scuro il logo di sempre", () => {
    document.documentElement.setAttribute("data-theme", "dark");
    const { container } = render(<BrandLogo />);
    expect(container.querySelector("img")?.getAttribute("src")).toBe("/branding/sws/logo.svg");
  });
  it("nel tema chiaro la variante chiara, se il marchio ce l'ha", () => {
    document.documentElement.setAttribute("data-theme", "light");
    const { container } = render(<BrandLogo />);
    expect(container.querySelector("img")?.getAttribute("src")).toBe("/branding/sws/logo-chiaro.svg");
  });
});
