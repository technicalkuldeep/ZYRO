import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LivePrices } from "../apps/api/src/live-prices.js";
import request from "supertest";
import { createApp } from "../apps/api/src/app.js";
import { Store } from "../apps/api/src/store.js";
import type { Accounts } from "../apps/api/src/accounts.js";

class Socket {
  terminate?: () => void;
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  send = vi.fn();
  close = vi.fn(() => {
    // Reproduces the synchronous error that used to recurse through close().
    this.onerror?.();
    this.readyState = 2;
  });
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  closed() {
    this.readyState = 3;
    this.onclose?.();
  }
}
let feed: LivePrices;
let sockets: Socket[];
beforeEach(() => {
  vi.useFakeTimers();
  sockets = [];
  feed = new LivePrices(() => {
    const ws = new Socket();
    sockets.push(ws);
    return ws as unknown as WebSocket;
  });
});
afterEach(() => {
  feed.stop();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it("never closes recursively on repeated errors or overlaps a failing connection", () => {
  feed.start();
  feed.start();
  const ws = sockets[0],
    error = ws.onerror!;
  for (let i = 0; i < 1000; i++) error();
  expect(ws.close).not.toHaveBeenCalled();
  expect(feed.snapshot().assets.every((a) => a.status !== "Live")).toBe(true);
  vi.advanceTimersByTime(1000);
  expect(sockets).toHaveLength(1);
  const closed = ws.onclose!;
  ws.closed();
  closed();
  closed();
  expect(feed.metrics.reconnects).toBe(1);
  vi.advanceTimersByTime(500);
  expect(sockets).toHaveLength(2);
  error();
  closed();
  expect(feed.metrics.reconnects).toBe(1);
  expect(ws.onmessage).toBeNull();
});

it("retries constructor failures with bounded exponential backoff and jitter", () => {
  vi.spyOn(Math, "random").mockReturnValue(0.999);
  const factory = vi.fn((): WebSocket => {
    throw Error("offline");
  });
  feed = new LivePrices(factory);
  feed.start();
  for (const ceiling of [500, 1000, 2000, 4000, 8000, 16000, 30000, 30000]) {
    const before = factory.mock.calls.length;
    vi.advanceTimersByTime(ceiling);
    expect(factory.mock.calls.length).toBe(before + 1);
  }
  feed.stop();
  const before = factory.mock.calls.length;
  vi.advanceTimersByTime(120000);
  expect(factory).toHaveBeenCalledTimes(before);
  expect(vi.getTimerCount()).toBe(0);
});

it.each([0, 1, 2, 3])("shuts down safely in readyState %s", (state) => {
  feed.start();
  const ws = sockets[0],
    opened = ws.onopen!,
    error = ws.onerror!;
  ws.readyState = state;
  feed.stop();
  feed.stop();
  opened();
  error();
  expect(ws.close).toHaveBeenCalledTimes(state < 2 ? 1 : 0);
  ws.closed();
  vi.advanceTimersByTime(120000);
  expect(sockets).toHaveLength(1);
  expect(feed.state).toBe("Data unavailable");
  expect(vi.getTimerCount()).toBe(0);
  expect(ws.onclose).toBeNull();
});

it("times out CONNECTING safely and waits for closure before retry", () => {
  feed.start();
  vi.advanceTimersByTime(16000);
  expect(sockets[0].close).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(60000);
  expect(sockets).toHaveLength(1);
  sockets[0].closed();
  vi.advanceTimersByTime(500);
  expect(sockets).toHaveLength(2);
});

it.each([0, 1, 2])(
  "terminates the ws transport once during shutdown in state %s",
  (state) => {
    feed.start();
    const ws = sockets[0];
    ws.readyState = state;
    ws.terminate = vi.fn(() => {
      ws.onerror?.();
      ws.closed();
    });
    feed.stop();
    feed.stop();
    expect(ws.terminate).toHaveBeenCalledTimes(1);
    expect(ws.close).not.toHaveBeenCalled();
    expect(ws.onclose).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  },
);

it("recovers from subscription failure and heartbeat loss without duplicate closes", () => {
  feed.start();
  sockets[0].send.mockImplementation(() => {
    throw Error("send failed");
  });
  sockets[0].open();
  expect(feed.state).toBe("Reconnecting");
  expect(sockets[0].close).toHaveBeenCalledTimes(1);
  sockets[0].closed();
  vi.advanceTimersByTime(500);
  sockets[1].open();
  expect(feed.state).toBe("Connected");
  vi.advanceTimersByTime(14000);
  expect(sockets[1].close).toHaveBeenCalledTimes(1);
  expect(feed.fresh("BTC-USD")).toBe(false);
});

it("cancels queued reconnect on shutdown and permits restart after closure", () => {
  feed.start();
  sockets[0].closed();
  feed.stop();
  vi.advanceTimersByTime(60000);
  expect(sockets).toHaveLength(1);
  feed.start();
  expect(sockets).toHaveLength(2);
  feed.stop();
  feed.start();
  expect(sockets).toHaveLength(2);
  sockets[1].closed();
  vi.advanceTimersByTime(1000);
  expect(sockets).toHaveLength(3);
});

it("keeps Express health and authentication available during repeated upstream failures", async () => {
  vi.useRealTimers();
  const store = new Store(":memory:", "");
  await store.init();
  const accounts = {
    current: async () => null,
    sessions: () => ({ insertOne: async () => ({ acknowledged: true }) }),
  } as unknown as Accounts;
  vi.stubEnv("GOOGLE_CLIENT_ID", "regression-client");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "regression-secret");
  vi.stubEnv(
    "GOOGLE_REDIRECT_URI",
    "http://127.0.0.1:3000/api/auth/google/callback",
  );
  const { app } = createApp(store, async () => accounts);
  try {
    feed.start();
    for (let cycle = 0; cycle < 3; cycle++) {
      const ws = sockets.at(-1)!;
      for (let i = 0; i < 100; i++) ws.onerror?.();
      await request(app).get("/api/health").expect(200);
      expect(
        (await request(app).get("/api/auth/me").expect(200)).body.user,
      ).toBeNull();
      const oauth = await request(app).get("/api/auth/google").expect(302);
      expect(oauth.headers.location).toContain("https://accounts.google.com/");
      ws.closed();
      await new Promise((resolve) => setTimeout(resolve, 2100));
    }
    expect(sockets).toHaveLength(4);
  } finally {
    feed.stop();
    await store.close();
    vi.unstubAllEnvs();
  }
}, 15000);
