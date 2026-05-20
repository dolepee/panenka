import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  createPublicClient,
  createWalletClient,
  custom,
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
          <button onClick={connect}>{account ? short(account) : "Connect OKX Wallet"}</button>
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
          <a className="primary" href="#play">Create duel</a>
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
  const canWrite = Boolean(account && provider && hasContracts);

  useEffect(() => {
    void refresh();
  }, [account]);

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

  async function write(action: () => Promise<`0x${string}`>, label: string) {
    if (!canWrite) {
      setStatus(account ? "Deploy contract addresses before writing." : "Connect wallet first.");
      if (!account) await connect();
      return;
    }
    setStatus(`${label}...`);
    const hash = await action();
    setLastTx(hash);
    await publicClient.waitForTransactionReceipt({ hash });
    setStatus(`${label} confirmed.`);
    await refresh();
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
    setStatus(`Duel #${duelId} created. Switch to Wallet B and join this same duel ID.`);
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

  return (
    <section className="page">
      <p className="eyebrow">Play path</p>
      <h2>Use two wallets: one creates, one joins.</h2>
      <p className="lede compact">
        Panenka is a commit-reveal duel. Wallet A hides five shots and saves, Wallet B hides five choices, then both reveal.
        The contract settles the score only after both hidden plans are revealed.
      </p>

      <div className="statusPanel">
        <span>{hasContracts ? `X Layer ${XLAYER_CHAIN_ID}` : "Contracts not configured yet"}</span>
        <span>{account ? short(account) : "Wallet not connected"}</span>
        <span>{nextDuelId ? `Next duel #${nextDuelId}` : "Awaiting deploy"}</span>
        <span>{storedPlanIds.length ? `Local reveal plan: #${storedPlanIds.join(", #")}` : "No local reveal plan yet"}</span>
        <strong>{status}</strong>
        {lastTx ? <a href={txLink(lastTx)} target="_blank" rel="noreferrer">View last tx</a> : null}
      </div>

      <article className="guideCard">
        <div>
          <span className="badge">Solo test instructions</span>
          <h3>What you should click</h3>
        </div>
        <ol className="guideSteps">
          <li><strong>Wallet A:</strong> connect, mint a kicker if needed, claim DCR, approve, then create a hidden duel.</li>
          <li><strong>Wallet B:</strong> switch accounts, mint/claim/approve, paste the duel ID, then join with a hidden plan.</li>
          <li><strong>Reveal:</strong> reveal once from Wallet B, switch back to Wallet A, reveal the same duel ID again.</li>
          <li><strong>Done:</strong> the second reveal settles the duel, transfers DuelCredit, and updates kicker stats.</li>
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
          <h3>3A. Wallet A creates</h3>
          <label>
            Stake
            <input value={stake} onChange={(event) => setStake(event.target.value)} />
          </label>
          <p className="muted">
            Click this from the first wallet. Copy the duel ID from the status line, then switch to the opponent wallet.
            The hidden plan stays in this browser for the later reveal.
          </p>
          <button onClick={createDuel}>Create hidden duel</button>
        </article>

        <article className="panel">
          <h3>3B / 4. Join, then reveal</h3>
          <label>
            Wallet B: duel ID to join
            <input value={joinDuelId} onChange={(event) => setJoinDuelId(event.target.value)} placeholder="17" />
          </label>
          <button onClick={joinDuel}>Join with hidden plan</button>
          <label>
            Current wallet: duel ID to reveal
            <input value={revealDuelId} onChange={(event) => setRevealDuelId(event.target.value)} placeholder="17" />
          </label>
          <button onClick={revealDuel}>Reveal stored plan</button>
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
        {!account ? <button onClick={connect}>Connect OKX Wallet</button> : null}
      </div>
    </section>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
