import React, { useEffect, useMemo, useState } from "react";
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

type DirectionPlan = [number, number, number, number, number];
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
type LeaderboardRow = {
  tokenId: string;
  player: string;
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
  };
  proofDuel?: {
    transactions?: { playerTwoRevealAndSettle?: { explorer: string } };
  };
  recentDuels?: Array<{
    duelId: string;
    statusLabel: string;
    p1Country?: string | null;
    p2Country?: string | null;
    score?: string | null;
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
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const PROOF_DUEL_ID = 1;
const PROOF_SETTLEMENT_TX = "0x8ac7ec41c0e1ca9eb0cee210ca52bf4835758d7081bce53ea2a84f0a2922ad9b";

const publicClient = createPublicClient({ chain: xLayer, transport: http() });

function short(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
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
  return `https://x.com/intent/tweet?text=${encodeURIComponent(`${text}\n\nBuilt on @XLayerOfficial.\nhttps://panenka-alpha.vercel.app`)}`;
}

function shareCountryUrl(row: CountryLeaderboardRow, rank: number) {
  return shareResultUrl(
    `${row.country} is #${rank} on Panenka with ${row.wins} wins, ${row.kickers} country kickers, and a ${row.streak} best streak. Challenge this country in an onchain penalty duel on X Layer.`,
  );
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
  const shots = Array.from({ length: 5 }, (_, index) => (seed + index) % 3) as DirectionPlan;
  const saves = Array.from({ length: 5 }, (_, index) => (seed + index + 1) % 3) as DirectionPlan;
  crypto.getRandomValues(entropy);
  return { duelId: 0, shots, saves, salt: keccak256(toHex(entropy)) };
}

function commitment(player: `0x${string}`, shots: DirectionPlan, saves: DirectionPlan, salt: `0x${string}`) {
  return keccak256(
    encodeAbiParameters(
      [{ type: "address" }, { type: "uint8[5]" }, { type: "uint8[5]" }, { type: "bytes32" }],
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
          <button onClick={connect}>{account ? short(account) : "Connect wallet"}</button>
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
  const heroDuelId = latestSettledDuel?.duelId ?? "1";
  const heroSideOne = latestSettledDuel?.p1Country ?? "Nigeria";
  const heroSideTwo = latestSettledDuel?.p2Country ?? "France";
  const heroScore = latestSettledDuel?.score ?? "3-0";
  const [heroSideOneScore, heroSideTwoScore] = heroScore.split("-");
  const heroShareText = `Panenka duel #${heroDuelId}: ${heroSideOne} ${heroScore} ${heroSideTwo} on X Layer`;
  const testerInvite = [
    "Can you test Panenka for me? It is a World Cup-style penalty shootout game on X Layer testnet.",
    "",
    "Flow: connect wallet -> mint a country kicker -> claim DCR -> approve -> create a 1 DCR duel -> bot joins -> reveal -> bot reveals and settles.",
    "",
    `App: ${location.origin}`,
    "",
    "After settlement, click Copy tester report and send the text plus a screenshot. No betting and no real-money stake.",
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
    <section className="hero">
      <div>
        <p className="eyebrow">World Cup shootouts on X Layer</p>
        <h1>Penalty duels on X Layer.</h1>
        <p className="lede">
          Mint a country kicker, commit hidden shots, and face Panenka Bot in under a minute. Every reveal, round, score,
          credit transfer, and leaderboard move is verifiable on X Layer.
        </p>
        <div className="heroProof">
          <span>{activity?.settledDuels ?? "-"} settled duels</span>
          <span>{activity?.countryCount ?? "-"} countries live</span>
          <span>{activity?.mintedKickers ?? "-"} kickers minted</span>
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
          </div>
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
              <li>Mint a country kicker and claim DuelCredit.</li>
              <li>Create a 1 DCR duel, let Panenka Bot join, reveal, then let the bot settle.</li>
              <li>Copy the tester report and screenshot the result.</li>
            </ol>
            <div className="testerActions">
              <button onClick={copyTesterInvite}>Copy tester invite</button>
              <a href="#play">Start test duel</a>
            </div>
          </div>
          <div className="activityLinks">
            <a href="/api/proof" target="_blank" rel="noreferrer">Proof API</a>
            {duelContract ? <a href={duelContract.explorer} target="_blank" rel="noreferrer">Duel contract</a> : null}
            {latestSettlementTx ? <a href={latestSettlementTx} target="_blank" rel="noreferrer">Latest tx</a> : null}
            {!latestSettlementTx && proofDuelTx ? <a href={proofDuelTx} target="_blank" rel="noreferrer">Baseline proof tx</a> : null}
          </div>
        </article>
        <div className="ctaRow">
          <a className="primary" href="#play">Play the bot</a>
          <a className="secondary" href="#leaderboard">View leaderboard</a>
        </div>
      </div>
      <div className="duelCard">
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
  const [balance, setBalance] = useState<bigint>(0n);
  const [storedPlanIds, setStoredPlanIds] = useState<number[]>([]);
  const [botBusy, setBotBusy] = useState(false);
  const [inviteLink, setInviteLink] = useState("");
  const [duelView, setDuelView] = useState<DuelView | null>(null);
  const [settlementText, setSettlementText] = useState("");
  const [roundResults, setRoundResults] = useState<RoundResult[]>([]);
  const [animatedRound, setAnimatedRound] = useState(0);
  const [actionNotice, setActionNotice] = useState("Create a duel, let the bot join, then reveal from this same browser.");
  const [botHealth, setBotHealth] = useState<BotHealth | null>(null);
  const [botHealthStatus, setBotHealthStatus] = useState("Checking Panenka Bot readiness...");
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
      setTokenId(reads[1] as bigint);
      setBalance(reads[2] as bigint);
      setStoredPlanIds(account ? localPlanIds(account) : []);
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
      setBotHealthStatus(error instanceof Error ? error.message : "Could not check Panenka Bot readiness.");
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
      if (updateStatus) notify(view.nextStep);
    } catch (error) {
      if (updateStatus) notify(error instanceof Error ? error.message : "Could not read duel state.");
    }
  }

  async function write(action: () => Promise<`0x${string}`>, label: string) {
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
      notify(`Kicker #${tokenId} is ready. Continue to Fuel and approve.`);
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
    const stakeAmount = parseUnits(stake || "0", 18);
    if (stakeAmount <= 0n) {
      notify("Duel entry must be greater than 0 DCR.");
      return;
    }
    if (!(await canSpendStake(stakeAmount))) return;
    const duelId = Number(await publicClient.readContract({ address: addresses.penaltyDuel!, abi: penaltyDuelAbi, functionName: "nextDuelId" }));
    const plan = { ...makePlan(account), duelId };
    const hash = commitment(account, plan.shots, plan.saves, plan.salt);
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
    if (!tx) return;
    savePlan(account, plan);
    setStoredPlanIds(localPlanIds(account));
    setRevealDuelId(String(duelId));
    setJoinDuelId(String(duelId));
    const link = playLink(duelId);
    setInviteLink(link);
    try {
      await navigator.clipboard?.writeText(link);
      notify(`Duel #${duelId} created. Invite link copied. Now click Bot joins this duel.`);
    } catch {
      notify(`Duel #${duelId} created. Now click Bot joins this duel.`);
    }
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
        if (decoded.eventName !== "DuelSettled") continue;
        const args = decoded.args as any;
        const p1Score = Number(args.p1Score);
        const p2Score = Number(args.p2Score);
        const winner = args.draw ? "Draw" : short(args.winner);
        setSettlementText(args.draw ? `Duel #${args.duelId} settled as a ${p1Score}-${p2Score} draw.` : `Duel #${args.duelId} settled: ${winner} won ${p1Score}-${p2Score}.`);
      } catch {
        // Ignore non-Panenka logs in the same transaction.
      }
    }
    if (rounds.length) setRoundResults(rounds.sort((a, b) => a.round - b.round));
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

  async function copyTesterReport() {
    if (!settlementText) {
      notify("Settle a duel first, then copy the tester report.");
      return;
    }
    const report = [
      settlementText,
      lastTx ? `Settlement tx: ${txLink(lastTx)}` : null,
      `App: ${location.origin}`,
    ]
      .filter(Boolean)
      .join("\n");
    try {
      await navigator.clipboard?.writeText(report);
      notify("Tester report copied. Send it back with your screenshot.");
    } catch {
      notify("Tester report ready. Copy the settlement text and tx link from this screen.");
    }
  }

  return (
    <section className="page">
      <p className="eyebrow">Play path</p>
      <h2>Play the bot now. Invite a friend later.</h2>
      <p className="lede compact">
        Your wallet creates and reveals. Panenka Bot joins as the opponent, or you send an invite link to a remote friend.
        The contract still settles a real two-player commit-reveal shootout.
      </p>

      <div className="statusPanel">
        <span>{hasContracts ? `X Layer ${XLAYER_CHAIN_ID}` : "Contracts not configured yet"}</span>
        <span>{account ? short(account) : "Wallet not connected"}</span>
        <span>{nextDuelId ? `Next duel #${nextDuelId}` : "Awaiting deploy"}</span>
        <span>{botHealth ? `Bot ${botHealth.ready ? "ready" : "not ready"} · ${Number(botHealth.duelCredit).toLocaleString(undefined, { maximumFractionDigits: 2 })} DCR` : botHealthStatus}</span>
        <span>{storedPlanIds.length ? `Local reveal plan: #${storedPlanIds.join(", #")}` : "No local reveal plan yet"}</span>
        <strong>{status}</strong>
        {lastTx ? <a href={txLink(lastTx)} target="_blank" rel="noreferrer">View last tx</a> : null}
      </div>

      {duelView ? (
        <article className="duelState">
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
        <article className="settlementCard">
          <span>Settled onchain</span>
          <strong>{settlementText}</strong>
          {roundResults.length ? (
            <div className="revealStage">
              <div className="miniGoal">
                <div className={`miniKeeper keeper-${roundResults[Math.max(animatedRound - 1, 0)]?.botGoal ? "wrong" : "save"}`}>GK</div>
                <div className={`miniBall ball-${roundResults[Math.max(animatedRound - 1, 0)]?.youGoal ? "goal" : "save"}`} />
              </div>
              <div>
                <span>Live reveal</span>
                <strong>Round {animatedRound || 1} of 5</strong>
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
          <button onClick={copyTesterReport}>Copy tester report</button>
        </article>
      ) : null}

      <article className="guideCard">
        <div>
          <span className="badge">Remote play ready</span>
          <h3>What you should click</h3>
        </div>
        <ol className="guideSteps">
          <li><strong>Fast path:</strong> mint if needed, claim DCR, approve, create a duel, click Bot joins, reveal, then Bot reveals.</li>
          <li><strong>Friend path:</strong> create a duel, copy the invite link, and send it to a remote friend. They join from their own wallet.</li>
          <li><strong>Important:</strong> the same browser that created or joined must reveal, because the hidden plan is stored locally.</li>
          <li><strong>Proof:</strong> after settlement, the app shows winner, score, five round outcomes, and the X Layer transaction.</li>
        </ol>
      </article>

      <div className="grid">
        <article className="panel">
          <h3>1. Wallet setup</h3>
          <p className="muted">Each wallet needs exactly one country kicker. This is your duel identity and stat card.</p>
          <div className="countryGrid">
            {countries.map((country) => (
              <button className={selectedCountry.id === country.id ? "selected" : ""} key={country.id} onClick={() => setSelectedCountry(country)}>
                {country.name}
              </button>
            ))}
          </div>
          <div className="actionRow">
            <button onClick={account ? mintKicker : connect}>{tokenId > 0n ? `Kicker #${tokenId}` : "Mint kicker"}</button>
          </div>
        </article>

        <article className="panel">
          <h3>2. Fuel and approve</h3>
          <p className="muted">DuelCredit is in-game credit. It cannot move wallet-to-wallet; it routes only through the duel contract.</p>
          <div className="balance">{formatUnits(balance, 18)} DCR</div>
          <div className="actionRow">
            <button onClick={claimFaucet}>Claim 100 DCR</button>
            <button onClick={approveCredits}>Approve duel contract</button>
          </div>
        </article>

        <article className="panel">
          <h3>3. Create a duel</h3>
          <label>
            Duel entry (DCR)
            <input value={stake} onChange={(event) => setStake(event.target.value)} />
          </label>
          <p className="muted">
            Your wallet commits a hidden five-round plan. The chain sees only the hash until you reveal.
          </p>
          <button onClick={createDuel}>Create hidden duel</button>
          <div className="inviteBox">
            <span>Invite link</span>
            <code>{inviteLink || "Create a duel first, then send the generated link to your friend."}</code>
            <button onClick={copyInvite}>Copy invite link</button>
          </div>
        </article>

        <article className="panel">
          <h3>4. Finish with bot or human</h3>
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
            <button onClick={() => callBot("join")} disabled={botBusy || (duelView?.id === Number(joinDuelId) && duelView.p1.toLowerCase() === ZERO_ADDRESS)}>
              {botBusy ? "Bot working..." : "Bot joins this duel"}
            </button>
            <button onClick={joinDuel}>Human wallet joins</button>
          </div>
          <label>
            Reveal duel ID
            <input value={revealDuelId} onChange={(event) => setRevealDuelId(event.target.value)} placeholder="17" />
          </label>
          <p className="actionNotice">{actionNotice}</p>
          <div className="actionRow">
            <button onClick={revealDuel}>Reveal my plan</button>
            <button onClick={() => callBot("reveal")} disabled={botBusy}>{botBusy ? "Bot working..." : "Bot reveals and settles"}</button>
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
          <a href={txLink("0x8ac7ec41c0e1ca9eb0cee210ca52bf4835758d7081bce53ea2a84f0a2922ad9b")} target="_blank" rel="noreferrer">
            0x8ac7...ad9b
          </a>
        </div>
      </article>
    </section>
  );
}

function roundsFromDuelState(duel: any) {
  const rounds: RoundResult[] = [];
  let p1Score = 0;
  let p2Score = 0;
  for (let index = 0; index < 5; index++) {
    const p1Shot = Number(duel.p1.shots[index]);
    const p1Save = Number(duel.p1.saves[index]);
    const p2Shot = Number(duel.p2.shots[index]);
    const p2Save = Number(duel.p2.saves[index]);
    const p1Goal = p1Shot !== p2Save;
    const p2Goal = p2Shot !== p1Save;
    if (p1Goal) p1Score += 1;
    if (p2Goal) p2Score += 1;
    rounds.push({
      round: index + 1,
      youGoal: p1Goal,
      botGoal: p2Goal,
      p1Shot,
      p2Shot,
      p1Save,
      p2Save,
    });
  }
  return { rounds, score: `${p1Score}-${p2Score}` };
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
          const replay = roundsFromDuelState(duel);
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
        This page does not need a wallet. It loads the latest settled duel from live contract state, reconstructs the five
        kicks, and falls back to the original proof transaction if the live feed is unavailable.
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
        <div className="revealStage replayStageLarge">
          <div className="miniGoal">
            <div className={`miniKeeper keeper-${currentRound?.botGoal ? "wrong" : "save"}`}>GK</div>
            <div className={`miniBall ball-${currentRound?.youGoal ? "goal" : "save"}`} />
          </div>
          <div>
            <span>Round {animatedRound || 1} of 5</span>
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
