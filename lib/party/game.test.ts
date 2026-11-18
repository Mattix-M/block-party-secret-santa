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
    "claimed", "mine", "myVeto", "myGiftPreference", "recipientGiftPreference", "drawn", "blocked", "opened",
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

test("gift choices survive veto edits and only the recipient's Santa sees the note after opening", () => {
  const gift = { style: "funny", ideas: "a tiny ceramic llama" };
  const owner = guests[0];
  let game = applyAction(newGame(), user(owner), {
    type: "register", player: owner, veto: guests[1], giftPreference: { ...gift, ideas: "  " + gift.ideas + "  " },
  });
  assert.deepEqual(viewGame(game, user(owner)).myGiftPreference, gift);
  game = register(game, owner, guests[2]);
  assert.deepEqual(viewGame(game, user(owner)).myGiftPreference, gift);
  for (const id of ids.filter(id => id !== owner)) game = register(game, id);
  assert.ok(game.assignments);
  const santa = ids.find(id => game.assignments![id] === owner)!;
  assert.deepEqual(viewGame(game, null).myGiftPreference, null);
  assert.deepEqual(viewGame(game, user("outsider")).recipientGiftPreference, null);
  for (const id of ids) {
    const view = viewGame(game, user(id));
    assert.equal(view.recipientGiftPreference, null);
    if (id !== owner) assert.ok(!JSON.stringify(view).includes(gift.ideas));
  }
  for (const id of ids) game = applyAction(game, user(id), { type: "open" });
  for (const id of ids) {
    const view = viewGame(game, user(id));
    if (id === santa) assert.deepEqual(view.recipientGiftPreference, gift);
    if (id !== owner && id !== santa) assert.ok(!JSON.stringify(view).includes(gift.ideas));
  }
  const updated = { style: "serious", ideas: "something I can use for class" };
  const change = { type: "gift", giftPreference: updated };
  const edited = applyAction(game, user(owner), change);
  assert.equal(edited.assignments, game.assignments);
  assert.deepEqual(viewGame(game, user(santa)).recipientGiftPreference, gift);
  assert.deepEqual(viewGame(edited, user(santa)).recipientGiftPreference, updated);
  assert.deepEqual(viewGame(edited, user(owner)).myGiftPreference, updated);
  assert.equal(viewGame(edited, user(owner)).opened, true);
  assert.equal(applyAction(edited, user(owner), change), edited);
  assert.equal(register(edited, owner, guests[2]), edited);
});

test("old claims receive defaults on read and can save a preference without reopening the draw", () => {
  const game = JSON.parse(JSON.stringify(fill())) as Game;
  for (const claim of Object.values(game.claims)) delete claim.giftPreference;
  const giver = guests[0], receiver = game.assignments![giver];
  const opened = applyAction(game, user(giver), { type: "open" });
  const empty = { style: "either", ideas: "" };
  assert.deepEqual(viewGame(opened, user(giver)).myGiftPreference, empty);
  assert.deepEqual(viewGame(opened, user(giver)).recipientGiftPreference, empty);
  const gift = { style: "serious", ideas: "the book on my shelf" };
  const edited = applyAction(opened, user(receiver), { type: "gift", giftPreference: gift });
  const restored = JSON.parse(JSON.stringify(edited)) as Game;
  assert.deepEqual(viewGame(restored, user(giver)).recipientGiftPreference, gift);
  assert.deepEqual(restored.assignments, game.assignments);
  assert.equal(restored.claims[giver].opened, true);
  assert.deepEqual(viewGame(applyAction(restored, user(receiver), { type: "gift", giftPreference: { style: "either" } }),
    user(receiver)).myGiftPreference, empty);
});

test("gift validation enforces ownership, known styles and a 300 UTF-16 unit note limit", () => {
  const id = guests[0];
  const game = register(newGame(), id);
  const submit = (giftPreference: unknown) => applyAction(game, user(id), { type: "gift", giftPreference });
  assert.throws(() => applyAction(game, user("outsider"), { type: "gift", player: id, giftPreference: { style: "funny" } }), status(403));
  for (const invalid of [
    null, [], {}, "", "funny", { style: 3 }, { style: "practical" },
    { style: "serious", ideas: false }, { style: "funny", ideas: null },
    { style: "either", ideas: "a".repeat(301) }, { style: "serious", ideas: "🎁".repeat(151) },
  ]) {
    assert.throws(() => submit(invalid), status(400));
    assert.throws(() => applyAction(newGame(), user(id), { type: "register", player: id, giftPreference: invalid }), status(400));
  }
  const max = "🎁".repeat(150);
  const accepted = submit({ style: "either", ideas: " " + max + "\n" });
  assert.equal(viewGame(accepted, user(id)).myGiftPreference!.ideas, max);
  assert.deepEqual(viewGame(submit({ style: "funny", ideas: "   " }), user(id)).myGiftPreference, { style: "funny", ideas: "" });
  const seen = viewGame(accepted, user(id));
  seen.myGiftPreference!.ideas = "changed by a view consumer";
  assert.equal(viewGame(accepted, user(id)).myGiftPreference!.ideas, max);
});
