import type { Session, User } from "@supabase/supabase-js";
import type { Profile } from "../model";
import { normalizeProfile } from "./share";
import { supabase } from "./supabase";

const MEDIA_BUCKET = "profile-media";
const RESERVED_HANDLES = new Set(["admin", "api", "auth", "dashboard", "login", "logout", "settings", "static", "assets", "favicon.ico", "robots.txt"]);

export function normalizeUsername(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9-]/g, "").replace(/-{2,}/g, "-").replace(/^-|-$/g, "").slice(0, 39);
}

export function validateUsername(value: string): string | null {
  const username = normalizeUsername(value);
  if (username.length < 2) return "Choose a handle with at least two characters.";
  if (RESERVED_HANDLES.has(username)) return "That handle is reserved. Choose another one.";
  return null;
}

export function profileRoute(): { kind: "public"; username: string } | { kind: "dashboard" | "home" | "callback" } {
  const segments = window.location.pathname.split("/").filter(Boolean);
  if (segments[0] === "dashboard") return { kind: "dashboard" };
  if (segments[0] === "auth" && segments[1] === "callback") return { kind: "callback" };
  if (segments.length === 1) return { kind: "public", username: normalizeUsername(segments[0]) };
  return { kind: "home" };
}

export function authRedirectUrl(): string {
  if (window.gitprofilesDesktop) return "gitprofiles://auth/callback";
  return new URL("/auth/callback", window.location.origin).href;
}

export async function signInWithGitHub(): Promise<void> {
  if (!supabase) throw new Error("GitHub sign-in is not configured yet.");
  const desktop = Boolean(window.gitprofilesDesktop);
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "github",
    options: {
      redirectTo: authRedirectUrl(),
      scopes: "read:user user:email",
      skipBrowserRedirect: desktop
    }
  });
  if (error) throw error;
  if (desktop) {
    if (!data.url) throw new Error("GitHub did not return a sign-in address.");
    await window.gitprofilesDesktop!.openExternal(data.url);
  }
}

export async function exchangeAuthCode(callbackUrl: string): Promise<Session | null> {
  if (!supabase) throw new Error("Authentication is not configured.");
  const url = new URL(callbackUrl);
  const code = url.searchParams.get("code");
  if (!code) return null;
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) throw error;
  return data.session;
}

export function githubProfile(user: User): Profile {
  const metadata = user.user_metadata ?? {};
  const username = normalizeUsername(String(metadata.user_name ?? metadata.preferred_username ?? ""));
  const name = String(metadata.full_name ?? metadata.name ?? username).slice(0, 90);
  const avatar = typeof metadata.avatar_url === "string" ? metadata.avatar_url : "";
  return { ...blankProfile(username), name, avatar, socials: { github: username, x: "", instagram: "", discord: "" } };
}

export function blankProfile(username = ""): Profile {
  return {
    username,
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
}

function requireClient() {
  if (!supabase) throw new Error("Connect Supabase before publishing profiles.");
  return supabase;
}

export async function loadOwnProfile(userId: string): Promise<Profile | null> {
  const client = requireClient();
  const { data, error } = await client
    .from("profiles")
    .select("username, profile_data")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const profile = normalizeProfile(data.profile_data);
  return profile ? { ...profile, username: data.username } : null;
}

export async function loadPublicProfile(username: string): Promise<Profile | null> {
  const client = requireClient();
  const { data, error } = await client
    .from("profiles")
    .select("username, profile_data")
    .eq("username", normalizeUsername(username))
    .eq("published", true)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const profile = normalizeProfile(data.profile_data);
  return profile ? { ...profile, username: data.username } : null;
}

export async function publishProfile(userId: string, profile: Profile): Promise<void> {
  const client = requireClient();
  const username = normalizeUsername(profile.username);
  const { error } = await client.from("profiles").upsert({
    user_id: userId,
    username,
    profile_data: { ...profile, username },
    published: true,
    updated_at: new Date().toISOString()
  }, { onConflict: "user_id" });
  if (error) {
    if (error.code === "23505") throw new Error("That handle is already in use.");
    throw error;
  }
}

export async function uploadProfileMedia(userId: string, file: File, kind: "avatar" | "background" | "video"): Promise<string> {
  const client = requireClient();
  const isVideo = kind === "video";
  const accepted = isVideo ? ["video/mp4", "video/webm"] : ["image/jpeg", "image/png", "image/webp"];
  if (!accepted.includes(file.type)) throw new Error(isVideo ? "Use an MP4 or WebM video." : "Use a JPG, PNG, or WebP image.");
  if (isVideo && file.size > 40 * 1024 * 1024) throw new Error("Background videos must be under 40 MB.");
  if (!isVideo && file.size > 15 * 1024 * 1024) throw new Error("Images must be under 15 MB.");
  const extension = isVideo ? (file.type === "video/webm" ? "webm" : "mp4") : "webp";
  const path = userId + "/" + kind + "/" + crypto.randomUUID() + "." + extension;
  const { data, error } = await client.storage.from(MEDIA_BUCKET).upload(path, file, {
    cacheControl: "31536000",
    contentType: file.type,
    upsert: false
  });
  if (error) throw error;
  return client.storage.from(MEDIA_BUCKET).getPublicUrl(data.path).data.publicUrl;
}
