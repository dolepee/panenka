// @ts-nocheck
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createPublicClient, createWalletClient, defineChain, encodeAbiParameters, formatUnits, http, keccak256, type Abi } from "viem";
import { privateKeyToAccount } from "viem/accounts";

type Artifact = { abi: Abi };
type Deployment = {
  contracts: {
    duelCredit: `0x${string}`;
    kickerNft: `0x${string}`;
    penaltyDuel: `0x${string}`;
  };
};
type Plan = {
  shots: [number, number, number, number, number, number, number, number, number, number];
  saves: [number, number, number, number, number, number, number, number, number, number];
  salt: `0x${string}`;
};

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
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

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function artifact(name: string): Artifact {
  return JSON.parse(readFileSync(resolve(root, "out", `${name}.sol`, `${name}.json`), "utf8")) as Artifact;
}

function deployment(chainId: number): Deployment {
  return JSON.parse(readFileSync(resolve(root, "deployments", `${chainId}.json`), "utf8")) as Deployment;
}

function writeDeployment(chainId: number, data: unknown) {
  writeFileSync(resolve(root, "deployments", `${chainId}.json`), `${JSON.stringify(data, null, 2)}\n`);
}

function commitment(player: `0x${string}`, plan: Plan) {
  return keccak256(
    encodeAbiParameters(
      [{ type: "address" }, { type: "uint8[10]" }, { type: "uint8[10]" }, { type: "bytes32" }],
      [player, plan.shots, plan.saves, plan.salt],
    ),
  );
}

async function main() {
  const rpcUrl = required("XLAYER_RPC_URL");
  const chainId = Number(required("XLAYER_CHAIN_ID"));
  const p1 = privateKeyToAccount(required("PLAYER_ONE_PRIVATE_KEY") as `0x${string}`);
  const p2 = privateKeyToAccount(required("PLAYER_TWO_PRIVATE_KEY") as `0x${string}`);
  const contracts = deployment(chainId).contracts;

  const chain = defineChain({
    id: chainId,
    name: "X Layer",
    nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  });
  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
  const p1Client = createWalletClient({ account: p1, chain, transport: http(rpcUrl) });
  const p2Client = createWalletClient({ account: p2, chain, transport: http(rpcUrl) });

  const credit = artifact("DuelCredit");
  const kicker = artifact("KickerNFT");
  const duel = artifact("PenaltyDuel");

  async function wait(label: string, hash: `0x${string}`) {
    console.log(`${label}: ${hash}`);
    await publicClient.waitForTransactionReceipt({ hash });
  }

  async function ignore(label: string, fn: () => Promise<`0x${string}`>) {
    try {
      await wait(label, await fn());
    } catch (error) {
      console.log(`${label}: skipped (${error instanceof Error ? error.message.split("\n")[0] : "failed"})`);
    }
  }

  await ignore("p1 faucet", () => p1Client.writeContract({ chain, address: contracts.duelCredit, abi: credit.abi, functionName: "claimFaucet" }));
  await ignore("p2 faucet", () => p2Client.writeContract({ chain, address: contracts.duelCredit, abi: credit.abi, functionName: "claimFaucet" }));

  let p1Token = (await publicClient.readContract({ address: contracts.kickerNft, abi: kicker.abi, functionName: "tokenOfOwner", args: [p1.address] })) as bigint;
  let p2Token = (await publicClient.readContract({ address: contracts.kickerNft, abi: kicker.abi, functionName: "tokenOfOwner", args: [p2.address] })) as bigint;

  if (p1Token === 0n) {
    await wait("p1 mint Nigeria", await p1Client.writeContract({ chain, address: contracts.kickerNft, abi: kicker.abi, functionName: "mint", args: [4] }));
    p1Token = (await publicClient.readContract({ address: contracts.kickerNft, abi: kicker.abi, functionName: "tokenOfOwner", args: [p1.address] })) as bigint;
  }
  if (p2Token === 0n) {
    await wait("p2 mint France", await p2Client.writeContract({ chain, address: contracts.kickerNft, abi: kicker.abi, functionName: "mint", args: [3] }));
    p2Token = (await publicClient.readContract({ address: contracts.kickerNft, abi: kicker.abi, functionName: "tokenOfOwner", args: [p2.address] })) as bigint;
  }

  await wait(
    "p1 approve",
    await p1Client.writeContract({ chain, address: contracts.duelCredit, abi: credit.abi, functionName: "approve", args: [contracts.penaltyDuel, 100000000000000000000n] }),
  );
  await wait(
    "p2 approve",
    await p2Client.writeContract({ chain, address: contracts.duelCredit, abi: credit.abi, functionName: "approve", args: [contracts.penaltyDuel, 100000000000000000000n] }),
  );

  const p1Plan: Plan = {
    shots: [0, 1, 2, 0, 1, 2, 0, 1, 2, 0],
    saves: [0, 0, 0, 0, 0, 1, 1, 1, 1, 1],
    salt: keccak256("0x70616e656e6b612d70312d73616c74"),
  };
  const p2Plan: Plan = {
    shots: [0, 0, 0, 0, 0, 1, 1, 1, 1, 1],
    saves: [1, 2, 0, 1, 2, 0, 1, 2, 0, 1],
    salt: keccak256("0x70616e656e6b612d70322d73616c74"),
  };
  const duelId = (await publicClient.readContract({ address: contracts.penaltyDuel, abi: duel.abi, functionName: "nextDuelId" })) as bigint;
  const create = await p1Client.writeContract({
    chain,
    address: contracts.penaltyDuel,
    abi: duel.abi,
    functionName: "createDuel",
    args: [5000000000000000000n, p1Token, commitment(p1.address, p1Plan)],
  });
  await wait(
    `create duel #${duelId}`,
    create,
  );
  const join = await p2Client.writeContract({
    chain,
    address: contracts.penaltyDuel,
    abi: duel.abi,
    functionName: "joinDuel",
    args: [duelId, p2Token, commitment(p2.address, p2Plan)],
  });
  await wait(
    `join duel #${duelId}`,
    join,
  );
  const playerOneReveal = await p1Client.writeContract({ chain, address: contracts.penaltyDuel, abi: duel.abi, functionName: "reveal", args: [duelId, p1Plan.shots, p1Plan.saves, p1Plan.salt] });
  await wait(
    `p1 reveal #${duelId}`,
    playerOneReveal,
  );
  const playerTwoRevealAndSettle = await p2Client.writeContract({ chain, address: contracts.penaltyDuel, abi: duel.abi, functionName: "reveal", args: [duelId, p2Plan.shots, p2Plan.saves, p2Plan.salt] });
  await wait(
    `p2 reveal #${duelId}`,
    playerTwoRevealAndSettle,
  );

  const [state, p1Stats, p2Stats, p1Balance, p2Balance] = await Promise.all([
    publicClient.readContract({ address: contracts.penaltyDuel, abi: duel.abi, functionName: "getDuel", args: [duelId] }) as Promise<any>,
    publicClient.readContract({ address: contracts.kickerNft, abi: kicker.abi, functionName: "statsOf", args: [p1Token] }) as Promise<any>,
    publicClient.readContract({ address: contracts.kickerNft, abi: kicker.abi, functionName: "statsOf", args: [p2Token] }) as Promise<any>,
    publicClient.readContract({ address: contracts.duelCredit, abi: credit.abi, functionName: "balanceOf", args: [p1.address] }) as Promise<bigint>,
    publicClient.readContract({ address: contracts.duelCredit, abi: credit.abi, functionName: "balanceOf", args: [p2.address] }) as Promise<bigint>,
  ]);
  const deploymentData = deployment(chainId) as any;
  const score = `${Number(state.p1.shots[0] !== state.p2.saves[0]) + Number(state.p1.shots[1] !== state.p2.saves[1]) + Number(state.p1.shots[2] !== state.p2.saves[2])}-${Number(state.p2.shots[0] !== state.p1.saves[0]) + Number(state.p2.shots[1] !== state.p1.saves[1]) + Number(state.p2.shots[2] !== state.p1.saves[2])}`;
  deploymentData.proof = {
    duelId: duelId.toString(),
    fromBlock: deploymentData.proof?.fromBlock ?? "0",
    playerOne: p1.address,
    playerTwo: p2.address,
    transactions: { create, join, playerOneReveal, playerTwoRevealAndSettle },
    readback: {
      playerOneCountry: countries[Number(p1Stats[0])] ?? `Country ${p1Stats[0]}`,
      playerTwoCountry: countries[Number(p2Stats[0])] ?? `Country ${p2Stats[0]}`,
      playerOneBalance: formatUnits(p1Balance, 18),
      playerTwoBalance: formatUnits(p2Balance, 18),
      playerOneWins: p1Stats[1].toString(),
      playerTwoLosses: p2Stats[2].toString(),
      score,
    },
  };
  deploymentData.latestProof = {
    duelId: duelId.toString(),
    matchup: `${deploymentData.proof.readback.playerOneCountry} ${score} ${deploymentData.proof.readback.playerTwoCountry}`,
    playerOne: p1.address,
    playerTwo: p2.address,
    settlement: playerTwoRevealAndSettle,
    readback: {
      playerOneCountry: deploymentData.proof.readback.playerOneCountry,
      playerTwoCountry: deploymentData.proof.readback.playerTwoCountry,
      score,
    },
  };
  writeDeployment(chainId, deploymentData);
  console.log(`Settled duel #${duelId}. Winner should be ${p1.address}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
