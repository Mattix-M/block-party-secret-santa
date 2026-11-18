import { players } from "./players";

const roster: string[] = players.map((player) => player.id);
const rosterSet = new Set(roster);
const hostPlayer = "gleb";

export type ExchangeUser = { id: string; isHost: boolean };

export interface GiftPreference {
  style: "either" | "funny" | "serious";
  ideas: string;
}
export const giftIdeasLimit = 300;
const defaultGift: GiftPreference = Object.freeze({ style: "either", ideas: "" });

interface Claim {
  userId: string;
  veto: string | null;
  opened: boolean;
  // Older saved registrations omit this field and use the default.
  giftPreference?: GiftPreference;
}

/** Private, JSON-serializable server state. Never send this object to a client. */
export interface Game {
  claims: Record<string, Claim>;
  assignments: Record<string, string> | null;
  published: boolean;
}

export interface ExchangeView {
  claimed: string[];
  mine: string | null;
  myVeto: string | null;
  myGiftPreference: GiftPreference | null;
  recipientGiftPreference: GiftPreference | null;
  drawn: boolean;
  blocked: boolean;
  opened: boolean;
  recipient: string | null;
  published: boolean;
  result: { ids: string[]; count: number } | null;
  isHost: boolean;
}

export class GameError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "GameError";
    this.status = status;
  }
}

export function newGame(): Game {
  return { claims: {}, assignments: null, published: false };
}

function myPlayer(game: Game, user: ExchangeUser | null): string | null {
  if (!user) return null;
  return roster.find((id) => game.claims[id]?.userId === user.id) ?? null;
}

function readGift(value: unknown): GiftPreference {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new GameError(400, "Choose a gift style.");
  }
  const { style, ideas = "" } = value as Record<string, unknown>;
  if (style !== "either" && style !== "funny" && style !== "serious") throw new GameError(400, "Choose a gift style.");
  if (typeof ideas !== "string") throw new GameError(400, "Gift ideas must be text.");
  const text = ideas.trim();
  if (text.length > giftIdeasLimit) throw new GameError(400, "Keep gift ideas to 300 characters.");
  return { style, ideas: text };
}

function changeGift(game: Game, player: string, giftPreference: GiftPreference): Game {
  const claim = game.claims[player];
  const prior = claim.giftPreference ?? defaultGift;
  if (prior.ideas === giftPreference.ideas && prior.style === giftPreference.style) return game;
  return { ...game, claims: { ...game.claims, [player]: { ...claim, giftPreference } } };
}

function randomRank(count: number): number {
  // Ten players have fewer than 10! permissible draws, safely below 2^32.
  const range = 0x100000000;
  const limit = range - (range % count);
  const value = new Uint32Array(1);
  do {
    crypto.getRandomValues(value);
  } while (value[0] >= limit);
  return value[0] % count;
}

function draw(claims: Game["claims"]): Game["assignments"] {
  const candidates = roster.map((giver) =>
    roster.map((recipient, index) => ({ recipient, bit: 1 << index }))
      .filter(({ recipient }) => recipient !== giver && recipient !== claims[giver].veto),
  );

  // The chosen recipient set determines which giver is next. Count every
  // completion from each set and then pick one uniformly, without retrying draws.
  const counts = new Map<number, number>();
  function completions(giver: number, used: number): number {
    if (giver === roster.length) return 1;
    const cached = counts.get(used);
    if (cached !== undefined) return cached;
    let count = 0;
    for (const { bit } of candidates[giver]) {
      if (!(used & bit)) count += completions(giver + 1, used | bit);
    }
    counts.set(used, count);
    return count;
  }

  const total = completions(0, 0);
  if (!total) return null;
  let rank = randomRank(total);
  let used = 0;
  const assignments: Record<string, string> = {};
  for (let giver = 0; giver < roster.length; giver++) {
    for (const { recipient, bit } of candidates[giver]) {
      if (used & bit) continue;
      const count = completions(giver + 1, used | bit);
      if (rank < count) {
        assignments[roster[giver]] = recipient;
        used |= bit;
        break;
      }
      rank -= count;
    }
  }
  return assignments;
}

function topVetoes(game: Game): NonNullable<ExchangeView["result"]> {
  const totals = new Map<string, number>();
  for (const { veto } of Object.values(game.claims)) {
    if (veto !== null) totals.set(veto, (totals.get(veto) ?? 0) + 1);
  }
  const count = Math.max(0, ...totals.values());
  return { ids: roster.filter((id) => totals.get(id) === count), count };
}

export function viewGame(game: Game, user: ExchangeUser | null): ExchangeView {
  const mine = myPlayer(game, user);
  const claim = mine === null ? null : game.claims[mine];
  const claimed = roster.filter((id) => Boolean(game.claims[id]));
  const recipient = mine && claim?.opened ? game.assignments?.[mine] ?? null : null;
  return {
    claimed,
    mine,
    myVeto: claim?.veto ?? null,
    myGiftPreference: claim ? { ...(claim.giftPreference ?? defaultGift) } : null,
    recipientGiftPreference: recipient ? { ...(game.claims[recipient].giftPreference ?? defaultGift) } : null,
    drawn: game.assignments !== null,
    blocked: game.assignments === null && claimed.length === roster.length,
    opened: claim?.opened ?? false,
    recipient,
    published: game.published,
    result: game.published ? topVetoes(game) : null,
    isHost: user?.isHost ?? false,
  };
}

export function applyAction(game: Game, user: ExchangeUser, action: unknown): Game {
  if (!user?.id) throw new GameError(401, "Sign in to join the exchange.");
  if (typeof action !== "object" || action === null || Array.isArray(action)) {
    throw new GameError(400, "Choose an exchange action.");
  }
  const request = action as Record<string, unknown>;
  const mine = myPlayer(game, user);

  switch (request.type) {
    case "register": {
      const { player } = request;
      const veto = request.veto === undefined ? null : request.veto;
      if (typeof player !== "string" || !rosterSet.has(player)) {
        throw new GameError(400, "Pick a name from the lineup.");
      }
      if (veto !== null && (typeof veto !== "string" || !rosterSet.has(veto) || veto === player)) {
        throw new GameError(400, "Pick someone else to veto or skip it.");
      }
      if (user.isHost !== (player === hostPlayer)) {
        throw new GameError(403, user.isHost ? "Your host profile is Gleb." : "Gleb's profile is reserved for the host.");
      }
      if (mine && mine !== player) throw new GameError(409, "You already claimed another name.");
      const previous = game.claims[player];
      if (previous && previous.userId !== user.id) throw new GameError(409, "Someone already claimed that name.");
      const giftPreference = request.giftPreference === undefined
        ? previous?.giftPreference ?? defaultGift
        : readGift(request.giftPreference);
      if (previous && previous.veto === veto) return changeGift(game, player, giftPreference);
      if (game.assignments) throw new GameError(409, "The draw has happened. Vetoes are locked.");
      const claims = { ...game.claims, [player]: { userId: user.id, veto, opened: false, giftPreference } };
      const assignments = Object.keys(claims).length === roster.length ? draw(claims) : null;
      return { ...game, claims, assignments };
    }
    case "gift": {
      if (!mine) throw new GameError(403, "Claim your name before adding gift ideas.");
      return changeGift(game, mine, readGift(request.giftPreference));
    }
    case "open": {
      if (!mine) throw new GameError(403, "Claim your name first.");
      if (!game.assignments) throw new GameError(409, "Your draw isn’t ready yet.");
      if (game.claims[mine].opened) return game;
      return { ...game, claims: { ...game.claims, [mine]: { ...game.claims[mine], opened: true } } };
    }
    case "publish": {
      if (!user.isHost) throw new GameError(403, "Only the host can reveal the results.");
      if (!game.assignments) throw new GameError(409, "Finish the draw before revealing the results.");
      return game.published ? game : { ...game, published: true };
    }
    default:
      throw new GameError(400, "Unknown exchange action.");
  }
}
