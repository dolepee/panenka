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

Expected verifier marker:

```text
PANENKA_DUEL_VALID
```

## Live Activity Snapshot

As of 2026-05-23, the live X Layer testnet deployment has:

- `14` country kickers minted.
- `21` duels created.
- `20` duels settled.
- `8` countries represented in the country leaderboard.
- `3` level-2 kickers from repeated onchain wins.

The authoritative live values are returned by `https://panenka-alpha.vercel.app/api/proof` and `https://panenka-alpha.vercel.app/api/leaderboard`.

## Current Upside Moves Added

- Public replay route loads the latest settled duel from live X Layer state, with the proof settlement transaction as a fallback.
- Country leaderboard aggregates wins, losses, streaks, and kicker count per country from live `KickerNFT` state.
- Country leaderboard rows include X challenge links for shareable rivalry posts.
- Share links let players post settled results to X with `@XLayerOfficial` tagged.
- Panenka Bot is capped to public exhibition duels of `1 DCR` by default so the one-wallet demo path stays reliable during public testing.
- `GET /api/bot-opponent` exposes Panenka Bot readiness, public stake cap, DCR balance, gas, allowance coverage, and kicker status.
- `/api/proof` gives AI judges one JSON surface for contracts, proof txs, settled/open/draw duel counts, recent duel states, and verifier command.
- `npm run exhibition:run` can create real pre-submission activity with deterministic funded test wallets, country rotation, and multiple settled duels.

## Activity Target Before Final Demo

- At least `20` settled duels. Achieved: `20`.
- At least `8` country kickers. Achieved: `14`.
- At least `8` countries visible in the country leaderboard. Achieved: `8`.
- At least `3` public X posts showing rivalry results and tagging `@XLayerOfficial`.

## Intentional Scope Cuts

- No real-money betting.
- No FIFA or official World Cup branding.
- No live match oracle.
- No tournament contract in V1.
- No spectator betting or prediction market.
