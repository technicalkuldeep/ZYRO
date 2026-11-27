import type { ClientSession } from "mongodb";
import { validatePlan, validateSigned } from "./custody.js";
import {
  digest,
  NETWORK,
  requireThat,
  unsafeCustody,
  validBlock,
  type Control,
  type Deposit,
  type Obligation,
  type Plan,
  type Signed,
} from "./model.js";
import type { TazFixtures } from "./store.js";

export class TazExecution {
  constructor(private service: TazFixtures) {}
  private get store() {
    return this.service.store;
  }
  private get custody() {
    return this.service.custody;
  }

  private async usable(
    row: Obligation,
    control: Control,
    session: ClientSession,
  ) {
    const market = await this.store.markets.findOne(
      { _id: row.marketId },
      { session },
    );
    requireThat(
      this.service.fresh(control) &&
        control.chain &&
        !unsafeCustody(control) &&
        market &&
        market.rulesHash === digest(market.rules) &&
        (row.kind === "payout"
          ? market.status === "resolved"
          : market.status === "cancelled"),
      "Custody evidence unavailable",
    );
    return control.chain.tip.height;
  }

  private async inputs(
    row: Obligation,
    plan: Plan,
    height: number,
    session: ClientSession,
  ) {
    const deposits = await this.store.deposits
      .find({ _id: { $in: plan.inputs } }, { session })
      .toArray();
    requireThat(
      deposits.every(
        (d) =>
          d.reservedBy === row._id &&
          height - d.note.block.height + 1 >=
            this.service.limits.minConfirmations,
      ),
      "Invalid input reservation",
    );
    this.check(plan, row, deposits);
  }

  private check(plan: Plan, row: Obligation, inputs: Deposit[]) {
    validatePlan(
      plan,
      row,
      inputs,
      this.custody.walletId,
      this.custody.change,
      this.service.limits.maxFee,
    );
  }

  private async save(
    session: ClientSession,
    row: Obligation,
    actor = "execution",
  ) {
    await this.store.obligations.replaceOne({ _id: row._id }, row, { session });
    await this.store.record(
      session,
      actor,
      row.status,
      row._id,
      row.signed?.txid ?? row.approval?.digest ?? row.plan ?? row.sources,
    );
  }

  async prepare(id: string, fee: number) {
    return this.store.atomic(async (session, control) => {
      const row = await this.store.obligations.findOne(
        { _id: id },
        { session },
      );
      if (!row || row.status !== "pending") return;
      requireThat(
        Number.isSafeInteger(fee) &&
          fee > 0 &&
          fee <= this.service.limits.maxFee,
        "Invalid fee",
      );
      const height = await this.usable(row, control, session);
      const notes = await this.store.deposits
        .find(
          {
            $or: [
              { _id: { $in: row.sources } },
              {
                status: "reserve",
                "note.amount": { $gte: fee },
                "note.spendable": true,
              },
            ],
            reservedBy: { $exists: false },
          },
          { session },
        )
        .sort({ _id: 1 })
        .toArray();
      const reserve = notes.find(
        (d) =>
          d.status === "reserve" &&
          height - d.note.block.height + 1 >=
            this.service.limits.minConfirmations,
      );
      if (!reserve) {
        await this.store.controls.updateOne(
          { _id: "fixture" },
          {
            $set: { paused: true, incident: "custody-limit-or-fee-reserve" },
          },
          { session },
        );
        await this.store.record(
          session,
          "execution",
          "fee-reserve-unavailable",
          id,
          fee,
        );
        return;
      }
      const proposal: Plan = {
        obligationId: id,
        network: NETWORK,
        walletId: this.custody.walletId,
        inputs: [...row.sources, reserve._id].sort(),
        recipient: row.destination,
        amount: row.amount,
        fee,
        change:
          reserve.note.amount === fee
            ? null
            : {
                recipient: this.custody.change,
                amount: reserve.note.amount - fee,
              },
      };
      // Fixture-only pure calls. Live HSM/wallet calls must never run in a retried Mongo callback.
      const prepared = await this.custody.prepare(structuredClone(proposal));
      const inspected = await this.custody.inspect(prepared);
      requireThat(
        digest(proposal) === digest(inspected) &&
          digest(inspected) === digest(prepared),
        "Prepared fixture does not match the independently checked plan",
      );
      const selected = notes.filter((d) => proposal.inputs.includes(d._id));
      this.check(inspected, row, selected);
      for (const note of selected) {
        await this.store.deposits.updateOne(
          { _id: note._id },
          { $set: { reservedBy: id } },
          { session },
        );
      }
      await this.save(session, { ...row, plan: inspected, status: "prepared" });
      return digest(inspected);
    });
  }

  async authorize(id: string, planDigest: string, token: string) {
    const approval = this.custody.approve(planDigest, token);
    return this.store.atomic(async (session, control) => {
      const row = await this.store.obligations.findOne(
        { _id: id },
        { session },
      );
      if (!row || row.status !== "prepared") return;
      requireThat(
        row.plan && digest(row.plan) === planDigest,
        "Authorization digest mismatch",
      );
      const height = await this.usable(row, control, session);
      await this.inputs(row, row.plan, height, session);
      await this.save(
        session,
        {
          ...row,
          status: "authorized",
          approval,
        },
        approval.actor,
      );
    });
  }

  async sign(id: string) {
    return this.store.atomic(async (session, control) => {
      const row = await this.store.obligations.findOne(
        { _id: id },
        { session },
      );
      if (!row || row.status !== "authorized") return;
      requireThat(row.plan && row.approval, "Approval missing");
      const height = await this.usable(row, control, session);
      await this.inputs(row, row.plan, height, session);
      const signed = await this.custody.sign(row.plan, row.approval);
      validateSigned(signed);
      await this.save(session, { ...row, signed, status: "signed" });
    });
  }

  async broadcast(id: string) {
    const signed = await this.store.atomic(async (session, control) => {
      const row = await this.store.obligations.findOne(
        { _id: id },
        { session },
      );
      if (!row || row.status !== "signed") return;
      requireThat(row.plan && row.signed, "Signed fixture missing");
      const height = await this.usable(row, control, session);
      await this.inputs(row, row.plan, height, session);
      validateSigned(row.signed);
      // This durable single-winner claim is never reset by a timeout or restart.
      await this.save(session, { ...row, status: "ambiguous" });
      return row.signed;
    });
    if (signed) await this.submit(id, signed);
  }

  async rebroadcast(id: string, token: string) {
    const actor = this.custody.assertOperator(token);
    const before = await this.store.obligations.findOne({
      _id: id,
      status: "ambiguous",
    });
    if (!before?.signed || before.rebroadcastClaimed) return;
    const observation = await this.custody.observe(before.signed.txid);
    if (
      observation.state !== "absent-valid" ||
      !observation.evidence ||
      !validBlock(observation.tip)
    )
      return;
    const signed = await this.store.atomic(async (session, control) => {
      const row = await this.store.obligations.findOne(
        { _id: id },
        { session },
      );
      if (
        !row ||
        row.status !== "ambiguous" ||
        row.rebroadcastClaimed ||
        !row.signed ||
        row.signed.txid !== before.signed!.txid ||
        control.chain?.tip.hash !== observation.tip.hash ||
        control.chain.tip.height !== observation.tip.height
      )
        return;
      requireThat(row.plan, "Rebroadcast plan missing");
      const height = await this.usable(row, control, session);
      await this.inputs(row, row.plan, height, session);
      validateSigned(row.signed);
      await this.store.obligations.updateOne(
        { _id: id },
        { $set: { rebroadcastClaimed: true } },
        { session },
      );
      await this.store.record(
        session,
        actor,
        "same-fixture-rebroadcast-claimed",
        id,
        [row.signed.txid, observation.tip, observation.evidence],
      );
      return row.signed;
    });
    if (signed) await this.submit(id, signed);
  }

  private async submit(id: string, signed: Signed) {
    await this.custody.submit(signed);
    await this.store.atomic(async (session) => {
      const row = await this.store.obligations.findOne(
        { _id: id },
        { session },
      );
      if (row?.status === "ambiguous" && row.signed?.txid === signed.txid) {
        await this.save(session, { ...row, status: "submitted" });
      }
    });
  }

  async reconcile(id: string) {
    const before = await this.store.obligations.findOne({ _id: id });
    if (
      !before?.signed ||
      !["ambiguous", "submitted", "confirmed"].includes(before.status)
    )
      return;
    const tx = await this.custody.observe(before.signed.txid);
    return this.store.atomic(async (session, control) => {
      const row = await this.store.obligations.findOne(
        { _id: id },
        { session },
      );
      if (
        !row ||
        row.status !== before.status ||
        row.signed?.txid !== before.signed!.txid ||
        row.confirmation?.hash !== before.confirmation?.hash ||
        !this.service.fresh(control) ||
        !control.chain ||
        unsafeCustody(control)
      )
        return;
      const market = await this.store.markets.findOne(
        { _id: row.marketId },
        { session },
      );
      const next: Obligation = { ...row };
      delete next.confirmation;
      if (
        tx.state === "included" &&
        validBlock(tx.block) &&
        validBlock(tx.tip) &&
        tx.tip.hash === control.chain.tip.hash &&
        tx.tip.height === control.chain.tip.height &&
        control.chain.blocks.some(
          (block) =>
            block.height === tx.block.height && block.hash === tx.block.hash,
        )
      ) {
        if (
          market &&
          market.status !== "review" &&
          tx.tip.height - tx.block.height + 1 >= market.rules.confirmations
        ) {
          next.status = "confirmed";
          next.confirmation = tx.block;
        } else {
          next.status = "submitted";
        }
      } else if (
        tx.state === "invalid" &&
        tx.verifiedAbsent &&
        tx.evidence &&
        tx.tip.height === control.chain.tip.height &&
        tx.tip.hash === control.chain.tip.hash &&
        before.status !== "confirmed"
      ) {
        next.status = "failed-safe";
        await this.store.record(
          session,
          "execution",
          "verified-fixture-invalidity",
          id,
          tx.evidence,
        );
      } else {
        next.status = tx.state === "pending" ? "submitted" : "ambiguous";
      }
      if (
        next.status !== row.status ||
        next.confirmation?.hash !== row.confirmation?.hash
      ) {
        await this.save(session, next);
      }
    });
  }
}
