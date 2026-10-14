import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useRef,
  useCallback,
  type ReactNode,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useConnection } from "wagmi";
import { getConnection, getWalletClient } from "wagmi/actions";
import {
  createPublicClient,
  custom,
  fallback,
  http,
  zeroAddress,
  type Address,
  type Abi,
  type Hex,
  type EIP1193Provider,
  type PublicClient,
} from "viem";
import type { Runtime } from "./config";
import { explainError, permit2Abi } from "./protocol";

const Context = createContext<Runtime | null>(null);
export const RuntimeProvider = ({
  runtime,
  children,
}: {
  runtime: Runtime;
  children: ReactNode;
}) => <Context.Provider value={runtime}>{children}</Context.Provider>;
export const useRuntime = () => useContext(Context)!;
export function useReadClient() {
  const runtime = useRuntime();
  const { connector, chainId } = useConnection();
  const [provider, setProvider] = useState<EIP1193Provider>();
  useEffect(() => {
    let active = true;
    setProvider(undefined);
    if (connector && chainId === runtime.chain.id)
      connector
        .getProvider()
        .then((p) => {
          if (active) setProvider(p as EIP1193Provider);
        })
        .catch(() => {});
    return () => {
      active = false;
    };
  }, [connector, chainId, runtime]);
  return useMemo(() => {
    if (!provider || chainId !== runtime.chain.id) return runtime.publicClient;
    const guarded = {
      request: async (args: Parameters<EIP1193Provider["request"]>[0]) => {
        const actual = await provider.request({ method: "eth_chainId" });
        if (Number(actual) !== runtime.chain.id)
          throw Error("Wallet network mismatch");
        return provider.request(args);
      },
    } as EIP1193Provider;
    return createPublicClient({
      chain: runtime.chain,
      transport: fallback(
        [
          ...runtime.deployment.network.rpcUrls.map((url) =>
            http(url, { batch: { wait: 25 }, timeout: 8000, retryCount: 0 }),
          ),
          custom(guarded, { retryCount: 0 }),
        ],
        { retryCount: 0 },
      ),
      pollingInterval: 5000,
    });
  }, [provider, chainId, runtime]);
}
export type ReadClient = ReturnType<typeof useReadClient>;
export async function verifyDeployment(r: Runtime, client: ReadClient) {
  if ((await client.getChainId()) !== r.deployment.chainId)
    throw Error("The RPC returned a different chain. Trading is disabled.");
  const targets = [
    ...r.deployment.contracts.map((c) => c.address),
    r.deployment.network.uniswapV4.poolManager,
    r.deployment.network.uniswapV4.universalRouter,
    r.deployment.network.uniswapV4.quoter,
    r.deployment.network.uniswapV4.permit2,
  ];
  const code = await Promise.all(
    targets.map((address) => client.getBytecode({ address })),
  );
  if (code.some((c) => !c || c === "0x"))
    throw Error(
      "A required contract has no deployed code. Trading is disabled.",
    );
  const read = <T,>(functionName: string) =>
    client.readContract({
      address: r.hook.address,
      abi: r.hook.abi,
      functionName,
    }) as Promise<T>;
  const [
    initialized,
    poolId,
    manager,
    token,
    decimals,
    symbol,
    duration,
    extension,
    floor,
    grace,
    burnAddress,
  ] = await Promise.all([
    read<boolean>("poolInitialized"),
    read<Hex>("poolId"),
    read<Address>("poolManager"),
    read<Address>("launchToken"),
    client.readContract({
      ...r.token,
      functionName: "decimals",
    }) as Promise<number>,
    client.readContract({
      ...r.token,
      functionName: "symbol",
    }) as Promise<string>,
    read<bigint>("ROUND_DURATION"),
    read<bigint>("EXTENSION"),
    read<bigint>("MIN_TICKET_FLOOR"),
    read<bigint>("PARK_GRACE_PERIOD"),
    read<Address>("BURN_ADDRESS"),
  ]);
  if (!initialized)
    throw Error("The pool is not initialized yet. Trading is unavailable.");
  if (
    poolId.toLowerCase() !== r.poolId ||
    manager.toLowerCase() !==
      r.deployment.network.uniswapV4.poolManager.toLowerCase() ||
    token.toLowerCase() !== r.token.address.toLowerCase()
  )
    throw Error(
      "The live pool does not match the deployment. Trading is disabled.",
    );
  if (decimals !== 18 || symbol !== "REKTD")
    throw Error("The deployed token metadata does not match REKTD.");
  return {
    decimals,
    symbol,
    duration: Number(duration),
    extension: Number(extension),
    floor,
    grace,
    burnAddress,
    checkedAt: Date.now(),
  };
}
export function useVerification(client: ReadClient) {
  const r = useRuntime();
  const { address, chainId } = useConnection();
  return useQuery({
    queryKey: ["verification", address, chainId, client.uid],
    queryFn: () => verifyDeployment(r, client),
    retry: false,
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
}
export type Snapshot = {
  jackpotPool: bigint;
  minimumTicket: bigint;
  currentLeader: Address;
  roundEndTime: bigint;
  roundId: bigint;
  roundExpired: boolean;
  totalBurned: bigint;
  totalPrizesPaid: bigint;
  totalFeesCollected: bigint;
  pendingCreatorFees: bigint;
  creatorFeeRecipient: Address;
  owner: Address;
  jackpotSplit: readonly [bigint, bigint, bigint];
  ethBalance?: bigint;
  tokenBalance?: bigint;
  payout?: bigint;
  tokenAllowance?: bigint;
  permit?: readonly [bigint, number, number];
  block: bigint;
  timestamp: number;
  receivedAt: number;
};
export async function readSnapshot(
  r: Runtime,
  client: ReadClient,
  address?: Address,
): Promise<Snapshot> {
  const block = await client.getBlock();
  const fields = [
    "jackpotPool",
    "minimumTicket",
    "currentLeader",
    "roundEndTime",
    "roundId",
    "roundExpired",
    "totalBurned",
    "totalPrizesPaid",
    "totalFeesCollected",
    "pendingCreatorFees",
    "creatorFeeRecipient",
    "owner",
    "jackpotSplit",
  ];
  const values = await Promise.all(
    fields.map((functionName) =>
      client.readContract({
        ...r.hook,
        functionName,
        blockNumber: block.number,
      }),
    ),
  );
  const state = Object.fromEntries(fields.map((key, i) => [key, values[i]]));
  let wallet = {};
  if (address) {
    const [ethBalance, tokenBalance, payout, tokenAllowance, permit] =
      await Promise.all([
        client.getBalance({ address, blockNumber: block.number }),
        client.readContract({
          ...r.token,
          functionName: "balanceOf",
          args: [address],
          blockNumber: block.number,
        }),
        client.readContract({
          ...r.hook,
          functionName: "unclaimedPayout",
          args: [address],
          blockNumber: block.number,
        }),
        client.readContract({
          ...r.token,
          functionName: "allowance",
          args: [address, r.deployment.network.uniswapV4.permit2],
          blockNumber: block.number,
        }),
        client.readContract({
          address: r.deployment.network.uniswapV4.permit2,
          abi: permit2Abi,
          functionName: "allowance",
          args: [
            address,
            r.token.address,
            r.deployment.network.uniswapV4.universalRouter,
          ],
          blockNumber: block.number,
        }),
      ]);
    wallet = { ethBalance, tokenBalance, payout, tokenAllowance, permit };
  }
  return {
    ...state,
    ...wallet,
    block: block.number,
    timestamp: Number(block.timestamp),
    receivedAt: Date.now(),
  } as Snapshot;
}
export function useArena(client: ReadClient, verified: boolean) {
  const r = useRuntime();
  const { address } = useConnection();
  return useQuery({
    queryKey: ["arena", address, client.uid],
    queryFn: () => readSnapshot(r, client, address),
    enabled: verified,
    retry: false,
    refetchInterval: 5000,
    staleTime: 3000,
    refetchOnWindowFocus: true,
  });
}
export function useNow() {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}
export type TxPhase =
  "simulating" | "wallet" | "pending" | "unconfirmed" | "success" | "error";
export type TxState = {
  phase: TxPhase;
  message: string;
  hash?: Hex;
  name: string;
};
export type WriteRequest = {
  address: Address;
  abi: Abi;
  functionName: string;
  args?: readonly unknown[];
  value?: bigint;
};
export function useTransactions(client: ReadClient, allowed: boolean) {
  const runtime = useRuntime();
  const query = useQueryClient();
  const [states, setStates] = useState<Record<string, TxState>>({});
  const lock = useRef(false);
  const [busy, setBusy] = useState(false);
  const set = (id: string, state: TxState) =>
    setStates((old) => ({ ...old, [id]: state }));
  const refresh = () =>
    query.invalidateQueries({
      predicate: (q) =>
        ["arena", "recipient", "history", "quote"].includes(
          String(q.queryKey[0]),
        ),
    });
  const run = useCallback(
    async (id: string, name: string, request: WriteRequest) => {
      if (
        lock.current ||
        !allowed ||
        Object.values(states).some((s) => s.phase === "unconfirmed")
      )
        return;
      lock.current = true;
      setBusy(true);
      let hash: Hex | undefined;
      let receiptKnown = false;
      let cancelled = false;
      try {
        const connection = getConnection(runtime.walletConfig);
        if (!connection.address || connection.chainId !== runtime.chain.id)
          throw Error("Wallet network mismatch");
        const account = connection.address;
        set(id, {
          phase: "simulating",
          name,
          message: "Checking this transaction…",
        });
        const { request: simulated } = await client.simulateContract({
          ...request,
          account,
        });
        const latest = getConnection(runtime.walletConfig);
        if (latest.address !== account || latest.chainId !== runtime.chain.id)
          throw Error(
            "Wallet account or chain changed. Review the action again.",
          );
        const wallet = await getWalletClient(runtime.walletConfig);
        if ((await wallet.getChainId()) !== runtime.chain.id)
          throw Error("Wallet network mismatch");
        set(id, {
          phase: "wallet",
          name,
          message: "Confirm this action in your wallet.",
        });
        hash = await wallet.writeContract({
          ...simulated,
          account,
          chain: runtime.chain,
        });
        set(id, {
          phase: "pending",
          name,
          hash,
          message: "Submitted. Waiting for on-chain confirmation…",
        });
        const receipt = await client.waitForTransactionReceipt({
          hash,
          timeout: 180_000,
          onReplaced: (replacement) => {
            hash = replacement.transaction.hash;
            cancelled = replacement.reason === "cancelled";
            set(id, {
              phase: "pending",
              name,
              hash,
              message:
                replacement.reason === "cancelled"
                  ? "Cancellation submitted. Waiting for confirmation…"
                  : "Replacement submitted. Waiting for confirmation…",
            });
          },
        });
        receiptKnown = true;
        if (cancelled)
          throw Error(
            "Transaction cancelled in your wallet. No requested action was completed.",
          );
        if (receipt.status !== "success")
          throw Error(
            "Transaction reverted on chain. Refresh the state before retrying.",
          );
        // Refresh allowances before releasing the send lock.
        await refresh();
        set(id, {
          phase: "success",
          name,
          hash,
          message: "Confirmed on chain.",
        });
      } catch (error) {
        set(id, {
          phase: hash && !receiptKnown ? "unconfirmed" : "error",
          name,
          hash,
          message:
            hash && !receiptKnown
              ? "Confirmation could not be established. Check the transaction before sending another."
              : receiptKnown
                ? (error as Error).message
                : explainError(error, runtime.hook.abi),
        });
      } finally {
        // Unconfirmed receipts remain gated by unresolved below; rejections can be retried.
        lock.current = false;
        setBusy(false);
      }
    },
    [allowed, client, runtime, query, states],
  );
  const check = async (id: string) => {
    const item = states[id];
    if (!item?.hash || lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      const receipt = await client.getTransactionReceipt({ hash: item.hash });
      await refresh();
      set(id, {
        ...item,
        phase: receipt.status === "success" ? "success" : "error",
        message:
          receipt.status === "success"
            ? "Confirmed on chain."
            : "Transaction reverted. Refresh and retry.",
      });
    } catch {
      set(id, {
        ...item,
        message:
          "Still awaiting a receipt. Check the explorer or retry confirmation.",
      });
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const unresolved = Object.values(states).some(
    (s) => s.phase === "unconfirmed",
  );
  return { run, states, busy: busy || unresolved, checking: busy, check };
}
export type Transactions = ReturnType<typeof useTransactions>;
export const isZero = (address?: Address) =>
  !address || address.toLowerCase() === zeroAddress;
