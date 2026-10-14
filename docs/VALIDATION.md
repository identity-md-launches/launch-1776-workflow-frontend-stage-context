# REKTD frontend validation

Validated on 14 October 2026 with Node 24.21.0 and npm 11.19.0. The deliverable is the frontend under `web/`, the complete static export under `dist/`, and these documents. Deployed Solidity, ABIs in the pinned source commit, root configuration, dependency libraries and launch economics were preserved. No real transaction, deployment, publication or IPFS naming operation was performed.

## Build and deployment integrity

| Check | Result |
| --- | --- |
| `npm --prefix web run typecheck` | Passed, no TypeScript diagnostics |
| `npm --prefix web run test` | 12 passed, 0 failed |
| `npm --prefix web run build` | Passed; Vite production export, then manifest generation and verification |
| `npm --prefix web run verify` | Exact handoff/schema/network binding, all ABI and asset hashes, paths and size limits passed |
| Pinned implementation ABIs | Both raw JSON arrays read with `git show` from the deployed commit; working exports match and canonical Keccak hashes match the handoff |
| Runtime configuration | App fetches `imd-deployment.json` and its ABI files from the hosting subpath; no independent deployed address/chain/RPC map in components |
| Static hosting | Served and exercised at `/arena/` with relative asset paths and anchor navigation |
| Export inventory | 20 assets plus the manifest; asset bytes 1,086,491 before the manifest, comfortably below the HTTP budget |

The final inventory and manifest digest are recorded in [artifact-checks.json](validation/artifact-checks.json). The manifest excludes itself and includes HTML, JavaScript, CSS, both ABIs, both fonts, the favicon, share PNG, wallet marks and license notices. There are no source maps, registry mirrors, dependency archives, caches or `node_modules` in the submission. `web/.gitignore` is the only new ignore file and has an explicit assignment allowance.

This older handoff has **no `poolKey`**. No such key was added to the manifest. The application derives the legacy native-ETH pool key from the supplied fee/tick spacing and runtime token/hook addresses, and compares its hash with the live hook. If a handoff includes a key, the generator copies it unchanged and runtime uses it. The copied `network` and `walletAddChain` objects match the supplied input exactly.

## Interaction validation

`PLAYWRIGHT_BROWSERS_PATH=/tmp/rektd-browsers PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=1 npm --prefix web run test:browser` passed **27 scenarios** with zero failed assertions. [Full results and viewport measurements](validation/browser-tests.json) are committed. This suite serves the actual export, mocks all wallet and RPC requests, and closes its temporary server and browsers. No test can broadcast to the live chain.

Coverage includes:

- Disconnected reads and disabled actions; EIP-6963 wallet selection; rejected connection; account changes; wrong-chain rejection; exact 4902 add-chain parameters followed by switching again.
- Live-derived minimum preset, slippage/amount validation, gas-reserved native Max and large balances. No horizontal overflow at 320, 390, 760 or 1440 pixels, including full addresses and unusually long values.
- Buy review, frozen quote expiry, correct buyer hook data, exact Robinhood six-field swap tuple, commands/actions/settlement values, simulation before signing, pending action lock and receipt confirmation.
- Separate sell token-to-Permit2 and Permit2-to-router approvals, exact amounts/expiry/addresses, then a simulated swap with zero ETH value.
- Rejected wallet send, quote failure, simulated revert, reverted receipt, missing contract code, wrong RPC chain, unavailable RPC, stale chain timestamp, and correct-chain wallet read fallback.
- Settlement, payout claim, creator fee claim and parked-payout recovery gates/calls; owner fee recipient validation/review; ownership transfer and typed renunciation, with confirmation still visible after owner access disappears.
- Wallet sheet keyboard containment, Escape and focus restoration; all four phone wallet-browser links and Coinbase Smart Wallet choice; tampered ABI startup rejection.
- Chromium and WebKit mobile rendering; WebKit wallet connection and simulated buy through confirmation. Zero application script exceptions or missing local resources in the mocked suite.

Playwright and its browser binaries are development tools only. WebKit needed additional shared libraries on this restricted worker. They were extracted under `/tmp` and linked into its temporary browser runtime. The host-validation environment flag skips Playwright's global-library-cache probe; WebKit itself launched and executed the assertions. No system configuration or repository dependency vendor directory was changed.

Unit tests independently decode standard and Robinhood swap tuples in both directions, check integer slippage/amount boundaries, canonical ABI hashing, strict countdown expiry, chain switching, readable errors and the exact current-page payload of phone links.

## Read-only live-chain observations

[live-rpc.json](validation/live-rpc.json) records the public RPC check at 19:52 UTC:

- Chain ID 4663, nonempty code at both application contracts and PoolManager, UniversalRouter, V4Quoter and Permit2.
- Initialized pool; live pool ID, launch token and PoolManager match the derived deployment. Owner and creator recipient are configured.
- Round zero, no leader, zero jackpot, and a 0.0005 ETH minimum ticket at that time. The site displays this state honestly, without fabricated history or prize values.
- A simulated 0.0005 ETH buy quote returned 48,800.043433817201622058 REKTD and a quoter gas estimate of 195,811. This is a historical observation, not a promised fill.
- A 1 REKTD sell quote reverted with selector `0x6190b2b0`. The report retains that result; a successful live sell is **not** claimed. The UI disables signing when quoting fails and presents a recoverable error.

Manual browser-tool inspection also loaded real state and the buy quote at the gateway-style preview. All requested local resources loaded. The first public RPC intermittently returned HTTP 403 for a history request; the configured second RPC returned 200 and history recovered. This external RPC error is distinct from the zero app-script/local-resource failures. Runtime fallback remains in place and unavailable reads disable transactions.

Nonempty bytecode and matching reads do not independently attest runtime bytecode against creation-code hashes. Real wallet signatures, token approvals, filled trades, recipient ETH acceptance, payouts, parked-fund recycling, mempool behavior and gas costs were not tested with real funds. Physical wallet apps, hardware wallets, real Coinbase passkey setup and real smart-account execution remain untested. Receipt timeout/replacement handling is implemented and source-reviewed; exhaustive replacement/cancellation scenarios are not part of the browser suite. Publication/CID/named-entrypoint checks belong to the subsequent control-plane stage.

## Better Interface review

The pinned Better Interface workflow, core principles of all six domains, and supporting guidance for forms, dialogs, numbers, responsive layout and design documentation were applied during implementation and reviewed against the final source. The pinned design-critic probe was run from the root:

```sh
PLAYWRIGHT_BROWSERS_PATH=/tmp/rektd-browsers \
IMD_PLAYWRIGHT="$PWD/web/node_modules/playwright/index.mjs" \
node .imd/reads/skills/design-critic/scripts/taste.mjs --out test/scratch/taste
```

[taste.json](validation/taste.json) preserves the results with the local target normalized to `dist/`: **15 of 16 checks pass**. The sole failed `eyebrows` check identifies the header **Connect wallet button** as a kicker label above the main heading at 390px. Manual inspection confirms it is a functional wallet control with its own boundary, not a decorative label. It stays in the header as required by the brief and by the guide's wallet convention. The raw failed check has not been suppressed or reported as a pass.

| Domain | Source and rendered coverage | Result / limitation |
| --- | --- | --- |
| Accessibility | Semantic page/heading order, labels, named icon buttons, text status, dialog focus, keyboard-only operation, disabled prerequisites, reduced motion, forced-color CSS; Axe and target probe | Zero Axe violations. Final Axe incomplete items are retained in [axe.json](validation/axe.json); color/gradient checks are not a full accessibility certification. Physical screen reader and browser-native 200%/400% zoom were not exercised. |
| Layout | Mobile-first action placement, zero-min-width grid children, long values, mobile sheet, address wrapping; screenshots and measured boxes at 320/390/760/1440 | Main action bottom is 807.73px in a 390×844 viewport, with product, jackpot, countdown and header wallet visible. No sideways scrolling, text overlap, floating overlap or clipped text in the probe. |
| Writing | Five-word heading, one plain product line, contextual transaction descriptions, concrete verbs, distinct loading/empty/failure states, exact recipients and irreversible-action review | Probe found no slogans, duplicate prose or content capitals; first-screen prose 13 words mobile and 28 desktop. No USD price is invented. |
| Typography | Two local font families, six tokens maximum, three weights, heaviest main heading, tabular financial values, ordinary tracking | Probe confirms two families, weights 400/600/800, five sizes mobile including timer and six desktop. No text is ellipsized to conceal long values. |
| Colors | Requested obsidian/emerald/crimson palette, lighter small error text, status words as well as colors, visible focus | All rendered solid-background text measured by the probe passed. It skipped 92 gradient/background boxes. Supplemental [CSS-token calculations](validation/contrast.json) pass: muted round text ≥6.64:1, large crimson clock ≥4.35:1, primary button 14.98:1. These calculations are not pixel-by-pixel gradient/opacity measurements. |
| UI | Main trade task, amount presets, explicit approvals, review dialogs, per-action feedback, receipt locks, progress and stale states, history ranges, owner disclosure | All 27 measured controls meet the 24px-or-spacing rule; 19 are below the optional 44px comfortable size. Primary actions are 48px, presets 36px, header wallet 40px and wallet-choice rows at least 48px. All primary flows were exercised with mocks. |

### Findings and fixes

Locations refer to the final source, where the correction can be inspected.

| Finding | Fix and evidence |
| --- | --- |
| High: mobile jackpot detail pushed trading below the first screen | `web/src/styles.css:1742` compacts the mobile jackpot and moves its full split after trading; `web/src/App.tsx:207` retains the desktop breakdown. Final 390px measurement is 807.73px. |
| Medium: keyboard Tab could leave the wallet dialog | `web/src/Wallet.tsx:122` explicitly loops focus within visible controls; Escape and focus return pass in browser tests. |
| Medium: chain and stale-data conditions need to block wallet prompts | `web/src/App.tsx:34`, `web/src/data.tsx:326` and `web/src/Trade.tsx:186` gate submission and recheck chain/account before signing. Mocked outage, stale chain, tampered ABI, wrong-chain and expired-review cases pass. |
| Medium: a confirmed ownership change removed its own feedback | `web/src/Operations.tsx:379` retains feedback outside the owner panel when access changes; transfer and renunciation browser tests pass. |
| Low: repeated round/rule kicker treatments and nested amount-card chrome added noise | Round tag styling at `web/src/styles.css:367` uses ordinary text; rules use direct headings; amount entry uses the baseline treatment at `web/src/styles.css:1782`. Final repetition, chrome and typography checks pass. |
| Low: amount presets had an accessible label without a grouping role | `web/src/Trade.tsx:316` now uses `role="group"`; final Axe run has no ARIA incomplete item. |
| Disputed probe classification: header wallet button reported as an eyebrow | `web/src/App.tsx:93` / `web/src/Wallet.tsx` preserve the functional header control. Screenshot confirms it is not heading decoration. Raw result retained. |

### Visual evidence

- [Live mobile, 390×844](validation/arena-mobile-live.png) and [live desktop, 1440×1000](validation/arena-desktop-live.png) show actual zero-round state and a real quote.
- [Mocked desktop](validation/arena-desktop-mocked.png), [mocked connected mobile](validation/arena-mobile-mocked.png) and [mocked wallet sheet](validation/wallet-mobile.png) exercise populated states. These images do not represent live balances or activity.

The implemented tokens, type, components and responsive rules are documented in [DESIGN.md](DESIGN.md). It is intentionally under `docs/`: the assignment's overriding path budget prohibits creating repository-root `DESIGN.md`, despite the lower acceptance bullet requesting that location. No root file was created to evade the path check.

Relative Open Graph URLs are pending a publisher-assigned origin; the title, favicon, description, `og:title`, local 1200×630 share image and `og:image` are present and verified. The application is dark-only as commissioned. No claims of physical-device testing, exhaustive assistive-technology testing or completed publication are made.
