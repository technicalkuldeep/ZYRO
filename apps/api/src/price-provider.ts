import { z } from "zod";
export const pairs = ["BTC-USD", "ETH-USD", "SOL-USD"] as const;
export type Pair = (typeof pairs)[number];
export type Candle = {
  time: number;
  low: number;
  high: number;
  open: number;
  close: number;
  volume: number;
  raw: number[];
};
export function priceUnits(value: number) {
  if (!Number.isFinite(value) || value <= 0 || value > 1e7)
    throw new Error("Invalid price");
  const [whole, decimal = ""] = String(value).split(".");
  if (!/^\d+$/.test(whole) || decimal.length > 8)
    throw new Error("Unsupported price precision");
  return (
    BigInt(whole) * 100000000n +
    BigInt(decimal.padEnd(8, "0"))
  ).toString();
}
export function parseCandles(raw: unknown, now = Date.now()): Candle[] {
  const data = z
    .array(
      z.tuple([
        z.number().int().nonnegative(),
        z.number().positive(),
        z.number().positive(),
        z.number().positive(),
        z.number().positive(),
        z.number().nonnegative(),
      ]),
    )
    .max(400)
    .parse(raw);
  const seen = new Set<number>();
  return data
    .map((row) => {
      const [time, low, high, open, close, volume] = row;
      if (
        time % 60 ||
        seen.has(time) ||
        low > high ||
        open < low ||
        open > high ||
        close < low ||
        close > high ||
        time * 1000 > now + 60000
      )
        throw new Error("Inconsistent candle data");
      seen.add(time);
      priceUnits(close);
      return { time, low, high, open, close, volume, raw: row };
    })
    .filter((c) => (c.time + 60) * 1000 <= now)
    .sort((a, b) => a.time - b.time);
}
export class PriceProvider {
  private cache = new Map<string, { at: number; value: Candle[] }>();
  private pending = new Map<string, Promise<Candle[]>>();
  private queue = Promise.resolve();
  constructor(private transport: typeof fetch = fetch) {}
  fetchedAt(pair: Pair) {
    const value = this.cache.get(pair + ":recent");
    return value ? new Date(value.at).toISOString() : null;
  }
  async candles(pair: Pair, start?: number): Promise<Candle[]> {
    if (!pairs.includes(pair)) throw new Error("Unsupported pair");
    const key = pair + ":" + (start ?? "recent"),
      cached = this.cache.get(key);
    if (cached && Date.now() - cached.at < 30000) return cached.value;
    if (this.pending.has(key)) return this.pending.get(key)!;
    const request = (async () => {
      const previous = this.queue;
      let release!: () => void;
      this.queue = new Promise<void>((r) => {
        release = r;
      });
      await previous;
      try {
        const url = new URL(
          `https://api.exchange.coinbase.com/products/${pair}/candles`,
        );
        url.searchParams.set("granularity", "60");
        if (start !== undefined) {
          url.searchParams.set("start", new Date(start * 1000).toISOString());
          url.searchParams.set(
            "end",
            new Date((start + 60) * 1000).toISOString(),
          );
        }
        const response = await this.transport(url, {
          headers: { Accept: "application/json", "User-Agent": "ZYRO-Arena/2" },
          signal: AbortSignal.timeout(10000),
        });
        if (!response.ok) throw new Error(`Coinbase HTTP ${response.status}`);
        const text = await response.text();
        if (text.length > 200000)
          throw new Error("Provider response too large");
        const value = parseCandles(JSON.parse(text));
        if (!value.length) throw new Error("No completed candles available");
        this.cache.set(key, { at: Date.now(), value });
        if (this.cache.size > 100)
          this.cache.delete(this.cache.keys().next().value!);
        return value;
      } finally {
        await new Promise((r) => setTimeout(r, 150));
        release();
      }
    })();
    this.pending.set(key, request);
    try {
      return await request;
    } finally {
      this.pending.delete(key);
    }
  }
}
