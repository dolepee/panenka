// @ts-nocheck
import { createPublicClient, defineChain, http, parseAbi, parseAbiItem } from "viem";

const XLAYER_RPC_URL = process.env.XLAYER_RPC_URL ?? "https://testrpc.xlayer.tech/terigon";
const XLAYER_CHAIN_ID = Number(process.env.XLAYER_CHAIN_ID ?? 1952);
const XLAYER_EXPLORER =
  XLAYER_CHAIN_ID === 196
    ? "https://www.okx.com/web3/explorer/xlayer"
    : "https://www.okx.com/web3/explorer/xlayer-test";
const DUEL_CREDIT = (process.env.DUEL_CREDIT_ADDRESS ?? "0xcf8af8245abe1aeedc23b1f9c45ba84e17614c98") as `0x${string}`;
const KICKER_NFT = (process.env.KICKER_NFT_ADDRESS ?? "0x33dc85f938f21c8cf83556f444d16e61377a35a3") as `0x${string}`;
const PENALTY_DUEL = (process.env.PENALTY_DUEL_ADDRESS ?? "0xebd15b2baa79a84d6e509b2dae12526abe5dacdb") as `0x${string}`;
const PROOF_FROM_BLOCK = 31033500n;
const PROOF_DUEL_ID = "1";
const MAX_LOG_RANGE_BLOCKS = 99n;
const PROOF_TXS = {
  create: "0xd7977b7bf6a64c7de8917f4e1c70e54995e4bf076d2788c98f50da7747cd87f3",
  join: "0x8fbe70029798b0a40da767945a64787febd66ac7ab9656dba0126ba5b537eaa6",
  playerOneReveal: "0xdc7680675114e2e27f906a01824d746e29f5a57f56d1b66974271e06df82ac51",
  playerTwoRevealAndSettle: "0x8ac7ec41c0e1ca9eb0cee210ca52bf4835758d7081bce53ea2a84f0a2922ad9b",
};
const RECENT_LOG_LOOKBACK_BLOCKS = 2_500n;
const KNOWN_SETTLEMENT_TXS: Record<string, string> = {
  [PROOF_DUEL_ID]: PROOF_TXS.playerTwoRevealAndSettle,
  "22": "0x7a08f732edf8681145a2ded33b19da83c7e5dedabc98fdf6493a38f6055622cb",
  "23": "0x6db1104e367b756edb5d99ca146de0efae4aecccba68a77b4a492b30860087db",
  "24": "0xed30f880cbd26691fad621a9e520a5fe9b901e1be8a45def2245408f3792cc02",
  "25": "0xc7aae92391488f74846ae2c5c83bd3bf8ca964371b68186d7d6e4306edc33d72",
  "26": "0x791bbfeea7a7e7426f845c4306421c0e824f4b00df7505a131b39280d19d407c",
  "27": "0xd722d4b657649702aa75d6488b9607f32078fe9472fab0d5af5be53c63ff9d7a",
  "28": "0x962f4ebe93e725e5ff8f2a747f2f87eda97231598ff8d3e0b09caab40bd99275",
  "29": "0x8dd791767189608ad845e8e5130e6491ea118a145da1d11ba65b1137d5b0fbc1",
  "30": "0xb45e5bd1d66eef3985af1c4f8aa491a69214d210ae7bebf1ceb8a42826a84c62",
  "31": "0xe6c8a0038c113243191d03820d0742ab123a045c42bd3d9270a8ff0c25f5ecae",
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
  "function getDuel(uint256 duelId) view returns ((uint256 stake,uint256 createdAt,uint256 joinedAt,uint256 firstRevealAt,uint8 status,(address player,uint256 kickerTokenId,bytes32 commitHash,bool revealed,uint8[5] shots,uint8[5] saves) p1,(address player,uint256 kickerTokenId,bytes32 commitHash,bool revealed,uint8[5] shots,uint8[5] saves) p2))",
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
    shots: Array.from({ length: 5 }, (_, index) => Number(shots[index] ?? 0)),
    saves: Array.from({ length: 5 }, (_, index) => Number(saves[index] ?? 0)),
  };
}

async function getSettlementLogsChunked(client: any, fromBlock: bigint, toBlock: bigint) {
  const chunks = [];
  for (let start = fromBlock; start <= toBlock; start += MAX_LOG_RANGE_BLOCKS + 1n) {
    const end = start + MAX_LOG_RANGE_BLOCKS > toBlock ? toBlock : start + MAX_LOG_RANGE_BLOCKS;
    chunks.push(client.getLogs({
      address: PENALTY_DUEL,
      event: settledEvent,
      fromBlock: start,
      toBlock: end,
    }));
  }
  return (await Promise.all(chunks)).flat();
}

function scoreDuel(duel: any) {
  const p1 = field(duel, "p1", 5);
  const p2 = field(duel, "p2", 6);
  const p1Shots = field(p1, "shots", 4) ?? [];
  const p1Saves = field(p1, "saves", 5) ?? [];
  const p2Shots = field(p2, "shots", 4) ?? [];
  const p2Saves = field(p2, "saves", 5) ?? [];
  let p1Score = 0;
  let p2Score = 0;
  const rounds = [];
  for (let index = 0; index < 5; index++) {
    const p1Goal = Number(p1Shots[index]) !== Number(p2Saves[index]);
    const p2Goal = Number(p2Shots[index]) !== Number(p1Saves[index]);
    if (p1Goal) p1Score += 1;
    if (p2Goal) p2Score += 1;
    rounds.push({ round: index + 1, p1Goal, p2Goal });
  }
  return { p1Score, p2Score, draw: p1Score === p2Score, rounds };
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
        const score = status === 2 ? scoreDuel(state) : null;
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
        "settle best-of-five on X Layer",
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
        "The primitive is a commit/reveal hidden-plan duel: both players post a bytes32 commitment, then reveal a five-round shot and save plan. The contract proves neither player could change strategy after seeing the opponent. The penalty shootout is the World Cup wrapper.",
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
