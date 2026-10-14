import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { dist, handoff, networkInput, files, sha256 } from "./lib.mjs";
const manifest = {
  version: 1,
  launchId: handoff.launchId,
  chainId: handoff.chainId,
  sourceCommit: handoff.sourceCommit,
  attestationHash: handoff.attestationHash,
  contracts: handoff.contracts.map(({ name, address, abiHash }) => ({
    name,
    address,
    abiHash,
    abiPath: `abi/${name}.json`,
  })),
  assets: [],
  ...(handoff.poolKey ? { poolKey: handoff.poolKey } : {}),
  network: networkInput.network,
  ...(networkInput.walletAddChain
    ? { walletAddChain: networkInput.walletAddChain }
    : {}),
};
for (const path of await files(dist)) {
  if (path === "imd-deployment.json") continue;
  const bytes = await readFile(resolve(dist, path));
  if (bytes.length > 8388608) throw Error(`Asset too large: ${path}`);
  manifest.assets.push({ path, sha256: sha256(bytes) });
}
if (manifest.assets.length > 128) throw Error("Too many assets");
await writeFile(
  resolve(dist, "imd-deployment.json"),
  JSON.stringify(manifest, null, 2) + "\n",
);
await import("./verify.mjs");
