// Schema verified against the pinned memory-wallet TransactionHistoryEntry.
export function normalizeHistory(entries, tip) {
  if (!Array.isArray(entries)) return [];
  return entries.map((row) => {
    const bytes = row.txid;
    const txid =
      typeof bytes === "string" && /^[0-9a-f]{64}$/.test(bytes)
        ? bytes
        : (Array.isArray(bytes) || bytes instanceof Uint8Array) &&
            bytes.length === 32 &&
            Array.from(bytes).every(
              (b) => Number.isInteger(b) && b >= 0 && b <= 255,
            )
          ? Array.from(bytes)
              .reverse()
              .map((b) => b.toString(16).padStart(2, "0"))
              .join("")
          : undefined;
    const height =
      Number.isSafeInteger(row.mined_height) && row.mined_height > 0
        ? row.mined_height
        : undefined;
    const confirmations =
      height && Number.isSafeInteger(tip) && tip >= height
        ? tip - height + 1
        : 0;
    const integer = (v) =>
      (typeof v === "bigint" && v >= 0n) ||
      (typeof v === "number" && Number.isSafeInteger(v) && v >= 0) ||
      (typeof v === "string" && /^\d+$/.test(v));
    return {
      txid,
      kind: typeof row.kind === "string" ? row.kind : undefined,
      amount: integer(row.amount_zatoshis)
        ? String(row.amount_zatoshis)
        : undefined,
      fee: integer(row.fee_zatoshis) ? String(row.fee_zatoshis) : undefined,
      mined_height: height,
      confirmations,
      status:
        row.status === "mined" && confirmations >= 3
          ? "Confirmed"
          : row.status === "mined" && confirmations
            ? "Confirming"
            : row.status === "pending"
              ? "Pending"
              : row.status === "expired"
                ? "Expired"
                : "Unknown",
      timestamp:
        Number.isSafeInteger(row.timestamp) && row.timestamp > 0
          ? row.timestamp
          : undefined,
      // Private memo remains wallet-local. It is never sent to public APIs.
      memo: typeof row.memo === "string" ? row.memo : undefined,
    };
  });
}
