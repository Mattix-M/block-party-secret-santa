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
