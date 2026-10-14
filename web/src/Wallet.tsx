import { useState, useRef, useEffect, type ReactNode } from "react";
import {
  useConnect,
  useConnection,
  useDisconnect,
  type Connector,
} from "wagmi";
import {
  getAddress,
  numberToHex,
  type Address,
  type EIP1193Provider,
} from "viem";
import { useRuntime } from "./data";
import type { Deployment } from "./config";
import { explainError } from "./protocol";
import { Icon } from "./components";

export const OPEN_IN = [
  {
    id: "metamask",
    name: "MetaMask",
    href: (url: string) =>
      `https://link.metamask.io/dapp/${url.replace(/^https?:\/\//, "")}`,
  },
  {
    id: "coinbase",
    name: "Coinbase Wallet",
    href: (url: string) =>
      `https://go.cb-w.com/dapp?cb_url=${encodeURIComponent(url)}`,
  },
  {
    id: "rabby",
    name: "Rabby",
    href: (url: string) =>
      `https://go.rabby.io/mobile/?_cmd=open-dapp&dapp=${encodeURIComponent(url)}`,
  },
  {
    id: "phantom",
    name: "Phantom",
    href: (url: string) =>
      `https://phantom.app/ul/browse/${encodeURIComponent(url)}?ref=${encodeURIComponent(new URL(url).origin)}`,
  },
];
export const shortAddress = (a: Address) => {
  const full = getAddress(a);
  return `${full.slice(0, 6)}…${full.slice(-4)}`;
};
export async function switchToDeployment(
  provider: EIP1193Provider,
  deployment: Deployment,
) {
  const chainId = numberToHex(deployment.chainId);
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId }],
    });
  } catch (error) {
    const e = error as {
      code?: number;
      message?: string;
      cause?: { code?: number };
    };
    if (
      e.code !== 4902 &&
      e.cause?.code !== 4902 &&
      !/unknown chain|unrecognized chain|not added|not configured/i.test(
        e.message ?? "",
      )
    )
      throw error;
    if (!deployment.walletAddChain)
      throw Error(
        "This network cannot be added automatically. Add it in your wallet settings.",
      );
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [deployment.walletAddChain],
    });
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId }],
    });
  }
  if (
    Number(await provider.request({ method: "eth_chainId" })) !==
    deployment.chainId
  )
    throw Error(
      "The wallet is still on a different chain. Switch networks and retry.",
    );
}
export function Modal({
  open,
  close,
  title,
  children,
}: {
  open: boolean;
  close: () => void;
  title: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (open) {
      returnFocus.current = document.activeElement as HTMLElement;
      ref.current?.showModal();
    } else if (ref.current?.open) {
      ref.current.close();
      returnFocus.current?.focus();
    }
  }, [open]);
  return (
    <dialog
      ref={ref}
      className="modal"
      aria-label={title}
      onCancel={close}
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const items = [
          ...event.currentTarget.querySelectorAll<HTMLElement>(
            'button:not(:disabled), a[href], input:not(:disabled), summary, [tabindex="0"]',
          ),
        ].filter((el) => el.getClientRects().length > 0);
        const first = items[0],
          last = items[items.length - 1];
        if (!first) {
          event.preventDefault();
          return;
        }
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div className="modal-body">
        <div className="section-head">
          <h2>{title}</h2>
          <button
            className="icon-button"
            aria-label={`Close ${title.toLowerCase()}`}
            onClick={close}
          >
            <Icon name="close" />
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}
export function WalletControl() {
  const runtime = useRuntime();
  const { address, isConnected, chainId, connector } = useConnection();
  const { connectors, connectAsync, isPending, variables } = useConnect();
  const { disconnect } = useDisconnect();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [switching, setSwitching] = useState(false);
  const named = connectors.some(
    (c) => c.type === "injected" && c.id !== "injected",
  );
  const mobile =
    /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) &&
    !named &&
    !("ethereum" in window);
  const listed = [
    ...connectors.filter((c) => c.type === "injected"),
    ...connectors.filter((c) => c.type !== "injected"),
  ].filter(
    (c) =>
      !(c.id === "injected" && named) && !(mobile && c.type === "injected"),
  );
  const wrong = isConnected && chainId !== runtime.chain.id;
  const switchNetwork = async (c = connector) => {
    if (!c || switching) return;
    setError("");
    setSwitching(true);
    try {
      await switchToDeployment(
        (await c.getProvider()) as EIP1193Provider,
        runtime.deployment,
      );
    } catch (e) {
      setError(explainError(e));
    } finally {
      setSwitching(false);
    }
  };
  const connect = async (c: Connector) => {
    setError("");
    try {
      const connection = await connectAsync({ connector: c });
      setOpen(false);
      if (connection.chainId !== runtime.chain.id) await switchNetwork(c);
    } catch (e) {
      setError(
        c.id === "injected" && !("ethereum" in window)
          ? "No browser wallet found. Install a wallet extension, or use Coinbase Wallet."
          : explainError(e),
      );
    }
  };
  return (
    <div className="wallet-control">
      <button
        className="wallet-button"
        onClick={() => (wrong ? switchNetwork() : setOpen(true))}
        disabled={switching}
      >
        <Icon name="wallet" />
        {switching
          ? "Switching…"
          : wrong
            ? `Switch to ${runtime.chain.name}`
            : address
              ? shortAddress(address)
              : "Connect wallet"}
      </button>
      {error && !open && (
        <p className="wallet-error" role="alert">
          {error}
        </p>
      )}
      <Modal
        open={open}
        close={() => setOpen(false)}
        title={isConnected ? "Connected wallet" : "Connect a wallet"}
      >
        {isConnected && address ? (
          <>
            <AddressView address={address} full />
            <p className="muted">
              {wrong ? "Switch networks to trade." : runtime.chain.name}
            </p>
            <button
              className="secondary wide"
              onClick={() => {
                disconnect();
                setOpen(false);
              }}
            >
              Disconnect wallet
            </button>
          </>
        ) : (
          <>
            <p className="muted">
              Choose a wallet to trade on {runtime.chain.name}.
            </p>
            <div className="wallet-list">
              {mobile &&
                OPEN_IN.map((w) => (
                  <a
                    key={w.id}
                    className="wallet-row"
                    href={w.href(location.href)}
                  >
                    <img
                      src={`./wallets/${w.id}.svg`}
                      alt=""
                      width="28"
                      height="28"
                    />
                    Open in {w.name}
                    <Icon name="external" />
                  </a>
                ))}
              {listed.map((c) => (
                <button
                  className="wallet-row"
                  key={c.uid}
                  disabled={isPending}
                  onClick={() => connect(c)}
                >
                  {c.icon ? (
                    <img src={c.icon} alt="" width="28" height="28" />
                  ) : c.id === "coinbaseWalletSDK" ? (
                    <img
                      src="./wallets/coinbase.svg"
                      alt=""
                      width="28"
                      height="28"
                    />
                  ) : (
                    <Icon name="wallet" />
                  )}
                  <span>
                    {c.id === "injected"
                      ? "Browser wallet"
                      : c.id === "coinbaseWalletSDK" && mobile
                        ? "Coinbase Smart Wallet"
                        : c.name}
                    {isPending && variables?.connector === c
                      ? " · opening…"
                      : ""}
                  </span>
                </button>
              ))}
            </div>
            <p className="small muted">
              Your wallet confirms each transaction. This site never asks for a
              recovery phrase.
            </p>
            <p className="error" role="alert">
              {error}
            </p>
          </>
        )}
      </Modal>
    </div>
  );
}
export function AddressView({
  address,
  full = false,
}: {
  address: Address;
  full?: boolean;
}) {
  const { deployment } = useRuntime();
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  return (
    <span className={`address-view ${full ? "full-address" : ""}`}>
      <a
        href={`${deployment.network.explorer}/address/${address}`}
        target="_blank"
        rel="noreferrer"
        title={getAddress(address)}
      >
        {full ? getAddress(address) : shortAddress(address)}
      </a>
      <button
        className="copy-button"
        aria-label={`Copy address ${getAddress(address)}`}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(getAddress(address));
            setCopied(true);
            setCopyError(false);
            setTimeout(() => setCopied(false), 2500);
          } catch {
            setCopyError(true);
          }
        }}
      >
        <Icon name={copied ? "check" : "copy"} />
      </button>
      {(copied || copyError) && (
        <span className="small" role="status">
          {copied ? "Copied" : "Select the address to copy."}
        </span>
      )}
    </span>
  );
}
