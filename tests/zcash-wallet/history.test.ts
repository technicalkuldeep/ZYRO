import { expect, it } from "vitest";
import { normalizeHistory } from "../../apps/web/public/zcash-wallet/history.mjs";
it("renders actual little-endian txids and wallet amounts without public-explorer guesses", () => {
  const txid =
    "9edc565516b23c73eb2b3df7cb52355383bdae57944f187c420a2be460e581be";
  const bytes = Array.from(Buffer.from(txid, "hex")).reverse();
  const [row] = normalizeHistory(
    [
      {
        txid: bytes,
        kind: "received",
        amount_zatoshis: 100000000,
        fee_zatoshis: null,
        status: "mined",
        mined_height: 100,
      },
    ],
    102,
  );
  expect(row.txid).toBe(txid);
  expect(row.amount).toBe("100000000");
  expect(row.fee).toBeUndefined();
  expect(row.status).toBe("Confirmed");
});
it("downgrades confirmation state after a reorganization and preserves unknown data", () => {
  const raw = {
    txid: new Uint8Array(32),
    kind: "sent",
    amount_zatoshis: 1000000n,
    fee_zatoshis: 10000n,
    status: "mined",
    mined_height: 100,
  };
  expect(normalizeHistory([raw], 101)[0].status).toBe("Confirming");
  expect(
    normalizeHistory(
      [{ ...raw, status: "pending", mined_height: null }],
      102,
    )[0].status,
  ).toBe("Pending");
  expect(normalizeHistory([{}], 102)[0].amount).toBeUndefined();
});
