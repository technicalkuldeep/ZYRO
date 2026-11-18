# Arena commitment and reveal

Round 5 games use **version 2**, with a separate preparation step before the player's final choice. Existing Round 4 draws retain their original version 1 resolver and original commitments.

1. Authenticated preparation creates a fresh 32-byte `crypto.randomBytes` secret, UUID, immutable game key, rules hash and 15-minute expiry. It returns only public commitment metadata. Unused expired commitments have a partial TTL index; consumed commitments remain available for audit.
2. `rulesHash` is SHA-256 of the canonical JSON assembled in `game-random.ts`: version, game definition, mapping name, payout rules and reveal delay. The commitment is SHA-256 of `JSON.stringify({version:2,id,key,rulesHash,secret})` in that key order.
3. Entry validates the preparation owner, expiry, unused status, allowed choice, stake and idempotency key. One MongoDB transaction consumes the preparation, records the immutable choice and stake, deducts available points, increases committed points and writes a stake ledger event. There is no endpoint to edit a submitted choice.
4. After three seconds, the server derives independent labelled HMAC-SHA256 streams using the hex-decoded secret as the HMAC key. The input for value `i` and retry counter `c` is UTF-8 `${gameKey}:${i}:${c}`. Interpret the first four digest bytes as an unsigned big-endian integer `n`.
5. For a range of size `s`, reject `n >= floor(2^32/s)*s`; otherwise use `n % s`. Rejection sampling removes modulo bias. Counter starts at zero. Every value uses its own label. Secrets are never reused for another round.
6. Verify the original commitment/rules hash before reveal. Resolve and credit the account, final result and ledger in a majority-committed snapshot transaction. Replays return the saved result; they do not pay again.

| Game                | Mapping                      | Outcome                                                                                            |
| ------------------- | ---------------------------- | -------------------------------------------------------------------------------------------------- |
| Above/Below 50      | One value, size 100          | YES at 50–99, NO at 0–49                                                                           |
| Coin Flip           | One value, size 2            | 0 Heads, 1 Tails                                                                                   |
| Dice Duel           | Two values, size 6, plus 1   | Total 8–12 above; 2–6 below; 7 refunds                                                             |
| Red or Black        | One value, size 52           | Index / 13: hearts, diamonds, clubs, spades. First two suits red. Rank modulo 13: A, 2…10, J, Q, K |
| Triple Flip         | Three values, size 2         | Majority of 0 Heads / 1 Tails                                                                      |
| Rock Paper Scissors | One value, size 3            | Bot: 0 Rock, 1 Paper, 2 Scissors; standard win matrix; equal choices refund                        |
| Lucky Number Duel   | Two values, size 100, plus 1 | First is player's number, second is bot's; higher wins; equality refunds                           |

Wins return twice the committed stake; losses return zero; legitimate ties return the original stake. The bot is a computer and is not a human source of payout liquidity. Virtual points have no monetary value.

The bot's selection depends only on its precommitted secret and fixed stream label, **not the player's choice**. For RPS the player chooses after preparation and confirms afterward. Lucky numbers are also independent of player input. No outcome endpoint accepts a browser-supplied winning result or bot choice.

The Verify Fairness panel reveals the secret, commitment and rules hash and independently checks the commitment in the browser. Reproduce the stream and evaluation using the open-source `game-random.ts` functions; the browser button verifies the commitment, not all random mappings. Version 1 verification hashes the UTF-8 secret directly.

This demonstrates non-alteration after the published commitment. It does **not** prove that an operator generated secrets without preselection, establish an independent randomness beacon, or prevent a privileged database operator from editing records. No independent fairness audit is claimed. Future rule changes must retain the relevant versioned resolver for already committed rounds.
