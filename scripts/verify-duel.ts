// @ts-nocheck
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createPublicClient, defineChain, formatUnits, http, keccak256, toHex, type Abi } from "viem";

type Artifact = { abi: Abi };
type Deployment = {
  chainId: number;
  contracts: {
    duelCredit: `0x${string}`;
    kickerNft: `0x${string}`;
    penaltyDuel: `0x${string}`;
  };
  proof: {
    duelId: string;
    playerOne: `0x${string}`;
    playerTwo: `0x${string}`;
    transactions: Record<string, `0x${string}`>;
    readback: Record<string, string>;
  };
  latestProof?: {
    duelId: string;
    matchup: string;
    playerOne: `0x${string}`;
    playerTwo: `0x${string}`;
    settlement: `0x${string}`;
    readback: Record<string, string>;
  };
};

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const settledTopic = keccak256(toHex("DuelSettled(uint256,address,uint8,uint8,uint256,bool)"));

function artifact(name: string): Artifact {
  return JSON.parse(readFileSync(resolve(root, "out", `${name}.sol`, `${name}.json`), "utf8")) as Artifact;
}

function deployment(chainId: number): Deployment {
  return JSON.parse(readFileSync(resolve(root, "deployments", `${chainId}.json`), "utf8")) as Deployment;
}

function assertOk(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

function field(value: any, key: string, index: number) {
  return value?.[key] ?? value?.[index];
}

function scoreDuel(duelState: any) {
  const p1 = field(duelState, "p1", 5);
  const p2 = field(duelState, "p2", 6);
  const p1Shots = field(p1, "shots", 4) ?? [];
  const p1Saves = field(p1, "saves", 5) ?? [];
  const p2Shots = field(p2, "shots", 4) ?? [];
  const p2Saves = field(p2, "saves", 5) ?? [];
  let p1Score = 0;
  let p2Score = 0;
  for (let index = 0; index < 10; index++) {
    if (Number(p1Shots[index]) !== Number(p2Saves[index])) p1Score += 1;
    if (Number(p2Shots[index]) !== Number(p1Saves[index])) p2Score += 1;
    const kicksTaken = index + 1;
    if (kicksTaken < 5) {
      const remaining = 5 - kicksTaken;
      if (p1Score > p2Score + remaining || p2Score > p1Score + remaining) break;
    } else if (p1Score !== p2Score) {
      break;
    }
  }
  if (p1Score === p2Score) p1Score += 1;
  return `${p1Score}-${p2Score}`;
}

async function main() {
  const rpcUrl = process.env.XLAYER_RPC_URL ?? "https://testrpc.xlayer.tech/terigon";
  const chainId = Number(process.env.XLAYER_CHAIN_ID ?? 1952);
  const deployed = deployment(chainId);
  const { contracts, proof } = deployed;

  const chain = defineChain({
    id: chainId,
    name: chainId === 196 ? "X Layer" : "X Layer Testnet",
    nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  });
  const client = createPublicClient({ chain, transport: http(rpcUrl) });
  const credit = artifact("DuelCredit");
  const kicker = artifact("KickerNFT");
  const duel = artifact("PenaltyDuel");

  const liveChainId = await client.getChainId();
  assertOk(liveChainId === chainId, `wrong chain: expected ${chainId}, got ${liveChainId}`);

  for (const [label, address] of Object.entries(contracts)) {
    const bytecode = await client.getBytecode({ address: address as `0x${string}` });
    assertOk(bytecode && bytecode !== "0x", `${label} has no bytecode at ${address}`);
  }

  const [creditDuelContract, kickerDuelContract, nextDuelId] = await Promise.all([
    client.readContract({ address: contracts.duelCredit, abi: credit.abi, functionName: "duelContract" }),
    client.readContract({ address: contracts.kickerNft, abi: kicker.abi, functionName: "duelContract" }),
    client.readContract({ address: contracts.penaltyDuel, abi: duel.abi, functionName: "nextDuelId" }),
  ]);
  assertOk(String(creditDuelContract).toLowerCase() === contracts.penaltyDuel.toLowerCase(), "DuelCredit route mismatch");
  assertOk(String(kickerDuelContract).toLowerCase() === contracts.penaltyDuel.toLowerCase(), "KickerNFT route mismatch");
  assertOk(BigInt(nextDuelId as bigint) > BigInt(proof.duelId), "proof duel is not below nextDuelId");

  async function verifySettledDuel({
    label,
    duelId,
    playerOne,
    playerTwo,
    settlement,
    expectedScore,
  }: {
    label: string;
    duelId: string;
    playerOne: `0x${string}`;
    playerTwo: `0x${string}`;
    settlement: `0x${string}`;
    expectedScore?: string;
  }) {
    const duelState = await client.readContract({
      address: contracts.penaltyDuel,
      abi: duel.abi,
      functionName: "getDuel",
      args: [BigInt(duelId)],
    });
    const status = Number(field(duelState, "status", 4));
    const p1 = field(duelState, "p1", 5);
    const p2 = field(duelState, "p2", 6);
    assertOk(status === 2, `${label} duel #${duelId} is not settled`);
    assertOk(String(field(p1, "player", 0)).toLowerCase() === playerOne.toLowerCase(), `${label} player one mismatch`);
    assertOk(String(field(p2, "player", 0)).toLowerCase() === playerTwo.toLowerCase(), `${label} player two mismatch`);
    assertOk(String(field(p1, "player", 0)).toLowerCase() !== ZERO_ADDRESS, `${label} player one is zero`);
    assertOk(String(field(p2, "player", 0)).toLowerCase() !== ZERO_ADDRESS, `${label} player two is zero`);
    assertOk(Boolean(field(p1, "revealed", 3)) && Boolean(field(p2, "revealed", 3)), `${label} both players did not reveal`);

    const receipt = await client.getTransactionReceipt({ hash: settlement });
    assertOk(receipt.status === "success", `${label} settlement tx failed: ${settlement}`);
    assertOk(
      receipt.logs.some(
        (log) => log.address.toLowerCase() === contracts.penaltyDuel.toLowerCase() && log.topics[0]?.toLowerCase() === settledTopic,
      ),
      `${label} settlement tx does not emit DuelSettled`,
    );

    const score = scoreDuel(duelState);
    if (expectedScore) assertOk(score === expectedScore, `${label} score mismatch: expected ${expectedScore}, got ${score}`);
    return { duelState, p1, p2, score };
  }

  const { p1, p2 } = await verifySettledDuel({
    label: "baseline",
    duelId: proof.duelId,
    playerOne: proof.playerOne,
    playerTwo: proof.playerTwo,
    settlement: proof.transactions.playerTwoRevealAndSettle,
    expectedScore: proof.readback.score,
  });

  const receipts = await Promise.all(
    Object.entries(proof.transactions).map(async ([label, hash]) => {
      const receipt = await client.getTransactionReceipt({ hash });
      assertOk(receipt.status === "success", `${label} tx failed: ${hash}`);
      return { label, hash, receipt };
    }),
  );
  const settlementReceipt = receipts.find(({ label }) => label === "playerTwoRevealAndSettle")?.receipt;
  assertOk(settlementReceipt, "missing settlement receipt");
  assertOk(
    settlementReceipt.logs.some(
      (log) => log.address.toLowerCase() === contracts.penaltyDuel.toLowerCase() && log.topics[0]?.toLowerCase() === settledTopic,
    ),
    "settlement tx does not emit DuelSettled",
  );

  const [p1Balance, p2Balance, p1Stats, p2Stats] = await Promise.all([
    client.readContract({ address: contracts.duelCredit, abi: credit.abi, functionName: "balanceOf", args: [proof.playerOne] }),
    client.readContract({ address: contracts.duelCredit, abi: credit.abi, functionName: "balanceOf", args: [proof.playerTwo] }),
    client.readContract({ address: contracts.kickerNft, abi: kicker.abi, functionName: "statsOf", args: [field(p1, "kickerTokenId", 1)] }),
    client.readContract({ address: contracts.kickerNft, abi: kicker.abi, functionName: "statsOf", args: [field(p2, "kickerTokenId", 1)] }),
  ]);

  const p1Wins = Number(field(p1Stats, "wins", 1));
  const p2Losses = Number(field(p2Stats, "losses", 2));
  assertOk(p1Wins >= Number(proof.readback.playerOneWins), "player one win stat is below proof baseline");
  assertOk(p2Losses >= Number(proof.readback.playerTwoLosses), "player two loss stat is below proof baseline");

  const latest = deployed.latestProof
    ? await verifySettledDuel({
        label: "latest",
        duelId: deployed.latestProof.duelId,
        playerOne: deployed.latestProof.playerOne,
        playerTwo: deployed.latestProof.playerTwo,
        settlement: deployed.latestProof.settlement,
        expectedScore: deployed.latestProof.readback.score,
      })
    : null;

  console.log("PANENKA_DUEL_VALID");
  console.log(`chain: ${chainId}`);
  console.log(`PenaltyDuel: ${contracts.penaltyDuel}`);
  console.log(`baseline duel: #${proof.duelId}, status: Settled, score: ${proof.readback.score}`);
  console.log(`baseline settlement: ${proof.transactions.playerTwoRevealAndSettle}`);
  console.log(`proof baseline: ${proof.readback.playerOneBalance} DCR / ${proof.readback.playerTwoBalance} DCR`);
  console.log(`current balances: ${formatUnits(p1Balance as bigint, 18)} DCR / ${formatUnits(p2Balance as bigint, 18)} DCR`);
  if (deployed.latestProof && latest) {
    console.log(`latest duel: #${deployed.latestProof.duelId}, ${deployed.latestProof.matchup}, score: ${latest.score}`);
    console.log(`latest settlement: ${deployed.latestProof.settlement}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
