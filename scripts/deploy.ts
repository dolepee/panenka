// @ts-nocheck
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createPublicClient, createWalletClient, defineChain, http, type Abi } from "viem";
import { privateKeyToAccount } from "viem/accounts";

type Artifact = {
  abi: Abi;
  bytecode: {
    object: `0x${string}`;
  };
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

async function main() {
  const rpcUrl = required("XLAYER_RPC_URL");
  const chainId = Number(required("XLAYER_CHAIN_ID"));
  const privateKey = required("DEPLOYER_PRIVATE_KEY") as `0x${string}`;
  const account = privateKeyToAccount(privateKey);

  const chain = defineChain({
    id: chainId,
    name: "X Layer",
    nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  });

  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
  const walletClient = createWalletClient({ account, chain, transport: http(rpcUrl) });

  const deploy = async (name: string, args: unknown[] = []) => {
    const contract = artifact(name);
    const hash = await walletClient.deployContract({
      chain,
      abi: contract.abi,
      bytecode: contract.bytecode.object,
      args,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (!receipt.contractAddress) throw new Error(`${name} deployment did not return an address`);
    console.log(`${name}: ${receipt.contractAddress} (${hash})`);
    return receipt.contractAddress;
  };

  const duelCredit = await deploy("DuelCredit");
  const kickerNft = await deploy("KickerNFT");
  const penaltyDuel = await deploy("PenaltyDuel", [duelCredit, kickerNft]);

  const credit = artifact("DuelCredit");
  const kicker = artifact("KickerNFT");

  let hash = await walletClient.writeContract({
    chain,
    address: duelCredit,
    abi: credit.abi,
    functionName: "setDuelContract",
    args: [penaltyDuel],
  });
  await publicClient.waitForTransactionReceipt({ hash });
  console.log(`DuelCredit.setDuelContract: ${hash}`);

  hash = await walletClient.writeContract({
    chain,
    address: kickerNft,
    abi: kicker.abi,
    functionName: "setDuelContract",
    args: [penaltyDuel],
  });
  await publicClient.waitForTransactionReceipt({ hash });
  console.log(`KickerNFT.setDuelContract: ${hash}`);

  const output = {
    chainId,
    deployer: account.address,
    deployedAt: new Date().toISOString(),
    contracts: { duelCredit, kickerNft, penaltyDuel },
  };
  const outputDir = resolve(root, "deployments");
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(resolve(outputDir, `${chainId}.json`), `${JSON.stringify(output, null, 2)}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
