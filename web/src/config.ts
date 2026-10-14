import { createConfig } from "wagmi";
import { injected } from "wagmi/connectors/injected";
import { coinbaseWallet } from "wagmi/connectors/coinbaseWallet";
import {
  createPublicClient,
  defineChain,
  fallback,
  http,
  keccak256,
  toBytes,
  isAddress,
  encodeAbiParameters,
  zeroAddress,
  type Abi,
  type Address,
} from "viem";
import legacy from "./launch-parameters.json";

export type PoolKey = {
  currency0: Address;
  currency1: Address;
  fee: number;
  tickSpacing: number;
  hooks: Address;
};
export type Deployment = {
  version: 1;
  launchId: string;
  chainId: number;
  sourceCommit: string;
  attestationHash: string;
  contracts: {
    name: string;
    address: Address;
    abiHash: string;
    abiPath: string;
  }[];
  assets: { path: string; sha256: string }[];
  poolKey?: PoolKey;
  network: {
    chainId: number;
    name: string;
    testnet: boolean;
    rpcUrls: string[];
    explorer: string;
    nativeCurrency: { name: string; symbol: string; decimals: number };
    uniswapV4: {
      poolManager: Address;
      universalRouter: Address;
      quoter: Address;
      stateView: Address;
      positionManager: Address;
      permit2: Address;
      extendedSwapParams?: boolean;
    };
  };
  walletAddChain?: {
    chainId: string;
    chainName: string;
    rpcUrls: string[];
    nativeCurrency: { name: string; symbol: string; decimals: number };
    blockExplorerUrls: string[];
  };
};
export const poolComponents = [
  { name: "currency0", type: "address" },
  { name: "currency1", type: "address" },
  { name: "fee", type: "uint24" },
  { name: "tickSpacing", type: "int24" },
  { name: "hooks", type: "address" },
] as const;
export const canonical = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((k) => [k, canonical((value as Record<string, unknown>)[k])]),
        )
      : value;
export const canonicalAbiHash = (abi: unknown) =>
  keccak256(toBytes(JSON.stringify(canonical(abi)))).slice(2);
const safePath = (path: string) =>
  /^[a-zA-Z0-9_./-]+$/.test(path) &&
  !path.startsWith("/") &&
  !path.split("/").includes("..");
async function json(path: string) {
  const response = await fetch(new URL(path, document.baseURI), {
    cache: "no-cache",
  });
  if (!response.ok)
    throw Error(`Cannot load ${path}. Reload this page to try again.`);
  return response.json();
}
export async function loadRuntime() {
  const deployment = (await json("./imd-deployment.json")) as Deployment;
  if (
    deployment.version !== 1 ||
    !deployment.network ||
    deployment.chainId !== deployment.network.chainId ||
    !deployment.network.rpcUrls.length
  )
    throw Error("Deployment configuration is invalid. Trading is unavailable.");
  const getContract = async (name: string) => {
    const found = deployment.contracts.find((c) => c.name === name);
    if (!found || !isAddress(found.address) || !safePath(found.abiPath))
      throw Error(`Invalid deployment for ${name}.`);
    const abi = (await json(found.abiPath)) as Abi;
    if (!Array.isArray(abi) || canonicalAbiHash(abi) !== found.abiHash)
      throw Error(
        `The ${name} interface failed its integrity check. Trading is unavailable.`,
      );
    return { ...found, abi };
  };
  const [token, hook] = await Promise.all([
    getContract("RektdToken"),
    getContract("RektJackpotHook"),
  ]);
  const n = deployment.network;
  for (const address of Object.values(n.uniswapV4).filter(
    (v) => typeof v === "string",
  ))
    if (!isAddress(address as string))
      throw Error("Invalid network contract address.");
  const chain = defineChain({
    id: deployment.chainId,
    name: n.name,
    nativeCurrency: n.nativeCurrency,
    rpcUrls: { default: { http: n.rpcUrls } },
    blockExplorers: {
      default: { name: `${n.name} explorer`, url: n.explorer },
    },
    testnet: n.testnet,
  });
  const transport = () =>
    fallback(
      n.rpcUrls.map((url) =>
        http(url, { batch: { wait: 25 }, timeout: 8000, retryCount: 0 }),
      ),
      { retryCount: 0 },
    );
  const publicClient = createPublicClient({
    chain,
    transport: transport(),
    pollingInterval: 5000,
  });
  const walletConfig = createConfig({
    chains: [chain],
    multiInjectedProviderDiscovery: true,
    connectors: [
      injected(),
      coinbaseWallet({
        appName: "REKTD Arena",
        appLogoUrl: new URL("./favicon.svg", document.baseURI).href,
      }),
    ],
    transports: { [chain.id]: transport() },
  });
  const paired = legacy.pairedCurrency as Address;
  const currencies = [paired, token.address].sort((a, b) =>
    a.toLowerCase().localeCompare(b.toLowerCase()),
  );
  const poolKey: PoolKey = deployment.poolKey ?? {
    currency0: currencies[0],
    currency1: currencies[1],
    fee: legacy.fee,
    tickSpacing: legacy.tickSpacing,
    hooks: hook.address,
  };
  if (
    poolKey.currency0.toLowerCase() !== zeroAddress ||
    poolKey.currency1.toLowerCase() !== token.address.toLowerCase() ||
    poolKey.hooks.toLowerCase() !== hook.address.toLowerCase()
  )
    throw Error("This arena requires the deployed REKTD/native ETH pool.");
  const poolId = keccak256(
    encodeAbiParameters(
      [{ type: "tuple", components: poolComponents }],
      [poolKey],
    ),
  );
  return {
    deployment,
    token,
    hook,
    chain,
    publicClient,
    walletConfig,
    poolKey,
    poolId,
    deploymentBlock: BigInt(legacy.deploymentBlock),
  };
}
export type Runtime = Awaited<ReturnType<typeof loadRuntime>>;
