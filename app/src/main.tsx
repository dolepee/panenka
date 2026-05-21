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

function planKey(account: string, duelId: number) {
  return `panenka-plan:${account.toLowerCase()}:${duelId}`;
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
  const prefix = `panenka-plan:${account.toLowerCase()}:`;
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
    setProvider(wallet);
    setAccount(accounts[0] ?? "");
    try {
      await wallet.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: `0x${XLAYER_CHAIN_ID.toString(16)}` }],
      });
    } catch {
      await wallet.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: `0x${XLAYER_CHAIN_ID.toString(16)}`,
            chainName: xLayer.name,
            nativeCurrency: xLayer.nativeCurrency,
            rpcUrls: xLayer.rpcUrls.default.http,
            blockExplorerUrls: [XLAYER_EXPLORER],
          },
        ],
      });
    }
  }

  return (
    <main>
      <nav className="nav">
        <a className="brand" href="#home">
          <span>PK</span> Panenka
        </a>
        <div className="links">
          <a href="#play">Play</a>
          <a href="#leaderboard">Leaderboard</a>
          <a href="#me">Me</a>
          <button onClick={connect}>{account ? short(account) : "Connect wallet"}</button>
        </div>
      </nav>

      {page === "play" ? (
        <Play account={account} provider={provider} connect={connect} />
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
  return (
    <section className="hero">
      <div>
        <p className="eyebrow">World Cup duels on X Layer</p>
        <h1>Commit the shot. Reveal the moment.</h1>
        <p className="lede">
          Panenka turns penalty shootouts into onchain duels. Pick a country kicker, hide your five shots and saves, reveal, and let the contract settle the scoreboard.
        </p>
        <div className="ctaRow">
        <a className="primary" href="#play">Play the bot</a>
          <a className="secondary" href="#leaderboard">View leaderboard</a>
        </div>
      </div>
      <div className="duelCard">
        <div className="duelTop">
          <span>Round 5</span>
          <span>X Layer tx pending</span>
        </div>
        <div className="pitch">
          <div className="goal" />
          <div className="ball" />
          <div className="keeper">GK</div>
        </div>
        <div className="score">
          <span>Nigeria 3</span>
          <strong>2</strong>
          <span>France</span>
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
  const [stake, setStake] = useState("5");
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
  const canWrite = Boolean(account && provider && hasContracts);

  useEffect(() => {
    const invitedDuelId = new URLSearchParams(location.search).get("duel");
    if (invitedDuelId) {
      setJoinDuelId(invitedDuelId);
      setRevealDuelId(invitedDuelId);
      setInviteLink(playLink(invitedDuelId));
    }
    void refresh();
  }, [account]);

  useEffect(() => {
    const duelId = revealDuelId || joinDuelId;
    if (duelId) void inspectDuel(duelId, false);
  }, [revealDuelId, joinDuelId, account]);

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
      setStatus(error instanceof Error ? error.message : "Read failed.");
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
        statusLabel: duelStatusLabel(Number(duel.status)),
        stake: formatUnits(duel.stake, 18),
        p1: duel.p1.player,
        p2: duel.p2.player,
        p1Revealed: Boolean(duel.p1.revealed),
        p2Revealed: Boolean(duel.p2.revealed),
        nextStep: "",
      };
      view.nextStep = duelNextStep(view, account);
      setDuelView(view);
      if (updateStatus) setStatus(view.nextStep);
    } catch (error) {
      if (updateStatus) setStatus(error instanceof Error ? error.message : "Could not read duel state.");
    }
  }

  async function write(action: () => Promise<`0x${string}`>, label: string) {
    if (!canWrite) {
      setStatus(account ? "Deploy contract addresses before writing." : "Connect wallet first.");
      if (!account) await connect();
      return;
    }
    setStatus(`${label}...`);
    const hash = await action();
    setLastTx(hash);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    readSettlementFromReceipt(receipt);
    setStatus(`${label} confirmed.`);
    await refresh();
    await inspectDuel(undefined, false);
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

  async function createDuel() {
    if (!account) return;
    const duelId = Number(await publicClient.readContract({ address: addresses.penaltyDuel!, abi: penaltyDuelAbi, functionName: "nextDuelId" }));
    const plan = { ...makePlan(account), duelId };
    const hash = commitment(account, plan.shots, plan.saves, plan.salt);
    await write(
      () =>
        walletClient().writeContract({
          address: addresses.penaltyDuel!,
          abi: penaltyDuelAbi,
          functionName: "createDuel",
          args: [parseUnits(stake, 18), tokenId, hash],
        }),
      `Creating duel #${duelId}`,
    );
    savePlan(account, plan);
    setStoredPlanIds(localPlanIds(account));
    setRevealDuelId(String(duelId));
    setJoinDuelId(String(duelId));
    const link = playLink(duelId);
    setInviteLink(link);
    try {
      await navigator.clipboard?.writeText(link);
      setStatus(`Duel #${duelId} created. Invite link copied. Send it to your friend.`);
    } catch {
      setStatus(`Duel #${duelId} created. Copy the invite link and send it to your friend.`);
    }
  }

  async function joinDuel() {
    if (!account || !joinDuelId) return;
    const duelId = Number(joinDuelId);
    const plan = { ...makePlan(account), duelId };
    const hash = commitment(account, plan.shots, plan.saves, plan.salt);
    await write(
      () =>
        walletClient().writeContract({
          address: addresses.penaltyDuel!,
          abi: penaltyDuelAbi,
          functionName: "joinDuel",
          args: [BigInt(duelId), tokenId, hash],
        }),
      `Joining duel #${duelId}`,
    );
    savePlan(account, plan);
    setStoredPlanIds(localPlanIds(account));
    setRevealDuelId(String(duelId));
    setStatus(`Duel #${duelId} joined. Reveal with this wallet, then switch back so the creator can reveal.`);
  }

  async function revealDuel() {
    if (!account || !revealDuelId) return;
    const plan = loadPlan(account, Number(revealDuelId));
    if (!plan) {
      setStatus("No local hidden plan found for this wallet. Reveal must be done from the same wallet/browser that created or joined the duel.");
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
    setStatus(`Reveal for duel #${revealDuelId} confirmed. If both wallets revealed, the duel settled onchain.`);
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
      setStatus("Enter a duel ID first.");
      return;
    }
    setBotBusy(true);
    setStatus(`Panenka Bot ${action === "join" ? "joining" : "revealing"} duel #${duelId}...`);
    try {
      const result = await fetch("/api/bot-opponent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, duelId }),
      });
      const body = await result.json();
      if (!result.ok) throw new Error(body.error ?? "Bot request failed.");
      setLastTx(body.hash);
      const receipt = await publicClient.getTransactionReceipt({ hash: body.hash });
      readSettlementFromReceipt(receipt);
      setStatus(
        action === "join"
          ? `Panenka Bot joined duel #${duelId}. Reveal from your wallet next.`
          : `Panenka Bot revealed duel #${duelId}. If you already revealed, the duel is settled.`,
      );
      await refresh();
      await inspectDuel(String(duelId), true);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Bot request failed.");
    } finally {
      setBotBusy(false);
    }
  }

  async function copyInvite() {
    const duelId = joinDuelId || revealDuelId;
    if (!duelId) {
      setStatus("Create a duel or enter a duel ID first.");
      return;
    }
    const link = playLink(duelId);
    setInviteLink(link);
    try {
      await navigator.clipboard?.writeText(link);
      setStatus(`Invite link for duel #${duelId} copied.`);
    } catch {
      setStatus(`Invite link ready for duel #${duelId}.`);
    }
  }

  return (
    <section className="page">
      <p className="eyebrow">Play path</p>
      <h2>One wallet can test against Panenka Bot.</h2>
      <p className="lede compact">
        Panenka is still a two-player commit-reveal game by design. For easier testing, your wallet creates and reveals while
        Panenka Bot acts as the opponent wallet. Real PvP with a second human wallet still works.
      </p>

      <div className="statusPanel">
        <span>{hasContracts ? `X Layer ${XLAYER_CHAIN_ID}` : "Contracts not configured yet"}</span>
        <span>{account ? short(account) : "Wallet not connected"}</span>
        <span>{nextDuelId ? `Next duel #${nextDuelId}` : "Awaiting deploy"}</span>
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
        </article>
      ) : null}

      <article className="guideCard">
        <div>
          <span className="badge">Remote play ready</span>
          <h3>What you should click</h3>
        </div>
        <ol className="guideSteps">
          <li><strong>You:</strong> connect any injected EVM wallet, mint a kicker, claim DCR, approve, then create a hidden duel.</li>
          <li><strong>Friend:</strong> send the invite link. They open it, connect, mint/claim/approve, then click Human wallet joins.</li>
          <li><strong>Bot option:</strong> if no friend is ready, click Bot joins this duel to test immediately.</li>
          <li><strong>You:</strong> reveal your stored plan from the same browser and wallet that created the duel.</li>
          <li><strong>Opponent:</strong> your friend reveals from their browser, or you click Bot reveals and settles.</li>
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
            Stake
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
          <div className="actionRow">
            <button onClick={() => callBot("join")} disabled={botBusy}>{botBusy ? "Bot working..." : "Bot joins this duel"}</button>
            <button onClick={joinDuel}>Human wallet joins</button>
          </div>
          <label>
            Reveal duel ID
            <input value={revealDuelId} onChange={(event) => setRevealDuelId(event.target.value)} placeholder="17" />
          </label>
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
          <a href={txLink("0x753d66f00fff9d28969de5c2f194c480b53c498168b1bba02084ecc66dbe9f98")} target="_blank" rel="noreferrer">
            0x753d...9f98
          </a>
        </div>
      </article>
    </section>
  );
}

function Leaderboard() {
  const rows = [
    ["Nigeria", "qdee", 7, 5],
    ["Japan", "kaito", 5, 3],
    ["Brazil", "lucas", 4, 2],
    ["France", "amelie", 4, 1],
  ] as const;
  return (
    <section className="page">
      <p className="eyebrow">Onchain form table</p>
      <h2>Country kickers ranked by wins and streak.</h2>
      <div className="table">
        {rows.map(([country, handle, wins, streak], index) => (
          <div className="rank" key={country}>
            <span>#{index + 1}</span>
            <strong>{country}</strong>
            <span>@{handle}</span>
            <span>{wins} wins</span>
            <span>{streak} streak</span>
          </div>
        ))}
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
        <h3>{tokenId > 0n ? `Kicker #${tokenId}` : "No kicker minted yet"}</h3>
        <p>{formatUnits(balance, 18)} DCR available. Credits are in-game and route only through the duel contract.</p>
        {stats ? (
          <div className="statGrid">
            <span>Country #{stats[0]}</span>
            <span>{stats[1]} wins</span>
            <span>{stats[2]} losses</span>
            <span>{stats[3]} streak</span>
          </div>
        ) : null}
        {!account ? <button onClick={connect}>Connect wallet</button> : null}
      </div>
    </section>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
