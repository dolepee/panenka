# Panenka Current State

Last updated: 2026-05-23.

Panenka is an onchain penalty shootout duel game for X Layer X Cup. It is positioned as a game, not a gambling market: country kicker NFTs, non-transferable DuelCredit, hidden commit/reveal plans, best-of-five settlement, stats, leaderboard, and explorer proof.

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

- `DuelCredit`: `0xcf8af8245abe1aeedc23b1f9c45ba84e17614c98`
- `KickerNFT`: `0x33dc85f938f21c8cf83556f444d16e61377a35a3`
- `PenaltyDuel`: `0xebd15b2baa79a84d6e509b2dae12526abe5dacdb`

## Settled Proof Duel

- Duel: `#1`
- Player one: `0x648C200356146f35beE46d59990F07eD6aaff8f0`
- Player two: `0xb072d8A4d85D395bAc3ec7cc9B660037C06D2224`
- Create duel tx: `0xd7977b7bf6a64c7de8917f4e1c70e54995e4bf076d2788c98f50da7747cd87f3`
- Join duel tx: `0x8fbe70029798b0a40da767945a64787febd66ac7ab9656dba0126ba5b537eaa6`
- Player one reveal tx: `0xdc7680675114e2e27f906a01824d746e29f5a57f56d1b66974271e06df82ac51`
- Player two reveal and settlement tx: `0x8ac7ec41c0e1ca9eb0cee210ca52bf4835758d7081bce53ea2a84f0a2922ad9b`

Recorded readback immediately after that settlement:

- Nigeria kicker: `105` DuelCredit, `1` win, `1` streak.
- France kicker: `95` DuelCredit, `1` loss.

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

Last verified pre-submission snapshot on 2026-05-23:

- `20` country kickers minted.
- `31` duels created.
- `30` duels settled.
- `8` countries represented in the country leaderboard.
- `3` level-2 kickers from repeated onchain wins.
- Latest settled duel: `#31`, France `5-0` Argentina.
- Latest settlement tx: `0xe6c8a0038c113243191d03820d0742ab123a045c42bd3d9270a8ff0c25f5ecae`.

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
- Settled duel screen includes a copyable tester report so real testers can send back result and settlement tx quickly.
- Panenka Bot is capped to public exhibition duels of `1 DCR` by default so the one-wallet demo path stays reliable during public testing.
- `GET /api/bot-opponent` exposes Panenka Bot readiness, public stake cap, DCR balance, gas, allowance coverage, and kicker status.
- `/api/proof` gives AI judges one JSON surface for X Cup track fit, game-not-gamble safety boundaries, demo path, judge signals, contracts, proof txs, active wallets, settled/open/draw duel counts, recent duel states, recent settlement tx links, and verifier command.
- `npm run exhibition:run` can create real pre-submission activity with deterministic funded test wallets, country rotation, and multiple settled duels.

## Activity Target Before Final Demo

- At least `30` settled duels. Achieved: `30`.
- At least `20` country kickers. Achieved: `20`.
- At least `8` countries visible in the country leaderboard. Achieved: `8`.
- At least `5` external tester wallets. Pending; collect through the local tester campaign.
- At least `3` public X posts showing rivalry results and tagging `@XLayerOfficial`.

## Intentional Scope Cuts

- No real-money betting.
- No FIFA or official World Cup branding.
- No live match oracle.
- No tournament contract in V1.
- No spectator betting or prediction market.
