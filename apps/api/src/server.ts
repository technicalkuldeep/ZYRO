import { Store } from "./store.js";
import { createApp } from "./app.js";
import pino from "pino";
import { z } from "zod";
import { Accounts } from "./accounts.js";
import { Fault } from "./engine.js";
import { arenaServices } from "./arena-services.js";
import { livePrices } from "./live-prices.js";
import { MongoClient } from "mongodb";
import { TazStore } from "./taz-markets/store.js";
livePrices.start();
const network = z
  .enum(["testnet", "regtest"])
  .parse(process.env.ZCASH_NETWORK || "testnet");
const logger = pino();
const store = new Store();
await store.init();
let testnetTazClient: MongoClient | undefined;
let testnetTazStore: TazStore | undefined;
if (process.env.ZYRO_TAZ_TESTNET_MONGO_URI && network === "testnet") {
  testnetTazClient = new MongoClient(process.env.ZYRO_TAZ_TESTNET_MONGO_URI, {
    serverSelectionTimeoutMS: 5000,
    appName: "zyro-testnet-taz-readonly-api",
  });
  await testnetTazClient.connect();
  testnetTazStore = new TazStore(
    testnetTazClient,
    testnetTazClient.db("zyro_taz_testnet"),
    "testnet",
  );
  await testnetTazStore.init();
}
let accountStore: Accounts | undefined;
let connecting: Promise<Accounts> | undefined;
async function accounts() {
  if (accountStore) return accountStore;
  if (!connecting)
    connecting = (async () => {
      const candidate = new Accounts();
      try {
        await candidate.init();
        accountStore = candidate;
        return candidate;
      } catch {
        await candidate.client.close();
        throw new Fault(
          "Arena database unavailable. Check Atlas connectivity and configuration, then retry.",
          503,
        );
      } finally {
        connecting = undefined;
      }
    })();
  return connecting;
}
const { app, engine } = createApp(store, accounts, testnetTazStore);
await engine.seed();
const server = app.listen(Number(process.env.PORT || 4000), "127.0.0.1", () =>
  logger.info({ port: process.env.PORT || 4000, network }, "ZYRO API ready"),
);
let working = false,
  lastSeed = 0;
async function work() {
  if (working) return;
  working = true;
  try {
    const service = await arenaServices(await accounts());
    await service.fast.tick();
    if (Date.now() - lastSeed > 300000) {
      await service.crypto.seed();
      lastSeed = Date.now();
    }
    await service.crypto.tick();
  } catch (e) {
    logger.warn(
      { type: e instanceof Error ? e.name : "unknown" },
      "Arena worker delayed; durable jobs retained",
    );
  } finally {
    working = false;
  }
}
const worker = setInterval(() => void work(), 5000);
void work();
const shutdown = () => {
  livePrices.stop();
  clearInterval(worker);
  server.close(() => {
    clearInterval(worker);
    void accountStore?.client.close();
    void testnetTazClient?.close();
    void store.close();
  });
  // Long-lived SSE responses otherwise keep server.close waiting indefinitely.
  server.closeAllConnections();
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
