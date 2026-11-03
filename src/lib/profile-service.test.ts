import { afterEach, describe, expect, it } from "vitest";
import { blankProfile, normalizeUsername, profileRoute, validateUsername } from "./profile-service";

describe("profile routes and handles", () => {
  afterEach(() => Reflect.deleteProperty(globalThis, "window"));

  it("normalizes profile handles and blocks reserved routes", () => {
    expect(normalizeUsername(" Firux Dev ")).toBe("firuxdev");
    expect(validateUsername("a")).toContain("two characters");
    expect(validateUsername("dashboard")).toContain("reserved");
    expect(validateUsername("firuxdev")).toBeNull();
  });

  it("binds dashboard, auth callback, and public handle routes", () => {
    Object.defineProperty(globalThis, "window", { configurable: true, value: { location: { pathname: "/dashboard" } } });
    expect(profileRoute()).toEqual({ kind: "dashboard" });
    Object.defineProperty(globalThis, "window", { configurable: true, value: { location: { pathname: "/auth/callback" } } });
    expect(profileRoute()).toEqual({ kind: "callback" });
    Object.defineProperty(globalThis, "window", { configurable: true, value: { location: { pathname: "/FiruxDev" } } });
    expect(profileRoute()).toEqual({ kind: "public", username: "firuxdev" });
  });

  it("starts from an identity-free editable profile", () => {
    const profile = blankProfile();
    expect(profile.username).toBe("");
    expect(profile.name).toBe("");
    expect(profile.links).toEqual([]);
    expect(profile.socials.github).toBe("");
  });
});
