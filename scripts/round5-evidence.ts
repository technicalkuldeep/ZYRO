import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { Accounts } from "../apps/api/src/accounts.js";
import { CryptoMarkets } from "../apps/api/src/crypto-markets.js";
const a = new Accounts();
try {
  await a.init();
  const markets = await new CryptoMarkets(a).list();
  const upcoming = markets
    .filter(
      (m) => m.status === "OPEN" && !m.disabled && m.spec.cutoff > Date.now(),
    )
    .map((m) => ({
      id: m._id,
      pair: m.spec.pair,
      threshold: m.spec.threshold,
      cutoff: new Date(m.spec.cutoff).toISOString(),
      observation: new Date(m.spec.observationTime).toISOString(),
      specHash: m.specHash,
      reference: m.spec.reference,
    }));
  const resolved = markets
    .filter((m) => m.status === "RESOLVED")
    .slice(0, 6)
    .map((m) => ({
      id: m._id,
      spec: m.spec,
      specHash: m.specHash,
      outcome: m.outcome,
      evidence: m.evidence,
    }));
  const live = JSON.parse(
    readFileSync("artifacts/round5/live-resolution.json", "utf8"),
  );
  const verification = {
    verifiedAt: live.verifiedAt,
    market: live.market,
    prediction: live.prediction,
    available: live.balance.available,
    committed: live.balance.committed,
    settlementEntries: live.settlementEntries,
    restartedConnection: live.restartedConnection,
    isolatedDatabase: true,
  };
  const receipt = {
    recordedAt: new Date().toISOString(),
    database: a.db.databaseName,
    provider: "Coinbase Exchange",
    upcoming,
    resolved,
    verification,
  };
  mkdirSync("docs/evidence", { recursive: true });
  writeFileSync(
    "docs/evidence/round5-arena.json",
    JSON.stringify(receipt, null, 2),
  );
  console.log(
    JSON.stringify({
      recordedAt: receipt.recordedAt,
      upcoming: upcoming.map(
        ({ id, pair, threshold, cutoff, observation }) => ({
          id,
          pair,
          threshold,
          cutoff,
          observation,
        }),
      ),
      resolved: resolved.map((m) => ({
        id: m.id,
        outcome: m.outcome,
        close: m.evidence?.candle.close,
      })),
      evidence: "docs/evidence/round5-arena.json",
    }),
  );
} finally {
  await a.client.close();
}
