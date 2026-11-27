import { randomBytes, randomUUID } from "node:crypto";
import type { ClientSession, Db, MongoClient } from "mongodb";
import {
  classify,
  digest,
  hex,
  integer,
  NETWORK,
  outputKey,
  requireThat,
  resolveFixture,
  settlement,
  STAKE,
  sum,
  unsafeCustody,
  validateScan,
  type Audit,
  type Control,
  type Deposit,
  type Limits,
  type Market,
  type Obligation,
  type Position,
  type Rules,
  type Scan,
  type Side,
} from "./model.js";
import type { FixtureCustody } from "./custody.js";

type LedgerCollections = {
  market: { _id: string };
  position: { _id: string };
  deposit: { _id: string };
  obligation: { _id: string };
};

export class TazStore<T extends LedgerCollections = {
  market: Market; position: Position; deposit: Deposit; obligation: Obligation;
}> {
  readonly markets;
  readonly positions;
  readonly deposits;
  readonly obligations;
  readonly audit;
  readonly controls;

  constructor(
    private client: MongoClient,
    db: Db,
    readonly scope: "fixture" | "regtest" | "testnet" = "fixture",
  ) {
    requireThat(
      scope !== "testnet" || db.databaseName === "zyro_taz_testnet",
      "Testnet TAZ data requires its dedicated database",
    );
    this.markets = db.collection<T["market"]>("taz_markets");
    this.positions = db.collection<T["position"]>("taz_positions");
    this.deposits = db.collection<T["deposit"]>("taz_deposits");
    this.obligations = db.collection<T["obligation"]>("taz_obligations");
    this.audit = db.collection<Audit>("taz_audit");
    this.controls = db.collection<Control>("taz_controls");
  }

  async init() {
    const hello = await this.client.db("admin").command({ hello: 1 });
    requireThat(hello.setName, "TAZ requires MongoDB replica-set transactions");
    await Promise.all([
      this.markets.createIndex({ "rules.candleStart": 1 }, { unique: true }),
      this.positions.createIndex({ marketId: 1, owner: 1 }, { unique: true }),
      this.positions.createIndex({ marketId: 1, side: 1 }, { unique: true }),
      this.positions.createIndex({ owner: 1, requestId: 1 }, { unique: true }),
      this.positions.createIndex({ memo: 1 }, { unique: true }),
      this.deposits.createIndex({ marketId: 1, positionId: 1, status: 1 }),
      this.obligations.createIndex({ owner: 1, marketId: 1 }),
      this.obligations.createIndex(
        { "signed.txid": 1 },
        {
          unique: true,
          partialFilterExpression: { "signed.txid": { $exists: true } },
        },
      ),
      this.audit.createIndex({ subject: 1, at: 1 }),
    ]);
    await this.controls.updateOne(
      { _id: this.scope },
      {
        $setOnInsert: { revision: 0, paused: true },
      },
      { upsert: true, writeConcern: { w: "majority" } },
    );
  }

  async atomic<T>(
    work: (session: ClientSession, control: Control) => Promise<T>,
  ) {
    return this.client.withSession((session) =>
      session.withTransaction(
        async () => {
          // Serialize accounting mutations across processes.
          const control = await this.controls.findOneAndUpdate(
            { _id: this.scope },
            { $inc: { revision: 1 } },
            { session, returnDocument: "after" },
          );
          requireThat(control, "TAZ store is not initialized");
          return work(session, control);
        },
        {
          readConcern: { level: "snapshot" },
          writeConcern: { w: "majority" },
          readPreference: "primary",
        },
      ),
    );
  }

  async record(
    session: ClientSession,
    actor: string,
    event: string,
    subject: string,
    evidence: unknown,
  ) {
    await this.audit.insertOne(
      {
        _id: randomUUID(),
        at: new Date(),
        actor,
        event,
        subject,
        evidenceDigest: digest(evidence),
      },
      { session },
    );
  }
}

export type IntentRequest = {
  marketId: string;
  owner: string;
  side: Side;
  payout: string;
  refund: string;
  requestId: string;
};

export class TazFixtures {
  constructor(
    readonly store: TazStore,
    readonly custody: FixtureCustody,
    readonly limits: Limits,
    private clock = Date.now,
  ) {
    requireThat(
      process.env.ZYRO_TAZ_FIXTURES === "1" &&
        process.env.NODE_ENV !== "production" &&
        (process.env.ZCASH_NETWORK ?? NETWORK) === NETWORK,
      "TAZ fixtures disabled",
    );
    requireThat(
      Object.values(limits).every((n) => integer(n) && n > 0) &&
        limits.maxStake <= STAKE &&
        limits.maxExposure <= 10 * STAKE &&
        limits.maxFee <= 100_000 &&
        limits.minConfirmations >= 2 &&
        limits.maxScanAgeMs <= 120_000,
      "Invalid fixture limits",
    );
  }

  now() {
    return this.clock();
  }

  async pause(paused: boolean, operator: string) {
    const actor = this.custody.assertOperator(operator);
    return this.store.atomic(async (session) => {
      await this.store.controls.updateOne(
        { _id: "fixture" },
        { $set: { paused } },
        { session },
      );
      await this.store.record(
        session,
        actor,
        paused ? "paused" : "resumed",
        "fixture",
        paused,
      );
    });
  }

  async createMarket(rules: Rules, operator: string) {
    const actor = this.custody.assertOperator(operator);
    requireThat(
      rules.version === 1 &&
        rules.network === NETWORK &&
        rules.pair === "BTC-USD" &&
        rules.provider === "Coinbase Exchange" &&
        rules.comparison === "GT" &&
        rules.equality === "NO" &&
        rules.stake === STAKE &&
        rules.stake <= this.limits.maxStake &&
        integer(rules.confirmations) &&
        rules.confirmations >= this.limits.minConfirmations &&
        integer(rules.closesAt) &&
        rules.closesAt > this.now() &&
        integer(rules.cutoffGraceMs) &&
        rules.cutoffGraceMs > 0 &&
        rules.cutoffGraceMs <= 60_000 &&
        integer(rules.candleStart) &&
        rules.candleStart % 60 === 0 &&
        integer(rules.candleStart * 1000) &&
        rules.candleStart * 1000 >= rules.closesAt + rules.cutoffGraceMs &&
        /^[1-9]\d{0,14}$/.test(rules.thresholdUnits),
      "Invalid fixture terms",
    );
    const market: Market = {
      _id: randomUUID(),
      rules,
      rulesHash: digest(rules),
      status: "open",
    };
    return this.store.atomic(async (session) => {
      await this.store.markets.insertOne(market, { session });
      await this.store.record(
        session,
        actor,
        "market-created",
        market._id,
        market.rulesHash,
      );
      return market;
    });
  }

  async intent(request: IntentRequest, reviewer: string) {
    const actor = this.custody.assertOperator(reviewer);
    requireThat(
      request.owner &&
        request.requestId &&
        request.requestId.length <= 128 &&
        ["YES", "NO"].includes(request.side),
      "Invalid intent",
    );
    this.custody.reviewAddress(request.payout);
    this.custody.reviewAddress(request.refund);
    return this.store.atomic(async (session, control) => {
      const prior = await this.store.positions.findOne(
        { owner: request.owner, requestId: request.requestId },
        { session },
      );
      if (prior) {
        requireThat(
          prior.marketId === request.marketId &&
            prior.side === request.side &&
            prior.payout === request.payout &&
            prior.refund === request.refund,
          "Intent idempotency conflict",
        );
        return prior;
      }
      requireThat(
        !control.paused && !control.incident && this.fresh(control),
        "Intake unavailable",
      );
      const market = await this.store.markets.findOne(
        { _id: request.marketId },
        { session },
      );
      const now = this.now();
      requireThat(
        market?.status === "open" &&
          !market.close &&
          now < market.rules.closesAt &&
          market.rulesHash === digest(market.rules),
        "Funding window closed",
      );
      const notes = await this.store.deposits
        .find({ status: { $ne: "orphaned" } }, { session })
        .toArray();
      const issued = await this.store.positions.find({}, { session }).toArray();
      const reservedExposure = sum(issued.map((p) => p.stake));
      const unmatchedExposure = sum(
        notes
          .filter(
            (d) =>
              d.note.role === "deposit" &&
              (d.status === "review" || !d.positionId),
          )
          .map((d) => d.note.amount),
      );
      requireThat(
        sum([reservedExposure, unmatchedExposure, market.rules.stake]) <=
          this.limits.maxExposure,
        "Custody exposure limit",
      );
      const position: Position = {
        _id: randomUUID(),
        marketId: request.marketId,
        owner: request.owner,
        side: request.side,
        payout: request.payout,
        refund: request.refund,
        requestId: request.requestId,
        rulesHash: market.rulesHash,
        network: NETWORK,
        stake: market.rules.stake,
        recipient: this.custody.recipient,
        association: "wallet-decrypted-memo",
        memo: "zyro-taz-v1:" + randomBytes(32).toString("hex"),
        createdAt: now,
        closesAt: market.rules.closesAt,
        addressReviewer: actor,
        status: "awaiting",
      };
      await this.store.positions.insertOne(position, { session });
      await this.store.record(
        session,
        actor,
        "intent-issued",
        position._id,
        position,
      );
      return position;
    });
  }

  async hint(owner: string, id: string, txid: string) {
    requireThat(hex(txid), "Invalid transaction hint");
    return this.store.atomic(async (session) => {
      const position = await this.store.positions.findOne(
        { _id: id, owner },
        { session },
      );
      requireThat(position, "Position unavailable");
      if (position.hint === txid) return;
      requireThat(!position.hint, "Hint already recorded");
      await this.store.positions.updateOne(
        { _id: id },
        { $set: { hint: txid } },
        { session },
      );
      await this.store.record(session, owner, "hint-added", id, txid);
    });
  }

  fresh(control: Control) {
    return (
      control.chain &&
      this.now() >= control.chain.observedAt &&
      this.now() - control.chain.observedAt <= this.limits.maxScanAgeMs
    );
  }

  async reconcile() {
    let scan: Scan;
    try {
      scan = await this.custody.scan();
    } catch {
      return this.store.atomic((session) =>
        this.incident(session, "invalid-custody-scan"),
      );
    }
    return this.store.atomic(async (session, control) => {
      let blocks: Map<number, string>;
      try {
        blocks = validateScan(
          scan,
          this.custody.walletId,
          this.now(),
          this.limits.maxScanAgeMs,
        );
      } catch {
        await this.incident(session, "invalid-custody-scan");
        return;
      }
      if (control.chain && scan.observedAt <= control.chain.observedAt) return;
      const old = await this.store.deposits.find({}, { session }).toArray();
      const seen = new Set(scan.notes.map(outputKey));
      const missing = old.filter(
        (d) => d.status !== "orphaned" && !seen.has(d._id),
      );
      if (
        missing.some(
          ({ note }) =>
            note.block.height <= scan.tip.height &&
            (!blocks.has(note.block.height) ||
              blocks.get(note.block.height) === note.block.hash),
        )
      ) {
        await this.incident(session, "incomplete-wallet-inventory");
        return;
      }
      await this.store.controls.updateOne(
        { _id: "fixture" },
        {
          $set: {
            chain: {
              observedAt: scan.observedAt,
              tip: scan.tip,
              blocks: scan.blocks,
            },
          },
        },
        { session },
      );
      const markets = await this.store.markets.find({}, { session }).toArray();
      const positions = await this.store.positions
        .find({}, { session })
        .toArray();
      for (const previous of missing) {
        await this.store.deposits.updateOne(
          { _id: previous._id },
          {
            $set: { status: "orphaned", reason: "missing-from-canonical-scan" },
          },
          { session },
        );
        await this.store.record(
          session,
          "scanner",
          "output-orphaned",
          previous._id,
          previous.note.block,
        );
      }
      for (const note of scan.notes) {
        await this.observe(session, note, markets, positions, old);
      }
      for (const market of markets) {
        await this.reconcileMarket(session, market, positions, scan, blocks);
      }
      const deposits = await this.store.deposits
        .find({ status: { $ne: "orphaned" } }, { session })
        .toArray();
      const reserves = deposits.filter(
        (d) =>
          d.status === "reserve" &&
          !d.reservedBy &&
          d.note.spendable &&
          scan.tip.height - d.note.block.height + 1 >=
            this.limits.minConfirmations,
      );
      const payments = await this.store.obligations
        .find(
          {
            status: { $in: ["ambiguous", "submitted", "confirmed"] },
          },
          { session },
        )
        .toArray();
      for (const payment of payments) {
        if (payment.status !== "confirmed") continue;
        const market = markets.find((m) => m._id === payment.marketId);
        const confirmation = payment.confirmation;
        if (
          market &&
          confirmation &&
          blocks.get(confirmation.height) === confirmation.hash &&
          scan.tip.height - confirmation.height + 1 >=
            market.rules.confirmations
        )
          continue;
        await this.store.obligations.updateOne(
          { _id: payment._id },
          { $set: { status: "ambiguous" }, $unset: { confirmation: "" } },
          { session },
        );
        payment.status = "ambiguous";
        await this.store.record(
          session,
          "scanner",
          "payment-confirmation-revoked",
          payment._id,
          confirmation ?? null,
        );
      }
      const confirmed = new Set(
        payments
          .filter((p) => p.status === "confirmed")
          .flatMap((p) => p.sources),
      );
      const principal = deposits.filter((d) => d.note.role === "deposit");
      const balances = {
        spendablePrincipal: sum(
          principal.filter((d) => d.note.spendable).map((d) => d.note.amount),
        ),
        unsettledPrincipal: sum(
          principal
            .filter((d) => !confirmed.has(d._id))
            .map((d) => d.note.amount),
        ),
        feeReserve: sum(reserves.map((d) => d.note.amount)),
      };
      await this.store.controls.updateOne(
        { _id: "fixture" },
        { $set: { balances } },
        { session },
      );
      if (
        principal.some(
          (d) =>
            !d.note.spendable &&
            !payments.some(
              (p) => p._id === d.reservedBy && p.sources.includes(d._id),
            ),
        )
      ) {
        await this.incident(session, "unexplained-spent-principal");
      }
      if (
        !control.incident &&
        (balances.feeReserve < this.limits.maxFee ||
          balances.unsettledPrincipal > this.limits.maxExposure)
      ) {
        await this.incident(session, "custody-limit-or-fee-reserve");
      }
    });
  }

  private async observe(
    session: ClientSession,
    note: Scan["notes"][number],
    markets: Market[],
    positions: Position[],
    old: Deposit[],
  ) {
    const id = outputKey(note);
    const prior = old.find((d) => d._id === id);
    const position = positions.find(
      (p) => p.memo === note.memo && p.recipient === note.recipient,
    );
    const market = markets.find((m) => m._id === position?.marketId);
    const reason = classify(note, position, market);
    const incompatible =
      prior &&
      (prior.note.commitment !== note.commitment ||
        prior.note.recipient !== note.recipient ||
        prior.note.memo !== note.memo ||
        prior.note.amount !== note.amount ||
        prior.note.role !== note.role ||
        prior.positionId !== position?._id);
    if (incompatible) {
      await this.store.deposits.updateOne(
        { _id: id },
        { $set: { status: "review", reason: "output-identity-conflict" } },
        { session },
      );
      await this.incident(session, "output-identity-conflict");
      return;
    }
    if (prior?.status === "review" && reason === "exact") {
      await this.store.deposits.updateOne(
        { _id: id },
        { $set: { note } },
        { session },
      );
      return;
    }
    if (prior?.reason === "output-identity-conflict") return;
    const status =
      reason === "reserve"
        ? "reserve"
        : reason === "exact"
          ? prior?.status === "qualified"
            ? "qualified"
            : "candidate"
          : "review";
    const row: Deposit = { _id: id, note, status };
    if (position)
      Object.assign(row, {
        positionId: position._id,
        marketId: position.marketId,
      });
    if (prior?.reservedBy) row.reservedBy = prior.reservedBy;
    if (status === "review") row.reason = reason;
    await this.store.deposits.replaceOne({ _id: id }, row, {
      upsert: true,
      session,
    });
    if (
      !prior ||
      prior.status !== row.status ||
      prior.note.block.hash !== note.block.hash
    ) {
      await this.store.record(session, "scanner", "output-observed", id, [
        status,
        note.block,
        note.commitment,
        row.reason ?? null,
      ]);
    }
  }

  private async reconcileMarket(
    session: ClientSession,
    market: Market,
    positions: Position[],
    scan: Scan,
    blocks: Map<number, string>,
  ) {
    if (market.status === "review") return;
    if (market.rulesHash !== digest(market.rules)) {
      await this.hold(session, market, "terms-hash-mismatch");
      return;
    }
    const deposits = await this.store.deposits
      .find({ marketId: market._id }, { session })
      .toArray();
    if (
      (market.close && blocks.get(market.close.height) !== market.close.hash) ||
      market.frozenBlocks?.some(
        ({ id, block }) =>
          !deposits.some(
            (d) =>
              d._id === id &&
              d.status === "qualified" &&
              d.note.block.height === block.height &&
              d.note.block.hash === block.hash &&
              blocks.get(d.note.block.height) === d.note.block.hash &&
              scan.tip.height - d.note.block.height + 1 >=
                market.rules.confirmations,
          ),
      )
    ) {
      await this.store.positions.updateMany(
        { marketId: market._id, status: "qualified" },
        { $set: { status: "review" } },
        { session },
      );
      await this.hold(session, market, "funding-reorganization");
      return;
    }
    if (market.status !== "open" || this.now() < market.rules.closesAt) return;
    if (!market.close) {
      if (scan.observedAt < market.rules.closesAt) {
        if (this.now() > market.rules.closesAt + market.rules.cutoffGraceMs) {
          await this.hold(session, market, "missed-funding-cutoff");
        }
        return;
      }
      if (
        scan.observedAt >
        market.rules.closesAt + market.rules.cutoffGraceMs
      ) {
        await this.hold(session, market, "missed-funding-cutoff");
        return;
      }
      market.close = scan.tip;
      await this.store.markets.updateOne(
        { _id: market._id },
        { $set: { close: market.close } },
        { session },
      );
      await this.store.record(
        session,
        "scanner",
        "cutoff-captured",
        market._id,
        market.close,
      );
    }
    if (scan.tip.height - market.close.height + 1 < market.rules.confirmations)
      return;
    const frozen: string[] = [];
    for (const p of positions.filter((p) => p.marketId === market._id)) {
      const associated = deposits.filter(
        (d) => d.positionId === p._id && d.status !== "orphaned",
      );
      const eligible = associated.filter(
        (d) => d.note.block.height <= market.close!.height,
      );
      const single =
        eligible.length === 1 &&
        eligible[0]?.status === "candidate" &&
        eligible[0].note.spendable;
      if (single) {
        frozen.push(eligible[0]._id);
        await this.store.deposits.updateOne(
          { _id: eligible[0]._id },
          { $set: { status: "qualified" } },
          { session },
        );
      }
      for (const deposit of associated.filter(
        (d) => !frozen.includes(d._id) && d.status === "candidate",
      )) {
        const reason =
          eligible.length > 1 ? "repeated-or-conflicting" : "ineligible-output";
        await this.store.deposits.updateOne(
          { _id: deposit._id },
          {
            $set: {
              status: "review",
              reason,
            },
          },
          { session },
        );
        await this.store.record(
          session,
          "scanner",
          "output-reviewed",
          deposit._id,
          reason,
        );
      }
      await this.store.positions.updateOne(
        { _id: p._id },
        {
          $set: {
            status: single
              ? "qualified"
              : associated.length
                ? "review"
                : "awaiting",
          },
        },
        { session },
      );
    }
    const frozenBlocks = deposits
      .filter((d) => frozen.includes(d._id))
      .map((d) => ({ id: d._id, block: d.note.block }));
    await this.store.markets.updateOne(
      { _id: market._id },
      {
        $set: {
          frozen: frozen.sort(),
          frozenBlocks,
          status: "frozen",
        },
      },
      { session },
    );
    await this.store.record(
      session,
      "scanner",
      "funding-frozen",
      market._id,
      frozenBlocks,
    );
  }

  private async hold(session: ClientSession, market: Market, reason: string) {
    await this.store.markets.updateOne(
      { _id: market._id },
      { $set: { status: "review", reason } },
      { session },
    );
    const queued = await this.store.obligations.updateMany(
      {
        marketId: market._id,
        status: { $in: ["pending", "prepared", "authorized", "signed"] },
      },
      { $set: { status: "review" } },
      { session },
    );
    await this.store.record(session, "scanner", "market-held", market._id, {
      reason,
      heldObligations: queued.modifiedCount,
    });
  }

  private async incident(session: ClientSession, reason: string) {
    const change = await this.store.controls.updateOne(
      {
        _id: "fixture",
        incident:
          reason === "custody-limit-or-fee-reserve"
            ? { $exists: false }
            : { $ne: reason },
      },
      { $set: { incident: reason, paused: true } },
      { session },
    );
    if (change.modifiedCount)
      await this.store.record(
        session,
        "scanner",
        "custody-incident",
        "fixture",
        reason,
      );
  }

  async finalize(
    id: string,
    observations: unknown[],
    cancellation?: { operator: string; reason: "operator-cancelled" },
  ) {
    const actor = cancellation
      ? this.custody.assertOperator(cancellation.operator)
      : "resolver";
    return this.store.atomic(async (session, control) => {
      const market = await this.store.markets.findOne({ _id: id }, { session });
      if (!market || market.status !== "frozen") return;
      requireThat(
        this.fresh(control) &&
          !unsafeCustody(control) &&
          market.rulesHash === digest(market.rules),
        "Funding evidence unavailable",
      );
      const funded = await this.store.deposits
        .find(
          { _id: { $in: market.frozen! }, status: "qualified" },
          { session },
        )
        .toArray();
      requireThat(
        funded.length === market.frozen!.length &&
          funded.every((d) => d.note.spendable),
        "Frozen funds unavailable",
      );
      const positions = await this.store.positions
        .find({ marketId: id }, { session })
        .toArray();
      let evidence: ReturnType<typeof resolveFixture>;
      const reason =
        cancellation?.reason ?? (funded.length < 2 ? "unmatched" : undefined);
      if (!reason) {
        try {
          evidence = resolveFixture(market.rules, observations, this.now());
        } catch {
          /* Invalid fixture evidence holds. */
        }
        if (!evidence) {
          if (!market.evidenceHold) {
            await this.store.markets.updateOne(
              { _id: id },
              { $set: { evidenceHold: true } },
              { session },
            );
            await this.store.record(
              session,
              actor,
              "price-evidence-held",
              id,
              market.rulesHash,
            );
          }
          return;
        }
      }
      const obligations = settlement(market, funded, positions, evidence?.side);
      if (obligations.length)
        await this.store.obligations.insertMany(obligations, { session });
      await this.store.markets.updateOne(
        { _id: id },
        {
          $unset: { evidenceHold: "" },
          $set: evidence
            ? {
                status: "resolved",
                outcome: evidence.side,
                evidence: evidence.row,
              }
            : { status: "cancelled", reason },
        },
        { session },
      );
      await this.store.record(
        session,
        actor,
        evidence ? "resolved" : "cancelled",
        id,
        { evidence, reason, obligations: obligations.map((o) => o._id) },
      );
      return obligations;
    });
  }
}
