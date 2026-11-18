import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { newGame } from "../party/game";
import type { Game } from "../party/game";
import { loadGame, sealGame } from "./state-cipher";

const scope = "local";

export function withLocalGame(secret: string, change: (game: Game) => Game): Game {
  const directory = join(process.cwd(), ".local");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(join(directory, "exchange.sqlite"));
  try {
    db.exec("PRAGMA busy_timeout=5000; PRAGMA secure_delete=ON; CREATE TABLE IF NOT EXISTS exchange (id INTEGER PRIMARY KEY CHECK(id=1), body TEXT NOT NULL)");
    db.exec("BEGIN IMMEDIATE");
    const row = db.prepare("SELECT body FROM exchange WHERE id=1").get();
    const { game, legacy } = row ? loadGame(String(row.body), secret, scope) : { game: newGame(), legacy: false };
    const updated = change(game);
    if (legacy || updated !== game) {
      db.prepare("INSERT INTO exchange(id,body) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body")
        .run(sealGame(updated, secret, scope));
    }
    db.exec("COMMIT");
    return updated;
  } finally {
    // Closing rolls back the transaction if validation, decryption or writing failed.
    db.close();
  }
}
