import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { keccak256, toBytes } from "viem";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
export const root = fileURLToPath(new URL("../../", import.meta.url));
export const web = resolve(root, "web");
export const dist = resolve(root, "dist");
export const readJson = async (path) =>
  JSON.parse(await readFile(path, "utf8"));
export const handoff = await readJson(
  resolve(web, "config/deployment-handoff.json"),
);
export const networkInput = await readJson(resolve(web, "config/network.json"));
export const canonical = (value) =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, canonical(value[key])]),
        )
      : value;
export const abiHash = (abi) =>
  keccak256(toBytes(JSON.stringify(canonical(abi)))).slice(2);
export const sha256 = (bytes) =>
  createHash("sha256").update(bytes).digest("hex");
export async function files(dir, prefix = "") {
  const output = [];
  for (const item of await readdir(dir, { withFileTypes: true })) {
    if (item.isSymbolicLink()) throw Error(`Symlink refused: ${item.name}`);
    const name = prefix + item.name;
    if (item.isDirectory())
      output.push(...(await files(resolve(dir, item.name), name + "/")));
    else output.push(name);
  }
  return output.sort();
}
