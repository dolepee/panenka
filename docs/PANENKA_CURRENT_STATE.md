# Panenka Hackathon Memory

Last updated: 2026-05-20, after first X Layer testnet duel proof

## Locked Idea

Panenka is an onchain penalty shootout duel game for OKX X Layer X Cup.

One-line pitch: mint a country kicker, commit hidden shots and saves, reveal, and let the contract settle a best-of-five shootout with onchain credits, NFT stats, and a leaderboard.

Core framing:
- Game, not gamble.
- Use `duel`, `shootout`, `kicker`, `commit`, `reveal`, `settle`.
- Avoid `bet`, `wager`, `odds`, `gambling`, `casino`, `real-money`.
- Share proof without overexposing blueprint until X Layer testnet proof is live.

## Social

Handle locked: `@PanenkaGG`.

Initial post exists: `https://x.com/PanenkaGG/status/2056988480706642154`.

Profile kit and assets:
- `/mnt/c/Users/Hi/Downloads/panenka/social/x-profile-kit.md`
- `/mnt/c/Users/Hi/Downloads/panenka/social/panenka-avatar.png`
- `/mnt/c/Users/Hi/Downloads/panenka/social/panenka-header.png`

Preferred next post after proof:
`First X Layer testnet proof is live: two wallets claimed DuelCredit, minted country kickers, committed hidden choices, revealed, and settled duel #1 onchain. Next: polish the duel screen and open the first tester lobby.`

## Repo State

Working directory: `/home/qdee/panenka`

No commit yet. Current files are untracked because repo was just scaffolded.

Live Vercel app: `https://panenka-alpha.vercel.app`

Plan files:
- Linux: `/home/qdee/panenka/PANENKA_BUILD_PLAN.md`
- Windows: `/mnt/c/Users/Hi/Downloads/panenka/PANENKA_BUILD_PLAN.md`

## Built So Far

Contracts:
- `/home/qdee/panenka/contracts/src/DuelCredit.sol`
- `/home/qdee/panenka/contracts/src/KickerNFT.sol`
- `/home/qdee/panenka/contracts/src/PenaltyDuel.sol`

Tests:
- `/home/qdee/panenka/contracts/test/PanenkaFlow.t.sol`

Scripts:
- `/home/qdee/panenka/scripts/deploy.ts`
- `/home/qdee/panenka/scripts/run-duel.ts`

Frontend:
- `/home/qdee/panenka/app/src/main.tsx`
- `/home/qdee/panenka/app/src/contracts.ts`
- `/home/qdee/panenka/app/src/styles.css`

Docs/config:
- `/home/qdee/panenka/README.md`
- `/home/qdee/panenka/.env.example`
- `/home/qdee/panenka/vercel.json`

## Contract Scope

`DuelCredit`
- Non-transferable in-game credit.
- Daily faucet.
- Transfers only route through the duel contract.

`KickerNFT`
- ERC721-like minimal country kicker.
- One mint per wallet.
- Tracks country, wins, losses, streak, level.
- Added `tokenOfOwner` getter for frontend and scripts.

`PenaltyDuel`
- Create, join, commit, reveal, settle.
- Best of five rounds.
- Draw refunds both players.
- Timeout cancel for unjoined duels.
- Forfeit if one player reveals and the other does not.
- Emits judge-facing events: `DuelCreated`, `DuelJoined`, `PlayerRevealed`, `RoundResolved`, `DuelSettled`, `DuelForfeited`, `DuelCancelled`.

`Panenka Bot`
- Server-side test opponent at `/api/bot-opponent`.
- Lets one public tester complete a real two-player duel without controlling two wallets.
- Bot uses its own server-side EOA, commits its own hidden choices, then reveals after the user reveals.
- This is an onboarding helper, not a contract shortcut.

## Verification Passed

Commands passed on 2026-05-20:

```bash
npm run contracts:test
npm run app:typecheck
npm run app:build
pnpm exec tsc --noEmit --module NodeNext --moduleResolution NodeNext --target ES2022 --skipLibCheck scripts/deploy.ts scripts/run-duel.ts
```

Contract tests: 7/7 passing.

Covered cases:
- create/join/reveal/settle
- draw refunds
- wrong reveal fails
- unjoined timeout cancel
- one-sided reveal forfeit
- faucet cooldown
- credit cannot transfer wallet-to-wallet

## X Layer Config

Official X Layer testnet:
- RPC: `https://testrpc.xlayer.tech/terigon`
- Chain ID: `1952`
- Explorer: `https://www.okx.com/web3/explorer/xlayer-test`

Official X Layer mainnet:
- RPC: `https://rpc.xlayer.tech`
- Chain ID: `196`
- Explorer: `https://www.okx.com/web3/explorer/xlayer`

Source: `https://web3.okx.com/xlayer/docs/developer/build-on-xlayer/network-information`

## X Layer Testnet Deployment

Deployer:
- `0x22B13afD9c5fa932EE439Cbca64890770F604284`

Contracts:
- `DuelCredit`: `0x87e31cc7fe76dc7d70c70867e34fef1447e339e9`
- `KickerNFT`: `0xb614e51deb5e4078b6bbb28ee32a70bc547e19df`
- `PenaltyDuel`: `0xbe9f77afd1d64e0f76572f08c4ed34a6a1ccbfd1`

Deployment txs:
- `DuelCredit`: `0xb2953dbe06dab33dcdbcaf5051c951750a417dda876db53eae6d0ae711945dd2`
- `KickerNFT`: `0xf3e65d8972085e7730c727824428d9788104c2835958eb49cfb095f8fb645236`
- `PenaltyDuel`: `0x1bba032a196627c60f2105113185c79c335d9fbd7bd70f61d058fd2aff181362`
- `DuelCredit.setDuelContract`: `0x8b32ac67583efbfdf0f8eee6887e964b3751859abcb6a30f42e34cfa31b8ac88`
- `KickerNFT.setDuelContract`: `0x868604503fc716337307f4b0f946f4d14cb567a43029e64b96312f722d488d02`

Proof wallets:
- Player one: `0x648C200356146f35beE46d59990F07eD6aaff8f0`
- Player two: `0xb072d8A4d85D395bAc3ec7cc9B660037C06D2224`

First settled duel proof:
- Duel: `#1`
- Create duel tx: `0xf390d54ea3dfbe6125cbb5a8ebd8baeaced36aa90531a3104be1870b3619e7ab`
- Join duel tx: `0xd39e643657d85874b01d1e1b0dd6e87440dab2176a6b0ead4391f45670487333`
- Player one reveal tx: `0xf4747aab0b5130bb1bf9a035e60a3248af9f2d37c3c15a98b7f6838dec87bf25`
- Player two reveal and settlement tx: `0x753d66f00fff9d28969de5c2f194c480b53c498168b1bba02084ecc66dbe9f98`

Readback after settlement:
- `nextDuelId`: `2`
- `duel #1` status: `Settled`
- Player one: Nigeria kicker, `105` DuelCredit, `1` win, `1` streak.
- Player two: France kicker, `95` DuelCredit, `1` loss.

`app/.env.local` is populated with public Vite contract addresses for local frontend testing.

## Next Panenka Step

- Hard-test the deployed frontend action flow against the live contracts.
- Hard-test the one-wallet bot flow against the live Vercel deployment.
- Polish the duel screen/reveal animation.
- Post the first X Layer testnet proof update with the duel tx or a short clip.
- Create a GitHub repo or add a remote, then commit and push the current scaffold.

## Open Issues / Caveats

- Scripts use `// @ts-nocheck` because viem Node-side ABI generics were slowing execution. Frontend and contracts are typechecked.
- `.env` and `app/.env.local` exist locally and are intentionally gitignored.
- X Layer testnet deployment is complete.
- Frontend action flow is wired but still needs manual browser testing against deployed contracts.
- App leaderboard currently has placeholder rows. Real leaderboard should read events later.
- Keep V1 simple. Do not add Tournament.sol, Twitter bot, real USDT staking, prediction markets, player likenesses, chat, cross-chain mechanics, or live match feeds.
