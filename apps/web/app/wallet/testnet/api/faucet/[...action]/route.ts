import { faucetProxy } from "../../../../../../lib/zcash-wallet/faucet-server";
export const runtime = "nodejs";
type Context = { params: Promise<{ action: string[] }> };
export async function GET(request: Request, context: Context) {
  return faucetProxy(request, (await context.params).action);
}
export async function POST(request: Request, context: Context) {
  return faucetProxy(request, (await context.params).action);
}
