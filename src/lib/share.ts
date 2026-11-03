import { DEFAULT_PROFILE, SOCIAL_LABELS, THEMES, type BackgroundKind, type Profile, type ProfileLink, type SocialKey } from "../model.js";

const SOCIAL_KEYS: SocialKey[] = ["github", "x", "instagram", "discord"];
const COLOR = /^#[0-9a-f]{6}$/i;
const allowedIcons = new Set(["code", "chat", "music", "video", "link"]);
const allowedModes = new Set(["aurora", "gradient", "solid"]);
const allowedBackgrounds = new Set(["color", "image", "video"]);
const allowedThemes = new Set(Object.keys(THEMES));

export function safeHttpUrl(value: string): string {
  const text = String(value ?? "").trim();
  if (!text) return "";
  try {
    const url = new URL(/^https?:\/\//i.test(text) ? text : "https://" + text);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}

export function normalizeProfile(input: unknown): Profile | null {
  if (!input || typeof input !== "object") return null;
  const source = input as Record<string, unknown>;
  const text = (key: string, fallback: string, max = 500) =>
    typeof source[key] === "string" ? source[key].slice(0, max) : fallback;
  const theme = allowedThemes.has(String(source.theme)) ? source.theme as Profile["theme"] : DEFAULT_PROFILE.theme;
  const links: ProfileLink[] = Array.isArray(source.links)
    ? source.links.slice(0, 12).filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object")).map((item, index) => ({
      id: typeof item.id === "string" ? item.id.slice(0, 40) : "link-" + index,
      title: typeof item.title === "string" ? item.title.slice(0, 90) : "",
      subtitle: typeof item.subtitle === "string" ? item.subtitle.slice(0, 140) : "",
      url: typeof item.url === "string" ? safeHttpUrl(item.url) : "",
      icon: allowedIcons.has(String(item.icon)) ? item.icon as ProfileLink["icon"] : "link"
    }))
    : DEFAULT_PROFILE.links.map((link) => ({ ...link }));
  const rawSocials = source.socials && typeof source.socials === "object" ? source.socials as Record<string, unknown> : {};
  const socials = Object.fromEntries(SOCIAL_KEYS.map((key) => [key, typeof rawSocials[key] === "string" ? rawSocials[key].slice(0, 180) : ""])) as Profile["socials"];
  const avatar = typeof source.avatar === "string" ? source.avatar.slice(0, 80_000) : "";
  const validAvatar = /^https?:\/\//i.test(avatar) || /^data:image\/(?:png|jpe?g|webp);base64,/i.test(avatar);

  return {
    username: text("username", DEFAULT_PROFILE.username, 39).replace(/[^a-z0-9-]/gi, "").slice(0, 39),
    name: text("name", DEFAULT_PROFILE.name, 90),
    title: text("title", DEFAULT_PROFILE.title, 100),
    bio: text("bio", DEFAULT_PROFILE.bio, 300),
    location: text("location", DEFAULT_PROFILE.location, 90),
    avatar: validAvatar ? avatar : "",
    accent: typeof source.accent === "string" && COLOR.test(source.accent) ? source.accent : THEMES[theme].accent,
    backgroundStart: typeof source.backgroundStart === "string" && COLOR.test(source.backgroundStart) ? source.backgroundStart : THEMES[theme].start,
    backgroundEnd: typeof source.backgroundEnd === "string" && COLOR.test(source.backgroundEnd) ? source.backgroundEnd : THEMES[theme].end,
    backgroundMode: allowedModes.has(String(source.backgroundMode)) ? source.backgroundMode as Profile["backgroundMode"] : "aurora",
    backgroundKind: allowedBackgrounds.has(String(source.backgroundKind)) ? source.backgroundKind as BackgroundKind : "color",
    backgroundImage: typeof source.backgroundImage === "string" ? safeHttpUrl(source.backgroundImage) : "",
    backgroundVideo: typeof source.backgroundVideo === "string" ? safeHttpUrl(source.backgroundVideo) : "",
    theme,
    availability: typeof source.availability === "boolean" ? source.availability : false,
    links,
    socials
  };
}

export function validateShareableProfile(profile: Profile): string | null {
  if (!profile.name.trim()) return "Profil adı boş kalamaz.";
  if (!profile.username.trim()) return "Önce profil adresini belirle.";
  if (profile.links.length > 12) return "En fazla 12 bağlantı ekleyebilirsin.";
  for (const item of profile.links) {
    if (!item.title.trim() && !item.subtitle.trim() && !item.url.trim()) continue;
    if (!item.title.trim()) return "Her link kartına bir başlık ekle.";
    if (!safeHttpUrl(item.url)) return "“" + item.title + "” için geçerli bir https:// bağlantısı gir.";
  }
  if (profile.backgroundKind === "image" && !safeHttpUrl(profile.backgroundImage)) return "Arka plan görseli için bir https:// bağlantısı ekle.";
  if (profile.backgroundKind === "video" && !safeHttpUrl(profile.backgroundVideo)) return "Video arka planı için bir https:// bağlantısı ekle.";
  return null;
}

function toBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string): string {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - base64.length % 4) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function encodeProfile(profile: Profile): string {
  return toBase64Url(JSON.stringify(profile));
}

export function decodeProfile(token: string): Profile | null {
  try {
    return normalizeProfile(JSON.parse(fromBase64Url(token)));
  } catch {
    return null;
  }
}

export function makeShareUrl(baseUrl: string, profile: Profile): string {
  const url = new URL(baseUrl);
  url.searchParams.set("view", "1");
  url.hash = "p=" + encodeProfile(profile);
  return url.href;
}

export function readSharedProfile(urlValue: string): Profile | null {
  try {
    const url = new URL(urlValue);
    if (url.searchParams.get("view") !== "1") return null;
    return decodeProfile(new URLSearchParams(url.hash.slice(1)).get("p") ?? "");
  } catch {
    return null;
  }
}

const xml = (value: string) => value.replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;"
})[char]!);

function cardText(value: string, maximum: number): string {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > maximum ? text.slice(0, maximum - 1).trimEnd() + "…" : text;
}

function cardAvatar(value: string): string {
  const avatar = String(value ?? "").trim();
  if (/^data:image\/(?:png|jpe?g|webp);base64,[a-z0-9+/=_-]+$/i.test(avatar) && avatar.length <= 7500) return avatar;
  const url = safeHttpUrl(avatar);
  return url.startsWith("https://") && url.length <= 2048 ? url : "";
}

function socialUrl(social: SocialKey, value: string): string {
  const text = value.trim();
  if (!text) return "";
  if (social === "discord") return safeHttpUrl(text);
  const host = social === "github" ? "github.com" : social === "x" ? "x.com" : "instagram.com";
  return safeHttpUrl(text.includes("://") ? text : "https://" + host + "/" + text.replace(/^@/, ""));
}

function profileOutboundLinks(profile: Profile): Array<{ label: string; url: string }> {
  const custom = profile.links.flatMap((link) => {
    const url = safeHttpUrl(link.url);
    const label = cardText(link.title || link.subtitle || (url ? new URL(url).hostname : ""), 80);
    return url && label ? [{ label, url }] : [];
  });
  const social = SOCIAL_KEYS.flatMap((key) => {
    const url = socialUrl(key, profile.socials[key]);
    return url ? [{ label: SOCIAL_LABELS[key], url }] : [];
  });
  return [...custom, ...social];
}

function markdownLabel(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/([\[\]])/g, "\\$1").replace(/[\r\n]+/g, " ");
}

function markdownDestination(value: string): string {
  const text = value.trim();
  const destination = text.startsWith("./") || text.startsWith("../") || text.startsWith("/") ? text : safeHttpUrl(text);
  return destination.replace(/\\/g, "%5C").replace(/ /g, "%20").replace(/\(/g, "%28").replace(/\)/g, "%29");
}

export function createProfileCardSvg(profile: Profile): string {
  const accent = COLOR.test(profile.accent) ? profile.accent : THEMES[profile.theme].accent;
  const first = xml(cardText(profile.name || "Your name", 30));
  const title = xml(cardText(profile.title || "Developer · maker · human", 52));
  const handle = xml("@" + (profile.username.trim() || "your-profile"));
  const initial = xml((profile.name.trim() || "G").charAt(0).toUpperCase());
  const avatar = cardAvatar(profile.avatar);
  const bio = cardText(profile.bio, 92);
  const links = profile.links.flatMap((link) => {
    const url = safeHttpUrl(link.url);
    const label = cardText(link.title || link.subtitle, 30);
    if (!url || !label) return [];
    return [{ label, url, domain: cardText(new URL(url).hostname.replace(/^www\./, ""), 32) }];
  }).slice(0, 4);
  const socials = SOCIAL_KEYS.flatMap((key) => {
    const url = socialUrl(key, profile.socials[key]);
    return url ? [{ label: SOCIAL_LABELS[key], url }] : [];
  });
  const cardWidth = links.length ? Math.min(320, (1040 - (links.length - 1) * 14) / links.length) : 320;
  const linkCards = links.map((link, index) => {
    const x = 80 + index * (cardWidth + 14);
    return '<a href="' + xml(link.url) + '" target="_blank" rel="noopener noreferrer"><rect x="' + x + '" y="366" width="' + cardWidth + '" height="82" rx="14" fill="#ffffff" fill-opacity=".045" stroke="#ffffff" stroke-opacity=".12"/><circle cx="' + (x + 25) + '" cy="407" r="13" fill="' + accent + '" fill-opacity=".15"/><text x="' + (x + 25) + '" y="412" text-anchor="middle" fill="' + accent + '" font-family="Arial,sans-serif" font-size="17">↗</text><text x="' + (x + 48) + '" y="402" fill="#f5f5ef" font-family="Arial,sans-serif" font-size="16" font-weight="700">' + xml(link.label) + '</text><text x="' + (x + 48) + '" y="426" fill="#98a39d" font-family="Arial,sans-serif" font-size="12">' + xml(link.domain) + '</text></a>';
  }).join("");
  const socialPills = socials.map((social, index) => {
    const x = 82 + index * 154;
    return '<a href="' + xml(social.url) + '" target="_blank" rel="noopener noreferrer"><rect x="' + x + '" y="474" width="136" height="34" rx="17" fill="#ffffff" fill-opacity=".035" stroke="' + accent + '" stroke-opacity=".34"/><text x="' + (x + 68) + '" y="496" text-anchor="middle" fill="#dce2db" font-family="Arial,sans-serif" font-size="13">' + xml(social.label) + '</text></a>';
  }).join("");
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" role="img" aria-labelledby="profile-title">',
    '<title id="profile-title">' + first + ' — gitprofiles.xyz profile</title>',
    '<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="' + xml(profile.backgroundStart) + '"/><stop offset="1" stop-color="' + xml(profile.backgroundEnd) + '"/></linearGradient><clipPath id="avatar-clip"><circle cx="151" cy="187" r="64"/></clipPath></defs>',
    '<rect width="1200" height="630" fill="url(#bg)"/>',
    '<circle cx="1090" cy="36" r="224" fill="' + accent + '" opacity=".07"/>',
    '<rect x="42" y="38" width="1116" height="554" rx="22" fill="#101714" fill-opacity=".82" stroke="#ffffff" stroke-opacity=".13"/>',
    '<circle cx="151" cy="187" r="70" fill="' + accent + '" fill-opacity=".12" stroke="' + accent + '" stroke-opacity=".48" stroke-width="1.5"/>',
    avatar ? '<image href="' + xml(avatar) + '" x="87" y="123" width="128" height="128" preserveAspectRatio="xMidYMid slice" clip-path="url(#avatar-clip)"/>' : '<text x="151" y="207" text-anchor="middle" fill="#f4f5ef" font-family="Arial,sans-serif" font-size="54" font-weight="700">' + initial + '</text>',
    '<text x="270" y="132" fill="#aab4ad" font-family="Arial,sans-serif" font-size="15">' + handle + '</text>',
    '<text x="270" y="185" fill="#f5f5ef" font-family="Arial,sans-serif" font-size="42" font-weight="700">' + first + '</text>',
    '<text x="270" y="222" fill="' + accent + '" font-family="Arial,sans-serif" font-size="21">' + title + '</text>',
    bio ? '<text x="270" y="262" fill="#b7c0ba" font-family="Arial,sans-serif" font-size="17">' + xml(cardText(bio, 92)) + '</text>' : "",
    profile.location.trim() ? '<text x="270" y="291" fill="#87928c" font-family="Arial,sans-serif" font-size="14">' + xml(cardText(profile.location, 48)) + '</text>' : "",
    '<text x="80" y="344" fill="#d9ded8" font-family="Arial,sans-serif" font-size="15" font-weight="600">Links</text>',
    linkCards || '<text x="80" y="397" fill="#8f9a93" font-family="Arial,sans-serif" font-size="15">Add a link to show it here</text>',
    socialPills,
    '<path d="M80 532H1120" stroke="#ffffff" stroke-opacity=".1"/>',
    '<text x="80" y="560" fill="#8f9a93" font-family="Arial,sans-serif" font-size="14">gitprofiles.xyz</text>',
    '<text x="1120" y="560" text-anchor="end" fill="#8f9a93" font-family="Arial,sans-serif" font-size="13">' + handle + '</text>',
    '</svg>'
  ].join("");
}

export function profileCardImageUrl(baseUrl: string, profile: Profile): string {
  const links = profile.links.flatMap((link) => {
    const url = safeHttpUrl(link.url);
    const title = cardText(link.title, 34);
    if (!url || !title) return [];
    const parsed = new URL(url);
    return [{ ...link, title, subtitle: "", url: url.length <= 360 ? url : parsed.origin }];
  }).slice(0, 4);
  const shareProfile = {
    ...profile,
    name: cardText(profile.name, 90),
    title: cardText(profile.title, 100),
    bio: cardText(profile.bio, 92),
    location: cardText(profile.location, 48),
    avatar: cardAvatar(profile.avatar),
    backgroundKind: "color" as const,
    backgroundImage: "",
    backgroundVideo: "",
    links,
    socials: Object.fromEntries(SOCIAL_KEYS.map((key) => [key, cardText(profile.socials[key], 100)])) as Profile["socials"]
  };
  let token = encodeProfile(shareProfile);
  if (token.length > 15000 && shareProfile.avatar.startsWith("data:")) {
    shareProfile.avatar = "";
    token = encodeProfile(shareProfile);
  }
  while (token.length > 15000 && shareProfile.links.length > 1) {
    shareProfile.links.pop();
    token = encodeProfile(shareProfile);
  }
  const url = new URL("/api/profile-card", baseUrl);
  url.searchParams.set("profile", token);
  return url.href;
}

export function markdownEmbed(profile: Profile, shareUrl: string, imagePath = "./profile-card.svg"): string {
  const alt = markdownLabel(cardText(profile.name || "Developer profile", 90));
  const image = "[![" + alt + " — gitprofiles.xyz](" + markdownDestination(imagePath) + ")](" + markdownDestination(shareUrl) + ")";
  const links = profileOutboundLinks(profile).map((link) => "[" + markdownLabel(link.label) + "](" + markdownDestination(link.url) + ")");
  return links.length ? image + "\n\n" + links.join(" · ") : image;
}

export function htmlEmbed(profile: Profile, shareUrl: string, imagePath = "./profile-card.svg"): string {
  const alt = xml((profile.name.trim() || "Developer profile") + " — gitprofiles.xyz");
  const links = profileOutboundLinks(profile).map((link) => '<a href="' + xml(link.url) + '" target="_blank" rel="noopener noreferrer">' + xml(link.label) + '</a>');
  const image = '<a href="' + xml(safeHttpUrl(shareUrl)) + '" target="_blank" rel="noopener noreferrer"><img src="' + xml(imagePath) + '" alt="' + alt + '" width="600"></a>';
  return '<div>' + image + (links.length ? '<p>' + links.join(' &middot; ') + '</p>' : '') + '</div>';
}
