import { Store } from "./store.js";
import { createApp } from "./app.js";
import pino from "pino";
import { z } from "zod";
const network = z
  .enum(["testnet", "regtest"])
  .parse(process.env.ZCASH_NETWORK || "testnet");
const logger = pino();
const store = new Store();
await store.init();
const { app, engine } = createApp(store);
await engine.seed();
const server = app.listen(Number(process.env.PORT || 4000), "127.0.0.1", () =>
  logger.info({ port: process.env.PORT || 4000, network }, "ZYRO API ready"),
);
process.on("SIGINT", () =>
  server.close(() => {
    void store.close();
  }),
);
