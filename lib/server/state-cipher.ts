import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import type { Game } from "../party/game";

const prefix = "BP1.";
const nonceBytes = 12;
const tagBytes = 16;

function key(secret: string, scope: string) {
  if (secret.length < 32) throw new Error("A storage encryption secret is required");
  // Separate the storage key from invite/session signatures and other environments.
  return Buffer.from(hkdfSync("sha256", secret, "block-party-2026", "game:v1:" + scope, 32));
}

export function sealGame(game: Game, secret: string, scope: string): string {
  const iv = randomBytes(nonceBytes);
  const cipher = createCipheriv("aes-256-gcm", key(secret, scope), iv, { authTagLength: tagBytes });
  const contents = Buffer.concat([cipher.update(JSON.stringify(game), "utf8"), cipher.final()]);
  return prefix + Buffer.concat([iv, cipher.getAuthTag(), contents]).toString("base64url");
}

export function loadGame(stored: string, secret: string, scope: string): { game: Game; legacy: boolean } {
  if (!stored.startsWith(prefix)) {
    // The original format was just a Game object. Rewrap it before returning a successful read.
    const state = JSON.parse(stored);
    if (!state || typeof state.claims !== "object" || state.claims === null ||
        Array.isArray(state.claims) || typeof state.published !== "boolean" ||
        !(state.assignments === null || (typeof state.assignments === "object" && !Array.isArray(state.assignments)))) {
      throw new Error("Unrecognized exchange format");
    }
    return { game: state as Game, legacy: true };
  }
  const bytes = Buffer.from(stored.slice(prefix.length), "base64url");
  if (bytes.length <= nonceBytes + tagBytes) throw new Error("Unreadable exchange");
  const decipher = createDecipheriv("aes-256-gcm", key(secret, scope), bytes.subarray(0, nonceBytes), { authTagLength: tagBytes });
  decipher.setAuthTag(bytes.subarray(nonceBytes, nonceBytes + tagBytes));
  const data = Buffer.concat([decipher.update(bytes.subarray(nonceBytes + tagBytes)), decipher.final()]);
  return { game: JSON.parse(data.toString("utf8")) as Game, legacy: false };
}
