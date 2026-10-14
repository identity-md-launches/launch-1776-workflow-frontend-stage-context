import { execFileSync } from "node:child_process";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { web } from "./lib.mjs";
const paths = execFileSync(
  "npm",
  ["ls", "--omit=dev", "--all", "--parseable"],
  { cwd: web, encoding: "utf8" },
)
  .trim()
  .split("\n")
  .slice(1);
const seen = new Set();
let output =
  "REKTD frontend — third-party dependency notices\n\nThis records the installed production dependency tree. Some optional/type-only modules are not emitted into browser chunks. Wallet marks and font licenses also have individual notices in this directory.\n";
for (const entry of paths) {
  const path = resolve(web, entry.slice(entry.indexOf("/node_modules/") + 1));
  const pkg = JSON.parse(await readFile(resolve(path, "package.json"), "utf8"));
  if (seen.has(pkg.name + "@" + pkg.version)) continue;
  seen.add(pkg.name + "@" + pkg.version);
  const files = (await readdir(path)).filter((f) =>
    /^(licen[cs]e|copying|notice)(\.|$)/i.test(f),
  );
  output += `\n${"=".repeat(72)}\n${pkg.name}@${pkg.version} · ${pkg.license ?? "See package license"}\n${"=".repeat(72)}\n`;
  for (const name of files)
    output += `\n${name}\n${await readFile(resolve(path, name), "utf8")}\n`;
  if (!files.length)
    output += `License text: ${pkg.repository?.url ?? pkg.homepage ?? "Refer to the upstream package source."}\n`;
}
await writeFile(resolve(web, "public/licenses/ThirdPartyNotices.txt"), output);
console.log(`Recorded ${seen.size} dependency notices.`);
