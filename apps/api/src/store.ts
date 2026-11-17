import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { records } from "./schema.js";
import { eq } from "drizzle-orm";
export class Store {
  private sqlite?: DatabaseSync;
  private pool?: pg.Pool;
  constructor(path = "data/zyro.sqlite", url = process.env.DATABASE_URL) {
    if (url) {
      this.pool = new pg.Pool({ connectionString: url, max: 5 });
    } else {
      mkdirSync("data", { recursive: true });
      this.sqlite = new DatabaseSync(path);
      this.sqlite.exec(
        "PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS records (id TEXT PRIMARY KEY, kind TEXT NOT NULL, body TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 0)",
      );
    }
  }
  async init() {
    if (this.pool)
      await this.pool.query(
        "CREATE TABLE IF NOT EXISTS records (id TEXT PRIMARY KEY, kind TEXT NOT NULL, body JSONB NOT NULL, version INTEGER NOT NULL DEFAULT 0)",
      );
    if (this.pool)
      await this.pool.query(
        "CREATE INDEX IF NOT EXISTS records_kind_idx ON records(kind)",
      );
    else
      this.sqlite!.exec(
        "CREATE INDEX IF NOT EXISTS records_kind_idx ON records(kind)",
      );
  }
  async get<T>(id: string): Promise<T | undefined> {
    if (this.pool) {
      const r = await drizzle(this.pool)
        .select()
        .from(records)
        .where(eq(records.id, id));
      return r[0]?.body as T | undefined;
    }
    const r = this.sqlite!.prepare("SELECT body FROM records WHERE id=?").get(
      id,
    );
    return r ? JSON.parse(r.body as string) : undefined;
  }
  async list<T>(kind: string): Promise<T[]> {
    if (this.pool) {
      return (
        await drizzle(this.pool)
          .select()
          .from(records)
          .where(eq(records.kind, kind))
      ).map((r) => r.body as T);
    }
    return this.sqlite!.prepare("SELECT body FROM records WHERE kind=?")
      .all(kind)
      .map((r) => JSON.parse(r.body as string));
  }
  async put(id: string, kind: string, body: unknown) {
    const data = JSON.stringify(body);
    if (this.pool) {
      await this.pool.query(
        "INSERT INTO records(id,kind,body) VALUES($1,$2,$3) ON CONFLICT(id) DO UPDATE SET body=excluded.body,version=records.version+1",
        [id, kind, data],
      );
    } else
      this.sqlite!.prepare(
        "INSERT INTO records(id,kind,body) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body,version=records.version+1",
      ).run(id, kind, data);
  }
  // Single dedicated DB connection and cross-process advisory lock make ledger mutations atomic.
  private tail: Promise<unknown> = Promise.resolve();
  async atomic<T>(fn: (tx: Store) => Promise<T>): Promise<T> {
    const run = this.tail.then(async () => {
      if (this.pool) {
        const client = await this.pool.connect();
        const tx = Object.create(this) as Store;
        tx.pool = client as unknown as pg.Pool;
        try {
          await client.query("BEGIN");
          await client.query("SELECT pg_advisory_xact_lock(5639021)");
          const result = await fn(tx);
          await client.query("COMMIT");
          return result;
        } catch (e) {
          await client.query("ROLLBACK");
          throw e;
        } finally {
          client.release();
        }
      }
      this.sqlite!.exec("BEGIN IMMEDIATE");
      try {
        const result = await fn(this);
        this.sqlite!.exec("COMMIT");
        return result;
      } catch (e) {
        this.sqlite!.exec("ROLLBACK");
        throw e;
      }
    });
    this.tail = run.catch(() => {});
    return run;
  }
  async close() {
    this.sqlite?.close();
    await this.pool?.end();
  }
}
