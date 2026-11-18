import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { NextRequest } from "next/server";
import { GET, POST } from "../../app/api/exchange/route";
import { newGame } from "../party/game";
import { players } from "../party/players";
import { cookieName, makeToken } from "./session";
import { loadGame, sealGame } from "./state-cipher";
import { readGame } from "./store";

function freshSecret() { return randomBytes(32).toString("base64url"); }

test("game ciphertext is randomized, authenticated, and scoped to its private store", () => {
  const secret = freshSecret();
  const game = newGame();
  const sealed = sealGame(game, secret, "production");
  assert.notEqual(sealed, sealGame(game, secret, "production"));
  assert.deepEqual(loadGame(sealed, secret, "production"), { game, legacy: false });
  const bytes = Buffer.from(sealed.slice(4), "base64url");
  bytes[bytes.length - 1] ^= 1;
  assert.throws(() => loadGame("BP1." + bytes.toString("base64url"), secret, "production"));
  assert.throws(() => loadGame(sealed, freshSecret(), "production"));
  assert.throws(() => loadGame(sealed, secret, "preview"));
  assert.throws(() => loadGame('{"version":99}', secret, "production"));
});

test("the API privately gives only the completed aggregate to the host and migrates earlier records", async () => {
  const settings = { group: freshSecret(), host: freshSecret(), secret: freshSecret(), local: false };
  const oldDir = process.cwd();
  const directory = mkdtempSync(join(tmpdir(), "block-party-privacy-"));
  const previous = Object.fromEntries(["GROUP_INVITE", "HOST_INVITE", "SESSION_SECRET", "VERCEL"].map(k => [k, process.env[k]]));
  try {
    process.chdir(directory);
    delete process.env.VERCEL;
    Object.assign(process.env, { GROUP_INVITE: settings.group, HOST_INVITE: settings.host, SESSION_SECRET: settings.secret });
    mkdirSync(".local", { mode: 0o700 });
    const sqlite = new DatabaseSync(".local/exchange.sqlite");
    sqlite.exec("CREATE TABLE exchange(id INTEGER PRIMARY KEY,body TEXT NOT NULL)");
    sqlite.prepare("INSERT INTO exchange(id,body) VALUES(1,?)").run(JSON.stringify(newGame()));
    assert.deepEqual(await readGame(settings.secret), newGame());
    const stored = () => String(sqlite.prepare("SELECT body FROM exchange WHERE id=1").get()?.body);
    assert.ok(stored().startsWith("BP1."));

    const cookies = new Map(players.map(p => {
      const isHost = p.id === "gleb";
      return [p.id, cookieName + "=" + makeToken(settings, "session", { id: isHost ? "party-host" : randomUUID(), isHost })];
    }));
    async function request(id: string, action?: unknown) {
      const request = new NextRequest("http://localhost/api/exchange", {
        method: action ? "POST" : "GET",
        headers: { cookie: cookies.get(id)!, origin: "http://localhost", "content-type": "application/json" },
        body: action ? JSON.stringify(action) : undefined,
      });
      const response = await (action ? POST : GET)(request);
      return { status: response.status, body: await response.json() };
    }
    assert.equal("hostResult" in (await request("gleb")).body, false);
    for (const player of players) {
      const veto = ["macy", "gleb"].includes(player.id) ? "brady" : null;
      const res = await request(player.id, { type: "register", player: player.id, veto });
      assert.equal(res.status, 200);
      assert.equal(res.body.myVeto, veto);
      assert.equal(res.body.recipient, null);
    }
    assert.ok(stored().startsWith("BP1."));
    assert.ok(!stored().includes('"claims"'));
    assert.deepEqual((await request("gleb")).body.hostResult, { ids: ["brady"], count: 2 });
    for (const player of players) {
      const { body } = await request(player.id);
      assert.equal("hostResult" in body, player.id === "gleb");
      assert.equal(body.result, null);
      assert.equal(body.published, false);
      for (const forbidden of ["claims", "assignments", "userId", "votes"]) assert.equal(forbidden in body, false);
      assert.equal((await request(player.id, { type: "publish" })).status, 403);
    }
    assert.equal((await readGame(settings.secret)).published, false);
    const hostOpen = await request("gleb", { type: "open" });
    assert.equal(typeof hostOpen.body.recipient, "string");
    assert.equal(hostOpen.body.recipient === "brady" || hostOpen.body.recipient === "gleb", false);
    sqlite.close();
  } finally {
    process.chdir(oldDir);
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    rmSync(directory, { recursive: true, force: true });
  }
});

test("invite and recovery redirects survive the production adapter and preserve cookie origin", async () => {
  const { proxy } = await import("../../proxy");
  const origin = "https://party.example.test";
  const urlHost = "party.example.test";
  const deployment = "https://generated-deployment.vercel.app";
  const setup = { group: freshSecret(), host: freshSecret(), secret: freshSecret(), local: false };
  const names = ["GROUP_INVITE", "HOST_INVITE", "SESSION_SECRET", "VERCEL", "VERCEL_PROJECT_PRODUCTION_URL"];
  const previous = Object.fromEntries(names.map(key => [key, process.env[key]]));
  try {
    Object.assign(process.env, {
      GROUP_INVITE: setup.group, HOST_INVITE: setup.host, SESSION_SECRET: setup.secret,
      VERCEL: "1", VERCEL_PROJECT_PRODUCTION_URL: urlHost,
    });
    for (const link of [origin + "/join/" + setup.group + "?from=chat", deployment + "/join/" + setup.host,
      origin + "/restore/" + makeToken(setup, "restore", { id: randomUUID(), isHost: false })]) {
      const response = proxy(new NextRequest(link, { headers: { host: urlHost, "x-forwarded-host": "different.example.test" } }));
      assert.equal(response.status, 303);
      // Next 16 constructs an absolute URL from this header before serializing it.
      assert.equal(new URL(response.headers.get("location")!).href, origin + "/");
      assert.equal(response.headers.get("referrer-policy"), "no-referrer");
      const cookie = response.cookies.get(cookieName)!;
      assert.ok(cookie.value);
      assert.equal(cookie.httpOnly, true);
      assert.equal(cookie.secure, true);
      assert.equal(cookie.sameSite, "lax");
      assert.equal(cookie.path, "/");
      assert.equal(cookie.domain, undefined);
      const followup = proxy(new NextRequest(origin + "/", { headers: { host: urlHost, cookie: cookieName + "=" + cookie.value } }));
      assert.equal(followup.status, 200);
      assert.equal(followup.headers.get("x-middleware-next"), "1");
    }
    const arbitrary = proxy(new NextRequest(origin + "/join/" + setup.group, {
      headers: { host: "outsider.example.test", "x-forwarded-host": "another.example.test" },
    }));
    assert.equal(arbitrary.headers.get("location"), origin + "/");
    assert.equal(proxy(new NextRequest(origin + "/players/demo.jpg")).status, 401);

    delete process.env.VERCEL;
    const localHost = "127.0.0.1:4444";
    const local = proxy(new NextRequest("http://" + localHost + "/join/" + setup.group, { headers: { host: localHost } }));
    assert.equal(local.headers.get("location"), "http://" + localHost + "/");
    assert.equal(Boolean(local.cookies.get(cookieName)?.secure), false);
    const localForwarded = proxy(new NextRequest("http://localhost:4444/join/" + setup.group, {
      headers: { host: "untrusted.example.test:4444", "x-forwarded-host": "untrusted.example.test" },
    }));
    assert.equal(localForwarded.headers.get("location"), "http://localhost:4444/");
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
