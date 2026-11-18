import { describe, it, expect } from "vitest";
import {
  evaluate,
  outcome,
  commitment,
  uniform,
  rulesHash,
} from "../apps/api/src/game-random.js";
import { gameDefinitions } from "../packages/shared/src/arena-games.js";
import { parseCandles, priceUnits } from "../apps/api/src/price-provider.js";
describe("versioned quick-game rules", () => {
  it("above/below maps both boundary outcomes", () => {
    for (const n of [0, 49, 50, 99])
      expect(evaluate("quick-draw", n >= 50 ? "YES" : "NO", [n]).verdict).toBe(
        "WIN",
      );
  });
  it("fair coin maps both sides", () => {
    expect(evaluate("coin-flip", "HEADS", [0]).verdict).toBe("WIN");
    expect(evaluate("coin-flip", "HEADS", [1]).verdict).toBe("LOSS");
  });
  it("all 36 dice draws give 15 above, 15 below and six refunds", () => {
    const counts = { WIN: 0, LOSS: 0, TIE: 0 };
    for (let a = 1; a <= 6; a++)
      for (let b = 1; b <= 6; b++)
        counts[evaluate("dice-duel", "ABOVE", [a, b]).verdict]++;
    expect(counts).toEqual({ WIN: 15, LOSS: 15, TIE: 6 });
  });
  it("all 52 cards contain 26 red and 26 black", () => {
    let red = 0;
    for (let c = 0; c < 52; c++)
      red += evaluate("red-black", "RED", [c]).verdict === "WIN" ? 1 : 0;
    expect(red).toBe(26);
    for (const c of [0, 13])
      expect(evaluate("red-black", "RED", [c]).verdict).toBe("WIN");
    for (const c of [26, 39])
      expect(evaluate("red-black", "BLACK", [c]).verdict).toBe("WIN");
  });
  it("all eight triple flips have a majority, split evenly", () => {
    let heads = 0;
    for (let a = 0; a < 2; a++)
      for (let b = 0; b < 2; b++)
        for (let c = 0; c < 2; c++) {
          const r = evaluate("triple-flip", "HEADS", [a, b, c]);
          expect(r.verdict).not.toBe("TIE");
          heads += r.verdict === "WIN" ? 1 : 0;
        }
    expect(heads).toBe(4);
  });
  it("all RPS combinations produce three wins, losses and ties", () => {
    const counts = { WIN: 0, LOSS: 0, TIE: 0 };
    for (const choice of ["ROCK", "PAPER", "SCISSORS"])
      for (let bot = 0; bot < 3; bot++)
        counts[evaluate("rock-paper-scissors", choice, [bot]).verdict]++;
    expect(counts).toEqual({ WIN: 3, LOSS: 3, TIE: 3 });
  });
  it("lucky numbers correctly compare higher, lower and equal", () => {
    expect(evaluate("lucky-number", "PLAY", [100, 1]).verdict).toBe("WIN");
    expect(evaluate("lucky-number", "PLAY", [1, 100]).verdict).toBe("LOSS");
    expect(evaluate("lucky-number", "PLAY", [77, 77]).verdict).toBe("TIE");
  });
  it("labelled rejection sampling is deterministic and bounded", () => {
    for (let i = 0; i < 1000; i++)
      for (const size of [2, 3, 6, 52, 100]) {
        const n = uniform(i.toString(16).padStart(64, "0"), "test", size);
        expect(n).toBeGreaterThanOrEqual(0);
        expect(n).toBeLessThan(size);
      }
    expect(() => uniform("00", "test", 0)).toThrow();
  });
  it("secret and rule-bound commitments cannot be swapped", () => {
    const s = "12".repeat(32);
    expect(commitment("a", "coin-flip", s)).not.toBe(
      commitment("b", "coin-flip", s),
    );
    expect(commitment("a", "coin-flip", s)).not.toBe(
      commitment("a", "triple-flip", s),
    );
    expect(rulesHash("coin-flip")).toHaveLength(64);
  });
  it("RPS bot selection is independent of the final player choice", () => {
    const secret = "ab".repeat(32);
    expect(outcome("rock-paper-scissors", secret, "ROCK").bot).toBe(
      outcome("rock-paper-scissors", secret, "PAPER").bot,
    );
  });
  it("every engine reveals stable values within its range", () => {
    for (const g of gameDefinitions) {
      const r = outcome(g.key, "cd".repeat(32), g.choices[0]);
      expect(outcome(g.key, "cd".repeat(32), g.choices[0])).toEqual(r);
      expect(r.values.length).toBeGreaterThan(0);
      if (g.key === "lucky-number")
        for (const v of r.values) {
          expect(v).toBeGreaterThanOrEqual(1);
          expect(v).toBeLessThanOrEqual(100);
        }
    }
  });
});
describe("completed provider candles", () => {
  const t = Math.floor(Date.now() / 60000) * 60 - 120;
  it("discards forming candles and sorts actual completed timestamps", () => {
    expect(
      parseCandles([
        [t + 120, 10, 12, 11, 12, 3],
        [t, 10, 12, 11, 12, 3],
      ]),
    ).toHaveLength(1);
  });
  it("rejects inconsistent prices, duplicate times and invalid schemas", () => {
    for (const rows of [
      [[t, 13, 12, 11, 12, 3]],
      [
        [t, 10, 12, 11, 12, 3],
        [t, 10, 12, 11, 12, 3],
      ],
      [[t + 1, 10, 12, 11, 12, 3]],
      [[t, -1, 12, 11, 12, 3]],
    ])
      expect(() => parseCandles(rows)).toThrow();
  });
  it("price comparisons use exact eight-decimal integers", () => {
    expect(priceUnits(62486.01)).toBe("6248601000000");
    expect(priceUnits(72.8567)).toBe("7285670000");
    expect(() => priceUnits(Infinity)).toThrow();
  });
});
