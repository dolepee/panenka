// @ts-nocheck
import { createPublicClient, defineChain, http, parseAbi, parseAbiItem } from "viem";

const XLAYER_RPC_URL = process.env.XLAYER_RPC_URL ?? "https://testrpc.xlayer.tech/terigon";
const XLAYER_CHAIN_ID = Number(process.env.XLAYER_CHAIN_ID ?? 1952);
const KICKER_NFT = (process.env.KICKER_NFT_ADDRESS ?? "0xb614e51deb5e4078b6bbb28ee32a70bc547e19df") as `0x${string}`;

const chain = defineChain({
  id: XLAYER_CHAIN_ID,
  name: XLAYER_CHAIN_ID === 196 ? "X Layer" : "X Layer Testnet",
  nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
  rpcUrls: { default: { http: [XLAYER_RPC_URL] } },
});

const mintedEvent = parseAbiItem("event KickerMinted(address indexed player, uint256 indexed tokenId, uint8 countryId)");
const statsEvent = parseAbiItem(
  "event KickerStatsUpdated(uint256 indexed tokenId, uint32 wins, uint32 losses, uint32 streak, uint32 level)",
);
const kickerAbi = parseAbi([
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

async function chunkedLogs(client: any, event: any, fromBlock: bigint, toBlock: bigint) {
  const logs = [];
  for (let from = fromBlock; from <= toBlock; from += 100n) {
    const to = from + 99n > toBlock ? toBlock : from + 99n;
    logs.push(...(await client.getLogs({ address: KICKER_NFT, event, fromBlock: from, toBlock: to })));
  }
  return logs;
}

export default async function handler(_: any, response: any) {
  const client = createPublicClient({ chain, transport: http(XLAYER_RPC_URL) });
  const latest = await client.getBlockNumber();
  const fromBlock = latest > 1500n ? latest - 1500n : 1n;

  const minted = await chunkedLogs(client, mintedEvent, fromBlock, latest);
  const updates = await chunkedLogs(client, statsEvent, fromBlock, latest);

  const byToken = new Map<string, any>();
  for (const log of minted) {
    const tokenId = log.args.tokenId.toString();
    byToken.set(tokenId, {
      tokenId,
      player: log.args.player,
      countryId: Number(log.args.countryId),
      country: countries[Number(log.args.countryId)] ?? `Country ${log.args.countryId}`,
      wins: 0,
      losses: 0,
      streak: 0,
      level: 1,
    });
  }

  for (const log of updates) {
    const tokenId = log.args.tokenId.toString();
    const row = byToken.get(tokenId) ?? { tokenId, player: "unknown", countryId: 0, country: "Unknown" };
    row.wins = Number(log.args.wins);
    row.losses = Number(log.args.losses);
    row.streak = Number(log.args.streak);
    row.level = Number(log.args.level);
    byToken.set(tokenId, row);
  }

  for (const row of byToken.values()) {
    try {
      const [owner, stats] = await Promise.all([
        client.readContract({ address: KICKER_NFT, abi: kickerAbi, functionName: "ownerOf", args: [BigInt(row.tokenId)] }),
        client.readContract({ address: KICKER_NFT, abi: kickerAbi, functionName: "statsOf", args: [BigInt(row.tokenId)] }),
      ]);
      row.player = owner;
      row.countryId = Number(stats[0]);
      row.country = countries[Number(stats[0])] ?? `Country ${stats[0]}`;
      row.wins = Number(stats[1]);
      row.losses = Number(stats[2]);
      row.streak = Number(stats[3]);
      row.level = Number(stats[4]);
    } catch {
      // Keep event-derived fallback if a token read fails.
    }
  }

  const rows = [...byToken.values()]
    .sort((a, b) => b.wins - a.wins || b.streak - a.streak || a.losses - b.losses || Number(a.tokenId) - Number(b.tokenId))
    .slice(0, 12);

  response.status(200).json({
    chainId: XLAYER_CHAIN_ID,
    latestBlock: latest.toString(),
    scannedFrom: fromBlock.toString(),
    rows,
  });
}
