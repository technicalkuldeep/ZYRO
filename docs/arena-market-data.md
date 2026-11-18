# Arena scheduled crypto markets

## Public source

Coinbase Exchange public `GET /products/{pair}/candles?granularity=60` supports BTC-USD, ETH-USD and SOL-USD. All three were fetched successfully. No API key is required for this integration. Requests are server-side, timeout after ten seconds, validate bounded JSON and candle structure, and serialize with a 150ms gap. Recent chart responses are cached/deduplicated for 30 seconds. Each backend process stays below the documented single-IP public rate in ordinary use; multiple deployments sharing an IP should coordinate their aggregate request budget.

Sources: [completed candle schema and endpoint](https://docs.cdp.coinbase.com/api-reference/exchange-api/rest-api/products/get-product-candles), [public rate limits](https://docs.cdp.coinbase.com/exchange/rest-api/rate-limits). Coinbase documents 10 public requests/second/IP and bursts up to 15, and notes that intervals without trades may have no candle. The implementation tolerates bounded extra buckets and selects the exact requested timestamp; it never substitutes a neighbouring candle.

## Immutable specification

Each market has a unique `(pair, candleStart)` index and deterministic ID. Version 1 specifications include pair, provider, threshold, eight-decimal integer threshold units, comparison, entry cutoff, candle start/end, UTC timezone, granularity, close calculation, equality rule, unavailable-data policy, source reference candle/raw row and reference retrieval time. A SHA-256 hash covers the specification before entry. The threshold is the actual most recent completed reference close, rejecting references older than ten minutes. There is no specification-edit or manual-outcome API.

The worker maintains approximately two upcoming markets per asset. Schedules derive from the actual UTC clock in 15-minute aligned slots, with additional hourly slots. It checks existing future records before publication and uses insert-only upserts to preserve established thresholds. Restarting does not reset accounts or recreate a market under a changed specification.

For candle start `T`:

- Entry cutoff: `T − 5 seconds`.
- Observation candle: `[T, T + 60 seconds)`.
- Close: last traded price in that exact Coinbase candle, not its open/high/low and not a current ticker quote.
- First verification: no earlier than `T + 70 seconds` (ten seconds after candle completion).
- YES: close strictly greater than threshold. NO: close equal to or below threshold.
- Prices compare using exact decimal-to-BigInt units at eight-decimal scale; virtual point accounting uses integer numbers with conditional safe-balance writes.

## Resolution and recovery

The Express process runs a 15-second worker loop. MongoDB holds the job/specification, next attempt time, attempt count and expiring lease. Only a worker that holds the current lease can finalize that market. Raw source candle, requested pair, query URL, retrieval time and final outcome are retained as evidence. The source is a trusted HTTPS provider, not an independently signed decentralized oracle.

Bad/missing/unfinished/incorrectly timestamped data leaves `PENDING_VERIFICATION`, with a recorded error and retry after 60 seconds. If the source is still unusable on an attempt at least 24 hours after observation, the published policy cancels/refunds. A valid completed candle may still be accepted after an outage; no refund is claimed merely from a frontend countdown. No invented price or random fallback exists.

Finalized markets and per-user settlements are separate durable phases. The worker rescans pending predictions, including those whose market already has evidence, so a crash between evidence and payout recovers. Each prediction settlement uses the same atomic account/result/ledger transaction and unique operation constraint as short games. Concurrent workers and repeated jobs cannot double-pay. One delayed job is logged without preventing later jobs from being attempted.

Scheduled predictions cannot be manually cancelled by a player or resolved through the quick-game endpoint. Up to 20 scheduled predictions and one quick game can be pending together. The prior global one-pending index was replaced by a partial quick-game index; old records, balances and ledgers were retained. Entry validation serializes against admin participation pauses by writing the market record inside the same stake transaction.

The backend must be running to settle jobs. After downtime it recovers from MongoDB; browser timers have no settlement authority. Charts are recent completed one-minute closes and show source timestamps and actual cache retrieval time. They are not labeled live.

## Operational controls

The existing verified-email plus immutable Google-sub owner binding authorizes `/admin/arena`. The console shows definitions, actual round/payout totals, pending/resolved markets, source attempts and sanitized game errors. Administrators may disable future entry with a required reason and audit operation; existing terms, thresholds and outcomes stay unchanged. No arbitrary outcome or threshold editing is exposed. Content-control audits use `arena_content_audit`, separately from existing credit-grant audits.
