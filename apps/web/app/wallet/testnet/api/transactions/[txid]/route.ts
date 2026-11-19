import { observeWalletTransaction } from "../../../../../../lib/zcash-wallet/transaction-status";
export const runtime = "nodejs";
let windowEnds = 0,
  requests = 0,
  active = 0;
export async function GET(
  _request: Request,
  context: { params: Promise<{ txid: string }> },
) {
  const { txid } = await context.params;
  const headers = {
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  };
  if (!/^[0-9a-f]{64}$/.test(txid))
    return Response.json(
      { error: "Invalid transaction ID" },
      { status: 400, headers },
    );
  if (Date.now() >= windowEnds) {
    windowEnds = Date.now() + 60000;
    requests = 0;
  }
  if (++requests > 120 || active >= 8)
    return Response.json(
      { error: "Wait before checking again" },
      { status: 429, headers },
    );
  active++;
  try {
    return Response.json(await observeWalletTransaction(txid), { headers });
  } catch {
    return Response.json(
      {
        error:
          "Testnet transaction status unavailable. Submission remains unresolved.",
      },
      { status: 503, headers },
    );
  } finally {
    active--;
  }
}
