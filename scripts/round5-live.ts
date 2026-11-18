import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { Accounts } from "../apps/api/src/accounts.js";
import { CryptoMarkets } from "../apps/api/src/crypto-markets.js";
const name = "zyro_test_live5_" + randomUUID().slice(0, 8),
  accounts = new Accounts(process.env.MONGODB_URI, name);
mkdirSync("artifacts/round5", { recursive: true });
try {
  await accounts.init();
  let service = new CryptoMarkets(accounts);
  await service.init();
  const user = (
    await accounts.login({
      sub: "live-scheduled-check",
      email: "live-qa@example.invalid",
      emailVerified: true,
      name: "Live Source QA",
    })
  ).user;
  const start = Math.ceil((Date.now() + 45000) / 60000) * 60;
  const market = await service.publish("BTC-USD", start);
  const prediction = await service.enter(user._id, market._id, {
    side: "YES",
    stake: 10,
    operation: randomUUID(),
    specHash: market.specHash,
  });
  if ((await accounts.accounts().findOne({ _id: user._id }))?.available !== 90)
    throw new Error("Committed balance mismatch");
  console.log(
    JSON.stringify({
      phase: "PENDING",
      marketId: market._id,
      threshold: market.spec.threshold,
      observationUTC: new Date(market.spec.observationTime).toISOString(),
      specHash: market.specHash,
      initial: 100,
      available: 90,
      committed: 10,
    }),
  );
  // Recreate the service and connection: no frontend timer or in-memory job carries settlement.
  await accounts.client.close();
  const restored = new Accounts(process.env.MONGODB_URI, name);
  await restored.init();
  service = new CryptoMarkets(restored);
  await service.init();
  try {
    while (Date.now() < market.spec.observationTime + 11000)
      await new Promise((r) =>
        setTimeout(
          r,
          Math.min(10000, market.spec.observationTime + 11000 - Date.now()),
        ),
      );
    for (let attempt = 0; attempt < 4; attempt++) {
      await service.tick();
      const final = await service.markets().findOne({ _id: market._id });
      if (final?.status === "RESOLVED") break;
      await new Promise((r) => setTimeout(r, 20000));
    }
    const final = await service.markets().findOne({ _id: market._id }),
      round = await restored.rounds().findOne({ _id: prediction.id }),
      balance = await restored.accounts().findOne({ _id: user._id });
    if (
      final?.status !== "RESOLVED" ||
      !final.evidence ||
      round?.status !== "RESOLVED"
    )
      throw new Error(
        "Live completed candle not verified; market remains pending",
      );
    await Promise.all([
      service.process(market._id),
      service.process(market._id),
    ]);
    const entries = await restored
      .ledger()
      .countDocuments({ operation: `settle:${prediction.id}` });
    if (entries !== 1) throw new Error("Duplicate settlement");
    const receipt = {
      verifiedAt: new Date().toISOString(),
      isolatedDatabase: true,
      market: final,
      prediction: {
        side: round.side,
        stake: round.stake,
        payout: round.payout,
        result: round.result,
      },
      balance,
      settlementEntries: entries,
      restartedConnection: true,
    };
    writeFileSync(
      "artifacts/round5/live-resolution.json",
      JSON.stringify(receipt, null, 2),
    );
    console.log(
      JSON.stringify({
        phase: "VERIFIED",
        marketId: final._id,
        close: final.evidence.candle.close,
        outcome: final.outcome,
        returned: round.payout,
        available: balance?.available,
        settlementEntries: entries,
        receipt: "artifacts/round5/live-resolution.json",
      }),
    );
  } finally {
    if (
      restored.db.databaseName === name &&
      name.startsWith("zyro_test_live5_")
    )
      await restored.db.dropDatabase();
    await restored.client.close();
  }
} finally {
  await accounts.client.close();
}
