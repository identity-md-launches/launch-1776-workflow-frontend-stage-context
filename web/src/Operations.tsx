import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useConnection } from "wagmi";
import { getAddress, isAddress, zeroAddress, type Address } from "viem";
import {
  useRuntime,
  type ReadClient,
  type Snapshot,
  type Transactions,
} from "./data";
import { formatAmount, explainError } from "./protocol";
import { ActionButton, Icon, TxFeedback } from "./components";
import { AddressView, Modal } from "./Wallet";

export function Operations({
  client,
  snapshot: s,
  ready,
  tx,
  burnAddress,
  grace,
}: {
  client: ReadClient;
  snapshot?: Snapshot;
  ready: boolean;
  tx: Transactions;
  burnAddress?: Address;
  grace?: bigint;
}) {
  const r = useRuntime();
  const { address, chainId } = useConnection();
  const connected = !!address && chainId === r.chain.id;
  const [recipient, setRecipient] = useState("");
  const [lookup, setLookup] = useState("");
  const [nextRecipient, setNextRecipient] = useState("");
  const [nextOwner, setNextOwner] = useState("");
  const [renounce, setRenounce] = useState("");
  const [review, setReview] = useState<{
    id: string;
    name: string;
    fn: string;
    target?: Address;
  }>();
  useEffect(() => {
    setRecipient(address ?? "");
    setReview(undefined);
  }, [address, chainId]);
  useEffect(() => {
    const id = setTimeout(() => setLookup(recipient.trim()), 300);
    return () => clearTimeout(id);
  }, [recipient]);
  const valid = isAddress(lookup) && lookup.toLowerCase() !== zeroAddress;
  const payout = useQuery({
    queryKey: ["recipient", lookup, client.uid],
    enabled: ready && valid,
    retry: false,
    refetchInterval: 5000,
    queryFn: async () => {
      const block = await client.getBlock();
      const [amount, parked] = await Promise.all([
        client.readContract({
          ...r.hook,
          functionName: "unclaimedPayout",
          args: [lookup],
          blockNumber: block.number,
        }),
        client.readContract({
          ...r.hook,
          functionName: "parkedSince",
          args: [lookup],
          blockNumber: block.number,
        }),
      ]);
      return {
        amount: amount as bigint,
        parked: parked as bigint,
        timestamp: block.timestamp,
      };
    },
  });
  const payoutCurrent =
    valid &&
    lookup === recipient.trim() &&
    !!payout.data &&
    !payout.isError &&
    Date.now() - payout.dataUpdatedAt < 30_000;
  const canClaim =
    ready && connected && payoutCurrent && payout.data!.amount > 0n;
  const canRecycle =
    canClaim &&
    payout.data!.parked > 0n &&
    grace !== undefined &&
    payout.data!.timestamp >= payout.data!.parked + grace;
  const owner = connected && s?.owner.toLowerCase() === address?.toLowerCase();
  const validTarget = (a: string) =>
    isAddress(a.trim()) && a.trim().toLowerCase() !== zeroAddress;
  const sendOwner = () => {
    if (!review || !owner || !ready) return;
    void tx.run(review.id, review.name, {
      ...r.hook,
      functionName: review.fn,
      args: review.target ? [review.target] : [],
    });
    setReview(undefined);
  };
  return (
    <section
      id="claims"
      className="operations"
      aria-labelledby="operations-heading"
    >
      <div className="section-head">
        <div>
          <h2 id="operations-heading">Settle &amp; claim</h2>
          <p className="muted">
            Anyone can trigger delivery. ETH goes to the recorded recipient.
          </p>
        </div>
        <Icon name="shield" />
      </div>
      <div className="operations-grid">
        <section className="panel operation">
          <h3>Finish the round</h3>
          <p className="muted">
            After the clock expires, settle the prize and burn share. The next
            swap can also settle the round.
          </p>
          <p className="operation-value">
            {s
              ? s.roundExpired
                ? "Ready to settle"
                : "No expired round"
              : "Waiting for chain data"}
          </p>
          <ActionButton
            id="settle"
            name="Settle round"
            tx={tx}
            disabled={!ready || !connected || !s?.roundExpired}
            onClick={() =>
              tx.run("settle", "Settle round", {
                ...r.hook,
                functionName: "settleRound",
              })
            }
          />
          <TxFeedback id="settle" state={tx.states.settle} tx={tx} />
        </section>
        <section className="panel operation">
          <h3>Claim a payout</h3>
          <label htmlFor="payout-address">Recipient address</label>
          <input
            id="payout-address"
            autoComplete="off"
            spellCheck="false"
            placeholder="Paste a wallet address"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            aria-invalid={recipient !== "" && !isAddress(recipient.trim())}
            aria-describedby="recipient-note"
          />
          <div className="inline-actions">
            <button
              className="text-button"
              disabled={!address}
              onClick={() => setRecipient(address!)}
            >
              Use my wallet
            </button>
            <button
              className="text-button"
              disabled={!burnAddress}
              onClick={() => burnAddress && setRecipient(burnAddress)}
            >
              Use burn recipient
            </button>
          </div>
          <p
            id="recipient-note"
            className={`small ${recipient && !valid ? "error" : "muted"}`}
          >
            {recipient && !valid
              ? "Enter a valid, nonzero EVM address."
              : "Claims deliver to this address, even if someone else pays gas."}
          </p>
          <p className="operation-value">
            {formatAmount(payoutCurrent ? payout.data!.amount : undefined)}{" "}
            <span>ETH available</span>
          </p>
          <ActionButton
            id="payout"
            name="Claim payout"
            tx={tx}
            disabled={!canClaim}
            onClick={() =>
              tx.run("payout", "Claim payout", {
                ...r.hook,
                functionName: "claimPayout",
                args: [getAddress(lookup)],
              })
            }
          />
          {payout.isError && (
            <p className="error" role="alert">
              {explainError(payout.error)}
            </p>
          )}
          <TxFeedback id="payout" state={tx.states.payout} tx={tx} />
          <details>
            <summary>
              Parked payout recovery <Icon name="chevron" />
            </summary>
            <p className="small muted">
              A recipient that rejects ETH keeps a parked claim. After one day,
              anyone can retry delivery and return a still-rejected payout to
              the jackpot.
            </p>
            {payoutCurrent && (
              <p className="small">
                {payout.data!.parked > 0n
                  ? `Parked since ${new Date(Number(payout.data!.parked) * 1000).toLocaleString()}`
                  : "This recipient has no parked payout."}
              </p>
            )}
            <ActionButton
              id="recycle"
              name="Recover parked payout"
              tx={tx}
              disabled={!canRecycle}
              onClick={() =>
                tx.run("recycle", "Recover parked payout", {
                  ...r.hook,
                  functionName: "recycleParkedPayout",
                  args: [getAddress(lookup)],
                })
              }
            />
            <TxFeedback id="recycle" state={tx.states.recycle} tx={tx} />
          </details>
        </section>
        <section className="panel operation">
          <h3>Creator fees</h3>
          <p className="muted">
            Send accrued fees to the creator’s current recipient.
          </p>
          <p className="operation-value">
            {formatAmount(s?.pendingCreatorFees)} <span>ETH</span>
          </p>
          {s && <AddressView address={s.creatorFeeRecipient} full />}
          <ActionButton
            id="creator"
            name="Claim creator fees"
            tx={tx}
            disabled={
              !ready ||
              !connected ||
              !s ||
              s.pendingCreatorFees === 0n ||
              s.creatorFeeRecipient === zeroAddress
            }
            onClick={() =>
              tx.run("creator", "Claim creator fees", {
                ...r.hook,
                functionName: "claimCreatorFees",
              })
            }
          />
          <TxFeedback id="creator" state={tx.states.creator} tx={tx} />
        </section>
      </div>
      {!connected && (
        <p className="small muted">
          Connect a wallet on {r.chain.name} to settle or claim.
        </p>
      )}
      {owner && (
        <details className="panel owner-panel">
          <summary>
            Owner settings <Icon name="chevron" />
          </summary>
          <p>
            Only the connected owner can update these settings. There is no fee,
            timer, pause, or jackpot withdrawal setting.
          </p>
          <div className="owner-grid">
            <div>
              <label htmlFor="creator-recipient">
                New creator fee recipient
              </label>
              <input
                id="creator-recipient"
                value={nextRecipient}
                onChange={(e) => setNextRecipient(e.target.value)}
                placeholder="Paste a recipient address"
                spellCheck="false"
              />
              <p className="small muted">
                This also redirects all unclaimed creator fees. Choose an
                address that accepts ETH.
              </p>
              <ActionButton
                id="recipient"
                name="Review fee recipient"
                tx={tx}
                disabled={!ready || !validTarget(nextRecipient)}
                onClick={() =>
                  setReview({
                    id: "recipient",
                    name: "Update fee recipient",
                    fn: "setCreatorFeeRecipient",
                    target: getAddress(nextRecipient.trim()),
                  })
                }
              />
              <TxFeedback id="recipient" state={tx.states.recipient} tx={tx} />
            </div>
            <div>
              <label htmlFor="new-owner">New owner</label>
              <input
                id="new-owner"
                value={nextOwner}
                onChange={(e) => setNextOwner(e.target.value)}
                placeholder="Paste the new owner address"
                spellCheck="false"
              />
              <p className="small muted">
                Ownership transfers immediately. The new owner can redirect
                creator fees.
              </p>
              <ActionButton
                id="ownership"
                name="Review ownership transfer"
                tx={tx}
                disabled={!ready || !validTarget(nextOwner)}
                onClick={() =>
                  setReview({
                    id: "ownership",
                    name: "Transfer ownership",
                    fn: "transferOwnership",
                    target: getAddress(nextOwner.trim()),
                  })
                }
              />
              <TxFeedback id="ownership" state={tx.states.ownership} tx={tx} />
            </div>
          </div>
          <details>
            <summary>
              Renounce ownership permanently <Icon name="chevron" />
            </summary>
            <p className="error">
              This cannot be undone. The creator fee recipient will become
              permanent, including if it stops accepting ETH.
            </p>
            <label htmlFor="renounce">Type RENOUNCE to review</label>
            <input
              id="renounce"
              value={renounce}
              onChange={(e) => setRenounce(e.target.value)}
              autoComplete="off"
            />
            <ActionButton
              id="renounce"
              name="Review renunciation"
              tx={tx}
              disabled={!ready || renounce !== "RENOUNCE"}
              onClick={() =>
                setReview({
                  id: "renounce",
                  name: "Renounce ownership permanently",
                  fn: "renounceOwnership",
                })
              }
            />
            <TxFeedback id="renounce" state={tx.states.renounce} tx={tx} />
          </details>
        </details>
      )}
      {!owner &&
        ["recipient", "ownership", "renounce"].map((id) => (
          <TxFeedback key={id} id={id} state={tx.states[id]} tx={tx} />
        ))}
      <Modal
        open={!!review}
        close={() => setReview(undefined)}
        title={review?.name ?? "Review owner setting"}
      >
        {review && (
          <>
            <p>
              {review.fn === "setCreatorFeeRecipient"
                ? "All pending and future creator fees will go to this recipient."
                : review.fn === "transferOwnership"
                  ? "This address will immediately control the creator fee recipient setting."
                  : "Owner access will be permanently removed. No one can ever change the creator fee recipient again."}
            </p>
            {review.target && <AddressView address={review.target} full />}
            <button
              className="primary wide"
              disabled={!ready || !owner || tx.busy}
              onClick={sendOwner}
            >
              {review.name}
            </button>
          </>
        )}
      </Modal>
    </section>
  );
}
