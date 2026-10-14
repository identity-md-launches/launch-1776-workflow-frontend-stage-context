import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  dist,
  handoff,
  networkInput,
  readJson,
  files,
  sha256,
  abiHash,
} from "./lib.mjs";
const m = await readJson(resolve(dist, "imd-deployment.json"));
const keys = [
  "version",
  "launchId",
  "chainId",
  "sourceCommit",
  "attestationHash",
  "contracts",
  "assets",
  "network",
  ...(networkInput.walletAddChain ? ["walletAddChain"] : []),
  ...(handoff.poolKey ? ["poolKey"] : []),
];
assert.deepEqual(Object.keys(m).sort(), keys.sort());
assert.equal(m.version, 1);
for (const key of ["launchId", "chainId", "sourceCommit", "attestationHash"])
  assert.equal(m[key], handoff[key]);
assert.deepEqual(m.network, networkInput.network);
assert.deepEqual(m.walletAddChain, networkInput.walletAddChain);
assert.deepEqual(m.poolKey, handoff.poolKey);
assert.equal(m.network.chainId, m.chainId);
assert.deepEqual(
  m.contracts,
  handoff.contracts.map(({ name, address, abiHash }) => ({
    name,
    address,
    abiHash,
    abiPath: `abi/${name}.json`,
  })),
);
const safePath = (p) =>
  /^[a-zA-Z0-9_./-]+$/.test(p) &&
  !p.startsWith("/") &&
  !p.split("/").includes("..");
for (const c of m.contracts) {
  assert(safePath(c.abiPath));
  const abi = await readJson(resolve(dist, c.abiPath));
  assert(Array.isArray(abi));
  assert.equal(abiHash(abi), c.abiHash);
}
assert(m.assets.length <= 128);
assert.deepEqual(
  m.assets.map((x) => x.path).sort(),
  (await files(dist)).filter((p) => p !== "imd-deployment.json"),
);
let bytes = 0;
for (const item of m.assets) {
  assert(safePath(item.path));
  assert.match(item.sha256, /^[a-f0-9]{64}$/);
  const data = await readFile(resolve(dist, item.path));
  assert(data.length <= 8388608);
  assert.equal(sha256(data), item.sha256, item.path);
  bytes += data.length;
}
assert(bytes < 32 * 1024 * 1024, "Export exceeds HTTP response budget");
console.log(
  JSON.stringify(
    {
      verified: true,
      contracts: m.contracts.length,
      assets: m.assets.length,
      exportBytes: bytes,
      sourceCommit: m.sourceCommit,
    },
    null,
    2,
  ),
);
