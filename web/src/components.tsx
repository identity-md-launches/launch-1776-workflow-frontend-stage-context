import type { ReactNode } from "react";
import type { TxState, Transactions } from "./data";
import { useRuntime } from "./data";

const paths = {
  arrow: "M5 12h14m-6-6 6 6-6 6",
  external: "M14 4h6v6m0-6L10 14M10 4H4v16h16v-6",
  wallet: "M4 6h15v14H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h13v2m-2 6h5v5h-5z",
  crown: "m3 6 5 5 4-7 4 7 5-5-3 13H6L3 6zm3 17h12",
  close: "m6 6 12 12M6 18 18 6",
  copy: "M8 8h12v13H8zM4 16H2V2h13v2",
  check: "m5 12 4 4L19 6",
  refresh:
    "M20 11a8 8 0 0 0-14-5L3 9m0-6v6h6m-5 4a8 8 0 0 0 14 5l3-3m0 6v-6h-6",
  flame:
    "M12 2c1 6-3 6-3 10-2-1-2-3-2-3-5 7-2 13 5 13s10-8 4-13c1 4-2 5-2 5 2-6-2-12-2-12z",
  shield: "M12 2 3 6v6c0 5 9 10 9 10s9-5 9-10V6l-9-4zm-5 10 3 3 7-7",
  clock: "M12 6v6l4 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0",
  chevron: "m6 9 6 6 6-6",
  eth: "m12 2 7 10-7 4-7-4 7-10zm-7 13 7 7 7-7-7 4-7-4",
} as const;
export function Icon({ name }: { name: keyof typeof paths }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}
export function Status({
  children,
  good = false,
}: {
  children: ReactNode;
  good?: boolean;
}) {
  return (
    <span className={`status ${good ? "good" : ""}`}>
      <span className="status-dot" />
      {children}
    </span>
  );
}
export function TxFeedback({
  state,
  id,
  tx,
}: {
  state?: TxState;
  id: string;
  tx: Transactions;
}) {
  const { deployment } = useRuntime();
  return (
    <div className="tx-feedback" role="status" aria-live="polite">
      {state && (
        <>
          <p
            className={
              state.phase === "error" || state.phase === "unconfirmed"
                ? "error"
                : state.phase === "success"
                  ? "success"
                  : ""
            }
          >
            {state.message}
          </p>
          {state.hash && (
            <a
              href={`${deployment.network.explorer}/tx/${state.hash}`}
              target="_blank"
              rel="noreferrer"
            >
              View {state.name.toLowerCase()} transaction{" "}
              <Icon name="external" />
            </a>
          )}
          {state.phase === "unconfirmed" && (
            <button
              className="secondary"
              disabled={tx.checking}
              onClick={() => tx.check(id)}
            >
              Check confirmation
            </button>
          )}
        </>
      )}
    </div>
  );
}
export function ActionButton({
  id,
  name,
  tx,
  disabled,
  onClick,
  primary = false,
}: {
  id: string;
  name: string;
  tx: Transactions;
  disabled?: boolean;
  onClick: () => void;
  primary?: boolean;
}) {
  const state = tx.states[id];
  const pending =
    state && ["simulating", "wallet", "pending"].includes(state.phase);
  return (
    <button
      className={primary ? "primary wide" : "secondary"}
      disabled={disabled || tx.busy}
      onClick={onClick}
      aria-busy={pending || undefined}
    >
      {pending && <span className="spinner" aria-hidden="true" />}
      {pending
        ? state.phase === "simulating"
          ? "Checking…"
          : state.phase === "wallet"
            ? "Confirm in wallet…"
            : "Confirming…"
        : name}
      {primary && !pending && <Icon name="arrow" />}
    </button>
  );
}
