import { Router, type Request } from "express";
import { rateLimit } from "express-rate-limit";
import type { TazStore } from "./store.js";
import {
  NETWORK,
  type Market,
  type Obligation,
  type Position,
} from "./model.js";

function marketStatus({ _id, rules, rulesHash, status, outcome }: Market) {
  return { id: _id, rules, rulesHash, status, outcome, simulated: true };
}

function positionStatus(row: Position) {
  return {
    id: row._id,
    marketId: row.marketId,
    side: row.side,
    status: row.status,
    stake: row.stake,
  };
}

function paymentStatus(row: Obligation) {
  return {
    id: row._id,
    marketId: row.marketId,
    kind: row.kind,
    amount: row.amount,
    status: row.status,
    simulated: true,
    confirmation: row.confirmation,
  };
}

// Mount at /api/taz only inside an explicitly provisioned internal fixture host.
export function tazReadRouter(
  store: TazStore,
  account: (req: Request) => Promise<string | undefined>,
) {
  const router = Router();
  router.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    if (
      process.env.ZYRO_TAZ_FIXTURES !== "1" ||
      process.env.NODE_ENV === "production" ||
      (process.env.ZCASH_NETWORK ?? NETWORK) !== NETWORK
    ) {
      res.status(404).json({ error: "Unavailable" });
      return;
    }
    next();
  });
  router.use(
    rateLimit({
      windowMs: 60_000,
      limit: 60,
      standardHeaders: "draft-8",
      legacyHeaders: false,
    }),
  );
  router.use(async (req, res, next) => {
    const owner = await account(req);
    if (!owner) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    res.locals.tazOwner = owner;
    next();
  });
  router.get("/markets", async (_req, res) => {
    const markets = await store.markets
      .find({})
      .sort({ "rules.candleStart": -1 })
      .limit(50)
      .toArray();
    res.json(markets.map(marketStatus));
  });
  router.get("/markets/:id", async (req, res) => {
    const market = await store.markets.findOne({ _id: req.params.id });
    if (!market) {
      res.status(404).json({ error: "Market unavailable" });
      return;
    }
    res.json(marketStatus(market));
  });
  router.get("/positions/:id", async (req, res) => {
    const owner: string = res.locals.tazOwner;
    const position = await store.positions.findOne({
      _id: req.params.id,
      owner,
    });
    if (!position) {
      res.status(404).json({ error: "Position unavailable" });
      return;
    }
    res.json(positionStatus(position));
  });
  router.get("/activity", async (_req, res) => {
    const owner: string = res.locals.tazOwner;
    const [positions, obligations] = await Promise.all([
      store.positions
        .find({ owner })
        .sort({ createdAt: -1 })
        .limit(50)
        .toArray(),
      store.obligations.find({ owner }).sort({ _id: 1 }).limit(50).toArray(),
    ]);
    res.json({
      positions: positions.map(positionStatus),
      obligations: obligations.map(paymentStatus),
    });
  });
  return router;
}
