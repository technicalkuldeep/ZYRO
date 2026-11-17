import express from "express";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { agreement, sideSchema, type Market } from "@zyro/shared";
import { Engine, Fault } from "./engine.js";
import { Store } from "./store.js";
import { randomBytes } from "node:crypto";
import { hash } from "./policy.js";
import { chainStatus } from "./zcash.js";
import { TransactionMonitor } from "./transaction-monitor.js";
import { lightwalletStatus } from "./lightwallet.js";
import { recordOutcome } from "./resolution.js";
import { FundingService } from "./funding.js";
import { demoWalletConfig } from "./demo-wallet.js";
export function createApp(store: Store) {
  const app = express();
  const engine = new Engine(store);
  const monitor = new TransactionMonitor(store);
  const demoWallet = demoWalletConfig();
  const funding = new FundingService(
    store,
    undefined,
    demoWallet?.source,
    undefined,
    demoWallet?.recipient,
  );
  app.disable("x-powered-by");
  app.use(helmet());
  app.use(express.json({ limit: "32kb" }));
  app.use(
    "/api",
    rateLimit({
      windowMs: 60000,
      limit: 180,
      standardHeaders: "draft-8",
      legacyHeaders: false,
    }),
  );
  app.use("/api", async (req, res, next) => {
    const origin = req.get("origin");
    const allowed = process.env.WEB_ORIGIN || "http://127.0.0.1:3000";
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      (origin !== allowed || req.get("x-zyro-client") !== "web")
    )
      return res
        .status(403)
        .json({ error: "Origin or client header rejected" });
    next();
  });
  app.get("/api/health", (_req, res) =>
    res.json({
      ok: true,
      configuredNetwork: process.env.ZCASH_NETWORK || "testnet",
      storage: process.env.DATABASE_URL ? "postgresql" : "sqlite-local",
      escrow: "not-integrated",
    }),
  );
  app.use("/api", async (req, res, next) => {
    try {
      const supplied = req.headers.cookie
        ?.split(";")
        .map((s) => s.trim())
        .find((s) => s.startsWith("zyro_session="))
        ?.slice(13);
      const token =
        supplied && /^[a-f0-9]{64}$/.test(supplied)
          ? supplied
          : randomBytes(32).toString("hex");
      const session = await store.atomic((tx) =>
        new Engine(tx).session(hash(token)),
      );
      res.locals.session = session;
      res.setHeader("Cache-Control", "no-store");
      res.cookie("zyro_session", token, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        maxAge: 30 * 86400000,
        path: "/",
      });
      next();
    } catch (e) {
      next(e);
    }
  });
  app.get("/api/session", (_req, res) => res.json(res.locals.session));
  app.get("/api/markets", async (_req, res) =>
    res.json(await engine.markets()),
  );
  app.post("/api/markets", async (req, res) =>
    res.status(201).json(await engine.create(res.locals.session.id, req.body)),
  );
  app.get("/api/markets/:id", async (req, res) => {
    const m = (await engine.markets()).find((m) => m.id === req.params.id);
    if (!m) throw new Fault("Challenge not found", 404);
    res.json({ ...m, agreement: agreement(m) });
  });
  app.post("/api/markets/:id/join", async (req, res) => {
    const b = z
      .object({
        side: sideSchema,
        publicKey: z.string().max(256),
        signature: z.string().max(256),
      })
      .strict()
      .parse(req.body);
    res.json(
      await engine.join(
        res.locals.session.id,
        req.params.id,
        b.side,
        b.publicKey,
        b.signature,
      ),
    );
  });
  app.get("/api/dashboard", async (_req, res) => {
    const id = res.locals.session.id;
    res.json({
      markets: (await engine.markets()).filter(
        (m: Market) =>
          m.creator === id || m.participants.some((p) => p.userId === id),
      ),
      arena: await engine.arena(id),
    });
  });
  app.get("/api/markets/:id/funding", async (req, res) =>
    res.json(await funding.summary(res.locals.session.id, req.params.id)),
  );
  app.post("/api/markets/:id/funding-intent", async (req, res) => {
    z.object({}).strict().parse(req.body);
    res.json(await funding.intent(res.locals.session.id, req.params.id));
  });
  app.post("/api/markets/:id/funding-claim", async (req, res) => {
    const b = z
      .object({ txid: z.string().regex(/^[a-f0-9]{64}$/) })
      .strict()
      .parse(req.body);
    res.json(await funding.claim(res.locals.session.id, req.params.id, b.txid));
  });
  app.post("/api/markets/:id/funding-recheck", async (req, res) => {
    z.object({}).strict().parse(req.body);
    res.json(await funding.verify(res.locals.session.id, req.params.id));
  });
  app.get("/api/arena", async (_req, res) =>
    res.json(await engine.arena(res.locals.session.id)),
  );
  app.post("/api/arena/predict", async (req, res) => {
    const b = z
      .object({ side: sideSchema, stake: z.number().int().min(10).max(100) })
      .strict()
      .parse(req.body);
    res
      .status(201)
      .json(await engine.predict(res.locals.session.id, b.side, b.stake));
  });
  app.post("/api/arena/:id/resolve", async (req, res) =>
    res.json(await engine.resolve(res.locals.session.id, req.params.id)),
  );
  app.get("/api/leaderboard", async (_req, res) => {
    const rounds = await store.list<import("@zyro/shared").Round>("round");
    const users = new Map<
      string,
      { name: string; wins: number; played: number; net: number }
    >();
    for (const r of rounds.filter((r) => r.status === "RESOLVED")) {
      const u = users.get(r.userId) || {
        name: "Forecaster " + r.userId.slice(0, 6),
        wins: 0,
        played: 0,
        net: 0,
      };
      u.played++;
      u.wins += r.side === r.outcome ? 1 : 0;
      u.net += (r.payout || 0) - r.stake;
      users.set(r.userId, u);
    }
    res.json([...users.values()].sort((a, b) => b.net - a.net).slice(0, 20));
  });
  app.get("/api/zcash/status", async (_req, res) => {
    let chain: unknown = null;
    let connectionError: string | null = null;
    if (process.env.ZCASH_RPC_URL || process.env.LIGHTWALLETD_URL) {
      try {
        chain = process.env.ZCASH_RPC_URL
          ? await chainStatus()
          : await lightwalletStatus();
      } catch (e) {
        connectionError =
          e instanceof Fault
            ? e.message
            : "Node response could not be verified";
      }
    }
    res.json({
      configuredNetwork: process.env.ZCASH_NETWORK || "testnet",
      wallet: demoWallet ? "developer-custodial-demo" : "not-configured",
      depositRecognitionConfigured: !!demoWallet,
      rpcConfigured: !!process.env.ZCASH_RPC_URL,
      lightwalletConfigured: !!process.env.LIGHTWALLETD_URL,
      chain,
      connectionError,
      shieldedPayments:
        "External wallet operations only; app transaction observation and optional demo recognition are read-only",
      frost: "not integrated",
      pczt: "research only",
    });
  });
  app.post("/api/markets/:id/resolve", async (req, res) => {
    const b = z
      .object({
        attestation: z.unknown(),
        signature: z.string().min(1).max(256),
      })
      .strict()
      .parse(req.body);
    if (
      !b.attestation ||
      typeof b.attestation !== "object" ||
      !("marketId" in b.attestation) ||
      b.attestation.marketId !== req.params.id
    )
      throw new Fault("Market ID mismatch");
    res.json(await recordOutcome(store, b.attestation, b.signature));
  });
  app.get("/api/markets/:id/resolution", async (req, res) => {
    const receipt = await store.get(req.params.id + ":resolution");
    if (!receipt) throw new Fault("No outcome attestation recorded", 404);
    res.json(receipt);
  });
  app.post("/api/zcash/observe", async (req, res) => {
    const { txid } = z
      .object({ txid: z.string().regex(/^[a-f0-9]{64}$/) })
      .strict()
      .parse(req.body);
    const observation = await monitor.refresh(res.locals.session.id, txid);
    res.json(observation);
  });
  app.get("/api/zcash/observations", async (_req, res) =>
    res.json(await monitor.list(res.locals.session.id)),
  );
  app.use(
    (
      error: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      if (error instanceof z.ZodError)
        return res
          .status(400)
          .json({ error: "Validation failed", issues: error.issues });
      if (error instanceof Fault)
        return res.status(error.status).json({ error: error.message });
      if (error instanceof SyntaxError)
        return res.status(400).json({ error: "Invalid JSON" });
      console.error(
        "Request failed",
        error instanceof Error ? error.name : "unknown",
      );
      res.status(500).json({ error: "Request could not be completed" });
    },
  );
  return { app, engine };
}
