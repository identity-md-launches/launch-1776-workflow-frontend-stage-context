import { readFile } from "node:fs/promises";
import {
  decodeFunctionData,
  encodeFunctionResult,
  encodeAbiParameters,
  encodeEventTopics,
  encodeErrorResult,
  parseAbi,
  keccak256,
  toHex,
  zeroAddress,
} from "viem";
const readJson = async (name) =>
  JSON.parse(await readFile(new URL(name, import.meta.url), "utf8"));
export const manifest = await readJson("../../dist/imd-deployment.json");
const token = manifest.contracts.find((c) => c.name === "RektdToken");
const hook = manifest.contracts.find((c) => c.name === "RektJackpotHook");
export const tokenAbi = await readJson("../../dist/" + token.abiPath);
export const hookAbi = await readJson("../../dist/" + hook.abiPath);
export const account = "0x08cD4437B077928E7fA09CF7dcDf3F7624743Bd2";
export const otherAccount = token.address; // Explicit mock wallet identity; never used for a live request.
const burn = "0x000000000000000000000000000000000000dEaD";
export const pool = {
  currency0: zeroAddress,
  currency1: token.address,
  fee: 12500,
  tickSpacing: 60,
  hooks: hook.address,
};
export const poolComponents = [
  { name: "currency0", type: "address" },
  { name: "currency1", type: "address" },
  { name: "fee", type: "uint24" },
  { name: "tickSpacing", type: "int24" },
  { name: "hooks", type: "address" },
];
export const poolId = keccak256(
  encodeAbiParameters([{ type: "tuple", components: poolComponents }], [pool]),
);
export const routerAbi = parseAbi([
  "function execute(bytes commands, bytes[] inputs, uint256 deadline) payable",
  "error ExecutionFailed(uint256 commandIndex, bytes message)",
  "error V4TooLittleReceived(uint256 minAmountOut, uint256 amountReceived)",
]);
export const permitAbi = parseAbi([
  "function allowance(address owner, address token, address spender) view returns (uint160 amount, uint48 expiration, uint48 nonce)",
  "function approve(address token, address spender, uint160 amount, uint48 expiration)",
]);
export const quoterAbi = parseAbi([
  "struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }",
  "struct QuoteExactSingleParams { PoolKey poolKey; bool zeroForOne; uint128 exactAmount; bytes hookData; }",
  "function quoteExactInputSingle(QuoteExactSingleParams params) returns (uint256 amountOut, uint256 gasEstimate)",
]);
export function createMock(options = {}) {
  const blockNumber = 88651730n;
  const state = {
    authorized: false,
    blockTimeOffset: 0,
    chainId: manifest.chainId,
    accounts: [account],
    missingChain: false,
    rejectConnect: false,
    rejectSend: false,
    rejectSwitch: false,
    failQuote: false,
    failExecute: false,
    noCode: false,
    wrongRpcChain: false,
    rpcDown: false,
    receiptPending: false,
    receiptFailed: false,
    ethBalance: 3n * 10n ** 18n,
    tokenBalance: 100000n * 10n ** 18n,
    allowance: 0n,
    permitAmount: 0n,
    permitExpiry: 0,
    expired: false,
    roundEnd: Math.floor(Date.now() / 1000) + 487,
    payout: 300000000000000000n,
    parked: 0n,
    fees: 17000000000000000n,
    owner: account,
    recipient: account,
    ...options,
  };
  const requests = [],
    sent = [],
    simulations = [],
    walletCalls = [];
  const transactions = new Map();
  const hash = "0x" + "ab".repeat(32);
  const block = () => ({
    number: toHex(blockNumber),
    hash,
    parentHash: hash,
    timestamp: toHex(
      BigInt(Math.floor(Date.now() / 1000) + state.blockTimeOffset),
    ),
    nonce: "0x0000000000000000",
    sha3Uncles: hash,
    logsBloom: "0x" + "00".repeat(256),
    transactionsRoot: hash,
    stateRoot: hash,
    receiptsRoot: hash,
    miner: account,
    difficulty: "0x0",
    totalDifficulty: "0x0",
    extraData: "0x",
    size: "0x100",
    gasLimit: "0x1c9c380",
    gasUsed: "0x10000",
    baseFeePerGas: "0x3b9aca00",
    transactions: [],
    uncles: [],
    mixHash: hash,
  });
  function call(params) {
    const tx = params[0];
    const to = tx.to.toLowerCase();
    const data = tx.data;
    let abi;
    if (to === token.address.toLowerCase()) abi = tokenAbi;
    else if (to === hook.address.toLowerCase()) abi = hookAbi;
    else if (to === manifest.network.uniswapV4.permit2) abi = permitAbi;
    else if (to === manifest.network.uniswapV4.quoter) abi = quoterAbi;
    else if (to === manifest.network.uniswapV4.universalRouter) abi = routerAbi;
    else throw Error("Unexpected mock contract: " + to);
    const decoded = decodeFunctionData({ abi, data });
    const fn = decoded.functionName;
    const values = {
      poolInitialized: true,
      poolId,
      poolManager: manifest.network.uniswapV4.poolManager,
      launchToken: token.address,
      symbol: "REKTD",
      name: "REKTD",
      decimals: 18,
      ROUND_DURATION: 600n,
      EXTENSION: 120n,
      MIN_TICKET_FLOOR: 500000000000000n,
      PARK_GRACE_PERIOD: 86400n,
      BURN_ADDRESS: burn,
      jackpotPool: 1200000000000000000n,
      minimumTicket: 60000000000000000n,
      currentLeader: otherAccount,
      roundEndTime: BigInt(state.roundEnd),
      roundId: 9n,
      roundExpired: state.expired,
      totalBurned: 780000000000000000n,
      totalPrizesPaid: 2340000000000000000n,
      totalFeesCollected: 305000000000000000n,
      pendingCreatorFees: state.fees,
      creatorFeeRecipient: state.recipient,
      owner: state.owner,
      jackpotSplit: [
        720000000000000000n,
        240000000000000000n,
        240000000000000000n,
      ],
      balanceOf: state.tokenBalance,
      unclaimedPayout: state.payout,
      parkedSince: state.parked,
      totalSupply: 10n ** 27n,
    };
    if (fn === "allowance")
      return encodeFunctionResult({
        abi,
        functionName: fn,
        result:
          to === token.address.toLowerCase()
            ? state.allowance
            : [state.permitAmount, state.permitExpiry, 0],
      });
    if (fn === "quoteExactInputSingle") {
      if (state.failQuote)
        throw {
          code: 3,
          message: "execution reverted: insufficient liquidity",
        };
      const q = decoded.args[0];
      return encodeFunctionResult({
        abi,
        functionName: fn,
        result: [
          q.zeroForOne ? q.exactAmount * 90000000n : q.exactAmount / 90000000n,
          180000n,
        ],
      });
    }
    if (fn in values)
      return encodeFunctionResult({
        abi,
        functionName: fn,
        result: values[fn],
      });
    simulations.push({ to, fn, args: decoded.args, value: tx.value });
    if (fn === "execute" && state.failExecute)
      throw {
        code: 3,
        message: "execution reverted",
        data: encodeErrorResult({
          abi: routerAbi,
          errorName: "V4TooLittleReceived",
          args: [100n, 90n],
        }),
      };
    if (fn === "settleRound" && !state.expired)
      throw {
        code: 3,
        message: "execution reverted",
        data: encodeErrorResult({ abi: hookAbi, errorName: "RoundNotOver" }),
      };
    return fn === "approve" && to === token.address.toLowerCase()
      ? encodeFunctionResult({ abi, functionName: fn, result: true })
      : "0x";
  }
  function process(request, wallet = false) {
    const { method, params = [] } = request;
    requests.push({ method, params, wallet });
    if (method === "eth_chainId")
      return toHex(
        state.wrongRpcChain && !wallet
          ? 1
          : wallet
            ? state.chainId
            : manifest.chainId,
      );
    if (method === "eth_blockNumber") return toHex(blockNumber);
    if (method === "eth_getBlockByNumber" || method === "eth_getBlockByHash")
      return block();
    if (method === "eth_getCode") return state.noCode ? "0x" : "0x60006000";
    if (method === "eth_getBalance") return toHex(state.ethBalance);
    if (method === "eth_call") return call(params);
    if (method === "eth_getLogs") {
      const filter = params[0];
      const eventBlock = blockNumber - 50n;
      if (
        BigInt(filter.fromBlock) > eventBlock ||
        BigInt(filter.toBlock) < eventBlock
      )
        return [];
      return [
        {
          address: hook.address,
          blockHash: hash,
          blockNumber: toHex(eventBlock),
          transactionHash: hash,
          transactionIndex: "0x0",
          logIndex: "0x0",
          removed: false,
          topics: encodeEventTopics({
            abi: hookAbi,
            eventName: "RoundSettled",
            args: { roundId: 8n, winner: account },
          }),
          data: encodeAbiParameters(
            [{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }],
            [600000000000000000n, 200000000000000000n, 200000000000000000n],
          ),
        },
      ];
    }
    if (method === "eth_gasPrice" || method === "eth_maxPriorityFeePerGas")
      return "0x3b9aca00";
    if (method === "eth_estimateGas") return "0x61a80";
    if (method === "eth_getTransactionCount") return "0x0";
    if (method === "eth_getTransactionReceipt") {
      const tx = transactions.get(params[0]);
      if (!tx || state.receiptPending) return null;
      if (!tx.applied && !state.receiptFailed) {
        const to = tx.to.toLowerCase();
        const abi =
          to === token.address.toLowerCase()
            ? tokenAbi
            : to === hook.address.toLowerCase()
              ? hookAbi
              : to === manifest.network.uniswapV4.permit2
                ? permitAbi
                : routerAbi;
        const { functionName: fn, args } = decodeFunctionData({
          abi,
          data: tx.data,
        });
        if (fn === "approve" && to === token.address.toLowerCase())
          state.allowance = args[1];
        if (fn === "approve" && to === manifest.network.uniswapV4.permit2) {
          state.permitAmount = args[2];
          state.permitExpiry = args[3];
        }
        if (fn === "claimPayout" || fn === "recycleParkedPayout")
          state.payout = 0n;
        if (fn === "claimCreatorFees") state.fees = 0n;
        if (fn === "settleRound") state.expired = false;
        if (fn === "setCreatorFeeRecipient") state.recipient = args[0];
        if (fn === "transferOwnership") state.owner = args[0];
        if (fn === "renounceOwnership") state.owner = zeroAddress;
        tx.applied = true;
      }
      return {
        transactionHash: params[0],
        transactionIndex: "0x0",
        blockHash: hash,
        blockNumber: toHex(blockNumber),
        from: state.accounts[0],
        to: tx.to,
        cumulativeGasUsed: "0x30000",
        gasUsed: "0x30000",
        contractAddress: null,
        logs: [],
        logsBloom: "0x" + "00".repeat(256),
        status: state.receiptFailed ? "0x0" : "0x1",
        effectiveGasPrice: "0x3b9aca00",
        type: "0x2",
      };
    }
    if (method === "eth_getTransactionByHash") {
      const tx = transactions.get(params[0]);
      return tx
        ? {
            ...tx,
            hash: params[0],
            from: state.accounts[0],
            input: tx.data,
            nonce: "0x0",
            value: tx.value ?? "0x0",
            gas: "0x61a80",
            gasPrice: "0x3b9aca00",
            blockNumber: toHex(blockNumber),
            blockHash: hash,
            transactionIndex: "0x0",
            type: "0x0",
            v: "0x1b",
            r: hash,
            s: hash,
          }
        : null;
    }
    throw Error("Unhandled RPC " + method);
  }
  async function wallet(request) {
    walletCalls.push(request);
    const { method, params } = request;
    if (method === "eth_accounts")
      return state.authorized ? state.accounts : [];
    if (method === "eth_requestAccounts") {
      if (state.rejectConnect) throw { code: 4001, message: "User rejected" };
      state.authorized = true;
      return state.accounts;
    }
    if (method === "wallet_switchEthereumChain") {
      if (state.rejectSwitch) throw { code: 4001, message: "User rejected" };
      if (state.missingChain) throw { code: 4902, message: "Unknown chain" };
      state.chainId = Number(params[0].chainId);
      return null;
    }
    if (method === "wallet_addEthereumChain") {
      state.missingChain = false;
      return null;
    }
    if (method === "wallet_requestPermissions")
      return [{ parentCapability: "eth_accounts" }];
    if (method === "wallet_revokePermissions") {
      state.authorized = false;
      return null;
    }
    if (method === "eth_sendTransaction") {
      if (state.rejectSend)
        throw { code: 4001, message: "User rejected transaction" };
      const txHash = "0x" + (sent.length + 1).toString(16).padStart(64, "0");
      sent.push(params[0]);
      transactions.set(txHash, { ...params[0] });
      return txHash;
    }
    return process(request, true);
  }
  return { state, requests, sent, simulations, walletCalls, process, wallet };
}
export async function attachMock(page, mock, { wallet = true } = {}) {
  await page.route(/^https:\/\//, async (route) => {
    if (
      !manifest.network.rpcUrls.some((url) =>
        route.request().url().startsWith(url),
      )
    )
      return route.abort();
    if (mock.state.rpcDown)
      return route.fulfill({
        status: 503,
        contentType: "application/json",
        body: '{"error":"offline test"}',
      });
    const payload = route.request().postDataJSON();
    const one = (request) => {
      try {
        return {
          jsonrpc: "2.0",
          id: request.id,
          result: mock.process(request),
        };
      } catch (e) {
        return {
          jsonrpc: "2.0",
          id: request.id,
          error: {
            code: e.code ?? -32603,
            message: e.message ?? "Mock error",
            ...(e.data ? { data: e.data } : {}),
          },
        };
      }
    };
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(
        Array.isArray(payload) ? payload.map(one) : one(payload),
      ),
    });
  });
  if (!wallet) return;
  await page.exposeFunction("__mockWalletRequest", async (request) => {
    try {
      return { result: await mock.wallet(request) };
    } catch (e) {
      return {
        error: { code: e.code ?? -32603, message: e.message ?? "Mock error" },
      };
    }
  });
  await page.addInitScript(() => {
    const listeners = new Map();
    const emit = (name, value) =>
      (listeners.get(name) ?? []).forEach((fn) => fn(value));
    const provider = {
      isMetaMask: true,
      on: (event, fn) =>
        listeners.set(event, [...(listeners.get(event) ?? []), fn]),
      removeListener: (event, fn) =>
        listeners.set(
          event,
          (listeners.get(event) ?? []).filter((f) => f !== fn),
        ),
      request: async (request) => {
        const response = await window.__mockWalletRequest(request);
        if (response.error) throw response.error;
        if (request.method === "wallet_switchEthereumChain")
          emit("chainChanged", request.params[0].chainId);
        return response.result;
      },
    };
    window.ethereum = provider;
    window.__emitWallet = emit;
    const info = {
      uuid: "272d0e61-08a2-4a1c-a3e1-553d4320e001",
      name: "Arena test wallet",
      icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="%2300ff9d"/></svg>',
      rdns: "test.rektd.wallet",
    };
    const announce = () =>
      window.dispatchEvent(
        new CustomEvent("eip6963:announceProvider", {
          detail: { info, provider },
        }),
      );
    window.addEventListener("eip6963:requestProvider", announce);
    announce();
  });
}
