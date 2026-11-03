import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PROFILE } from "../model";
import publishEndpoint from "../../api/publish-profile";

describe("authenticated profile relay", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("verifies the session and writes only for its authenticated owner", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "publishable-test-key");
    const ownerId = "9cda22a6-f3cf-4b25-8c8d-47be8c6f6d24";
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.endsWith("/auth/v1/user")) return Response.json({ id: ownerId });
      return new Response(null, { status: 201 });
    }));

    const maliciousDraft = { ...DEFAULT_PROFILE, username: "ari-dev", name: "Ari Dev", user_id: "another-owner" };
    const request = new Request("https://gitprofiles-xyz.vercel.app/api/publish-profile", {
      method: "POST",
      headers: { authorization: "Bearer eyJ.test.token", origin: "https://gitprofiles-xyz.vercel.app", "content-type": "application/json" },
      body: JSON.stringify(maliciousDraft)
    });
    const response = await publishEndpoint.fetch(request);
    expect(calls.length, await response.clone().text()).toBe(2);
    const savedRow = JSON.parse(String(calls[1].init?.body));

    expect(response.status).toBe(200);
    expect(calls.map((call) => call.url)).toEqual([
      "https://example.supabase.co/auth/v1/user",
      "https://example.supabase.co/rest/v1/profiles?on_conflict=user_id"
    ]);
    expect(savedRow.user_id).toBe(ownerId);
    expect(savedRow.user_id).not.toBe("another-owner");
    expect(calls[1].init?.headers).toMatchObject({ prefer: "resolution=merge-duplicates,return=minimal" });
  });

  it("rejects missing sessions and cross-origin requests before calling Supabase", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const unauthenticated = await publishEndpoint.fetch(new Request("https://gitprofiles-xyz.vercel.app/api/publish-profile", {
      method: "POST",
      body: JSON.stringify(DEFAULT_PROFILE)
    }));
    const crossOrigin = await publishEndpoint.fetch(new Request("https://gitprofiles-xyz.vercel.app/api/publish-profile", {
      method: "POST",
      headers: { authorization: "Bearer eyJ.test.token", origin: "https://attacker.invalid" },
      body: JSON.stringify(DEFAULT_PROFILE)
    }));

    expect(unauthenticated.status).toBe(401);
    expect(crossOrigin.status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });
});
