import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  LiveCustodyAdapter,
  matchIntent,
  NU7,
  ZALLET_VERSION,
  ZEBRA_VERSION,
} from "../apps/api/src/taz-markets/live/adapter.js";
import { ObservationRpc } from "../apps/api/src/taz-markets/live/rpc.js";

const account = "9daccf2d-4fac-496f-9dfb-efe05e5cd33c";
const another = "7daccf2d-4fac-496f-9dfb-efe05e5cd33c";
const hash = (digit: string) => digit.repeat(64);
const txid = hash("f");
const memo = "zyro-taz-v1:" + hash("e");
const receiver = "fixture-receiver";
const block = { height: 2, hash: hash("b"), tx: [txid], time: 200 };
const tip = { height: 3, hash: hash("c"), tx: [], time: 201 };
const genesis =
  "029f11d80ef9765602235e1bc9727e3eb6ba20839319f761fee920d63401e327";
const intent = {
  network: "regtest" as const,
  account,
  receiver,
  memo,
  amount: 1_000_000,
  confirmations: 2,
};

function setup() {
  const responses = {
    chain: {
      chain: "regtest",
      blocks: tip.height,
      estimatedheight: tip.height,
      bestblockhash: tip.hash,
      consensus: { chaintip: NU7, nextblock: NU7 },
      upgrades: { [NU7]: { activationheight: 2, status: "active" } },
    },
    wallet: {
      fully_synced_height: tip.height,
      locked: false,
      node_tip: { height: tip.height, blockhash: tip.hash },
      wallet_tip: { height: tip.height, blockhash: tip.hash },
    },
    accounts: [{ account_uuid: account }],
    history: [
      {
        account_uuid: account,
        mined_height: block.height,
        txid,
        outputs: [
          {
            pool: "ironwood",
            output_index: 0,
            to_account: account,
            value: intent.amount,
          },
        ],
      },
    ],
    inventory: [
      {
        account_uuid: account,
        txid,
        pool: "ironwood",
        outindex: 0,
        valueZat: intent.amount,
        confirmations: 2,
        is_watch_only: true,
        walletInternal: false,
      },
    ],
    view: {
      txid,
      status: "mined",
      confirmations: 2,
      blockhash: block.hash,
      outputs: [
        {
          pool: "ironwood",
          action: 0,
          account_uuid: account,
          outgoing: false,
          walletInternal: false,
          valueZat: intent.amount,
          address: receiver,
          memo: Buffer.from(memo.padEnd(512, "\0")).toString("hex"),
        },
      ],
    },
    raw: {
      txid,
      blockhash: block.hash,
      version: 6,
      height: 2,
      confirmations: 2,
      ironwood: { actions: [{ cmx: hash("d") }] },
    },
    genesis,
    build: "v" + ZEBRA_VERSION,
    member: block,
  };
  const zebraRaw = structuredClone(responses.raw);

  const zebra = {
    call: vi.fn(async (method: string, args?: unknown[]) => {
      if (method === "getinfo") return { build: responses.build };
      if (method === "getblockchaininfo") return responses.chain;
      if (method === "getblockhash")
        return args?.[0] === 0 ? responses.genesis : block.hash;
      if (method === "getblock")
        return args?.[0] === tip.hash ? tip : responses.member;
      if (method === "getrawtransaction") return zebraRaw;
      throw new Error("Unexpected Zebra RPC");
    }),
  };
  const zallet = {
    call: vi.fn(async (method: string) => {
      switch (method) {
        case "rpc.discover":
          return { info: { version: ZALLET_VERSION } };
        case "getwalletstatus":
          return responses.wallet;
        case "z_listaccounts":
          return responses.accounts;
        case "z_listtransactions":
          return responses.history;
        case "z_listunspent":
          return responses.inventory;
        case "z_viewtransaction":
          return responses.view;
        case "getrawtransaction":
          return responses.raw;
        default:
          throw new Error("Unexpected Zallet RPC");
      }
    }),
  };
  const adapter = () =>
    new LiveCustodyAdapter("regtest", account, 2, zebra, zallet, () => 203_000);
  return { adapter, responses, zebra, zallet, zebraRaw };
}

describe("Pinned Zallet/Zebra RPC contracts with synthetic responses", () => {
  it("accepts the pinned release build and local block times on Regtest", async () => {
    const { adapter, responses } = setup();
    responses.build = "v7.1.0+git.534549f";
    responses.chain.chain = "test";
    responses.chain.estimatedheight = 19_963_589;
    expect((await adapter().scan()).tip.hash).toBe(tip.hash);
    responses.build = "v7.1.0+git.0000000";
    await expect(adapter().scan()).rejects.toThrow(
      "Unexpected custody service version",
    );
  });

  it("accepts Zallet beta.4's locked read-only status with matching canonical tips", async () => {
    const { adapter, responses } = setup();
    delete (responses.wallet as { fully_synced_height?: number })
      .fully_synced_height;
    responses.wallet.locked = true;
    expect((await adapter().scan()).tip.hash).toBe(tip.hash);
  });

  it("rejects an estimated height far ahead on public Testnet", async () => {
    const { responses, zebra, zallet } = setup();
    responses.genesis =
      "05a60a92d99d85997cce3b87616c089f6124d7342af37106edc76126334a2c38";
    responses.chain.chain = "test";
    responses.chain.upgrades[NU7].activationheight = 4_465_026;
    responses.chain.estimatedheight += 100;
    const adapter = new LiveCustodyAdapter(
      "testnet-readonly",
      account,
      2,
      zebra,
      zallet,
    );
    await expect(adapter.scan()).rejects.toThrow("Zebra synchronization");
  });

  it("requires Zebra to independently corroborate a Testnet shielded commitment", async () => {
    const { responses, zebra, zallet, zebraRaw } = setup();
    responses.genesis =
      "05a60a92d99d85997cce3b87616c089f6124d7342af37106edc76126334a2c38";
    responses.chain.chain = "test";
    responses.chain.estimatedheight = tip.height;
    responses.chain.upgrades[NU7].activationheight = 4_465_026;
    const adapter = new LiveCustodyAdapter(
      "testnet-readonly",
      account,
      2,
      zebra,
      zallet,
      () => 203_000,
    );
    expect((await adapter.scan()).notes).toHaveLength(1);
    zebraRaw.ironwood.actions[0].cmx = hash("a");
    await expect(adapter.scan()).rejects.toThrow(
      "Zebra and Zallet output commitments disagree",
    );
  });

  it("observes a wallet-decrypted payment without any client transaction hint", async () => {
    const { adapter, zallet } = setup();
    const observation = await adapter().scan();
    expect(observation.notes).toMatchObject([
      {
        txid,
        outputIndex: 0,
        commitment: hash("d"),
        amount: 1_000_000,
        receiver,
        memoReference: memo,
        availability: "listed-watch-only",
      },
    ]);
    expect(matchIntent(observation, intent)).toMatchObject({
      outputId: "regtest:" + txid + ":ironwood:0",
      qualification: "observation-only",
    });
    expect(matchIntent(observation, { ...intent, amount: 1 })).toBeUndefined();
    expect(
      matchIntent(observation, { ...intent, memo: "zyro-taz-v1:" + hash("0") }),
    ).toBeUndefined();
    expect(
      matchIntent(observation, { ...intent, account: another }),
    ).toBeUndefined();
    expect(
      matchIntent(observation, { ...intent, receiver: "other" }),
    ).toBeUndefined();
    expect(
      matchIntent(observation, { ...intent, network: "testnet" }),
    ).toBeUndefined();
    expect(zallet.call).toHaveBeenCalledWith("z_listtransactions", [
      account,
      2,
      4,
      0,
      129,
    ]);
  });

  it("rebuilds note observations after a new worker starts and identifies a replaced prior block", async () => {
    const { adapter, responses } = setup();
    const prior = await adapter().scan();
    expect((await adapter().scan(prior.tip)).notes).toEqual(prior.notes);
    responses.inventory = [];
    const rebuilt = await adapter().scan({ height: 2, hash: hash("0") });
    expect(rebuilt.reorganized).toBe(true);
    expect(rebuilt.notes[0].availability).toBe("not-listed");
  });

  it("does not match missing or malformed raw memos", async () => {
    const { adapter, responses } = setup();
    responses.view.outputs[0].memo = Buffer.from(memo + "\0garbage").toString(
      "hex",
    );
    expect(matchIntent(await adapter().scan(), intent)).toBeUndefined();
    responses.view.outputs[0].memo = Buffer.from(memo).toString("hex");
    expect(matchIntent(await adapter().scan(), intent)).toBeUndefined();
  });

  it.each([
    [
      "wrong genesis",
      ({ responses }) => {
        responses.genesis = hash("0");
      },
      "genesis",
    ],
    [
      "unsupported branch",
      ({ responses }) => {
        responses.chain.consensus.nextblock = "00000000";
      },
      "77190ad9",
    ],
    [
      "scan lag",
      ({ responses }) => {
        responses.wallet.fully_synced_height--;
      },
      "wallet scan is behind",
    ],
    [
      "provider disagreement",
      ({ responses }) => {
        responses.wallet.node_tip.blockhash = hash("d");
      },
      "tips disagree",
    ],
    [
      "note membership mismatch",
      ({ responses }) => {
        responses.member = { ...block, tx: [] };
      },
      "canonical block",
    ],
    [
      "independent commitment mismatch",
      ({ zebraRaw }) => {
        zebraRaw.ironwood.actions[0].cmx = hash("a");
      },
      "output commitments disagree",
    ],
    [
      "ambiguous receiving account",
      ({ responses }) => {
        responses.view.outputs[0].account_uuid = another;
      },
      "owned output",
    ],
    [
      "amount disagreement",
      ({ responses }) => {
        responses.view.outputs[0].valueZat--;
      },
      "owned output",
    ],
    [
      "duplicate note",
      ({ responses }) => {
        responses.inventory.push(responses.inventory[0]);
      },
      "Duplicate wallet",
    ],
    [
      "unsupported wallet version",
      ({ zallet }) => {
        zallet.call.mockResolvedValueOnce({ info: { version: "unknown" } });
      },
      "service version",
    ],
    [
      "wallet restart",
      ({ zallet }) => {
        zallet.call.mockRejectedValueOnce(new Error("wallet restarting"));
      },
      "wallet restarting",
    ],
  ] satisfies [string, (s: ReturnType<typeof setup>) => void, string][])(
    "fails closed on %s",
    async (_label, modify, reason) => {
      const fixture = setup();
      modify(fixture);
      await expect(fixture.adapter().scan()).rejects.toThrow(reason);
    },
  );

  it("rejects an unsupported operator mode", () => {
    const { zebra, zallet } = setup();
    expect(
      () =>
        new LiveCustodyAdapter(
          "testnet-operator" as "regtest",
          account,
          2,
          zebra,
          zallet,
        ),
    ).toThrow("disabled");
  });
});

it("uses local cookie auth, rejects redirects and spend methods, and reloads rotated cookies", async () => {
  const temp = await mkdtemp(join(tmpdir(), "zyro-taz-rpc-"));
  try {
    const path = join(temp, "cookie");
    await writeFile(path, "rpc:disposable-one");
    const transport = vi.fn<typeof fetch>(async (_url, options) => {
      const body = JSON.parse(String(options?.body));
      expect(options?.redirect).toBe("error");
      expect(options?.headers).toMatchObject({
        authorization:
          "Basic " + Buffer.from("rpc:disposable-one").toString("base64"),
      });
      return new Response(
        JSON.stringify({ jsonrpc: "2.0", id: body.id, result: "ok" }),
      );
    });
    const rpc = new ObservationRpc(
      "zallet",
      "http://127.0.0.1:18232",
      path,
      transport,
    );
    expect(await rpc.call("getwalletstatus")).toBe("ok");
    await expect(rpc.call("pczt_sign" as "getwalletstatus")).rejects.toThrow(
      "method denied",
    );
    expect(transport).toHaveBeenCalledTimes(1);
    await writeFile(path, "rpc:disposable-two");
    transport.mockImplementationOnce(async (_url, options) => {
      expect(options?.headers).toMatchObject({
        authorization:
          "Basic " + Buffer.from("rpc:disposable-two").toString("base64"),
      });
      return new Response("sensitive upstream payload", { status: 401 });
    });
    await expect(rpc.call("getwalletstatus")).rejects.toThrow(
      /^zallet observation RPC authentication rejected$/,
    );
    for (const endpoint of [
      "http://localhost:18232",
      "http://example.invalid:18232",
      "http://rpc:password@127.0.0.1:18232/",
    ]) {
      expect(
        () => new ObservationRpc("zallet", endpoint, path, transport),
      ).toThrow("loopback");
    }
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
