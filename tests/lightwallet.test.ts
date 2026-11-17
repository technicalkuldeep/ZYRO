import { afterEach, it, expect } from "vitest";
import * as grpc from "@grpc/grpc-js";
import {
  LightwalletService,
  lightwalletStatus,
} from "../apps/api/src/lightwallet";
let server: grpc.Server | undefined;
afterEach(() => {
  server?.forceShutdown();
});
async function fixture(chain = "regtest") {
  server = new grpc.Server();
  let latestCalls = 0;
  server.addService(LightwalletService.service, {
    getLightdInfo: (_call: unknown, callback: any) =>
      callback(null, {
        chainName: chain,
        version: "test-fixture",
        vendor: "fixture",
        blockHeight: "123",
      }),
    getLatestBlock: (_call: unknown, callback: any) => {
      latestCalls++;
      callback(null, { height: "123", hash: Buffer.alloc(32, 1) });
    },
  });
  const port = await new Promise<number>((resolve, reject) =>
    server!.bindAsync(
      "127.0.0.1:0",
      grpc.ServerCredentials.createInsecure(),
      (e, p) => (e ? reject(e) : resolve(p)),
    ),
  );
  return { url: "http://127.0.0.1:" + port, latestCalls: () => latestCalls };
}
it("reads chain identity and height through real gRPC transport against a clearly labeled fixture server", async () => {
  const f = await fixture();
  expect(await lightwalletStatus(f.url, "regtest")).toMatchObject({
    connected: true,
    network: "regtest",
    height: 123,
    provider: "lightwalletd",
  });
  expect(f.latestCalls()).toBe(1);
});
it("refuses mainnet before reading the latest block", async () => {
  const f = await fixture("main");
  await expect(lightwalletStatus(f.url, "regtest")).rejects.toThrow("Mainnet");
  expect(f.latestCalls()).toBe(0);
});
it("rejects insecure public endpoints and configured mainnet", async () => {
  await expect(
    lightwalletStatus("http://testnet.zec.rocks", "testnet"),
  ).rejects.toThrow("Plaintext");
  await expect(
    lightwalletStatus("https://example.org", "mainnet" as any),
  ).rejects.toThrow("Only testnet");
});
