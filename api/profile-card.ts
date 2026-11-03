import { createProfileCardSvg, decodeProfile } from "../src/lib/share";

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed", { status: 405, headers: { allow: "GET, HEAD" } });
    }
    const url = new URL(request.url);
    const encodedProfile = url.searchParams.get("profile") ?? "";
    if (!encodedProfile || encodedProfile.length > 16000) {
      return new Response("A valid profile is required.", { status: encodedProfile ? 413 : 400 });
    }
    const profile = decodeProfile(encodedProfile);
    if (!profile) return new Response("The profile card data is invalid.", { status: 400 });
    const headers = {
      "content-type": "image/svg+xml; charset=utf-8",
      "cache-control": "public, max-age=300, s-maxage=300, stale-while-revalidate=86400",
      "x-content-type-options": "nosniff"
    };
    return new Response(request.method === "HEAD" ? null : createProfileCardSvg(profile), { status: 200, headers });
  }
};
