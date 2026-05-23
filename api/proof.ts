// @ts-nocheck
import { createPublicClient, defineChain, http, parseAbi } from "viem";

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
const PROOF_TXS = {
  create: "0xd7977b7bf6a64c7de8917f4e1c70e54995e4bf076d2788c98f50da7747cd87f3",
  join: "0x8fbe70029798b0a40da767945a64787febd66ac7ab9656dba0126ba5b537eaa6",
  playerOneReveal: "0xdc7680675114e2e27f906a01824d746e29f5a57f56d1b66974271e06df82ac51",
  playerTwoRevealAndSettle: "0x8ac7ec41c0e1ca9eb0cee210ca52bf4835758d7081bce53ea2a84f0a2922ad9b",
};

const chain = defineChain({
  id: XLAYER_CHAIN_ID,
  name: XLAYER_CHAIN_ID === 196 ? "X Layer" : "X Layer Testnet",
  nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
  rpcUrls: { default: { http: [XLAYER_RPC_URL] } },
});

const kickerAbi = parseAbi([
  "function nextTokenId() external view returns (uint256)",
  "function statsOf(uint256 tokenId) external view returns (uint8 countryId, uint32 wins, uint32 losses, uint32 streak, uint32 level)",
]);
const duelAbi = parseAbi([
  "function nextDuelId() external view returns (uint256)",
  "function getDuel(uint256 duelId) view returns ((uint256 stake,uint256 createdAt,uint256 joinedAt,uint256 firstRevealAt,uint8 status,(address player,uint256 kickerTokenId,bytes32 commitHash,bool revealed,uint8[5] shots,uint8[5] saves) p1,(address player,uint256 kickerTokenId,bytes32 commitHash,bool revealed,uint8[5] shots,uint8[5] saves) p2))",
]);
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
        const stats = await client.readContract({ address: KICKER_NFT, abi: kickerAbi, functionName: "statsOf", args: [tokenId] });
        return {
          tokenId: tokenId.toString(),
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
        const score = status === 2 ? scoreDuel(state) : null;
        return {
          duelId: duelId.toString(),
          status,
          statusLabel: statusLabels[status] ?? `Status ${status}`,
          playerOne: field(p1, "player", 0),
          playerTwo: field(p2, "player", 0),
          p1KickerTokenId,
          p2KickerTokenId,
          p1Country: countries[p1Kicker?.countryId] ?? null,
          p2Country: countries[p2Kicker?.countryId] ?? null,
          p1Revealed: Boolean(field(p1, "revealed", 3)),
          p2Revealed: Boolean(field(p2, "revealed", 3)),
          score: score ? `${score.p1Score}-${score.p2Score}` : null,
          draw: score?.draw ?? false,
        };
      } catch {
        return null;
      }
    }),
  );
  const duels = duelReads.filter(Boolean);
  const settledDuels = duels.filter((duel) => duel.status === 2);
  const statusCounts = duels.reduce((acc, duel) => {
    acc[duel.statusLabel] = (acc[duel.statusLabel] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  response.status(200).json({
    project: "Panenka",
    oneLine: "World Cup penalty shootout duels on X Layer: mint, commit hidden plans, reveal, settle, rank countries.",
    app: "https://panenka-alpha.vercel.app",
    repository: "https://github.com/dolepee/panenka",
    xAccount: "https://x.com/PanenkaGG",
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
