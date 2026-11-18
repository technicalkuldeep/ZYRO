import { Store } from "./store.js";
import { createApp } from "./app.js";
import pino from "pino";
import { z } from "zod";
import { Accounts } from "./accounts.js";
import { Fault } from "./engine.js";
const network = z
  .enum(["testnet", "regtest"])
  .parse(process.env.ZCASH_NETWORK || "testnet");
const logger = pino();
const store = new Store();
await store.init();
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
const { app, engine } = createApp(store, accounts);
await engine.seed();
const server = app.listen(Number(process.env.PORT || 4000), "127.0.0.1", () =>
  logger.info({ port: process.env.PORT || 4000, network }, "ZYRO API ready"),
);
process.on("SIGINT", () =>
  server.close(() => {
    void store.close();
  }),
);
