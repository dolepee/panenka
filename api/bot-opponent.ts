// @ts-nocheck
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  encodeAbiParameters,
  formatEther,
  formatUnits,
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
const DUEL_CREDIT = (process.env.DUEL_CREDIT_ADDRESS ?? "0xcf8af8245abe1aeedc23b1f9c45ba84e17614c98") as `0x${string}`;
const KICKER_NFT = (process.env.KICKER_NFT_ADDRESS ?? "0x33dc85f938f21c8cf83556f444d16e61377a35a3") as `0x${string}`;
const PENALTY_DUEL = (process.env.PENALTY_DUEL_ADDRESS ?? "0xebd15b2baa79a84d6e509b2dae12526abe5dacdb") as `0x${string}`;
const BOT_MAX_STAKE_WEI = BigInt(process.env.BOT_MAX_STAKE_WEI ?? "5000000000000000000");

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
  "function balanceOf(address account) external view returns (uint256)",
]);

const kickerAbi = parseAbi([
  "function mint(uint8 countryId) external returns (uint256)",
  "function tokenOfOwner(address owner) external view returns (uint256)",
]);

const duelAbi = parseAbi([
  "function getDuel(uint256 duelId) view returns ((uint256 stake,uint256 createdAt,uint256 joinedAt,uint256 firstRevealAt,uint8 status,(address player,uint256 kickerTokenId,bytes32 commitHash,bool revealed,uint8[5] shots,uint8[5] saves) p1,(address player,uint256 kickerTokenId,bytes32 commitHash,bool revealed,uint8[5] shots,uint8[5] saves) p2))",
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

function userError(error: unknown) {
  const message = error instanceof Error ? error.shortMessage ?? error.message : "Bot request failed.";
  if (message.includes("0xa89ac151")) return "Panenka Bot already revealed. The creator wallet must click Reveal my plan.";
  if (message.includes("0xa717dfcc")) return "This wallet is not a player in that duel.";
  if (message.includes("0xf0f96d35")) return "Reveal failed because the hidden plan does not match the original commit.";
  if (message.includes("0xf525e320")) return "That duel is not in the right state for this bot action.";
  if (message.includes("0xfaeb9c51")) return "Create the duel first, then let Panenka Bot join it.";
  return message;
}

export default async function handler(request: any, response: any) {
  try {
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
      const duel = (await publicClient.readContract({
        address: PENALTY_DUEL,
        abi: duelAbi,
        functionName: "getDuel",
        args: [duelId],
      })) as any;
      if (duel.p1.player === "0x0000000000000000000000000000000000000000") {
        response.status(400).json({ error: "Create the duel first, then let Panenka Bot join it." });
        return;
      }
      if (Number(duel.status) !== 0) {
        response.status(400).json({ error: "Panenka Bot can only join an open duel." });
        return;
      }
      if ((duel.stake as bigint) > BOT_MAX_STAKE_WEI) {
        response.status(400).json({ error: "Panenka Bot only joins exhibition duels up to 5 DCR." });
        return;
      }
      const stake = duel.stake as bigint;
      const gasBalance = await publicClient.getBalance({ address: bot.address });
      if (gasBalance < 1_000_000_000_000_000n) {
        response.status(503).json({
          error: `Panenka Bot gas is low (${formatEther(gasBalance)} OKB). Try again later or use a second wallet.`,
        });
        return;
      }

      const faucetTx = await tryWrite(() =>
        walletClient.writeContract({ address: DUEL_CREDIT, abi: creditAbi, functionName: "claimFaucet" }),
      );
      if (faucetTx) setupTxs.push(faucetTx);
      const botCreditBalance = (await publicClient.readContract({
        address: DUEL_CREDIT,
        abi: creditAbi,
        functionName: "balanceOf",
        args: [bot.address],
      })) as bigint;
      if (botCreditBalance < stake) {
        response.status(503).json({
          error: `Panenka Bot has ${formatUnits(botCreditBalance, 18)} DCR available and needs ${formatUnits(
            stake,
            18,
          )} DCR. Try a smaller exhibition stake or use a second wallet.`,
        });
        return;
      }

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
      if (allowance < stake) {
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
  } catch (error) {
    response.status(500).json({ error: userError(error) });
  }
}
