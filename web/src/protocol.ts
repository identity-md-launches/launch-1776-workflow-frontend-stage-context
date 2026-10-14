import {
  encodeAbiParameters,
  parseAbi,
  parseUnits,
  formatUnits,
  zeroAddress,
  decodeErrorResult,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import { poolComponents, type PoolKey } from "./config";

// Protocol interfaces only. Application ABIs always load from the attested runtime manifest.
export const quoterAbi = parseAbi([
  "struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }",
  "struct QuoteExactSingleParams { PoolKey poolKey; bool zeroForOne; uint128 exactAmount; bytes hookData; }",
  "function quoteExactInputSingle(QuoteExactSingleParams params) returns (uint256 amountOut, uint256 gasEstimate)",
  "error UnexpectedRevertBytes(bytes reason)",
  "error NotEnoughLiquidity()",
]);
export const routerAbi = parseAbi([
  "function execute(bytes commands, bytes[] inputs, uint256 deadline) payable",
  "error ExecutionFailed(uint256 commandIndex, bytes message)",
  "error TransactionDeadlinePassed()",
  "error V4TooLittleReceived(uint256 minAmountOut, uint256 amountReceived)",
  "error V4TooMuchRequested(uint256 maxAmountIn, uint256 amountRequested)",
  "error InsufficientBalance()",
]);
export const permit2Abi = parseAbi([
  "function allowance(address owner, address token, address spender) view returns (uint160 amount, uint48 expiration, uint48 nonce)",
  "function approve(address token, address spender, uint160 amount, uint48 expiration)",
  "error AllowanceExpired(uint256 deadline)",
  "error InsufficientAllowance(uint256 amount)",
]);
export const UINT128_MAX = (1n << 128n) - 1n;
export const quoteLifetimeMs = 30_000;
export function parseAmount(value: string, decimals = 18) {
  if (!/^(?:\d+\.?\d*|\.\d+)$/.test(value.trim()))
    throw Error("Enter a positive amount using digits and a decimal point.");
  if ((value.split(".")[1]?.length ?? 0) > decimals)
    throw Error(`Use at most ${decimals} decimal places.`);
  const amount = parseUnits(value.trim(), decimals);
  if (amount <= 0n) throw Error("Enter an amount greater than zero.");
  if (amount > UINT128_MAX)
    throw Error("This amount exceeds the pool’s trade limit.");
  return amount;
}
export function slippageBps(value: string) {
  if (
    !/^\d+(\.\d{1,2})?$/.test(value) ||
    Number(value) < 0.1 ||
    Number(value) > 5
  )
    throw Error(
      "Choose slippage from 0.1% to 5%, with up to two decimal places.",
    );
  return BigInt(Math.round(Number(value) * 100));
}
export function minimumOutput(quote: bigint, bps: bigint) {
  if (bps < 10n || bps > 500n || quote <= 0n)
    throw Error("Quote or slippage is invalid. Refresh the quote.");
  const out = (quote * (10_000n - bps)) / 10_000n;
  if (out === 0n)
    throw Error(
      "This trade is too small to protect with slippage. Increase the amount.",
    );
  return out;
}
export function buyerData(address: Address): Hex {
  return encodeAbiParameters([{ type: "address" }], [address]);
}
export function buildSwap(
  pool: PoolKey,
  buy: boolean,
  amount: bigint,
  minOut: bigint,
  buyer: Address,
  extended: boolean,
  deadline: bigint,
) {
  const zeroForOne = buy
    ? pool.currency0 === zeroAddress
    : pool.currency0 !== zeroAddress;
  const input = zeroForOne ? pool.currency0 : pool.currency1;
  const output = zeroForOne ? pool.currency1 : pool.currency0;
  const common = [
    { name: "poolKey", type: "tuple", components: poolComponents },
    { name: "zeroForOne", type: "bool" },
    { name: "amountIn", type: "uint128" },
    { name: "amountOutMinimum", type: "uint128" },
  ] as const;
  const data = buyerData(buyer);
  const swap = extended
    ? encodeAbiParameters(
        [
          {
            type: "tuple",
            components: [
              ...common,
              { name: "minHopPriceX36", type: "uint256" },
              { name: "hookData", type: "bytes" },
            ],
          },
        ],
        [
          {
            poolKey: pool,
            zeroForOne,
            amountIn: amount,
            amountOutMinimum: minOut,
            minHopPriceX36: 0n,
            hookData: data,
          },
        ],
      )
    : encodeAbiParameters(
        [
          {
            type: "tuple",
            components: [...common, { name: "hookData", type: "bytes" }],
          },
        ],
        [
          {
            poolKey: pool,
            zeroForOne,
            amountIn: amount,
            amountOutMinimum: minOut,
            hookData: data,
          },
        ],
      );
  const settle = encodeAbiParameters(
    [{ type: "address" }, { type: "uint256" }],
    [input, amount],
  );
  const take = encodeAbiParameters(
    [{ type: "address" }, { type: "uint256" }],
    [output, minOut],
  );
  const packed = encodeAbiParameters(
    [{ type: "bytes" }, { type: "bytes[]" }],
    ["0x060c0f", [swap, settle, take]],
  );
  return {
    commands: "0x10" as Hex,
    inputs: [packed],
    deadline,
    value: input === zeroAddress ? amount : 0n,
  };
}
export function formatAmount(
  value: bigint | undefined,
  decimals = 18,
  places = 6,
) {
  if (value === undefined) return "…";
  const full = formatUnits(value, decimals);
  const [whole, fraction = ""] = full.split(".");
  const digits = fraction.slice(0, places).replace(/0+$/, "");
  if (value > 0n && BigInt(whole) === 0n && !digits)
    return `<0.${"0".repeat(places - 1)}1`;
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${digits ? "." + digits : ""}`;
}
export function timeLeft(end: bigint, leader: Address, chainTime: number) {
  if (leader === zeroAddress) return 0;
  if (chainTime > Number(end)) return 0;
  return Math.max(1, Number(end) - Math.floor(chainTime));
}
export function explainError(
  error: unknown,
  applicationAbi: Abi = [],
  depth = 0,
): string {
  if (depth > 8) return "Contract simulation reverted.";
  const e = error as {
    shortMessage?: string;
    message?: string;
    code?: number;
    cause?: unknown;
    data?: { errorName?: string; args?: readonly unknown[] };
  };
  let nested = "";
  if (
    e?.data?.args &&
    ["UnexpectedRevertBytes", "ExecutionFailed"].includes(
      e.data.errorName ?? "",
    )
  ) {
    const bytes = e.data.args[e.data.args.length - 1];
    if (typeof bytes === "string" && /^0x[0-9a-f]+$/i.test(bytes)) {
      try {
        nested = explainError(
          {
            data: decodeErrorResult({
              abi: [
                ...applicationAbi,
                ...quoterAbi,
                ...routerAbi,
                ...permit2Abi,
              ],
              data: bytes as Hex,
            }),
          },
          applicationAbi,
          depth + 1,
        );
      } catch {
        nested =
          "The pool could not complete this trade. Check liquidity and try a smaller amount.";
      }
    }
  }
  if (nested) return nested;
  // viem wraps a decoded contract error in one or more execution errors.
  // Preserve the innermost known reason rather than replacing it with the wrapper.
  let cause = e?.cause as typeof e;
  for (let i = 0; cause && i < 8; i++) {
    if (cause.data?.errorName)
      return explainError(cause, applicationAbi, depth + 1);
    cause = cause.cause as typeof e;
  }
  if (e?.data?.errorName === "Error" && typeof e.data.args?.[0] === "string")
    return `Contract reverted: ${e.data.args[0].slice(0, 180)}`;
  const text = [
    e?.shortMessage,
    e?.message,
    e?.data?.errorName,
    e?.cause ? explainError(e.cause, applicationAbi, depth + 1) : "",
  ].join(" ");
  if (e?.code === 4001 || /reject|denied|cancel/i.test(text))
    return "Request declined in your wallet. You can try again.";
  if (/RoundNotOver/.test(text))
    return "The round is still running. Wait for the next block, then retry.";
  if (/NothingToClaim/.test(text))
    return "No payout is available. Refresh the arena to check again.";
  if (/PayoutNotRecyclable/.test(text))
    return "This payout has not been parked for a full day. Retry after the grace period.";
  if (/CreatorFeeTransferFailed/.test(text))
    return "The recipient could not receive ETH. The owner can update the fee recipient; fees remain claimable.";
  if (/OwnableUnauthorized/.test(text))
    return "Only the current owner can change this setting. Reconnect the owner wallet.";
  if (/TooLittleReceived|TooMuchRequested|slippage/.test(text))
    return "The price moved beyond your slippage limit. Refresh the quote and review it again.";
  if (/Allowance|allowance/.test(text))
    return "The token allowance is insufficient or expired. Refresh and complete the approval step.";
  if (/NotEnoughLiquidity/.test(text))
    return "The pool has insufficient liquidity for this trade. Try a smaller amount or the other direction.";
  if (
    /insufficient funds|exceeds.*balance|ERC20InsufficientBalance/i.test(text)
  )
    return "Insufficient balance. Keep some ETH for network fees and lower the amount.";
  if (/chain|network mismatch/i.test(text) && !/http/i.test(text))
    return "Switch your wallet to the arena network and try again.";
  if (/fetch|http|403|429|timeout|network request/i.test(text))
    return "The network could not be reached. Retry, or connect a wallet on the correct chain for a fallback.";
  if (
    /revert|executionfailed|EthOutputNotFilled|UnexpectedRevertBytes/i.test(
      text,
    )
  )
    return "The contract simulation reverted. Liquidity or round state may have changed. Refresh and try a smaller trade.";
  return (
    e?.shortMessage?.slice(0, 220) ||
    e?.message?.split("\n")[0]?.slice(0, 220) ||
    "The request could not complete. Refresh and try again."
  );
}
