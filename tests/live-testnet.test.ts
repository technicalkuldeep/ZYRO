import { it, expect } from "vitest";
import {
  lightwalletStatus,
  observeLightwalletTransaction,
} from "../apps/api/src/lightwallet";
const live = process.env.LIVE_ZCASH_INTEGRATION === "1";
it.skipIf(!live)(
  "live public testnet reports its chain and current height",
  async () => {
    const status = await lightwalletStatus();
    expect(status.network).toBe("testnet");
    expect(status.height).toBeGreaterThan(4633000);
  },
  45000,
);
it.skipIf(!live)(
  "live signed ZYRO transfer decodes to the actual txid and appears in its mined compact block",
  async () => {
    const txid =
      "0ce5d017e8a3c72751913348b1c5a9e2bf1ff742386776fa800903046b4a4a0c";
    const observed = await observeLightwalletTransaction(txid);
    expect(observed.state).toBe("CONFIRMED");
    expect(observed.confirmations).toBeGreaterThanOrEqual(3);
    expect(observed.minedHeight).toBe(4633072);
    expect(observed.decoded.txid).toBe(txid);
    expect(observed.decoded.transparentInputs).toBe(0);
    expect(observed.decoded.transparentOutputs).toBe(0);
    expect(observed.decoded.ironwoodActions).toBe(2);
    expect(observed.fundingVerified).toBe(false);
  },
  60000,
);
it.skipIf(!live)(
  "live unknown transaction fails without creating confirmation evidence",
  async () => {
    await expect(
      observeLightwalletTransaction("f".repeat(64)),
    ).rejects.toMatchObject({ status: 404 });
  },
  45000,
);
