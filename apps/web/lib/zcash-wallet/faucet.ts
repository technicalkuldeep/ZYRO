export type Claim = {
  request_id: string;
  network: "testnet";
  state?: "pending" | "broadcasting" | "confirmed" | "failed";
  txid?: string;
  next_eligible_at_ms?: number;
  error_code?: string;
  ambiguous?: boolean;
};
export const claimKey = (address: string) => `zyro:testnet:fauzec:${address}`;
const base = "/api/zcash/testnet/faucet/";
export async function faucetRequest(action: string, body?: unknown) {
  const response = await fetch(base + action, {
    method: body ? "POST" : "GET",
    credentials: "omit",
    cache: "no-store",
    signal: AbortSignal.timeout(20000),
    headers: body
      ? { "Content-Type": "application/json", "x-zyro-wallet": "testnet" }
      : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const result = await response.json();
  if (!response.ok) {
    const error = new Error(
      result.error_code || "runtime_unavailable",
    ) as Error & { result: Claim };
    error.result = result;
    throw error;
  }
  return result;
}
export async function submitClaim(
  address: string,
  save: (claim: Claim) => void,
): Promise<Claim> {
  const existing = localStorage.getItem(claimKey(address));
  if (existing)
    throw Error(
      "An earlier faucet request exists. Resume its status instead of claiming again.",
    );
  const pending: Claim = {
    request_id: crypto.randomUUID(),
    network: "testnet",
    ambiguous: true,
  };
  // The caller's request ID is persisted before network activity and sent to
  // Fauzec for reconciliation. Never automatically retry a claim POST.
  localStorage.setItem(claimKey(address), JSON.stringify(pending));
  save(pending);
  try {
    const result = await faucetRequest("claim", {
      network: "testnet",
      address,
      request_id: pending.request_id,
    });
    localStorage.setItem(claimKey(address), JSON.stringify(result));
    save(result);
    return result;
  } catch (error) {
    const failure = (error as Error & { result?: Claim }).result;
    const record = { ...pending, ...failure, request_id: pending.request_id };
    localStorage.setItem(claimKey(address), JSON.stringify(record));
    save(record);
    throw error;
  }
}
export const faucetMessage: Record<string, string> = {
  captcha_required:
    "Fauzec needs a human check. Copy your address and use the official faucet website.",
  address_on_cooldown:
    "This address is on cooldown. Resume the original request or wait until the next eligible time.",
  ip_on_cooldown:
    "Fauzec has limited claims from this network. Wait before requesting again.",
  rate_limited: "Too many requests. Wait before checking again.",
  faucet_dry:
    "Fauzec is temporarily out of TAZ. Your wallet balance is unchanged.",
  runtime_unavailable:
    "The faucet is unavailable. Use the official website or check this request later.",
  submission_ambiguous:
    "The submission result is uncertain. Resume this request ID; do not make another claim.",
};
