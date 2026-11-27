import { randomUUID } from "node:crypto";
import { MongoClient } from "mongodb";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  FixtureCustody,
  type TxObservation,
} from "../apps/api/src/taz-markets/custody.js";
import { TazExecution } from "../apps/api/src/taz-markets/execution.js";
import {
  outputKey,
  STAKE,
  type Note,
  type Plan,
} from "../apps/api/src/taz-markets/model.js";
import { TazFixtures, TazStore } from "../apps/api/src/taz-markets/store.js";
import {
  block,
  candle,
  change,
  closesAt,
  fixtureRules,
  received,
  recipient,
  snapshot,
  token,
  walletId,
} from "./taz-fixtures.js";

const uri = process.env.ZYRO_TAZ_TEST_MONGO_URI;
describe.skipIf(!uri)(
  "TAZ replica-set transactions and restart recovery",
  () => {
    let client: MongoClient;
    const database = "zyro_taz_test_" + randomUUID().replaceAll("-", "");
    beforeAll(async () => {
      client = await new MongoClient(uri!, {
        serverSelectionTimeoutMS: 5000,
      }).connect();
    }, 10_000);
    afterEach(async () => {
      vi.restoreAllMocks();
      vi.unstubAllEnvs();
      await client?.db(database).dropDatabase();
    });
    afterAll(async () => {
      await client?.close();
    });

    async function setup() {
      vi.stubEnv("ZYRO_TAZ_FIXTURES", "1");
      vi.stubEnv("ZCASH_NETWORK", "testnet");
      let now = closesAt - 1000;
      let chain = snapshot(now, 8, [
        received("operator-fees", { role: "fee", amount: 15_000 }),
      ]);
      let tx: TxObservation = { state: "unknown" };
      let alter = (plan: Plan) => plan;
      const transmit = vi.fn(async (_signed: unknown) => {});
      const store = new TazStore(client, client.db(database));
      await store.init();
      const limits = {
        maxStake: STAKE,
        maxExposure: 4 * STAKE,
        maxFee: 10_000,
        minConfirmations: 2,
        maxScanAgeMs: 100_000,
      };
      const service = new TazFixtures(
        store,
        new FixtureCustody(walletId, recipient, change, token, {
          scan: async () => chain,
          submit: transmit,
          observe: async () => tx,
          prepare: async (plan) => alter(plan),
        }),
        limits,
        () => now,
      );
      const market = await service.createMarket(fixtureRules, token);
      const issue = (
        owner: string,
        side: "YES" | "NO",
        payout = "fixture-utest-" + owner,
      ) =>
        service.intent(
          {
            marketId: market._id,
            owner,
            side,
            requestId: "intent",
            payout,
            refund: "fixture-utest-refund-" + owner,
          },
          token,
        );
      await service.reconcile();
      await service.pause(false, token);
      const yes = await issue("a", "YES");
      const no = await issue("b", "NO");
      const notes = [received(yes.memo), received(no.memo)];
      async function scan(
        at: number,
        height: number,
        deposits: Note[],
        fork?: number,
      ) {
        now = at;
        chain = snapshot(at, height, [
          ...chain.notes.filter((n) => n.role === "fee"),
          ...deposits,
        ]);
        if (fork !== undefined) {
          const newBlock = block(fork, "fork");
          chain.blocks[fork] = newBlock;
          if (fork === height) chain.scanned = chain.tip = newBlock;
        }
        await service.reconcile();
      }
      const freeze = async (deposits = notes) => {
        await scan(closesAt, 8, deposits);
        await scan(180_000, 9, deposits);
      };
      return {
        store,
        service,
        market,
        yes,
        no,
        notes,
        scan,
        freeze,
        issue,
        transmit,
        setTx: (value: TxObservation) => {
          tx = value;
        },
        setPrepare: (f: typeof alter) => {
          alter = f;
        },
      };
    }

    it("freezes independent notes without hints and atomically finalizes once after rollback", async () => {
      const { store, service, market, issue, yes, notes, freeze } =
        await setup();
      expect((await issue("a", "YES"))._id).toBe(yes._id);
      await expect(issue("a", "YES", "fixture-utest-other")).rejects.toThrow(
        "idempotency",
      );
      await expect(issue("c", "YES")).rejects.toMatchObject({ code: 11000 });
      await service.hint(yes.owner, yes._id, notes[1].txid);
      await service.hint(yes.owner, yes._id, notes[1].txid);
      await expect(
        service.hint("intruder", yes._id, notes[0].txid),
      ).rejects.toThrow("unavailable");
      await freeze();
      expect(
        (await store.markets.findOne({ _id: market._id }))?.frozen,
      ).toHaveLength(2);
      expect(
        (await store.deposits.findOne({ _id: outputKey(notes[0]) }))
          ?.positionId,
      ).toBe(yes._id);
      expect(
        await service.finalize(market._id, [candle(105), candle(95)]),
      ).toBeUndefined();
      const original = store.record.bind(store);
      vi.spyOn(store, "record").mockImplementationOnce(async () => {
        throw new Error("crash");
      });
      await expect(service.finalize(market._id, [candle(105)])).rejects.toThrow(
        "crash",
      );
      expect(await store.obligations.countDocuments()).toBe(0);
      expect((await store.markets.findOne({ _id: market._id }))?.status).toBe(
        "frozen",
      );
      store.record = original;
      await Promise.all([
        service.finalize(market._id, [candle(105)]),
        service.finalize(market._id, [candle(105)]),
      ]);
      expect(await store.obligations.find({}).toArray()).toMatchObject([
        { owner: "a", amount: 2 * STAKE, kind: "payout" },
      ]);
      const collections = await client.db(database).listCollections().toArray();
      expect(
        collections.every((collection) => collection.name.startsWith("taz_")),
      ).toBe(true);
      expect(
        JSON.stringify(await store.audit.find({}).toArray()),
      ).not.toContain(token);
    });

    it("rejects repeated, excess, unknown and late notes and preserves review across scans", async () => {
      const { store, service, market, notes, scan } = await setup();
      const extra = { ...notes[0], index: 1, amount: STAKE + 5 };
      const unknown = received("unknown");
      const late = { ...notes[1], block: block(9) };
      await scan(closesAt, 8, [notes[0], extra, unknown]);
      await scan(180_000, 9, [notes[0], extra, unknown, late]);
      await scan(180_001, 10, [notes[0], extra, unknown, late]);
      await service.finalize(market._id, [candle(105)]);
      expect(await store.obligations.countDocuments()).toBe(0);
      const review = await store.deposits.find({ status: "review" }).toArray();
      expect(review.map((d) => d.reason)).toEqual(
        expect.arrayContaining([
          "repeated-or-conflicting",
          "incorrect amount",
          "unknown association",
          "late deposit",
        ]),
      );
    });

    it("holds a missed cutoff and revokes qualification if the cutoff reorganizes", async () => {
      const { store, market, notes, scan, freeze } = await setup();
      await freeze();
      await scan(180_001, 10, notes, 8);
      expect(await store.markets.findOne({ _id: market._id })).toMatchObject({
        status: "review",
        reason: "funding-reorganization",
      });
      expect(
        await store.positions.countDocuments({ status: "qualified" }),
      ).toBe(0);
    });

    it("holds when no close-window scan was received", async () => {
      const { store, market, notes, scan } = await setup();
      await scan(closesAt + 1001, 9, notes);
      expect(await store.markets.findOne({ _id: market._id })).toMatchObject({
        status: "review",
        reason: "missed-funding-cutoff",
      });
    });

    it("cancels unmatched funding with one refund and ignores an output orphaned before confirmation", async () => {
      const { store, service, market, notes, scan } = await setup();
      const earlyOrphan = { ...notes[1], block: block(8) };
      await scan(closesAt - 1, 8, [notes[0], earlyOrphan]);
      await scan(closesAt, 8, [notes[0]], 8);
      // The first fork defines the cutoff. Carry that block forward.
      await scan(180_000, 9, [notes[0]], 8);
      await service.finalize(market._id, [candle(105)]);
      expect(
        await store.deposits.findOne({ _id: outputKey(earlyOrphan) }),
      ).toMatchObject({ status: "orphaned" });
      expect(await store.obligations.find({}).toArray()).toMatchObject([
        { kind: "refund", amount: STAKE, owner: "a" },
      ]);
    });

    it.each([false, true])(
      "persists one signed identity across a broadcast failure (accepted=%s)",
      async (accepted) => {
        const {
          store,
          service,
          market,
          freeze,
          transmit,
          setTx,
          setPrepare,
          scan,
          notes,
        } = await setup();
        await freeze();
        const [row] = (await service.finalize(market._id, [candle(105)]))!;
        const executor = new TazExecution(service);
        setPrepare((plan) => ({ ...plan, recipient: "fixture-utest-other" }));
        await expect(executor.prepare(row._id, 10_000)).rejects.toThrow(
          "independently checked",
        );
        expect(
          await store.deposits.countDocuments({ reservedBy: row._id }),
        ).toBe(0);
        setPrepare((plan) => plan);
        const plan = (await executor.prepare(row._id, 10_000))!;
        await expect(
          executor.authorize(row._id, plan, "arena-admin"),
        ).rejects.toThrow("operator");
        await executor.authorize(row._id, plan, token);
        const original = service.custody.sign.bind(service.custody);
        vi.spyOn(service.custody, "sign").mockRejectedValueOnce(
          new Error("signer unavailable"),
        );
        await expect(executor.sign(row._id)).rejects.toThrow("unavailable");
        expect(await store.obligations.findOne({ _id: row._id })).toMatchObject(
          { status: "authorized" },
        );
        service.custody.sign = original;
        await executor.sign(row._id);
        const signed = (await store.obligations.findOne({ _id: row._id }))!
          .signed;
        transmit.mockImplementationOnce(async () => {
          if (accepted)
            setTx({ state: "included", block: block(9), tip: block(10) });
          throw new Error("connection dropped");
        });
        const attempts = await Promise.allSettled([
          executor.broadcast(row._id),
          new TazExecution(service).broadcast(row._id),
        ]);
        expect(
          attempts.filter((attempt) => attempt.status === "rejected"),
        ).toHaveLength(1);
        expect(transmit).toHaveBeenCalledExactlyOnceWith(signed);
        expect(await store.obligations.findOne({ _id: row._id })).toMatchObject(
          { status: "ambiguous", signed },
        );
        const restarted = new TazExecution(service);
        await scan(180_001, 10, notes);
        await restarted.broadcast(row._id);
        await restarted.reconcile(row._id);
        expect(await store.obligations.findOne({ _id: row._id })).toMatchObject(
          { status: accepted ? "confirmed" : "ambiguous", signed },
        );
        setTx({ state: "unknown" });
        await restarted.reconcile(row._id);
        expect(await store.obligations.findOne({ _id: row._id })).toMatchObject(
          { status: "ambiguous", signed },
        );
        expect(transmit).toHaveBeenCalledTimes(1);
      },
    );

    it("keeps two cancellation refunds exclusive when only one fee input is available", async () => {
      const { store, service, market, freeze } = await setup();
      await freeze();
      await service.pause(true, token);
      const rows = (await service.finalize(market._id, [], {
        operator: token,
        reason: "operator-cancelled",
      }))!;
      const executor = new TazExecution(service);
      const prepared = await Promise.all(
        rows.map((row) => executor.prepare(row._id, 10_000)),
      );
      expect(prepared.filter(Boolean)).toHaveLength(1);
      expect(
        await store.obligations.countDocuments({ status: "prepared" }),
      ).toBe(1);
      expect(
        await store.obligations.countDocuments({
          kind: "refund",
          amount: STAKE,
        }),
      ).toBe(2);
      expect(await store.controls.findOne({ _id: "fixture" })).toMatchObject({
        paused: true,
        incident: "custody-limit-or-fee-reserve",
      });
    });

    it("rebroadcasts only the stored fixture artifact after verified absence and revokes a reorged payment", async () => {
      const { store, service, market, freeze, scan, notes, transmit, setTx } =
        await setup();
      await freeze();
      const [row] = (await service.finalize(market._id, [candle(95)]))!;
      const execution = new TazExecution(service);
      const plan = (await execution.prepare(row._id, 10_000))!;
      await execution.authorize(row._id, plan, token);
      await execution.sign(row._id);
      transmit.mockRejectedValueOnce(new Error("stopped before submission"));
      await expect(execution.broadcast(row._id)).rejects.toThrow("stopped");
      await execution.rebroadcast(row._id, token);
      expect(transmit).toHaveBeenCalledTimes(1);
      setTx({
        state: "absent-valid",
        tip: block(9),
        evidence: "fixture verified absence",
      });
      await Promise.all([
        execution.rebroadcast(row._id, token),
        execution.rebroadcast(row._id, token),
      ]);
      expect(transmit).toHaveBeenCalledTimes(2);
      expect(transmit.mock.calls[0]).toEqual(transmit.mock.calls[1]);
      expect(await store.obligations.findOne({ _id: row._id })).toMatchObject({
        status: "submitted",
        rebroadcastClaimed: true,
      });
      await scan(180_001, 10, notes);
      setTx({ state: "included", block: block(9), tip: block(10) });
      await execution.reconcile(row._id);
      expect(await store.obligations.findOne({ _id: row._id })).toMatchObject({
        status: "confirmed",
      });
      await scan(180_002, 11, notes, 9);
      expect(await store.obligations.findOne({ _id: row._id })).toMatchObject({
        status: "ambiguous",
      });
      setTx({
        state: "invalid",
        tip: block(11),
        verifiedAbsent: true,
        evidence: "fixture expired and absent",
      });
      await execution.reconcile(row._id);
      expect(await store.obligations.findOne({ _id: row._id })).toMatchObject({
        status: "failed-safe",
      });
      await execution.broadcast(row._id);
      expect(transmit).toHaveBeenCalledTimes(2);
    });
  },
);
