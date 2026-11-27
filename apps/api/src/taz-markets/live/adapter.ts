import { z } from "zod";
import { digest, requireThat, type Block } from "../model.js";
import type { ObservationRpc } from "./rpc.js";

export const NU7 = "77190ad9";
export const ZALLET_VERSION = "0.1.0-beta.4";
export const ZEBRA_VERSION = "7.1.0";
const ZEBRA_RELEASE_BUILD = ZEBRA_VERSION + "+git.534549f";
const networks = {
  "testnet-readonly": {
    genesis: "05a60a92d99d85997cce3b87616c089f6124d7342af37106edc76126334a2c38",
    network: "testnet",
    activation: 4_465_026,
  },
  regtest: {
    genesis: "029f11d80ef9765602235e1bc9727e3eb6ba20839319f761fee920d63401e327",
    network: "regtest",
    activation: 2,
  },
} as const;
export type ObservationMode = keyof typeof networks;
const hash = z.string().regex(/^[0-9a-f]{64}$/);
const height = z
  .number()
  .int()
  .min(0)
  .max(0xffff_ffff - 1);
const zats = z.number().int().min(0).max(2_100_000_000_000_000);
const pool = z.enum(["sapling", "orchard", "ironwood", "transparent"]);
const uuid = z.string().uuid();
const chainInfo = z.object({
  chain: z.enum(["test", "regtest"]),
  blocks: height,
  estimatedheight: height,
  bestblockhash: hash,
  consensus: z.object({ chaintip: z.literal(NU7), nextblock: z.literal(NU7) }),
  upgrades: z.object({
    [NU7]: z.object({ activationheight: height, status: z.literal("active") }),
  }),
});
const tipSchema = z.object({ height, blockhash: hash });
const walletStatus = z.object({
  node_tip: tipSchema,
  wallet_tip: tipSchema,
  // Zallet 0.1.0-beta.4 reports the node and wallet tips directly, but does
  // not expose the newer fully_synced_height field. Equal canonical tips are
  // the synchronization proof for this pinned RPC contract. A locked wallet
  // can still provide read-only observations.
  fully_synced_height: height.optional(),
  locked: z.boolean(),
});
const history = z.array(
  z.object({
    account_uuid: uuid,
    txid: hash,
    mined_height: height.nullable(),
    outputs: z.array(
      z.object({
        pool,
        output_index: height,
        to_account: uuid.nullable(),
        value: zats,
      }),
    ),
  }),
);
const inventory = z.array(
  z.object({
    txid: hash,
    pool,
    outindex: height,
    confirmations: height,
    account_uuid: uuid,
    valueZat: zats,
    is_watch_only: z.boolean(),
    walletInternal: z.boolean(),
  }),
);
const viewed = z.object({
  txid: hash,
  status: z.literal("mined"),
  blockhash: hash,
  confirmations: height,
  outputs: z.array(
    z.object({
      pool,
      output: height.optional(),
      action: height.optional(),
      account_uuid: uuid.optional(),
      address: z.string().max(512).optional(),
      outgoing: z.boolean().nullish(),
      walletInternal: z.boolean(),
      valueZat: zats,
      memo: z.string().max(1024).optional(),
    }),
  ),
});
const commitment = z.object({ cmx: hash });
const raw = z.object({
  txid: hash,
  blockhash: hash,
  version: z.number().int().min(4).max(6),
  height,
  confirmations: height,
  vShieldedOutput: z.array(z.object({ cmu: hash })).optional(),
  orchard: z.object({ actions: z.array(commitment) }).optional(),
  ironwood: z.object({ actions: z.array(commitment) }).optional(),
});
type DecodedTransaction = z.infer<typeof raw>;
type ShieldedPool = Exclude<z.infer<typeof pool>, "transparent">;

function shieldedCommitment(
  tx: DecodedTransaction,
  poolName: ShieldedPool,
  index: number,
) {
  return poolName === "sapling"
    ? tx.vShieldedOutput?.[index]?.cmu
    : tx[poolName]?.actions[index]?.cmx;
}
const canonicalBlock = z.object({
  hash,
  height,
  time: height,
  tx: z.array(hash),
});

export type OwnedObservation = {
  id: string;
  txid: string;
  pool: Exclude<z.infer<typeof pool>, "transparent">;
  outputIndex: number;
  commitment: string;
  account: string;
  amount: number;
  block: Block;
  confirmations: number;
  receiver?: string;
  memoReference?: string;
  availability: "listed-watch-only" | "listed-unspent" | "not-listed";
};

function memoReference(memo: string | undefined) {
  if (!memo || !/^[a-f0-9]{1024}$/i.test(memo)) return;
  const bytes = Buffer.from(memo, "hex");
  const length = "zyro-taz-v1:".length + 64;
  const value = bytes.subarray(0, length).toString("latin1");
  if (
    /^zyro-taz-v1:[a-f0-9]{64}$/.test(value) &&
    bytes.subarray(length).every((byte) => byte === 0)
  )
    return value;
}

const output = (txid: string, poolName: string, index: number) =>
  [txid, poolName, index].join(":");

export class LiveCustodyAdapter {
  readonly #network;
  constructor(
    readonly mode: ObservationMode,
    readonly account: string,
    readonly startHeight: number,
    private readonly zebra: Pick<ObservationRpc<"zebra">, "call">,
    private readonly zallet: Pick<ObservationRpc<"zallet">, "call">,
    private readonly now = Date.now,
  ) {
    requireThat(
      Object.hasOwn(networks, mode),
      "Custody spending modes are disabled",
    );
    this.#network = networks[mode];
    uuid.parse(account);
    height.parse(startHeight);
  }

  private async anchor(): Promise<Block> {
    const info = chainInfo.parse(await this.zebra.call("getblockchaininfo"));
    requireThat(
      (this.mode === "regtest" || info.chain === "test") &&
        info.upgrades[NU7].activationheight === this.#network.activation,
      "Unexpected custody network or upgrade schedule",
    );
    requireThat(
      // Zebra estimates public chain height from block time, which Regtest
      // mining can leave near genesis. Check the exact wallet tips below.
      this.mode === "regtest" || info.estimatedheight <= info.blocks + 2,
      "Zebra synchronization is behind",
    );
    const status = walletStatus.parse(
      await this.zallet.call("getwalletstatus"),
    );
    requireThat(
      (status.fully_synced_height === undefined ||
        status.fully_synced_height === info.blocks) &&
        [status.wallet_tip, status.node_tip].every(
          (tip) =>
            tip.height === info.blocks && tip.blockhash === info.bestblockhash,
        ),
      "Zebra and Zallet tips disagree or wallet scan is behind",
    );
    return { height: info.blocks, hash: info.bestblockhash };
  }

  async scan(previous?: Block) {
    const started = this.now();
    const [nodeVersion, walletVersion] = await Promise.all([
      this.zebra.call("getinfo"),
      this.zallet.call("rpc.discover"),
    ]);
    const build = z
      .object({ build: z.string() })
      .parse(nodeVersion)
      .build.replace(/^v/, "");
    requireThat(
      (build === ZEBRA_VERSION || build === ZEBRA_RELEASE_BUILD) &&
        z
          .object({ info: z.object({ version: z.string() }) })
          .parse(walletVersion).info.version === ZALLET_VERSION,
      "Unexpected custody service version",
    );
    requireThat(
      (await this.zebra.call("getblockhash", [0])) === this.#network.genesis,
      "Unexpected custody genesis",
    );
    const tip = await this.anchor();
    const accounts = z
      .array(z.object({ account_uuid: uuid }))
      .parse(await this.zallet.call("z_listaccounts", [false]));
    requireThat(
      accounts.filter((row) => row.account_uuid === this.account).length === 1,
      "Custody account unavailable",
    );
    const current = canonicalBlock.parse(
      await this.zebra.call("getblock", [tip.hash, 1]),
    );
    requireThat(
      current.hash === tip.hash && current.height === tip.height,
      "Invalid Zebra tip block",
    );
    if (this.mode === "testnet-readonly") {
      const age = started - current.time * 1000;
      requireThat(
        age >= -120_000 && age <= 600_000,
        "Public Testnet tip is stale",
      );
    }
    requireThat(
      this.startHeight <= tip.height,
      "Custody history start exceeds tip",
    );
    const reorganized = previous
      ? previous.height > tip.height ||
        hash.parse(await this.zebra.call("getblockhash", [previous.height])) !==
          previous.hash
      : false;
    const listed = inventory.parse(
      await this.zallet.call("z_listunspent", [1]),
    );
    const available = new Map<string, (typeof listed)[number]>();
    for (const row of listed) {
      if (row.account_uuid !== this.account || row.pool === "transparent")
        continue;
      const id = output(row.txid, row.pool, row.outindex);
      requireThat(!available.has(id), "Duplicate wallet inventory note");
      available.set(id, row);
    }

    const notes: OwnedObservation[] = [];
    const seen = new Set<string>();
    const seenOutputs = new Set<string>();
    const blocks = new Map<number, z.infer<typeof canonicalBlock>>([
      [tip.height, current],
    ]);
    // One bounded snapshot. An overflowing account must be provisioned with a narrower history window.
    const records = history.parse(
      await this.zallet.call("z_listtransactions", [
        this.account,
        this.startHeight,
        tip.height + 1,
        0,
        129,
      ]),
    );
    requireThat(
      records.length <= 128,
      "Custody wallet history exceeds observation limit",
    );
    for (const tx of records) {
      requireThat(
        tx.account_uuid === this.account && !seen.has(tx.txid),
        "Ambiguous wallet account history",
      );
      seen.add(tx.txid);
      if (tx.mined_height === null) continue;
      requireThat(
        tx.mined_height >= this.startHeight && tx.mined_height <= tip.height,
        "Wallet history outside observation window",
      );
      const owned = tx.outputs.filter(
        (row) => row.to_account === this.account && row.pool !== "transparent",
      );
      if (!owned.length) continue;
      let block = blocks.get(tx.mined_height);
      if (!block) {
        const id = hash.parse(
          await this.zebra.call("getblockhash", [tx.mined_height]),
        );
        block = canonicalBlock.parse(
          await this.zebra.call("getblock", [id, 1]),
        );
        requireThat(
          block.hash === id && block.height === tx.mined_height,
          "Invalid canonical block",
        );
        blocks.set(block.height, block);
      }
      requireThat(
        block.tx.includes(tx.txid),
        "Wallet transaction is outside the Zebra canonical block",
      );
      const detail = viewed.parse(
        await this.zallet.call("z_viewtransaction", [tx.txid]),
      );
      const decoded = raw.parse(
        await this.zallet.call("getrawtransaction", [tx.txid, 1]),
      );
      // Require independent node decoding on every network. The wallet's
      // decrypted output proves ownership, while Zebra's transaction decode
      // corroborates the canonical shielded commitment.
      const nodeDecoded = raw.parse(
        await this.zebra.call("getrawtransaction", [tx.txid, 1]),
      );
      const confirmations = tip.height - block.height + 1;
      requireThat(
        detail.txid === tx.txid &&
          decoded.txid === tx.txid &&
          detail.blockhash === block.hash &&
          decoded.blockhash === block.hash &&
          decoded.height === block.height &&
          decoded.confirmations === confirmations &&
          detail.confirmations === confirmations,
        "Wallet transaction evidence disagrees",
      );
      requireThat(
        nodeDecoded.txid === tx.txid &&
          nodeDecoded.blockhash === block.hash &&
          nodeDecoded.height === block.height &&
          nodeDecoded.confirmations === confirmations &&
          nodeDecoded.version === decoded.version,
        "Zebra decoded transaction evidence disagrees",
      );
      for (const row of owned) {
        if (row.pool === "transparent") continue;
        const id = output(tx.txid, row.pool, row.output_index);
        requireThat(!seenOutputs.has(id), "Duplicate owned output");
        seenOutputs.add(id);
        const matches = detail.outputs.filter(
          (candidate) =>
            candidate.pool === row.pool &&
            (row.pool === "sapling" ? candidate.output : candidate.action) ===
              row.output_index,
        );
        const [proof] = matches;
        requireThat(
          matches.length === 1 &&
            proof.account_uuid === this.account &&
            proof.outgoing === false &&
            proof.valueZat === row.value,
          "Wallet cannot prove owned output attribution",
        );
        const noteCommitment = shieldedCommitment(
          decoded,
          row.pool,
          row.output_index,
        );
        requireThat(noteCommitment, "Shielded output commitment unavailable");
        requireThat(
          shieldedCommitment(nodeDecoded, row.pool, row.output_index) ===
            noteCommitment,
          "Zebra and Zallet output commitments disagree",
        );
        const unspent = available.get(id);
        requireThat(
          !unspent ||
            (unspent.valueZat === row.value &&
              unspent.confirmations === confirmations &&
              unspent.walletInternal === proof.walletInternal),
          "Wallet inventory disagrees with decrypted output",
        );
        available.delete(id);
        notes.push({
          id: this.#network.network + ":" + id,
          txid: tx.txid,
          pool: row.pool,
          outputIndex: row.output_index,
          commitment: noteCommitment,
          account: this.account,
          amount: row.value,
          block: { height: block.height, hash: block.hash },
          confirmations,
          receiver: proof.walletInternal ? undefined : proof.address,
          memoReference: proof.walletInternal
            ? undefined
            : memoReference(proof.memo),
          availability: !unspent
            ? "not-listed"
            : unspent.is_watch_only
              ? "listed-watch-only"
              : "listed-unspent",
        });
      }
    }
    // Older notes are allowed only outside the explicitly requested history window.
    requireThat(
      [...available.values()].every(
        (n) => tip.height - n.confirmations + 1 < this.startHeight,
      ),
      "Unspent owned note missing from wallet history",
    );
    const end = await this.anchor();
    requireThat(
      tip.hash === end.hash &&
        tip.height === end.height &&
        this.now() - started <= 60_000,
      "Custody observation changed or expired during scan",
    );
    return {
      mode: this.mode,
      network: this.#network.network,
      account: this.account,
      tip,
      branch: NU7,
      observedAt: this.now(),
      reorganized,
      notes,
    };
  }
}

const observationIntent = z
  .object({
    network: z.enum(["regtest", "testnet"]),
    account: uuid,
    receiver: z.string().min(1).max(512),
    memo: z.string().regex(/^zyro-taz-v1:[a-f0-9]{64}$/),
    amount: zats.min(1),
    confirmations: height.min(1),
  })
  .strict();

// Diagnostic association only. It does not establish authorization, spendability, cutoff eligibility, or ledger qualification.
export function matchIntent(
  scan: Awaited<ReturnType<LiveCustodyAdapter["scan"]>>,
  input: unknown,
) {
  const parsed = observationIntent.safeParse(input);
  if (!parsed.success) return;
  const intent = parsed.data;
  if (scan.network !== intent.network || scan.account !== intent.account)
    return;
  const matches = scan.notes.filter(
    (note) =>
      note.receiver === intent.receiver && note.memoReference === intent.memo,
  );
  if (
    matches.length !== 1 ||
    matches[0].amount !== intent.amount ||
    matches[0].confirmations < intent.confirmations
  )
    return;
  return {
    outputId: matches[0].id,
    evidenceDigest: digest(matches[0]),
    qualification: "observation-only" as const,
  };
}
