import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import {
  Activity, ArrowDown, ArrowUp, ArrowUpRight, AtSign, Check,
  Code2, Copy, Download, Eye, Globe, ImagePlus, Link2,
  Info, LogOut, MapPin, MessageCircle, Moon, Music2, Palette, Play, Plus, RotateCcw,
  Share2, SlidersHorizontal, Smartphone, Sun, Trash2, Upload, X
} from "lucide-react";
import type { Session } from "@supabase/supabase-js";
import { DEFAULT_PROFILE, SOCIAL_LABELS, THEMES, type BackgroundMode, type LinkIcon, type Profile, type ProfileLink, type SocialKey, type ThemeId } from "./model";
import {
  createProfileCardSvg, htmlEmbed, markdownEmbed, profileCardImageUrl, makeShareUrl,
  normalizeProfile, readSharedProfile, safeHttpUrl, validateShareableProfile
} from "./lib/share";
import { blankProfile, exchangeAuthCode, githubProfile, loadOwnProfile, loadPublicProfile, profileRoute, publishProfile, signInWithGitHub, uploadProfileMedia, validateUsername } from "./lib/profile-service";
import { supabase } from "./lib/supabase";

const STORAGE_KEY = "gitprofiles.profile-studio.v2";
type Pane = "editor" | "preview";
type Notice = { type: "success" | "error" | "info"; text: string } | null;
type GithubLanguage = { name: string; repositories: number; share: number };
type GithubShowcase = { username: string; publicRepositories: number; languages: GithubLanguage[]; readme: string };
type GithubStatus = "idle" | "loading" | "ready" | "error";

const githubCache = new Map<string, { savedAt: number; value: GithubShowcase }>();

function githubUsernameFrom(value: string): string {
  const username = value.trim().replace(/^@/, "").replace(/^https?:\/\/(?:www\.)?github\.com\//i, "").split(/[/?#]/)[0] ?? "";
  return /^[a-z0-9-]{1,39}$/i.test(username) ? username : "";
}

async function loadGithubShowcase(value: string): Promise<GithubShowcase> {
  const username = githubUsernameFrom(value);
  if (!username) throw new Error("Enter a valid GitHub username to import public profile data.");
  const cacheKey = username.toLowerCase();
  const cached = githubCache.get(cacheKey);
  if (cached && Date.now() - cached.savedAt < 5 * 60 * 1000) return cached.value;
  const headers = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2026-03-10" };
  const encodedUsername = encodeURIComponent(username);
  const [repositoriesResponse, readmeResponse] = await Promise.all([
    fetch(`https://api.github.com/users/${encodedUsername}/repos?per_page=100&sort=updated&type=owner`, { headers }),
    fetch(`https://api.github.com/repos/${encodedUsername}/${encodedUsername}/readme`, { headers })
  ]);
  if (repositoriesResponse.status === 404) throw new Error("That GitHub profile was not found.");
  if (repositoriesResponse.status === 403 || repositoriesResponse.status === 429) throw new Error("GitHub is rate limiting public requests. Try again in a little while.");
  if (!repositoriesResponse.ok) throw new Error("Public GitHub repositories could not be loaded.");
  const repositories = await repositoriesResponse.json() as Array<{ fork?: boolean; language?: string | null }>;
  if (!Array.isArray(repositories)) throw new Error("GitHub returned an unexpected repository list.");
  const ownedRepositories = repositories.filter((repository) => !repository.fork);
  const counts = new Map<string, number>();
  for (const repository of ownedRepositories) {
    if (repository.language) counts.set(repository.language, (counts.get(repository.language) ?? 0) + 1);
  }
  const languageTotal = [...counts.values()].reduce((sum, count) => sum + count, 0);
  const languages = [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 6)
    .map(([name, count]) => ({ name, repositories: count, share: Math.max(4, Math.round(count / languageTotal * 100)) }));
  let readme = "";
  if (readmeResponse.ok) {
    const file = await readmeResponse.json() as { content?: string; encoding?: string };
    if (file.encoding === "base64" && file.content) {
      const bytes = Uint8Array.from(atob(file.content.replace(/\s/g, "")), (character) => character.charCodeAt(0));
      readme = new TextDecoder().decode(bytes).slice(0, 8000);
    }
  }
  const result = { username, publicRepositories: ownedRepositories.length, languages, readme };
  githubCache.set(cacheKey, { savedAt: Date.now(), value: result });
  return result;
}

function initialProfile(): Profile {
  const shared = readSharedProfile(window.location.href);
  if (shared) return shared;
  try {
    const saved = normalizeProfile(JSON.parse(localStorage.getItem(STORAGE_KEY) || "null"));
    return saved ?? DEFAULT_PROFILE;
  } catch {
    return DEFAULT_PROFILE;
  }
}

function initialAppearance(): "dark" | "light" {
  try {
    return localStorage.getItem("gitprofiles.appearance") === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

function isSharedView() {
  return new URLSearchParams(window.location.search).get("view") === "1" && Boolean(readSharedProfile(window.location.href));
}

function copyText(value: string): Promise<void> {
  if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(value);
  return new Promise((resolve, reject) => {
    const field = document.createElement("textarea");
    field.value = value;
    field.style.position = "fixed";
    field.style.opacity = "0";
    document.body.appendChild(field);
    field.select();
    const copied = document.execCommand("copy");
    field.remove();
    copied ? resolve() : reject(new Error("Clipboard unavailable"));
  });
}

function isNetworkFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : typeof error === "object" && error !== null && "message" in error ? String(error.message) : String(error);
  const name = error instanceof Error ? error.name : typeof error === "object" && error !== null && "name" in error ? String(error.name) : "";
  return name === "NetworkError" || /networkerror|failed to fetch|fetch failed|load failed|network request failed/i.test(message);
}

function publicShareOrigin(): string {
  return import.meta.env.VITE_PUBLIC_URL?.replace(/\/$/, "") || (window.location.protocol === "file:" ? "https://gitprofiles.xyz" : window.location.origin);
}

function shareableDraftProfile(profile: Profile): Profile {
  return /^data:image\/(?:png|jpe?g|webp);base64,/i.test(profile.avatar) ? { ...profile, avatar: "" } : profile;
}

async function withSupabaseRetry<T>(operation: () => Promise<T>, message: string): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isNetworkFailure(error) || attempt === 2) break;
      await new Promise((resolve) => window.setTimeout(resolve, 450 * (attempt + 1)));
    }
  }
  if (isNetworkFailure(lastError)) {
    const failure = new Error(message, { cause: lastError });
    failure.name = "NetworkError";
    throw failure;
  }
  throw lastError;
}

async function publishProfileThroughSite(session: Session, profile: Profile): Promise<void> {
  const endpoint = new URL("/api/publish-profile", window.location.href);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + session.access_token },
    body: JSON.stringify(profile)
  });
  const result = await response.json().catch(() => null) as { error?: string; saved?: boolean } | null;
  if (!response.ok || !result || result.saved !== true) {
    const failure = new Error(result?.error || "Profil sunucu üzerinden kaydedilemedi.");
    if (response.status >= 500 || response.status === 404 || (response.status === 200 && !result)) failure.name = "NetworkError";
    throw failure;
  }
}

async function publishProfileWithRecovery(session: Session, profile: Profile): Promise<void> {
  try {
    await withSupabaseRetry(() => publishProfile(session.user.id, profile), "Profil Supabase'e gönderilemedi.");
  } catch (error) {
    if (!isNetworkFailure(error) || window.location.protocol === "file:") throw error;
    try {
      await publishProfileThroughSite(session, profile);
    } catch (relayError) {
      if (!isNetworkFailure(relayError)) throw relayError;
      const failure = new Error("Supabase’e doğrudan ve sunucu üzerinden ulaşılamadı.", { cause: relayError });
      failure.name = "NetworkError";
      throw failure;
    }
  }
}

function saveProfileLocally(profile: Profile): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
    return true;
  } catch {
    return false;
  }
}

function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part.charAt(0)).join("").toUpperCase() || "·";
}

function backgroundStyle(profile: Profile): string {
  const start = /^#[\da-f]{6}$/i.test(profile.backgroundStart) ? profile.backgroundStart : "#111816";
  const end = /^#[\da-f]{6}$/i.test(profile.backgroundEnd) ? profile.backgroundEnd : "#18221d";
  if (profile.backgroundMode === "solid") return start;
  if (profile.backgroundMode === "gradient") return "linear-gradient(145deg," + start + " 0%," + end + " 100%)";
  return "radial-gradient(ellipse at 50% 0%, " + profile.accent + "22, transparent 46%), linear-gradient(160deg," + start + "," + end + ")";
}

async function optimizeImage(file: File, dimension: number): Promise<File> {
  if (!file.type.startsWith("image/")) throw new Error("Bir görsel dosyası seç.");
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = objectUrl;
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("Görsel açılamadı."));
    });
    const scale = Math.min(1, dimension / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Görsel işlenemedi.");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", .82));
    if (!blob) throw new Error("Görsel WebP biçiminde işlenemedi.");
    const name = file.name.replace(/\.[^.]+$/, "") || "profile-image";
    return new File([blob], name + ".webp", { type: "image/webp", lastModified: Date.now() });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function fileDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Görsel okunamadı."));
    reader.onerror = () => reject(new Error("Görsel okunamadı."));
    reader.readAsDataURL(file);
  });
}

function App() {
  const sharedView = useMemo(isSharedView, []);
  const [route, setRoute] = useState(profileRoute);
  const publicMode = sharedView || route.kind === "public";
  const [profile, setProfile] = useState<Profile>(() => route.kind === "public" ? blankProfile(route.username) : initialProfile());
  const [session, setSession] = useState<Session | null>(null);
  const [isPublished, setIsPublished] = useState(false);
  const [authLoading, setAuthLoading] = useState(Boolean(supabase));
  const [remoteLoading, setRemoteLoading] = useState(route.kind === "public" && !sharedView);
  const [publicStatus, setPublicStatus] = useState<"loading" | "ready" | "missing" | "unavailable">(route.kind === "public" && !sharedView ? "loading" : "ready");
  const [accountBusy, setAccountBusy] = useState(false);
  const [mediaBusy, setMediaBusy] = useState(false);
  const [pane, setPane] = useState<Pane>("editor");
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [appearance, setAppearance] = useState<"dark" | "light">(initialAppearance);
  const [notice, setNotice] = useState<Notice>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareUrl, setShareUrl] = useState("");
  const [shareIsDraft, setShareIsDraft] = useState(false);
  const [embedMode, setEmbedMode] = useState<"markdown" | "html">("markdown");
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [githubData, setGithubData] = useState<GithubShowcase | null>(null);
  const [githubStatus, setGithubStatus] = useState<GithubStatus>("idle");
  const [githubError, setGithubError] = useState("");
  const [githubRefresh, setGithubRefresh] = useState(0);
  const lastPublishedFingerprint = useRef("");
  const autoSaveQueue = useRef<Promise<void>>(Promise.resolve());
  const cardImageUrl = useMemo(() => profileCardImageUrl(publicShareOrigin(), shareableDraftProfile(profile)), [profile]);
  const cardPreview = useMemo(() => "data:image/svg+xml;charset=utf-8," + encodeURIComponent(createProfileCardSvg(profile)), [profile]);
  const embedCode = useMemo(() => embedMode === "markdown" ? markdownEmbed(profile, shareUrl, cardImageUrl) : htmlEmbed(profile, shareUrl, cardImageUrl), [embedMode, profile, shareUrl, cardImageUrl]);
  const rootStyle = { "--accent": profile.accent, "--profile-background": backgroundStyle(profile) } as CSSProperties;
  const githubUsername = githubUsernameFrom(profile.socials.github);

  useEffect(() => {
    let active = true;
    if (!githubUsername) {
      setGithubData(null);
      setGithubStatus("idle");
      setGithubError("");
      return () => { active = false; };
    }
    setGithubData(null);
    setGithubStatus("loading");
    setGithubError("");
    const timer = window.setTimeout(() => {
      void loadGithubShowcase(githubUsername).then((data) => {
        if (!active) return;
        setGithubData(data);
        setGithubStatus("ready");
      }).catch((error: unknown) => {
        if (!active) return;
        setGithubData(null);
        setGithubStatus("error");
        setGithubError(error instanceof Error ? error.message : "GitHub profile data could not be loaded.");
      });
    }, 350);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [githubUsername, githubRefresh]);

  useEffect(() => {
    if (!supabase) {
      setAuthLoading(false);
      return;
    }
    let active = true;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (active) {
        setSession(nextSession);
        setAuthLoading(false);
      }
    });
    void supabase.auth.getSession().then(({ data, error }) => {
      if (!active) return;
      if (error) setNotice({ type: "error", text: "Oturum okunamadı. Yeniden giriş yap." });
      setSession(data.session);
      setAuthLoading(false);
    });
    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    try { localStorage.setItem("gitprofiles.appearance", appearance); } catch {}
    document.documentElement.style.colorScheme = appearance;
    document.documentElement.dataset.theme = appearance;
  }, [appearance]);

  useEffect(() => {
    if (!session || route.kind === "public") return;
    let active = true;
    setRemoteLoading(true);
    setIsPublished(false);
    void loadOwnProfile(session.user.id).then((saved) => {
      if (!active) return;
      if (saved) {
        setProfile(saved);
        lastPublishedFingerprint.current = JSON.stringify(saved);
        setIsPublished(true);
      } else {
        let draft: Profile | null = null;
        try { draft = normalizeProfile(JSON.parse(localStorage.getItem(STORAGE_KEY) || "null")); } catch {}
        const seed = githubProfile(session.user);
        setProfile(draft ? { ...seed, ...draft, username: draft.username || seed.username, name: draft.name || seed.name, avatar: draft.avatar || seed.avatar } : seed);
        lastPublishedFingerprint.current = "";
      }
      setRemoteLoading(false);
      if (route.kind === "home") setRoute({ kind: "dashboard" });
    }).catch((error: unknown) => {
      if (!active) return;
      setRemoteLoading(false);
      setNotice({ type: "error", text: error instanceof Error ? error.message : "Profil yüklenemedi." });
    });
    return () => { active = false; };
  }, [session?.user.id, route.kind]);

  useEffect(() => {
    if (!session || !isPublished || remoteLoading || publicMode) return;
    const serialized = JSON.stringify(profile);
    if (serialized === lastPublishedFingerprint.current) return;
    if (validateShareableProfile(profile) || validateUsername(profile.username)) return;
    let active = true;
    const timer = window.setTimeout(() => {
      autoSaveQueue.current = autoSaveQueue.current.catch(() => {}).then(async () => {
        if (!active) return;
        try {
          await publishProfileWithRecovery(session, profile);
          if (active) lastPublishedFingerprint.current = serialized;
        } catch (error) {
          if (active) setNotice({ type: "error", text: error instanceof Error ? error.message : "Live profile update failed." });
        }
      });
    }, 700);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [profile, session?.user.id, isPublished, remoteLoading, publicMode]);

  useEffect(() => {
    if (route.kind !== "public" || sharedView) return;
    let active = true;
    setRemoteLoading(true);
    setPublicStatus("loading");
    void loadPublicProfile(route.username).then((remoteProfile) => {
      if (!active) return;
      if (remoteProfile) {
        setProfile(remoteProfile);
        setPublicStatus("ready");
      } else {
        setPublicStatus(supabase ? "missing" : "unavailable");
      }
      setRemoteLoading(false);
    }).catch(() => {
      if (!active) return;
      setPublicStatus("unavailable");
      setRemoteLoading(false);
    });
    return () => { active = false; };
  }, [route.kind, route.kind === "public" ? route.username : "", sharedView]);

  useEffect(() => {
    let active = true;
    const consumeCallback = async (callbackUrl: string) => {
      const parsed = new URL(callbackUrl);
      if (!parsed.searchParams.has("code")) {
        if (parsed.searchParams.has("error")) {
          setNotice({ type: "error", text: parsed.searchParams.get("error_description") || "GitHub sign-in was cancelled." });
          setRoute({ kind: "home" });
          if (window.location.pathname === "/auth/callback") window.history.replaceState({}, "", "/");
        }
        return;
      }
      try {
        setAuthLoading(true);
        const nextSession = await exchangeAuthCode(callbackUrl);
        if (!nextSession) throw new Error("GitHub sign-in did not return a session.");
        if (!active) return;
        setSession(nextSession);
        setRoute({ kind: "dashboard" });
        if (window.location.pathname === "/auth/callback") window.history.replaceState({}, "", "/dashboard");
      } catch (error) {
        if (active) {
          setNotice({ type: "error", text: error instanceof Error ? error.message : "GitHub giriş tamamlanamadı." });
          setRoute({ kind: "home" });
          if (window.location.pathname === "/auth/callback") window.history.replaceState({}, "", "/");
        }
      } finally {
        if (active) setAuthLoading(false);
      }
    };
    const unsubscribe = window.gitprofilesDesktop?.onAuthCallback((callbackUrl) => { void consumeCallback(callbackUrl); });
    if (route.kind === "callback") void consumeCallback(window.location.href);
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [route.kind]);

  useEffect(() => {
    if (!publicMode) {
      saveProfileLocally(profile);
    }
  }, [profile, publicMode]);


  function update<K extends keyof Profile>(key: K, value: Profile[K]) {
    setProfile((current) => ({ ...current, [key]: value }));
  }

  function updateLink(id: string, key: keyof ProfileLink, value: string) {
    setProfile((current) => ({ ...current, links: current.links.map((link) => link.id === id ? { ...link, [key]: value } : link) }));
  }

  function addLink() {
    setProfile((current) => ({
      ...current,
      links: current.links.length >= 12 ? current.links : current.links.concat({
        id: "link-" + Date.now().toString(36), title: "", subtitle: "", url: "", icon: "link"
      })
    }));
  }

  function moveLink(id: string, direction: -1 | 1) {
    setProfile((current) => {
      const index = current.links.findIndex((link) => link.id === id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= current.links.length) return current;
      const links = [...current.links];
      [links[index], links[target]] = [links[target], links[index]];
      return { ...current, links };
    });
  }

  async function handleAvatarFile(file?: File) {
    if (!file) return;
    setAvatarBusy(true);
    try {
      const optimized = await optimizeImage(file, session ? 640 : 180);
      const avatar = session ? await withSupabaseRetry(() => uploadProfileMedia(session.user.id, optimized, "avatar"), "Profil görseli yüklenemedi. Supabase bağlantısını kontrol edip tekrar dene.") : await fileDataUrl(optimized);
      update("avatar", avatar);
      setNotice({ type: "success", text: session ? "Profil fotoğrafı hesabına yüklendi." : "Profil fotoğrafı tarayıcı için küçültüldü." });
    } catch (error) {
      setNotice({ type: "error", text: error instanceof Error ? error.message : "Görsel yüklenemedi." });
    } finally {
      setAvatarBusy(false);
    }
  }

  async function handleBackgroundFile(file?: File) {
    if (!file) return;
    if (!session) {
      setNotice({ type: "info", text: "Arka plan medyasını yüklemek için önce GitHub ile giriş yap." });
      return;
    }
    setMediaBusy(true);
    try {
      if (file.type.startsWith("video/")) {
        const url = await uploadProfileMedia(session.user.id, file, "video");
        setProfile((current) => ({ ...current, backgroundKind: "video", backgroundVideo: url, backgroundImage: "" }));
      } else {
        const optimized = await optimizeImage(file, 2200);
        const url = await withSupabaseRetry(() => uploadProfileMedia(session.user.id, optimized, "background"), "Arka plan yüklenemedi. Supabase bağlantısını kontrol edip tekrar dene.");
        setProfile((current) => ({ ...current, backgroundKind: "image", backgroundImage: url, backgroundVideo: "" }));
      }
      setNotice({ type: "success", text: "Arka plan medyası yüklenip profiline eklendi." });
    } catch (error) {
      setNotice({ type: "error", text: error instanceof Error ? error.message : "Medya yüklenemedi." });
    } finally {
      setMediaBusy(false);
    }
  }

  async function startSignIn() {
    if (!supabase) {
      setNotice({ type: "error", text: "GitHub girişi için .env.local dosyasında Supabase URL ve anon key ayarla." });
      return;
    }
    setAccountBusy(true);
    try {
      await signInWithGitHub();
    } catch (error) {
      setNotice({ type: "error", text: error instanceof Error ? error.message : "GitHub giriş akışı başlatılamadı." });
    } finally {
      setAccountBusy(false);
    }
  }

  async function signOut() {
    if (!supabase) return;
    const { error } = await supabase.auth.signOut();
    if (error) {
      setNotice({ type: "error", text: error.message });
      return;
    }
    setSession(null);
    setIsPublished(false);
    lastPublishedFingerprint.current = "";
    setRoute({ kind: "home" });
    setProfile(blankProfile());
    setNotice({ type: "success", text: "Oturum kapatıldı." });
  }

  function shareDraft() {
    const issue = validateShareableProfile(profile) || validateUsername(profile.username);
    if (issue) {
      setNotice({ type: "error", text: issue });
      return;
    }
    const url = makeShareUrl(publicShareOrigin(), shareableDraftProfile(profile));
    setShareUrl(url);
    setShareIsDraft(true);
    setShareOpen(true);
    setNotice({ type: "info", text: "Profil bağlantısı hazır. Bu taslak Supabase’e kaydedilmedi; bağlantı profil verisini taşır." });
  }

  async function saveAndShare() {
    if (!session) {
      shareDraft();
      return;
    }
    const issue = validateShareableProfile(profile);
    if (issue) {
      setNotice({ type: "error", text: issue });
      return;
    }
    const handleIssue = validateUsername(profile.username);
    if (handleIssue) {
      setNotice({ type: "error", text: handleIssue });
      return;
    }
    const serialized = JSON.stringify(profile);
    if (window.gitprofilesDesktop) {
      try {
        const result = await window.gitprofilesDesktop.validateProfile(serialized);
        if (!result.valid) {
          setNotice({ type: "error", text: "Profil verisi doğrulanamadı." });
          return;
        }
      } catch {
        setNotice({ type: "error", text: "Profil doğrulaması başarısız oldu." });
        return;
      }
    }
    setAccountBusy(true);
    try {
      let candidate = profile;
      if (/^data:image\/(?:png|jpe?g|webp);base64,/i.test(candidate.avatar)) {
        const response = await fetch(candidate.avatar);
        const blob = await response.blob();
        const avatarFile = new File([blob], "profile-avatar.webp", { type: blob.type || "image/webp" });
        candidate = { ...candidate, avatar: await withSupabaseRetry(() => uploadProfileMedia(session.user.id, avatarFile, "avatar"), "Profil görseli yüklenemedi. Supabase bağlantısını kontrol edip tekrar dene.") };
        setProfile(candidate);
      }
      await publishProfileWithRecovery(session, candidate);
      lastPublishedFingerprint.current = JSON.stringify(candidate);
      setIsPublished(true);
      const url = publicShareOrigin() + "/" + candidate.username;
      setShareIsDraft(false);
      setShareUrl(url);
      setShareOpen(true);
      setNotice({ type: "success", text: "Profil yayınlandı. Herkese açık adresin hazır." });
    } catch (error) {
      const fallbackUrl = makeShareUrl(publicShareOrigin(), shareableDraftProfile(profile));
      setShareUrl(fallbackUrl);
      setShareIsDraft(true);
      setIsPublished(false);
      setShareOpen(true);
      if (isNetworkFailure(error)) {
        setNotice({ type: "info", text: "Supabase’e ulaşılamadı. Profilini taşıyan paylaşım linki ve README kartı hazır; buluta kaydedilmedi." });
      } else {
        const reason = error instanceof Error ? error.message : "Profil yayınlanamadı.";
        setNotice({ type: "error", text: reason + " Taslak paylaşım linki hazır." });
      }
    } finally {
      setAccountBusy(false);
    }
  }

  async function copy(value: string, label: string) {
    try {
      await copyText(value);
      setNotice({ type: "success", text: label + " panoya kopyalandı." });
    } catch {
      setNotice({ type: "error", text: "Otomatik kopyalama kullanılamadı; metni seçip kopyalayabilirsin." });
    }
  }

  function downloadCard() {
    const svg = createProfileCardSvg(profile);
    const href = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = "profile-card.svg";
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(href), 900);
    setNotice({ type: "success", text: "profile-card.svg indirildi. README deponla aynı klasöre ekleyebilirsin." });
  }

  function resetProfile() {
    setProfile(blankProfile(session?.user.user_metadata?.user_name ?? ""));
    setNotice({ type: "success", text: "Düzenleme alanları temizlendi." });
  }

  if (route.kind === "callback") {
    return <div className="route-message min-h-screen"><Brand /><div><span className="route-spinner" /><h1>Finishing sign-in</h1><p>GitHub is returning you to your profile studio.</p></div></div>;
  }

  if (route.kind === "dashboard" && (!session || remoteLoading)) {
    return <div className="route-message min-h-screen"><Brand /><div>{session && remoteLoading ? <span className="route-spinner" /> : <SocialGlyph kind="github" />}<h1>{session && remoteLoading ? "Loading your profile" : "Your profile studio"}</h1><p>{session && remoteLoading ? "Your saved details are being loaded." : "Sign in with GitHub to manage and publish your page."}</p>{!session && <button className="button button-save" disabled={authLoading || accountBusy} onClick={() => void startSignIn()}><SocialGlyph kind="github" /> {accountBusy || authLoading ? "Connecting…" : "Sign in with GitHub"}</button>}{!supabase && <p className="configuration-hint">Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to enable sign-in.</p>}</div></div>;
  }

  if (route.kind === "public" && !sharedView && publicStatus !== "ready") {
    const message = publicStatus === "loading" ? "Loading this profile" : publicStatus === "missing" ? "This profile is not published" : "Public profiles are not connected";
    const detail = publicStatus === "loading" ? "The page is being fetched from the profile database." : publicStatus === "missing" ? "Check the address or ask its owner to publish their page." : "The profile service is unavailable or has not been configured.";
    return <div className="route-message min-h-screen"><Brand /><div>{publicStatus === "loading" && <span className="route-spinner" />}<h1>{message}</h1><p>{detail}</p><a className="button button-quiet" href="/">Open the profile studio</a></div></div>;
  }

  if (publicMode) {
    return <div className="public-shell min-h-screen" style={rootStyle}>
      <header className="public-nav"><Brand /><a className="button button-quiet" href="/">Make your page <ArrowUpRight size={14} /></a></header>
      <ProfileScene profile={profile} publicMode githubData={githubData} />
      <div className="public-credit">A personal page by <b>gitprofiles.xyz</b></div>
    </div>;
  }

  return (
    <div className="studio-shell min-h-screen" style={rootStyle} data-theme={appearance}>
      <header className="topbar">
        <Brand />
        <div className="topbar-status"><span>{profile.username ? "gitprofiles.xyz/" + profile.username : "Your profile"}</span><span className="saved-note">{session ? "Signed in with GitHub" : "Saved on this device"}</span></div>
        <div className="topbar-actions">
          <button className="icon-button appearance-toggle" aria-label={appearance === "dark" ? "Switch to light theme" : "Switch to dark theme"} title={appearance === "dark" ? "Light theme" : "Dark theme"} onClick={() => setAppearance(appearance === "dark" ? "light" : "dark")}>{appearance === "dark" ? <Sun size={15} /> : <Moon size={15} />}</button>
          {session ? <button className="button button-quiet account-button" onClick={() => void signOut()}><LogOut size={14} /> Sign out</button> : <button className="button button-quiet account-button" disabled={authLoading || accountBusy} onClick={() => void startSignIn()}><SocialGlyph kind="github" /> Sign in with GitHub</button>}
          <button className="button button-save" disabled={accountBusy || authLoading} onClick={() => void saveAndShare()}>{session ? <Share2 size={15} /> : <Link2 size={14} />}{accountBusy ? "Saving…" : session ? "Publish profile" : "Share profile"}</button>
        </div>
      </header>

      {!supabase && <div className="configuration-note"><Info size={14} /><span>Cloud publishing is not connected. Add the Supabase values from <code>.env.example</code> to enable GitHub sign-in, media uploads, and live profile URLs.</span></div>}

      <section className="hero">
        <div className="hero-copy"><div className="hero-kicker"><span className="hero-mark" /> Profile workshop</div><h1>A home for your links.</h1><p>Bring your projects, socials, and current interests together on one small page.</p></div>
        <div className="hero-note"><span>{String(profile.links.length).padStart(2, "0")}</span><span>links on this page</span></div>
      </section>

      <div className="mobile-tabs" role="tablist" aria-label="Studio views">
        <button role="tab" aria-selected={pane === "editor"} className={pane === "editor" ? "active" : ""} onClick={() => setPane("editor")}><SlidersHorizontal size={14} /> Edit profile</button>
        <button role="tab" aria-selected={pane === "preview"} className={pane === "preview" ? "active" : ""} onClick={() => setPane("preview")}><Eye size={14} /> Live preview</button>
      </div>

      <main className="workspace">
        <aside className={"editor-panel mobile-" + pane} aria-label="Profile editor">
          <div className="panel-head"><div><span className="panel-eyebrow">Your profile</span><h2>Set the essentials</h2></div><span className="save-indicator"><span className="status-pulse" />{session ? "Cloud account" : "Saved locally"}</span></div>

          <section className="editor-card">
            <SectionTitle icon={<AtSign size={15} />} title="Your identity" detail="Name, handle, and a short introduction." />
            <Field label="Profile handle" id="profile-username" value={profile.username} onChange={(value) => update("username", value.replace(/[^a-z0-9-]/gi, "").slice(0, 39))} placeholder="your-name" />
            <div className="field-grid">
              <Field label="Display name" id="display-name" value={profile.name} onChange={(value) => update("name", value)} placeholder="Your name" />
              <Field label="What you do" id="profile-title" value={profile.title} onChange={(value) => update("title", value)} placeholder="Developer & designer" />
              <Field label="Location" id="profile-location" value={profile.location} onChange={(value) => update("location", value)} placeholder="Earth, Milky Way" />
              <label className="availability-toggle"><input type="checkbox" checked={profile.availability} onChange={(event) => update("availability", event.target.checked)} /><span className="toggle-ui" /><span>Open to opportunities</span></label>
              <div className="field span-2"><label className="field-label" htmlFor="profile-bio">A little bio</label><textarea id="profile-bio" value={profile.bio} onChange={(event) => update("bio", event.target.value)} rows={3} maxLength={260} placeholder="A few lines about what you make and love…" /><div className="field-meta"><span>Make it sound like you.</span><span>{profile.bio.length}/260</span></div></div>
            </div>
          </section>

          <section className="editor-card">
            <SectionTitle icon={<ImagePlus size={15} />} title="Profile image" detail="A photo, avatar, or personal mark." />
            <div className="avatar-editor">
              <div className="avatar-mini">
                {profile.avatar ? <><img src={profile.avatar} alt="Profile avatar preview" onError={(event) => { event.currentTarget.style.display = "none"; const fallback = event.currentTarget.nextElementSibling as HTMLElement | null; if (fallback) fallback.style.display = "block"; }} /><span style={{ display: "none" }}>{initials(profile.name)}</span></> : <span>{initials(profile.name)}</span>}
              </div>
              <div className="avatar-fields">
                <label className="button button-upload" htmlFor="avatar-file"><ImagePlus size={14} /> {avatarBusy ? "Optimizing…" : "Upload image"}</label>
                <input className="visually-hidden" id="avatar-file" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => { void handleAvatarFile(event.target.files?.[0]); event.currentTarget.value = ""; }} />
                <input className="text-input" value={profile.avatar.startsWith("data:") ? "" : profile.avatar} onChange={(event) => update("avatar", event.target.value)} placeholder="Or paste an image URL" aria-label="Avatar image URL" />
              </div>
              {profile.avatar && <button className="icon-button remove-avatar" aria-label="Remove avatar" onClick={() => update("avatar", "")}><X size={14} /></button>}
            </div>
            <p className="fine-print">Uploaded images are resized in your browser before being saved.</p>
          </section>

          <section className="editor-card">
            <SectionTitle icon={<Palette size={15} />} title="Color & background" detail="Set a base color and a single accent." />
            <div className="theme-grid" role="radiogroup" aria-label="Color palettes">
              {(Object.entries(THEMES) as [ThemeId, typeof THEMES[ThemeId]][]).map(([id, theme]) => (
                <button key={id} role="radio" aria-checked={profile.theme === id} className={"theme-choice " + (profile.theme === id ? "selected" : "")} onClick={() => setProfile((current) => ({ ...current, theme: id, accent: theme.accent, backgroundStart: theme.start, backgroundEnd: theme.end }))}>
                  <span className="theme-dots"><i style={{ background: theme.accent }} /><i style={{ background: theme.start }} /><i style={{ background: theme.end }} /></span><span>{theme.label}</span>{profile.theme === id && <Check size={12} />}
                </button>
              ))}
            </div>
            <div className="background-controls">
              <div className="mode-switch" role="group" aria-label="Background style">
                {(["aurora", "gradient", "solid"] as BackgroundMode[]).map((mode) => <button key={mode} className={profile.backgroundMode === mode ? "active" : ""} onClick={() => update("backgroundMode", mode)}>{mode}</button>)}
              </div>
              <ColorField label="Base" value={profile.backgroundStart} onChange={(value) => update("backgroundStart", value)} />
              {profile.backgroundMode !== "solid" && <ColorField label="Glow" value={profile.backgroundEnd} onChange={(value) => update("backgroundEnd", value)} />}
              <ColorField label="Accent" value={profile.accent} onChange={(value) => update("accent", value)} />
            </div>
            <div className="background-kind" role="group" aria-label="Background media type">
              {(["color", "image", "video"] as const).map((kind) => <button key={kind} className={profile.backgroundKind === kind ? "active" : ""} onClick={() => update("backgroundKind", kind)}>{kind === "color" ? "Color" : kind === "image" ? "Image" : "Video"}</button>)}
            </div>
            {profile.backgroundKind !== "color" && <div className="media-fields">
              <Field label={profile.backgroundKind === "image" ? "Background image URL" : "Background video URL"} id="profile-background-url" value={profile.backgroundKind === "image" ? profile.backgroundImage : profile.backgroundVideo} onChange={(value) => update(profile.backgroundKind === "image" ? "backgroundImage" : "backgroundVideo", value)} placeholder={profile.backgroundKind === "image" ? "https://…/image.jpg" : "https://…/loop.mp4"} />
              <div className="background-upload-row"><label className="button button-upload" htmlFor="background-file"><Upload size={14} /> {mediaBusy ? "Uploading…" : profile.backgroundKind === "image" ? "Upload image" : "Upload video"}</label><input className="visually-hidden" id="background-file" type="file" accept={profile.backgroundKind === "image" ? "image/jpeg,image/png,image/webp" : "video/mp4,video/webm"} onChange={(event) => { void handleBackgroundFile(event.target.files?.[0]); event.currentTarget.value = ""; }} /><span>{session ? "Images are optimized before upload. Videos up to 40 MB." : "Sign in to upload media; public image and video URLs can be previewed here."}</span></div>
            </div>}
          </section>

          <section className="editor-card">
            <div className="section-title-row">
              <SectionTitle icon={<Link2 size={15} />} title="Links" detail="Point people to the places that matter." />
              <button className="button button-add" onClick={addLink} disabled={profile.links.length >= 12}><Plus size={13} /> Add link</button>
            </div>
            <div className="link-editor-list">
              {profile.links.map((link, index) => <LinkEditor key={link.id} link={link} index={index} total={profile.links.length} onChange={updateLink} onMove={moveLink} onRemove={() => setProfile((current) => ({ ...current, links: current.links.filter((item) => item.id !== link.id) }))} />)}
              {!profile.links.length && <div className="empty-links"><Link2 size={18} /><span>Your links will show up in the preview.</span><button onClick={addLink}>Add the first one</button></div>}
            </div>
          </section>

          <section className="editor-card">
            <SectionTitle icon={<Globe size={15} />} title="Social profiles" detail="Add the channels you actually use." />
            <div className="social-editor-grid">
              {(Object.keys(SOCIAL_LABELS) as SocialKey[]).map((social) => <Field key={social} label={SOCIAL_LABELS[social]} id={"social-" + social} prefix={socialPrefix(social)} value={profile.socials[social]} onChange={(value) => setProfile((current) => ({ ...current, socials: { ...current.socials, [social]: value } }))} placeholder={social === "discord" ? "Invite link" : "username"} />)}
            </div>
          </section>

          <section className="editor-card">
            <div className="section-title-row">
              <SectionTitle icon={<SocialGlyph kind="github" />} title="GitHub profile" detail="Public languages and your profile README.md." />
              <button className="button button-add" onClick={() => setGithubRefresh((value) => value + 1)} disabled={!githubUsername || githubStatus === "loading"}><RotateCcw size={13} /> Refresh</button>
            </div>
            {!githubUsername && <p className="fine-print">Add a GitHub username above to load public repositories and the matching README.md.</p>}
            {githubStatus === "loading" && <p className="fine-print" role="status">Loading public repositories and README.md…</p>}
            {githubStatus === "error" && <p className="fine-print" role="status">{githubError}</p>}
            {githubStatus === "ready" && githubData && <div className="mt-3 grid gap-3">
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--soft)]"><span><b className="text-[var(--accent)]">{githubData.publicRepositories}</b> public repositories</span><span><b className="text-[var(--accent)]">{githubData.languages.length}</b> languages used</span><span><b className="text-[var(--accent)]">{githubData.readme ? "Found" : "Not found"}</b> profile README.md</span></div>
              <GithubLanguageList languages={githubData.languages} />
              {githubData.readme ? <details className="rounded-md border border-white/10 bg-white/[.025] px-3 py-2">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-xs text-[var(--soft)]"><span className="font-mono text-[var(--accent)]">{githubData.username}/{githubData.username}/README.md</span><span>Preview</span></summary>
                <pre className="mt-3 max-h-56 overflow-auto whitespace-pre-wrap break-words border-t border-white/10 pt-3 font-mono text-[11px] leading-relaxed text-[var(--muted)]">{githubData.readme}</pre>
              </details> : <p className="fine-print">No public profile README.md was found in the matching repository.</p>}
              <a className="w-fit text-xs text-[var(--accent)] underline-offset-4 hover:underline" href={`https://github.com/${encodeURIComponent(githubData.username)}/${encodeURIComponent(githubData.username)}#readme`} target="_blank" rel="noopener noreferrer">Open profile README on GitHub</a>
            </div>}
            <p className="fine-print">Language counts use each repository’s primary language across up to 100 public repositories.</p>
          </section>

          <div className="editor-footer"><button className="reset-button" onClick={resetProfile}><RotateCcw size={13} /> Clear profile</button><span>{isPublished ? "Changes publish after a short save." : session ? "Publish once to create your public page." : "Changes stay in this browser."}</span></div>
        </aside>

        <section className={"preview-panel mobile-" + pane} aria-label="Live profile preview">
          <div className="preview-heading"><div><span className="panel-eyebrow">The page</span><h2>Live preview</h2></div><div className="device-switch" aria-label="Preview size"><button aria-pressed={device === "desktop"} className={device === "desktop" ? "active" : ""} onClick={() => setDevice("desktop")}><Globe size={14} /> Desktop</button><button aria-pressed={device === "mobile"} className={device === "mobile" ? "active" : ""} onClick={() => setDevice("mobile")}><Smartphone size={14} /> Mobile</button></div></div>
          <div className="browser-frame">
            <div className="browser-bar"><span className="browser-lights"><i /><i /><i /></span><span className="browser-address"><span className="lock-mark">⌑</span> gitprofiles.xyz/{profile.username || "your-name"}</span><span className="browser-menu">•••</span></div>
            <div className={"preview-viewport " + (device === "mobile" ? "mobile-device" : "")}>
              {device === "mobile" && <div className="phone-frame-top"><span /></div>}
              <ProfileScene profile={profile} githubData={githubData} />
            </div>
            <div className="browser-footer"><span><span className="preview-ready"><Check size={10} /></span> Link cards ready</span><span>{profile.links.length} links <i /> {Object.values(profile.socials).filter(Boolean).length} socials</span></div>
          </div>
          <div className="preview-caption"><span><Activity size={13} /> Updates as you type</span><span>{device} view</span></div>
        </section>
      </main>

      {notice && <div className={"notice-toast " + notice.type} role="status" aria-live="polite"><span>{notice.type === "success" ? <Check size={14} /> : notice.type === "error" ? <X size={14} /> : <Info size={14} />}</span>{notice.text}<button aria-label="Dismiss notice" onClick={() => setNotice(null)}><X size={13} /></button></div>}
      {shareOpen && <ShareDialog profile={profile} url={shareUrl} embedMode={embedMode} setEmbedMode={setEmbedMode} code={embedCode} cardPreview={cardPreview} shareIsDraft={shareIsDraft} onClose={() => setShareOpen(false)} onCopy={copy} onDownload={downloadCard} />}
    </div>
  );
}

function Brand() {
  return <a href="/" className="brand" aria-label="gitprofiles.xyz home"><span className="brand-symbol">g/</span><span>gitprofiles<span>.xyz</span></span></a>;
}

function SectionTitle({ icon, title, detail }: { icon: ReactNode; title: string; detail: string }) {
  return <div className="section-title"><span className="section-icon">{icon}</span><div><h3>{title}</h3><p>{detail}</p></div></div>;
}

function Field({ label, id, value, onChange, placeholder, prefix }: {
  label: string; id: string; value: string; onChange: (value: string) => void; placeholder?: string; prefix?: string;
}) {
  return <div className="field">
    <label className="field-label" htmlFor={id}>{label}</label>
    <div className={"input-wrap " + (prefix ? "has-prefix" : "")}>{prefix && <span className="input-prefix">{prefix}</span>}<input className="text-input" id={id} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} /></div>
  </div>;
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="color-control"><span>{label}</span><input type="color" value={/^#[\da-f]{6}$/i.test(value) ? value : "#111816"} onChange={(event) => onChange(event.target.value)} aria-label={label + " color"} /></label>;
}

function LinkEditor({ link, index, total, onChange, onMove, onRemove }: {
  link: ProfileLink; index: number; total: number;
  onChange: (id: string, key: keyof ProfileLink, value: string) => void;
  onMove: (id: string, direction: -1 | 1) => void;
  onRemove: () => void;
}) {
  return <article className="link-editor">
    <div className="link-editor-head"><span className="link-order">{String(index + 1).padStart(2, "0")}</span><span className="link-editor-label">Link details</span><div className="link-editor-actions"><button disabled={index === 0} aria-label="Move link up" onClick={() => onMove(link.id, -1)}><ArrowUp size={13} /></button><button disabled={index === total - 1} aria-label="Move link down" onClick={() => onMove(link.id, 1)}><ArrowDown size={13} /></button><button aria-label="Remove link" onClick={onRemove}><Trash2 size={13} /></button></div></div>
    <div className="field-grid">
      <div className="field"><label className="field-label" htmlFor={"link-title-" + link.id}>Button title</label><input className="text-input" id={"link-title-" + link.id} value={link.title} onChange={(event) => onChange(link.id, "title", event.target.value)} placeholder="My latest project" /></div>
      <div className="field"><label className="field-label" htmlFor={"link-icon-" + link.id}>Button icon</label><select className="text-input select-input" id={"link-icon-" + link.id} value={link.icon} onChange={(event) => onChange(link.id, "icon", event.target.value)}><option value="code">Code / GitHub</option><option value="chat">Discord / community</option><option value="music">Spotify / music</option><option value="video">YouTube / video</option><option value="link">Website / link</option></select></div>
      <div className="field span-2"><label className="field-label" htmlFor={"link-url-" + link.id}>Destination URL</label><input className="text-input" id={"link-url-" + link.id} value={link.url} onChange={(event) => onChange(link.id, "url", event.target.value)} placeholder="https://…" /></div>
      <div className="field span-2"><label className="field-label" htmlFor={"link-subtitle-" + link.id}>Small note <span className="optional-label">optional</span></label><input className="text-input" id={"link-subtitle-" + link.id} value={link.subtitle} onChange={(event) => onChange(link.id, "subtitle", event.target.value)} placeholder="A little context for the click" /></div>
    </div>
  </article>;
}

function socialPrefix(social: SocialKey) {
  if (social === "github") return "github.com/";
  if (social === "x") return "x.com/";
  if (social === "instagram") return "instagram.com/";
  return "discord.gg/";
}

function socialHref(social: SocialKey, value: string) {
  if (!value.trim()) return "";
  if (social === "discord") return safeHttpUrl(value);
  const host = social === "github" ? "github.com" : social === "x" ? "x.com" : "instagram.com";
  return safeHttpUrl(value.includes("://") ? value : "https://" + host + "/" + value.trim().replace(/^@/, ""));
}

function LinkIconView({ kind, size = 17 }: { kind: LinkIcon; size?: number }) {
  if (kind === "code") return <Code2 size={size} />;
  if (kind === "chat") return <MessageCircle size={size} />;
  if (kind === "music") return <Music2 size={size} />;
  if (kind === "video") return <Play size={size} />;
  return <ArrowUpRight size={size} />;
}

function SocialGlyph({ kind }: { kind: SocialKey }) {
  const paths: Record<SocialKey, string> = {
    github: "M12 .9a11.1 11.1 0 0 0-3.51 21.63c.56.1.76-.24.76-.54v-2.1c-3.1.68-3.76-1.32-3.76-1.32-.5-1.28-1.24-1.62-1.24-1.62-1.01-.69.08-.68.08-.68 1.12.08 1.71 1.15 1.71 1.15 1 .1 1.57-1.1 2.65-1.38.1-.72.39-1.2.71-1.48-2.47-.28-5.07-1.24-5.07-5.5 0-1.22.44-2.22 1.15-3-.12-.28-.5-1.43.11-2.98 0 0 .94-.3 3.05 1.14a10.6 10.6 0 0 1 5.55 0c2.12-1.44 3.05-1.14 3.05-1.14.61 1.55.23 2.7.11 2.98.72.78 1.15 1.78 1.15 3 0 4.27-2.6 5.21-5.08 5.49.4.35.76 1.03.76 2.08v3.26c0 .3.2.65.77.54A11.1 11.1 0 0 0 12 .9Z",
    x: "M18.9 1.15h3.68l-8.04 9.19 9.46 12.51h-7.41l-5.8-7.58-6.64 7.58H.46l8.6-9.83L.01 1.15H7.6l5.24 6.93 6.06-6.93Zm-1.29 19.5h2.04L6.18 3.24H3.99L17.61 20.65Z",
    instagram: "M7.8 2h8.4A5.8 5.8 0 0 1 22 7.8v8.4a5.8 5.8 0 0 1-5.8 5.8H7.8A5.8 5.8 0 0 1 2 16.2V7.8A5.8 5.8 0 0 1 7.8 2Zm0 2A3.8 3.8 0 0 0 4 7.8v8.4A3.8 3.8 0 0 0 7.8 20h8.4a3.8 3.8 0 0 0 3.8-3.8V7.8A3.8 3.8 0 0 0 16.2 4H7.8Zm4.2 3a5 5 0 1 1 0 10 5 5 0 0 1 0-10Zm0 2a3 3 0 1 0 0 6 3 3 0 0 0 0-6Zm5.2-3.3a1.2 1.2 0 1 1 0 2.4 1.2 1.2 0 0 1 0-2.4Z",
    discord: "M19.5 5.4a16 16 0 0 0-3.9-1.2l-.5 1a14.8 14.8 0 0 0-6.2 0l-.5-1a16 16 0 0 0-3.9 1.2C2 9 1.3 12.5 1.7 16a16 16 0 0 0 4.8 2.4l1-1.6-1.5-.7.4-.3a11.5 11.5 0 0 0 11.2 0l.4.3-1.5.7 1 1.6a16 16 0 0 0 4.8-2.4c.5-4.1-.8-7.6-3.8-10.6ZM8.8 14.4c-.9 0-1.6-.8-1.6-1.8s.7-1.8 1.6-1.8 1.6.8 1.6 1.8-.7 1.8-1.6 1.8Zm6.4 0c-.9 0-1.6-.8-1.6-1.8s.7-1.8 1.6-1.8 1.6.8 1.6 1.8-.7 1.8-1.6 1.8Z"
  };
  return <svg className={"social-glyph " + kind} aria-hidden="true" viewBox="0 0 24 24" fill="currentColor"><path d={paths[kind]} /></svg>;
}

function LazyBackgroundVideo({ source }: { source: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !source) return;
    let attached = false;
    const attach = () => {
      if (attached) return;
      attached = true;
      video.src = source;
      video.load();
      void video.play().catch(() => {});
    };
    const detach = () => {
      if (!attached) return;
      attached = false;
      video.pause();
      video.removeAttribute("src");
      video.load();
    };
    if (typeof IntersectionObserver === "undefined") {
      attach();
      return detach;
    }
    const observer = new IntersectionObserver(([entry]) => entry.isIntersecting ? attach() : detach(), { rootMargin: "140px" });
    observer.observe(video);
    return () => {
      observer.disconnect();
      detach();
    };
  }, [source]);

  return <video ref={videoRef} className="profile-background-video" autoPlay muted loop playsInline preload="none" aria-hidden="true" />;
}

function ProfileScene({ profile, publicMode = false, githubData }: { profile: Profile; publicMode?: boolean; githubData: GithubShowcase | null }) {
  const socials = (Object.keys(SOCIAL_LABELS) as SocialKey[]).filter((social) => profile.socials[social].trim() && socialHref(social, profile.socials[social]));
  const avatar = safeHttpUrl(profile.avatar) || (/^data:image\/(?:png|jpe?g|webp);base64,/i.test(profile.avatar) ? profile.avatar : "");
  const backgroundImage = safeHttpUrl(profile.backgroundImage);
  return <div className={"profile-scene " + (publicMode ? "public-scene" : "")} style={{ "--profile-bg": backgroundStyle(profile), "--accent": profile.accent } as CSSProperties}>
    {profile.backgroundKind === "image" && backgroundImage && <div className="profile-background-image" style={{ backgroundImage: `url("${backgroundImage}")` }} aria-hidden="true" />}
    {profile.backgroundKind === "video" && safeHttpUrl(profile.backgroundVideo) && <LazyBackgroundVideo source={safeHttpUrl(profile.backgroundVideo)} />}
    {(profile.backgroundKind === "image" || profile.backgroundKind === "video") && <div className="profile-background-wash" aria-hidden="true" />}
    <article className="profile-card">
      {(profile.name || profile.username) && <div className="profile-card-top"><span className={"availability-pill " + (profile.availability ? "available" : "away")}><i />{profile.availability ? "Open to opportunities" : "Not open to work"}</span></div>}
      <div className="avatar-ring">{avatar ? <><img src={avatar} alt={profile.name + " avatar"} onError={(event) => { event.currentTarget.style.display = "none"; const fallback = event.currentTarget.nextElementSibling as HTMLElement | null; if (fallback) fallback.style.display = "block"; }} /><span style={{ display: "none" }}>{initials(profile.name)}</span></> : <span>{initials(profile.name)}</span>}<i className={profile.availability ? "online" : ""} /></div>
      <div className="profile-handle">@{profile.username || "your-name"}</div>
      <h1>{profile.name || "Your name"}</h1>
      <p className="profile-role">{profile.title || "Your title goes here"}</p>
      <p className="profile-bio">{profile.bio || "A few words about what you do and what you love."}</p>
      {profile.location && <div className="profile-location"><MapPin size={12} />{profile.location}</div>}
      <div className="profile-socials">{socials.map((social) => <a key={social} href={socialHref(social, profile.socials[social])} target="_blank" rel="noopener noreferrer" aria-label={SOCIAL_LABELS[social]} title={SOCIAL_LABELS[social]}><SocialGlyph kind={social} /></a>)}</div>
      <div className="profile-link-list">
        {profile.links.filter((link) => link.title.trim() && safeHttpUrl(link.url)).map((link) => <a className="profile-link" key={link.id} href={safeHttpUrl(link.url)} target="_blank" rel="noopener noreferrer">
          <span className="profile-link-icon"><LinkIconView kind={link.icon} /></span><span className="profile-link-copy"><b>{link.title}</b>{link.subtitle && <small>{link.subtitle}</small>}</span><ArrowUpRight className="link-arrow" size={15} />
        </a>)}
        {!profile.links.some((link) => link.title.trim() && safeHttpUrl(link.url)) && <div className="profile-empty-link"><Link2 size={15} /> Add your first link from the editor</div>}
      </div>
      {githubData && githubData.username.toLowerCase() === githubUsernameFrom(profile.socials.github).toLowerCase() && <section className="mt-4 border-t border-white/10 pt-3 text-left" aria-label="GitHub profile details">
        <div className="mb-2 flex items-center justify-between gap-2"><span className="flex items-center gap-2 text-xs font-medium text-[#eef0e6]"><Code2 size={13} style={{ color: "var(--accent)" }} /> Languages in public repos</span><span className="font-mono text-[10px] text-[#9da79a]">{githubData.publicRepositories} repos</span></div>
        <GithubLanguageList languages={githubData.languages} compact />
        {githubData.readme && <details className="mt-3 rounded-md border border-white/10 bg-black/20 px-3 py-2">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-[11px] text-[#d0d7ca]"><span className="font-mono text-[var(--accent)]">README.md</span><span>Expand</span></summary>
          <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap break-words border-t border-white/10 pt-2 font-mono text-[9px] leading-relaxed text-[#a5afa1]">{githubData.readme}</pre>
        </details>}
        <a className="mt-2 inline-flex text-[10px] text-[var(--accent)] underline-offset-4 hover:underline" href={`https://github.com/${encodeURIComponent(githubData.username)}/${encodeURIComponent(githubData.username)}#readme`} target="_blank" rel="noopener noreferrer">Open profile README</a>
      </section>}
      <div className="profile-card-foot">Made with <b>gitprofiles.xyz</b></div>
    </article>
  </div>;
}

function GithubLanguageList({ languages, compact = false }: { languages: GithubLanguage[]; compact?: boolean }) {
  if (!languages.length) return <p className="text-xs text-[var(--muted)]">No language data in public repositories yet.</p>;
  return <div className={compact ? "grid gap-2" : "grid gap-2.5"}>
    {languages.map((language) => <div key={language.name} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1">
      <span className={compact ? "text-[10px] text-[#d0d7ca]" : "text-xs text-[var(--soft)]"}>{language.name}</span>
      <span className="font-mono text-[9px] text-[var(--muted)]">{language.repositories} {language.repositories === 1 ? "repo" : "repos"}</span>
      <span className="col-span-2 h-1 overflow-hidden rounded-full bg-white/10"><span className="block h-full rounded-full bg-[var(--accent)]" style={{ width: `${language.share}%` }} /></span>
    </div>)}
  </div>;
}

function ShareDialog({ profile, url, embedMode, setEmbedMode, code, cardPreview, shareIsDraft, onClose, onCopy, onDownload }: {
  profile: Profile; url: string; embedMode: "markdown" | "html"; setEmbedMode: (mode: "markdown" | "html") => void;
  code: string; cardPreview: string; shareIsDraft: boolean; onClose: () => void; onCopy: (value: string, label: string) => void; onDownload: () => void;
}) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="share-dialog" role="dialog" aria-modal="true" aria-labelledby="share-title">
      <div className="dialog-head"><div><span className="dialog-icon"><Share2 size={16} /></span><div><h2 id="share-title">Your page is ready to travel.</h2><p>One link for your whole corner of the internet.</p></div></div><button className="icon-button" onClick={onClose} aria-label="Close share dialog"><X size={16} /></button></div>
      <div className="share-url-row"><div className="share-url-field" aria-label="Generated share URL"><span>{url}</span></div><button className="button button-save" onClick={() => onCopy(url, "Profile link")}><Copy size={14} /> Copy link</button></div>
      <div className="share-note"><span className="note-pulse" />{shareIsDraft ? "Draft share link; the profile travels in the URL and is not saved to Supabase." : "This link opens your published profile. Later edits appear after a short save."}</div>
      <div className="embed-section">
        <div className="embed-head"><div><b>Put your card in a GitHub README</b><small>Preview it here, then paste the snippet. No image upload is required.</small></div><div className="embed-tabs"><button className={embedMode === "markdown" ? "active" : ""} onClick={() => setEmbedMode("markdown")}>Markdown</button><button className={embedMode === "html" ? "active" : ""} onClick={() => setEmbedMode("html")}>HTML</button></div></div>
        <div className="share-card-preview"><img src={cardPreview} alt={profile.name + " profile card preview"} /></div>
        <textarea className="embed-code" value={code} readOnly aria-label={embedMode + " embed code"} spellCheck={false} />
        <div className="embed-actions"><button className="button button-quiet" onClick={() => onCopy(code, embedMode + " embed code")}><Copy size={13} /> Copy README code</button><button className="button button-quiet" onClick={onDownload}><Download size={13} /> Download SVG</button></div>
      </div>
      <div className="dialog-footer"><span>Paste this code in your GitHub profile README.md.</span><button onClick={onClose}>Done</button></div>
    </section>
  </div>;
}

export default App;
