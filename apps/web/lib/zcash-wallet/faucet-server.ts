import { z } from "zod";
const integer = z.number().int().safe().nonnegative();
export const claimInput = z
  .object({
    network: z.literal("testnet"),
    address: z
      .string()
      .regex(/^utest1[023456789acdefghjklmnpqrstuvwxyz]{40,500}$/),
    request_id: z.string().uuid(),
  })
  .strict();
export const claimResult = z.object({
  request_id: z.string().min(1).max(128),
  network: z.literal("testnet"),
  state: z.enum(["pending", "broadcasting", "confirmed", "failed"]),
  outcome: z.enum(["accepted", "refused", "failed"]).optional(),
  txid: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .optional(),
  next_eligible_at_ms: integer.optional(),
  error_code: z.string().max(100).optional(),
  confirmed_height: integer.optional(),
});
const networkResult = z.object({
  network: z.literal("testnet"),
  drip_zat: integer,
  address_cooldown_hours: integer,
  captcha_mode: z.enum(["local_test", "turnstile", "bearer"]),
  launch_phase: z.enum(["launch_blocked", "open"]),
});
const failures = z.object({
  error_code: z.string().max(100),
  request_id: z.string().max(128).optional(),
  next_eligible_at_ms: integer.optional(),
});
const windows = new Map<string, { count: number; end: number }>();
function limited(key: string, maximum: number) {
  const now = Date.now();
  if (windows.size > 2000)
    for (const [k, value] of windows) if (value.end < now) windows.delete(k);
  const value = windows.get(key);
  if (!value || value.end <= now) {
    windows.set(key, { count: 1, end: now + 60000 });
    return false;
  }
  return ++value.count > maximum;
}
function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
async function boundedText(
  body: ReadableStream<Uint8Array> | null,
  limit: number,
) {
  if (!body) return "";
  const reader = body.getReader(),
    chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > limit) {
        await reader.cancel();
        throw Error("Body limit exceeded");
      }
      chunks.push(next.value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new TextDecoder().decode(bytes);
  } finally {
    reader.releaseLock();
  }
}
// Only public faucet operations cross this boundary. No cookies, authorization,
// memo, wallet database, password or key is accepted or forwarded.
export async function faucetProxy(
  request: Request,
  action: string[],
  transport: typeof fetch = fetch,
) {
  try {
    const claim =
      action.length === 1 && action[0] === "claim" && request.method === "POST";
    const network =
      action.length === 1 &&
      action[0] === "network" &&
      request.method === "GET";
    const status =
      action.length === 2 &&
      action[0] === "status" &&
      /^[a-zA-Z0-9_-]{1,128}$/.test(action[1]) &&
      request.method === "GET";
    if (!claim && !network && !status)
      return json({ error_code: "not_found" }, 404);
    if (limited(claim ? "claims" : "reads", claim ? 10 : 240))
      return json({ error_code: "rate_limited" }, 429);
    let body;
    if (claim) {
      // Next's internal rewrite may use localhost in request.url. Compare the
      // browser Origin with the original Host header, never an arbitrary URL.
      const origin = request.headers.get("origin");
      const host = request.headers.get("host") || new URL(request.url).host;
      let sameOrigin = false;
      try {
        const parsed = new URL(origin || "");
        sameOrigin =
          parsed.host === host && ["https:", "http:"].includes(parsed.protocol);
      } catch {
        /* Reject malformed origins. */
      }
      if (!sameOrigin || request.headers.get("x-zyro-wallet") !== "testnet")
        return json({ error_code: "origin_rejected" }, 403);
      if (!request.headers.get("content-type")?.startsWith("application/json"))
        return json({ error_code: "malformed_request" }, 400);
      let input;
      try {
        input = JSON.parse(await boundedText(request.body, 2048));
      } catch {
        return json({ error_code: "malformed_request" }, 400);
      }
      const parsed = claimInput.safeParse(input);
      if (!parsed.success)
        return json({ error_code: "malformed_request" }, 400);
      body = parsed.data;
      if (limited(`address:${body.address}`, 1))
        return json({ error_code: "rate_limited" }, 429);
    }
    const path = claim
      ? "claim"
      : network
        ? "network"
        : `status/testnet/${encodeURIComponent(action[1])}`;
    const response = await transport(`https://fauzec.com/api/v1/${path}`, {
      method: claim ? "POST" : "GET",
      headers: {
        Accept: "application/json",
        ...(claim ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
    const text = await boundedText(response.body, 32768);
    if (text.length > 32768)
      return json(
        {
          error_code: claim ? "submission_ambiguous" : "runtime_unavailable",
          request_id: body?.request_id,
        },
        502,
      );
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      return json(
        {
          error_code: claim ? "submission_ambiguous" : "runtime_unavailable",
          request_id: body?.request_id,
        },
        502,
      );
    }
    if (!response.ok) {
      const failure = failures.safeParse(payload);
      return json(
        failure.success
          ? failure.data
          : {
              error_code:
                response.status === 429
                  ? "rate_limited"
                  : "runtime_unavailable",
              request_id: body?.request_id,
            },
        [400, 403, 404, 409, 429, 503].includes(response.status)
          ? response.status
          : 502,
      );
    }
    const parsed = (network ? networkResult : claimResult).safeParse(payload);
    if (!parsed.success)
      return json(
        {
          error_code: claim ? "submission_ambiguous" : "invalid_response",
          request_id: body?.request_id,
        },
        502,
      );
    if (
      !network &&
      "request_id" in parsed.data &&
      parsed.data.request_id !== (body?.request_id || action[1])
    )
      return json(
        {
          error_code: "request_identity_mismatch",
          request_id: body?.request_id,
        },
        502,
      );
    return json(parsed.data, response.status);
  } catch {
    return json(
      {
        error_code:
          request.method === "POST"
            ? "submission_ambiguous"
            : "runtime_unavailable",
      },
      503,
    );
  }
}
