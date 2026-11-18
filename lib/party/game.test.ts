import assert from "node:assert/strict";
import test from "node:test";
import { applyAction, GameError, newGame, viewGame } from "./game";
import { players } from "./players";
import type { ExchangeUser, Game } from "./game";

const ids: string[] = players.map((player) => player.id);
const guests = ids.filter((id) => id !== "gleb");
const user = (player: string): ExchangeUser => ({ id: "user-" + player, isHost: player === "gleb" });
const register = (game: Game, player: string, veto: string | null = null) =>
  applyAction(game, user(player), { type: "register", player, veto });
const fill = (vetoFor: (player: string) => string | null = () => null) =>
  ids.reduce((game, player) => register(game, player, vetoFor(player)), newGame());
const status = (code: number) => (error: unknown) => error instanceof GameError && error.status === code;

test("profiles are unique, each player gets one account and Gleb is reserved", () => {
  const initial = newGame();
  const first = register(initial, guests[0]);
  assert.deepEqual(initial, newGame());
  assert.deepEqual(viewGame(first, null).claimed, [guests[0]]);
  assert.throws(() => applyAction(first, user(guests[1]), { type: "register", player: guests[0] }), status(409));
  assert.throws(() => applyAction(first, user(guests[0]), { type: "register", player: guests[1] }), status(409));
  assert.throws(() => applyAction(first, user(guests[1]), { type: "register", player: "gleb" }), status(403));
  assert.throws(() => applyAction(first, user("gleb"), { type: "register", player: guests[1] }), status(403));
  assert.throws(() => register(first, guests[1], guests[1]), status(400));
  assert.throws(() => register(first, guests[1], "missing"), status(400));
  assert.throws(() => register(first, "constructor"), status(400));
  assert.throws(() => applyAction(first, { id: "", isHost: false }, { type: "open" }), status(401));
});

test("a voter can replace or clear their veto before the draw", () => {
  const old = register(newGame(), guests[0], guests[1]);
  const edited = register(old, guests[0], guests[2]);
  assert.equal(viewGame(old, user(guests[0])).myVeto, guests[1]);
  assert.equal(viewGame(edited, user(guests[0])).myVeto, guests[2]);
  assert.equal(viewGame(edited, user("gleb")).myVeto, null);
  assert.equal(register(edited, guests[0], guests[2]), edited);
  assert.equal(viewGame(register(edited, guests[0]), user(guests[0])).myVeto, null);
  assert.throws(() => applyAction(edited, user(guests[0]), { type: "open" }), status(409));
});

test("every successful draw is a bijection with no self draws and no veto violations", () => {
  for (let trial = 0; trial < ids.length * 2; trial++) {
    const offset = 1 + trial % (ids.length - 1);
    const vetoFor = (id: string) => ids[(ids.indexOf(id) + offset) % ids.length];
    const game = fill(vetoFor);
    assert.ok(game.assignments);
    assert.deepEqual(Object.values(game.assignments).sort(), [...ids].sort());
    for (const [giver, recipient] of Object.entries(game.assignments)) {
      assert.notEqual(giver, recipient);
      assert.notEqual(vetoFor(giver), recipient);
    }
    assert.equal(register(game, ids[0], vetoFor(ids[0])), game);
    assert.throws(() => register(game, ids[0], null), status(409));
  }
});

test("a blocked draw is recoverable without violating a veto", () => {
  const blocked = fill((id) => id === "gleb" ? null : "gleb");
  assert.equal(blocked.assignments, null);
  assert.equal(viewGame(blocked, user("gleb")).blocked, true);
  assert.throws(() => applyAction(blocked, user("gleb"), { type: "publish" }), status(409));
  const resolved = register(blocked, guests[0], null);
  assert.equal(resolved.assignments?.[guests[0]], "gleb");
  assert.equal(viewGame(resolved, null).blocked, false);
  assert.equal(viewGame(blocked, null).blocked, true);
});

test("only the participant can open their assignment and the result persists", () => {
  const drawn = fill();
  const participant = guests[0];
  assert.equal(viewGame(drawn, user(participant)).recipient, null);
  assert.throws(() => applyAction(drawn, user("outsider"), { type: "open" }), status(403));
  const opened = applyAction(drawn, user(participant), { type: "open" });
  const view = viewGame(opened, user(participant));
  assert.equal(view.opened, true);
  assert.equal(view.recipient, opened.assignments?.[participant]);
  assert.equal(viewGame(opened, user(guests[1])).recipient, null);
  assert.equal(viewGame(opened, user("gleb")).recipient, null);
  assert.equal(viewGame(opened, null).recipient, null);
  assert.equal(applyAction(opened, user(participant), { type: "open" }), opened);
  assert.equal(viewGame(drawn, user(participant)).opened, false);
  assert.deepEqual(Object.keys(view).sort(), [
    "claimed", "mine", "myVeto", "drawn", "blocked", "opened",
    "recipient", "published", "result", "isHost",
  ].sort());
});

test("results reveal only the most-vetoed recipients, including ties or zero votes", () => {
  const votes: Record<string, string> = {
    [guests[2]]: guests[0], [guests[3]]: guests[0],
    [guests[4]]: guests[1], [guests[5]]: guests[1],
    [guests[6]]: guests[2],
  };
  const before = fill((id) => votes[id] ?? null);
  assert.equal(viewGame(before, user("gleb")).result, null);
  assert.throws(() => applyAction(before, user(guests[0]), { type: "publish" }), status(403));
  const after = applyAction(before, user("gleb"), { type: "publish" });
  assert.deepEqual(viewGame(after, null).result, { ids: [guests[0], guests[1]], count: 2 });
  assert.equal(viewGame(after, user(guests[0])).myVeto, null);
  assert.equal(applyAction(after, user("gleb"), { type: "publish" }), after);
  assert.deepEqual(viewGame(applyAction(fill(), user("gleb"), { type: "publish" }), null).result,
    { ids: [], count: 0 });
});
