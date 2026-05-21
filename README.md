# Panenka

Panenka turns penalty shootouts into onchain duels on X Layer. Players mint a country kicker, commit hidden shots and saves, reveal, and the contract settles a best-of-five shootout with onchain credits, NFT stats, and a leaderboard.

This MVP is a game, not a betting market. V1 uses non-transferable DuelCredit instead of real-money staking to keep the demo focused on World Cup gameplay, commit-reveal fairness, and X Layer transaction proof.

Live app: `https://panenka-alpha.vercel.app`

Public testers can play with one wallet against Panenka Bot. The contract still enforces a real two-player duel; the bot is a server-side opponent wallet that joins and reveals with its own commitment.

## What Is Built

- `DuelCredit`: non-transferable in-game credit with a daily faucet and duel-only transfer route.
- `KickerNFT`: country kicker NFT with wins, losses, streak, and level.
- `PenaltyDuel`: create, join, commit, reveal, settle, timeout cancel, and forfeit.
- Foundry tests covering the full duel lifecycle and failure cases.
- X Layer testnet deployment and first two-wallet duel proof.
- Server-side Panenka Bot endpoint for one-wallet testing.

## X Layer Testnet Proof

Chain: X Layer testnet (`1952`)

Contracts:

- `DuelCredit`: `0x87e31cc7fe76dc7d70c70867e34fef1447e339e9`
- `KickerNFT`: `0xb614e51deb5e4078b6bbb28ee32a70bc547e19df`
- `PenaltyDuel`: `0xbe9f77afd1d64e0f76572f08c4ed34a6a1ccbfd1`

First settled duel proof:

- Duel: `#1`
- Create duel tx: `0xf390d54ea3dfbe6125cbb5a8ebd8baeaced36aa90531a3104be1870b3619e7ab`
- Join duel tx: `0xd39e643657d85874b01d1e1b0dd6e87440dab2176a6b0ead4391f45670487333`
- Player one reveal / settle tx: `0xf4747aab0b5130bb1bf9a035e60a3248af9f2d37c3c15a98b7f6838dec87bf25`
- Player two reveal / settle tx: `0x753d66f00fff9d28969de5c2f194c480b53c498168b1bba02084ecc66dbe9f98`

Readback after settlement:

- Player one: Nigeria kicker, `105` DuelCredit, `1` win, `1` streak.
- Player two: France kicker, `95` DuelCredit, `1` loss.

One-wallet bot proof:

- Duel: `#3`
- User create tx: `0x4bee457c923c5b56d0cd59aaebea89ab0fcbc6b17d38a0156567173fcfb7841f`
- Bot join tx: `0x3e2b68ef20ff5dcd463a6907d4a878d9f408c4114884dce9156b44f3f07efaa5`
- User reveal tx: `0x03dcd94f84776141e43455eb7fc03b91d923e1f65915525ec3cfde664efefe90`
- Bot reveal / settle tx: `0xc925226d6e7bb64e44eff769a7801847960f481e37c8622945eba1a6b3b7364f`

## Commands

```bash
npm install
npm run contracts:build
npm run contracts:test
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

Frontend:

```bash
pnpm --dir app install
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

## Scope Guard

V1 intentionally cuts real USDT staking, prediction markets, player likenesses, live match feeds, spectator betting, chat, and cross-chain mechanics. The winning demo is the penalty reveal loop plus verifiable X Layer events.
