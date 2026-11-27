import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

const methods = {
  zebra: [
    "getinfo",
    "getblockchaininfo",
    "getblockhash",
    "getblock",
    "getrawtransaction",
  ],
  zallet: [
    "getwalletstatus",
    "z_listaccounts",
    "z_listtransactions",
    "z_listunspent",
    "z_viewtransaction",
    "getrawtransaction",
    "rpc.discover",
  ],
} as const;
type Service = keyof typeof methods;

export class ObservationRpc<S extends Service> {
  readonly #url: URL;
  constructor(
    readonly service: S,
    endpoint: string,
    private readonly cookieFile: string,
    private readonly transport = fetch,
  ) {
    this.#url = new URL(endpoint);
    if (
      this.#url.protocol !== "http:" ||
      this.#url.hostname !== "127.0.0.1" ||
      !this.#url.port ||
      this.#url.username ||
      this.#url.password ||
      this.#url.pathname !== "/" ||
      this.#url.search ||
      this.#url.hash ||
      !cookieFile
    ) {
      throw new Error(
        "Custody RPC requires an explicit IPv4 loopback endpoint and cookie file",
      );
    }
  }

  async call(method: (typeof methods)[S][number], params: unknown[] = []) {
    if (!(methods[this.service] as readonly string[]).includes(method)) {
      throw new Error("Custody observation RPC method denied");
    }
    const id = randomUUID();
    let unauthorized = false;
    try {
      const cookie = (await readFile(this.cookieFile, "utf8")).trimEnd();
      if (!/^[^:\s]+:[^\s]+$/.test(cookie) || cookie.length > 512)
        throw new Error();
      const response = await this.transport(this.#url, {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
        headers: {
          "content-type": "application/json",
          authorization: "Basic " + Buffer.from(cookie).toString("base64"),
        },
        body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
      });
      unauthorized = response.status === 401 || response.status === 403;
      if (!response.ok || !response.body) throw new Error();
      const chunks: Uint8Array[] = [];
      let length = 0;
      for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
        length += chunk.byteLength;
        if (length > 12 * 1024 * 1024) throw new Error();
        chunks.push(chunk);
      }
      const result = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (
        result.id !== id ||
        result.error != null ||
        !Object.hasOwn(result, "result")
      )
        throw new Error();
      return result.result as unknown;
    } catch {
      throw new Error(
        unauthorized
          ? this.service + " observation RPC authentication rejected"
          : this.service + " observation RPC unavailable at " + method,
      );
    }
  }
}
