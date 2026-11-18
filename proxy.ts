import { NextRequest, NextResponse } from "next/server";
import { cookieLifetime, cookieName, enterGroup, makeToken, readToken, sessionConfig } from "./lib/server/session";
import type { PartyUser, SessionConfig } from "./lib/server/session";

const privateHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  "CDN-Cache-Control": "no-store",
  "Vercel-CDN-Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
};

function locked(api: boolean, settingsReady = true, invalidInvite = false) {
  const status = settingsReady ? 401 : 503;
  const message = !settingsReady ? "The host is getting the exchange ready." :
    invalidInvite ? "This link is invalid or expired. Open the invite from BLOCK PARTY." :
    "Open the private link from the BLOCK PARTY group chat.";
  if (api) return NextResponse.json({ error: message }, { status, headers: privateHeaders });
  return new NextResponse(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><meta name="theme-color" content="#163e31"><title>BLOCK PARTY | Secret Santa</title><style>*{box-sizing:border-box}body{margin:0;min-height:100svh;display:grid;place-content:center;background:#173f34;color:#fff5da;padding:1.5rem;font-family:Arial,sans-serif}main{max-width:32rem;padding:2.8rem 2rem;border:2px solid #fff5da;outline:1px solid #fff5da;outline-offset:6px}small{letter-spacing:.14em;font-weight:700}h1{font:italic bold clamp(3rem,9vw,5.5rem)/.95 Georgia,serif;letter-spacing:-.055em;margin:1rem 0 1.4rem}p{line-height:1.55;font-size:1.1rem;margin:0}</style></head><body><main><small>BLOCK PARTY</small><h1>Secret Santa.</h1><p>${message}</p></main></body></html>`, {
    status, headers: { ...privateHeaders, "Content-Type": "text/html; charset=utf-8" },
  });
}

function begin(request: NextRequest, settings: SessionConfig, user: PartyUser) {
  // Strip the invite or recovery token from the address bar before loading any assets.
  const destination = new URL("/", request.nextUrl.origin);
  const host = request.headers.get("host")?.toLowerCase();
  if (process.env.VERCEL) {
    destination.protocol = "https:";
    // Preserve a routed alias when Vercel supplies its internal deployment URL.
    const domains = [process.env.VERCEL_PROJECT_PRODUCTION_URL, process.env.VERCEL_BRANCH_URL, process.env.VERCEL_URL];
    if (host && domains.some(domain => domain?.toLowerCase() === host)) destination.host = host;
  } else if (destination.hostname === "localhost" && host && /^(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?$/.test(host)) {
    // Next normalizes loopback IPs to localhost. Preserve the origin of a host-only cookie.
    const loopback = new URL(destination.protocol + "//" + host);
    if (loopback.port === destination.port) destination.host = loopback.host;
  }
  const response = NextResponse.redirect(destination, { status: 303, headers: privateHeaders });
  response.cookies.set(cookieName, makeToken(settings, "session", user), {
    httpOnly: true, secure: Boolean(process.env.VERCEL) || request.nextUrl.protocol === "https:",
    sameSite: "lax", path: "/", maxAge: cookieLifetime,
  });
  return response;
}

export function proxy(request: NextRequest) {
  const { hostname, pathname } = request.nextUrl;
  const api = pathname.startsWith("/api/");
  const settings = sessionConfig(hostname);
  if (!settings) return locked(api, false);
  const current = readToken(settings, "session", request.cookies.get(cookieName)?.value);

  if (pathname.startsWith("/join/") || pathname.startsWith("/restore/")) {
    if (request.method !== "GET" && request.method !== "HEAD") return locked(api);
    const restoring = pathname.startsWith("/restore/");
    const key = pathname.slice(restoring ? 9 : 6).replace(/\/$/, "");
    const user = restoring ? readToken(settings, "restore", key) : enterGroup(key, settings, current);
    return user ? begin(request, settings, user) : locked(api, true, true);
  }
  if (!current) {
    if (settings.local && pathname === "/" && request.method === "GET") {
      return begin(request, settings, enterGroup(settings.group, settings, null)!);
    }
    return locked(api);
  }

  const response = NextResponse.next();
  for (const [key, value] of Object.entries(privateHeaders)) response.headers.set(key, value);
  return response;
}

// Include the static bundles containing player bios, fonts, and portrait image paths.
export const config = { matcher: "/:path*" };
