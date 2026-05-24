type ProofResponse = {
  app?: string;
  chain?: { chainId?: number; latestBlock?: string };
  contracts?: Record<string, { address?: string; hasBytecode?: boolean; explorer?: string }>;
  onchainActivity?: {
    mintedKickers?: number;
    duelsCreated?: number;
    settledDuels?: number;
    countryCount?: number;
    activeWallets?: number;
    manualWallets?: number;
    exhibitionWallets?: number;
  };
  wallets?: { total?: number; manual?: number; exhibition?: number };
  recentDuels?: Array<{
    duelId?: string;
    statusLabel?: string;
    p1Country?: string | null;
    p2Country?: string | null;
    score?: string | null;
    settlementTx?: { hash?: string; explorer?: string } | null;
    settlementTxStatus?: string;
    commitReveal?: {
      playerOne?: { commitHash?: string; revealed?: boolean; shots?: number[]; saves?: number[] };
      playerTwo?: { commitHash?: string; revealed?: boolean; shots?: number[]; saves?: number[] };
    };
  }>;
  verifier?: { successMarker?: string };
};

type LeaderboardResponse = {
  source?: string;
  countryRows?: Array<{ country?: string; wins?: number; kickers?: number }>;
  rows?: Array<{ tokenId?: string; country?: string; wins?: number; level?: number }>;
};

type BotResponse = {
  ready?: boolean;
  okb?: string;
  duelCredit?: string;
  publicStakeCap?: string;
  allowanceCoversPublicStake?: boolean;
  hasKicker?: boolean;
  tokenId?: string;
};

const appUrl = process.env.PANENKA_APP_URL ?? "https://panenka-alpha.vercel.app";

function assertOk(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(new URL(path, appUrl));
  assertOk(response.ok, `${path} returned ${response.status}`);
  return (await response.json()) as T;
}

async function main() {
  const [proof, leaderboard, bot] = await Promise.all([
    getJson<ProofResponse>("/api/proof"),
    getJson<LeaderboardResponse>("/api/leaderboard"),
    getJson<BotResponse>("/api/bot-opponent"),
  ]);

  assertOk(proof.chain?.chainId === 1952, `expected X Layer testnet 1952, got ${proof.chain?.chainId}`);
  assertOk(Number(proof.chain?.latestBlock ?? 0) > 0, "proof endpoint has no latest block");
  assertOk(proof.verifier?.successMarker === "PANENKA_DUEL_VALID", "proof verifier marker mismatch");

  for (const name of ["DuelCredit", "KickerNFT", "PenaltyDuel"]) {
    const contract = proof.contracts?.[name];
    assertOk(contract?.address?.startsWith("0x"), `${name} address missing`);
    if (name === "PenaltyDuel") assertOk(contract.hasBytecode, "PenaltyDuel bytecode missing");
  }

  const activity = proof.onchainActivity;
  assertOk((activity?.mintedKickers ?? 0) >= 20, `too few kickers minted: ${activity?.mintedKickers ?? 0}`);
  assertOk((activity?.duelsCreated ?? 0) >= 31, `too few duels created: ${activity?.duelsCreated ?? 0}`);
  assertOk((activity?.settledDuels ?? 0) >= 30, `too few settled duels: ${activity?.settledDuels ?? 0}`);
  assertOk((activity?.countryCount ?? 0) >= 8, `too few countries represented: ${activity?.countryCount ?? 0}`);
  assertOk((activity?.activeWallets ?? 0) >= 20, `too few active wallets: ${activity?.activeWallets ?? 0}`);
  assertOk((proof.wallets?.manual ?? 0) >= 6, `too few manual/tester wallets: ${proof.wallets?.manual ?? 0}`);
  assertOk((proof.wallets?.exhibition ?? 0) >= 14, `too few exhibition wallets: ${proof.wallets?.exhibition ?? 0}`);

  const latestSettled = proof.recentDuels?.find((duel) => duel.statusLabel === "Settled" && duel.p1Country && duel.p2Country);
  assertOk(latestSettled, "no recent settled duel with country names");
  assertOk(latestSettled?.score?.includes("-"), `latest duel score missing: ${latestSettled?.score ?? "none"}`);
  assertOk(latestSettled?.settlementTxStatus === "available", "latest duel settlement tx is unavailable");
  assertOk(latestSettled?.settlementTx?.hash?.startsWith("0x"), "latest duel settlement hash missing");
  assertOk(latestSettled?.commitReveal?.playerOne?.commitHash?.startsWith("0x"), "latest duel player one commit hash missing");
  assertOk(latestSettled?.commitReveal?.playerTwo?.commitHash?.startsWith("0x"), "latest duel player two commit hash missing");
  assertOk(latestSettled?.commitReveal?.playerOne?.revealed, "latest duel player one reveal missing");
  assertOk(latestSettled?.commitReveal?.playerTwo?.revealed, "latest duel player two reveal missing");

  assertOk(leaderboard.source === "KickerNFT ownerOf/statsOf", `unexpected leaderboard source: ${leaderboard.source ?? "none"}`);
  assertOk((leaderboard.countryRows?.length ?? 0) >= 8, `country leaderboard incomplete: ${leaderboard.countryRows?.length ?? 0}`);
  assertOk((leaderboard.rows?.length ?? 0) >= 8, `kicker leaderboard incomplete: ${leaderboard.rows?.length ?? 0}`);

  assertOk(bot.ready, "Panenka Bot is not ready");
  assertOk(bot.allowanceCoversPublicStake, "Panenka Bot allowance does not cover public stake");
  assertOk(bot.hasKicker, "Panenka Bot has no kicker");
  assertOk(Number(bot.duelCredit ?? 0) >= Number(bot.publicStakeCap ?? 1), "Panenka Bot DCR is below public stake cap");
  assertOk(Number(bot.okb ?? 0) > 0, "Panenka Bot has no OKB gas");

  console.log("PANENKA_LIVE_READY");
  console.log(`app: ${appUrl}`);
  console.log(`chain: ${proof.chain.chainId}, block: ${proof.chain.latestBlock}`);
  console.log(
    `activity: ${activity?.mintedKickers} kickers, ${activity?.duelsCreated} duels created, ${activity?.settledDuels} settled, ${activity?.countryCount} countries`,
  );
  console.log(
    `wallets: ${proof.wallets?.total ?? activity?.activeWallets} active (${proof.wallets?.exhibition ?? 0} exhibition + ${proof.wallets?.manual ?? 0} manual/tester)`,
  );
  console.log("commit reveal: latest settled duel exposes both hidden commits and revealed five-round plans");
  console.log(
    `latest: #${latestSettled?.duelId} ${latestSettled?.p1Country} ${latestSettled?.score} ${latestSettled?.p2Country}`,
  );
  console.log(`latest tx: ${latestSettled?.settlementTx?.hash}`);
  console.log(`leaderboard: ${leaderboard.countryRows?.length} countries, ${leaderboard.rows?.length} kickers`);
  console.log(`bot: ready, cap ${bot.publicStakeCap} DCR, fuel ${bot.duelCredit} DCR, gas ${bot.okb} OKB`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
