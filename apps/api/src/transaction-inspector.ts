import { spawn } from "node:child_process";
import { z } from "zod";
import { Fault } from "./engine.js";
const resultSchema = z.object({
  txid: z.string().regex(/^[a-f0-9]{64}$/),
  transparentInputs: z.number().int().nonnegative(),
  transparentOutputs: z.number().int().nonnegative(),
  saplingOutputs: z.number().int().nonnegative(),
  orchardActions: z.number().int().nonnegative(),
  ironwoodActions: z.number().int().nonnegative(),
  decodedBy: z.string(),
  consensusProofsVerified: z.literal(false),
});
export type TransactionBytes = {
  network: "testnet";
  txHex: string;
  height: number | null;
};
export async function inspectTransaction(input: TransactionBytes) {
  if (!process.env.ZCASH_TX_INSPECTOR)
    throw new Fault(
      "The maintained Rust transaction decoder is not configured",
      503,
    );
  let command: string[];
  try {
    command = z
      .array(z.string().min(1))
      .min(1)
      .max(12)
      .parse(JSON.parse(process.env.ZCASH_TX_INSPECTOR));
  } catch {
    throw new Fault("Invalid transaction decoder command configuration", 503);
  }
  if (!/^[a-f0-9]+$/.test(input.txHex) || input.txHex.length > 2000000)
    throw new Fault("Invalid or oversized transaction encoding", 400);
  return new Promise<z.infer<typeof resultSchema>>((resolve, reject) => {
    const child = spawn(command[0], command.slice(1), {
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "ignore"],
    });
    let output = "";
    let settled = false;
    const finish = (error?: Fault, value?: z.infer<typeof resultSchema>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(value!);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(new Fault("Transaction decoder timed out", 502));
    }, 15000);
    child.on("error", () =>
      finish(new Fault("Transaction decoder could not be started", 503)),
    );
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
      if (output.length > 32768) {
        child.kill();
        finish(new Fault("Invalid transaction decoder response", 502));
      }
    });
    child.stdin.on("error", () => {});
    child.on("exit", (code) => {
      if (code !== 0)
        return finish(new Fault("Rust decoder rejected the transaction", 502));
      try {
        finish(undefined, resultSchema.parse(JSON.parse(output)));
      } catch {
        finish(new Fault("Invalid transaction decoder response", 502));
      }
    });
    child.stdin.end(JSON.stringify(input));
  });
}
