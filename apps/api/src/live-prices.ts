import { pairs, priceUnits, type Pair } from "./price-provider.js";
type LiveBar = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
};
export type Tick = {
  pair: Pair;
  price: number;
  time: number;
  receivedAt: number;
  sequence: number;
  tradeId: number;
  bars?: Record<number, LiveBar>;
};
export class LivePrices {
  ticks = new Map<Pair, Tick>();
  hearts = new Map<Pair, number>();
  listeners = new Set<() => void>();
  metrics = { received: 0, accepted: 0, rejected: 0, reconnects: 0, gaps: 0 };
  state = "Connecting";
  generation = 0;
  private socket?: WebSocket;
  private timer?: ReturnType<typeof setTimeout>;
  private monitor?: ReturnType<typeof setInterval>;
  private stopped = true;
  private attempt = 0;
  private connectedAt = 0;
  private bars = new Map<string, LiveBar>();
  constructor(
    private connectSocket = () =>
      new WebSocket("wss://ws-feed.exchange.coinbase.com"),
  ) {}
  fresh(pair: Pair, now = Date.now()) {
    const t = this.ticks.get(pair);
    return (
      this.state === "Connected" &&
      !!t &&
      now - t.time < 15000 &&
      now - t.receivedAt < 15000 &&
      now - (this.hearts.get(pair) || 0) < 10000
    );
  }
  snapshot() {
    return {
      serverTime: Date.now(),
      generation: this.generation,
      metrics: this.metrics,
      assets: pairs.map((pair) => ({
        pair,
        tick: this.ticks.get(pair),
        status: this.fresh(pair)
          ? "Live"
          : this.state === "Connected"
            ? "Delayed"
            : this.state,
      })),
    };
  }
  notify() {
    for (const fn of this.listeners) fn();
  }
  ingest(raw: string, now = Date.now()) {
    this.metrics.received++;
    try {
      const m = JSON.parse(raw);
      if (!pairs.includes(m.product_id)) return false;
      const pair = m.product_id as Pair,
        time = Date.parse(m.time);
      if (!Number.isFinite(time) || time > now + 2000 || now - time > 15000)
        throw Error("Stale timestamp");
      if (m.type === "heartbeat") {
        this.hearts.set(pair, now);
        return true;
      }
      if (m.type !== "ticker") return false;
      const price = Number(m.price);
      if (typeof m.price !== "string" || !/^\d+(\.\d{1,8})?$/.test(m.price))
        throw Error("Price");
      priceUnits(price);
      if (
        !Number.isSafeInteger(m.sequence) ||
        !Number.isSafeInteger(m.trade_id)
      )
        throw Error("Ordering");
      const prev = this.ticks.get(pair);
      if (
        prev &&
        (m.sequence <= prev.sequence ||
          m.trade_id <= prev.tradeId ||
          time < prev.time)
      )
        throw Error("Duplicate or unordered");
      // Ticker sequences are sparse: only trade IDs, not sequence increments, indicate missing trades.
      if (prev && m.trade_id > prev.tradeId + 1) {
        this.metrics.gaps++;
        this.generation++;
      }
      // Preserve every accepted tick's extrema even when downstream snapshots coalesce.
      const bars: Record<number, LiveBar> = {};
      for (const interval of [60, 300]) {
        const key = `${pair}:${interval}`,
          bucket = Math.floor(time / 1000 / interval) * interval,
          previous = this.bars.get(key);
        const bar =
          previous?.time === bucket
            ? {
                ...previous,
                high: Math.max(previous.high, price),
                low: Math.min(previous.low, price),
                close: price,
              }
            : {
                time: bucket,
                open: price,
                high: price,
                low: price,
                close: price,
              };
        this.bars.set(key, bar);
        bars[interval] = bar;
      }
      this.ticks.set(pair, {
        pair,
        price,
        time,
        receivedAt: now,
        sequence: m.sequence,
        tradeId: m.trade_id,
        bars,
      });
      this.metrics.accepted++;
      return true;
    } catch {
      this.metrics.rejected++;
      return false;
    }
  }
  start() {
    if (!this.stopped) return;
    this.stopped = false;
    this.connect();
    this.monitor = setInterval(() => {
      if (
        this.state === "Connected" &&
        pairs.some(
          (p) => Date.now() - (this.hearts.get(p) || this.connectedAt) > 12000,
        )
      )
        this.socket?.close();
      this.notify();
    }, 1000);
    this.monitor.unref();
  }
  private connect() {
    if (this.stopped) return;
    this.state = this.attempt ? "Reconnecting" : "Connecting";
    this.notify();
    const ws = this.connectSocket();
    this.socket = ws;
    ws.onopen = () => {
      this.state = "Connected";
      this.connectedAt = Date.now();
      this.hearts.clear();
      this.generation++;
      ws.send(
        JSON.stringify({
          type: "subscribe",
          product_ids: pairs,
          channels: ["ticker", "heartbeat"],
        }),
      );
      this.notify();
    };
    ws.onmessage = (event) => {
      if (this.ingest(String(event.data))) {
        if (pairs.every((p) => this.fresh(p))) this.attempt = 0;
        this.notify();
      }
    };
    ws.onerror = () => ws.close();
    ws.onclose = () => {
      if (this.stopped) return;
      this.state = "Reconnecting";
      this.metrics.reconnects++;
      this.notify();
      this.timer = setTimeout(
        () => this.connect(),
        Math.min(30000, 500 * 2 ** Math.min(this.attempt++, 6)) *
          (0.75 + Math.random() * 0.5),
      );
      this.timer.unref();
    };
  }
  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    clearInterval(this.monitor);
    this.socket?.close();
    this.state = "Data unavailable";
    this.notify();
  }
}
export const livePrices = new LivePrices();
