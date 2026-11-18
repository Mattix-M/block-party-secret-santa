import { createHash } from "node:crypto";
import { BlobPreconditionFailedError, get, put } from "@vercel/blob";
import { applyAction, newGame } from "../party/game";
import type { Game } from "../party/game";
import type { PartyUser } from "./session";
import { loadGame, sealGame } from "./state-cipher";

function blobPath() {
  if (process.env.VERCEL_ENV === "preview") {
    const ref = process.env.VERCEL_GIT_COMMIT_REF || process.env.VERCEL_URL || "draft";
    const preview = createHash("sha256").update(ref).digest("hex").slice(0, 20);
    return `block-party-2026/previews/${preview}/exchange.json`;
  }
  return "block-party-2026/production/exchange.json";
}

export function blobWriteEtag(readEtag: string): string {
  // A compressed private GET prefixes Blob's opaque, quoted write validator with W/.
  // Use the validator from the very response that supplied the encrypted game bytes.
  return readEtag.startsWith('W/"') ? readEtag.slice(2) : readEtag;
}

async function readBlob(path: string, secret: string) {
  const blob = await get(path, { access: "private", useCache: false });
  if (!blob) return { game: newGame(), etag: null, legacy: false };
  if (blob.statusCode !== 200 || !blob.blob.etag) throw new Error("Could not read the current exchange version");
  const stored = await new Response(blob.stream).text();
  return { ...loadGame(stored, secret, path), etag: blobWriteEtag(blob.blob.etag) };
}

async function withGame(secret: string, change: (game: Game) => Game): Promise<Game> {
  if (!process.env.VERCEL) return (await import("./local-store")).withLocalGame(secret, change);
  const path = blobPath();
  for (let attempt = 0; attempt < 12; attempt++) {
    const { game, etag, legacy } = await readBlob(path, secret);
    const updated = change(game);
    if (!legacy && updated === game) return game;
    try {
      await put(path, sealGame(updated, secret, path), {
        access: "private",
        addRandomSuffix: false,
        contentType: "application/octet-stream",
        ...(etag ? { ifMatch: etag } : { allowOverwrite: false }),
      });
      return updated;
    } catch (error) {
      if (!(error instanceof BlobPreconditionFailedError)) {
        // A concurrent first writer can also surface as an ordinary "already exists" error.
        if (etag || !(await readBlob(path, secret)).etag) throw error;
      }
      await new Promise(resolve => setTimeout(resolve, 20 + Math.random() * 60 * (attempt + 1)));
    }
  }
  throw new Error("The exchange is busy");
}

export function readGame(secret: string): Promise<Game> {
  return withGame(secret, game => game);
}

export function updateGame(secret: string, user: PartyUser, action: unknown): Promise<Game> {
  return withGame(secret, game => applyAction(game, user, action));
}
