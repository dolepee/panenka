# Panenka Build Plan

## Final Verdict

Build Panenka, but ship the simplified MVP only. Do not build Claude's full real-money tournament version for V1.

Panenka is an onchain penalty shootout duel game on X Layer. Two wallets mint country kicker NFTs, commit hidden shootout plans, reveal, and the contract settles a best-of-5 with DuelCredit escrow, NFT stats, and leaderboard events.

## Final One-Line Pitch

Panenka turns penalty shootouts into onchain duels on X Layer: mint a country kicker NFT, commit hidden shots and saves, reveal, and let the contract settle a best-of-5 with onchain stats and a leaderboard.

## Locked MVP

1. Connect with OKX Wallet.
2. Mint or pick a country kicker NFT.
3. Create or join a duel staking DuelCredit, not real money.
4. Both players commit a hidden 5-round shot/save plan.
5. Both players reveal.
6. Contract settles the best-of-5.
7. Credits move from loser to winner, or refund on draw.
8. Kicker stats update: wins, losses, streak, level.
9. Leaderboard reads from events and contract state.
10. Every duel produces clickable X Layer explorer links.

## Critical Technical Simplification

Do not commit and reveal every round separately.

Use one commit transaction per player and one reveal transaction per player.

The reveal contains five shot directions and five keeper directions. When the second player reveals, the contract settles the full duel and emits five `RoundResolved` events. The frontend animates the five rounds from the revealed data.

This keeps the product exciting without making the contract or UI fragile.

## Why This Can Win

- Penalty shootouts are universally understood by football fans.
- The demo is clear in under two minutes.
- The core action produces real onchain transactions on X Layer.
- It is not another prediction market clone.
- It avoids live match data and oracle dependency.
- It avoids real-money gambling optics in V1 by using DuelCredit.
- The wow moment is visual: ball flies, keeper dives, score updates, tx hash appears.

## Biggest Risk

The project could be mistaken for a betting app.

Mitigation:

- Use `DuelCredit`, not real USDT, in the main demo.
- Use words like duel, kicker, shootout, credits, challenge.
- Avoid words like bet, wager, odds, market, profit.
- Show NFT progression and leaderboard so it reads as a game.

## Contracts

### DuelCredit.sol

Purpose: in-game credit for duels.

Requirements:

- ERC20-style token.
- Faucet gives `100` credits per address per day.
- Non-transferable wallet-to-wallet.
- Transfer allowed only to and from `PenaltyDuel`.
- Used for escrow and payouts.

Events:

- `CreditFaucetClaimed(address indexed user, uint256 amount)`

### KickerNFT.sol

Purpose: country kicker identity and progression.

Requirements:

- ERC721.
- Stores `countryId`, `wins`, `losses`, `streak`, `level`.
- Mint 8 to 16 country options for MVP.
- `recordWin(tokenId)` callable only by `PenaltyDuel`.
- `recordLoss(tokenId)` callable only by `PenaltyDuel`.
- Simple SVG metadata with country colors.
- No official FIFA assets, player names, or likenesses.

Events:

- `KickerMinted(address indexed player, uint256 indexed tokenId, uint8 countryId)`

### PenaltyDuel.sol

Purpose: create, join, commit, reveal, settle, and forfeit duels.

Requirements:

- `createDuel(uint256 stake, uint256 kickerTokenId, bytes32 commitHash)`
- `joinDuel(uint256 duelId, uint256 kickerTokenId, bytes32 commitHash)`
- `reveal(uint256 duelId, uint8[5] shots, uint8[5] saves, bytes32 salt)`
- `cancelUnjoinedDuel(uint256 duelId)` after timeout.
- `claimForfeit(uint256 duelId)` if one player refuses to reveal.
- Internal `_settle(duelId)` called when both reveals are valid.
- Winner receives the credit pot.
- Draw refunds both players.
- Winner NFT gets win and streak update.
- Loser NFT gets loss and streak reset.

Events:

- `DuelCreated(uint256 indexed duelId, address indexed creator, uint256 stake, uint256 kickerTokenId, bytes32 commitHash)`
- `DuelJoined(uint256 indexed duelId, address indexed opponent, uint256 kickerTokenId, bytes32 commitHash)`
- `PlayerRevealed(uint256 indexed duelId, address indexed player)`
- `RoundResolved(uint256 indexed duelId, uint8 round, bool p1Goal, bool p2Goal, uint8 p1Shot, uint8 p2Shot, uint8 p1Save, uint8 p2Save)`
- `DuelSettled(uint256 indexed duelId, address indexed winner, uint8 p1Score, uint8 p2Score, uint256 payout, bool draw)`
- `DuelForfeited(uint256 indexed duelId, address indexed winner, address indexed loser)`

## Direction Encoding

Use simple direction integers:

- `0`: left
- `1`: center
- `2`: right

A shot is saved if the keeper chooses the same direction as the shooter. Otherwise it is a goal.

Each player reveals:

- `shots[5]`: their five penalty shots.
- `saves[5]`: their five keeper guesses.
- `salt`: secret used in commit.

Commit hash:

```solidity
keccak256(abi.encodePacked(duelId, player, shots, saves, salt))
```

If including `duelId` before creation is awkward for the creator, use:

```solidity
keccak256(abi.encodePacked(player, shots, saves, salt))
```

Keep it simple and test carefully.

## Frontend Pages

### `/`

Purpose: landing and quick start.

Content:

- Hero: "Penalty shootout duels, settled on X Layer."
- Open duels.
- Recent settled duels.
- Play now CTA.
- Contract links and live stats.

### `/play`

Purpose: create and join duels.

Content:

- Connect OKX Wallet.
- Claim DuelCredit.
- Mint/select country kicker.
- Create duel with stake.
- Join open duel.

### `/duel/:id`

Purpose: core game screen.

Content:

- Duel state.
- Player addresses.
- Kicker NFTs.
- Commit form.
- Reveal form.
- 5-round animation.
- Final result.
- Settlement tx link.

### `/leaderboard`

Purpose: public proof of competition.

Content:

- Top kickers by wins.
- Top streaks.
- Recent winners.
- Links to settlement txs.

Read from events and contract state. Do not build a leaderboard contract.

### `/me`

Purpose: user profile.

Content:

- Wallet.
- DuelCredit balance.
- Kicker NFT.
- Active duels.
- Duel history.
- Win/loss/streak.

## Backend / Indexer

Keep it minimal.

Options:

1. Frontend reads events directly with `viem getLogs`.
2. Add a tiny API route if RPC/CORS/rate limit becomes annoying.

Do not build a subgraph.

Data to derive:

- Open duels from `DuelCreated` minus joined/settled/cancelled.
- Settled duels from `DuelSettled`.
- Leaderboard from `KickerNFT` stats and settlement events.
- User history by filtering duel events by player address.

## Scripts

- `deploy.ts` or Foundry deploy script.
- `mint-demo-kickers.ts`.
- `create-demo-duel.ts`.
- `settle-demo-duel.ts`.
- `verify-duel.ts`.
- `export-addresses.ts`.

## Tests

Minimum required tests:

1. Faucet claim works.
2. Faucet cooldown blocks repeat claim.
3. DuelCredit cannot transfer wallet-to-wallet.
4. Create duel escrows credits.
5. Join duel escrows credits.
6. Wrong reveal fails.
7. Valid reveal settles when both players reveal.
8. Winner receives credit pot.
9. Draw refunds both players.
10. Kicker win/loss/streak updates.
11. Timeout cancel works.
12. Forfeit works if one player refuses to reveal.

## Demo Seed Data

- 8 country options.
- 2 controlled wallets.
- 10 to 20 pre-settled duels.
- 1 live duel for recording.
- 5 to 10 public tester wallets if possible.
- One clean non-draw duel scripted for the demo video.

## Strict Cuts

Do not build:

- Real USDT winner-takes-all.
- `Tournament.sol`.
- Auto X bot.
- Subgraph.
- Live match feeds.
- Spectator betting.
- Friend invite links.
- Chat.
- Player likenesses.
- FIFA or World Cup logos.
- 48 polished country assets.
- AI manager.
- Cross-chain features.

## 10-Day Implementation Plan

### Day 1: May 19

- Init repo.
- Lock project name and X handle.
- Scaffold Foundry or Hardhat.
- Scaffold frontend.
- Build `DuelCredit.sol` skeleton.
- Build `PenaltyDuel.sol` skeleton.
- Post X launch tease.

Gate: repo exists, first contracts compile.

### Day 2

- Finish commit/reveal/settle.
- Add timeout and forfeit.
- Write core tests.
- Deploy first version to X Layer testnet.
- Post first X Layer tx.

Gate: commit-reveal duel works by script.

### Day 3

- Add `KickerNFT.sol`.
- Wire stats updates from `PenaltyDuel`.
- Add country metadata.
- Run first end-to-end duel by script.

Gate: winner NFT stats update onchain.

### Day 4

- Build `/play`.
- Build `/duel/:id`.
- Add OKX Wallet connect.
- Create/join/commit/reveal from UI.
- Post first UI-driven duel tx.

Gate: UI-driven duel works between two wallets.

### Day 5

- Add reveal animation.
- Add `/leaderboard`.
- Add `/me`.
- Make tx links visible everywhere.

Gate: demo loop is visually understandable.

### Day 6

- Polish country kicker visuals.
- Add empty/loading/error states.
- Public invite thread: "reply with country, get a kicker and credits."

Gate: external testers can play without guidance.

### Day 7

- Drive real duels.
- Fix tester bugs.
- Target 30+ settled duels.
- Target 5 to 10 distinct wallets.

Gate: enough onchain activity for judging.

### Day 8

- Record 90 to 120 second demo.
- Post demo video.
- Add demo link to README.

Gate: submission video ready.

### Day 9

- README polish.
- Add contract addresses.
- Add tx proof section.
- Mainnet deploy only if smooth and not risky.
- Draft submission form.

Gate: submission materials complete.

### Day 10: May 28

- Final test pass.
- Submit Google Form.
- Post X submission thread tagging `@XLayerOfficial`.

Gate: submitted before 23:59 UTC.

## Non-Negotiable Gates

- Commit-reveal duel works by Day 2.
- X Layer testnet deployment by Day 2 or early Day 3.
- UI-driven duel by Day 4.
- Reveal animation by Day 5.
- X account posts from Day 1.
- Demo recorded by Day 8.

## X / Twitter Strategy

Handle: `@PanenkaFC` if available. Backup: `@PanenkaCup`.

Every post must include a screen clip, tx link, or both.

Posting schedule:

- Day 1: launch tease.
- Day 2: contract tests and first tx.
- Day 3: country kicker reveal grid.
- Day 4: first live duel clip.
- Day 5: reveal animation clip.
- Day 6: invite thread.
- Day 7: leaderboard snapshot.
- Day 8: demo video drop.
- Day 9: mainnet or final testnet proof.
- Day 10: submission thread tagging `@XLayerOfficial`.

Avoid stock images. Avoid FIFA marks. Avoid player photos.

## Demo Flow: 90 to 120 Seconds

0 to 10s:
Title card and homepage.

VO: "Panenka turns World Cup penalty shootouts into onchain duels on X Layer."

10 to 25s:
Connect OKX Wallet, mint country kicker, enter lobby.

25 to 40s:
Create duel staking 5 DuelCredit. Opponent joins. Both commit hidden plans.

40 to 75s:
Reveal. Five-round animation plays: ball flies, keeper dives, score updates.

75 to 90s:
Winner takes the credit pot. Kicker streak increments onchain.

90 to 105s:
Leaderboard updates. Winner climbs.

105 to 115s:
X Layer explorer shows settlement tx and events.

115 to 120s:
Closing card.

Closing line:

"Game, not gamble. Every duel is verifiable on X Layer."

## Submission Headline

Panenka turns penalty shootouts into onchain duels on X Layer. Two players pick country kicker NFTs, commit hidden shots and saves, reveal, and the contract settles a best-of-5 with onchain stats and a leaderboard. The World Cup ritual every fan already understands, now verifiable in one tx.

## Language Rules

Use:

- Duel
- Shootout
- Kicker
- Country
- Credits
- Challenge
- Commit
- Reveal
- Onchain stats
- Leaderboard

Avoid:

- Bet
- Wager
- Odds
- Market
- Profit
- Casino
- Gambling
- FIFA
- Official World Cup
- Player names or likenesses

## Build / No-Build Decision

Build.

Start Day 1 immediately. Do not reopen StickerCup, ChantFloor, prediction markets, AI manager, or real-money tournament ideas. The next work is execution only.
