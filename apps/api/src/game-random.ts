import { createHmac, createHash } from "node:crypto";
import {
  gameDefinition,
  type GameKey,
  type GameResult,
} from "../../../packages/shared/src/arena-games.js";
export const digest = (text: string) =>
  createHash("sha256").update(text).digest("hex");
export function rulesHash(key: GameKey) {
  return digest(
    JSON.stringify({
      version: 2,
      game: gameDefinition(key),
      mapping: "hmac-sha256-rejection-v1",
      payout: "win=2*stake;loss=0;tie=stake",
      delayMs: 3000,
    }),
  );
}
export function commitment(id: string, key: GameKey, secret: string) {
  return digest(
    JSON.stringify({ version: 2, id, key, rulesHash: rulesHash(key), secret }),
  );
}
// Rejection sampling removes modulo bias. Each value has an independent labelled stream.
export function uniform(secret: string, label: string, size: number) {
  if (!Number.isInteger(size) || size < 1 || size > 1000)
    throw new Error("Invalid range");
  const limit = Math.floor(4294967296 / size) * size;
  for (let counter = 0; counter < 10000; counter++) {
    const n = createHmac("sha256", Buffer.from(secret, "hex"))
      .update(`${label}:${counter}`)
      .digest()
      .readUInt32BE(0);
    if (n < limit) return n % size;
  }
  throw new Error("Random mapping exhausted");
}
export function evaluate(
  key: GameKey,
  choice: string,
  values: number[],
): GameResult {
  let label = "",
    bot: string | undefined,
    verdict: GameResult["verdict"];
  if (key === "quick-draw") label = values[0] >= 50 ? "YES" : "NO";
  if (key === "coin-flip") label = values[0] ? "TAILS" : "HEADS";
  if (key === "dice-duel")
    label =
      values[0] + values[1] === 7
        ? "TIE"
        : values[0] + values[1] > 7
          ? "ABOVE"
          : "BELOW";
  if (key === "red-black")
    label = Math.floor(values[0] / 13) < 2 ? "RED" : "BLACK";
  if (key === "triple-flip")
    label = values.filter((v) => v === 0).length >= 2 ? "HEADS" : "TAILS";
  if (key === "rock-paper-scissors") {
    bot = ["ROCK", "PAPER", "SCISSORS"][values[0]];
    verdict =
      choice === bot
        ? "TIE"
        : (
              { ROCK: "SCISSORS", PAPER: "ROCK", SCISSORS: "PAPER" } as Record<
                string,
                string
              >
            )[choice] === bot
          ? "WIN"
          : "LOSS";
    return { values, bot, label: bot, verdict };
  }
  if (key === "lucky-number")
    return {
      values,
      label: `${values[0]} vs ${values[1]}`,
      verdict:
        values[0] === values[1]
          ? "TIE"
          : values[0] > values[1]
            ? "WIN"
            : "LOSS",
    };
  verdict = label === "TIE" ? "TIE" : choice === label ? "WIN" : "LOSS";
  return { values, label, verdict };
}
export function outcome(key: GameKey, secret: string, choice: string) {
  const roll = (i: number, n: number, add = 0) =>
    uniform(secret, `${key}:${i}`, n) + add;
  const values =
    key === "quick-draw"
      ? [roll(0, 100)]
      : key === "coin-flip"
        ? [roll(0, 2)]
        : key === "dice-duel"
          ? [roll(0, 6, 1), roll(1, 6, 1)]
          : key === "red-black"
            ? [roll(0, 52)]
            : key === "triple-flip"
              ? [roll(0, 2), roll(1, 2), roll(2, 2)]
              : key === "rock-paper-scissors"
                ? [roll(0, 3)]
                : [roll(0, 100, 1), roll(1, 100, 1)];
  return evaluate(key, choice, values);
}
