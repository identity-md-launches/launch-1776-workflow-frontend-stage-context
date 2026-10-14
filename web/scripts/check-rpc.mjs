import {
  createPublicClient,
  http,
  fallback,
  encodeAbiParameters,
  parseAbi,
  keccak256,
} from "viem";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { dist, root, readJson } from "./lib.mjs";
const m = await readJson(resolve(dist, "imd-deployment.json"));
const client = createPublicClient({
  transport: fallback(
    m.network.rpcUrls.map((url) =>
      http(url, { batch: { wait: 25 }, retryCount: 0, timeout: 15000 }),
    ),
    { retryCount: 0 },
  ),
});
const report = {
  checkedAt: new Date().toISOString(),
  readOnly: true,
  chainId: null,
  contracts: [],
  state: {},
  quotes: {},
  limitations: [],
};
try {
  report.chainId = await client.getChainId();
  if (report.chainId !== m.chainId) throw Error("RPC chain mismatch");
  for (const c of m.contracts) {
    const code = await client.getBytecode({ address: c.address });
    if (!code || code === "0x") throw Error(`No code: ${c.name}`);
    report.contracts.push({
      name: c.name,
      address: c.address,
      byteLength: (code.length - 2) / 2,
      runtimeCodeKeccak: keccak256(code),
    });
  }
  for (const name of ["poolManager", "universalRouter", "quoter", "permit2"]) {
    const code = await client.getBytecode({
      address: m.network.uniswapV4[name],
    });
    if (!code || code === "0x") throw Error(`No protocol code: ${name}`);
    report.contracts.push({
      name,
      address: m.network.uniswapV4[name],
      byteLength: (code.length - 2) / 2,
    });
  }
  const hook = m.contracts.find((c) => c.name === "RektJackpotHook");
  const abi = await readJson(resolve(dist, hook.abiPath));
  const fields = [
    "poolInitialized",
    "poolId",
    "poolManager",
    "launchToken",
    "owner",
    "creatorFeeRecipient",
    "jackpotPool",
    "minimumTicket",
    "roundId",
    "currentLeader",
    "roundExpired",
    "totalBurned",
  ];
  report.state = Object.fromEntries(
    await Promise.all(
      fields.map(async (functionName) => [
        functionName,
        await client.readContract({ address: hook.address, abi, functionName }),
      ]),
    ),
  );
  const legacy = await readJson(
    resolve(root, "web/src/launch-parameters.json"),
  );
  const poolKey = m.poolKey ?? {
    currency0: legacy.pairedCurrency,
    currency1: m.contracts.find((c) => c.name === "RektdToken").address,
    fee: legacy.fee,
    tickSpacing: legacy.tickSpacing,
    hooks: hook.address,
  };
  const components = [
    { name: "currency0", type: "address" },
    { name: "currency1", type: "address" },
    { name: "fee", type: "uint24" },
    { name: "tickSpacing", type: "int24" },
    { name: "hooks", type: "address" },
  ];
  report.poolIdMatches =
    keccak256(
      encodeAbiParameters([{ type: "tuple", components }], [poolKey]),
    ) === report.state.poolId;
  if (!report.poolIdMatches) throw Error("Pool ID mismatch");
  const quoterAbi = parseAbi([
    "struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }",
    "struct QuoteExactSingleParams { PoolKey poolKey; bool zeroForOne; uint128 exactAmount; bytes hookData; }",
    "function quoteExactInputSingle(QuoteExactSingleParams params) returns (uint256 amountOut, uint256 gasEstimate)",
  ]);
  for (const [direction, amount] of [
    ["buy", 500000000000000n],
    ["sell", 1000000000000000000n],
  ]) {
    try {
      const quote = await client.simulateContract({
        address: m.network.uniswapV4.quoter,
        abi: quoterAbi,
        functionName: "quoteExactInputSingle",
        args: [
          {
            poolKey,
            zeroForOne: direction === "buy",
            exactAmount: amount,
            hookData: "0x",
          },
        ],
      });
      report.quotes[direction] = {
        amountIn: amount,
        amountOut: quote.result[0],
        gasEstimate: quote.result[1],
        simulated: true,
      };
    } catch (error) {
      report.quotes[direction] = { error: error.shortMessage ?? error.message };
    }
  }
} catch (error) {
  report.error = error.shortMessage ?? error.message;
  process.exitCode = 1;
}
report.limitations.push(
  "No transactions broadcast. Wallet signatures, approvals, fills and payouts with real funds were not tested. Nonempty code and matching reads do not independently attest runtime bytecode.",
);
const output =
  JSON.stringify(
    report,
    (_, value) => (typeof value === "bigint" ? value.toString() : value),
    2,
  ) + "\n";
await writeFile(resolve(root, "docs/validation/live-rpc.json"), output);
console.log(output);
