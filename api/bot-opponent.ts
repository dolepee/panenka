// @ts-nocheck
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  encodeAbiParameters,
  http,
  keccak256,
  maxUint256,
  parseAbi,
  toHex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const XLAYER_RPC_URL = process.env.XLAYER_RPC_URL ?? "https://testrpc.xlayer.tech/terigon";
const XLAYER_CHAIN_ID = Number(process.env.XLAYER_CHAIN_ID ?? 1952);
const BOT_PRIVATE_KEY = process.env.BOT_PRIVATE_KEY as `0x${string}` | undefined;
const DUEL_CREDIT = (process.env.DUEL_CREDIT_ADDRESS ?? "0x87e31cc7fe76dc7d70c70867e34fef1447e339e9") as `0x${string}`;
const KICKER_NFT = (process.env.KICKER_NFT_ADDRESS ?? "0xb614e51deb5e4078b6bbb28ee32a70bc547e19df") as `0x${string}`;
const PENALTY_DUEL = (process.env.PENALTY_DUEL_ADDRESS ?? "0xbe9f77afd1d64e0f76572f08c4ed34a6a1ccbfd1") as `0x${string}`;

const chain = defineChain({
  id: XLAYER_CHAIN_ID,
  name: XLAYER_CHAIN_ID === 196 ? "X Layer" : "X Layer Testnet",
  nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
  rpcUrls: { default: { http: [XLAYER_RPC_URL] } },
});

const creditAbi = parseAbi([
  "function claimFaucet() external",
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)",
]);

const kickerAbi = parseAbi([
  "function mint(uint8 countryId) external returns (uint256)",
  "function tokenOfOwner(address owner) external view returns (uint256)",
]);

const duelAbi = parseAbi([
  "function joinDuel(uint256 duelId, uint256 kickerTokenId, bytes32 commitHash) external",
  "function reveal(uint256 duelId, uint8[5] shots, uint8[5] saves, bytes32 salt) external",
]);

type Plan = {
  shots: [number, number, number, number, number];
  saves: [number, number, number, number, number];
  salt: `0x${string}`;
};

function botPlan(duelId: bigint): Plan {
  const secret = process.env.BOT_COMMIT_SECRET ?? BOT_PRIVATE_KEY ?? "panenka-bot";
  const seed = BigInt(keccak256(toHex(`panenka:${duelId.toString()}:${secret}`)));
  const shots = Array.from({ length: 5 }, (_, index) => Number((seed >> BigInt(index * 8)) % 3n)) as Plan["shots"];
  const saves = Array.from({ length: 5 }, (_, index) => Number((seed >> BigInt(40 + index * 8)) % 3n)) as Plan["saves"];
  const salt = keccak256(toHex(`panenka:salt:${duelId.toString()}:${secret}`));
  return { shots, saves, salt };
}

function commitment(player: `0x${string}`, plan: Plan) {
  return keccak256(
    encodeAbiParameters(
      [{ type: "address" }, { type: "uint8[5]" }, { type: "uint8[5]" }, { type: "bytes32" }],
      [player, plan.shots, plan.saves, plan.salt],
    ),
  );
}

export default async function handler(request: any, response: any) {
  if (request.method !== "POST") {
    response.status(405).json({ error: "POST only" });
    return;
  }
  if (!BOT_PRIVATE_KEY) {
    response.status(500).json({ error: "BOT_PRIVATE_KEY is not configured" });
    return;
  }

  const action = request.body?.action;
  const duelId = BigInt(request.body?.duelId ?? 0);
  if ((action !== "join" && action !== "reveal") || duelId <= 0n) {
    response.status(400).json({ error: "Expected { action: 'join' | 'reveal', duelId }" });
    return;
  }

  const bot = privateKeyToAccount(BOT_PRIVATE_KEY);
  const publicClient = createPublicClient({ chain, transport: http(XLAYER_RPC_URL) });
  const walletClient = createWalletClient({ account: bot, chain, transport: http(XLAYER_RPC_URL) });

  async function wait(hash: `0x${string}`) {
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`Transaction reverted: ${hash}`);
    return hash;
  }

  async function tryWrite(write: () => Promise<`0x${string}`>) {
    try {
      return await wait(await write());
    } catch {
      return null;
    }
  }

  const setupTxs: `0x${string}`[] = [];
  if (action === "join") {
    const faucetTx = await tryWrite(() =>
      walletClient.writeContract({ address: DUEL_CREDIT, abi: creditAbi, functionName: "claimFaucet" }),
    );
    if (faucetTx) setupTxs.push(faucetTx);

    let tokenId = (await publicClient.readContract({
      address: KICKER_NFT,
      abi: kickerAbi,
      functionName: "tokenOfOwner",
      args: [bot.address],
    })) as bigint;
    if (tokenId === 0n) {
      const mintTx = await wait(
        await walletClient.writeContract({ address: KICKER_NFT, abi: kickerAbi, functionName: "mint", args: [5] }),
      );
      setupTxs.push(mintTx);
      tokenId = (await publicClient.readContract({
        address: KICKER_NFT,
        abi: kickerAbi,
        functionName: "tokenOfOwner",
        args: [bot.address],
      })) as bigint;
    }

    const allowance = (await publicClient.readContract({
      address: DUEL_CREDIT,
      abi: creditAbi,
      functionName: "allowance",
      args: [bot.address, PENALTY_DUEL],
    })) as bigint;
    if (allowance === 0n) {
      const approveTx = await wait(
        await walletClient.writeContract({
          address: DUEL_CREDIT,
          abi: creditAbi,
          functionName: "approve",
          args: [PENALTY_DUEL, maxUint256],
        }),
      );
      setupTxs.push(approveTx);
    }

    const plan = botPlan(duelId);
    const hash = await wait(
      await walletClient.writeContract({
        address: PENALTY_DUEL,
        abi: duelAbi,
        functionName: "joinDuel",
        args: [duelId, tokenId, commitment(bot.address, plan)],
      }),
    );
    response.status(200).json({ action, duelId: duelId.toString(), bot: bot.address, hash, setupTxs });
    return;
  }

  const plan = botPlan(duelId);
  const hash = await wait(
    await walletClient.writeContract({
      address: PENALTY_DUEL,
      abi: duelAbi,
      functionName: "reveal",
      args: [duelId, plan.shots, plan.saves, plan.salt],
    }),
  );
  response.status(200).json({ action, duelId: duelId.toString(), bot: bot.address, hash, setupTxs });
}
