import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useConnection } from "wagmi";
import { formatUnits, type Address } from "viem";
import {
  useRuntime,
  type ReadClient,
  type Snapshot,
  type Transactions,
} from "./data";
import { ActionButton, Icon, TxFeedback } from "./components";
import { AddressView, Modal } from "./Wallet";
import {
  buildSwap,
  buyerData,
  explainError,
  formatAmount,
  minimumOutput,
  parseAmount,
  permit2Abi,
  quoterAbi,
  quoteLifetimeMs,
  routerAbi,
  slippageBps,
  UINT128_MAX,
} from "./protocol";

type Review = {
  buy: boolean;
  input: bigint;
  output: bigint;
  min: bigint;
  account: Address;
  quotedAt: number;
  slippage: string;
};
export function Trade({
  client,
  snapshot: s,
  ready,
  tx,
  now,
}: {
  client: ReadClient;
  snapshot?: Snapshot;
  ready: boolean;
  tx: Transactions;
  now: number;
}) {
  const r = useRuntime();
  const { address, chainId, isConnected } = useConnection();
  const [buy, setBuy] = useState(true);
  const [amount, setAmount] = useState("0.0005");
  const [debounced, setDebounced] = useState(amount);
  const [slippage, setSlippage] = useState("0.5");
  const [error, setError] = useState("");
  const [maxLoading, setMaxLoading] = useState(false);
  const [review, setReview] = useState<Review>();
  const amountRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(amount), 350);
    return () => clearTimeout(timer);
  }, [amount]);
  useEffect(() => {
    setReview(undefined);
    setError("");
  }, [amount, buy, address, chainId, slippage]);
  let input = 0n;
  let validation = "";
  try {
    input = parseAmount(debounced, 18);
    slippageBps(slippage);
  } catch (e) {
    validation = (e as Error).message;
  }
  const quote = useQuery({
    queryKey: ["quote", buy, debounced, address, chainId, client.uid],
    queryFn: async () => {
      const result = await client.simulateContract({
        address: r.deployment.network.uniswapV4.quoter,
        abi: quoterAbi,
        functionName: "quoteExactInputSingle",
        account: address,
        args: [
          {
            poolKey: r.poolKey,
            zeroForOne: buy,
            exactAmount: input,
            hookData: address ? buyerData(address) : "0x",
          },
        ],
      });
      if (result.result[0] <= 0n || result.result[0] > UINT128_MAX)
        throw Error("No usable quote for this amount. Try a smaller trade.");
      return {
        output: result.result[0],
        gas: result.result[1],
        quotedAt: Date.now(),
      };
    },
    enabled: ready && input > 0n && !validation && amount === debounced,
    retry: false,
    staleTime: 10_000,
    refetchInterval: 15_000,
  });
  const quoteFresh =
    !!quote.data &&
    !quote.isError &&
    now - quote.data.quotedAt < quoteLifetimeMs &&
    amount === debounced;
  const connected = !!address && isConnected && chainId === r.chain.id;
  const balance = buy ? s?.ethBalance : s?.tokenBalance;
  const insufficient = balance !== undefined && input > balance;
  const tokenApproval =
    !buy && (s?.tokenAllowance === undefined || s.tokenAllowance < input);
  const permitApproval =
    !buy &&
    (s?.permit === undefined ||
      s.permit[0] < input ||
      s.permit[1] <= now / 1000 + 300);
  const step = tokenApproval ? 1 : permitApproval ? 2 : 3;
  const quoteOut = quoteFresh ? quote.data!.output : undefined;
  let min: bigint | undefined;
  if (quoteOut && !validation) {
    try {
      min = minimumOutput(quoteOut, slippageBps(slippage));
    } catch (e) {
      validation = (e as Error).message;
    }
  }
  const canReview =
    ready &&
    connected &&
    quoteFresh &&
    !validation &&
    !insufficient &&
    !!min &&
    !tx.busy;
  const tradeId = tokenApproval
    ? "token-approval"
    : permitApproval
      ? "permit-approval"
      : "swap";
  const label = tokenApproval
    ? "Approve REKTD"
    : permitApproval
      ? "Authorize router"
      : `Review ${buy ? "buy" : "sell"}`;
  const action = () => {
    if (!connected || !ready || !address || !quoteOut || !min) return;
    if (validation) {
      setError(validation);
      amountRef.current?.focus();
      return;
    }
    if (tokenApproval)
      void tx.run("token-approval", "Token approval", {
        ...r.token,
        functionName: "approve",
        args: [r.deployment.network.uniswapV4.permit2, input],
      });
    else if (permitApproval)
      void tx.run("permit-approval", "Router authorization", {
        address: r.deployment.network.uniswapV4.permit2,
        abi: permit2Abi,
        functionName: "approve",
        args: [
          r.token.address,
          r.deployment.network.uniswapV4.universalRouter,
          input,
          Math.floor(now / 1000) + 1800,
        ],
      });
    else
      setReview({
        buy,
        input,
        output: quoteOut,
        min,
        account: address,
        quotedAt: quote.data!.quotedAt,
        slippage,
      });
  };
  const confirm = () => {
    if (
      !review ||
      !ready ||
      !connected ||
      address !== review.account ||
      now - review.quotedAt >= quoteLifetimeMs ||
      tx.busy
    )
      return;
    const built = buildSwap(
      r.poolKey,
      review.buy,
      review.input,
      review.min,
      review.account,
      !!r.deployment.network.uniswapV4.extendedSwapParams,
      BigInt(Math.floor(now / 1000) + 300),
    );
    setReview(undefined);
    void tx.run("swap", review.buy ? "Buy REKTD" : "Sell REKTD", {
      address: r.deployment.network.uniswapV4.universalRouter,
      abi: routerAbi,
      functionName: "execute",
      args: [built.commands, built.inputs, built.deadline],
      value: built.value,
    });
  };
  const max = async () => {
    if (balance === undefined || !connected) return;
    setMaxLoading(true);
    setError("");
    try {
      let spendable = balance;
      if (buy) {
        const gasPrice = await client.getGasPrice();
        const gas = quote.data ? quote.data.gas + 150_000n : 400_000n;
        const reserve = (gas < 400_000n ? 400_000n : gas) * gasPrice * 2n;
        spendable = balance > reserve ? balance - reserve : 0n;
      }
      if (spendable <= 0n)
        throw Error("The balance is too low after reserving ETH for gas.");
      setAmount(
        formatUnits(spendable > UINT128_MAX ? UINT128_MAX : spendable, 18),
      );
    } catch (e) {
      setError(explainError(e));
    } finally {
      setMaxLoading(false);
    }
  };
  const inUnit = buy ? "ETH" : "REKTD";
  const outUnit = buy ? "REKTD" : "ETH";
  const quoteMessage = !ready
    ? "Waiting for verified pool data"
    : validation ||
      (quote.isError
        ? explainError(quote.error, r.hook.abi)
        : quote.isFetching && !quoteOut
          ? "Getting a quote…"
          : !quoteFresh
            ? "Quote needs refreshing"
            : "Quote includes pool and hook fees");
  return (
    <section
      className="panel trade-panel"
      id="trade"
      aria-labelledby="trade-heading"
    >
      <div className="section-head">
        <h2 id="trade-heading">Trade REKTD</h2>
        <span className="small muted">Uniswap v4</span>
      </div>
      <div className="segmented" role="group" aria-label="Trade direction">
        <button
          aria-pressed={buy}
          disabled={tx.busy}
          onClick={() => {
            setBuy(true);
            setAmount("0.0005");
          }}
        >
          Buy
        </button>
        <button
          aria-pressed={!buy}
          disabled={tx.busy}
          onClick={() => {
            setBuy(false);
            setAmount("");
          }}
        >
          Sell
        </button>
      </div>
      <div className="amount-field">
        <div className="field-top">
          <label htmlFor="amount">You pay</label>
          <span
            className="balance"
            title={balance === undefined ? "" : formatUnits(balance, 18)}
          >
            Balance: {formatAmount(balance, 18, 4)} {inUnit}
          </span>
        </div>
        <div className="amount-row">
          <input
            ref={amountRef}
            id="amount"
            name="amount"
            inputMode="decimal"
            autoComplete="off"
            value={amount}
            placeholder="0.00"
            aria-describedby="quote-note"
            aria-invalid={!!validation && amount !== ""}
            disabled={tx.busy}
            onChange={(e) => setAmount(e.target.value)}
          />
          <span className="currency">
            <span className={`coin ${buy ? "eth-coin" : ""}`}>
              {buy ? (
                <Icon name="eth" />
              ) : (
                <img src="./favicon.svg" width="22" height="22" alt="" />
              )}
            </span>
            {inUnit}
          </span>
        </div>
      </div>
      <div className="presets" role="group" aria-label="Trade amount presets">
        {buy ? (
          <>
            <button
              disabled={!s || tx.busy}
              onClick={() => s && setAmount(formatUnits(s.minimumTicket, 18))}
            >
              Min ticket
            </button>
            <button disabled={tx.busy} onClick={() => setAmount("0.001")}>
              0.001
            </button>
            <button disabled={tx.busy} onClick={() => setAmount("0.005")}>
              0.005
            </button>
          </>
        ) : (
          <>
            <button
              disabled={balance === undefined || tx.busy}
              onClick={() =>
                balance !== undefined &&
                setAmount(formatUnits(balance / 4n, 18))
              }
            >
              25%
            </button>
            <button
              disabled={balance === undefined || tx.busy}
              onClick={() =>
                balance !== undefined &&
                setAmount(formatUnits(balance / 2n, 18))
              }
            >
              50%
            </button>
            <button
              disabled={balance === undefined || tx.busy}
              onClick={() =>
                balance !== undefined &&
                setAmount(formatUnits((balance * 3n) / 4n, 18))
              }
            >
              75%
            </button>
          </>
        )}
        <button
          disabled={
            balance === undefined || !connected || maxLoading || tx.busy
          }
          onClick={max}
        >
          {maxLoading ? "…" : "Max"}
        </button>
      </div>
      <div className="receive-row">
        <div>
          <span className="muted small">You receive · estimated</span>
          <p
            className="receive-value"
            title={quoteOut ? formatUnits(quoteOut, 18) : ""}
          >
            {formatAmount(quoteOut, 18, buy ? 4 : 7)} <span>{outUnit}</span>
          </p>
        </div>
        <Icon name="arrow" />
      </div>
      <div className="slippage-row">
        <label htmlFor="slippage">Slippage</label>
        <span>
          <input
            id="slippage"
            name="slippage"
            inputMode="decimal"
            value={slippage}
            disabled={tx.busy}
            onChange={(e) => setSlippage(e.target.value)}
            aria-describedby="quote-note"
          />{" "}
          %
        </span>
      </div>
      <div className="trade-cta">
        <ActionButton
          id={tradeId}
          name={label}
          tx={tx}
          disabled={!canReview}
          onClick={action}
          primary
        />
        <p className="small trade-hint">
          {!isConnected
            ? "Connect your wallet above to trade."
            : !connected
              ? `Switch to ${r.chain.name} above.`
              : insufficient
                ? `Not enough ${inUnit}. Lower the amount.`
                : !ready
                  ? "Trading waits for verified, current chain data."
                  : !buy
                    ? `Step ${step} of 3 · ${step === 1 ? "Allow Permit2 to spend this exact amount." : step === 2 ? "Allow the router for 30 minutes." : "Review your swap before signing."}`
                    : s && input >= s.minimumTicket
                      ? "This buy can take the lead. The minimum can change."
                      : "Below the ticket minimum. You can still trade."}
        </p>
      </div>
      <p
        id="quote-note"
        role="status"
        className={`small quote-note ${validation || quote.isError ? "error" : "muted"}`}
      >
        {quoteMessage}
        {ready && (
          <button
            className="icon-button"
            aria-label="Refresh quote"
            disabled={quote.isFetching || !input || !!validation}
            onClick={() => quote.refetch()}
          >
            <Icon name="refresh" />
          </button>
        )}
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {["token-approval", "permit-approval", "swap"].map((id) => (
        <TxFeedback key={id} id={id} state={tx.states[id]} tx={tx} />
      ))}
      <details className="trade-details">
        <summary>
          Price, fees &amp; minimum received <Icon name="chevron" />
        </summary>
        <dl className="detail-list">
          <div>
            <dt>Minimum received</dt>
            <dd>
              {formatAmount(min)} {outUnit}
            </dd>
          </div>
          <div>
            <dt>Quoted rate</dt>
            <dd>
              {quoteOut && input > 0n
                ? formatAmount((quoteOut * 10n ** 18n) / input, 18, 6)
                : "…"}{" "}
              {outUnit} / {inUnit}
            </dd>
          </div>
          <div>
            <dt>Pool fee</dt>
            <dd>{r.poolKey.fee / 10_000}%</dd>
          </div>
          <div>
            <dt>Hook fee</dt>
            <dd>1% of the ETH side</dd>
          </div>
          <div>
            <dt>Network gas</dt>
            <dd>Extra, confirmed by your wallet</dd>
          </div>
        </dl>
        <p className="small muted">
          Half the hook fee funds the jackpot; half goes to the creator. Max
          reserves gas at twice the current gas price for at least 400,000 gas.
          USD pricing is unavailable: no price oracle is configured.
        </p>
      </details>
      <Modal
        open={!!review}
        close={() => setReview(undefined)}
        title={`Review ${review?.buy ? "buy" : "sell"}`}
      >
        {review && (
          <>
            <p>
              You pay{" "}
              <strong>
                {formatUnits(review.input, 18)} {review.buy ? "ETH" : "REKTD"}
              </strong>{" "}
              for an estimated{" "}
              <strong>
                {formatUnits(review.output, 18)} {review.buy ? "REKTD" : "ETH"}
              </strong>
              .
            </p>
            <dl className="detail-list">
              <div>
                <dt>Minimum received</dt>
                <dd>
                  {formatUnits(review.min, 18)} {review.buy ? "REKTD" : "ETH"}
                </dd>
              </div>
              <div>
                <dt>Slippage</dt>
                <dd>{review.slippage}%</dd>
              </div>
              <div>
                <dt>Network</dt>
                <dd>{r.chain.name}</dd>
              </div>
              <div>
                <dt>Trade expires</dt>
                <dd>5 minutes after confirmation request</dd>
              </div>
            </dl>
            <p className="small muted">
              Pool fee {r.poolKey.fee / 10_000}% and 1% ETH hook fee are
              included in the quote. Network gas is extra. A qualifying buy
              takes the lead only if it meets the on-chain minimum at execution.
            </p>
            <p className="small">Wallet &amp; ticket recipient</p>
            <AddressView address={review.account} full />
            {now - review.quotedAt >= quoteLifetimeMs && (
              <p role="alert" className="error">
                This quote expired. Close this review and refresh the quote.
              </p>
            )}
            <button
              className="primary wide"
              disabled={
                !ready ||
                !connected ||
                tx.busy ||
                now - review.quotedAt >= quoteLifetimeMs
              }
              onClick={confirm}
            >
              Confirm {review.buy ? "buy" : "sell"} <Icon name="arrow" />
            </button>
            <p className="small muted">
              The router call is simulated before your wallet is asked to sign.
            </p>
          </>
        )}
      </Modal>
    </section>
  );
}
