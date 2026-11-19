# Round 6 — live crypto charts and two-minute Arena

This extends the existing application. Google identity, initial 100-point grants, seven quick/bot games, prior scheduled markets, history, rankings, admin authorization and Zcash research remain in place. No commit or push was performed. Testing creates uniquely named disposable Atlas databases and never resets application accounts.

## A. Real-time market data

`apps/api/src/live-prices.ts` owns one upstream connection per API process to `wss://ws-feed.exchange.coinbase.com`, subscribing to `ticker` and `heartbeat` for BTC-USD, ETH-USD and SOL-USD. Browser tabs share that connection. Authenticated same-origin SSE at `/api/account/live-prices` coalesces delivery at up to 10 messages/second per browser, with a 64 KiB slow-client buffer ceiling and disconnect cleanup.

Ticker validation requires an allowed pair, positive bounded decimal price with at most eight decimal places, finite provider timestamp within the freshness window, safe integer sequence/trade identifiers, increasing ordering and no duplicate trade IDs. Sparse ticker sequences are not confused with consecutive order-book sequences. Trade-ID gaps increment a reconciliation generation. No simulated prices exist. Randomness in this module is exclusively reconnect jitter.

Fresh requires a tick less than 15 seconds old and a heartbeat less than 10 seconds old while connected. A 12-second missing heartbeat closes the upstream socket. Reconnect uses exponential backoff with jitter, capped around 30 seconds. The browser also marks a silent downstream stream delayed after five seconds. Last verified provider timestamps remain visible. SIGINT/SIGTERM stop the feed and worker. The implementation uses Node 22's native WebSocket and requires no Coinbase key.

References: [Coinbase WebSocket overview](https://docs.cdp.coinbase.com/exchange/websocket-feed/overview), [channels](https://docs.cdp.coinbase.com/exchange/websocket-feed/channels), [historical candles](https://docs.cdp.coinbase.com/api-reference/exchange-api/rest-api/products/get-product-candles).

## B. Chart implementation

Installed TradingView Lightweight Charts **5.3.0**, using its current `addSeries(AreaSeries | CandlestickSeries)` API. The financial chart replaces the previous SVG in scheduled market details and powers `/arena/crypto/fast`. It uses the existing cached, validated Coinbase REST adapter for completed 1m history, followed by incremental `series.update()` calls for actual ticker updates. REST initialization/reconciliation uses `setData()`; it is never called for each ticker. Reconciliation occurs after upstream generations/gaps and once per minute, retaining at most 300 historical bars. Shared REST cache holds at most 100 entries with 30-second freshness and deduplicated requests.

Controls include BTC/ETH/SOL, area/candlesticks, 1m/5m intervals, crosshair, zoom/pan, current price and Go to Live. Five-minute historical bars aggregate contiguous completed 1m candles; incomplete historical groups are omitted. The current interval remains provisional. Official reference lines are distinct from streaming movement. `autoSize` uses responsive sizing without resize recreation. Effects dispose EventSource, requestAnimationFrame, intervals and chart on unmount/asset changes. Tick renders stay inside the chart component; the gameplay page polls persistent state every three seconds. Countdown display uses server time plus elapsed monotonic browser time and never settles anything.

Upstream aggregation retains all accepted-tick high/low extrema in six bounded current bars (three assets × 1m/5m), so coalescing SSE delivery does not discard intra-batch highs/lows. These are provisional until completed REST reconciliation. Accepted positions pin their round in the URL so the result survives refresh; the shell balance refreshes on confirmed backend balance changes. Mobile has a fixed jump-to-ticket action and large direction controls.

TradingView attribution, public product link, visible logo and NOTICE copyright appear with every chart. Package Apache-2.0 license remains distributed in node_modules. [Official documentation](https://tradingview.github.io/lightweight-charts/docs), [realtime update API example](https://tradingview.github.io/lightweight-charts/examples/data/realtime-updates).

## C. Immutable rounds

For each asset, observation starts every three minutes aligned to UTC (`start % 180000 === 0`). Duration is exactly 120 seconds. Entry opens 60 seconds before start and closes five seconds before it. The worker maintains three upcoming starts per asset using deterministic IDs `fast:{product}:{startMilliseconds}`. Bulk upserts only insert absent specifications and never reopen past entries. Publication checks run every 30 seconds within a five-second worker loop.

The start reference is the close of the exact completed candle beginning `T-60s`; the end reference is the close of the exact candle beginning `T+60s`, ending `T+120s`. Verification begins at least ten seconds after candle completion. UP is strictly greater, DOWN strictly less, equality refunds. Prices compare as integer units at eight decimal places. All rules, boundaries, source, payout and missing-evidence policy are frozen in version 1 and SHA-256 hashed before entry.

The public phase is derived from fixed server timestamps: UPCOMING → ENTRY_OPEN → ENTRY_LOCKED → LIVE → AWAITING_PRICE_EVIDENCE, then persisted RESULT_VERIFIED → SETTLED. DATA_DELAYED, CANCELLED and DISPUTED are explicit. DATA_DELAYED retries at 30-second intervals; missing exact evidence after one hour beyond observation end cancels and refunds. Integrity mismatches enter DISPUTED and require operator review; no automated payout is invented.

## D. Point accounting

Authentication is the existing opaque Google-linked Arena session. New APIs live behind existing authentication and origin/client-header enforcement. Stake limits are integer 10–100 points. Stale feeds pause entry. Each user has one immutable position per round; request UUIDs return matching prior receipts and reject changed terms. Clients cannot submit authoritative prices/outcomes.

| Starting available | Stake | After entry | Committed | Result       | Returned | Final available |
| ------------------ | ----- | ----------- | --------- | ------------ | -------- | --------------- |
| 100                | 10    | 90          | 10        | Win          | 20       | 110             |
| 100                | 10    | 90          | 10        | Loss         | 0        | 90              |
| 100                | 10    | 90          | 10        | Equal/cancel | 10       | 100             |

Committed points return to zero after settlement. No synthetic top-up, cash, TAZ or ZEC accounting is introduced. Existing `ArenaGames.settle` performs transaction-safe account/results/ledger updates. Fast positions use `gameKind: market` so existing quick-game reveal/cancel endpoints cannot resolve them. History/rankings reuse the existing records; continuation links return to the fast experience.

## E. MongoDB and worker recovery

New collection `arena_fast_rounds`: deterministic `_id`, unique `(spec.pair,spec.start)`, worker index `(status,nextAttempt,leaseUntil)`. New `arena_fast_evidence_attempts`: `(roundId,at)` lookup and 30-day operational-log TTL. Authoritative specifications and final source evidence are retained in round records. Existing `arena_predictions` gains partial unique `(userId,marketId)` for `gameKey: crypto-fast`; no old index is removed.

Stake writes the round's entry revision, conditional account debit, immutable prediction and `stake:{predictionId}` ledger entry in the existing majority MongoDB snapshot transaction. This serializes concurrent stakes and worker transitions. Resolution claims a 45-second token lease. Source verification records raw OHLCV rows, product, URLs, verification timestamps, specification hash and result before any payout. The existing unique `settle:{predictionId}` ledger operation and `arena_results` ID prevent duplicate settlement, including concurrent workers. A recovery scan includes pending predictions even when their rounds are already finalized. Processing is bounded to 200 positions per round per pass; later passes drain remaining positions.

## F. Genuine live evidence

See the final verification results below. A report is only described as fully verified after real WebSocket receipt, actual UI entry/deduction, the entire scheduled two-minute window, exact source candles, single settlement, worker/database recreation and browser refresh all succeed.

First complete run: [redacted source/ledger receipt](evidence/round6-live-first.json). BTC-USD round `fast:BTC-USD:1795078260000`, observation **2026-11-19 08:51:00–08:53:00 UTC**. Starting candle `1795078200` (08:50–08:51), close **$63,494.39**. Ending candle `1795078320` (08:52–08:53), close **$63,553.90**. Outcome **UP**; 10-point UP prediction **WIN**, return **20**, final available **110**, committed **0**. Stake ledger ID `9c385ead-a4ad-4538-ad09-0148275451e3`; settlement ledger ID `d873f7c7-9e38-43a1-96d3-87910fd9a151`. A new Atlas client and worker replay left exactly one settlement; browser refresh and six asset switches completed with zero page errors and zero remaining SSE listeners after context close.

That run observed 3,741 upstream messages, including 2,810 accepted ticks; zero reconnects, rejected messages or detected gaps. A short chart sample after refresh recorded 21 updates with mean backend-receipt-to-chart latency **67.9 ms**, maximum **363 ms**, including transport/batching/initialization overhead. A 60-frame headless Edge responsiveness sample averaged **16.60 ms**, maximum **22.10 ms**. Six asset switches held seven chart canvases each; observed heap fluctuated **21.3–42.9 MB** with collection, rather than monotonically increasing. These are local development samples, not production percentile guarantees or a long-duration memory audit. Provider timestamps are not used to claim end-to-end zero latency.

## G. Automated verification

Final implementation live run also passed: [final redacted receipt](evidence/round6-live.json), BTC round `fast:BTC-USD:1795078620000`, **08:57–08:59 UTC on November 19, 2026**. Starting candle `1795078560` closed **$63,701.18**; ending candle `1795078680` closed **$63,662.42**. Official outcome **DOWN**. The test UP prediction correctly lost: **100 → 90 → 90** available; commitment **10 → 0**. Stake ledger `3a990d7f-15fd-4091-8bcb-1d60fd67745f`; settlement ledger `b4b9eeec-e875-4b57-aebc-04c5e2fe04ba`, exactly once after worker replay and new database connection. The selected result now survives browser reload automatically through the round URL. Zero page errors and zero remaining SSE listeners.

Final run metrics: **2,880 upstream messages / 2,198 accepted ticks**, zero rejected messages, gaps or reconnects. Post-refresh sample: **19 chart updates**, mean backend-receipt-to-chart **136.2 ms**, maximum **616 ms**, including initialization/batching. Browser frame waits: mean **16.44 ms**, maximum **21.30 ms** over 60 samples. Six asset switches retained seven canvases, with observed heap approximately **22–44 MB** and subsequent collection. Development initialization spikes mean these measurements are not a steady-state latency percentile claim. Both a genuine winning and losing two-minute round are therefore evidenced; refunds are transaction-tested with fixture evidence, not claimed as a live equal-price occurrence.

See the final command results below. Fixture tests cover malformed/stale/duplicate/out-of-order ticks, interruption/reconnect, gap generation, historical parsing/gaps, fixed UTC rules, UP/DOWN/equality, cutoff, immutable hash, stale entry pause, transaction idempotency, concurrency, no early settlement, source delay/refund, recovery and unauthorized APIs. Existing account/game/admin suites remain intact.

Initial runs exposed test-harness defects: default five-second network timeout and fresh-feed fixture restoration order. Both were corrected. The first genuine run reached backend settlement but the browser's selected-round state reset during development edits; its final receipt assertion failed, so that run alone is not claimed as complete live verification. The corrected harness explicitly reselects its immutable round before checking the final UI.

Verified commands: `npm test` **88 passed, 43 opt-in skips**; final `npm run test:mongo` **59 passed** (includes 20 pure tests and the existing/new Atlas integrity tests); `npm run test:arena-browser` **45 responsive checks, seven game flows, six real-source scheduled markets, zero page errors**. Lint, TypeScript and production build passed. Production dependency audit: **zero vulnerabilities**. Configured secret-value scan: **29 production client files, two configured secret values, zero matches**. Interactive Google consent, PostgreSQL, live Zcash and Rust suites were not rerun; offline Zcash interface tests remain in the unchanged passing suite. The added tick-extrema test accounts for the final offline count increase from 87 to 88.

## H. Operational limits

- One trusted provider; public WebSocket/REST may be interrupted, delayed or revised. Stored final outcomes are not silently recomputed from later revisions.
- Live chart bars are provisional aggregates of received ticks. Completed historical candles and final market evidence come from REST. Coinbase does not promise 60 unique prices per second; delivery is batched and chart rendering uses real ticks only.
- One upstream per API process, not a cross-process global broker. Multiple replicas share durable round/ledger safety but need coordinated provider-IP budgets at production scale.
- API uptime is required for timely publication/settlement; MongoDB recovers durable pending work after restart. No browser must remain open.
- Public round/history lists are bounded; all user pending positions are included. Round audit records intentionally persist, requiring an operator retention/archive policy at scale.
- Interactive real Google consent is not repeated by synthetic session tests. PostgreSQL/live Zcash/Rust checks are reported only if actually rerun. No Rust, wallet, FROST or Zcash implementation is changed.
- This is a local virtual practice implementation, not an independently audited production wagering service.

## I. Screenshots

Screenshots are local ignored QA artifacts in `artifacts/round6/`: desktop live chart, 390px mobile, 768px tablet, locked position, live observation, awaiting evidence and final settlement. They use an explicit synthetic QA account in a disposable Atlas database, not a production authentication bypass.

Reviewable copies: [desktop live chart](screenshots/round6-live-chart-1440.png), [mobile](screenshots/round6-mobile-390.png), [locked position](screenshots/round6-locked-position-1440.png), [awaiting evidence](screenshots/round6-awaiting-outcome-1440.png), [settled desktop](screenshots/round6-settled-result-1440.png), [settled mobile](screenshots/round6-settled-result-390.png). Desktop, mobile and final evidence captures were opened and visually inspected. Capture cleanup blurs focus and scrolls to the top to avoid a sticky header appearing in the middle of full-page screenshots.

## J. Local verification (PowerShell)

```powershell
Set-Location D:\ZYRO
npm ci
npm run dev
# Separate terminal:
npm test
npm run test:mongo
npm run test:fast-live
npm run test:arena-browser
npm run lint
npm run typecheck
npm run build
node scripts/release-scan.mjs
```

Keep the existing ignored `.env`; do not overwrite it. Node >=22.19 and a MongoDB replica set with transaction support are required. Headless browser verification uses installed Microsoft Edge. `test:fast-live` starts its own QA API/web at 4106/3106, waits through a real future round (roughly 3–6 minutes), records redacted evidence, then removes only its uniquely named test database. Run browser harnesses sequentially when using the same ports. The main feature route is `http://127.0.0.1:3000/arena/crypto/fast`; discovery links appear at `/arena` and `/arena/crypto`. Existing `/arena/history`, `/arena/leaderboard`, scheduled crypto detail and `/admin/arena` remain available.

## K. Git and credentials

No commit/push was performed. Credentials remain in the ignored `.env` and are not copied into frontend/source/evidence. Final inventory and scanner results appear below. `apps/web/next-env.d.ts` was already modified at entry and is regenerated by Next; its development references are preserved at delivery. No application collection is deleted by implementation/migration. Test cleanup explicitly checks its exact disposable database name and prefix.

Changed files and final status: [round6-git-status.txt](round6-git-status.txt). Source groups are the shared WebSocket manager, fast-round service, authenticated SSE/round routes and worker wiring; chart/game UI and route; Arena discovery/history links; scoped stylesheet; Lightweight Charts manifest/lockfile; new validation/Atlas tests and isolated live/security harnesses. Six screenshot copies and two genuine redacted receipts accompany this report. The publication scan found **zero findings**; exact configured secret values matched **zero of 29** production client files; production dependency audit found **zero vulnerabilities**. These scans are bounded checks rather than a universal secret guarantee. Existing Zcash files and historical records are unchanged.
