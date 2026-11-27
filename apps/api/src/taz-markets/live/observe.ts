import { readFile } from "node:fs/promises";
import {
  LiveCustodyAdapter,
  matchIntent,
  ZALLET_VERSION,
  ZEBRA_VERSION,
} from "./adapter.js";
import { ObservationRpc } from "./rpc.js";

function setting(name: string) {
  const value = process.env[name];
  if (!value) throw new Error("Missing observation setting " + name);
  return value;
}

try {
  const mode = setting("ZYRO_TAZ_CUSTODY_MODE");
  if (mode !== "regtest" && mode !== "testnet-readonly") {
    throw new Error("TAZ custody observation mode is disabled");
  }
  const start = setting("ZYRO_TAZ_SCAN_FROM_HEIGHT");
  if (!/^\d+$/.test(start)) throw new Error("Invalid scan start height");
  const zebra = new ObservationRpc(
    "zebra",
    setting("ZYRO_TAZ_ZEBRA_RPC"),
    setting("ZYRO_TAZ_ZEBRA_COOKIE_FILE"),
  );
  const zallet = new ObservationRpc(
    "zallet",
    setting("ZYRO_TAZ_ZALLET_RPC"),
    setting("ZYRO_TAZ_ZALLET_COOKIE_FILE"),
  );
  const adapter = new LiveCustodyAdapter(
    mode,
    setting("ZYRO_TAZ_WALLET_ACCOUNT"),
    Number(start),
    zebra,
    zallet,
  );
  const reference = process.env.ZYRO_TAZ_OBSERVATION_INTENT_FILE;
  const intent = reference
    ? JSON.parse(await readFile(reference, "utf8"))
    : undefined;
  const observation = await adapter.scan();
  const { network, branch, tip, observedAt, notes } = observation;
  const match = reference && matchIntent(observation, intent);
  console.log(
    JSON.stringify({
      mode,
      network,
      branch,
      tip,
      observedAt,
      versions: { zallet: ZALLET_VERSION, zebra: ZEBRA_VERSION },
      ownedShieldedNotes: notes.length,
      intentReferences: notes.filter((n) => n.memoReference).length,
      ...(reference && {
        match: match
          ? {
              evidenceDigest: match.evidenceDigest,
              qualification: match.qualification,
            }
          : null,
      }),
      operatorSpending: false,
    }),
  );
} catch {
  console.error(
    "TAZ observation failed. Check mode, endpoints, authentication, version, scan readiness and account.",
  );
  process.exitCode = 1;
}
