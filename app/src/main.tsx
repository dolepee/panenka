import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  createPublicClient,
  createWalletClient,
  custom,
  decodeEventLog,
  encodeAbiParameters,
  formatUnits,
  http,
  keccak256,
  parseUnits,
  toHex,
} from "viem";
import "./styles.css";
import {
  XLAYER_CHAIN_ID,
  XLAYER_EXPLORER,
  addresses,
  duelCreditAbi,
  hasContracts,
  kickerNftAbi,
  penaltyDuelAbi,
  xLayer,
} from "./contracts";

type WalletProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};

declare global {
  interface Window {
    ethereum?: WalletProvider;
    okxwallet?: WalletProvider;
  }
}

type DirectionPlan = [number, number, number, number, number, number, number, number, number, number];
type StoredPlan = {
  duelId: number;
  shots: DirectionPlan;
  saves: DirectionPlan;
  salt: `0x${string}`;
};
type DuelView = {
  id: number;
  status: number;
  statusLabel: string;
  stake: string;
  p1: string;
  p2: string;
  p1Revealed: boolean;
  p2Revealed: boolean;
  nextStep: string;
};
type RoundResult = {
  round: number;
  youGoal: boolean;
  botGoal: boolean;
  p1Shot?: number;
  p2Shot?: number;
  p1Save?: number;
  p2Save?: number;
};
type CommitRevealPlan = {
  commitHash?: string;
  revealed?: boolean;
  shots?: number[];
  saves?: number[];
};
type CommitRevealPair = {
  playerOne?: CommitRevealPlan;
  playerTwo?: CommitRevealPlan;
};
type LeaderboardRow = {
  tokenId: string;
  player: string;
  walletType?: "manual" | "exhibition";
  country: string;
  wins: number;
  losses: number;
  streak: number;
  level: number;
};
type CountryLeaderboardRow = {
  country: string;
  kickers: number;
  wins: number;
  losses: number;
  streak: number;
  bestTokenId: string;
};
type ProofActivity = {
  chain?: { name: string; latestBlock: string };
  contracts?: { PenaltyDuel?: { address: string; explorer: string } };
  onchainActivity?: {
    mintedKickers: number;
    settledDuels: number;
    duelsCreated: number;
    countryCount: number;
    activeWallets?: number;
    manualWallets?: number;
    exhibitionWallets?: number;
  };
  wallets?: { total: number; manual: number; exhibition: number; exhibitionPurpose?: string };
  proofDuel?: {
    transactions?: { playerTwoRevealAndSettle?: { explorer: string } };
  };
  recentDuels?: Array<{
    duelId: string;
    statusLabel: string;
    p1Country?: string | null;
    p2Country?: string | null;
    score?: string | null;
    commitReveal?: CommitRevealPair;
    settlementTx?: { hash: string; explorer: string } | null;
    settlementTxStatus?: "available" | "unavailable" | "not-settled";
  }>;
};
type BotHealth = {
  bot: string;
  ready: boolean;
  okb: string;
  duelCredit: string;
  publicStakeCap: string;
  allowanceCoversPublicStake: boolean;
  hasKicker: boolean;
  tokenId: string;
};

const countries = [
  { id: 1, name: "Argentina" },
  { id: 2, name: "Brazil" },
  { id: 3, name: "France" },
  { id: 4, name: "Nigeria" },
  { id: 5, name: "Japan" },
  { id: 6, name: "England" },
  { id: 7, name: "Morocco" },
  { id: 8, name: "USA" },
];
const countryById = Object.fromEntries(countries.map((country) => [country.id, country.name]));
const countryOptionById = Object.fromEntries(countries.map((country) => [country.id, country]));
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const PROOF_DUEL_ID = 1;
const PROOF_SETTLEMENT_TX = "0x591cfb717624c02d2862b805237d34f9d151f3228d70bc9e7b1dd414e13c9181";
const XLAYER_TESTNET_FAUCET = "https://web3.okx.com/en-us/xlayer/faucet";

const publicClient = createPublicClient({ chain: xLayer, transport: http() });

function short(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function shortHash(hash?: string) {
  if (!hash) return "pending";
  return `${hash.slice(0, 10)}...${hash.slice(-8)}`;
}

function directionArrow(direction?: number) {
  if (direction === 0) return "←";
  if (direction === 1) return "↑";
  if (direction === 2) return "→";
  return "·";
}

function directionName(direction?: number) {
  if (direction === 0) return "left";
  if (direction === 1) return "center";
  if (direction === 2) return "right";
  return "hidden";
}

function normalizePlan(values?: readonly unknown[]): DirectionPlan {
  return Array.from({ length: 10 }, (_, index) => Number(values?.[index] ?? 0)) as DirectionPlan;
}

function contractTiebreaksToP1({
  duelId,
  p1CommitHash,
  p2CommitHash,
  p1Shots,
  p2Shots,
  p1Saves,
  p2Saves,
}: {
  duelId: bigint;
  p1CommitHash: `0x${string}`;
  p2CommitHash: `0x${string}`;
  p1Shots: DirectionPlan;
  p2Shots: DirectionPlan;
  p1Saves: DirectionPlan;
  p2Saves: DirectionPlan;
}) {
  const hash = keccak256(
    encodeAbiParameters(
      [
        { type: "uint256" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "uint8[10]" },
        { type: "uint8[10]" },
        { type: "uint8[10]" },
        { type: "uint8[10]" },
      ],
      [duelId, p1CommitHash, p2CommitHash, p1Shots, p2Shots, p1Saves, p2Saves],
    ),
  );
  return BigInt(hash) % 2n === 0n;
}

function scoreShootout(
  p1Shots: number[],
  p1Saves: number[],
  p2Shots: number[],
  p2Saves: number[],
  tieBreaksToP1 = true,
) {
  const rounds: RoundResult[] = [];
  let p1Score = 0;
  let p2Score = 0;
  let tiebreak = false;
  for (let index = 0; index < 10; index++) {
    const p1Goal = Number(p1Shots[index]) !== Number(p2Saves[index]);
    const p2Goal = Number(p2Shots[index]) !== Number(p1Saves[index]);
    if (p1Goal) p1Score += 1;
    if (p2Goal) p2Score += 1;
    rounds.push({
      round: index + 1,
      youGoal: p1Goal,
      botGoal: p2Goal,
      p1Shot: Number(p1Shots[index]),
      p2Shot: Number(p2Shots[index]),
      p1Save: Number(p1Saves[index]),
      p2Save: Number(p2Saves[index]),
    });

    const kicksTaken = index + 1;
    if (kicksTaken < 5) {
      const remaining = 5 - kicksTaken;
      if (p1Score > p2Score + remaining || p2Score > p1Score + remaining) break;
    } else if (p1Score !== p2Score) {
      break;
    }
  }
  if (p1Score === p2Score) {
    tiebreak = true;
    if (tieBreaksToP1) p1Score += 1;
    else p2Score += 1;
  }
  return { rounds, score: `${p1Score}-${p2Score}`, p1Score, p2Score, tiebreak };
}

function ShootoutVisualizer({ round }: { round?: RoundResult }) {
  const shotX = lanePosition(round?.p1Shot);
  const keeperX = lanePosition(round?.p2Save);
  const trailRotate = laneRotation(round?.p1Shot);
  const goal = Boolean(round?.youGoal);
  return (
    <div
      className={`stadiumViz ${goal ? "isGoal" : "isSave"}`}
      style={{ "--shot-x": shotX, "--keeper-x": keeperX, "--trail-rotate": trailRotate } as React.CSSProperties}
    >
      <div className="stadiumSky">
        <span>Round {round?.round ?? 1}</span>
        <strong>{goal ? "GOAL" : "SAVED"}</strong>
      </div>
      <div className="goalFrame">
        <div className="netLine netLineOne" />
        <div className="netLine netLineTwo" />
        <div className="keeperSprite">GK</div>
        <div className="goalTarget" />
      </div>
      <div className="grassPitch">
        <div className="penaltySpot" />
        <div className="shotTrail" />
        <div className="matchBall" />
      </div>
    </div>
  );
}

function txLink(hash: string) {
  return `${XLAYER_EXPLORER}/tx/${hash}`;
}

function playLink(duelId: number | string) {
  const url = new URL(location.href);
  url.hash = "play";
  url.searchParams.set("duel", String(duelId));
  return url.toString();
}

function explorerAddress(address: string) {
  return `${XLAYER_EXPLORER}/address/${address}`;
}

function shareResultUrl(text: string) {
  return `https://x.com/intent/tweet?text=${encodeURIComponent(`${text}\n\nPlayed on @PanenkaGG, built on @XLayerOfficial.\nhttps://panenka-alpha.vercel.app\n\n#XLayerHackathon`)}`;
}

function shareProofUrl(text: string) {
  return `https://x.com/intent/tweet?text=${encodeURIComponent(`${text}\n\nhttps://panenka-alpha.vercel.app\n\n@XLayerOfficial #XLayerHackathon`)}`;
}

function shareCountryUrl(row: CountryLeaderboardRow, rank: number) {
  return shareResultUrl(
    `${row.country} is #${rank} on Panenka with ${row.wins} wins, ${row.kickers} country kickers, and a ${row.streak} best streak. Challenge this country in an onchain penalty duel on X Layer.`,
  );
}

function lanePosition(direction?: number) {
  if (direction === 0) return "24%";
  if (direction === 1) return "50%";
  if (direction === 2) return "76%";
  return "50%";
}

function laneRotation(direction?: number) {
  if (direction === 0) return "-18deg";
  if (direction === 2) return "18deg";
  return "0deg";
}

function parseSettlementText(text: string) {
  const match = text.match(/Duel #(\d+):\s+(.+?)\s+(\d+)-(\d+)\s+(.+?)\.\s+Winner:\s+(.+?)\./);
  if (!match) {
    return { duelId: "", sideOne: "Panenka", sideTwo: "X Layer", score: "settled", winner: "winner" };
  }
  return {
    duelId: match[1],
    sideOne: match[2],
    sideTwo: match[5],
    score: `${match[3]}-${match[4]}`,
    winner: match[6],
  };
}

function drawPillRow(context: CanvasRenderingContext2D, values: Array<number | undefined>, x: number, y: number) {
  values.forEach((value, index) => {
    const px = x + (index % 5) * 42;
    const py = y + Math.floor(index / 5) * 36;
    context.fillStyle = "#44f4c4";
    context.beginPath();
    context.roundRect(px, py, 32, 28, 14);
    context.fill();
    context.fillStyle = "#061009";
    context.font = "800 18px Georgia, serif";
    context.textAlign = "center";
    context.fillText(directionArrow(value), px + 16, py + 20);
  });
  context.textAlign = "left";
}

function resultImageBlob(text: string, tx?: string, rounds: RoundResult[] = []): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = 1200;
  canvas.height = 675;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not create image canvas.");
  const parsed = parseSettlementText(text);
  const latestRound = rounds[rounds.length - 1];
  const p1Shots = rounds.map((round) => round.p1Shot);
  const p1Saves = rounds.map((round) => round.p1Save);
  const p2Shots = rounds.map((round) => round.p2Shot);
  const p2Saves = rounds.map((round) => round.p2Save);

  const gradient = context.createLinearGradient(0, 0, canvas.width, canvas.height);
  gradient.addColorStop(0, "#071514");
  gradient.addColorStop(0.45, "#0b1611");
  gradient.addColorStop(1, "#151800");
  context.fillStyle = gradient;
  context.fillRect(0, 0, canvas.width, canvas.height);

  context.strokeStyle = "rgba(248,243,231,0.055)";
  context.lineWidth = 1;
  for (let x = 0; x <= canvas.width; x += 44) {
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, canvas.height);
    context.stroke();
  }
  for (let y = 0; y <= canvas.height; y += 44) {
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(canvas.width, y);
    context.stroke();
  }

  context.fillStyle = "rgba(68,244,196,0.13)";
  context.beginPath();
  context.arc(80, 40, 320, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = "rgba(248,255,112,0.11)";
  context.beginPath();
  context.arc(1210, 40, 260, 0, Math.PI * 2);
  context.fill();

  context.fillStyle = "#f8f3e7";
  context.font = "900 50px Georgia, serif";
  context.fillText(parsed.sideOne, 120, 76);
  context.textAlign = "right";
  context.fillText(parsed.sideTwo, 1080, 76);
  context.fillStyle = "#44f4c4";
  context.font = "900 82px Georgia, serif";
  context.textAlign = "center";
  context.fillText(parsed.score, 600, 86);
  context.textAlign = "left";

  context.fillStyle = "rgba(0,0,0,0.34)";
  context.strokeStyle = "rgba(68,244,196,0.26)";
  context.lineWidth = 2;
  context.beginPath();
  context.roundRect(36, 118, 1128, 232, 22);
  context.fill();
  context.stroke();

  context.fillStyle = "rgba(248,243,231,0.58)";
  context.font = "900 14px ui-monospace, SFMono-Regular, Menlo, monospace";
  context.fillText("PROTOCOL MOMENT", 70, 156);
  context.fillStyle = "#f8ff70";
  context.font = "900 22px Georgia, serif";
  context.fillText("Hidden hash becomes a shootout plan.", 764, 158);

  [
    { label: parsed.sideOne, x: 64, shots: p1Shots, saves: p1Saves, hash: tx ? shortHash(tx) : "0xcommit..." },
    { label: parsed.sideTwo, x: 636, shots: p2Shots, saves: p2Saves, hash: "revealed plan" },
  ].forEach((panel) => {
    context.fillStyle = "rgba(255,255,255,0.045)";
    context.strokeStyle = "rgba(248,243,231,0.12)";
    context.beginPath();
    context.roundRect(panel.x, 176, 500, 142, 18);
    context.fill();
    context.stroke();
    context.fillStyle = "rgba(248,243,231,0.56)";
    context.font = "900 13px ui-monospace, SFMono-Regular, Menlo, monospace";
    context.fillText(`${panel.label.toUpperCase()} COMMIT`, panel.x + 20, 242);
    context.fillStyle = "rgba(0,0,0,0.4)";
    context.beginPath();
    context.roundRect(panel.x + 20, 258, 206, 40, 10);
    context.fill();
    context.fillStyle = "#44f4c4";
    context.font = "900 14px ui-monospace, SFMono-Regular, Menlo, monospace";
    context.fillText(panel.hash, panel.x + 34, 283);
    context.fillStyle = "#f8ff70";
    context.beginPath();
    context.arc(panel.x + 262, 276, 18, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = "#061009";
    context.font = "900 18px Georgia, serif";
    context.textAlign = "center";
    context.fillText("→", panel.x + 262, 282);
    context.textAlign = "left";
    context.fillStyle = "rgba(248,243,231,0.62)";
    context.font = "900 12px ui-monospace, SFMono-Regular, Menlo, monospace";
    context.fillText("SHOTS", panel.x + 294, 216);
    drawPillRow(context, panel.shots, panel.x + 344, 198);
    context.fillText("SAVES", panel.x + 294, 292);
    drawPillRow(context, panel.saves, panel.x + 344, 274);
  });

  context.fillStyle = "rgba(0,0,0,0.24)";
  context.strokeStyle = "rgba(68,244,196,0.24)";
  context.beginPath();
  context.roundRect(36, 372, 1128, 218, 22);
  context.fill();
  context.stroke();

  context.fillStyle = "#10273d";
  context.fillRect(76, 410, 356, 68);
  context.fillStyle = "#1cae55";
  context.fillRect(76, 478, 356, 82);
  context.strokeStyle = "rgba(248,243,231,0.72)";
  context.lineWidth = 4;
  context.strokeRect(190, 432, 150, 72);
  context.fillStyle = "#f8ff70";
  context.beginPath();
  context.arc(304, 470, 26, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = "#061009";
  context.font = "900 16px Georgia, serif";
  context.textAlign = "center";
  context.fillText("GK", 304, 476);
  context.fillStyle = "#f8f3e7";
  context.beginPath();
  context.arc(372, 426, 10, 0, Math.PI * 2);
  context.fill();
  context.strokeStyle = "rgba(248,255,112,0.72)";
  context.lineWidth = 3;
  context.beginPath();
  context.moveTo(244, 544);
  context.lineTo(372, 426);
  context.stroke();
  context.textAlign = "left";

  context.fillStyle = "#f8f3e7";
  context.font = "900 38px Georgia, serif";
  context.fillText(`Winner: ${parsed.winner}`, 470, 440);
  context.font = "700 25px Georgia, serif";
  context.fillStyle = "rgba(248,243,231,0.78)";
  context.fillText(`Duel #${parsed.duelId || "?"} settled on X Layer testnet`, 470, 484);
  context.fillText(
    latestRound
      ? `Final shown round: ${latestRound.round} · shot ${latestRound.p1Shot} vs save ${latestRound.p2Save}`
      : "Commit, reveal, settle, leaderboard update.",
    470,
    524,
  );

  context.fillStyle = "#44f4c4";
  context.font = "900 30px Georgia, serif";
  context.fillText("Hidden plan. Reveal. No draw. Settled onchain.", 76, 638);
  if (tx) {
    context.fillStyle = "rgba(248,243,231,0.58)";
    context.font = "24px ui-monospace, SFMono-Regular, Menlo, monospace";
    context.fillText(shortHash(tx), 776, 638);
  }

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Could not export result image."))), "image/png", 0.95);
  });
}

async function saveBlob(blob: Blob, filename?: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename ?? (blob instanceof File ? blob.name : "panenka-result.png");
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function xLayerChainIdHex() {
  return `0x${XLAYER_CHAIN_ID.toString(16)}`;
}

async function ensureXLayer(wallet: WalletProvider) {
  const expectedChainId = xLayerChainIdHex();
  const currentChainId = (await wallet.request({ method: "eth_chainId" })) as string;
  if (currentChainId?.toLowerCase() === expectedChainId.toLowerCase()) return;
  try {
    await wallet.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: expectedChainId }],
    });
  } catch {
    await wallet.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: expectedChainId,
          chainName: xLayer.name,
          nativeCurrency: xLayer.nativeCurrency,
          rpcUrls: xLayer.rpcUrls.default.http,
          blockExplorerUrls: [XLAYER_EXPLORER],
        },
      ],
    });
  }
}

function planKey(account: string, duelId: number) {
  return `panenka-plan:${addresses.penaltyDuel?.toLowerCase()}:${account.toLowerCase()}:${duelId}`;
}

function makePlan(player: `0x${string}`): StoredPlan {
  const entropy = new Uint8Array(32);
  crypto.getRandomValues(entropy);
  const seed = Number(BigInt(keccak256(entropy)) % 1000000n);
  const shots = Array.from({ length: 10 }, (_, index) => (seed + index) % 3) as DirectionPlan;
  const saves = Array.from({ length: 10 }, (_, index) => (seed + index + 1) % 3) as DirectionPlan;
  crypto.getRandomValues(entropy);
  return { duelId: 0, shots, saves, salt: keccak256(toHex(entropy)) };
}

function commitment(player: `0x${string}`, shots: DirectionPlan, saves: DirectionPlan, salt: `0x${string}`) {
  return keccak256(
    encodeAbiParameters(
      [{ type: "address" }, { type: "uint8[10]" }, { type: "uint8[10]" }, { type: "bytes32" }],
      [player, shots, saves, salt],
    ),
  );
}

function loadPlan(account: string, duelId: number): StoredPlan | null {
  const raw = localStorage.getItem(planKey(account, duelId));
  if (!raw) return null;
  return JSON.parse(raw) as StoredPlan;
}

function savePlan(account: string, plan: StoredPlan) {
  localStorage.setItem(planKey(account, plan.duelId), JSON.stringify(plan));
}

function localPlanIds(account: string) {
  if (!account) return [];
  const prefix = `panenka-plan:${addresses.penaltyDuel?.toLowerCase()}:${account.toLowerCase()}:`;
  return Object.keys(localStorage)
    .filter((key) => key.startsWith(prefix))
    .map((key) => Number(key.slice(prefix.length)))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
}

function duelStatusLabel(status: number) {
  return ["Open", "Committed", "Settled", "Cancelled", "Forfeited"][status] ?? `Status ${status}`;
}

function duelNextStep(duel: DuelView, account: string) {
  if (duel.p1.toLowerCase() === ZERO_ADDRESS) return "This duel was never created. Click Create hidden duel first.";
  const lower = account.toLowerCase();
  const isP1 = duel.p1.toLowerCase() === lower;
  const isP2 = duel.p2.toLowerCase() === lower;
  if (duel.status === 0) return "Waiting for an opponent. Share the invite link or click Bot joins this duel.";
  if (duel.status === 2) return "Settled. Check your DCR balance and kicker stats.";
  if (duel.status === 3) return "Cancelled. Create a new duel.";
  if (duel.status === 4) return "Forfeited. The remaining player claimed the pot.";
  if (!duel.p1Revealed && isP1) return "Your wallet created this duel. Click Reveal my plan.";
  if (!duel.p2Revealed && isP2) return "Your wallet joined this duel. Click Reveal my plan.";
  if (duel.p1Revealed && !duel.p2Revealed) return "Creator revealed. Waiting for opponent or Bot reveals and settles.";
  if (!duel.p1Revealed && duel.p2Revealed) return "Opponent revealed. Creator must click Reveal my plan to settle.";
  return "Both reveals are in. Refresh if settlement is still indexing.";
}

function humanError(error: unknown) {
  const maybeError = error as { shortMessage?: string; message?: string };
  const message = maybeError.shortMessage ?? maybeError.message ?? String(error);
  if (message.includes("0xa89ac151")) return "This wallet already revealed for that duel.";
  if (message.includes("0xa717dfcc")) return "This wallet is not a player in that duel.";
  if (message.includes("0xf0f96d35")) return "This browser has an old hidden plan for that duel. Create a fresh duel.";
  if (message.includes("0xf525e320")) return "That duel is not in the right state for this action.";
  if (message.includes("0xfaeb9c51")) return "That duel was never created. Create a fresh duel first.";
  if (message.includes("0x9b0056ac")) return "Timeout is not reached yet. Wait 30 minutes after the first reveal, then claim the timeout win.";
  if (message.includes("0xddefae28")) return "You already minted a kicker on this deployment.";
  if (message.includes("0x13be252b")) return "Approve DuelCredit before creating or joining a duel.";
  if (message.includes("0xf4d678b8")) return "You need more DuelCredit. Claim DCR before creating or joining.";
  if (message.includes("0x4fe86840")) return "This wallet does not own that kicker.";
  if (message.includes("User rejected") || message.includes("denied")) return "Wallet request cancelled.";
  return message;
}

function App() {
  const [route, setRoute] = useState(location.hash || "#home");
  const [account, setAccount] = useState<`0x${string}` | "">("");
  const [provider, setProvider] = useState<WalletProvider | null>(null);

  useEffect(() => {
    const onHashChange = () => setRoute(location.hash || "#home");
    addEventListener("hashchange", onHashChange);
    return () => removeEventListener("hashchange", onHashChange);
  }, []);

  const page = useMemo(() => route.replace("#", ""), [route]);

  async function connect() {
    const wallet = window.okxwallet ?? window.ethereum;
    if (!wallet) return;
    const accounts = (await wallet.request({ method: "eth_requestAccounts" })) as `0x${string}`[];
    await ensureXLayer(wallet);
    setProvider(wallet);
    setAccount(accounts[0] ?? "");
  }

  async function disconnect() {
    try {
      const wallet = provider ?? window.okxwallet ?? window.ethereum;
      await wallet?.request?.({
        method: "wallet_revokePermissions",
        params: [{ eth_accounts: {} }],
      });
    } catch {
      // Many injected wallets do not support permission revocation.
    }
    setProvider(null);
    setAccount("");
  }

  return (
    <main>
      <nav className="nav">
        <a className="brand" href="#home">
          <span>PK</span> Panenka
        </a>
        <div className="links">
          <a href="#play">Play</a>
          <a href="#replay">Replay</a>
          <a href="#leaderboard">Leaderboard</a>
          <a href="#me">Me</a>
          <a href={XLAYER_TESTNET_FAUCET} target="_blank" rel="noreferrer">Faucet</a>
          {account ? (
            <>
              <button onClick={connect}>{short(account)}</button>
              <button className="disconnectButton" onClick={disconnect}>Disconnect</button>
            </>
          ) : (
            <button onClick={connect}>Connect wallet</button>
          )}
        </div>
      </nav>

      {page === "play" ? (
        <Play account={account} provider={provider} connect={connect} />
      ) : page === "replay" ? (
        <Replay />
      ) : page === "leaderboard" ? (
        <Leaderboard />
      ) : page === "me" ? (
        <Me account={account} provider={provider} connect={connect} />
      ) : (
        <Home />
      )}
    </main>
  );
}

function Home() {
  const [proof, setProof] = useState<ProofActivity | null>(null);
  const [countryRace, setCountryRace] = useState<CountryLeaderboardRow[]>([]);
  const [homeBotHealth, setHomeBotHealth] = useState<BotHealth | null>(null);
  const [proofStatus, setProofStatus] = useState("Loading live X Layer activity...");
  const [raceStatus, setRaceStatus] = useState("Loading country race...");
  const [homeBotStatus, setHomeBotStatus] = useState("Checking Panenka Bot...");
  const [testerCopyStatus, setTesterCopyStatus] = useState("Copy the 60-second tester invite.");

  useEffect(() => {
    async function loadProof() {
      try {
        const response = await fetch("/api/proof");
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "Proof API failed.");
        setProof(body);
        setProofStatus(`Live at block ${body.chain?.latestBlock ?? "unknown"}.`);
      } catch (error) {
        setProofStatus(error instanceof Error ? error.message : "Could not load live activity.");
      }
    }
    void loadProof();
  }, []);

  useEffect(() => {
    async function loadCountryRace() {
      try {
        const response = await fetch("/api/leaderboard");
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "Leaderboard API failed.");
        const rows = (body.countryRows ?? []) as CountryLeaderboardRow[];
        setCountryRace(rows.slice(0, 3));
        setRaceStatus(rows.length ? "Live country race from KickerNFT stats." : "Country race appears after settled duels.");
      } catch (error) {
        setRaceStatus(error instanceof Error ? error.message : "Could not load country race.");
      }
    }
    void loadCountryRace();
  }, []);

  useEffect(() => {
    async function loadBotHealth() {
      try {
        const response = await fetch("/api/bot-opponent");
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "Bot health check failed.");
        setHomeBotHealth(body);
        setHomeBotStatus(body.ready ? "Panenka Bot is ready for public duels." : "Panenka Bot is not ready right now.");
      } catch (error) {
        setHomeBotStatus(error instanceof Error ? error.message : "Could not load bot status.");
      }
    }
    void loadBotHealth();
  }, []);

  const activity = proof?.onchainActivity;
  const latestSettledDuel = proof?.recentDuels?.find((duel) => duel.statusLabel === "Settled" && duel.p1Country && duel.p2Country);
  const latestSettlementTx = latestSettledDuel?.settlementTx?.explorer;
  const proofDuelTx = proof?.proofDuel?.transactions?.playerTwoRevealAndSettle?.explorer;
  const duelContract = proof?.contracts?.PenaltyDuel;
  const walletTotal = proof?.wallets?.total ?? activity?.activeWallets ?? activity?.mintedKickers ?? "-";
  const walletDetail = proof?.wallets
    ? `${proof.wallets.exhibition} exhibition + ${proof.wallets.manual} manual`
    : "active player wallets";
  const walletBreakdown = proof?.wallets
    ? `${proof.wallets.exhibition} exhibition + ${proof.wallets.manual} manual`
    : `${activity?.activeWallets ?? activity?.mintedKickers ?? "-"} active wallets`;
  const heroDuelId = latestSettledDuel?.duelId ?? "1";
  const heroSideOne = latestSettledDuel?.p1Country ?? "Nigeria";
  const heroSideTwo = latestSettledDuel?.p2Country ?? "France";
  const heroScore = latestSettledDuel?.score ?? "3-0";
  const [heroSideOneScore, heroSideTwoScore] = heroScore.split("-");
  const heroShareText = `Panenka duel #${heroDuelId}: ${heroSideOne} ${heroScore} ${heroSideTwo} on X Layer`;
  const liveProofShareText = [
    "Panenka proof update:",
    `${activity?.settledDuels ?? "30"} settled penalty duels`,
    `${activity?.activeWallets ?? "20"} active player wallets`,
    `${activity?.countryCount ?? "8"} countries onchain`,
    "",
    `Latest replay: ${heroSideOne} ${heroScore} ${heroSideTwo}.`,
    "",
    "Game, not market: hidden commit -> reveal -> settle on X Layer.",
  ].join("\n");
  const testerInvite = [
    "Can you test Panenka for me? It is a World Cup-style penalty shootout game on X Layer testnet.",
    "",
    "Flow: connect wallet -> mint a country kicker -> claim DCR -> approve -> create a 1 DCR duel -> bot joins -> reveal -> bot reveals and settles.",
    "",
    `Need testnet OKB gas? Official X Layer faucet: ${XLAYER_TESTNET_FAUCET}`,
    "",
    `App: ${location.origin}`,
    "",
    "After settlement, download the result image and post or send it back with the settlement tx. No betting and no real-money stake.",
    "If you post the result, use Share result on X, attach the downloaded image, and tag @PanenkaGG + @XLayerOfficial.",
  ].join("\n");

  async function copyTesterInvite() {
    try {
      await navigator.clipboard?.writeText(testerInvite);
      setTesterCopyStatus("Tester invite copied.");
    } catch {
      setTesterCopyStatus("Clipboard blocked. Use the tester path text on this card.");
    }
  }

  return (
    <section className="homePage">
      <section className="hero heroV2">
      <div className="heroCopy">
        <p className="eyebrow">Playable country rivalry on X Layer</p>
        <h1>Put your country on the spot.</h1>
        <p className="lede">
          Panenka is a fast onchain penalty duel. Pick a country, commit a hidden shootout plan, reveal, and settle a winner
          with non-transferable in-game DuelCredit. No betting, no oracle, no official tournament branding.
        </p>
        <div className="ctaRow">
          <a className="primary" href="#play">Start a 1 DCR bot duel</a>
          <a className="secondary" href={XLAYER_TESTNET_FAUCET} target="_blank" rel="noreferrer">Get test OKB</a>
          <a className="secondary subtle" href="#leaderboard">See country race</a>
        </div>
        <div className="onboardingStrip" aria-label="Quick start">
          <span><strong>01</strong> Connect wallet</span>
          <span><strong>02</strong> Mint country kicker</span>
          <span><strong>03</strong> Bot joins and settles</span>
        </div>
        <div className="heroProof">
          <span>{activity?.settledDuels ?? "-"} settled duels</span>
          <span>{activity?.countryCount ?? "-"} countries live</span>
          <span>{walletBreakdown}</span>
          <span>{activity?.mintedKickers ?? "-"} kickers minted</span>
          <span>game, not gamble</span>
        </div>
        <article className="liveActivity">
          <div>
            <span>Live X Layer activity</span>
            <strong>{proofStatus}</strong>
          </div>
          <div className="activityStats">
            <span><strong>{activity?.mintedKickers ?? "-"}</strong> kickers minted</span>
            <span><strong>{activity?.settledDuels ?? "-"}</strong> duels settled</span>
            <span><strong>{activity?.countryCount ?? "-"}</strong> countries live</span>
            <span><strong>{walletTotal}</strong> wallets <em>{walletDetail}</em></span>
          </div>
          {proof?.wallets ? <p className="activityFootnote">{proof.wallets.exhibitionPurpose}</p> : null}
          <div className="countryRace">
            <div className="countryRaceHeader">
              <strong>Country race</strong>
              <span>{raceStatus}</span>
            </div>
            {countryRace.length ? (
              countryRace.map((row, index) => (
                <a className="raceRow" href={shareCountryUrl(row, index + 1)} target="_blank" rel="noreferrer" key={row.country}>
                  <span>#{index + 1}</span>
                  <strong>{row.country}</strong>
                  <span>{row.wins} wins</span>
                  <span>{row.streak} streak</span>
                  <em>challenge</em>
                </a>
              ))
            ) : (
              <p className="muted">Settle a duel to start the country race.</p>
            )}
          </div>
          <div className={`botReady ${homeBotHealth?.ready ? "isReady" : ""}`}>
            <div>
              <span>Playable now</span>
              <strong>{homeBotStatus}</strong>
            </div>
            <div>
              <span>Public cap</span>
              <strong>
                {homeBotHealth ? `${Number(homeBotHealth.publicStakeCap).toLocaleString(undefined, { maximumFractionDigits: 2 })} DCR` : "-"}
              </strong>
            </div>
            <div>
              <span>Bot fuel</span>
              <strong>
                {homeBotHealth ? `${Number(homeBotHealth.duelCredit).toLocaleString(undefined, { maximumFractionDigits: 2 })} DCR` : "-"}
              </strong>
            </div>
            <a href="#play">Start a bot duel</a>
          </div>
          <div className="testerMission">
            <div>
              <span>Tester mission</span>
              <strong>One wallet can finish a public 1 DCR bot duel in about a minute.</strong>
              <p>{testerCopyStatus}</p>
            </div>
            <ol>
              <li>Connect on X Layer testnet.</li>
              <li>If your wallet has no gas, claim testnet OKB from the official X Layer faucet.</li>
              <li>Mint a country kicker and claim DuelCredit.</li>
              <li>Create a 1 DCR duel, let Panenka Bot join, reveal, then let the bot settle.</li>
              <li>Download the result image, then share the X post with the image attached.</li>
            </ol>
            <div className="testerActions">
              <button onClick={copyTesterInvite}>Copy tester invite</button>
              <a href="#play">Start test duel</a>
              <a href={XLAYER_TESTNET_FAUCET} target="_blank" rel="noreferrer">Get test OKB</a>
            </div>
          </div>
          <div className="activityLinks">
            <a href={shareProofUrl(liveProofShareText)} target="_blank" rel="noreferrer">Share live proof</a>
            <a href="https://x.com/PanenkaGG" target="_blank" rel="noreferrer">Project X</a>
            <a href="/api/proof" target="_blank" rel="noreferrer">Proof API</a>
            {duelContract ? <a href={duelContract.explorer} target="_blank" rel="noreferrer">Duel contract</a> : null}
            {latestSettlementTx ? <a href={latestSettlementTx} target="_blank" rel="noreferrer">Latest tx</a> : null}
            {!latestSettlementTx && proofDuelTx ? <a href={proofDuelTx} target="_blank" rel="noreferrer">Baseline proof tx</a> : null}
          </div>
        </article>
      </div>
      <div className="duelCard featuredDuel">
        <div className="duelTop">
          <span>Duel #{heroDuelId} settled</span>
          <span>Live X Layer state</span>
        </div>
        <div className="pitch">
          <div className="goal" />
          <div className="ball" />
          <div className="keeper">GK</div>
          <div className="pitchScore">
            <span>{heroSideOne}</span>
            <strong>{heroScore}</strong>
            <span>{heroSideTwo}</span>
          </div>
        </div>
        <div className="score">
          <span>{heroSideOne} {heroSideOneScore ?? "-"}</span>
          <strong>{heroSideTwoScore ?? "-"}</strong>
          <span>{heroSideTwo}</span>
        </div>
        <div className="heroTx">latest settled duel · {activity?.settledDuels ?? "-"} total settlements · NFT stats updated</div>
        <div className="heroDuelActions">
          <a href="#replay">Replay this duel</a>
          <a href={shareResultUrl(heroShareText)} target="_blank" rel="noreferrer">Share result</a>
          {latestSettlementTx ? (
            <a href={latestSettlementTx} target="_blank" rel="noreferrer">Open latest tx</a>
          ) : (
            <a href="/api/proof" target="_blank" rel="noreferrer">Open proof API</a>
          )}
        </div>
      </div>
      </section>
    </section>
  );
}

function Play({
  account,
  provider,
  connect,
}: {
  account: `0x${string}` | "";
  provider: WalletProvider | null;
  connect: () => Promise<void>;
}) {
  const [selectedCountry, setSelectedCountry] = useState(countries[3]);
  const [stake, setStake] = useState("1");
  const [joinDuelId, setJoinDuelId] = useState("");
  const [revealDuelId, setRevealDuelId] = useState("");
  const [status, setStatus] = useState("Ready.");
  const [lastTx, setLastTx] = useState("");
  const [nextDuelId, setNextDuelId] = useState<number | null>(null);
  const [tokenId, setTokenId] = useState<bigint>(0n);
  const [ownedCountry, setOwnedCountry] = useState("");
  const [ownedCountryId, setOwnedCountryId] = useState(0);
  const [balance, setBalance] = useState<bigint>(0n);
  const [storedPlanIds, setStoredPlanIds] = useState<number[]>([]);
  const [txBusy, setTxBusy] = useState(false);
  const [botBusy, setBotBusy] = useState(false);
  const [creatingDuel, setCreatingDuel] = useState(false);
  const [inviteLink, setInviteLink] = useState("");
  const [duelView, setDuelView] = useState<DuelView | null>(null);
  const [settlementText, setSettlementText] = useState("");
  const [roundResults, setRoundResults] = useState<RoundResult[]>([]);
  const [animatedRound, setAnimatedRound] = useState(0);
  const [actionNotice, setActionNotice] = useState("Create a duel, let the bot join, then reveal from this same browser.");
  const [botHealth, setBotHealth] = useState<BotHealth | null>(null);
  const [botHealthStatus, setBotHealthStatus] = useState("Checking Panenka Bot readiness...");
  const settlementRef = useRef<HTMLElement | null>(null);
  const canWrite = Boolean(account && provider && hasContracts);

  function notify(message: string) {
    setStatus(message);
    setActionNotice(message);
  }

  useEffect(() => {
    const invitedDuelId = new URLSearchParams(location.search).get("duel");
    if (invitedDuelId) {
      setJoinDuelId(invitedDuelId);
      setRevealDuelId(invitedDuelId);
      setInviteLink(playLink(invitedDuelId));
    }
    void refresh();
    void refreshBotHealth();
  }, [account]);

  useEffect(() => {
    const duelId = revealDuelId || joinDuelId;
    if (duelId) void inspectDuel(duelId, false);
  }, [revealDuelId, joinDuelId, account]);

  useEffect(() => {
    if (!roundResults.length) {
      setAnimatedRound(0);
      return;
    }
    setAnimatedRound(1);
    const timers = roundResults.slice(1).map((_, index) => window.setTimeout(() => setAnimatedRound(index + 2), (index + 1) * 700));
    return () => timers.forEach(window.clearTimeout);
  }, [roundResults]);

  useEffect(() => {
    if (!settlementText) return;
    window.setTimeout(() => settlementRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
  }, [settlementText]);

  async function refresh() {
    if (!hasContracts) return;
    try {
      const reads = await Promise.all([
        publicClient.readContract({ address: addresses.penaltyDuel!, abi: penaltyDuelAbi, functionName: "nextDuelId" }),
        account
          ? publicClient.readContract({ address: addresses.kickerNft!, abi: kickerNftAbi, functionName: "tokenOfOwner", args: [account] })
          : Promise.resolve(0n),
        account
          ? publicClient.readContract({ address: addresses.duelCredit!, abi: duelCreditAbi, functionName: "balanceOf", args: [account] })
          : Promise.resolve(0n),
      ]);
      setNextDuelId(Number(reads[0]));
      const currentTokenId = reads[1] as bigint;
      setTokenId(currentTokenId);
      setBalance(reads[2] as bigint);
      setStoredPlanIds(account ? localPlanIds(account) : []);
      if (currentTokenId > 0n) {
        const stats = (await publicClient.readContract({
          address: addresses.kickerNft!,
          abi: kickerNftAbi,
          functionName: "statsOf",
          args: [currentTokenId],
        })) as readonly unknown[];
        const countryId = Number(stats[0]);
        setOwnedCountryId(countryId);
        setOwnedCountry(countryById[countryId] ?? `Country ${countryId}`);
        if (countryOptionById[countryId]) setSelectedCountry(countryOptionById[countryId]);
      } else {
        setOwnedCountry("");
        setOwnedCountryId(0);
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : "Read failed.");
    }
  }

  async function refreshBotHealth() {
    try {
      const response = await fetch("/api/bot-opponent");
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Bot health check failed.");
      setBotHealth(body);
      setBotHealthStatus(
        body.ready
          ? `Panenka Bot ready for ${Number(body.publicStakeCap).toLocaleString(undefined, { maximumFractionDigits: 2 })} DCR public duels.`
          : "Panenka Bot is not ready. Use a second wallet if you want to play now.",
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not check Panenka Bot readiness.";
      setBotHealthStatus(message.includes("<!doctype") || message.includes("Unexpected token") ? "Bot readiness checks on the live app." : message);
    }
  }

  async function inspectDuel(duelIdInput = revealDuelId || joinDuelId, updateStatus = true) {
    if (!duelIdInput || !hasContracts) return;
    try {
      const duelId = Number(duelIdInput);
      const duel = (await publicClient.readContract({
        address: addresses.penaltyDuel!,
        abi: penaltyDuelAbi,
        functionName: "getDuel",
        args: [BigInt(duelId)],
      })) as any;
      const view: DuelView = {
        id: duelId,
        status: Number(duel.status),
        statusLabel: duel.p1.player === ZERO_ADDRESS ? "Not created" : duelStatusLabel(Number(duel.status)),
        stake: formatUnits(duel.stake, 18),
        p1: duel.p1.player,
        p2: duel.p2.player,
        p1Revealed: Boolean(duel.p1.revealed),
        p2Revealed: Boolean(duel.p2.revealed),
        nextStep: "",
      };
      view.nextStep = duelNextStep(view, account);
      setDuelView(view);
      if (view.status === 2) {
        await showSettledDuelFromState(duelId, duel);
        if (updateStatus) notify(`Duel #${duelId} is settled. Result loaded from X Layer.`);
        return;
      }
      setSettlementText("");
      setRoundResults([]);
      if (updateStatus) notify(view.nextStep);
    } catch (error) {
      if (updateStatus) notify(error instanceof Error ? error.message : "Could not read duel state.");
    }
  }

  async function showSettledDuelFromState(duelId: number, duel: any) {
    const replay = roundsFromDuelState(duel, BigInt(duelId));
    setRoundResults(replay.rounds);

    const [p1Stats, p2Stats] = await Promise.all([
      publicClient.readContract({ address: addresses.kickerNft!, abi: kickerNftAbi, functionName: "statsOf", args: [duel.p1.kickerTokenId] }),
      publicClient.readContract({ address: addresses.kickerNft!, abi: kickerNftAbi, functionName: "statsOf", args: [duel.p2.kickerTokenId] }),
    ]);
    const p1Country = countryById[Number((p1Stats as readonly unknown[])[0])] ?? `Country ${(p1Stats as readonly unknown[])[0]}`;
    const p2Country = countryById[Number((p2Stats as readonly unknown[])[0])] ?? `Country ${(p2Stats as readonly unknown[])[0]}`;
    const winnerCountry = replay.p1Score > replay.p2Score ? p1Country : p2Country;
    setSettlementText(`Duel #${duelId}: ${p1Country} ${replay.score} ${p2Country}. Winner: ${winnerCountry}.`);

    try {
      const response = await fetch("/api/proof", { cache: "no-store" });
      const body = await response.json();
      const proofDuel = body.recentDuels?.find((entry: any) => String(entry.duelId) === String(duelId));
      if (proofDuel?.settlementTx?.hash) setLastTx(proofDuel.settlementTx.hash);
    } catch {
      // Result reconstruction from chain state is enough if proof API indexing lags.
    }
  }

  async function write(action: () => Promise<`0x${string}`>, label: string) {
    if (txBusy) {
      notify("A wallet transaction is already in progress. Wait for it to finish before clicking again.");
      return null;
    }
    if (!canWrite) {
      notify(account ? "Deploy contract addresses before writing." : "Connect wallet first.");
      if (!account) await connect();
      return;
    }
    if (!provider) {
      notify("Connect wallet first.");
      return;
    }
    try {
      setTxBusy(true);
      await ensureXLayer(provider);
      notify(`${label}...`);
      const hash = await action();
      setLastTx(hash);
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      readSettlementFromReceipt(receipt);
      notify(`${label} confirmed.`);
      await refresh();
      await inspectDuel(undefined, false);
      return hash;
    } catch (error) {
      notify(humanError(error));
      return null;
    } finally {
      setTxBusy(false);
    }
  }

  function walletClient() {
    if (!provider || !account) throw new Error("Connect wallet first.");
    return createWalletClient({ account, chain: xLayer, transport: custom(provider) });
  }

  async function claimFaucet() {
    await write(
      () => walletClient().writeContract({ address: addresses.duelCredit!, abi: duelCreditAbi, functionName: "claimFaucet" }),
      "Claiming DuelCredit",
    );
  }

  async function mintKicker() {
    if (tokenId > 0n) {
      if (selectedCountry.id === ownedCountryId) {
        notify(`${ownedCountry || "Your"} kicker #${tokenId} is ready. Pick a different country if you want to switch teams.`);
        return;
      }
      await write(
        () =>
          walletClient().writeContract({
            address: addresses.kickerNft!,
            abi: kickerNftAbi,
            functionName: "changeCountry",
            args: [selectedCountry.id],
          }),
        `Switching team to ${selectedCountry.name}`,
      );
      return;
    }
    await write(
      () => walletClient().writeContract({ address: addresses.kickerNft!, abi: kickerNftAbi, functionName: "mint", args: [selectedCountry.id] }),
      `Minting ${selectedCountry.name}`,
    );
  }

  async function approveCredits() {
    await write(
      () =>
        walletClient().writeContract({
          address: addresses.duelCredit!,
          abi: duelCreditAbi,
          functionName: "approve",
          args: [addresses.penaltyDuel!, parseUnits("100", 18)],
        }),
      "Approving DuelCredit",
    );
  }

  async function canSpendStake(amount: bigint) {
    if (!account) return false;
    if (tokenId === 0n) {
      notify("Mint a country kicker before creating or joining a duel.");
      return false;
    }
    const [freshBalance, allowance] = await Promise.all([
      publicClient.readContract({ address: addresses.duelCredit!, abi: duelCreditAbi, functionName: "balanceOf", args: [account] }),
      publicClient.readContract({ address: addresses.duelCredit!, abi: duelCreditAbi, functionName: "allowance", args: [account, addresses.penaltyDuel!] }),
    ]);
    if ((freshBalance as bigint) < amount) {
      notify("Claim DuelCredit before creating or joining a duel.");
      return false;
    }
    if ((allowance as bigint) < amount) {
      notify("Approve the duel contract before creating or joining a duel.");
      return false;
    }
    return true;
  }

  async function createDuel() {
    if (!account) return;
    if (creatingDuel) {
      notify("Duel creation is already in progress. Wait for the wallet transaction to finish.");
      return;
    }
    const stakeAmount = parseUnits(stake || "0", 18);
    if (stakeAmount <= 0n) {
      notify("Duel entry must be greater than 0 DCR.");
      return;
    }
    if (!(await canSpendStake(stakeAmount))) return;
    const duelId = Number(await publicClient.readContract({ address: addresses.penaltyDuel!, abi: penaltyDuelAbi, functionName: "nextDuelId" }));
    const plan = { ...makePlan(account), duelId };
    const hash = commitment(account, plan.shots, plan.saves, plan.salt);
    setCreatingDuel(true);
    const tx = await write(
      () =>
        walletClient().writeContract({
          address: addresses.penaltyDuel!,
          abi: penaltyDuelAbi,
          functionName: "createDuel",
          args: [stakeAmount, tokenId, hash],
        }),
      `Creating duel #${duelId}`,
    );
    setCreatingDuel(false);
    if (!tx) return;
    const actualDuelId = await createdDuelIdFromReceipt(tx, duelId);
    const storedPlan = { ...plan, duelId: actualDuelId };
    savePlan(account, storedPlan);
    setStoredPlanIds(localPlanIds(account));
    setRevealDuelId(String(actualDuelId));
    setJoinDuelId(String(actualDuelId));
    const link = playLink(actualDuelId);
    setInviteLink(link);
    const botCap = botHealth?.publicStakeCap ? parseUnits(botHealth.publicStakeCap, 18) : parseUnits("1", 18);
    const createdMessage =
      stakeAmount > botCap
        ? `Duel #${actualDuelId} created with ${stake} DCR. This is above Panenka Bot's ${formatUnits(botCap, 18)} DCR cap, so send the invite to a human wallet.`
        : `Duel #${actualDuelId} created. Now click Bot joins this duel.`;
    try {
      await navigator.clipboard?.writeText(link);
      notify(`${createdMessage} Invite link copied.`);
    } catch {
      notify(createdMessage);
    }
  }

  async function createdDuelIdFromReceipt(hash: `0x${string}`, fallbackDuelId: number) {
    try {
      const receipt = await publicClient.getTransactionReceipt({ hash });
      for (const log of receipt.logs) {
        if (log.address.toLowerCase() !== addresses.penaltyDuel?.toLowerCase()) continue;
        const decoded = decodeEventLog({ abi: penaltyDuelAbi, data: log.data, topics: [...log.topics] as any });
        if (decoded.eventName === "DuelCreated") return Number((decoded.args as any).duelId);
      }
    } catch {
      // Fallback keeps the UI usable if an RPC read races indexing.
    }
    return fallbackDuelId;
  }

  async function joinDuel() {
    if (!account || !joinDuelId) return;
    const duelId = Number(joinDuelId);
    const duel = (await publicClient.readContract({
      address: addresses.penaltyDuel!,
      abi: penaltyDuelAbi,
      functionName: "getDuel",
      args: [BigInt(duelId)],
    })) as any;
    if (duel.p1.player === ZERO_ADDRESS) {
      notify("That duel was never created. Ask your friend for a fresh invite link.");
      return;
    }
    if (Number(duel.status) !== 0) {
      notify("That duel is no longer open. Create or join a fresh duel.");
      return;
    }
    if (!(await canSpendStake(duel.stake as bigint))) return;
    const plan = { ...makePlan(account), duelId };
    const hash = commitment(account, plan.shots, plan.saves, plan.salt);
    const tx = await write(
      () =>
        walletClient().writeContract({
          address: addresses.penaltyDuel!,
          abi: penaltyDuelAbi,
          functionName: "joinDuel",
          args: [BigInt(duelId), tokenId, hash],
      }),
      `Joining duel #${duelId}`,
    );
    if (!tx) return;
    savePlan(account, plan);
    setStoredPlanIds(localPlanIds(account));
    setRevealDuelId(String(duelId));
    notify(`Duel #${duelId} joined. Reveal with this wallet, then switch back so the creator can reveal.`);
  }

  async function revealDuel() {
    if (!account) {
      notify("Connect the wallet that created or joined this duel.");
      return;
    }
    if (!revealDuelId) {
      notify("Enter the duel ID you want to reveal.");
      return;
    }
    const duelId = Number(revealDuelId);
    notify(`Checking reveal for duel #${duelId}...`);
    const plan = loadPlan(account, duelId);
    if (!plan) {
      notify("No local hidden plan in this browser. Create a fresh duel here, then reveal from this same browser.");
      return;
    }
    let duel: any;
    try {
      duel = (await publicClient.readContract({
        address: addresses.penaltyDuel!,
        abi: penaltyDuelAbi,
        functionName: "getDuel",
        args: [BigInt(duelId)],
      })) as any;
    } catch (error) {
      notify(humanError(error));
      return;
    }
    if (duel.p1.player === ZERO_ADDRESS) {
      notify("That duel was never created. Create a fresh duel.");
      return;
    }
    if (Number(duel.status) !== 1) {
      notify("That duel is not waiting for reveal. Create a fresh duel if it already settled.");
      return;
    }
    const lower = account.toLowerCase();
    const isP1 = duel.p1.player.toLowerCase() === lower;
    const isP2 = duel.p2.player.toLowerCase() === lower;
    if (!isP1 && !isP2) {
      notify("This wallet is not a player in that duel.");
      return;
    }
    if ((isP1 && duel.p1.revealed) || (isP2 && duel.p2.revealed)) {
      notify("This wallet already revealed for that duel.");
      return;
    }
    await write(
      () =>
        walletClient().writeContract({
          address: addresses.penaltyDuel!,
          abi: penaltyDuelAbi,
          functionName: "reveal",
          args: [BigInt(revealDuelId), plan.shots, plan.saves, plan.salt],
        }),
      `Revealing duel #${revealDuelId}`,
    );
    notify(`Reveal for duel #${revealDuelId} confirmed. If both wallets revealed, the duel settled onchain.`);
  }

  function readSettlementFromReceipt(receipt: { logs: readonly { topics: readonly `0x${string}`[]; data: `0x${string}`; address: `0x${string}` }[] }) {
    const rounds: RoundResult[] = [];
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== addresses.penaltyDuel?.toLowerCase()) continue;
      try {
        const decoded = decodeEventLog({ abi: penaltyDuelAbi, data: log.data, topics: [...log.topics] as any });
        if (decoded.eventName === "RoundResolved") {
          const args = decoded.args as any;
          rounds.push({
            round: Number(args.round),
            youGoal: Boolean(args.p1Goal),
            botGoal: Boolean(args.p2Goal),
            p1Shot: Number(args.p1Shot),
            p2Shot: Number(args.p2Shot),
            p1Save: Number(args.p1Save),
            p2Save: Number(args.p2Save),
          });
          continue;
        }
        if (decoded.eventName === "DuelSettled") {
          const args = decoded.args as any;
          const duelId = BigInt(args.duelId);
          const p1Score = Number(args.p1Score);
          const p2Score = Number(args.p2Score);
          const winner = short(args.winner);
          setSettlementText(`Duel #${duelId} settled: ${winner} won ${p1Score}-${p2Score}.`);
          void enrichSettlementText(duelId, args.winner, p1Score, p2Score);
          continue;
        }
        if (decoded.eventName === "DuelForfeited") {
          const args = decoded.args as any;
          setSettlementText(`Duel #${BigInt(args.duelId)} forfeited. ${short(args.winner)} won after opponent timeout.`);
        }
      } catch {
        // Ignore non-Panenka logs in the same transaction.
      }
    }
    if (rounds.length) setRoundResults(rounds.sort((a, b) => a.round - b.round));
  }

  async function enrichSettlementText(duelId: bigint, winner: `0x${string}`, p1Score: number, p2Score: number) {
    try {
      const duel = (await publicClient.readContract({
        address: addresses.penaltyDuel!,
        abi: penaltyDuelAbi,
        functionName: "getDuel",
        args: [duelId],
      })) as any;
      const [p1Stats, p2Stats] = await Promise.all([
        publicClient.readContract({ address: addresses.kickerNft!, abi: kickerNftAbi, functionName: "statsOf", args: [duel.p1.kickerTokenId] }),
        publicClient.readContract({ address: addresses.kickerNft!, abi: kickerNftAbi, functionName: "statsOf", args: [duel.p2.kickerTokenId] }),
      ]);
      const p1Country = countryById[Number((p1Stats as readonly unknown[])[0])] ?? `Country ${(p1Stats as readonly unknown[])[0]}`;
      const p2Country = countryById[Number((p2Stats as readonly unknown[])[0])] ?? `Country ${(p2Stats as readonly unknown[])[0]}`;
      const winnerCountry = winner.toLowerCase() === duel.p1.player.toLowerCase() ? p1Country : p2Country;
      const result = `${p1Country} ${p1Score}-${p2Score} ${p2Country}`;
      setSettlementText(`Duel #${duelId}: ${result}. Winner: ${winnerCountry}.`);
    } catch {
      // The wallet-visible settlement text above is still valid if an RPC read races indexing.
    }
  }

  async function callBot(action: "join" | "reveal") {
    const duelId = Number(action === "join" ? joinDuelId || revealDuelId : revealDuelId || joinDuelId);
    if (!duelId) {
      notify("Enter a duel ID first.");
      return;
    }
    if (duelView?.id === duelId && duelView.p1.toLowerCase() === ZERO_ADDRESS) {
      notify("This duel was never created. Click Create hidden duel first, then let Panenka Bot join.");
      return;
    }
    if (
      action === "join" &&
      botHealth &&
      duelView?.id === duelId &&
      Number(duelView.stake) > Number(botHealth.publicStakeCap)
    ) {
      notify(`Panenka Bot only joins public duels up to ${botHealth.publicStakeCap} DCR. Send this invite to a human wallet or create a 1 DCR bot duel.`);
      return;
    }
    if (action === "reveal" && duelView?.id === duelId && duelView.p2Revealed && !duelView.p1Revealed) {
      notify("Panenka Bot already revealed. Click Reveal my plan from the creator wallet to settle.");
      return;
    }
    setBotBusy(true);
    notify(`Panenka Bot ${action === "join" ? "joining" : "revealing"} duel #${duelId}...`);
    try {
      const result = await fetch("/api/bot-opponent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, duelId }),
      });
      const contentType = result.headers.get("content-type") ?? "";
      const body = contentType.includes("application/json") ? await result.json() : { error: await result.text() };
      if (!result.ok) throw new Error(body.error ?? "Bot request failed.");
      setLastTx(body.hash);
      const receipt = await publicClient.getTransactionReceipt({ hash: body.hash });
      readSettlementFromReceipt(receipt);
      notify(
        action === "join"
          ? `Panenka Bot joined duel #${duelId}. Reveal from your wallet next.`
          : `Panenka Bot revealed duel #${duelId}. If you already revealed, the duel is settled.`,
      );
      await refresh();
      await refreshBotHealth();
      await inspectDuel(String(duelId), true);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Bot request failed.");
    } finally {
      setBotBusy(false);
    }
  }

  async function claimTimeoutWin() {
    const duelId = Number(revealDuelId || joinDuelId);
    if (!duelId) {
      notify("Enter a duel ID first.");
      return;
    }
    await write(
      () =>
        walletClient().writeContract({
          address: addresses.penaltyDuel!,
          abi: penaltyDuelAbi,
          functionName: "claimForfeit",
          args: [BigInt(duelId)],
        }),
      `Claiming timeout win for duel #${duelId}`,
    );
    await inspectDuel(String(duelId), true);
  }

  async function copyInvite() {
    const duelId = joinDuelId || revealDuelId;
    if (!duelId) {
      notify("Create a duel or enter a duel ID first.");
      return;
    }
    const link = playLink(duelId);
    setInviteLink(link);
    try {
      await navigator.clipboard?.writeText(link);
      notify(`Invite link for duel #${duelId} copied.`);
    } catch {
      notify(`Invite link ready for duel #${duelId}.`);
    }
  }

  async function downloadResultImage() {
    if (!settlementText) {
      notify("Settle a duel first, then download the result image.");
      return;
    }
    try {
      const blob = await resultImageBlob(settlementText, lastTx, roundResults);
      await saveBlob(blob, `panenka-duel-${revealDuelId || joinDuelId || "result"}.png`);
      notify("Result image downloaded. Attach it to your X post for better visibility.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not generate result image.");
    }
  }

  const walletStatus = account ? short(account) : "Not connected";
  const kickerStatus =
    tokenId > 0n ? `#${tokenId} · ${ownedCountry || "Country selected"}` : "No kicker yet";
  const dcrStatus = `${Number(formatUnits(balance, 18)).toLocaleString(undefined, { maximumFractionDigits: 2 })} DCR`;
  const botStatus = botHealth
    ? `${botHealth.ready ? "Ready" : "Not ready"} · ${Number(botHealth.duelCredit).toLocaleString(undefined, {
        maximumFractionDigits: 2,
      })} DCR`
    : botHealthStatus;
  const localPlanStatus = storedPlanIds.length ? `#${storedPlanIds.join(", #")}` : "None yet";

  return (
    <section className="page playPage">
      <div className="playHero">
        <div className="playHeroCopy">
          <p className="eyebrow">Match control room</p>
          <h2>Take the penalty. Let X Layer settle it.</h2>
          <p className="lede compact">
            Pick a country, claim in-game DuelCredit, commit a hidden shootout plan, and reveal after the opponent joins.
            The contract settles the shootout and updates the leaderboard on X Layer.
          </p>
          <div className="playHeroActions">
            <button className="primary" onClick={account ? refresh : connect}>{account ? "Refresh wallet" : "Connect wallet"}</button>
            <a className="secondary" href={XLAYER_TESTNET_FAUCET} target="_blank" rel="noreferrer">Get test OKB</a>
          </div>
        </div>

        <aside className="playScoreboard">
          <span>Current session</span>
          <strong>{actionNotice}</strong>
          <div className="playMiniPitch" aria-hidden="true">
            <div className="miniGoal" />
            <div className="miniKeeper">GK</div>
            <div className="miniBall" />
            <div className="miniPitchLine" />
          </div>
          <div className="scoreboardGrid">
            <div>
              <span>Wallet</span>
              <strong>{walletStatus}</strong>
            </div>
            <div>
              <span>Kicker</span>
              <strong>{kickerStatus}</strong>
            </div>
            <div>
              <span>DuelCredit</span>
              <strong>{dcrStatus}</strong>
            </div>
            <div>
              <span>Bot</span>
              <strong>{botStatus}</strong>
            </div>
          </div>
        </aside>
      </div>

      <div className="statusPanel playStatusRail">
        <span>{hasContracts ? `X Layer ${XLAYER_CHAIN_ID}` : "Contracts not configured yet"}</span>
        <span>{nextDuelId ? `Next duel #${nextDuelId}` : "Awaiting deploy"}</span>
        <span>Local reveal plan: {localPlanStatus}</span>
        <strong>{status}</strong>
        {lastTx ? <a href={txLink(lastTx)} target="_blank" rel="noreferrer">View last tx</a> : null}
      </div>

      {duelView ? (
        <article className="duelState playDuelState">
          <div>
            <span>Duel #{duelView.id}</span>
            <strong>{duelView.statusLabel}</strong>
          </div>
          <div>
            <span>Creator</span>
            <strong>{short(duelView.p1)} · {duelView.p1Revealed ? "revealed" : "hidden"}</strong>
          </div>
          <div>
            <span>Opponent</span>
            <strong>{short(duelView.p2)} · {duelView.p2Revealed ? "revealed" : "hidden"}</strong>
          </div>
          <div className="duelStateNext">
            <span>Next click</span>
            <strong>{duelView.nextStep}</strong>
          </div>
          <button onClick={() => inspectDuel(undefined, true)}>Refresh duel state</button>
        </article>
      ) : null}

      {settlementText ? (
        <article className="settlementCard resultCard" ref={settlementRef}>
          <span>Settled onchain</span>
          <strong>{settlementText}</strong>
          {roundResults.length ? (
            <div className="revealStage">
              <ShootoutVisualizer round={roundResults[Math.max(animatedRound - 1, 0)]} />
              <div>
                <span>Live reveal</span>
                <strong>Round {animatedRound || 1} of {roundResults.length}</strong>
                <p>{roundResults[Math.max(animatedRound - 1, 0)]?.youGoal ? "Your shot beats the keeper." : "Keeper reads your shot."}</p>
              </div>
            </div>
          ) : null}
          {roundResults.length ? (
            <div className="roundStrip">
              {roundResults.map((round) => (
                <div key={round.round} className="roundChip">
                  <span>Round {round.round}</span>
                  <strong>{round.youGoal ? "You goal" : "You saved"} · {round.botGoal ? "Bot goal" : "Bot saved"}</strong>
                </div>
              ))}
            </div>
          ) : null}
          {lastTx ? <a href={txLink(lastTx)} target="_blank" rel="noreferrer">Open settlement tx</a> : null}
          <a href={shareResultUrl(settlementText)} target="_blank" rel="noreferrer">Share result on X</a>
          <button onClick={downloadResultImage}>Download result image</button>
        </article>
      ) : null}

      <div className="playRoute" aria-label="Fast play route">
        <span><strong>01</strong> Country kicker</span>
        <span><strong>02</strong> Claim + approve DCR</span>
        <span><strong>03</strong> Hidden plan commit</span>
        <span><strong>04</strong> Reveal + settle</span>
        <a href={XLAYER_TESTNET_FAUCET} target="_blank" rel="noreferrer">Need gas? Faucet</a>
      </div>

      <div className="grid">
        <article className="panel playStep countryStep">
          <div className="stepHeader">
            <span className="stepBadge">01</span>
            <h3>Choose your country</h3>
          </div>
          <p className="muted">
            {tokenId > 0n
              ? `This wallet owns kicker #${tokenId}. Current team: ${ownedCountry || "unknown"}. Pick another country and confirm the switch before creating a duel.`
              : "Pick a country before minting. Each wallet gets one country kicker; this becomes your duel identity and stat card."}
          </p>
          <div className="countryGrid">
            {countries.map((country) => (
              <button
                className={selectedCountry.id === country.id ? "selected" : ""}
                key={country.id}
                onClick={() => setSelectedCountry(country)}
              >
                {country.name}
              </button>
            ))}
          </div>
          <div className="actionRow">
            <button onClick={account ? mintKicker : connect} disabled={txBusy}>
              {tokenId > 0n
                ? selectedCountry.id === ownedCountryId
                  ? `${ownedCountry || "Country"} Kicker #${tokenId}`
                  : `Switch to ${selectedCountry.name}`
                : "Mint kicker"}
            </button>
          </div>
        </article>

        <article className="panel playStep fuelStep">
          <div className="stepHeader">
            <span className="stepBadge">02</span>
            <h3>Fuel and approve</h3>
          </div>
          <p className="muted">DuelCredit is in-game credit. It cannot move wallet-to-wallet; it routes only through the duel contract.</p>
          <div className="balance">{formatUnits(balance, 18)} DCR</div>
          <div className="actionRow">
            <button onClick={claimFaucet} disabled={txBusy}>Claim 100 DCR</button>
            <button onClick={approveCredits} disabled={txBusy}>Approve duel contract</button>
          </div>
        </article>

        <article className="panel playStep createStep">
          <div className="stepHeader">
            <span className="stepBadge">03</span>
            <h3>Create hidden plan</h3>
          </div>
          <label>
            Duel entry (DCR)
            <input value={stake} onChange={(event) => setStake(event.target.value)} />
          </label>
          <p className="muted">
            Your wallet commits a hidden shootout plan. The chain sees only the hash until you reveal.
            {botHealth ? ` Panenka Bot joins up to ${botHealth.publicStakeCap} DCR; larger entries need a human wallet.` : ""}
          </p>
          <button onClick={createDuel} disabled={creatingDuel || txBusy}>{creatingDuel || txBusy ? "Wallet pending..." : "Create hidden duel"}</button>
          <div className="inviteBox">
            <span>Invite link</span>
            <code>{inviteLink || "Create a duel first, then send the generated link to your friend."}</code>
            <button onClick={copyInvite}>Copy invite link</button>
          </div>
        </article>

        <article className="panel playStep finishStep">
          <div className="stepHeader">
            <span className="stepBadge">04</span>
            <h3>Reveal and settle</h3>
          </div>
          <label>
            Duel ID
            <input value={joinDuelId} onChange={(event) => setJoinDuelId(event.target.value)} placeholder="17" />
          </label>
          <p className="muted">
            {botHealth
              ? `Panenka Bot is ${botHealth.ready ? "ready" : "not ready"} for public ${Number(botHealth.publicStakeCap).toLocaleString(undefined, { maximumFractionDigits: 2 })} DCR duels. It has ${Number(botHealth.duelCredit).toLocaleString(undefined, { maximumFractionDigits: 2 })} DCR and kicker #${botHealth.tokenId}.`
              : botHealthStatus}
          </p>
          <div className="actionRow">
            <button onClick={() => callBot("join")} disabled={botBusy || txBusy || (duelView?.id === Number(joinDuelId) && duelView.p1.toLowerCase() === ZERO_ADDRESS)}>
              {botBusy ? "Bot working..." : "Bot joins this duel"}
            </button>
            <button onClick={joinDuel} disabled={txBusy}>Human wallet joins</button>
          </div>
          <label>
            Reveal duel ID
            <input value={revealDuelId} onChange={(event) => setRevealDuelId(event.target.value)} placeholder="17" />
          </label>
          <p className="actionNotice">{actionNotice}</p>
          <div className="actionRow">
            <button onClick={revealDuel} disabled={txBusy}>Reveal my plan</button>
            <button onClick={() => callBot("reveal")} disabled={botBusy || txBusy}>{botBusy ? "Bot working..." : "Bot reveals and settles"}</button>
            <button onClick={claimTimeoutWin} disabled={txBusy}>Claim timeout win</button>
          </div>
        </article>
      </div>

      <article className="panel proofList">
        <h3>Already proven on X Layer testnet</h3>
        <p className="muted">
          Duel #1 settled end to end: Nigeria kicker beat France, credits moved 95 to 105, and NFT stats updated onchain.
        </p>
        <div className="row">
          <span>PenaltyDuel</span>
          <a href={explorerAddress(addresses.penaltyDuel ?? "")} target="_blank" rel="noreferrer">{short(addresses.penaltyDuel ?? "0x0000000000000000000000000000000000000000")}</a>
        </div>
        <div className="row">
          <span>Settlement tx</span>
          <a href={txLink(PROOF_SETTLEMENT_TX)} target="_blank" rel="noreferrer">
            {shortHash(PROOF_SETTLEMENT_TX)}
          </a>
        </div>
      </article>
    </section>
  );
}

function roundsFromDuelState(duel: any, duelId: bigint) {
  const p1Shots = normalizePlan(duel.p1.shots);
  const p1Saves = normalizePlan(duel.p1.saves);
  const p2Shots = normalizePlan(duel.p2.shots);
  const p2Saves = normalizePlan(duel.p2.saves);
  return scoreShootout(
    p1Shots,
    p1Saves,
    p2Shots,
    p2Saves,
    contractTiebreaksToP1({
      duelId,
      p1CommitHash: duel.p1.commitHash,
      p2CommitHash: duel.p2.commitHash,
      p1Shots,
      p2Shots,
      p1Saves,
      p2Saves,
    }),
  );
}

function commitRevealFromDuelState(duel: any): CommitRevealPair {
  return {
    playerOne: {
      commitHash: duel.p1.commitHash,
      revealed: Boolean(duel.p1.revealed),
      shots: Array.from(duel.p1.shots ?? []).map(Number),
      saves: Array.from(duel.p1.saves ?? []).map(Number),
    },
    playerTwo: {
      commitHash: duel.p2.commitHash,
      revealed: Boolean(duel.p2.revealed),
      shots: Array.from(duel.p2.shots ?? []).map(Number),
      saves: Array.from(duel.p2.saves ?? []).map(Number),
    },
  };
}

function PlanGrid({ plan }: { plan?: CommitRevealPlan }) {
  const shots = plan?.shots ?? [];
  const saves = plan?.saves ?? [];
  return (
    <div className="planGrid">
      <span>shots</span>
      {Array.from({ length: 10 }, (_, index) => (
        <strong title={directionName(shots[index])} key={`shot-${index}`}>
          {directionArrow(shots[index])}
        </strong>
      ))}
      <span>saves</span>
      {Array.from({ length: 10 }, (_, index) => (
        <strong title={directionName(saves[index])} key={`save-${index}`}>
          {directionArrow(saves[index])}
        </strong>
      ))}
    </div>
  );
}

function CommitRevealMoment({
  sideOne,
  sideTwo,
  commitReveal,
}: {
  sideOne: string;
  sideTwo: string;
  commitReveal?: CommitRevealPair;
}) {
  if (!commitReveal?.playerOne?.commitHash && !commitReveal?.playerTwo?.commitHash) return null;

  return (
    <article className="commitRevealMoment">
      <div className="commitRevealHeader">
        <span>Protocol moment</span>
        <strong>Hidden hash becomes a shootout plan.</strong>
      </div>
      <div className="commitRevealColumns">
        {[
          { label: sideOne, plan: commitReveal.playerOne },
          { label: sideTwo, plan: commitReveal.playerTwo },
        ].map(({ label, plan }) => (
          <div className="commitRevealCard" key={label}>
            <div className="commitSide">
              <span>{label} commit</span>
              <code>{shortHash(plan?.commitHash)}</code>
            </div>
            <div className="revealArrow">→</div>
            <div className="revealSide">
              <span>{plan?.revealed ? "revealed plan" : "still hidden"}</span>
              <PlanGrid plan={plan} />
            </div>
          </div>
        ))}
      </div>
    </article>
  );
}

function Replay() {
  const [rounds, setRounds] = useState<RoundResult[]>([]);
  const [animatedRound, setAnimatedRound] = useState(0);
  const [status, setStatus] = useState("Loading latest settled duel from X Layer...");
  const [score, setScore] = useState("3-0");
  const [sideOne, setSideOne] = useState("Nigeria");
  const [sideTwo, setSideTwo] = useState("France");
  const [replayDuelId, setReplayDuelId] = useState(String(PROOF_DUEL_ID));
  const [proofHref, setProofHref] = useState(txLink(PROOF_SETTLEMENT_TX));
  const [proofLabel, setProofLabel] = useState("Open proof tx");
  const [commitReveal, setCommitReveal] = useState<CommitRevealPair | undefined>();

  useEffect(() => {
    async function loadReplay() {
      try {
        const proofResponse = await fetch("/api/proof");
        const proofBody = await proofResponse.json();
        if (!proofResponse.ok) throw new Error(proofBody.error ?? "Proof API failed.");
        const latest = (proofBody.recentDuels ?? []).find(
          (duel: any) => duel.statusLabel === "Settled" && duel.p1Country && duel.p2Country,
        );
        if (latest) {
          const duel = (await publicClient.readContract({
            address: addresses.penaltyDuel!,
            abi: penaltyDuelAbi,
            functionName: "getDuel",
            args: [BigInt(latest.duelId)],
          })) as any;
          const replay = roundsFromDuelState(duel, BigInt(latest.duelId));
          setCommitReveal(commitRevealFromDuelState(duel));
          setRounds(replay.rounds);
          setScore(replay.score);
          setSideOne(latest.p1Country);
          setSideTwo(latest.p2Country);
          setReplayDuelId(latest.duelId);
          setProofHref(latest.settlementTx?.explorer ?? "/api/proof");
          setProofLabel(latest.settlementTx?.explorer ? "Open settlement tx" : "Open proof API");
          setStatus(
            latest.settlementTx?.explorer
              ? `Latest settled duel #${latest.duelId} loaded from X Layer state at block ${proofBody.chain?.latestBlock ?? "unknown"}.`
              : `Latest settled duel #${latest.duelId} loaded from X Layer state. Settlement log unavailable from RPC; proof API shows the indexed state.`,
          );
          return;
        }

        const receipt = await publicClient.getTransactionReceipt({ hash: PROOF_SETTLEMENT_TX });
        const proofRounds: RoundResult[] = [];
        for (const log of receipt.logs) {
          if (log.address.toLowerCase() !== addresses.penaltyDuel?.toLowerCase()) continue;
          try {
            const decoded = decodeEventLog({ abi: penaltyDuelAbi, data: log.data, topics: [...log.topics] as any });
            const args = decoded.args as any;
            if (decoded.eventName === "RoundResolved") {
              proofRounds.push({
                round: Number(args.round),
                youGoal: Boolean(args.p1Goal),
                botGoal: Boolean(args.p2Goal),
                p1Shot: Number(args.p1Shot),
                p2Shot: Number(args.p2Shot),
                p1Save: Number(args.p1Save),
                p2Save: Number(args.p2Save),
              });
            }
            if (decoded.eventName === "DuelSettled") {
              setScore(`${Number(args.p1Score)}-${Number(args.p2Score)}`);
            }
          } catch {
            // Ignore non-Panenka logs.
          }
        }
        setRounds(proofRounds.sort((a, b) => a.round - b.round));
        setStatus(`Replay loaded from settlement tx ${short(PROOF_SETTLEMENT_TX)}.`);
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Could not load proof duel.");
      }
    }
    void loadReplay();
  }, []);

  useEffect(() => {
    if (!rounds.length) {
      setAnimatedRound(0);
      return;
    }
    setAnimatedRound(1);
    const timers = rounds.slice(1).map((_, index) => window.setTimeout(() => setAnimatedRound(index + 2), (index + 1) * 800));
    return () => timers.forEach(window.clearTimeout);
  }, [rounds]);

  const currentRound = rounds[Math.max(animatedRound - 1, 0)];

  return (
    <section className="page replayPage">
      <p className="eyebrow">Replay proof</p>
      <h2>Watch a settled duel straight from X Layer.</h2>
      <p className="lede compact">
        This page does not need a wallet. It loads the latest settled duel from live contract state, reconstructs the
        resolved kicks, and falls back to the original proof transaction if the live feed is unavailable.
      </p>

      <div className="statusPanel">
        <span>X Layer {XLAYER_CHAIN_ID}</span>
        <span>Duel #{replayDuelId}</span>
        <strong>{status}</strong>
        <a href={proofHref} target="_blank" rel="noreferrer">{proofLabel}</a>
      </div>

      <article className="replayArena">
        <div className="replayScore">
          <span>{sideOne}</span>
          <strong>{score}</strong>
          <span>{sideTwo}</span>
        </div>
        <CommitRevealMoment sideOne={sideOne} sideTwo={sideTwo} commitReveal={commitReveal} />
        <div className="revealStage replayStageLarge">
          <ShootoutVisualizer round={currentRound} />
          <div>
            <span>Round {animatedRound || 1} of {rounds.length || 1}</span>
            <strong>{currentRound?.youGoal ? `${sideOne} scores` : `${sideTwo} keeper saves`}</strong>
            <p>
              Shot {currentRound?.p1Shot ?? "-"} vs save {currentRound?.p2Save ?? "-"} · {sideTwo} shot{" "}
              {currentRound?.p2Shot ?? "-"} vs {sideOne} save {currentRound?.p1Save ?? "-"}
            </p>
          </div>
        </div>
        <div className="roundStrip">
          {rounds.map((round) => (
            <div className="roundChip" key={round.round}>
              <span>Round {round.round}</span>
              <strong>{round.youGoal ? `${sideOne} goal` : `${sideTwo} save`} · {round.botGoal ? `${sideTwo} goal` : `${sideOne} save`}</strong>
            </div>
          ))}
        </div>
        <div className="ctaRow">
          <a className="primary" href="#play">Play your own duel</a>
          <a className="secondary" href={shareResultUrl(`Panenka duel #${replayDuelId}: ${sideOne} ${score} ${sideTwo} on X Layer`)} target="_blank" rel="noreferrer">
            Share proof result
          </a>
        </div>
      </article>
    </section>
  );
}

function Leaderboard() {
  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [countryRows, setCountryRows] = useState<CountryLeaderboardRow[]>([]);
  const [status, setStatus] = useState("Loading live X Layer leaderboard...");
  const [latestBlock, setLatestBlock] = useState("");

  useEffect(() => {
    async function load() {
      try {
        const response = await fetch("/api/leaderboard");
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "Leaderboard failed.");
        setRows(body.rows ?? []);
        setCountryRows(body.countryRows ?? []);
        setLatestBlock(body.latestBlock ?? "");
        setStatus(body.rows?.length ? `Ranked from ${body.source}.` : "No ranked kickers found yet.");
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Could not load leaderboard.");
      }
    }
    void load();
  }, []);

  return (
    <section className="page">
      <p className="eyebrow">Onchain form table</p>
      <h2>Country kickers ranked by wins and streak.</h2>
      <div className="statusPanel">
        <span>Live from X Layer</span>
        {latestBlock ? <span>latest block {latestBlock}</span> : null}
        <strong>{status}</strong>
      </div>
      <div className="table countryTable">
        <div className="tableTitle">
          <span>Country rivalry</span>
          <strong>{countryRows.length} countries onchain</strong>
        </div>
        {countryRows.map((row, index) => (
          <div className="rank countryRank" key={row.country}>
            <span>#{index + 1}</span>
            <strong>{row.country}</strong>
            <span>{row.kickers} kickers</span>
            <span>{row.wins} wins</span>
            <span>{row.losses} losses</span>
            <span>{row.streak} best streak</span>
            <span>best #{row.bestTokenId}</span>
            <a className="sharePill" href={shareCountryUrl(row, index + 1)} target="_blank" rel="noreferrer">
              Challenge on X
            </a>
          </div>
        ))}
        {!countryRows.length ? <p className="muted">Country totals appear after the first settled duel.</p> : null}
      </div>
      <div className="table">
        <div className="tableTitle">
          <span>Kicker table</span>
          <strong>{rows.length} ranked kickers</strong>
        </div>
        {rows.map((row, index) => (
          <div className="rank" key={row.tokenId}>
            <span>#{index + 1}</span>
            <strong>{row.country} #{row.tokenId}</strong>
            <span>{short(row.player)}</span>
            <span>{row.wins} wins</span>
            <span>{row.losses} losses</span>
            <span>{row.streak} streak</span>
            <span>level {row.level}</span>
          </div>
        ))}
        {!rows.length ? <p className="muted">Play and settle a duel, then refresh this page.</p> : null}
      </div>
    </section>
  );
}

function Me({
  account,
  provider,
  connect,
}: {
  account: `0x${string}` | "";
  provider: WalletProvider | null;
  connect: () => Promise<void>;
}) {
  const [tokenId, setTokenId] = useState<bigint>(0n);
  const [stats, setStats] = useState<readonly [number, number, number, number, number] | null>(null);
  const [balance, setBalance] = useState<bigint>(0n);

  useEffect(() => {
    if (!account || !provider || !hasContracts) return;
    async function load() {
      const ownerToken = (await publicClient.readContract({
        address: addresses.kickerNft!,
        abi: kickerNftAbi,
        functionName: "tokenOfOwner",
        args: [account as `0x${string}`],
      })) as bigint;
      setTokenId(ownerToken);
      setBalance(
        (await publicClient.readContract({
          address: addresses.duelCredit!,
          abi: duelCreditAbi,
          functionName: "balanceOf",
          args: [account as `0x${string}`],
        })) as bigint,
      );
      if (ownerToken > 0n) {
        setStats(
          (await publicClient.readContract({
            address: addresses.kickerNft!,
            abi: kickerNftAbi,
            functionName: "statsOf",
            args: [ownerToken],
          })) as readonly [number, number, number, number, number],
        );
      }
    }
    void load();
  }, [account, provider]);

  return (
    <section className="page">
      <p className="eyebrow">Your kicker</p>
      <h2>{account ? short(account) : "Connect to load your duel card."}</h2>
      <div className="panel profile">
        <span className="badge">{stats ? `Level ${stats[4]}` : "Level ?"}</span>
        <h3>
          {tokenId > 0n && stats
            ? `${countryById[Number(stats[0])] ?? `Country ${stats[0]}`} Kicker #${tokenId}`
            : tokenId > 0n
              ? `Kicker #${tokenId}`
              : "No kicker minted yet"}
        </h3>
        <p>
          {account
            ? `${formatUnits(balance, 18)} DCR available. Use it to create bot duels or remote friend duels.`
            : "Connect your wallet to load your country kicker, record, DCR balance, and next action."}
        </p>
        {stats ? (
          <div className="playerCard">
            <div className="recordHero">
              <span>Record</span>
              <strong>{stats[1]} - {stats[2]}</strong>
              <p>{stats[3]} current streak</p>
            </div>
            <div className="statGrid">
              <span>{countryById[Number(stats[0])] ?? `Country ${stats[0]}`}</span>
              <span>{stats[1]} wins</span>
              <span>{stats[2]} losses</span>
              <span>{stats[3]} streak</span>
            </div>
          </div>
        ) : null}
        <div className="actionRow">
          {!account ? <button onClick={connect}>Connect wallet</button> : null}
          {account ? <a className="primary" href="#play">{tokenId > 0n ? "Play again" : "Mint and play"}</a> : null}
          {account ? <a className="secondary" href="#leaderboard">Check leaderboard</a> : null}
        </div>
      </div>
    </section>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
