import { Router, type Request, type Response } from "express";
import { rateLimit } from "express-rate-limit";
import type { Market, Obligation, Position } from "./model.js";
import { requireThat } from "./model.js";
import type { TazStore } from "./store.js";

const neverReady = {
  network: "testnet",
  fundingEnabled: false,
  payoutEnabled: false,
  reason: "Live deposit qualification and independently verified Testnet signing are not enabled",
};

function publicMarket(market: Market | null) {
  if (!market) return null;
  return {
    id: market._id,
    network: "testnet",
    rules: market.rules,
    rulesHash: market.rulesHash,
    status: market.status,
    outcome: market.outcome,
    close: market.close,
    reason: market.reason,
    simulated: false,
  };
}

function publicPosition(position: Position) {
  return {
    id: position._id,
    marketId: position.marketId,
    side: position.side,
    stake: position.stake,
    status: position.status,
    createdAt: position.createdAt,
  };
}

function publicObligation(obligation: Obligation) {
  return {
    id: obligation._id,
    marketId: obligation.marketId,
    kind: obligation.kind,
    amount: obligation.amount,
    status: obligation.status,
    txid: obligation.signed?.txid,
    confirmation: obligation.confirmation,
  };
}

/** Read-only API over the isolated, real Testnet ledger. No fixture fallback. */
export function testnetTazReadRouter(
  store: TazStore,
  account: (req: Request, res: Response) => Promise<string | undefined>,
) {
  requireThat(store.scope === "testnet", "Testnet API requires the isolated Testnet ledger scope");
  const router = Router();
  router.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  router.use(rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: "draft-8", legacyHeaders: false }));
  router.use(async (req, res, next) => {
    try {
      const owner = await account(req, res);
      if (!owner) {
        res.status(401).json({ error: "Participant session required" });
        return;
      }
      res.locals.tazTestnetOwner = owner;
      next();
    } catch (error) {
      next(error);
    }
  });

  router.get("/readiness", async (_req, res) => {
    const control = await store.controls.findOne({ _id: "testnet" });
    res.json({
      ...neverReady,
      ledger: "connected",
      paused: control?.paused ?? true,
      incident: control?.incident ?? null,
      chainTip: control?.chain?.tip ?? null,
    });
  });
  router.get("/markets", async (_req, res) => {
    const rows = await store.markets.find({}).sort({ "rules.candleStart": -1 }).limit(50).toArray();
    const result = await Promise.all(rows.map(async (market) => {
      const positions = await store.positions.find({ marketId: market._id }).toArray();
      const confirmed = positions.filter((p) => p.status === "qualified");
      return {
        ...publicMarket(market),
        participants: positions.length,
        confirmedPositions: confirmed.length,
        prizePoolZatoshis: confirmed.reduce((total, p) => total + BigInt(p.stake), 0n).toString(),
        sides: positions.map((p) => ({ side: p.side, status: p.status, stake: p.stake })),
      };
    }));
    res.json({ network: "testnet", readiness: neverReady, markets: result });
  });
  router.get("/markets/:id", async (req, res) => {
    const market = await store.markets.findOne({ _id: req.params.id });
    if (!market) {
      res.status(404).json({ error: "Testnet market not found" });
      return;
    }
    const positions = await store.positions.find({ marketId: market._id }).toArray();
    const confirmed = positions.filter((p) => p.status === "qualified");
    res.json({
      ...publicMarket(market),
      sides: positions.map((p) => ({ side: p.side, status: p.status, stake: p.stake })),
      confirmedPositions: confirmed.length,
      prizePoolZatoshis: confirmed.reduce((total, p) => total + BigInt(p.stake), 0n).toString(),
      readiness: neverReady,
    });
  });
  router.get("/history", async (_req, res) => {
    const owner: string = res.locals.tazTestnetOwner;
    const [positions, obligations] = await Promise.all([
      store.positions.find({ owner }).sort({ createdAt: -1 }).limit(100).toArray(),
      store.obligations.find({ owner }).sort({ _id: -1 }).limit(100).toArray(),
    ]);
    res.json({
      network: "testnet",
      positions: positions.map(publicPosition),
      settlements: obligations.map(publicObligation),
    });
  });
  router.all("*path", (_req, res) => {
    res.status(503).json({ error: "Testnet funding and settlement are fail-closed", readiness: neverReady });
  });
  return router;
}
