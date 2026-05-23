# Panenka

Panenka turns penalty shootouts into onchain duels on X Layer. Players mint a country kicker, commit hidden shots and saves, reveal, and the contract settles a best-of-five shootout with onchain credits, NFT stats, and a leaderboard.

This MVP is a game, not a betting market. V1 uses non-transferable DuelCredit instead of real-money staking to keep the demo focused on World Cup gameplay, commit-reveal fairness, and X Layer transaction proof.

Live app: `https://panenka-alpha.vercel.app`

Judge proof endpoint: `https://panenka-alpha.vercel.app/api/proof`

Project X account: `https://x.com/PanenkaGG`

Public testers can play with one wallet against Panenka Bot. The contract still enforces a real two-player duel; the bot is a server-side opponent wallet that joins and reveals with its own commitment.

Current live X Layer activity: `14` country kickers minted, `22` duels created, `21` duels settled, and all `8` country slots represented in the leaderboard. The live counts are returned by `/api/proof` and `/api/leaderboard`.

## What Is Built

- `DuelCredit`: non-transferable in-game credit with a daily faucet and duel-only transfer route.
- `KickerNFT`: country kicker NFT with wins, losses, streak, and level.
- `PenaltyDuel`: create, join, commit, reveal, settle, timeout cancel, and forfeit.
- Foundry tests covering the full duel lifecycle and failure cases.
- X Layer testnet deployment and first two-wallet duel proof.
- Server-side Panenka Bot endpoint for one-wallet testing.
- Public bot-readiness check so judges can see the one-wallet demo path is funded, capped, and ready before clicking.
- Replay page loads the latest settled duel from live X Layer state, with the proof duel as a fallback.
- Live leaderboard reads `KickerNFT` owner and stats state from X Layer, with both country and kicker rankings.
- Country leaderboard rows include X challenge links so the World Cup rivalry loop can spread from each onchain result.
- Machine-readable `/api/proof` endpoint for AI judges: contracts, proof txs, settled/open/draw duel counts, recent duels, recent settlement tx links, and verifier marker.

## X Layer Testnet Proof

Chain: X Layer testnet (`1952`)

Contracts:

- `DuelCredit`: [`0xcf8af8245abe1aeedc23b1f9c45ba84e17614c98`](https://www.okx.com/web3/explorer/xlayer-test/address/0xcf8af8245abe1aeedc23b1f9c45ba84e17614c98)
- `KickerNFT`: [`0x33dc85f938f21c8cf83556f444d16e61377a35a3`](https://www.okx.com/web3/explorer/xlayer-test/address/0x33dc85f938f21c8cf83556f444d16e61377a35a3)
- `PenaltyDuel`: [`0xebd15b2baa79a84d6e509b2dae12526abe5dacdb`](https://www.okx.com/web3/explorer/xlayer-test/address/0xebd15b2baa79a84d6e509b2dae12526abe5dacdb)

First settled duel proof:

- Duel: `#1`
- Create duel tx: [`0xd7977b7bf6a64c7de8917f4e1c70e54995e4bf076d2788c98f50da7747cd87f3`](https://www.okx.com/web3/explorer/xlayer-test/tx/0xd7977b7bf6a64c7de8917f4e1c70e54995e4bf076d2788c98f50da7747cd87f3)
- Join duel tx: [`0x8fbe70029798b0a40da767945a64787febd66ac7ab9656dba0126ba5b537eaa6`](https://www.okx.com/web3/explorer/xlayer-test/tx/0x8fbe70029798b0a40da767945a64787febd66ac7ab9656dba0126ba5b537eaa6)
- Player one reveal tx: [`0xdc7680675114e2e27f906a01824d746e29f5a57f56d1b66974271e06df82ac51`](https://www.okx.com/web3/explorer/xlayer-test/tx/0xdc7680675114e2e27f906a01824d746e29f5a57f56d1b66974271e06df82ac51)
- Player two reveal and settlement tx: [`0x8ac7ec41c0e1ca9eb0cee210ca52bf4835758d7081bce53ea2a84f0a2922ad9b`](https://www.okx.com/web3/explorer/xlayer-test/tx/0x8ac7ec41c0e1ca9eb0cee210ca52bf4835758d7081bce53ea2a84f0a2922ad9b)

Recorded readback immediately after that settlement:

- Player one: Nigeria kicker, `105` DuelCredit, `1` win, `1` streak.
- Player two: France kicker, `95` DuelCredit, `1` loss.

Verifier:

```bash
npm run verify:duel
```

Expected success marker:

```text
PANENKA_DUEL_VALID
```

## Commands

```bash
pnpm install --frozen-lockfile
npm run contracts:build
npm run contracts:test
npm run app:typecheck
npm run app:build
npm run verify:duel
```

Deploy after filling `.env`:

```bash
cp .env.example .env
set -a && source .env && set +a
npm run contracts:build
npm run deploy:xlayer
```

The default `.env.example` targets X Layer testnet (`chainId 1952`, RPC `https://testrpc.xlayer.tech/terigon`). Switch `XLAYER_RPC_URL` and `XLAYER_CHAIN_ID` to X Layer mainnet (`chainId 196`, RPC `https://rpc.xlayer.tech`) only after the duel loop is stable.

After deployment, run the first two-wallet proof with funded player keys:

```bash
set -a && source .env && set +a
npm run duel:xlayer
```

That script claims DuelCredit when possible, mints two kickers if needed, creates a duel, joins it, reveals both plans, and settles the match onchain.

Create exhibition activity for the final submission:

```bash
set -a && source .env && set +a
npm run exhibition:run
```

The exhibition runner derives deterministic test wallets from `EXHIBITION_SEED`, funds them from `EXHIBITION_FUNDER_PRIVATE_KEY` or `DEPLOYER_PRIVATE_KEY`, rotates countries, settles multiple duels, and prints `PANENKA_EXHIBITION_VALID`. Use it to build visible X Layer activity before recording the final demo.

Frontend:

```bash
pnpm install --frozen-lockfile
npm run app:dev
npm run app:build
```

## Contract Events

- `CreditFaucetClaimed`
- `KickerMinted`
- `KickerStatsUpdated`
- `DuelCreated`
- `DuelJoined`
- `PlayerRevealed`
- `RoundResolved`
- `DuelSettled`
- `DuelForfeited`
- `DuelCancelled`

These events are the judge-facing proof: a duel has two players, both commits are hidden until reveal, every round resolves onchain, the pot moves in DuelCredit, and kicker stats update after settlement.

## Demo Flow

1. Connect wallet.
2. Mint or pick a country kicker.
3. Claim DuelCredit from the faucet.
4. Create a duel with a hidden commitment.
5. Click `Bot joins this duel` for one-wallet testing, or ask a human opponent to join.
6. Reveal from your wallet.
7. Click `Bot reveals and settles`, or ask the human opponent to reveal.
8. The UI shows the settlement transaction, stats update, and leaderboard change.

Fast judge path:

1. Open `https://panenka-alpha.vercel.app/#replay` to watch the latest settled X Layer duel without a wallet.
2. Open `https://panenka-alpha.vercel.app/#leaderboard` to see country rivalry and kicker rankings read from `KickerNFT`.
3. Open `https://panenka-alpha.vercel.app/api/proof` for machine-readable X Layer proof and `npm run verify:duel` for repo replay.

## Scope Guard

V1 intentionally cuts real USDT staking, prediction markets, player likenesses, live match feeds, spectator betting, chat, and cross-chain mechanics. The winning demo is the penalty reveal loop plus verifiable X Layer events.
