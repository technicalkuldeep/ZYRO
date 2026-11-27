import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import {
  LiveCustodyAdapter,
  matchIntent,
} from "../apps/api/src/taz-markets/live/adapter.js";
import { ObservationRpc } from "../apps/api/src/taz-markets/live/rpc.js";

const configPath = process.env.ZYRO_TAZ_REGTEST_EVIDENCE_FILE;

it.skipIf(!configPath)(
  "finds a mined Regtest deposit through live RPC without a transaction hint",
  async () => {
    const config = JSON.parse(await readFile(configPath!, "utf8"));
    const zebra = new ObservationRpc(
      "zebra",
      config.zebra.endpoint,
      config.zebra.cookie,
    );
    const zallet = new ObservationRpc(
      "zallet",
      config.zallet.endpoint,
      config.zallet.cookie,
    );
    const adapter = new LiveCustodyAdapter(
      "regtest",
      config.intent.account,
      2,
      zebra,
      zallet,
    );
    const observation = await adapter.scan();
    const match = matchIntent(observation, config.intent);
    expect(match).toMatchObject({
      outputId: config.expected.id,
      qualification: "observation-only",
    });
    const note = observation.notes.find(
      (candidate) => candidate.id === match?.outputId,
    );
    expect(note).toMatchObject({
      ...config.expected,
      amount: 1_000_000,
      availability: "listed-unspent",
    });
    expect(note!.confirmations).toBeGreaterThanOrEqual(
      config.intent.confirmations,
    );
    expect(
      matchIntent(observation, { ...config.intent, amount: 999_999 }),
    ).toBeUndefined();
    console.log(
      JSON.stringify({
        outputId: note!.id,
        commitment: note!.commitment,
        block: note!.block,
        confirmations: note!.confirmations,
        evidenceDigest: match!.evidenceDigest,
      }),
    );
  },
  30_000,
);
