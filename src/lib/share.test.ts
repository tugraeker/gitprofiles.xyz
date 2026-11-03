import { describe, expect, it } from "vitest";
import { DEFAULT_PROFILE } from "../model";
import { createProfileCardSvg, decodeProfile, encodeProfile, htmlEmbed, makeShareUrl, markdownEmbed, profileCardImageUrl, readSharedProfile } from "./share";

describe("shareable profiles", () => {
  it("round-trips Unicode profile data and custom links", () => {
    const token = encodeProfile({ ...DEFAULT_PROFILE, name: "Mira Yılmaz", bio: "Merhaba 👋", links: DEFAULT_PROFILE.links });
    expect(decodeProfile(token)?.name).toBe("Mira Yılmaz");
    expect(decodeProfile(token)?.bio).toBe("Merhaba 👋");
  });

  it("creates a public profile URL and resolves it back to the live profile", () => {
    const url = makeShareUrl("https://gitprofiles.xyz/", DEFAULT_PROFILE);
    expect(new URL(url).searchParams.get("view")).toBe("1");
    expect(readSharedProfile(url)?.username).toBe(DEFAULT_PROFILE.username);
  });

  it("creates a self-contained hosted profile card URL without embedding uploaded image data", () => {
    const profile = { ...DEFAULT_PROFILE, avatar: "data:image/png;base64,AA==" };
    const cardUrl = profileCardImageUrl("https://gitprofiles-xyz.vercel.app", profile);
    const parsed = new URL(cardUrl);
    expect(parsed.pathname).toBe("/api/profile-card");
    expect(decodeProfile(parsed.searchParams.get("profile")!)?.name).toBe(profile.name);
    expect(decodeProfile(parsed.searchParams.get("profile")!)?.avatar).toBe("");
    expect(decodeProfile(parsed.searchParams.get("profile")!)?.links).toEqual([]);
    expect(decodeProfile(parsed.searchParams.get("profile")!)?.socials.github).toBe("");
  });

  it("creates copy-ready README image embeds and an SVG card", () => {
    const url = "https://gitprofiles.xyz/?view=1#p=demo";
    expect(markdownEmbed(DEFAULT_PROFILE, url)).toContain("./profile-card.svg");
    expect(htmlEmbed(DEFAULT_PROFILE, url)).toContain("<img");
    expect(createProfileCardSvg(DEFAULT_PROFILE)).toContain("<svg");
  });
});
