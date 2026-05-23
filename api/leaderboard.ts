// @ts-nocheck
import { createPublicClient, defineChain, http, parseAbi } from "viem";

const XLAYER_RPC_URL = process.env.XLAYER_RPC_URL ?? "https://testrpc.xlayer.tech/terigon";
const XLAYER_CHAIN_ID = Number(process.env.XLAYER_CHAIN_ID ?? 1952);
const KICKER_NFT = (process.env.KICKER_NFT_ADDRESS ?? "0x33dc85f938f21c8cf83556f444d16e61377a35a3") as `0x${string}`;

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

export default async function handler(_: any, response: any) {
  const client = createPublicClient({ chain, transport: http(XLAYER_RPC_URL) });
  const [latest, nextTokenId] = await Promise.all([
    client.getBlockNumber(),
    client.readContract({ address: KICKER_NFT, abi: kickerAbi, functionName: "nextTokenId" }),
  ]);

  const rows = [];
  for (let tokenId = 1n; tokenId < (nextTokenId as bigint); tokenId++) {
    try {
      const [owner, stats] = await Promise.all([
        client.readContract({ address: KICKER_NFT, abi: kickerAbi, functionName: "ownerOf", args: [tokenId] }),
        client.readContract({ address: KICKER_NFT, abi: kickerAbi, functionName: "statsOf", args: [tokenId] }),
      ]);
      rows.push({
        tokenId: tokenId.toString(),
        player: owner,
        countryId: Number(stats[0]),
        country: countries[Number(stats[0])] ?? `Country ${stats[0]}`,
        wins: Number(stats[1]),
        losses: Number(stats[2]),
        streak: Number(stats[3]),
        level: Number(stats[4]),
      });
    } catch {
      // Ignore burned or unreadable token IDs. Current MVP does not burn.
    }
  }

  const rankedRows = rows
    .sort((a, b) => b.wins - a.wins || b.streak - a.streak || a.losses - b.losses || Number(a.tokenId) - Number(b.tokenId))
    .slice(0, 12);
  const countryRows = Object.values(
    rows.reduce(
      (acc, row) => {
        const current = acc[row.country] ?? {
          countryId: row.countryId,
          country: row.country,
          kickers: 0,
          wins: 0,
          losses: 0,
          streak: 0,
          bestTokenId: row.tokenId,
        };
        current.kickers += 1;
        current.wins += row.wins;
        current.losses += row.losses;
        current.streak = Math.max(current.streak, row.streak);
        if (row.wins > (rows.find((candidate) => candidate.tokenId === current.bestTokenId)?.wins ?? -1)) {
          current.bestTokenId = row.tokenId;
        }
        acc[row.country] = current;
        return acc;
      },
      {} as Record<
        string,
        { countryId: number; country: string; kickers: number; wins: number; losses: number; streak: number; bestTokenId: string }
      >,
    ),
  ).sort((a, b) => b.wins - a.wins || b.streak - a.streak || a.losses - b.losses || a.country.localeCompare(b.country));

  response.status(200).json({
    chainId: XLAYER_CHAIN_ID,
    latestBlock: latest.toString(),
    nextTokenId: (nextTokenId as bigint).toString(),
    source: "KickerNFT ownerOf/statsOf",
    countryRows,
    rows: rankedRows,
  });
}
