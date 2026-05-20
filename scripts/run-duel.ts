// @ts-nocheck
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createPublicClient, createWalletClient, defineChain, encodeAbiParameters, http, keccak256, type Abi } from "viem";
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
  shots: [number, number, number, number, number];
  saves: [number, number, number, number, number];
  salt: `0x${string}`;
};

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

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

function commitment(player: `0x${string}`, plan: Plan) {
  return keccak256(
    encodeAbiParameters(
      [{ type: "address" }, { type: "uint8[5]" }, { type: "uint8[5]" }, { type: "bytes32" }],
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
    shots: [0, 1, 2, 0, 1],
    saves: [0, 0, 0, 0, 0],
    salt: keccak256("0x70616e656e6b612d70312d73616c74"),
  };
  const p2Plan: Plan = {
    shots: [0, 0, 0, 0, 0],
    saves: [1, 1, 1, 1, 1],
    salt: keccak256("0x70616e656e6b612d70322d73616c74"),
  };
  const duelId = (await publicClient.readContract({ address: contracts.penaltyDuel, abi: duel.abi, functionName: "nextDuelId" })) as bigint;
  await wait(
    `create duel #${duelId}`,
    await p1Client.writeContract({
      chain,
      address: contracts.penaltyDuel,
      abi: duel.abi,
      functionName: "createDuel",
      args: [5000000000000000000n, p1Token, commitment(p1.address, p1Plan)],
    }),
  );
  await wait(
    `join duel #${duelId}`,
    await p2Client.writeContract({
      chain,
      address: contracts.penaltyDuel,
      abi: duel.abi,
      functionName: "joinDuel",
      args: [duelId, p2Token, commitment(p2.address, p2Plan)],
    }),
  );
  await wait(
    `p1 reveal #${duelId}`,
    await p1Client.writeContract({ chain, address: contracts.penaltyDuel, abi: duel.abi, functionName: "reveal", args: [duelId, p1Plan.shots, p1Plan.saves, p1Plan.salt] }),
  );
  await wait(
    `p2 reveal #${duelId}`,
    await p2Client.writeContract({ chain, address: contracts.penaltyDuel, abi: duel.abi, functionName: "reveal", args: [duelId, p2Plan.shots, p2Plan.saves, p2Plan.salt] }),
  );

  console.log(`Settled duel #${duelId}. Winner should be ${p1.address}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
