import { afterEach, describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import App from "./App";

describe("developer profile studio", () => {
  afterEach(() => {
    Reflect.deleteProperty(globalThis, "window");
    Reflect.deleteProperty(globalThis, "localStorage");
  });

  it("renders an empty editor beside a live profile preview", () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { location: new URL("http://localhost/") }
    });
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: { getItem: () => null }
    });

    const html = renderToString(createElement(App));
    expect(html).toContain("Set the essentials");
    expect(html).toContain("Live preview");
    expect(html).toContain("Sign in with GitHub");
    expect(html).toContain("Share profile");
    expect(html).toContain("gitprofiles.xyz/<!-- -->your-name");
    expect(html).toContain("Image");
    expect(html).toContain("Video");
    expect(html).not.toContain("Deniz Kaya");
    expect(html).not.toContain("Selected work");
    expect(html).not.toContain("README preview");
  });
});
