import { NextRequest, NextResponse } from "next/server";
import { GameError, viewGame } from "../../../lib/party/game";
import { cookieName, readToken, recoveryPath, sessionConfig } from "../../../lib/server/session";
import { readGame, updateGame } from "../../../lib/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = {
  "Cache-Control": "private, no-store",
  "CDN-Cache-Control": "no-store",
  "Vercel-CDN-Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "Vary": "Cookie",
};

function reply(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers });
}

function sameOrigin(request: NextRequest) {
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return false;
  const origin = request.headers.get("origin");
  if (!origin) return site === "same-origin";
  let url: URL;
  try { url = new URL(origin); } catch { return false; }
  if (url.origin !== origin) return false;
  if (origin === request.nextUrl.origin) return true;
  // Some local reverse proxies normalize Next's URL to localhost. Host is the
  // browser's actual target. A third-party origin can't set this header in JS.
  return (url.protocol === "https:" || (!process.env.VERCEL && url.protocol === "http:"))
    && url.host === request.headers.get("host");
}

async function handle(request: NextRequest, write: boolean) {
  const settings = sessionConfig(request.nextUrl.hostname);
  if (!settings) return reply({ error: "The host is getting the exchange ready." }, 503);
  const user = readToken(settings, "session", request.cookies.get(cookieName)?.value);
  if (!user) return reply({ error: "Open your group invite or your private return link." }, 401);

  let action: unknown;
  if (write) {
    if (!sameOrigin(request)) return reply({ error: "Open the exchange to make that change." }, 403);
    if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
      return reply({ error: "Send the form from the exchange." }, 415);
    }
    if (Number(request.headers.get("content-length") || 0) > 2048) return reply({ error: "That request is too large." }, 413);
    try {
      const text = await request.text();
      if (text.length > 2048) return reply({ error: "That request is too large." }, 413);
      action = JSON.parse(text);
      if (action && typeof action === "object" && "type" in action && action.type === "publish") {
        return reply({ error: "The host can view the final tally privately." }, 403);
      }
    } catch {
      return reply({ error: "That request could not be read." }, 400);
    }
  }

  try {
    const game = write ? await updateGame(settings.secret, user, action) : await readGame(settings.secret);
    const view = viewGame(game, user);
    return reply({
      ...view,
      // Compute the aggregate in memory. The public reveal flag never changes here.
      ...(view.isHost && view.drawn ? { hostResult: viewGame({ ...game, published: true }, user).result } : {}),
      recoveryPath: recoveryPath(settings, user),
      ...(user.isHost ? { groupInvitePath: "/join/" + settings.group } : {}),
    });
  } catch (error) {
    if (error instanceof GameError) return reply({ error: error.message }, error.status);
    console.error("[block-party] Exchange storage unavailable", error instanceof Error ? error.name : "unknown");
    return reply({ error: "Couldn’t reach the exchange. Give it a second and try again." }, 503);
  }
}

export function GET(request: NextRequest) { return handle(request, false); }
export function POST(request: NextRequest) { return handle(request, true); }
