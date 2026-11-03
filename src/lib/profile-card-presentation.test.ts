import { describe, expect, it } from "vitest";
import { DEFAULT_PROFILE } from "../model";
import { createProfileCardSvg, decodeProfile, htmlEmbed, markdownEmbed, profileCardImageUrl } from "./share";

const profile = {
  ...DEFAULT_PROFILE,
  username: "aridev",
  name: "Ari Developer",
  title: "Frontend Engineer",
  avatar: "https://avatars.githubusercontent.com/u/42?v=4",
  links: [
    { id: "portfolio", title: "Portfolio", subtitle: "Selected work", url: "https://ari.example/work", icon: "link" as const },
    { id: "project", title: "Open-source project", subtitle: "", url: "https://github.com/aridev/project", icon: "code" as const }
  ],
  socials: { github: "aridev", x: "ari_dev", instagram: "", discord: "" }
};

describe("profile card presentation", () => {
  it("renders avatar and custom link labels in the SVG", () => {
    const svg = createProfileCardSvg(profile);
    expect(svg).toContain(profile.avatar);
    expect(svg).toContain("Portfolio");
    expect(svg).toContain("Open-source project");
    expect(svg).toContain("GitHub");
  });

  it("includes clickable custom and social links in Markdown", () => {
    const image = profileCardImageUrl("https://gitprofiles-xyz.vercel.app", profile);
    const markdown = markdownEmbed(profile, "https://gitprofiles-xyz.vercel.app/aridev", image);
    expect(markdown).toContain("[Portfolio](https://ari.example/work)");
    expect(markdown).toContain("[GitHub](https://github.com/aridev)");
    expect(decodeProfile(new URL(image).searchParams.get("profile")!)?.avatar).toBe(profile.avatar);
  });

  it("includes the card and actual links in HTML", () => {
    const image = profileCardImageUrl("https://gitprofiles-xyz.vercel.app", profile);
    const html = htmlEmbed(profile, "https://gitprofiles-xyz.vercel.app/aridev", image);
    expect(html).toContain("<img");
    expect(html).toContain('href="https://ari.example/work"');
    expect(html).toContain('href="https://github.com/aridev"');
  });
});
