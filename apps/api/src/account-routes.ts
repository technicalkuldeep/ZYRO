import {
  Router,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { OAuth2Client, CodeChallengeMethod } from "google-auth-library";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { Accounts, type User, type Identity } from "./accounts.js";
import { Fault } from "./engine.js";
import { hash } from "./policy.js";
import { rateLimit } from "express-rate-limit";
import { arenaServices } from "./arena-services.js";
import {
  gameDefinitions,
  categories,
} from "../../../packages/shared/src/arena-games.js";
import { pairs, type Pair } from "./price-provider.js";

export function cookie(req: Request, name: string) {
  return req.headers.cookie
    ?.split(";")
    .map((v) => v.trim())
    .find((v) => v.startsWith(name + "="))
    ?.slice(name.length + 1);
}
const options = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
};
const operation = z.string().uuid();
export function accountRoutes(
  getAccounts: () => Promise<Accounts>,
  verify?: (code: string, verifier: string, nonce: string) => Promise<Identity>,
) {
  const router = Router();
  router.use(
    "/auth/google",
    rateLimit({
      windowMs: 15 * 60000,
      limit: 30,
      standardHeaders: "draft-8",
      legacyHeaders: false,
    }),
  );
  router.post(
    "/admin/users/:id/grants",
    rateLimit({
      windowMs: 60000,
      limit: 30,
      standardHeaders: "draft-8",
      legacyHeaders: false,
    }),
  );
  const google = () => {
    if (
      !process.env.GOOGLE_CLIENT_ID ||
      !process.env.GOOGLE_CLIENT_SECRET ||
      !process.env.GOOGLE_REDIRECT_URI
    )
      throw new Fault("Google sign-in is not configured", 503);
    return new OAuth2Client(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI,
    );
  };
  router.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  router.get("/auth/google", async (req, res) => {
    const db = await getAccounts();
    const client = google();
    const state = randomBytes(32).toString("hex");
    const nonce = randomBytes(32).toString("hex");
    const { codeVerifier, codeChallenge } =
      await client.generateCodeVerifierAsync();
    const requested =
      typeof req.query.returnTo === "string" ? req.query.returnTo : "/arena";
    const returnTo =
      /^\/(arena(?:\/[a-z0-9-]+)*|choose|admin(?:\/users(?:\/[a-z0-9-]+)?)?|admin\/audit)$/.test(
        requested,
      )
        ? requested
        : "/arena";
    await db.sessions().insertOne({
      _id: hash(state),
      kind: "oauth",
      expiresAt: new Date(Date.now() + 600000),
      nonce,
      verifier: codeVerifier,
      returnTo,
    });
    res.cookie("zyro_oauth", state, { ...options, maxAge: 600000 });
    res.redirect(
      client.generateAuthUrl({
        scope: ["openid", "email", "profile"],
        state,
        nonce,
        code_challenge: codeChallenge,
        code_challenge_method: CodeChallengeMethod.S256,
        access_type: "online",
        prompt: "select_account",
      }),
    );
  });
  router.get("/auth/google/callback", async (req, res) => {
    const db = await getAccounts();
    const state = typeof req.query.state === "string" ? req.query.state : "";
    if (!state || state !== cookie(req, "zyro_oauth"))
      throw new Fault("Invalid OAuth state. Start sign-in again.", 400);
    const attempt = await db.sessions().findOneAndDelete({
      _id: hash(state),
      kind: "oauth",
      expiresAt: { $gt: new Date() },
    });
    res.clearCookie("zyro_oauth", options);
    if (!attempt?.nonce || !attempt.verifier)
      throw new Fault("Sign-in expired or already used", 400);
    if (req.query.error || typeof req.query.code !== "string")
      return res.redirect("/signin?error=cancelled");
    try {
      let identity: Identity;
      if (verify)
        identity = await verify(
          req.query.code,
          attempt.verifier,
          attempt.nonce,
        );
      else {
        const client = google();
        const { tokens } = await client.getToken({
          code: req.query.code,
          codeVerifier: attempt.verifier,
        });
        if (!tokens.id_token) throw new Error("Missing identity token");
        const ticket = await client.verifyIdToken({
          idToken: tokens.id_token,
          audience: process.env.GOOGLE_CLIENT_ID,
        });
        const p = ticket.getPayload();
        if (
          !p?.sub ||
          !p.email ||
          (p as unknown as { nonce: string }).nonce !== attempt.nonce
        )
          throw new Error("Invalid identity claims");
        identity = {
          sub: p.sub,
          email: p.email,
          emailVerified: p.email_verified === true,
          name: (p.name || "Forecaster").slice(0, 100),
          ...(p.picture &&
          /^https:\/\/[^/]+\.googleusercontent\.com\//.test(p.picture)
            ? { avatar: p.picture }
            : {}),
        };
      }
      const { user, fresh } = await db.login(identity);
      const previous = cookie(req, "zyro_account");
      if (previous)
        await db.sessions().deleteOne({ _id: hash(previous), kind: "account" });
      res.cookie("zyro_account", await db.newSession(user._id), {
        ...options,
        maxAge: 7 * 86400000,
      });
      res.redirect(fresh ? "/choose" : attempt.returnTo || "/arena");
    } catch (e) {
      // Do not log OAuth codes, tokens, provider payloads, or driver error messages.
      if (e instanceof Fault) throw e;
      res.redirect("/signin?error=verification");
    }
  });
  router.get("/auth/me", async (req, res) => {
    const db = await getAccounts();
    const user = await db.current(cookie(req, "zyro_account"));
    if (!user) return res.json({ user: null });
    res.json({
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        avatar: user.avatar,
        createdAt: user.createdAt,
        admin: await db.isAdmin(user),
      },
      account: await db.accounts().findOne({ _id: user._id }),
    });
  });
  router.post("/auth/logout", async (req, res) => {
    const db = await getAccounts();
    const token = cookie(req, "zyro_account");
    if (token)
      await db.sessions().deleteOne({ _id: hash(token), kind: "account" });
    res.clearCookie("zyro_account", options);
    res.json({ ok: true });
  });
  const authenticated = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    const db = await getAccounts();
    const user = await db.current(cookie(req, "zyro_account"));
    if (!user) throw new Fault("Sign in with Google to enter Arena", 401);
    res.locals.accountUser = user;
    next();
  };
  router.get("/account/leaderboard", async (_req, res) =>
    res.json(await (await getAccounts()).leaderboard()),
  );
  router.use("/account", authenticated);
  router.get("/account/discovery", async (_req, res) => {
    const services = await arenaServices(await getAccounts());
    const markets = await services.crypto.list();
    res.json({
      games: gameDefinitions,
      categories: categories.map((name) => ({
        name,
        count:
          name === "All"
            ? gameDefinitions.length +
              markets.filter(
                (m) =>
                  m.status === "OPEN" &&
                  !m.disabled &&
                  m.spec.cutoff > Date.now(),
              ).length
            : name === "Quick Predictions"
              ? gameDefinitions.filter((g) => g.type === "quick").length
              : name === "Challenge the Bot"
                ? gameDefinitions.filter((g) => g.type === "bot").length
                : name === "Crypto"
                  ? markets.filter(
                      (m) =>
                        m.status === "OPEN" &&
                        !m.disabled &&
                        m.spec.cutoff > Date.now(),
                    ).length
                  : 0,
      })),
      markets,
    });
  });
  router.post("/account/games/:key/prepare", async (req, res) => {
    const b = z
      .object({ operation: z.string().uuid() })
      .strict()
      .parse(req.body);
    res.json(
      await (
        await arenaServices(await getAccounts())
      ).games.prepare(res.locals.accountUser._id, req.params.key, b.operation),
    );
  });
  router.post("/account/games/enter", async (req, res) =>
    res.json(
      await (
        await arenaServices(await getAccounts())
      ).games.enter(res.locals.accountUser._id, req.body),
    ),
  );
  router.get("/account/prices/:pair", async (req, res) => {
    const pair = z.enum(pairs).parse(req.params.pair);
    const candles = await (
      await arenaServices(await getAccounts())
    ).crypto.provider.candles(pair as Pair);
    res.json({
      pair,
      source: "Coinbase Exchange",
      granularity: 60,
      fetchedAt: (
        await arenaServices(await getAccounts())
      ).crypto.provider.fetchedAt(pair),
      candles: candles.slice(-90),
    });
  });
  router.get("/account/crypto/:id", async (req, res) => {
    const s = await arenaServices(await getAccounts());
    const market = await s.crypto.markets().findOne({ _id: req.params.id });
    if (!market) throw new Fault("Market not found", 404);
    res.json(market);
  });
  router.post("/account/crypto/:id/predict", async (req, res) =>
    res.json(
      await (
        await arenaServices(await getAccounts())
      ).crypto.enter(res.locals.accountUser._id, req.params.id, req.body),
    ),
  );
  router.get("/account/arena", async (_req, res) =>
    res.json(await (await getAccounts()).arena(res.locals.accountUser._id)),
  );
  router.post("/account/arena/predict", async (req, res) => {
    const b = z
      .object({
        side: z.enum(["YES", "NO"]),
        stake: z.number().int().min(10).max(100),
        operation,
      })
      .strict()
      .parse(req.body);
    res
      .status(201)
      .json(
        await (
          await getAccounts()
        ).predict(res.locals.accountUser._id, b.side, b.stake, b.operation),
      );
  });
  router.post("/account/arena/:id/resolve", async (req, res) => {
    z.object({}).strict().parse(req.body);
    res.json(
      await (
        await arenaServices(await getAccounts())
      ).games.reveal(
        res.locals.accountUser._id,
        z.string().uuid().parse(req.params.id),
      ),
    );
  });
  router.post("/account/arena/:id/cancel", async (req, res) => {
    z.object({}).strict().parse(req.body);
    res.json(
      await (
        await getAccounts()
      ).cancel(
        res.locals.accountUser._id,
        z.string().uuid().parse(req.params.id),
      ),
    );
  });
  router.use("/admin", authenticated, async (_req, res, next) => {
    if (!(await (await getAccounts()).isAdmin(res.locals.accountUser as User)))
      throw new Fault("Administrator access required", 403);
    next();
  });
  router.get("/admin", async (_req, res) =>
    res.json(await (await getAccounts()).overview()),
  );
  router.get("/admin/arena", async (_req, res) => {
    const a = await getAccounts(),
      s = await arenaServices(a);
    res.json({
      definitions: gameDefinitions,
      totals: {
        resolved: await s.crypto
          .markets()
          .countDocuments({ status: "RESOLVED" }),
        awaiting: await s.crypto
          .markets()
          .countDocuments({ status: "PENDING_VERIFICATION" }),
        pending: await s.crypto.markets().countDocuments({ status: "OPEN" }),
      },
      games: await a
        .rounds()
        .aggregate([
          {
            $group: {
              _id: { $ifNull: ["$gameKey", "quick-draw-legacy"] },
              rounds: { $sum: 1 },
              pending: {
                $sum: { $cond: [{ $eq: ["$status", "PENDING"] }, 1, 0] },
              },
              payouts: { $sum: "$payout" },
            },
          },
        ])
        .toArray(),
      markets: await s.crypto.list(),
      attempts: await s.crypto
        .attempts()
        .find()
        .sort({ at: -1 })
        .limit(50)
        .toArray(),
      errors: await a.db
        .collection("arena_game_errors")
        .find()
        .sort({ at: -1 })
        .limit(30)
        .toArray(),
      audit: await a.db
        .collection("arena_content_audit")
        .find()
        .sort({ at: -1 })
        .limit(30)
        .toArray(),
    });
  });
  router.post("/admin/arena/:id/disable", async (req, res) => {
    const b = z
      .object({
        reason: z.string().trim().min(5).max(500),
        operation: z.string().uuid(),
      })
      .strict()
      .parse(req.body);
    res.json(
      await (
        await arenaServices(await getAccounts())
      ).crypto.disable(
        res.locals.accountUser,
        req.params.id,
        b.reason,
        b.operation,
      ),
    );
  });
  router.get("/admin/users", async (req, res) => {
    const q = z
      .object({
        search: z.string().max(100).default(""),
        page: z.coerce.number().int().min(1).max(100000).default(1),
        sort: z.enum(["recent", "name"]).default("recent"),
      })
      .parse(req.query);
    res.json(await (await getAccounts()).directory(q.search, q.page, q.sort));
  });
  router.get("/admin/audit", async (_req, res) =>
    res.json(
      await (
        await getAccounts()
      )
        .audits()
        .find()
        .sort({ createdAt: -1 })
        .limit(100)
        .toArray(),
    ),
  );
  router.get("/admin/users/:id", async (req, res) => {
    const db = await getAccounts();
    const id = z.string().uuid().parse(req.params.id);
    const user = await db.users().findOne({ _id: id });
    if (!user) throw new Fault("User not found", 404);
    res.json({
      user,
      ...(await db.arena(id)),
      adjustments: await db
        .audits()
        .find({ userId: id })
        .sort({ createdAt: -1 })
        .limit(100)
        .toArray(),
    });
  });
  router.post("/admin/users/:id/grants", async (req, res) => {
    const b = z
      .object({
        amount: z
          .number()
          .int()
          .positive()
          .max(
            Math.min(1000000, Number(process.env.ADMIN_GRANT_LIMIT) || 10000),
          ),
        reason: z.string().trim().min(5).max(500),
        operation,
      })
      .strict()
      .parse(req.body);
    res.json(
      await (
        await getAccounts()
      ).grant(
        res.locals.accountUser,
        z.string().uuid().parse(req.params.id),
        b.amount,
        b.reason,
        b.operation,
      ),
    );
  });
  router.use(
    async (error: unknown, req: Request, res: Response, next: NextFunction) => {
      if (/^\/account\/(games|arena|crypto)/.test(req.path)) {
        try {
          const a = await getAccounts();
          await a.db.collection("arena_game_errors").insertOne({
            at: new Date(),
            userId: res.locals.accountUser?._id,
            type: error instanceof Error ? error.name : "Error",
            message:
              error instanceof Fault
                ? error.message
                : "Game request rejected or unavailable",
          });
        } catch {
          /* Account failures must preserve the original error. */
        }
      }
      next(error);
    },
  );
  return router;
}
