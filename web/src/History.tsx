import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Address, Hex } from "viem";
import { useRuntime, type ReadClient } from "./data";
import { explainError, formatAmount } from "./protocol";
import { AddressView } from "./Wallet";
import { Icon } from "./components";

type Round = {
  id: bigint;
  winner: Address;
  prize: bigint;
  burn: bigint;
  rollover: bigint;
  hash: Hex;
  block: bigint;
};
export function History({
  client,
  ready,
}: {
  client: ReadClient;
  ready: boolean;
}) {
  const r = useRuntime();
  const [end, setEnd] = useState<bigint>();
  const result = useQuery({
    queryKey: ["history", end?.toString() ?? "latest", client.uid],
    enabled: ready,
    retry: false,
    refetchInterval: end ? false : 20_000,
    queryFn: async () => {
      const latest = end ?? (await client.getBlockNumber());
      const from =
        latest - 19_999n > r.deploymentBlock
          ? latest - 19_999n
          : r.deploymentBlock;
      if (from > latest) return { rows: [] as Round[], from, to: latest };
      const chunks = [];
      for (let start = from; start <= latest; start += 5000n)
        chunks.push([start, start + 4999n < latest ? start + 4999n : latest]);
      const logs = (
        await Promise.all(
          chunks.map(([fromBlock, toBlock]) =>
            client.getContractEvents({
              ...r.hook,
              eventName: "RoundSettled",
              fromBlock,
              toBlock,
              strict: true,
            }),
          ),
        )
      ).flat();
      const rows = logs
        .map((log) => {
          const args = (
            log as unknown as {
              args: {
                roundId: bigint;
                winner: Address;
                prize: bigint;
                burned: bigint;
                rollover: bigint;
              };
            }
          ).args;
          return {
            id: args.roundId,
            winner: args.winner,
            prize: args.prize,
            burn: args.burned,
            rollover: args.rollover,
            hash: log.transactionHash!,
            block: log.blockNumber!,
          };
        })
        .sort((a, b) => (a.id > b.id ? -1 : 1));
      return { rows, from, to: latest };
    },
  });
  return (
    <section
      id="history"
      className="history-section"
      aria-labelledby="history-heading"
    >
      <div className="section-head">
        <div>
          <h2 id="history-heading">Round history</h2>
          <p className="muted">The final word is on-chain.</p>
        </div>
        <button
          className="secondary"
          onClick={() => (end ? setEnd(undefined) : result.refetch())}
          disabled={!ready || result.isFetching}
        >
          <Icon name="refresh" />
          {end ? "Latest rounds" : "Refresh"}
        </button>
      </div>
      <div className="panel history-panel">
        {!ready ? (
          <div className="empty-state">
            <Icon name="clock" />
            <p>History will appear when the network is reachable.</p>
            <span className="muted small">
              Only settled rounds from the deployed hook are shown.
            </span>
          </div>
        ) : result.isPending ? (
          <div className="empty-state">
            <span className="spinner" />
            <p>Reading settled rounds…</p>
          </div>
        ) : result.isError ? (
          <div className="empty-state">
            <p className="error" role="alert">
              {explainError(result.error)}
            </p>
            <button className="secondary" onClick={() => result.refetch()}>
              Retry history
            </button>
          </div>
        ) : (
          <>
            {result.data?.rows.length ? (
              <div className="history-rows">
                <div className="history-labels">
                  <span>Round / winner</span>
                  <span>Winner allocation</span>
                  <span>Burn / rollover</span>
                  <span>Record</span>
                </div>
                {result.data.rows.map((row) => (
                  <article
                    className="history-row"
                    key={`${row.id}-${row.hash}`}
                  >
                    <div>
                      <span className="round-number">#{row.id.toString()}</span>
                      <AddressView address={row.winner} />
                    </div>
                    <div>
                      <span className="mobile-label">Winner allocation</span>
                      <span className="mono">
                        {formatAmount(row.prize)} ETH
                      </span>
                    </div>
                    <div>
                      <span className="mobile-label">Burn / rollover</span>
                      <span className="mono">
                        {formatAmount(row.burn)} / {formatAmount(row.rollover)}{" "}
                        ETH
                      </span>
                    </div>
                    <a
                      href={`${r.deployment.network.explorer}/tx/${row.hash}`}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={`View round ${row.id} settlement`}
                    >
                      View <Icon name="external" />
                    </a>
                  </article>
                ))}
              </div>
            ) : (
              <div className="empty-state">
                <Icon name="crown" />
                <p>No settled rounds in this block range.</p>
                <span className="muted small">
                  A qualifying buy starts a round. Earlier rounds may be on
                  another page.
                </span>
              </div>
            )}
            <div className="history-footer">
              <p className="small muted">
                Blocks {result.data?.from.toLocaleString()}–
                {result.data?.to.toLocaleString()} · Allocations may still await
                a claim.
              </p>
              <button
                className="secondary"
                disabled={
                  !result.data ||
                  result.data.from <= r.deploymentBlock ||
                  result.isFetching
                }
                onClick={() => result.data && setEnd(result.data.from - 1n)}
              >
                Older rounds <Icon name="arrow" />
              </button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
