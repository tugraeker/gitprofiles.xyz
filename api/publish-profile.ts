import { normalizeProfile, validateShareableProfile } from "../src/lib/share";

type SupabaseAuthUser = { id?: string };
type SupabaseErrorBody = { code?: string; message?: string };

function json(body: Record<string, unknown>, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" }
  });
}

function normalizeUsername(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9-]/g, "").replace(/-{2,}/g, "-").replace(/^-|-$/g, "").slice(0, 39);
}

const reservedUsernames = new Set(["admin", "api", "auth", "dashboard", "login", "logout", "settings", "static", "assets", "favicon.ico", "robots.txt"]);

export async function POST(request: Request): Promise<Response> {
    if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
    const requestOrigin = new URL(request.url).origin;
    const originHeader = request.headers.get("origin");
    if (originHeader && originHeader !== requestOrigin) return json({ error: "Cross-origin publishing is not allowed." }, 403);

    const authorization = request.headers.get("authorization") ?? "";
    const accessToken = /^Bearer\s+([A-Za-z0-9._~-]+)$/i.exec(authorization)?.[1];
    if (!accessToken) return json({ error: "Sign in again before publishing." }, 401);
    if (Number(request.headers.get("content-length") ?? 0) > 160_000) return json({ error: "Profile data is too large." }, 413);

    let input: unknown;
    try {
      input = await request.json();
    } catch {
      return json({ error: "Profile data is not valid JSON." }, 400);
    }
    const profile = normalizeProfile(input);
    if (!profile) return json({ error: "Profile data is invalid." }, 400);
    const issue = validateShareableProfile(profile);
    if (issue) return json({ error: issue }, 400);
    const username = normalizeUsername(profile.username);
    if (username.length < 2 || reservedUsernames.has(username)) return json({ error: "Choose a valid, available profile handle." }, 400);

    const runtime = globalThis as typeof globalThis & { process?: { env?: Record<string, string | undefined> } };
    const supabaseUrl = runtime.process?.env?.VITE_SUPABASE_URL?.replace(/\/$/, "");
    const publishableKey = runtime.process?.env?.VITE_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !publishableKey) return json({ error: "Server-side Supabase publishing is not configured." }, 503);

    try {
      const authResponse = await fetch(supabaseUrl + "/auth/v1/user", {
        headers: { apikey: publishableKey, authorization: "Bearer " + accessToken },
        signal: AbortSignal.timeout(4500)
      });
      if (authResponse.status === 401 || authResponse.status === 403) return json({ error: "Your session expired. Sign in again before publishing." }, 401);
      if (!authResponse.ok) return json({ error: "Supabase could not verify this session." }, 502);
      const authUser = await authResponse.json() as SupabaseAuthUser;
      if (!authUser.id) return json({ error: "Supabase returned an invalid session." }, 502);

      const saveResponse = await fetch(supabaseUrl + "/rest/v1/profiles?on_conflict=user_id", {
        method: "POST",
        headers: {
          apikey: publishableKey,
          authorization: "Bearer " + accessToken,
          "content-type": "application/json",
          prefer: "resolution=merge-duplicates,return=minimal"
        },
        body: JSON.stringify({
          user_id: authUser.id,
          username,
          profile_data: { ...profile, username },
          published: true,
          updated_at: new Date().toISOString()
        }),
        signal: AbortSignal.timeout(4500)
      });
      if (saveResponse.ok) return json({ saved: true });
      const failure = await saveResponse.json().catch(() => null) as SupabaseErrorBody | null;
      if (failure?.code === "23505") return json({ error: "That profile handle is already in use." }, 409);
      if (saveResponse.status === 401 || saveResponse.status === 403) return json({ error: "Supabase rejected this profile update. Check the profile table policies and sign-in session." }, saveResponse.status);
      return json({ error: "Supabase profile save failed (" + saveResponse.status + ")." }, 502);
    } catch {
      return json({ error: "The server could not reach Supabase. Your profile was not saved." }, 502);
    }
}
