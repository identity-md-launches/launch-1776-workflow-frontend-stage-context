import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  decodeAbiParameters,
  zeroAddress,
  type Address,
  type EIP1193Provider,
} from "viem";
import {
  buildSwap,
  buyerData,
  minimumOutput,
  parseAmount,
  slippageBps,
  timeLeft,
  explainError,
} from "../src/protocol";
import {
  canonicalAbiHash,
  poolComponents,
  type PoolKey,
  type Deployment,
} from "../src/config";
import { switchToDeployment, OPEN_IN } from "../src/Wallet";
const m = JSON.parse(
  readFileSync(
    new URL("../../dist/imd-deployment.json", import.meta.url),
    "utf8",
  ),
) as Deployment;
const hook = m.contracts.find((c) => c.name === "RektJackpotHook")!;
const token = m.contracts.find((c) => c.name === "RektdToken")!;
const buyer = "0x08cD4437B077928E7fA09CF7dcDf3F7624743Bd2" as Address;
const pool: PoolKey = {
  currency0: zeroAddress,
  currency1: token.address,
  fee: 12500,
  tickSpacing: 60,
  hooks: hook.address,
};
test("canonical hashes bind both ABI exports", () => {
  for (const contract of m.contracts)
    assert.equal(
      canonicalAbiHash(
        JSON.parse(
          readFileSync(
            new URL("../../dist/" + contract.abiPath, import.meta.url),
            "utf8",
          ),
        ),
      ),
      contract.abiHash,
    );
});
test("amount validation rejects rounding, zero, exponent, negative and oversized values", () => {
  assert.equal(parseAmount(".0005"), 500000000000000n);
  assert.equal(parseAmount("1.000001", 6), 1000001n);
  for (const value of [
    "0",
    "-1",
    "1e3",
    "Infinity",
    "1,000",
    "0.0000000000000000001",
    "340282366920938463464",
  ])
    assert.throws(() => parseAmount(value));
});
test("slippage uses integer rounding toward a protected output", () => {
  assert.equal(slippageBps("0.5"), 50n);
  assert.equal(minimumOutput(123456n, 50n), 122838n);
  for (const s of ["0", "5.01", "0.111", "-1", "NaN"])
    assert.throws(() => slippageBps(s));
  assert.throws(() => minimumOutput(1n, 50n));
});
for (const buy of [true, false])
  for (const extended of [true, false])
    test(`${buy ? "Buy" : "Sell"} encoding (${extended ? "Robinhood six-field" : "standard five-field"}) preserves all amounts, pool fields and buyer`, () => {
      const built = buildSwap(
        pool,
        buy,
        500000000000000n,
        123456n,
        buyer,
        extended,
        9999999999n,
      );
      assert.equal(built.commands, "0x10");
      assert.equal(built.deadline, 9999999999n);
      assert.equal(built.value, buy ? 500000000000000n : 0n);
      const [actions, params] = decodeAbiParameters(
        [{ type: "bytes" }, { type: "bytes[]" }],
        built.inputs[0],
      );
      assert.equal(actions, "0x060c0f");
      assert.equal(params.length, 3);
      const components = [
        { name: "poolKey", type: "tuple", components: poolComponents },
        { name: "zeroForOne", type: "bool" },
        { name: "amountIn", type: "uint128" },
        { name: "amountOutMinimum", type: "uint128" },
        ...(extended ? [{ name: "minHopPriceX36", type: "uint256" }] : []),
        { name: "hookData", type: "bytes" },
      ] as const;
      const [decoded] = decodeAbiParameters(
        [{ type: "tuple", components }],
        params[0],
      ) as unknown as [
        {
          poolKey: PoolKey;
          zeroForOne: boolean;
          amountIn: bigint;
          amountOutMinimum: bigint;
          minHopPriceX36?: bigint;
          hookData: `0x${string}`;
        },
      ];
      assert.equal(decoded.poolKey.currency0.toLowerCase(), pool.currency0);
      assert.equal(decoded.poolKey.currency1.toLowerCase(), pool.currency1);
      assert.equal(decoded.poolKey.hooks.toLowerCase(), pool.hooks);
      assert.equal(decoded.poolKey.fee, pool.fee);
      assert.equal(decoded.poolKey.tickSpacing, pool.tickSpacing);
      assert.equal(decoded.zeroForOne, buy);
      assert.equal(decoded.amountIn, 500000000000000n);
      assert.equal(decoded.amountOutMinimum, 123456n);
      if (extended) assert.equal(decoded.minHopPriceX36, 0n);
      assert.equal(decoded.hookData, buyerData(buyer));
      assert.equal(decoded.hookData.length, 66);
      const settle = decodeAbiParameters(
        [{ type: "address" }, { type: "uint256" }],
        params[1],
      );
      const take = decodeAbiParameters(
        [{ type: "address" }, { type: "uint256" }],
        params[2],
      );
      assert.equal(settle[0].toLowerCase(), buy ? zeroAddress : token.address);
      assert.equal(settle[1], 500000000000000n);
      assert.equal(take[0].toLowerCase(), buy ? token.address : zeroAddress);
      assert.equal(take[1], 123456n);
    });
test("countdown respects strictly-greater-than expiry and no-leader state", () => {
  assert.equal(timeLeft(100n, buyer, 99), 1);
  assert.equal(timeLeft(100n, buyer, 100), 1);
  assert.equal(timeLeft(100n, buyer, 101), 0);
  assert.equal(timeLeft(100n, zeroAddress, 99), 0);
});
test("4902 uses exact wallet_addEthereumChain handoff then switches again", async () => {
  const calls: { method: string; params?: unknown }[] = [];
  let first = true;
  const provider = {
    request: async (a: { method: string; params?: unknown }) => {
      calls.push(a);
      if (a.method === "wallet_switchEthereumChain" && first) {
        first = false;
        throw { code: 4902 };
      }
      return a.method === "eth_chainId" ? "0x1237" : null;
    },
  } as EIP1193Provider;
  await switchToDeployment(provider, m);
  assert.deepEqual(
    calls.map((c) => c.method),
    [
      "wallet_switchEthereumChain",
      "wallet_addEthereumChain",
      "wallet_switchEthereumChain",
      "eth_chainId",
    ],
  );
  assert.deepEqual(calls[1].params, [m.walletAddChain]);
});
test("a rejected switch does not try adding a chain", async () => {
  let count = 0;
  await assert.rejects(
    switchToDeployment(
      {
        request: async () => {
          count++;
          throw { code: 4001 };
        },
      } as unknown as EIP1193Provider,
      m,
    ),
  );
  assert.equal(count, 1);
});
test("wallet and hook reverts become actionable messages", () => {
  assert.match(explainError({ code: 4001 }), /declined/);
  assert.match(explainError({ message: "RoundNotOver" }), /next block/);
  assert.match(explainError({ message: "NothingToClaim" }), /No payout/);
});
test("four phone links preserve this page and never request a relay id", () => {
  const url = "https://gateway.example/ipfs/test/#trade";
  assert.equal(OPEN_IN.length, 4);
  for (const entry of OPEN_IN)
    assert(
      entry.href(url).includes(encodeURIComponent(url)) ||
        entry.href(url).includes(url.replace("https://", "")),
    );
});
