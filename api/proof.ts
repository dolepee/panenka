// @ts-nocheck
import { createPublicClient, defineChain, encodeAbiParameters, http, keccak256, parseAbi, parseAbiItem } from "viem";

const XLAYER_RPC_URL = process.env.XLAYER_RPC_URL ?? "https://testrpc.xlayer.tech/terigon";
const XLAYER_CHAIN_ID = Number(process.env.XLAYER_CHAIN_ID ?? 1952);
const XLAYER_EXPLORER =
  XLAYER_CHAIN_ID === 196
    ? "https://www.okx.com/web3/explorer/xlayer"
    : "https://www.okx.com/web3/explorer/xlayer-test";
const DUEL_CREDIT = (process.env.DUEL_CREDIT_ADDRESS ?? "0xcc3fa00814d3577512d419154b8e2bd2c3566071") as `0x${string}`;
const KICKER_NFT = (process.env.KICKER_NFT_ADDRESS ?? "0xb1344061536397e422e4db5d536e14c9b73ca8ba") as `0x${string}`;
const PENALTY_DUEL = (process.env.PENALTY_DUEL_ADDRESS ?? "0xb2760c0d27af86ab4e6b7b5f9c5ff7e1015ce2aa") as `0x${string}`;
const PROOF_FROM_BLOCK = 31328493n;
const PROOF_DUEL_ID = "1";
const MAX_LOG_RANGE_BLOCKS = 99n;
const PROOF_TXS = {
  create: "0xbc3118e3e017b37b35fd33efebec2326861e0c448b1bb5b73001d155120fa780",
  join: "0xf833710748cd673a75c2de08207f9e984083d5fb226cc7364acd8609cad18629",
  playerOneReveal: "0x4d80a46b57c9e842794cf2a051dfe2f0474b57be3202168bff5ae3eebded8fee",
  playerTwoRevealAndSettle: "0x591cfb717624c02d2862b805237d34f9d151f3228d70bc9e7b1dd414e13c9181",
};
const RECENT_LOG_LOOKBACK_BLOCKS = 12_000n;
const LOG_CHUNK_BATCH_SIZE = 12;
const KNOWN_SETTLEMENT_TXS: Record<string, string> = {
  [PROOF_DUEL_ID]: PROOF_TXS.playerTwoRevealAndSettle,
};
const EXHIBITION_WALLETS = new Set(
  [
    "0x50200E1ba23F6a4E58e09179E4e84DA8e796CbA8",
    "0xC40f5523B1D4209C587156D19432601b371A64aA",
    "0xAD2105762cBB0D43F3FF2FDF41f9C9F65b1A1D73",
    "0x0cAcF1D14fcc710CF21C3425eD0c0Cc5E654760e",
    "0x42432CC19d571506D991A13915FB746a923Da57F",
    "0x280a4BBdF192D1c1fC9B11D1cf9d3266e6AcC21C",
    "0xDa7E91a0Ce00CC692Fe139222075091f5b38Fe2D",
    "0x1B6823fEFBFBdAeAeE7aC1cc7a21ABB0cA011Bd4",
    "0x0dDC9E2c027480B35AaD502B977da6773e8A0349",
    "0xdD7526E89b4371614253f81Fcfb5222e98d60C1B",
    "0x96Ff784bf2fFddB3CFe5eD3a2F7fc06bC7A719A7",
    "0x866bf1aDccC3c576c411f0E4091dec7d09241936",
    "0xdb898e4768B900D4b741AC4F11D2d55F1847D813",
    "0x6a46205542149FcC2722095DD83DE34265b2B18d",
    "0x2F39aEb5FACb41Cc0eCD6faC1BE5bD5ff0B46571",
    "0x4Aa840ced2a6e96c4Fd635213FF8887Dc3c830B2",
    "0xCD0DC7D0BA48FF78d8ed51D0F17Cc4EEE01787A8",
    "0x9373F3a3b08F8df803e03c17875BC9941663AD1E",
    "0xD13c361F239AfC25Aabc779352D21ABee46bc56E",
    "0x1031d382817c2F673aF468896D49Fde66dCE49F1",
    "0xf42A04EBFB47EAE0deaB8AB9aFCa661aac24e47B",
    "0x8e4B0Eba2c6e7116b05505C6a54a6fb5cB471f43",
  ].map((address) => address.toLowerCase()),
);

const chain = defineChain({
  id: XLAYER_CHAIN_ID,
  name: XLAYER_CHAIN_ID === 196 ? "X Layer" : "X Layer Testnet",
  nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
  rpcUrls: { default: { http: [XLAYER_RPC_URL] } },
});

const kickerAbi = parseAbi([
  "function nextTokenId() external view returns (uint256)",
  "function ownerOf(uint256 tokenId) external view returns (address)",
  "function statsOf(uint256 tokenId) external view returns (uint8 countryId, uint32 wins, uint32 losses, uint32 streak, uint32 level)",
]);
const duelAbi = parseAbi([
  "function nextDuelId() external view returns (uint256)",
  "function getDuel(uint256 duelId) view returns ((uint256 stake,uint256 createdAt,uint256 joinedAt,uint256 firstRevealAt,uint8 status,(address player,uint256 kickerTokenId,bytes32 commitHash,bool revealed,uint8[10] shots,uint8[10] saves) p1,(address player,uint256 kickerTokenId,bytes32 commitHash,bool revealed,uint8[10] shots,uint8[10] saves) p2))",
]);
const settledEvent = parseAbiItem(
  "event DuelSettled(uint256 indexed duelId, address indexed winner, uint8 p1Score, uint8 p2Score, uint256 payout, bool draw)",
);
const statusLabels = ["Open", "Committed", "Settled", "Cancelled", "Forfeited"];
const countries: Record<number, string> = {
  1: "Argentina",
  2: "Brazil",
  3: "France",
  4: "Nigeria",
  5: "Japan",
  6: "England",
  7: "Morocco",
  8: "USA",
};

function addressUrl(address: string) {
  return `${XLAYER_EXPLORER}/address/${address}`;
}

function txUrl(hash: string) {
  return `${XLAYER_EXPLORER}/tx/${hash}`;
}

function field(value: any, key: string, index: number) {
  return value?.[key] ?? value?.[index];
}

function walletType(address?: string | null) {
  if (!address) return "unknown";
  return EXHIBITION_WALLETS.has(address.toLowerCase()) ? "exhibition" : "manual";
}

function planFields(player: any) {
  const shots = field(player, "shots", 4) ?? [];
  const saves = field(player, "saves", 5) ?? [];
  return {
    commitHash: field(player, "commitHash", 2),
    revealed: Boolean(field(player, "revealed", 3)),
    shots: Array.from({ length: 10 }, (_, index) => Number(shots[index] ?? 0)),
    saves: Array.from({ length: 10 }, (_, index) => Number(saves[index] ?? 0)),
  };
}

function normalizePlan(values?: readonly unknown[]) {
  return Array.from({ length: 10 }, (_, index) => Number(values?.[index] ?? 0));
}

function contractTiebreaksToP1(duel: any, duelId: bigint) {
  const p1 = field(duel, "p1", 5);
  const p2 = field(duel, "p2", 6);
  const p1Shots = normalizePlan(field(p1, "shots", 4));
  const p1Saves = normalizePlan(field(p1, "saves", 5));
  const p2Shots = normalizePlan(field(p2, "shots", 4));
  const p2Saves = normalizePlan(field(p2, "saves", 5));
  const hash = keccak256(
    encodeAbiParameters(
      [
        { type: "uint256" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "uint8[10]" },
        { type: "uint8[10]" },
        { type: "uint8[10]" },
        { type: "uint8[10]" },
      ],
      [
        duelId,
        field(p1, "commitHash", 2),
        field(p2, "commitHash", 2),
        p1Shots,
        p2Shots,
        p1Saves,
        p2Saves,
      ],
    ),
  );
  return BigInt(hash) % 2n === 0n;
}

async function getSettlementLogsChunked(client: any, fromBlock: bigint, toBlock: bigint) {
  const chunks = [];
  for (let start = fromBlock; start <= toBlock; start += MAX_LOG_RANGE_BLOCKS + 1n) {
    const end = start + MAX_LOG_RANGE_BLOCKS > toBlock ? toBlock : start + MAX_LOG_RANGE_BLOCKS;
    chunks.push({ fromBlock: start, toBlock: end });
  }
  const logs = [];
  for (let index = 0; index < chunks.length; index += LOG_CHUNK_BATCH_SIZE) {
    const batch = chunks.slice(index, index + LOG_CHUNK_BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map(({ fromBlock, toBlock }) =>
        client.getLogs({
          address: PENALTY_DUEL,
          event: settledEvent,
          fromBlock,
          toBlock,
        }),
      ),
    );
    for (const result of results) {
      if (result.status === "fulfilled") logs.push(...result.value);
    }
  }
  return logs;
}

function scoreDuel(duel: any, duelId: bigint) {
  const p1 = field(duel, "p1", 5);
  const p2 = field(duel, "p2", 6);
  const p1Shots = field(p1, "shots", 4) ?? [];
  const p1Saves = field(p1, "saves", 5) ?? [];
  const p2Shots = field(p2, "shots", 4) ?? [];
  const p2Saves = field(p2, "saves", 5) ?? [];
  let p1Score = 0;
  let p2Score = 0;
  const rounds = [];
  for (let index = 0; index < 10; index++) {
    const p1Goal = Number(p1Shots[index]) !== Number(p2Saves[index]);
    const p2Goal = Number(p2Shots[index]) !== Number(p1Saves[index]);
    if (p1Goal) p1Score += 1;
    if (p2Goal) p2Score += 1;
    rounds.push({ round: index + 1, p1Goal, p2Goal });

    const kicksTaken = index + 1;
    if (kicksTaken < 5) {
      const remaining = 5 - kicksTaken;
      if (p1Score > p2Score + remaining || p2Score > p1Score + remaining) break;
    } else if (p1Score !== p2Score) {
      break;
    }
  }
  if (p1Score === p2Score) {
    if (contractTiebreaksToP1(duel, duelId)) p1Score += 1;
    else p2Score += 1;
  }
  return { p1Score, p2Score, draw: false, rounds };
}

export default async function handler(_: any, response: any) {
  const client = createPublicClient({ chain, transport: http(XLAYER_RPC_URL) });
  const [latestBlock, nextTokenId, nextDuelId, code, proofReceipt] = await Promise.all([
    client.getBlockNumber(),
    client.readContract({ address: KICKER_NFT, abi: kickerAbi, functionName: "nextTokenId" }),
    client.readContract({ address: PENALTY_DUEL, abi: duelAbi, functionName: "nextDuelId" }),
    client.getBytecode({ address: PENALTY_DUEL }),
    client.getTransactionReceipt({ hash: PROOF_TXS.playerTwoRevealAndSettle as `0x${string}` }),
  ]);
  const kickerIds = Array.from({ length: Number((nextTokenId as bigint) - 1n) }, (_, index) => BigInt(index + 1));
  const kickerStats = await Promise.all(
    kickerIds.map(async (tokenId) => {
      try {
        const [owner, stats] = await Promise.all([
          client.readContract({ address: KICKER_NFT, abi: kickerAbi, functionName: "ownerOf", args: [tokenId] }),
          client.readContract({ address: KICKER_NFT, abi: kickerAbi, functionName: "statsOf", args: [tokenId] }),
        ]);
        return {
          tokenId: tokenId.toString(),
          owner,
          countryId: Number(stats[0]),
          wins: Number(stats[1]),
          losses: Number(stats[2]),
          streak: Number(stats[3]),
          level: Number(stats[4]),
        };
      } catch {
        return null;
      }
    }),
  );
  const readableKickers = kickerStats.filter(Boolean);
  const kickerById = Object.fromEntries(readableKickers.map((row) => [row.tokenId, row]));
  const countryIds = new Set(readableKickers.map((row) => row.countryId));
  const activeWallets = new Set(readableKickers.map((row) => row.owner?.toLowerCase()).filter(Boolean));
  let settlementByDuelId: Record<string, { hash: string; explorer: string; blockNumber: string | null; logIndex: number | null }> =
    Object.fromEntries(
      Object.entries(KNOWN_SETTLEMENT_TXS).map(([duelId, hash]) => [
        duelId,
        {
          hash,
          explorer: txUrl(hash),
          blockNumber: null,
          logIndex: null,
        },
      ]),
    );
  try {
    const fromBlock =
      latestBlock > RECENT_LOG_LOOKBACK_BLOCKS
        ? latestBlock - RECENT_LOG_LOOKBACK_BLOCKS
        : PROOF_FROM_BLOCK;
    const settlementLogs = await getSettlementLogsChunked(client, fromBlock > PROOF_FROM_BLOCK ? fromBlock : PROOF_FROM_BLOCK, latestBlock);
    settlementByDuelId = {
      ...settlementByDuelId,
      ...Object.fromEntries(
        settlementLogs.map((log) => [
          log.args.duelId?.toString() ?? "0",
          {
            hash: log.transactionHash,
            explorer: txUrl(log.transactionHash),
            blockNumber: log.blockNumber.toString(),
            logIndex: log.logIndex,
          },
        ]),
      ),
    };
  } catch {
    // X Layer testnet RPC can reject eth_getLogs. Keep pinned proof txs available.
  }
  const duelIds = Array.from({ length: Number((nextDuelId as bigint) - 1n) }, (_, index) => BigInt(index + 1));
  const duelReads = await Promise.all(
    duelIds.map(async (duelId) => {
      try {
        const state = await client.readContract({ address: PENALTY_DUEL, abi: duelAbi, functionName: "getDuel", args: [duelId] });
        const status = Number(field(state, "status", 4));
        const p1 = field(state, "p1", 5);
        const p2 = field(state, "p2", 6);
        const p1KickerTokenId = field(p1, "kickerTokenId", 1)?.toString?.() ?? "0";
        const p2KickerTokenId = field(p2, "kickerTokenId", 1)?.toString?.() ?? "0";
        const p1Kicker = kickerById[p1KickerTokenId];
        const p2Kicker = kickerById[p2KickerTokenId];
        const playerOne = field(p1, "player", 0);
        const playerTwo = field(p2, "player", 0);
        if (playerOne && playerOne !== "0x0000000000000000000000000000000000000000") activeWallets.add(playerOne.toLowerCase());
        if (playerTwo && playerTwo !== "0x0000000000000000000000000000000000000000") activeWallets.add(playerTwo.toLowerCase());
        const score = status === 2 ? scoreDuel(state, duelId) : null;
        const settlementTx = status === 2 ? settlementByDuelId[duelId.toString()] ?? null : null;
        return {
          duelId: duelId.toString(),
          status,
          statusLabel: statusLabels[status] ?? `Status ${status}`,
          playerOne,
          playerTwo,
          playerOneWalletType: walletType(playerOne),
          playerTwoWalletType: walletType(playerTwo),
          p1KickerTokenId,
          p2KickerTokenId,
          p1Country: countries[p1Kicker?.countryId] ?? null,
          p2Country: countries[p2Kicker?.countryId] ?? null,
          p1Revealed: Boolean(field(p1, "revealed", 3)),
          p2Revealed: Boolean(field(p2, "revealed", 3)),
          score: score ? `${score.p1Score}-${score.p2Score}` : null,
          draw: score?.draw ?? false,
          commitReveal: {
            playerOne: planFields(p1),
            playerTwo: planFields(p2),
          },
          settlementTx,
          settlementTxStatus: status !== 2 ? "not-settled" : settlementTx ? "available" : "unavailable",
        };
      } catch {
        return null;
      }
    }),
  );
  const duels = duelReads.filter(Boolean);
  const settledDuels = duels.filter((duel) => duel.status === 2);
  const manualWallets = Array.from(activeWallets).filter((address) => walletType(address) === "manual");
  const exhibitionWallets = Array.from(activeWallets).filter((address) => walletType(address) === "exhibition");
  const statusCounts = duels.reduce((acc, duel) => {
    acc[duel.statusLabel] = (acc[duel.statusLabel] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  response.status(200).json({
    project: "Panenka",
    oneLine: "Hidden-plan commit/reveal duels on X Layer, themed for the World Cup.",
    app: "https://panenka-alpha.vercel.app",
    repository: "https://github.com/dolepee/panenka",
    xAccount: "https://x.com/PanenkaGG",
    submission: {
      hackathon: "OKX X Layer Build X Hackathon / X Cup",
      primaryTracks: ["GameFi", "NFT", "Social"],
      theme: "World Cup penalty shootout duel game",
      demoPath: [
        "mint a country kicker",
        "claim non-transferable DuelCredit",
        "create a 1 DCR bot duel",
        "commit hidden shots and saves",
        "reveal both plans",
        "settle with early-stop and sudden-death shootout logic on X Layer",
        "update NFT stats and country leaderboard",
      ],
      safetyPositioning: {
        gameNotGamble: true,
        noRealMoneyBetting: true,
        noOfficialWorldCupOrFifaBranding: true,
        noPlayerLikenesses: true,
        noOracleOrLiveMatchFeed: true,
      },
    },
    chain: {
      name: chain.name,
      chainId: XLAYER_CHAIN_ID,
      latestBlock: latestBlock.toString(),
      explorer: XLAYER_EXPLORER,
    },
    contracts: {
      DuelCredit: { address: DUEL_CREDIT, explorer: addressUrl(DUEL_CREDIT) },
      KickerNFT: { address: KICKER_NFT, explorer: addressUrl(KICKER_NFT), nextTokenId: (nextTokenId as bigint).toString() },
      PenaltyDuel: {
        address: PENALTY_DUEL,
        explorer: addressUrl(PENALTY_DUEL),
        hasBytecode: Boolean(code && code !== "0x"),
      },
    },
    onchainActivity: {
      mintedKickers: Number((nextTokenId as bigint) - 1n),
      duelsCreated: Number((nextDuelId as bigint) - 1n),
      duelsIndexed: duels.length,
      settledDuels: settledDuels.length,
      openDuels: statusCounts.Open ?? 0,
      committedDuels: statusCounts.Committed ?? 0,
      cancelledDuels: statusCounts.Cancelled ?? 0,
      forfeitedDuels: statusCounts.Forfeited ?? 0,
      drawSettlements: settledDuels.filter((duel) => duel.draw).length,
      noDrawSettlement: true,
      statusCounts,
      proofFromBlock: PROOF_FROM_BLOCK.toString(),
      countryCount: countryIds.size,
      indexedKickers: readableKickers.length,
      activeWallets: activeWallets.size,
      manualWallets: manualWallets.length,
      exhibitionWallets: exhibitionWallets.length,
    },
    wallets: {
      total: activeWallets.size,
      manual: manualWallets.length,
      exhibition: exhibitionWallets.length,
      exhibitionPurpose:
        "Deterministic exhibition wallets demonstrate the full duel lifecycle at volume. Manual/tester wallets are counted separately.",
    },
    judgeSignals: {
      innovation:
        "The primitive is a commit/reveal hidden-plan duel: both players post a bytes32 commitment, then reveal a bounded shootout plan. The contract uses football-style early stop and sudden death so a duel always has a winner.",
      marketPotential: "Country kickers, country leaderboard, X result sharing, and one-wallet bot duels create repeatable World Cup fan activity.",
      completion: "Live app, X Layer contracts, one-wallet bot path, latest replay, leaderboard, and machine-readable proof endpoint are all deployed.",
      xLayerUsage: "Minting, faucet claims, duel creation, joins, reveals, settlement, DuelCredit movement, and KickerNFT stat updates happen on X Layer testnet.",
      onchainVerifiability: "Recent duels include settlement transaction links, and npm run verify:duel / npm run verify:live replay the proof trail.",
      safety: "Non-transferable in-game DuelCredit only; no real-money betting, no official branding, no player likenesses, no live-match oracle.",
    },
    recentDuels: duels.slice(-8).reverse(),
    proofDuel: {
      duelId: PROOF_DUEL_ID,
      matchup: "Nigeria 3-0 France",
      status: proofReceipt.status,
      transactions: Object.fromEntries(Object.entries(PROOF_TXS).map(([label, hash]) => [label, { hash, explorer: txUrl(hash) }])),
    },
    verifier: {
      command: "npm run verify:duel",
      successMarker: "PANENKA_DUEL_VALID",
    },
  });
}
