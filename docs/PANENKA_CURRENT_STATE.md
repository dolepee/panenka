# Panenka Current State

Last updated: 2026-05-26.

Panenka is an onchain penalty shootout duel game for X Layer X Cup. It is positioned as a game, not a gambling market: country kicker NFTs, non-transferable DuelCredit, hidden commit/reveal plans, IFAB-style no-draw settlement, stats, leaderboard, and explorer proof.

## Live Surfaces

- App: `https://panenka-alpha.vercel.app`
- Replay proof: `https://panenka-alpha.vercel.app/#replay`
- Machine-readable proof: `https://panenka-alpha.vercel.app/api/proof`
- X account: `https://x.com/PanenkaGG`
- Repository: `https://github.com/dolepee/panenka`

## X Layer Testnet

- Chain ID: `1952`
- RPC: `https://testrpc.xlayer.tech/terigon`
- Explorer: `https://www.okx.com/web3/explorer/xlayer-test`

## Contracts

- `DuelCredit`: `0xcc3fa00814d3577512d419154b8e2bd2c3566071`
- `KickerNFT`: `0xb1344061536397e422e4db5d536e14c9b73ca8ba`
- `PenaltyDuel`: `0xb2760c0d27af86ab4e6b7b5f9c5ff7e1015ce2aa`

## Settled Proof Duel

- Duel: `#1`
- Player one: `0x648C200356146f35beE46d59990F07eD6aaff8f0`
- Player two: `0xb072d8A4d85D395bAc3ec7cc9B660037C06D2224`
- Create duel tx: `0xbc3118e3e017b37b35fd33efebec2326861e0c448b1bb5b73001d155120fa780`
- Join duel tx: `0xf833710748cd673a75c2de08207f9e984083d5fb226cc7364acd8609cad18629`
- Player one reveal tx: `0x4d80a46b57c9e842794cf2a051dfe2f0474b57be3202168bff5ae3eebded8fee`
- Player two reveal and settlement tx: `0x591cfb717624c02d2862b805237d34f9d151f3228d70bc9e7b1dd414e13c9181`

Recorded readback immediately after that settlement:

- Nigeria kicker: `105` DuelCredit, `1` win, `1` streak.
- France kicker: `95` DuelCredit, `1` loss.
- Score: Nigeria `3-0` France, stopped early once France could no longer catch up.

## Verification

Current commands:

```bash
pnpm install --frozen-lockfile
npm run contracts:build
npm run contracts:test
npm run app:typecheck
npm run app:build
npm run verify:duel
```

`npm run verify:duel` checks both the original full proof duel and the latest pinned settlement proof shown in the live replay.

Expected verifier marker:

```text
PANENKA_DUEL_VALID
```

## Live Activity Snapshot

The authoritative live values are returned by `https://panenka-alpha.vercel.app/api/proof` and `https://panenka-alpha.vercel.app/api/leaderboard`.

Last verified V2 snapshot on 2026-05-26:

- `11` country kickers minted.
- `12` duels created.
- `12` duels settled.
- `8` countries represented in the country leaderboard.
- `0` draw settlements in V2.
- Latest settled duel: `#12`, Japan `4-3` Nigeria.
- Latest settlement tx: `0xf2d25328442c24ac246f44994406882326325db3f411e3056b036080d43f1aac`.

Treat the live endpoints as canonical if this snapshot is lower than the current app.

## Current Upside Moves Added

- Public replay route loads the latest settled duel from live X Layer state, with the proof settlement transaction as a fallback.
- Homepage playable-now card surfaces Panenka Bot readiness, public DCR cap, and bot fuel before a tester clicks into the play flow.
- Homepage and `/api/proof` surface active player wallets from X Layer state so market-potential evidence is visible to judges.
- Homepage country race surfaces the top live countries from `KickerNFT` stats so judges see the rivalry loop before opening the leaderboard.
- Hero duel card links directly to replay, X sharing, and the latest settlement transaction.
- Country leaderboard aggregates wins, losses, streaks, and kicker count per country from live `KickerNFT` state.
- Country leaderboard rows include X challenge links for shareable rivalry posts.
- Share links let players post settled results to X with `@PanenkaGG`, `@XLayerOfficial`, and `#XLayerHackathon` included.
- Settled duel screen includes a grass-pitch shootout visual, downloadable result card, and browser-native image share where supported.
- Settled duel screen includes a copyable tester report so real testers can send back result and settlement tx quickly.
- Panenka Bot is capped to public exhibition duels of `1 DCR` by default so the one-wallet demo path stays reliable during public testing.
- `GET /api/bot-opponent` exposes Panenka Bot readiness, public stake cap, DCR balance, gas, allowance coverage, and kicker status.
- `/api/proof` gives AI judges one JSON surface for X Cup track fit, game-not-gamble safety boundaries, demo path, judge signals, contracts, proof txs, active wallets, no-draw settlement counts, recent duel states, recent settlement tx links, and verifier command.
- `npm run exhibition:run` can create real pre-submission activity with deterministic funded test wallets, country rotation, and multiple settled duels.

## Activity Target Before Final Demo

- At least `10` settled V2 duels. Achieved: `12`.
- At least `10` country kickers. Achieved: `11`.
- At least `8` countries visible in the country leaderboard. Achieved: `8`.
- At least `5` external tester wallets. Pending; collect through the local tester campaign.
- At least `3` public X posts showing rivalry results and tagging `@XLayerOfficial`.

## Intentional Scope Cuts

- No real-money betting.
- No FIFA or official World Cup branding.
- No live match oracle.
- No tournament contract in V1.
- No spectator betting or prediction market.
