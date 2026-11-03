import { DEFAULT_PROFILE, THEMES, type BackgroundKind, type Profile, type ProfileLink, type SocialKey } from "../model";

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

export function createProfileCardSvg(profile: Profile): string {
  const accent = COLOR.test(profile.accent) ? profile.accent : THEMES[profile.theme].accent;
  const first = xml(profile.name.trim() || "Your name");
  const title = xml(profile.title.trim() || "Developer · maker · human");
  const handle = xml("@" + (profile.username.trim() || "your-profile"));
  const initial = xml((profile.name.trim() || "G").charAt(0).toUpperCase());
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">',
    '<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="' + xml(profile.backgroundStart) + '"/><stop offset="1" stop-color="' + xml(profile.backgroundEnd) + '"/></linearGradient><linearGradient id="line" x1="0" y1="0" x2="1" y2="0"><stop stop-color="' + accent + '" stop-opacity="0"/><stop offset=".5" stop-color="' + accent + '"/><stop offset="1" stop-color="' + accent + '" stop-opacity="0"/></linearGradient></defs>',
    '<rect width="1200" height="630" rx="34" fill="url(#bg)"/>',
    '<circle cx="1060" cy="50" r="230" fill="' + accent + '" opacity=".12"/>',
    '<rect x="58" y="54" width="1084" height="522" rx="28" fill="#11121c" fill-opacity=".62" stroke="#ffffff" stroke-opacity=".16"/>',
    '<circle cx="600" cy="208" r="74" fill="' + accent + '" fill-opacity=".16" stroke="' + accent + '" stroke-opacity=".72" stroke-width="2"/>',
    '<text x="600" y="228" text-anchor="middle" fill="#fff" font-family="Arial,sans-serif" font-size="56" font-weight="700">' + initial + '</text>',
    '<text x="600" y="346" text-anchor="middle" fill="#fff" font-family="Arial,sans-serif" font-size="48" font-weight="700">' + first + '</text>',
    '<text x="600" y="393" text-anchor="middle" fill="' + accent + '" font-family="Arial,sans-serif" font-size="22">' + handle + '</text>',
    '<text x="600" y="445" text-anchor="middle" fill="#d7d5e0" font-family="Arial,sans-serif" font-size="22">' + title + '</text>',
    '<rect x="300" y="498" width="600" height="2" fill="url(#line)"/>',
    '<text x="600" y="542" text-anchor="middle" fill="#aaa5b7" font-family="Arial,sans-serif" font-size="16">Made with gitprofiles.xyz</text>',
    '</svg>'
  ].join("");
}

export function markdownEmbed(profile: Profile, shareUrl: string, imagePath = "./profile-card.svg"): string {
  const alt = (profile.name.trim() || "Developer profile").replace(/[\[\]]/g, "");
  return "[![" + alt + " — gitprofiles.xyz](" + imagePath + ")](" + shareUrl + ")";
}

export function htmlEmbed(profile: Profile, shareUrl: string, imagePath = "./profile-card.svg"): string {
  const alt = xml((profile.name.trim() || "Developer profile") + " — gitprofiles.xyz");
  return '<a href="' + xml(shareUrl) + '" target="_blank" rel="noopener noreferrer"><img src="' + xml(imagePath) + '" alt="' + alt + '" width="600"></a>';
}
