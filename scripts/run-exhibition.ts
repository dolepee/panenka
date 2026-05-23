// @ts-nocheck
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createPublicClient,
  createWalletClient,
  defineChain,
  encodeAbiParameters,
  formatEther,
  http,
  keccak256,
  maxUint256,
  parseEther,
  type Abi,
} from "viem";
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
const countries = ["Argentina", "Brazil", "France", "Nigeria", "Japan", "England", "Morocco", "USA"];

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function optionalInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

function artifact(name: string): Artifact {
  return JSON.parse(readFileSync(resolve(root, "out", `${name}.sol`, `${name}.json`), "utf8")) as Artifact;
}

function deployment(chainId: number): Deployment {
  return JSON.parse(readFileSync(resolve(root, "deployments", `${chainId}.json`), "utf8")) as Deployment;
}

function privateKeyFromSeed(seed: string, index: number): `0x${string}` {
  return keccak256(new TextEncoder().encode(`panenka-exhibition:${seed}:${index}`));
}

function nonDrawPlans(seed: string, duelId: bigint, p1: `0x${string}`, p2: `0x${string}`, index: number): [Plan, Plan] {
  const p1Shots = [0, 1, 2, 0, 1].map((value) => (value + index) % 3) as Plan["shots"];
  const p2Shots = [0, 0, 0, 0, 0].map((value) => (value + index) % 3) as Plan["shots"];
  const p1Saves = [...p2Shots] as Plan["saves"];
  const p2Saves = p1Shots.map((value) => (value + 1) % 3) as Plan["saves"];
  return [
    { shots: p1Shots, saves: p1Saves, salt: keccak256(new TextEncoder().encode(`${seed}:salt:${duelId}:${p1}:p1`)) },
    { shots: p2Shots, saves: p2Saves, salt: keccak256(new TextEncoder().encode(`${seed}:salt:${duelId}:${p2}:p2`)) },
  ];
}

function commitment(player: `0x${string}`, hidden: Plan) {
  return keccak256(
    encodeAbiParameters(
      [{ type: "address" }, { type: "uint8[5]" }, { type: "uint8[5]" }, { type: "bytes32" }],
      [player, hidden.shots, hidden.saves, hidden.salt],
    ),
  );
}

async function main() {
  const rpcUrl = required("XLAYER_RPC_URL");
  const chainId = Number(required("XLAYER_CHAIN_ID"));
  const seed = required("EXHIBITION_SEED");
  const funderKey = (process.env.EXHIBITION_FUNDER_PRIVATE_KEY ?? process.env.DEPLOYER_PRIVATE_KEY) as `0x${string}` | undefined;
  if (!funderKey) throw new Error("Missing EXHIBITION_FUNDER_PRIVATE_KEY or DEPLOYER_PRIVATE_KEY");

  const playerCount = Math.max(2, optionalInt("EXHIBITION_PLAYERS", 8));
  const duelCount = optionalInt("EXHIBITION_DUELS", 12);
  const stake = parseEther(process.env.EXHIBITION_STAKE_DCR ?? "5");
  const fundAmount = parseEther(process.env.EXHIBITION_FUND_OKB ?? "0.01");
  const minBalance = parseEther(process.env.EXHIBITION_MIN_OKB ?? "0.003");
  const contracts = deployment(chainId).contracts;

  const chain = defineChain({
    id: chainId,
    name: chainId === 196 ? "X Layer" : "X Layer Testnet",
    nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  });
  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
  const funder = privateKeyToAccount(funderKey);
  const funderClient = createWalletClient({ account: funder, chain, transport: http(rpcUrl) });

  const credit = artifact("DuelCredit");
  const kicker = artifact("KickerNFT");
  const duel = artifact("PenaltyDuel");

  const accounts = Array.from({ length: playerCount }, (_, index) => privateKeyToAccount(privateKeyFromSeed(seed, index)));

  async function wait(label: string, hash: `0x${string}`) {
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`${label} failed: ${hash}`);
    console.log(`${label}: ${hash}`);
    return hash;
  }

  async function tryWrite(label: string, write: () => Promise<`0x${string}`>) {
    try {
      return await wait(label, await write());
    } catch (error) {
      console.log(`${label}: skipped (${error instanceof Error ? error.message.split("\n")[0] : "failed"})`);
      return null;
    }
  }

  console.log(`Exhibition seed: ${seed}`);
  console.log(`Funder: ${funder.address}`);
  console.log(`Players: ${playerCount}, target duels: ${duelCount}, stake: ${formatEther(stake)} DCR`);

  const playerState = [];
  for (let index = 0; index < accounts.length; index++) {
    const account = accounts[index];
    const balance = await publicClient.getBalance({ address: account.address });
    if (balance < minBalance) {
      await wait(
        `fund player ${index + 1} ${account.address}`,
        await funderClient.sendTransaction({ chain, to: account.address, value: fundAmount }),
      );
    }

    const client = createWalletClient({ account, chain, transport: http(rpcUrl) });
    await tryWrite(`player ${index + 1} faucet`, () =>
      client.writeContract({ address: contracts.duelCredit, abi: credit.abi, functionName: "claimFaucet" }),
    );

    let tokenId = (await publicClient.readContract({
      address: contracts.kickerNft,
      abi: kicker.abi,
      functionName: "tokenOfOwner",
      args: [account.address],
    })) as bigint;

    if (tokenId === 0n) {
      const countryId = BigInt((index % countries.length) + 1);
      await wait(
        `player ${index + 1} mint ${countries[Number(countryId) - 1]}`,
        await client.writeContract({ chain, address: contracts.kickerNft, abi: kicker.abi, functionName: "mint", args: [countryId] }),
      );
      tokenId = (await publicClient.readContract({
        address: contracts.kickerNft,
        abi: kicker.abi,
        functionName: "tokenOfOwner",
        args: [account.address],
      })) as bigint;
    }

    await tryWrite(`player ${index + 1} approve`, () =>
      client.writeContract({
        chain,
        address: contracts.duelCredit,
        abi: credit.abi,
        functionName: "approve",
        args: [contracts.penaltyDuel, maxUint256],
      }),
    );

    playerState.push({ account, client, tokenId });
  }

  const created = [];
  for (let index = 0; index < duelCount; index++) {
    const p1 = playerState[index % playerState.length];
    const p2 = playerState[(index + 1 + (index % (playerState.length - 1))) % playerState.length];
    const duelId = (await publicClient.readContract({
      address: contracts.penaltyDuel,
      abi: duel.abi,
      functionName: "nextDuelId",
    })) as bigint;

    const [p1Plan, p2Plan] = nonDrawPlans(seed, duelId, p1.account.address, p2.account.address, index);

    await wait(
      `duel #${duelId} create ${countries[index % countries.length]}`,
      await p1.client.writeContract({
        chain,
        address: contracts.penaltyDuel,
        abi: duel.abi,
        functionName: "createDuel",
        args: [stake, p1.tokenId, commitment(p1.account.address, p1Plan)],
      }),
    );
    await wait(
      `duel #${duelId} join`,
      await p2.client.writeContract({
        chain,
        address: contracts.penaltyDuel,
        abi: duel.abi,
        functionName: "joinDuel",
        args: [duelId, p2.tokenId, commitment(p2.account.address, p2Plan)],
      }),
    );
    await wait(
      `duel #${duelId} p1 reveal`,
      await p1.client.writeContract({
        chain,
        address: contracts.penaltyDuel,
        abi: duel.abi,
        functionName: "reveal",
        args: [duelId, p1Plan.shots, p1Plan.saves, p1Plan.salt],
      }),
    );
    const settlement = await wait(
      `duel #${duelId} p2 reveal/settle`,
      await p2.client.writeContract({
        chain,
        address: contracts.penaltyDuel,
        abi: duel.abi,
        functionName: "reveal",
        args: [duelId, p2Plan.shots, p2Plan.saves, p2Plan.salt],
      }),
    );
    created.push({ duelId: duelId.toString(), settlement });
  }

  const nextDuelId = await publicClient.readContract({
    address: contracts.penaltyDuel,
    abi: duel.abi,
    functionName: "nextDuelId",
  });
  const nextTokenId = await publicClient.readContract({
    address: contracts.kickerNft,
    abi: kicker.abi,
    functionName: "nextTokenId",
  });

  console.log("PANENKA_EXHIBITION_VALID");
  console.log(`minted kickers: ${(nextTokenId as bigint) - 1n}`);
  console.log(`duels created: ${(nextDuelId as bigint) - 1n}`);
  console.log(`new settled duels: ${created.length}`);
  console.log(JSON.stringify({ created }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
