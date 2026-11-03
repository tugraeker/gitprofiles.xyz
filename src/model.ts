export type ThemeId = "ultraviolet" | "cyan" | "amber" | "minimal";
export type BackgroundMode = "aurora" | "gradient" | "solid";
export type BackgroundKind = "color" | "image" | "video";
export type LinkIcon = "code" | "chat" | "music" | "video" | "link";
export type SocialKey = "github" | "x" | "instagram" | "discord";

export interface ProfileLink {
  id: string;
  title: string;
  subtitle: string;
  url: string;
  icon: LinkIcon;
}

export interface Profile {
  username: string;
  name: string;
  title: string;
  bio: string;
  location: string;
  avatar: string;
  accent: string;
  backgroundStart: string;
  backgroundEnd: string;
  backgroundMode: BackgroundMode;
  backgroundKind: BackgroundKind;
  backgroundImage: string;
  backgroundVideo: string;
  theme: ThemeId;
  availability: boolean;
  links: ProfileLink[];
  socials: Record<SocialKey, string>;
}

export const THEMES: Record<ThemeId, { label: string; accent: string; start: string; end: string }> = {
  ultraviolet: { label: "Volt", accent: "#d7ff4f", start: "#111816", end: "#18221d" },
  cyan: { label: "Mineral", accent: "#8bd4ca", start: "#101b1d", end: "#192829" },
  amber: { label: "Ember", accent: "#df9875", start: "#211715", end: "#29201c" },
  minimal: { label: "Graphite", accent: "#d6ddd2", start: "#141817", end: "#202522" }
};

export const DEFAULT_PROFILE: Profile = {
  username: "",
  name: "",
  title: "",
  bio: "",
  location: "",
  avatar: "",
  accent: "#d7ff4f",
  backgroundStart: "#111816",
  backgroundEnd: "#18221d",
  backgroundMode: "aurora",
  backgroundKind: "color",
  backgroundImage: "",
  backgroundVideo: "",
  theme: "ultraviolet",
  availability: false,
  links: [],
  socials: { github: "", x: "", instagram: "", discord: "" }
};

export const SOCIAL_LABELS: Record<SocialKey, string> = {
  github: "GitHub", x: "X", instagram: "Instagram", discord: "Discord"
};
