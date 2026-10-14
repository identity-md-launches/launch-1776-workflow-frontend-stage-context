import { useConnection } from "wagmi";
import { useQueryClient } from "@tanstack/react-query";
import { zeroAddress, formatUnits } from "viem";
import {
  useArena,
  useNow,
  useReadClient,
  useRuntime,
  useTransactions,
  useVerification,
} from "./data";
import { AddressView, WalletControl } from "./Wallet";
import { Icon, Status } from "./components";
import { Trade } from "./Trade";
import { History } from "./History";
import { Operations } from "./Operations";
import { explainError, formatAmount, timeLeft } from "./protocol";

export default function App() {
  const runtime = useRuntime();
  const query = useQueryClient();
  const { address, chainId } = useConnection();
  const client = useReadClient();
  const verification = useVerification(client);
  const verified = !!verification.data && !verification.isError;
  const arena = useArena(client, verified);
  const s = arena.data;
  const now = useNow();
  const stale =
    !!s && (now - s.receivedAt > 30_000 || now / 1000 - s.timestamp > 120);
  const ready = verified && !!s && !arena.isError && !stale;
  const tx = useTransactions(
    client,
    ready && !!address && chainId === runtime.chain.id,
  );
  const duration = verification.data?.duration ?? 600;
  const chainTime = s
    ? s.timestamp + Math.max(0, now - s.receivedAt) / 1000
    : 0;
  const waiting = s?.currentLeader === zeroAddress;
  const remaining = s
    ? waiting
      ? duration
      : timeLeft(s.roundEndTime, s.currentLeader, chainTime)
    : undefined;
  const timer =
    remaining === undefined || !ready
      ? "--:--"
      : `${Math.floor(remaining / 60)
          .toString()
          .padStart(2, "0")}:${(remaining % 60).toString().padStart(2, "0")}`;
  const urgent =
    ready && !waiting && remaining !== undefined && remaining <= 60;
  const error = verification.error || arena.error;
  const status = !verified
    ? verification.isError
      ? "Connection unavailable"
      : "Verifying deployment"
    : stale || arena.isError
      ? "Data is stale"
      : !s
        ? "Reading arena"
        : "Live on-chain";
  const retry = () => {
    void query.invalidateQueries();
  };
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to arena
      </a>
      <header className="site-header">
        <div className="header-inner">
          <a className="brand" href="#main" aria-label="REKTD arena home">
            <img src="./favicon.svg" width="32" height="32" alt="" />
            <span>
              REKTD<span className="brand-dot">.</span>
            </span>
          </a>
          <nav aria-label="Main navigation">
            <a className="active" href="#main">
              Arena
            </a>
            <a href="#history">History</a>
            <a href="#rules">How it works</a>
          </nav>
          <div className="header-utilities">
            <span className="network-label">
              <span className="network-mark" />
              {runtime.chain.name}
            </span>
            <WalletControl />
          </div>
        </div>
      </header>
      <main id="main" className="shell">
        <div className="intro">
          <div>
            <h1>
              The last buy wins<span className="brand-dot">.</span>
            </h1>
            <p>Trade REKTD in the ten-minute jackpot arena.</p>
          </div>
          <Status good={ready}>{status}</Status>
        </div>
        <div className="arena-grid">
          <section
            className={`panel round-panel ${urgent ? "urgent" : ""}`}
            aria-labelledby="round-heading"
          >
            <div className="section-head">
              <h2 id="round-heading">Jackpot arena</h2>
              <span className="round-tag">
                {s
                  ? `Round ${s.roundId.toString().padStart(3, "0")}`
                  : "Awaiting chain"}
              </span>
            </div>
            <div className="clock-face">
              <p className="clock-state">
                {!ready
                  ? "Waiting for verified data"
                  : waiting
                    ? "First ticket starts the clock"
                    : s?.roundExpired
                      ? "Round ended · ready to settle"
                      : remaining === 0
                        ? "Awaiting the next block"
                        : "Time left to take the lead"}
              </p>
              <div
                className="countdown"
                role="timer"
                aria-label={
                  ready
                    ? `${timer} remaining${waiting ? ", round not started" : ""}`
                    : "Countdown unavailable"
                }
              >
                {timer}
              </div>
              <div
                className="urgency-track"
                role="progressbar"
                aria-label="Round time remaining"
                aria-valuemin={0}
                aria-valuemax={duration}
                aria-valuenow={ready ? remaining : undefined}
              >
                <div
                  style={{
                    width:
                      ready && remaining !== undefined
                        ? `${Math.min(100, (remaining / duration) * 100)}%`
                        : "0%",
                  }}
                />
              </div>
            </div>
            <div className="jackpot-line">
              <div>
                <span className="muted">Current jackpot</span>
                <p
                  className="jackpot-value"
                  title={s ? formatUnits(s.jackpotPool, 18) : ""}
                >
                  {formatAmount(s?.jackpotPool)} <span>ETH</span>
                </p>
              </div>
              <span className="jackpot-symbol" aria-hidden="true">
                <Icon name="crown" />
              </span>
            </div>
            <div className="split-grid">
              <div>
                <span className="split-label">
                  <i className="split-dot winner" />
                  Winner <span>60%</span>
                </span>
                <strong>
                  {formatAmount(s?.jackpotSplit[0])} <span>ETH</span>
                </strong>
              </div>
              <div>
                <span className="split-label">
                  <i className="split-dot rollover" />
                  Rollover <span>20%</span>
                </span>
                <strong>
                  {formatAmount(s?.jackpotSplit[2])} <span>ETH</span>
                </strong>
              </div>
              <div>
                <span className="split-label">
                  <i className="split-dot burn" />
                  Burn <span>20%</span>
                </span>
                <strong>
                  {formatAmount(s?.jackpotSplit[1])} <span>ETH</span>
                </strong>
              </div>
            </div>
          </section>
          <Trade client={client} snapshot={s} ready={ready} tx={tx} now={now} />
          <section
            className="panel leader-panel"
            aria-labelledby="leader-heading"
          >
            <div className="leader-icon">
              <Icon name="crown" />
            </div>
            <div className="leader-info">
              <h2 id="leader-heading">King of the hill</h2>
              {s && !waiting ? (
                <AddressView address={s.currentLeader} />
              ) : (
                <p className="muted">
                  {ready ? "The throne is open." : "Leader unavailable"}
                </p>
              )}
              <p className="small muted">
                {s?.currentLeader.toLowerCase() === address?.toLowerCase()
                  ? "You hold the lead. Another qualifying buy can take it."
                  : "The last qualifying buyer wins 60% of the jackpot."}
              </p>
            </div>
            <div className="ticket-mini">
              <span className="small muted">Minimum ticket</span>
              <strong>
                {formatAmount(s?.minimumTicket)} <span>ETH</span>
              </strong>
              <span className="small muted">5% of jackpot · 0.0005 floor</span>
            </div>
            <div className="split-grid leader-split">
              <div>
                <span className="split-label">
                  <i className="split-dot winner" />
                  Winner <span>60%</span>
                </span>
                <strong>
                  {formatAmount(s?.jackpotSplit[0])} <span>ETH</span>
                </strong>
              </div>
              <div>
                <span className="split-label">
                  <i className="split-dot rollover" />
                  Rollover <span>20%</span>
                </span>
                <strong>
                  {formatAmount(s?.jackpotSplit[2])} <span>ETH</span>
                </strong>
              </div>
              <div>
                <span className="split-label">
                  <i className="split-dot burn" />
                  Burn <span>20%</span>
                </span>
                <strong>
                  {formatAmount(s?.jackpotSplit[1])} <span>ETH</span>
                </strong>
              </div>
            </div>
          </section>
        </div>
        {(error || stale) && (
          <div className="network-notice" role="status">
            <Icon name="shield" />
            <div>
              <strong>
                {stale
                  ? "Chain data needs refreshing"
                  : "Network data is unavailable"}
              </strong>
              <p>
                {stale
                  ? "The last read is too old to trade safely. Refresh to check the latest block."
                  : explainError(error)}
              </p>
            </div>
            <button
              className="secondary"
              disabled={verification.isFetching || arena.isFetching}
              onClick={retry}
            >
              {verification.isFetching || arena.isFetching
                ? "Retrying…"
                : "Retry connection"}
            </button>
          </div>
        )}
        <section className="stats-strip" aria-label="Lifetime pool statistics">
          <div>
            <Icon name="flame" />
            <span>Total ETH burned</span>
            <strong>
              {formatAmount(s?.totalBurned)} <small>ETH</small>
            </strong>
          </div>
          <div>
            <Icon name="crown" />
            <span>Prizes delivered</span>
            <strong>
              {formatAmount(s?.totalPrizesPaid)} <small>ETH</small>
            </strong>
          </div>
          <div>
            <Icon name="eth" />
            <span>Hook fees collected</span>
            <strong>
              {formatAmount(s?.totalFeesCollected)} <small>ETH</small>
            </strong>
          </div>
          {address && (
            <div>
              <Icon name="wallet" />
              <span>Your wallet</span>
              <strong>
                {formatAmount(s?.ethBalance)} <small>ETH</small>
              </strong>
              <span className="mono small">
                {formatAmount(s?.tokenBalance, 18, 4)} REKTD
              </span>
            </div>
          )}
        </section>
        <History client={client} ready={ready} />
        <Operations
          client={client}
          snapshot={s}
          ready={ready}
          tx={tx}
          burnAddress={verification.data?.burnAddress}
          grace={verification.data?.grace}
        />
        <section
          id="rules"
          className="rules-section"
          aria-labelledby="rules-heading"
        >
          <div className="section-head">
            <h2 id="rules-heading">How the jackpot works</h2>
            <Icon name="clock" />
          </div>
          <div className="rules-grid">
            <div>
              <h3>Buy to take the lead</h3>
              <p>
                A buy of at least the current minimum makes your wallet the
                leader. The minimum is 5% of the jackpot, rounded up, with a
                0.0005 ETH floor.
              </p>
            </div>
            <div>
              <h3>Reset the pressure</h3>
              <p>
                The first ticket starts ten minutes. Each qualifying buy adds
                two minutes, capped at ten minutes from that buy. Sells do not
                extend the clock.
              </p>
            </div>
            <div>
              <h3>Be the last one standing</h3>
              <p>
                When the round expires, 60% goes to the leader, 20% burns, and
                the rest rolls over. Someone must settle or swap to record the
                result.
              </p>
            </div>
          </div>
          <p className="small muted">
            The minimum can change before your trade lands. Fees apply to every
            swap, even below the ticket minimum. An ETH payout that a recipient
            rejects remains claimable and can be recycled after one day.
          </p>
        </section>
        <details className="deployment-details">
          <summary>
            Contracts &amp; network <Icon name="chevron" />
          </summary>
          <div className="contract-grid">
            {runtime.deployment.contracts.map((c) => (
              <div key={c.name}>
                <h3>{c.name}</h3>
                <AddressView address={c.address} full />
                <a className="small" href={`./${c.abiPath}`}>
                  View verified ABI JSON <Icon name="external" />
                </a>
              </div>
            ))}
          </div>
          <dl className="detail-list">
            <div>
              <dt>Network</dt>
              <dd>
                {runtime.chain.name} · {runtime.chain.id}
              </dd>
            </div>
            <div>
              <dt>Last block</dt>
              <dd>{s ? s.block.toLocaleString() : "Unavailable"}</dd>
            </div>
            <div>
              <dt>Pool ID</dt>
              <dd className="mono">{runtime.poolId}</dd>
            </div>
            <div>
              <dt>Source commit</dt>
              <dd className="mono">{runtime.deployment.sourceCommit}</dd>
            </div>
          </dl>
          <a href="./imd-deployment.json">
            View deployment manifest <Icon name="external" />
          </a>
          <p className="small muted">
            Read-only data refreshes every 5 seconds. Quotes refresh every 15
            seconds and expire after 30 seconds. A countdown between blocks is
            an estimate; settlement is checked on-chain.
          </p>
        </details>
      </main>
      <footer className="site-footer">
        <a className="brand" href="#main">
          REKTD<span className="brand-dot">.</span>
        </a>
        <span>On-chain rules. Wallet-controlled trades.</span>
        <a
          href={`${runtime.deployment.network.explorer}/address/${runtime.hook.address}`}
          target="_blank"
          rel="noreferrer"
        >
          Explore the hook <Icon name="external" />
        </a>
      </footer>
    </>
  );
}
