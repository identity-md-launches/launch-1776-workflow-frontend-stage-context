import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { chromium, webkit } from "playwright";
import AxeBuilder from "@axe-core/playwright";
import {
  decodeFunctionData,
  decodeAbiParameters,
  encodeAbiParameters,
  getAddress,
} from "viem";
import {
  createMock,
  attachMock,
  manifest,
  account,
  otherAccount,
  routerAbi,
  permitAbi,
  tokenAbi,
  hookAbi,
  poolComponents,
} from "./mock-rpc.mjs";
const root = resolve(new URL("../../", import.meta.url).pathname);
const output = resolve(root, "docs/validation");
await mkdir(output, { recursive: true });
const types = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
};
const server = createServer(async (request, response) => {
  try {
    const path = decodeURIComponent(
      new URL(request.url, "http://localhost").pathname,
    );
    if (!path.startsWith("/arena/") || path.includes("..")) {
      response.writeHead(404).end();
      return;
    }
    const file = resolve(root, "dist", path.slice(7) || "index.html");
    response.writeHead(200, {
      "Content-Type": types[extname(file)] ?? "application/octet-stream",
    });
    response.end(await readFile(file));
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${server.address().port}/arena/`;
const report = {
  date: new Date().toISOString(),
  export: "dist/ at a gateway-style /arena/ subpath",
  mocks:
    "All wallet and RPC requests in this suite are mocked. No live transaction is possible.",
  checks: [],
  measurements: [],
  limitations: [],
};
let failures = 0;
async function check(name, fn) {
  try {
    await fn();
    report.checks.push({ name, passed: true });
    console.log("PASS", name);
  } catch (error) {
    failures++;
    report.checks.push({ name, passed: false, error: error.message });
    console.log("FAIL", name, error.message);
    throw error;
  }
}
async function enabled(locator) {
  await locator.waitFor();
  for (let i = 0; i < 100; i++) {
    if (await locator.isEnabled()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw Error("Control did not become enabled: " + (await locator.innerText()));
}
async function text(page, value) {
  await page
    .getByText(value, { exact: false })
    .first()
    .waitFor({ timeout: 12000 });
}
async function connect(page) {
  await page
    .getByRole("button", { name: "Connect wallet", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Arena test wallet", exact: true })
    .click();
  await enabled(page.getByRole("button", { name: "Review buy", exact: true }));
}
async function confirmed(page, id) {
  await page
    .locator(id)
    .getByText("Confirmed on chain.", { exact: true })
    .first()
    .waitFor({ timeout: 12000 });
}
async function measure(page, width, label) {
  await page.setViewportSize({ width, height: 844 });
  await page.evaluate(() => scrollTo(0, 0));
  const result = await page.evaluate(() => {
    const rect = document
      .querySelector(".trade-cta button")
      .getBoundingClientRect();
    return {
      width: innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      buttonBottom: rect.bottom,
      fonts: [...document.fonts]
        .filter((f) => f.status === "loaded")
        .map((f) => f.family),
    };
  });
  assert(
    result.documentWidth <= width,
    `Overflow ${result.documentWidth} > ${width}`,
  );
  if (width === 390)
    assert(
      result.buttonBottom <= 844,
      `Main action below fold: ${result.buttonBottom}`,
    );
  report.measurements.push({ label, ...result });
}
let browser;
try {
  browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  const mock = createMock();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const resources = [];
  page.on("response", (r) => {
    if (r.url().startsWith(url) && r.status() >= 400) resources.push(r.url());
  });
  await attachMock(page, mock);
  await page.goto(url);
  await text(page, "Live on-chain");
  await text(page, "45,000");
  await page.locator(".history-row").first().waitFor();
  await check(
    "Static gateway subpath, live reads and disabled disconnected action",
    async () => {
      assert(
        await page
          .getByRole("button", { name: "Review buy", exact: true })
          .isDisabled(),
      );
      assert.equal(errors.length, 0);
      assert.equal(resources.length, 0);
      assert(mock.requests.some((x) => x.method === "eth_getCode"));
      assert(mock.requests.some((x) => x.method === "eth_getLogs"));
    },
  );
  await check(
    "390 first screen, 320/760/1440 reflow and local fonts",
    async () => {
      for (const w of [390, 320, 760, 1440])
        await measure(page, w, "disconnected");
      await page.screenshot({
        path: resolve(output, "arena-desktop-mocked.png"),
        fullPage: false,
      });
      await measure(page, 390, "disconnected");
    },
  );
  await check(
    "Wallet modal keyboard containment, Escape and focus return",
    async () => {
      const button = page.getByRole("button", {
        name: "Connect wallet",
        exact: true,
      });
      await button.focus();
      await page.keyboard.press("Enter");
      await page.getByRole("dialog", { name: "Connect a wallet" }).waitFor();
      for (let i = 0; i < 7; i++) await page.keyboard.press("Tab");
      assert(
        await page.evaluate(() => !!document.activeElement.closest("dialog")),
      );
      await page.keyboard.press("Escape");
      assert(await button.evaluate((el) => el === document.activeElement));
    },
  );
  await check("Wallet rejection has a recoverable inline error", async () => {
    mock.state.rejectConnect = true;
    await page
      .getByRole("button", { name: "Connect wallet", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Arena test wallet", exact: true })
      .click();
    await text(page, "Request declined in your wallet");
    mock.state.rejectConnect = false;
    await page
      .getByRole("button", { name: "Arena test wallet", exact: true })
      .click();
    await enabled(
      page.getByRole("button", { name: "Review buy", exact: true }),
    );
    assert(
      !(await page
        .getByRole("button", { name: "Browser wallet", exact: true })
        .isVisible()),
    );
  });
  await check(
    "Wrong chain rejection, exact add-chain fallback, re-switch and action gate",
    async () => {
      mock.state.chainId = 1;
      mock.state.missingChain = true;
      mock.state.rejectSwitch = true;
      await page.evaluate(() => window.__emitWallet("chainChanged", "0x1"));
      const switchButton = page.getByRole("button", {
        name: "Switch to Robinhood Chain",
        exact: true,
      });
      await switchButton.waitFor();
      assert(
        await page
          .getByRole("button", { name: "Review buy", exact: true })
          .isDisabled(),
      );
      await switchButton.click();
      await text(page, "Request declined in your wallet");
      mock.state.rejectSwitch = false;
      await switchButton.click();
      await enabled(
        page.getByRole("button", { name: "Review buy", exact: true }),
      );
      const add = mock.walletCalls.find(
        (x) => x.method === "wallet_addEthereumChain",
      );
      assert.deepEqual(add.params, [manifest.walletAddChain]);
    },
  );
  await check(
    "Dynamic minimum preset, input/slippage validation and gas-reserved Max",
    async () => {
      await page
        .getByRole("button", { name: "Min ticket", exact: true })
        .click();
      assert.equal(await page.locator("#amount").inputValue(), "0.06");
      await page.locator("#amount").fill("-2");
      await text(page, "Enter a positive amount");
      assert(
        await page
          .getByRole("button", { name: "Review buy", exact: true })
          .isDisabled(),
      );
      await page.getByRole("button", { name: "0.001", exact: true }).click();
      await page.locator("#slippage").fill("100");
      await text(page, "Choose slippage");
      await page.locator("#slippage").fill("0.5");
      await enabled(page.getByRole("button", { name: "Max", exact: true }));
      await page.getByRole("button", { name: "Max", exact: true }).click();
      await page.waitForFunction(
        () => Number(document.querySelector("#amount").value) > 2,
      );
      assert(Number(await page.locator("#amount").inputValue()) < 3);
      await page.getByRole("button", { name: "0.001", exact: true }).click();
      await enabled(
        page.getByRole("button", { name: "Review buy", exact: true }),
      );
    },
  );
  await check(
    "Buy review, simulation before signing and pending lock through receipt",
    async () => {
      mock.state.receiptPending = true;
      await page
        .getByRole("button", { name: "Review buy", exact: true })
        .click();
      await text(page, "Wallet & ticket recipient");
      await page
        .getByRole("button", { name: "Confirm buy", exact: true })
        .click();
      await text(page, "Submitted. Waiting for on-chain confirmation");
      assert.equal(mock.sent.length, 1);
      assert(await page.locator(".trade-cta button").isDisabled());
      assert(mock.simulations.some((x) => x.fn === "execute"));
      assert.equal(
        mock.sent[0].to.toLowerCase(),
        manifest.network.uniswapV4.universalRouter,
      );
      const encoded = decodeFunctionData({
        abi: routerAbi,
        data: mock.sent[0].data,
      });
      assert.equal(encoded.args[0], "0x10");
      const [actions, params] = decodeAbiParameters(
        [{ type: "bytes" }, { type: "bytes[]" }],
        encoded.args[1][0],
      );
      assert.equal(actions, "0x060c0f");
      const [swap] = decodeAbiParameters(
        [
          {
            type: "tuple",
            components: [
              { name: "poolKey", type: "tuple", components: poolComponents },
              { name: "zeroForOne", type: "bool" },
              { name: "amountIn", type: "uint128" },
              { name: "amountOutMinimum", type: "uint128" },
              { name: "minHopPriceX36", type: "uint256" },
              { name: "hookData", type: "bytes" },
            ],
          },
        ],
        params[0],
      );
      assert.equal(swap.amountIn, 1000000000000000n);
      assert.equal(swap.amountOutMinimum, 89550000000000000000000n);
      assert.equal(swap.minHopPriceX36, 0n);
      assert.equal(
        swap.hookData,
        encodeAbiParameters([{ type: "address" }], [account]),
      );
      assert.equal(BigInt(mock.sent[0].value), swap.amountIn);
      mock.state.receiptPending = false;
      await confirmed(page, "#trade");
      await enabled(
        page.getByRole("button", { name: "Review buy", exact: true }),
      );
    },
  );
  await check(
    "Simulation revert blocks signing and explains slippage",
    async () => {
      const before = mock.sent.length;
      mock.state.failExecute = true;
      await page
        .getByRole("button", { name: "Review buy", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Confirm buy", exact: true })
        .click();
      await text(page, "price moved beyond your slippage");
      assert.equal(mock.sent.length, before);
      mock.state.failExecute = false;
    },
  );
  await check(
    "Wallet transaction rejection returns control to idle",
    async () => {
      mock.state.rejectSend = true;
      await enabled(
        page.getByRole("button", { name: "Review buy", exact: true }),
      );
      await page
        .getByRole("button", { name: "Review buy", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Confirm buy", exact: true })
        .click();
      await text(page, "Request declined in your wallet");
      await enabled(
        page.getByRole("button", { name: "Review buy", exact: true }),
      );
      mock.state.rejectSend = false;
    },
  );
  await check(
    "Sell is exactly token approval → Permit2 approval → simulated swap with no ETH value",
    async () => {
      await page.getByRole("button", { name: "Sell", exact: true }).click();
      await page.locator("#amount").fill("10");
      await enabled(
        page.getByRole("button", { name: "Approve REKTD", exact: true }),
      );
      await page
        .getByRole("button", { name: "Approve REKTD", exact: true })
        .click();
      await enabled(
        page.getByRole("button", { name: "Authorize router", exact: true }),
      );
      const approval = mock.sent.at(-1);
      assert.equal(approval.to.toLowerCase(), manifest.contracts[0].address);
      const approved = decodeFunctionData({
        abi: tokenAbi,
        data: approval.data,
      });
      assert.equal(
        approved.args[0].toLowerCase(),
        manifest.network.uniswapV4.permit2,
      );
      assert.equal(approved.args[1], 10n ** 19n);
      await page
        .getByRole("button", { name: "Authorize router", exact: true })
        .click();
      await enabled(
        page.getByRole("button", { name: "Review sell", exact: true }),
      );
      const permit = decodeFunctionData({
        abi: permitAbi,
        data: mock.sent.at(-1).data,
      });
      assert.equal(
        permit.args[1].toLowerCase(),
        manifest.network.uniswapV4.universalRouter,
      );
      assert.equal(permit.args[2], 10n ** 19n);
      assert(permit.args[3] > Date.now() / 1000 + 1000);
      await page
        .getByRole("button", { name: "Review sell", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Confirm sell", exact: true })
        .click();
      await confirmed(page, "#trade");
      assert.equal(BigInt(mock.sent.at(-1).value ?? 0), 0n);
    },
  );
  await check(
    "Settle, payout, creator claim and recovery use the deployed ABI, recipient and prerequisites",
    async () => {
      assert(
        await page
          .getByRole("button", { name: "Settle round", exact: true })
          .isDisabled(),
      );
      mock.state.expired = true;
      mock.state.roundEnd = Math.floor(Date.now() / 1000) - 1;
      await enabled(
        page.getByRole("button", { name: "Settle round", exact: true }),
      );
      await page
        .getByRole("button", { name: "Settle round", exact: true })
        .click();
      await confirmed(page, ".operation:nth-child(1)");
      await enabled(
        page.getByRole("button", { name: "Claim payout", exact: true }),
      );
      await page
        .getByRole("button", { name: "Claim payout", exact: true })
        .click();
      await confirmed(page, ".operation:nth-child(2)");
      const claim = decodeFunctionData({
        abi: hookAbi,
        data: mock.sent.at(-1).data,
      });
      assert.equal(claim.functionName, "claimPayout");
      assert.equal(getAddress(claim.args[0]), getAddress(account));
      await enabled(
        page.getByRole("button", { name: "Claim creator fees", exact: true }),
      );
      await page
        .getByRole("button", { name: "Claim creator fees", exact: true })
        .click();
      await confirmed(page, ".operation:nth-child(3)");
      await page.getByText("Parked payout recovery", { exact: true }).click();
      assert(
        await page
          .getByRole("button", { name: "Recover parked payout", exact: true })
          .isDisabled(),
      );
      mock.state.payout = 100000000000000n;
      mock.state.parked = BigInt(Math.floor(Date.now() / 1000) - 86401);
      await enabled(
        page.getByRole("button", {
          name: "Recover parked payout",
          exact: true,
        }),
      );
      await page
        .getByRole("button", { name: "Recover parked payout", exact: true })
        .click();
      await page
        .getByText("View recover parked payout transaction", { exact: false })
        .waitFor();
    },
  );
  await check(
    "Owner-only setup has validated addresses and a concrete confirmation",
    async () => {
      await page.getByText("Owner settings", { exact: true }).click();
      await page.locator("#creator-recipient").fill("bad address");
      assert(
        await page
          .getByRole("button", { name: "Review fee recipient", exact: true })
          .isDisabled(),
      );
      await page.locator("#creator-recipient").fill(account);
      await enabled(
        page.getByRole("button", { name: "Review fee recipient", exact: true }),
      );
      await page
        .getByRole("button", { name: "Review fee recipient", exact: true })
        .click();
      await text(page, "All pending and future creator fees");
      await page
        .getByRole("button", { name: "Update fee recipient", exact: true })
        .click();
      await confirmed(page, ".owner-panel");
      await page.getByText("Owner settings", { exact: true }).click();
    },
  );
  await check(
    "Account changes invalidate balances and owner controls; long values do not overflow",
    async () => {
      mock.state.accounts = [otherAccount];
      mock.state.ethBalance = 123456789012345678901234567890123456789n;
      await page.evaluate(
        (a) => window.__emitWallet("accountsChanged", [a]),
        otherAccount,
      );
      await page.waitForFunction(() => !document.querySelector(".owner-panel"));
      await enabled(
        page.getByRole("button", { name: "Review sell", exact: true }),
      );
      await measure(page, 320, "large wallet balance and full address");
      await page.getByText("Contracts & network", { exact: true }).click();
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
      mock.state.ethBalance = 3n * 10n ** 18n;
    },
  );
  await check(
    "Axe accessibility scan and zero app script/resource failures",
    async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      const axe = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
        .analyze();
      await writeFile(
        resolve(output, "axe.json"),
        JSON.stringify(
          {
            violations: axe.violations,
            passes: axe.passes.map((p) => p.id),
            incomplete: axe.incomplete.map((p) => ({
              id: p.id,
              nodes: p.nodes.length,
            })),
          },
          null,
          2,
        ),
      );
      assert.equal(
        axe.violations.length,
        0,
        JSON.stringify(
          axe.violations.map((v) => ({
            id: v.id,
            nodes: v.nodes.map((n) => n.target),
          })),
        ),
      );
      assert.equal(errors.length, 0, errors.join("\n"));
      assert.equal(resources.length, 0);
    },
  );
  const normalContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const normalPage = await normalContext.newPage();
  await attachMock(normalPage, createMock());
  await normalPage.goto(url);
  await text(normalPage, "Live on-chain");
  await connect(normalPage);
  await measure(normalPage, 390, "connected normal state");
  await normalPage.screenshot({
    path: resolve(output, "arena-mobile-mocked.png"),
    fullPage: false,
  });
  await normalPage.setViewportSize({ width: 1440, height: 1000 });
  await normalPage.screenshot({
    path: resolve(output, "arena-desktop-mocked.png"),
    fullPage: false,
  });
  await normalContext.close();
  await context.close();
  for (const [name, options] of [
    ["missing contract code", { noCode: true }],
    ["RPC chain mismatch", { wrongRpcChain: true }],
    ["RPC outage", { rpcDown: true }],
  ]) {
    const c = await browser.newContext();
    const p = await c.newPage();
    await attachMock(p, createMock(options));
    await p.goto(url);
    await check(`Fail-closed gate: ${name}`, async () => {
      await text(p, "Network data is unavailable");
      assert(
        await p
          .getByRole("button", { name: "Review buy", exact: true })
          .isDisabled(),
      );
      assert(
        await p
          .getByRole("button", { name: "Settle round", exact: true })
          .isDisabled(),
      );
    });
    await c.close();
  }
  const fallbackContext = await browser.newContext();
  const fp = await fallbackContext.newPage();
  const fallbackMock = createMock({ rpcDown: true });
  await attachMock(fp, fallbackMock);
  await fp.goto(url);
  await check(
    "A correct-chain wallet recovers reads when both public RPCs fail",
    async () => {
      await text(fp, "Network data is unavailable");
      await connect(fp);
      await text(fp, "Live on-chain");
      assert(
        fallbackMock.requests.some(
          (r) => r.wallet && r.method === "eth_getCode",
        ),
      );
    },
  );
  await fallbackContext.close();
  const staleContext = await browser.newContext();
  const sp = await staleContext.newPage();
  await attachMock(sp, createMock({ blockTimeOffset: -121 }));
  await sp.goto(url);
  await check(
    "A stale chain timestamp disables actions even after a fresh RPC response",
    async () => {
      await text(sp, "Chain data needs refreshing");
      assert(
        await sp
          .getByRole("button", { name: "Review buy", exact: true })
          .isDisabled(),
      );
    },
  );
  await staleContext.close();
  const phone = await browser.newContext({
    viewport: { width: 390, height: 844 },
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1",
  });
  const p = await phone.newPage();
  await attachMock(p, createMock(), { wallet: false });
  await p.goto(url);
  await check(
    "Phone without provider offers four wallet-browser links and Coinbase Smart Wallet",
    async () => {
      await p
        .getByRole("button", { name: "Connect wallet", exact: true })
        .click();
      for (const name of ["MetaMask", "Coinbase Wallet", "Rabby", "Phantom"])
        assert(
          await p
            .getByRole("link", { name: "Open in " + name, exact: true })
            .isVisible(),
        );
      assert(
        await p
          .getByRole("button", { name: "Coinbase Smart Wallet", exact: true })
          .isVisible(),
      );
      assert.equal(
        await p
          .getByRole("button", { name: "Browser wallet", exact: true })
          .count(),
        0,
      );
      await p.screenshot({
        path: resolve(output, "wallet-mobile.png"),
        fullPage: false,
      });
    },
  );
  await phone.close();
  const edgeContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const ep = await edgeContext.newPage();
  const edge = createMock();
  await attachMock(ep, edge);
  await ep.goto(url);
  await text(ep, "Live on-chain");
  await connect(ep);
  await check("A failed quote cannot be signed and can recover", async () => {
    edge.state.failQuote = true;
    await ep.locator("#amount").fill("0.002");
    await ep.locator("#quote-note.error").waitFor();
    assert.match(
      await ep.locator("#quote-note").innerText(),
      /liquidity|revert|refresh|retry/i,
    );
    assert(
      await ep
        .getByRole("button", { name: "Review buy", exact: true })
        .isDisabled(),
    );
    assert.equal(edge.sent.length, 0);
    edge.state.failQuote = false;
    await ep.locator("#amount").fill("0.001");
    await enabled(ep.getByRole("button", { name: "Review buy", exact: true }));
  });
  await check(
    "A reverted receipt is failure, not a successful or permanently pending swap",
    async () => {
      edge.state.receiptFailed = true;
      await ep.getByRole("button", { name: "Review buy", exact: true }).click();
      await ep
        .getByRole("button", { name: "Confirm buy", exact: true })
        .click();
      await text(ep, "Transaction reverted on chain");
      await enabled(
        ep.getByRole("button", { name: "Review buy", exact: true }),
      );
      assert.equal(edge.sent.length, 1);
      edge.state.receiptFailed = false;
    },
  );
  await check(
    "A frozen review expires even when background quotes refresh",
    async () => {
      await ep.clock.install();
      await ep.getByRole("button", { name: "Review buy", exact: true }).click();
      await ep.clock.fastForward(31_000);
      await text(ep, "This quote expired");
      assert(
        await ep
          .getByRole("button", { name: "Confirm buy", exact: true })
          .isDisabled(),
      );
      await ep
        .getByRole("button", { name: "Close review buy", exact: true })
        .click();
    },
  );
  await edgeContext.close();
  const badAbiContext = await browser.newContext();
  const bp = await badAbiContext.newPage();
  await bp.route("**/abi/RektdToken.json", (route) =>
    route.fulfill({ contentType: "application/json", body: "[]" }),
  );
  await bp.goto(url);
  await check("Tampered application ABI blocks startup", async () => {
    await text(bp, "failed its integrity check");
    assert.equal(
      await bp.getByRole("button", { name: "Review buy", exact: true }).count(),
      0,
    );
  });
  await badAbiContext.close();
  for (const action of ["transfer", "renounce"]) {
    const ownerContext = await browser.newContext();
    const op = await ownerContext.newPage();
    const ownerMock = createMock();
    await attachMock(op, ownerMock);
    await op.goto(url);
    await text(op, "Live on-chain");
    await connect(op);
    await check(
      `Owner ${action}: confirmation persists after owner access is removed`,
      async () => {
        await op.getByText("Owner settings", { exact: true }).click();
        if (action === "transfer") {
          await op.locator("#new-owner").fill(otherAccount);
          await op
            .getByRole("button", {
              name: "Review ownership transfer",
              exact: true,
            })
            .click();
          await op
            .getByRole("button", { name: "Transfer ownership", exact: true })
            .click();
        } else {
          await op
            .getByText("Renounce ownership permanently", { exact: true })
            .click();
          assert(
            await op
              .getByRole("button", { name: "Review renunciation", exact: true })
              .isDisabled(),
          );
          await op.locator("#renounce").fill("RENOUNCE");
          await op
            .getByRole("button", { name: "Review renunciation", exact: true })
            .click();
          await text(op, "Owner access will be permanently removed");
          await op
            .getByRole("button", {
              name: "Renounce ownership permanently",
              exact: true,
            })
            .click();
        }
        await op.waitForFunction(() => !document.querySelector(".owner-panel"));
        await confirmed(op, "#claims");
        const sent = decodeFunctionData({
          abi: hookAbi,
          data: ownerMock.sent.at(-1).data,
        });
        assert.equal(
          sent.functionName,
          action === "transfer" ? "transferOwnership" : "renounceOwnership",
        );
        if (action === "transfer")
          assert.equal(getAddress(sent.args[0]), getAddress(otherAccount));
      },
    );
    await ownerContext.close();
  }
} catch (error) {
  report.limitations.push("Suite stopped after failure: " + error.message);
} finally {
  await browser?.close();
}
try {
  const safari = await webkit.launch();
  try {
    const page = await safari.newPage({
      viewport: { width: 390, height: 844 },
    });
    const mock = createMock();
    await attachMock(page, mock);
    await page.goto(url);
    await text(page, "Live on-chain");
    await check(
      "WebKit: mobile layout, wallet connection and buy review",
      async () => {
        await measure(page, 390, "WebKit");
        await connect(page);
        await page
          .getByRole("button", { name: "Review buy", exact: true })
          .click();
        await page
          .getByRole("button", { name: "Confirm buy", exact: true })
          .click();
        await confirmed(page, "#trade");
      },
    );
  } finally {
    await safari.close();
  }
} catch (error) {
  report.limitations.push("WebKit could not run: " + error.message);
}
server.close();
report.passed = failures === 0 && report.checks.length >= 27;
report.count = report.checks.length;
await writeFile(
  resolve(output, "browser-tests.json"),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(
  JSON.stringify(
    {
      passed: report.passed,
      checks: report.count,
      failures,
      limitations: report.limitations,
    },
    null,
    2,
  ),
);
if (!report.passed) process.exitCode = 1;
