# REKTD arena frontend

A static React/TypeScript dashboard for the deployed REKTD/native ETH jackpot pool on Robinhood Chain. It trades through the chain-table UniversalRouter and V4Quoter, displays live jackpot state, and exposes settlement, claims, parked-payout recovery and owner controls. There is no backend, signer, price oracle, custom router, WalletConnect relay or project ID.

## Install, build, preview

Use Node 22.12+ (validated with Node 24) and npm. From the repository root:

```sh
npm --prefix web ci
npm --prefix web run typecheck
npm --prefix web run build
npm --prefix web run verify
npm --prefix web run preview
```

If your normal npm cache is not writable, add `--cache /tmp/rektd-npm-cache` to `npm ci`. All package manifests, the lockfile and Vite/TypeScript configuration are under `web/`. Dependencies remain uncommitted. `web/.gitignore` is the only ignore-file change and is explicitly within the assignment's path budget; it excludes dependency/cache/test-output directories at every nesting level.

`npm --prefix web run dev` builds the deployment artifacts first and starts Vite. The development middleware serves the **same** `dist/imd-deployment.json`; it does not create a second runtime address map. Restart development after changing deployment inputs. Production preview serves the committed `dist/` unchanged. Vite uses `base: './'`. Navigation uses anchors, so gateway subpaths need no server rewrites. Serve with HTTP(S), not `file://`.

The publisher hosts the existing export; rebuilding is not necessary to publish. This worker does not deploy contracts, publish a site, name an IPFS entrypoint or require a hosted URL/CID.

## Deployment and ABI binding

- `web/config/deployment-handoff.json` and `web/config/network.json` preserve the supplied build inputs. Neither is bundled as an independent application configuration.
- `scripts/prepare.mjs` reads `docs/abi/<Contract>.json` from **deployed commit `2c3fa8ceac98516fa7bd67dea3a9bb63582b1670`** with `git show`, compares the working exports with that commit, and checks canonical Keccak hashes. Canonicalization recursively sorts object keys, preserves array order, and uses compact JSON. It copies the raw ABI arrays into `web/public/abi/`.
- `scripts/manifest.mjs` runs after Vite. It emits `dist/imd-deployment.json` with the handoff's exact identifiers, addresses, ABI hashes and contract set, and unchanged `network`/`walletAddChain` blocks. It inventories every other exported file, including fonts, icons, license notices, share image, HTML and ABI JSON, with lowercase SHA-256 hashes. It excludes itself.
- `scripts/verify.mjs` validates exact schema, handoff binding, every ABI hash, every asset hash, relative paths and export limits. Run it after any export edit; preferably always rebuild instead of editing `dist/`.
- At runtime, `src/config.ts` fetches this manifest and its referenced ABIs, verifies the canonical ABI hashes, and constructs the chain and wallet configuration. No deployed address, public RPC URL or chain ID is independently embedded in the app code.

**Legacy handoff:** this handoff does not contain `poolKey`. The build therefore does not invent that top-level manifest key. `src/launch-parameters.json` is generated from its pool terms and deployment blocks: native ETH, fee 12500 and tick spacing 60. Runtime token/hook addresses still come exclusively from the manifest. The app derives the ordered key, hashes it, and checks it against the hook's live `poolId`, `poolManager`, `launchToken` and `poolInitialized`. A future handoff that includes `poolKey` is copied exactly and used instead. The initial launch price is never treated as a current market price.

The application verifies RPC chain ID, nonempty code for both application contracts and the required swap contracts, token metadata and pool identity before enabling transactions. This proves those checks passed; it is not an independent audit or a runtime-code attestation. The handoff contains creation-code hashes, not a runtime-code hash comparison target.

## Wallets, reads and trading

The header's wallet sheet uses wagmi EIP-6963 discovery, names and icons for installed wallets, generic browser-wallet fallback, and Coinbase Wallet/Smart Wallet through its SDK. On a phone without an injected wallet it also offers links to open the same page in MetaMask, Coinbase Wallet, Rabby and Phantom. No relay credentials are needed. Wrong-chain wallets get one switch control. Unknown-chain error 4902 triggers the exact `wallet_addEthereumChain` parameters, then another switch.

Reads prefer the supplied public RPCs with fallback. A connected wallet on the correct chain is an additional read transport; every wallet-fallback request checks its chain. The connect control works even before RPC verification. State is read at one block every five seconds; stale/error states disable writes. Browser-hidden polling follows React Query's default pause behavior. A one-second countdown estimates time from the last block; only the contract's `roundExpired` read enables settlement. Clock expiry is strictly `block.timestamp > roundEndTime`.

The page shows:

- Jackpot, exact integer split, leader, dynamic minimum ticket, round countdown, lifetime burns/prizes/fees and wallet ETH/REKTD balances.
- Live net-output quotes and rate, 0.1–5% editable slippage, minimum received, 1.25% LP fee plus 1% ETH-side hook fee, and separate network gas.
- Buy presets for the **live** minimum ticket, 0.001 ETH, 0.005 ETH and Max. The default amount is the 0.0005 ETH floor, not a guarantee of eligibility. Sell offers balance percentages and Max. Native Max conservatively reserves at least 400,000 gas at twice the current gas price; the wallet determines actual gas. Full-precision amounts appear in review.
- Settled-round events paginated in 20,000-block windows, split into at most four 5,000-block requests. The scanned range is always shown. Empty ranges and failed event reads are distinguished. History values are allocations, not claims that funds were delivered.

Quotes call `simulateContract(quoteExactInputSingle)` and never send a transaction. They refresh every 15 seconds and expire after 30 seconds. A review freezes the amount, output, minimum, account and quote time; expiry or account/chain changes prevent confirmation. The connected account is ABI-encoded as 32-byte `hookData` for quote and swap, including smart wallets. Disconnected quoting uses empty hook data.

Native-ETH buys need no approval. Selling REKTD has separate, fresh-allowance-driven steps:

1. ERC-20 `approve(permit2, exactAmount)` only if necessary.
2. Permit2 `approve(token, universalRouter, exactAmount, expiration)` only if necessary, with a 30-minute expiration.
3. Review and simulate the router transaction before requesting a signature.

Router commands are `0x10`; the nested actions are `0x060c0f`. Parameters encode the exact-input swap, `SETTLE_ALL` and `TAKE_ALL`. `network.uniswapV4.extendedSwapParams` selects Robinhood's six-field tuple, including the zero `uint256 minHopPriceX36` before `hookData`. The ETH value is exactly the buy input, and zero on sells. Minimum output is integer-rounded down from the live quote after slippage. Deadlines are five minutes. All protocol addresses are read from `network.uniswapV4`.

Each action has its own status. An immediate shared lock prevents overlapping submissions, while the initiating control reports simulation, wallet prompt and pending receipt. Allowance reads refresh before another approval/action can proceed. A rejected request returns to idle. An unknown receipt remains blocked with an explorer link and a confirmation retry control. Confirmed reverts are failures, not successes. Raw exception dumps are not shown.

## Contract controls

| Control | Prerequisite and destination |
| --- | --- |
| Buy / sell | Correct wallet chain, verified deployment, fresh reads, usable quote, balance and approvals |
| Settle round | Live `roundExpired`; anyone pays gas, recorded leader and burn recipient receive allocations |
| Claim payout | Valid recipient with positive `unclaimedPayout`; anyone may deliver to that recipient |
| Claim creator fees | Positive `pendingCreatorFees`; sent to the live `creatorFeeRecipient` |
| Recover parked payout | Positive parked claim after on-chain `PARK_GRACE_PERIOD`; retries delivery, then recycles rejected ETH |
| Update fee recipient | Live owner only; explicit address review explains redirection of already-pending fees |
| Transfer ownership | Live owner only; validates nonzero address and reviews immediate transfer |
| Renounce ownership | Live owner only; explicit typed confirmation and irreversible-action review |

The deployed owner and creator recipient are already configured. No stand-in addresses or setup transactions are needed. Hook callbacks and `unlockCallback` are protocol entrypoints, not wallet actions. ERC-20 approvals are exposed through the sell flow; arbitrary `transferFrom` and hook callbacks are intentionally not presented as product actions.

## Validation

```sh
npm --prefix web run typecheck
npm --prefix web run test
npm --prefix web run build
npm --prefix web run verify
npm --prefix web run check:rpc
npm --prefix web exec -- playwright install chromium webkit
npm --prefix web run test:browser
```

The browser suite manages its own temporary HTTP server, serves the production export under `/arena/`, mocks every wallet/RPC call and closes the server/browser afterward. Tests cannot send a real transaction. It writes evidence to `docs/validation/`. Playwright browsers/system libraries are development tooling, never runtime assets or Git content. On a restricted worker, browser caches can live under `/tmp` via `PLAYWRIGHT_BROWSERS_PATH`; ordinary development machines can use their normal Playwright installation.

The pinned design probe was also run from the root with `--out test/scratch/taste`; it is an assignment input and is not redistributed. See [validation](../docs/VALIDATION.md) for actual results, findings, corrections and remaining limitations, [design system](../docs/DESIGN.md) for source-derived tokens/components, and [third-party notices](../docs/THIRD_PARTY.md) for provenance.

No USD value is invented: the launch supplies no oracle. Relative Open Graph assets are intentional until the publisher assigns the hosting address. Physical mobile apps, real passkey creation, real swaps/approvals/payouts and publication/control-plane checks are not claimed as tested.
