import { describe, expect, it } from "vitest";
import { DEFAULT_PROFILE } from "../model";
import { encodeProfile } from "../lib/share";
import cardEndpoint from "../../api/profile-card";

describe("README profile card endpoint", () => {
  it("serves a self-contained SVG card with cache headers", async () => {
    const profile = { ...DEFAULT_PROFILE, name: "Ari Developer" };
    const request = new Request("https://gitprofiles-xyz.vercel.app/api/profile-card?profile=" + encodeProfile(profile));
    const response = await cardEndpoint.fetch(request);
    const svg = await response.text();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("image/svg+xml");
    expect(response.headers.get("cache-control")).toContain("s-maxage=300");
    expect(svg).toContain("<svg");
    expect(svg).toContain("Ari Developer");
  });

  it("escapes untrusted profile text before returning SVG", async () => {
    const profile = { ...DEFAULT_PROFILE, name: "<script>alert(1)</script>" };
    const request = new Request("https://gitprofiles-xyz.vercel.app/api/profile-card?profile=" + encodeProfile(profile));
    const response = await cardEndpoint.fetch(request);
    const svg = await response.text();
    expect(response.status).toBe(200);
    expect(svg).not.toContain("<script>");
    expect(svg).toContain("&lt;script&gt;");
  });

  it("rejects invalid and oversized card payloads", async () => {
    const invalid = await cardEndpoint.fetch(new Request("https://gitprofiles-xyz.vercel.app/api/profile-card?profile=invalid"));
    const oversized = await cardEndpoint.fetch(new Request("https://gitprofiles-xyz.vercel.app/api/profile-card?profile=" + "a".repeat(16001)));
    expect(invalid.status).toBe(400);
    expect(oversized.status).toBe(413);
  });
});