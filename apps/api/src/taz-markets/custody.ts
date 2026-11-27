import { createHmac, timingSafeEqual } from "node:crypto";
import {
  digest,
  hex,
  integer,
  NETWORK,
  requireThat,
  sum,
  type Block,
  type Deposit,
  type Obligation,
  type Plan,
  type Scan,
  type Signed,
} from "./model.js";

export type TxObservation =
  | { state: "included"; block: Block; tip: Block }
  | { state: "pending" | "unknown" }
  | { state: "absent-valid"; tip: Block; evidence: string }
  | { state: "invalid"; tip: Block; verifiedAbsent: true; evidence: string };

export interface CustodyReader {
  scan(): Promise<Scan>;
}
export interface CustodyExecution {
  prepare(plan: Plan): Promise<Plan>;
  inspect(prepared: Plan): Promise<Plan>;
  sign(
    prepared: Plan,
    approval: NonNullable<Obligation["approval"]>,
  ): Promise<Signed>;
  submit(signed: Signed): Promise<void>;
  observe(txid: string): Promise<TxObservation>;
}

export type FixtureTransport = CustodyReader &
  Pick<CustodyExecution, "submit" | "observe"> & {
    prepare?: CustodyExecution["prepare"];
    inspect?: CustodyExecution["inspect"];
  };

// This produces an HMAC receipt, with no Zcash transaction bytes or spending key.
export class FixtureCustody implements CustodyReader, CustodyExecution {
  constructor(
    readonly walletId: string,
    readonly recipient: string,
    readonly change: string,
    private operatorToken: string,
    private transport: FixtureTransport,
  ) {
    requireThat(
      operatorToken.length >= 32 &&
        walletId &&
        /^fixture-utest-[a-z0-9-]+$/.test(recipient) &&
        /^fixture-utest-[a-z0-9-]+$/.test(change) &&
        change !== recipient,
      "Invalid fixture custody configuration",
    );
  }

  assertOperator(token: string) {
    const expected = Buffer.from(digest(this.operatorToken), "hex");
    const actual = Buffer.from(digest(token), "hex");
    requireThat(
      timingSafeEqual(expected, actual),
      "Separate fixture operator authorization required",
    );
    return "fixture-operator";
  }

  private mac(domain: string, value: string) {
    return createHmac("sha256", this.operatorToken)
      .update(JSON.stringify([domain, value]))
      .digest("hex");
  }

  approve(planDigest: string, token: string) {
    const actor = this.assertOperator(token);
    return {
      actor,
      digest: planDigest,
      receipt: this.mac("approval", planDigest),
    };
  }

  reviewAddress(address: string) {
    requireThat(
      /^fixture-utest-[a-z0-9-]{1,64}$/.test(address) &&
        address !== this.recipient &&
        address !== this.change,
      "Invalid fixture destination",
    );
  }

  scan() {
    return this.transport.scan();
  }
  async prepare(plan: Plan) {
    return this.transport.prepare?.(plan) ?? plan;
  }
  async inspect(plan: Plan) {
    return this.transport.inspect?.(plan) ?? plan;
  }
  observe(txid: string) {
    return this.transport.observe(txid);
  }
  submit(signed: Signed) {
    return this.transport.submit(signed);
  }

  async sign(plan: Plan, approval: NonNullable<Obligation["approval"]>) {
    requireThat(
      approval.actor === "fixture-operator" &&
        approval.digest === digest(plan) &&
        hex(approval.receipt) &&
        timingSafeEqual(
          Buffer.from(approval.receipt, "hex"),
          Buffer.from(this.mac("approval", approval.digest), "hex"),
        ),
      "Unapproved fixture plan",
    );
    const artifact = this.mac("signed-fixture", approval.digest);
    return { txid: digest(["fixture", artifact]), artifact };
  }
}

export function validatePlan(
  plan: Plan,
  obligation: Obligation,
  inputs: Deposit[],
  walletId: string,
  change: string,
  maxFee: number,
) {
  requireThat(
    plan.obligationId === obligation._id &&
      plan.network === NETWORK &&
      plan.walletId === walletId &&
      plan.recipient === obligation.destination &&
      plan.amount === obligation.amount &&
      integer(plan.fee) &&
      plan.fee > 0 &&
      plan.fee <= maxFee,
    "Invalid payment or fee",
  );
  const ids = new Set(plan.inputs);
  requireThat(
    ids.size === plan.inputs.length &&
      inputs.length === ids.size &&
      inputs.every((input) => ids.has(input._id) && input.note.spendable) &&
      obligation.sources.every((id) => ids.has(id)),
    "Invalid payment inputs",
  );
  const principal = inputs.filter((input) =>
    obligation.sources.includes(input._id),
  );
  const fees = inputs.filter(
    (input) => !obligation.sources.includes(input._id),
  );
  requireThat(
    principal.every((input) => input.status === "qualified") &&
      sum(principal.map((d) => d.note.amount)) === obligation.amount &&
      fees.every((input) => input.status === "reserve"),
    "Principal and fees must be separate",
  );
  const remainder = sum(fees.map((d) => d.note.amount)) - plan.fee;
  requireThat(
    remainder >= 0 &&
      (remainder === 0
        ? plan.change === null
        : plan.change?.recipient === change &&
          plan.change.amount === remainder),
    "Invalid fee change",
  );
}

export function validateSigned(value: Signed) {
  requireThat(
    hex(value.artifact) && value.txid === digest(["fixture", value.artifact]),
    "Invalid fixture receipt",
  );
}
