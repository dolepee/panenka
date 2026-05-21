import { defineChain, parseAbi } from "viem";

export const XLAYER_CHAIN_ID = Number(import.meta.env.VITE_XLAYER_CHAIN_ID ?? 1952);
export const XLAYER_RPC_URL = import.meta.env.VITE_XLAYER_RPC_URL ?? "https://testrpc.xlayer.tech/terigon";
export const XLAYER_EXPLORER =
  XLAYER_CHAIN_ID === 196
    ? "https://www.okx.com/web3/explorer/xlayer"
    : "https://www.okx.com/web3/explorer/xlayer-test";

export const xLayer = defineChain({
  id: XLAYER_CHAIN_ID,
  name: XLAYER_CHAIN_ID === 196 ? "X Layer" : "X Layer Testnet",
  nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
  rpcUrls: { default: { http: [XLAYER_RPC_URL] } },
  blockExplorers: { default: { name: "OKX Explorer", url: XLAYER_EXPLORER } },
});

const testnetAddresses =
  XLAYER_CHAIN_ID === 1952
    ? {
        duelCredit: "0x87e31cc7fe76dc7d70c70867e34fef1447e339e9" as const,
        kickerNft: "0xb614e51deb5e4078b6bbb28ee32a70bc547e19df" as const,
        penaltyDuel: "0xbe9f77afd1d64e0f76572f08c4ed34a6a1ccbfd1" as const,
      }
    : {};

export const addresses = {
  duelCredit: (import.meta.env.VITE_DUEL_CREDIT_ADDRESS ?? testnetAddresses.duelCredit) as `0x${string}` | undefined,
  kickerNft: (import.meta.env.VITE_KICKER_NFT_ADDRESS ?? testnetAddresses.kickerNft) as `0x${string}` | undefined,
  penaltyDuel: (import.meta.env.VITE_PENALTY_DUEL_ADDRESS ?? testnetAddresses.penaltyDuel) as `0x${string}` | undefined,
};

export const hasContracts = Boolean(addresses.duelCredit && addresses.kickerNft && addresses.penaltyDuel);

export const duelCreditAbi = parseAbi([
  "function claimFaucet() external",
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function balanceOf(address owner) external view returns (uint256)",
  "function allowance(address owner, address spender) external view returns (uint256)",
]);

export const kickerNftAbi = parseAbi([
  "function mint(uint8 countryId) external returns (uint256)",
  "function tokenOfOwner(address owner) external view returns (uint256)",
  "function statsOf(uint256 tokenId) external view returns (uint8 countryId, uint32 wins, uint32 losses, uint32 streak, uint32 level)",
]);

export const penaltyDuelAbi = parseAbi([
  "function nextDuelId() external view returns (uint256)",
  "function createDuel(uint256 stake, uint256 kickerTokenId, bytes32 commitHash) external returns (uint256)",
  "function joinDuel(uint256 duelId, uint256 kickerTokenId, bytes32 commitHash) external",
  "function reveal(uint256 duelId, uint8[5] shots, uint8[5] saves, bytes32 salt) external",
  "function getDuel(uint256 duelId) view returns ((uint256 stake,uint256 createdAt,uint256 joinedAt,uint256 firstRevealAt,uint8 status,(address player,uint256 kickerTokenId,bytes32 commitHash,bool revealed,uint8[5] shots,uint8[5] saves) p1,(address player,uint256 kickerTokenId,bytes32 commitHash,bool revealed,uint8[5] shots,uint8[5] saves) p2))",
  "event RoundResolved(uint256 indexed duelId, uint8 round, bool p1Goal, bool p2Goal, uint8 p1Shot, uint8 p2Shot, uint8 p1Save, uint8 p2Save)",
  "event DuelSettled(uint256 indexed duelId, address indexed winner, uint8 p1Score, uint8 p2Score, uint256 payout, bool draw)",
]);
