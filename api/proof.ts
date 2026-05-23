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

const kickerAbi = parseAbi(["function nextTokenId() external view returns (uint256)"]);
const duelAbi = parseAbi(["function nextDuelId() external view returns (uint256)"]);

function addressUrl(address: string) {
  return `${XLAYER_EXPLORER}/address/${address}`;
}

function txUrl(hash: string) {
  return `${XLAYER_EXPLORER}/tx/${hash}`;
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
      proofFromBlock: PROOF_FROM_BLOCK.toString(),
    },
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
