import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { existsSync, linkSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type PartyUser = { id: string; isHost: boolean };
export type SessionConfig = { group: string; host: string; secret: string; local: boolean };

export const cookieName = "bp472_session";
export const cookieLifetime = 180 * 24 * 60 * 60;

function localSecret() {
  const directory = join(process.cwd(), ".local");
  const keyFile = join(directory, "session-key");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (!existsSync(keyFile)) {
    const temp = join(directory, `session-key-${randomUUID()}`);
    writeFileSync(temp, randomBytes(32).toString("base64url"), { mode: 0o600, flag: "wx" });
    try {
      // Install only a complete key, even if two local server processes start together.
      linkSync(temp, keyFile);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    } finally {
      unlinkSync(temp);
    }
  }
  return readFileSync(keyFile, "utf8");
}

export function sessionConfig(hostname: string): SessionConfig | null {
  const group = process.env.GROUP_INVITE;
  const host = process.env.HOST_INVITE;
  const secret = process.env.SESSION_SECRET;
  if (group || host || secret) {
    if (!group || !host || !secret || !/^[A-Za-z0-9_-]{24,256}$/.test(group) ||
      !/^[A-Za-z0-9_-]{24,256}$/.test(host) || secret.length < 32 ||
      new Set([group, host, secret]).size !== 3) return null;
    return { group, host, secret, local: false };
  }

  const loopback = ["localhost", "127.0.0.1", "[::1]", "::1"].includes(hostname);
  const local = !process.env.VERCEL && loopback &&
    (process.env.NODE_ENV === "development" || process.env.PARTY_LOCAL === "1");
  if (!local) return null;
  return { group: "group-local", host: "host-local", secret: localSecret(), local };
}

function equalSecret(a: string, b: string) {
  // Hash to fixed length before constant-time comparison. Input lengths may differ.
  return timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());
}

export function enterGroup(key: string, settings: SessionConfig, current: PartyUser | null): PartyUser | null {
  if (equalSecret(key, settings.host)) return { id: "party-host", isHost: true };
  if (equalSecret(key, settings.group)) return current ?? { id: randomUUID(), isHost: false };
  return null;
}

type TokenKind = "session" | "restore";

function signature(secret: string, kind: TokenKind, payload: string) {
  return createHmac("sha256", secret).update(`bp472.v1.${kind}.${payload}`).digest("base64url");
}

export function makeToken(settings: SessionConfig, kind: TokenKind, user: PartyUser): string {
  const expires = Math.floor(Date.now() / 1000) + cookieLifetime;
  const payload = `${user.id}.${expires}`;
  return `${payload}.${signature(settings.secret, kind, payload)}`;
}

export function readToken(settings: SessionConfig, kind: TokenKind, value?: string): PartyUser | null {
  if (!value || value.length > 180) return null;
  const parts = value.split(".");
  if (parts.length !== 3) return null;
  const [id, exp, mac] = parts;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  if (id !== "party-host" && !uuid.test(id)) return null;
  if (!/^\d{10,11}$/.test(exp) || Number(exp) <= Date.now() / 1000) return null;
  if (!equalSecret(mac, signature(settings.secret, kind, `${id}.${exp}`))) return null;
  return { id, isHost: id === "party-host" };
}

export function recoveryPath(settings: SessionConfig, user: PartyUser): string {
  return "/restore/" + makeToken(settings, "restore", user);
}
