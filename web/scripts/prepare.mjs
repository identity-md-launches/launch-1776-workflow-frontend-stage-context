import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { root, web, handoff, abiHash } from "./lib.mjs";
await mkdir(resolve(web, "public/abi"), { recursive: true });
for (const contract of handoff.contracts) {
  const path = `docs/abi/${contract.name}.json`;
  const pinned = execFileSync(
    "git",
    ["show", `${handoff.sourceCommit}:${path}`],
    { cwd: root, encoding: "utf8" },
  );
  const local = await readFile(resolve(root, path), "utf8");
  if (pinned !== local)
    throw Error(`${path} differs from deployed source commit`);
  const abi = JSON.parse(pinned);
  if (!Array.isArray(abi) || abiHash(abi) !== contract.abiHash)
    throw Error(`ABI hash mismatch: ${contract.name}`);
  await writeFile(resolve(web, `public/abi/${contract.name}.json`), pinned);
  console.log(`Verified pinned ABI: ${contract.name} ${contract.abiHash}`);
}
// Legacy handoffs omit poolKey. Only the non-contract launch terms are compiled;
// every deployed contract and network address is still loaded from the runtime manifest.
const parameters = {
  fee: handoff.manifest.pool.fee,
  tickSpacing: handoff.manifest.pool.tickSpacing,
  pairedCurrency: handoff.manifest.pool.pairedCurrency,
  deploymentBlock: Math.min(...handoff.contracts.map((c) => c.blockNumber)),
};
await writeFile(
  resolve(web, "src/launch-parameters.json"),
  JSON.stringify(parameters, null, 2) + "\n",
);
