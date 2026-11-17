import { randomUUID, randomBytes, createPublicKey, verify } from "node:crypto";
import {
  agreement,
  marketInput,
  acceptanceMessage,
  botSide,
  type Market,
  type Session,
  type Side,
  type Round,
} from "@zyro/shared";
import { hash } from "./policy.js";
import { Store } from "./store.js";
import { z } from "zod";
export class Fault extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export class Engine {
  constructor(public store: Store) {}
  async session(id?: string) {
    const existing = id ? await this.store.get<Session>(id) : undefined;
    if (existing) return existing;
    const s = {
      id: id || randomBytes(32).toString("hex"),
      credits: 1000,
      createdAt: new Date().toISOString(),
    };
    await this.store.put(s.id, "session", s);
    return s;
  }
  async markets() {
    return this.store.atomic(async (tx) => {
      const markets = await tx.list<Market>("market");
      for (const m of markets)
        if (
          m.status === "OPEN" &&
          Date.parse(m.fundingDeadline) <= Date.now()
        ) {
          m.status = "CANCELLED";
          await tx.put(m.id, "market", m);
        }
      return markets.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    });
  }
  async create(userId: string, data: unknown) {
    const input = marketInput.parse(data);
    const m: Market = {
      ...input,
      network: z
        .enum(["testnet", "regtest"])
        .parse(process.env.ZCASH_NETWORK || "testnet"),
      id: randomUUID(),
      creator: userId,
      createdAt: new Date().toISOString(),
      status: "OPEN",
      participants: [],
      agreementHash: "",
    };
    m.agreementHash = hash(agreement(m));
    await this.store.put(m.id, "market", m);
    return m;
  }
  async join(
    userId: string,
    id: string,
    side: Side,
    publicKey: string,
    signature: string,
  ) {
    return this.store.atomic(async (tx) => {
      const m = await tx.get<Market>(id);
      if (!m) throw new Fault("Challenge not found", 404);
      if (m.example)
        throw new Fault("Example challenge: create your own to participate");
      if (m.status !== "OPEN" || Date.parse(m.fundingDeadline) <= Date.now())
        throw new Fault("Challenge is closed", 409);
      if (
        m.participants.some(
          (p) =>
            p.userId === userId || p.publicKey === publicKey || p.side === side,
        )
      )
        throw new Fault("Already participating or outcome occupied", 409);
      let valid = false;
      try {
        const key = createPublicKey({
          key: Buffer.from(publicKey, "base64"),
          format: "der",
          type: "spki",
        });
        valid = verify(
          null,
          Buffer.from(acceptanceMessage(m.agreementHash, userId, side)),
          key,
          Buffer.from(signature, "base64"),
        );
        valid = valid && key.asymmetricKeyType === "ed25519";
      } catch {
        /* invalid keys fail closed */
      }
      if (!valid) throw new Fault("Invalid acceptance signature");
      m.participants.push({ userId, side, publicKey, signature });
      if (m.participants.length === 2) m.status = "MATCHED";
      await tx.put(id, "market", m);
      return m;
    });
  }
  async predict(userId: string, side: Side, stake: number) {
    z.object({
      side: z.enum(["YES", "NO"]),
      stake: z.number().int().min(10).max(100),
    }).parse({ side, stake });
    return this.store.atomic(async (tx) => {
      const s = await tx.get<Session>(userId);
      if (!s || s.credits < stake)
        throw new Fault("Not enough practice credits", 409);
      const history = (await tx.list<Round>("round")).filter(
        (r) => r.userId === userId,
      );
      if (history.some((r) => r.status === "PENDING"))
        throw new Fault("Resolve your current round first", 409);
      const secret = randomBytes(32).toString("hex");
      const draw = parseInt(hash(secret).slice(0, 8), 16) % 100;
      const r: Round = {
        id: randomUUID(),
        userId,
        side,
        botSide: botSide(
          history.filter((r) => r.status === "RESOLVED").map((r) => r.draw),
        ),
        stake,
        draw,
        secret,
        commitment: hash(secret),
        status: "PENDING",
        createdAt: new Date().toISOString(),
        resolveAt: new Date(Date.now() + 5000).toISOString(),
      };
      s.credits -= stake;
      await tx.put(s.id, "session", s);
      await tx.put(r.id, "round", r);
      return this.publicRound(r);
    });
  }
  publicRound(r: Round) {
    if (r.status === "RESOLVED") return r;
    const { secret: _secret, draw: _draw, ...visible } = r;
    return visible;
  }
  async resolve(userId: string, id: string) {
    return this.store.atomic(async (tx) => {
      const r = await tx.get<Round>(id);
      if (!r || r.userId !== userId) throw new Fault("Round not found", 404);
      if (r.status === "RESOLVED") return r;
      if (Date.now() < Date.parse(r.resolveAt))
        throw new Fault("Round is still running", 409);
      const s = (await tx.get<Session>(userId))!;
      r.outcome = r.draw >= 50 ? "YES" : "NO";
      r.status = "RESOLVED";
      r.payout = r.side === r.outcome ? r.stake * 2 : 0;
      s.credits += r.payout;
      await tx.put(s.id, "session", s);
      await tx.put(r.id, "round", r);
      return r;
    });
  }
  async arena(userId: string) {
    const rounds = (await this.store.list<Round>("round"))
      .filter((r) => r.userId === userId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const resolved = rounds.filter((r) => r.status === "RESOLVED");
    return {
      session: await this.store.get<Session>(userId),
      rounds: rounds.map((r) => this.publicRound(r)),
      stats: {
        played: resolved.length,
        wins: resolved.filter((r) => r.side === r.outcome).length,
        net: resolved.reduce((n, r) => n + (r.payout || 0) - r.stake, 0),
      },
    };
  }
  async seed() {
    if ((await this.store.list<Market>("market")).length) return;
    const samples = [
      [
        "Will the next Zcash network upgrade activate before December 31?",
        "Zcash",
      ],
      ["Will a reusable rocket complete 10 launches in December?", "Science"],
      [
        "Will an open-source AI model lead the year-end benchmark?",
        "Technology",
      ],
      ["Will Zcash publish a new wallet release before December 15?", "Zcash"],
      ["Will the next lunar mission launch on schedule?", "Science"],
      ["Will a documentary win the audience choice award?", "Culture"],
    ];
    for (const [question, category] of samples) {
      const m = await this.create("example", {
        question,
        category,
        description:
          "An example challenge showing how clear, fixed-stake predictions work. This listing is illustrative and cannot accept participation. Create a challenge with your own precise conditions.",
        stake: 10000000,
        fundingDeadline: "2026-12-01T12:00:00.000Z",
        resolutionDeadline: "2027-01-01T12:00:00.000Z",
        source: "https://z.cash/",
        rules:
          "Example only. Real challenges must name the exact official announcement, observation time, and fallback conditions.",
      });
      m.example = true;
      await this.store.put(m.id, "market", m);
    }
  }
}
